// Ground cover and props: scanned ferns, mossy rocks and a tree stump (Poly Haven, CC0),
// plus procedural grass clumps that sway in the wind.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Each mesh in a glTF becomes one variant: { geometry, material }. Meshes are centred
// at their own origin in these files, so node translations (the showcase layout) are dropped.
async function variants(manager, id, tweak) {
  const gltf = await new GLTFLoader(manager).loadAsync(`assets/models/${id}/${id}.gltf`);
  const out = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone();
    if (o.quaternion) geometry.applyQuaternion(o.quaternion);
    geometry.scale(o.scale.x, o.scale.y, o.scale.z);
    geometry.computeBoundingBox();
    out.push({ geometry, material: o.material });
  });
  if (tweak) out.forEach((v) => tweak(v.material));
  return out;
}

export async function loadProps(manager, texLoader) {
  const [ferns, rocks, stumps] = await Promise.all([
    variants(manager, 'fern_02', (m) => {
      // the fern's cut-out lives in its own map, which the glTF doesn't reference
      const a = texLoader.load('assets/models/fern_02/textures/fern_02_alpha_1k.jpg');
      a.flipY = false;
      m.alphaMap = a;
      m.alphaTest = 0.5;
      m.transparent = false;
      m.side = THREE.DoubleSide;
    }),
    variants(manager, 'rock_moss_set_01'),
    variants(manager, 'tree_stump_01'),
  ]);
  return { ferns, rocks, stumps, grass: grassClump() };
}

// A clump of 10 thin curved blades. Vertex colour runs dark at the root to pale at the tip;
// the `sway` attribute (0 root .. 1 tip) drives the wind in the shader.
function grassClump() {
  const pos = [], col = [], sway = [], idx = [];
  const root = new THREE.Color(0x2a3318), tip = new THREE.Color(0x9aa25a);
  let v = 0;
  for (let b = 0; b < 10; b++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.random() * 0.18;
    const x0 = Math.cos(ang) * dist, z0 = Math.sin(ang) * dist;
    const h = 0.25 + Math.random() * 0.4;
    const w = 0.018 + Math.random() * 0.014;
    const lean = 0.1 + Math.random() * 0.25;
    const face = Math.random() * Math.PI;
    const fx = Math.cos(face), fz = Math.sin(face);
    const segs = 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const cx = x0 + Math.cos(ang) * lean * t * t * h, cz = z0 + Math.sin(ang) * lean * t * t * h;
      const ww = w * (1 - t * 0.9);
      pos.push(cx - fx * ww, t * h, cz - fz * ww, cx + fx * ww, t * h, cz + fz * ww);
      const c = root.clone().lerp(tip, t * (0.7 + Math.random() * 0.3));
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      sway.push(t * t, t * t);
    }
    for (let s = 0; s < segs; s++) {
      const a = v + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    v += (segs + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
  const uTime = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 wp = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float wind = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.21) + 0.5 * sin(uTime * 3.1 + wp.z * 0.9);
        transformed.x += wind * sway * 0.07;
        transformed.z += wind * sway * 0.04;`);
  };
  // bend normals toward straight up so blades shade softly like the ground, while still
  // catching a low flashlight beam from the side
  const n = g.attributes.normal, v3 = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v3.fromBufferAttribute(n, i).multiplyScalar(0.6).add(new THREE.Vector3(0, 1, 0)).normalize();
    n.setXYZ(i, v3.x, v3.y, v3.z);
  }
  return { geometry: g, material: mat, uTime };
}
