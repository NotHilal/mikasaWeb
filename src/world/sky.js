// Night sky dome: horizon haze matching the fog, stars, and a moon with a soft halo.
import * as THREE from 'three';

export function buildSky(fogColor, moonDir) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: fogColor.clone() },
      uZenith: { value: new THREE.Color(0x020308) },
      uMoonDir: { value: moonDir.clone().normalize() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // always at the far plane
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uHorizon, uZenith, uMoonDir;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
        // stars: sparse hashed cells, fading out near the hazy horizon
        vec3 cell = floor(d * 380.0);
        float s = hash(cell);
        float star = step(0.9985, s) * smoothstep(0.08, 0.4, h) * (0.4 + 0.6 * hash(cell + 3.1));
        col += vec3(0.75, 0.8, 1.0) * star * 0.9;
        // moon disc + halo
        float m = dot(d, uMoonDir);
        col += vec3(0.9, 0.93, 1.0) * smoothstep(0.99955, 0.9997, m) * 3.0;
        col += vec3(0.35, 0.42, 0.6) * pow(max(m, 0.0), 180.0) * 0.6;
        col += vec3(0.12, 0.15, 0.24) * pow(max(m, 0.0), 12.0) * 0.25;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
