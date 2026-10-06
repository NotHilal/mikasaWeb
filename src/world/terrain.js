// Ground: a gently rolling heightfield covered in scanned forest-floor textures.
// heightAt() is the single source of truth for the ground, used by the mesh, props and players.
import * as THREE from 'three';
import { simplex2, fbm } from './noise.js';
import { MAP } from '../config.js';

export function makeHeight(seed) {
  const n = simplex2(seed);
  const n2 = simplex2(seed + 7);
  return {
    heightAt(x, z) {
      return fbm(n, x * 0.012, z * 0.012, 4) * 4.5 + n2(x * 0.06, z * 0.06) * 0.35;
    },
    // 0..1, where the second (muddier) ground texture shows
    mudAt(x, z) {
      return THREE.MathUtils.smoothstep(fbm(n2, x * 0.03 + 50, z * 0.03, 3), -0.1, 0.35);
    },
  };
}

function loadSet(loader, dir, repeat) {
  const set = {};
  for (const [key, file] of [['map', 'diff'], ['normalMap', 'nor_gl'], ['arm', 'arm']]) {
    const t = loader.load(`${dir}/${file}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    if (key === 'map') t.colorSpace = THREE.SRGBColorSpace;
    set[key] = t;
  }
  return set;
}

export function buildTerrain(height, loader) {
  const size = MAP.half * 2;
  const seg = 220;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const mud = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, height.heightAt(x, z));
    mud[i] = height.mudAt(x, z);
  }
  geo.setAttribute('mud', new THREE.BufferAttribute(mud, 1));
  geo.computeVertexNormals();

  const repeat = size / 3.5; // one texture tile every 3.5 m
  const a = loadSet(loader, 'assets/tex/forest_leaves_02', repeat);
  const b = loadSet(loader, 'assets/tex/brown_mud_leaves_01', repeat);

  const mat = new THREE.MeshStandardMaterial({
    map: a.map, normalMap: a.normalMap, roughnessMap: a.arm, aoMap: a.arm,
    aoMapIntensity: 1, metalness: 0, roughness: 1,
    normalScale: new THREE.Vector2(1.2, 1.2),
  });
  // Blend in the second texture set where `mud` is high, and sample each set at a
  // second scale to break up visible tiling.
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.mapB = { value: b.map };
    sh.uniforms.normalB = { value: b.normalMap };
    sh.uniforms.armB = { value: b.arm };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float mud;\nvarying float vMud;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMud = mud;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D mapB; uniform sampler2D normalB; uniform sampler2D armB;
        varying float vMud;
        vec2 uvB(vec2 uv) { return mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.77; }`)
      .replace('#include <map_fragment>', `
        vec4 texA = texture2D(map, vMapUv);
        vec4 texA2 = texture2D(map, vMapUv * 0.31 + 0.17);
        texA = mix(texA, texA2, 0.35);
        vec4 texB = texture2D(mapB, uvB(vMapUv));
        diffuseColor *= mix(texA, texB, vMud);`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * mix(texture2D(roughnessMap, vRoughnessMapUv).g, texture2D(armB, uvB(vRoughnessMapUv)).g, vMud);`)
      .replace('#include <aomap_fragment>', `
        float ambientOcclusion = mix(texture2D(aoMap, vAoMapUv).r, texture2D(armB, uvB(vAoMapUv)).r, vMud);
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        reflectedLight.indirectSpecular *= ambientOcclusion;`)
      .replace('#include <normal_fragment_maps>', `
        vec3 nA = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
        vec3 nB = texture2D(normalB, uvB(vNormalMapUv)).xyz * 2.0 - 1.0;
        vec3 mapN = normalize(mix(nA, nB, vMud));
        mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);`);
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
