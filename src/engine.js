// Renderer, camera, lights and post-processing (bloom, film grain, vignette, lens fringing).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildSky } from './world/sky.js';
import { settings } from './settings.js';
import { LIGHT } from './config.js';

export const FOG = new THREE.Color(LIGHT.fog);
// the graphics preset in use ('high' | 'low'), resolved from settings when the engine starts
export let quality = 'high';

const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.07 },
    uVignette: { value: 1.0 },
    uFringe: { value: 0.0006 },
    uSaturation: { value: 0.8 },
    uStatic: { value: 0 },     // screen noise (0..1), for when the hunter is close/seen
    uFlash: { value: 0 },      // white-out from a flash (0..1)
    uTint: { value: 0 },       // red tint while stunned (0..1)
    uLift: { value: new THREE.Vector3(0.003, 0.004, 0.008) }, // blue-ish shadows (faint: the dark should stay dark)
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uFringe, uSaturation, uStatic, uFlash, uTint; uniform vec3 uLift;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uFringe * 40.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSaturation);
      col += uLift * (1.0 - l);
      col *= mix(1.0, smoothstep(0.85, 0.15, r2 * 1.6), uVignette);
      float n = hash(vUv * 1000.0 + fract(uTime * 7.13) * 100.0) - 0.5;
      col += n * uGrain * (0.35 + 0.65 * (1.0 - l));
      // static: noise lines and snow
      float lines = step(0.5, hash(vec2(floor(vUv.y * 180.0), floor(uTime * 30.0))));
      col = mix(col, vec3(hash(vUv * 500.0 + uTime) * 0.8) * (0.6 + 0.4 * lines), uStatic * 0.85);
      col = mix(col, vec3(l * 1.4 + 0.08, l * 0.3, l * 0.3), uTint * 0.7);
      col = mix(col, vec3(1.0), uFlash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createEngine(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  // 'auto' graphics: integrated GPUs get the low preset
  quality = settings.quality;
  if (quality === 'auto') {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    quality = /intel|uhd|iris|mali|adreno|powervr|swiftshader|llvmpipe/i.test(gpu) ? 'low' : 'high';
  }

  // dynamic resolution: the render scale drops on slow GPUs and climbs back when there's headroom
  const maxScale = Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1);
  let scale = maxScale;
  renderer.setPixelRatio(scale);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 2.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG, 0.05);
  scene.background = FOG;

  const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 500);
  scene.add(camera);

  // moonlight: dim and blue, with shadows in a box that follows the camera
  const moonDir = new THREE.Vector3(-0.45, 0.75, -0.5).normalize();
  const moon = new THREE.DirectionalLight(0x9bb0ff, LIGHT.moon);
  moon.castShadow = true;
  const shadowRes = quality === 'high' ? 2048 : 1024, shadowBox = 34;
  moon.shadow.mapSize.set(shadowRes, shadowRes);
  Object.assign(moon.shadow.camera, { left: -shadowBox, right: shadowBox, top: shadowBox, bottom: -shadowBox, near: 1, far: 140 });
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.04;
  scene.add(moon, moon.target);

  const hemi = new THREE.HemisphereLight(0x2b3c5c, 0x0d0a08, LIGHT.ambient);
  scene.add(hemi);

  const sky = buildSky(FOG, moonDir);
  scene.add(sky);

  // post-processing
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
  composer.addPass(new RenderPass(scene, camera));
  // first-person weapon: its own scene, drawn over the world after clearing depth so it
  // never pokes into trees
  const viewScene = new THREE.Scene();
  viewScene.add(new THREE.HemisphereLight(0x4a4852, 0x0d0a08, LIGHT.weapon));
  const viewPass = new RenderPass(viewScene, camera);
  viewPass.clear = false;
  viewPass.clearDepth = true;
  composer.addPass(viewPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.25, 0.5, 1.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass());
  const film = new ShaderPass(FilmShader);
  composer.addPass(film);

  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(scale);
    composer.setPixelRatio(scale);
    composer.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', resize);
  resize();

  // light-space axes, to snap the shadow box to whole shadow-map texels (stops shimmering edges)
  const lz = moonDir.clone().negate();
  const lx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), lz).normalize();
  const ly = new THREE.Vector3().crossVectors(lz, lx);
  const texel = (shadowBox * 2) / shadowRes;
  const snapped = new THREE.Vector3();

  let frames = 0, since = performance.now(), calm = 0, warmup = 3;
  function adaptResolution() {
    frames++;
    const now = performance.now();
    if (now - since < 1000) return;
    const fps = (frames * 1000) / (now - since);
    frames = 0; since = now;
    if (document.hidden || api.fixedScale || warmup-- > 0) return; // ignore loading hitches
    let next = scale;
    if (fps < 45) next = Math.max(0.5, scale - (fps < 30 ? 0.15 : 0.08));
    else if (fps > 58 && ++calm >= 3) { next = Math.min(maxScale, scale + 0.08); calm = 0; }
    if (Math.abs(next - scale) > 0.01) { scale = next; resize(); }
  }

  const api = {
    renderer, scene, camera, composer, film, moon, hemi, sky, viewScene,
    fixedScale: 0, // set to lock the render scale (testing)
    get scale() { return scale; },
    setScale(s) { scale = s; resize(); },
    render(time) {
      adaptResolution();
      // keep the shadow box and sky centred on the camera
      const p = camera.position;
      const a = Math.round(p.dot(lx) / texel) * texel, b = Math.round(p.dot(ly) / texel) * texel, c = p.dot(lz);
      snapped.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(lz, c);
      moon.target.position.copy(snapped);
      moon.position.copy(snapped).addScaledVector(moonDir, 70);
      sky.position.copy(p);
      film.uniforms.uTime.value = time;
      composer.render();
    },
  };
  return api;
}
