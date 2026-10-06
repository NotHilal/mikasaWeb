// The seeker's flashlight: a shadow-casting spot light with a lens "cookie" (hot centre,
// a faint ring and smudges, like a real cheap torch), plus dust motes that only show
// inside the beam.
import * as THREE from 'three';

function cookie() {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.18, '#f4f1e8');
  grad.addColorStop(0.42, '#8a8780');
  grad.addColorStop(0.55, '#a29e94'); // faint outer ring
  grad.addColorStop(0.68, '#47453f');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  // lens smudges
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    g.beginPath();
    g.arc(s / 2 + (Math.random() - 0.5) * s * 0.6, s / 2 + (Math.random() - 0.5) * s * 0.6, Math.random() * 20, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createFlashlight(scene) {
  const light = new THREE.SpotLight(0xfff1dc, 42, 50, 0.5, 0.45, 1.0);
  light.map = cookie();
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 0.2;
  light.shadow.camera.far = 48;
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.02;
  scene.add(light, light.target);

  // dust motes in a box that wraps around the light
  const N = 1400, BOX = 14;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) pos[i] = Math.random() * BOX;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uOrigin: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, 0, -1) },
      uTime: { value: 0 }, uOn: { value: 1 }, uBox: { value: BOX }, uCos: { value: Math.cos(0.42) },
    },
    vertexShader: /* glsl */`
      uniform vec3 uOrigin, uDir; uniform float uTime, uBox, uCos;
      varying float vA;
      void main() {
        vec3 p = position + vec3(sin(uTime * 0.13 + position.y) * 0.4, -uTime * 0.05, cos(uTime * 0.11 + position.x) * 0.4);
        p = mod(p - uOrigin + uBox * 0.5, uBox) - uBox * 0.5 + uOrigin;
        vec3 d = p - uOrigin;
        float dist = length(d);
        float cone = smoothstep(uCos, uCos + 0.08, dot(d / dist, uDir));
        vA = cone * smoothstep(0.3, 1.0, dist) * smoothstep(7.0, 2.0, dist);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = min(30.0 / -mv.z, 6.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uOn; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(1.0, 0.95, 0.85), smoothstep(0.5, 0.0, d) * vA * 0.35 * uOn);
      }`,
  });
  const dust = new THREE.Points(geo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  const smoothDir = new THREE.Vector3(0, 0, -1);
  let on = true, flicker = 0;
  const base = light.intensity;

  return {
    light,
    get on() { return on; },
    set on(v) { on = v; light.visible = v; },
    // place at `from` aiming along `dir`; the beam lags the view a little like a hand-held torch
    update(dt, from, dir, time, lag = true) {
      smoothDir.lerp(dir, lag ? Math.min(1, dt * 14) : 1).normalize();
      light.position.copy(from);
      light.target.position.copy(from).addScaledVector(smoothDir, 10);
      // rare tiny flickers
      if (Math.random() < dt * 0.15) flicker = 0.15;
      flicker = Math.max(0, flicker - dt);
      light.intensity = base * (flicker > 0 ? 0.55 + Math.random() * 0.45 : 1);
      const u = dustMat.uniforms;
      u.uOrigin.value.copy(from);
      u.uDir.value.copy(smoothDir);
      u.uTime.value = time;
      u.uOn.value = on ? 1 : 0;
    },
  };
}
