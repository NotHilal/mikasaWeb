// Builds the forest (same layout on every client, from MAP.seed) and answers
// "how high is the ground here" and "am I walking into something".
import * as THREE from 'three';
import { rng, simplex2 } from './noise.js';
import { makeHeight, buildTerrain } from './terrain.js';
import { treeKit, tube } from './trees.js';
import { loadProps } from './props.js';
import { Chunked, makeMatrix } from './instancing.js';
import { MAP, PAGES } from '../config.js';
import { quality } from '../engine.js';

// --- collision: circles in a spatial hash ------------------------------------
class Colliders {
  constructor(cell = 4) { this.cell = cell; this.map = new Map(); }
  key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  add(x, z, r) {
    const c = this.cell;
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++)
      for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
        const k = this.key(ix, iz);
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push({ x, z, r });
      }
  }
  // push a circle (pos.x, pos.z, radius) out of everything it overlaps; mutates pos
  resolve(pos, radius) {
    const c = this.cell;
    const ix = Math.floor(pos.x / c), iz = Math.floor(pos.z / c);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.map.get(this.key(ix + dx, iz + dz));
        if (!list) continue;
        for (const o of list) {
          const ox = pos.x - o.x, oz = pos.z - o.z;
          const d = Math.hypot(ox, oz), min = o.r + radius;
          if (d < min && d > 1e-5) { pos.x = o.x + (ox / d) * min; pos.z = o.z + (oz / d) * min; }
        }
      }
    const lim = MAP.play, len = Math.hypot(pos.x, pos.z);
    if (len > lim) { pos.x *= lim / len; pos.z *= lim / len; }
  }
}

function fallenLog(seed, barkMat) {
  const r = rng(seed);
  const L = r.range(3.5, 7), R = r.range(0.18, 0.3);
  const spine = [];
  for (let i = 0; i <= 10; i++) spine.push(new THREE.Vector3((i / 10 - 0.5) * L, Math.sin(i * 0.7) * 0.04, Math.sin(i * 0.5) * 0.08));
  const g = tube(spine, (t, a) => R * (1 - t * 0.35) * (1 + Math.sin(a * 5 + t * 9) * 0.05) * (t < 0.03 || t > 0.97 ? 0.75 : 1), 12, 3, 1.6);
  return { geometry: g, material: barkMat, length: L, radius: R };
}

function pageTexture(n) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 360;
  const g = cv.getContext('2d');
  g.fillStyle = '#d9d4c5';
  g.fillRect(0, 0, 256, 360);
  // grime and creases
  const r = rng(n * 31 + 5);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(70,55,35,${r() * 0.06})`;
    g.fillRect(r() * 256, r() * 360, r() * 30, r() * 30);
  }
  g.strokeStyle = 'rgba(80,70,50,0.25)';
  g.beginPath(); g.moveTo(0, 170 + r() * 30); g.lineTo(256, 160 + r() * 30); g.stroke();
  g.fillStyle = '#1b1b1b';
  g.font = '64px "Caveat", cursive';
  g.textAlign = 'center';
  g.fillText(`${n} / ${PAGES}`, 128, 200);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export async function buildWorld(scene, manager) {
  const texLoader = new THREE.TextureLoader(manager);
  const height = makeHeight(MAP.seed);
  const r = rng(MAP.seed);
  const density = simplex2(MAP.seed + 3);
  const colliders = new Colliders();
  const updaters = [];
  const add = (c) => { scene.add(c.group); updaters.push(c); };

  scene.add(buildTerrain(height, texLoader));

  // --- trees: jittered grid, thinned by noise into clearings and denser stands
  const kit = treeKit(texLoader);
  const treeMats = kit.variants.map(() => []);
  const trees = []; // { x, z, r, variant, scale, rot }
  const step = 3.6;
  for (let gx = -MAP.half; gx <= MAP.half; gx += step) {
    for (let gz = -MAP.half; gz <= MAP.half; gz += step) {
      const x = gx + r.range(-1.4, 1.4), z = gz + r.range(-1.4, 1.4);
      const edge = Math.hypot(x, z) > MAP.play - 2; // a dense wall of trees around the play area
      const d = density(x * 0.025, z * 0.025);
      if (!edge && (d < -0.35 || r() > 0.42 + d * 0.3)) continue;
      if (Math.hypot(x, z) < 6) continue; // small clearing in the middle
      const v = r.int(kit.variants.length), scale = r.range(0.85, 1.2), rot = r() * Math.PI * 2;
      treeMats[v].push(makeMatrix(x, height.heightAt(x, z), z, rot, scale));
      const radius = kit.variants[v].radius * scale;
      trees.push({ x, z, r: radius, variant: v, scale, rot, H: kit.variants[v].height * scale });
      colliders.add(x, z, radius + 0.08);
    }
  }
  kit.variants.forEach((v, i) => {
    const bark = new Chunked(v.bark, kit.barkMat, treeMats[i], { maxDist: 52 });
    const tint = treeMats[i].map(() => new THREE.Color().setHSL(0.25 + r.range(-0.03, 0.03), 0.3, r.range(0.75, 1)));
    const needles = new Chunked(v.needles, kit.needleMat, treeMats[i], { colors: tint, maxDist: 52, shadow: quality === 'high' });
    add(bark); add(needles);
  });

  // --- props
  const props = await loadProps(manager, texLoader);
  const inPlay = (x, z, margin = 0) => Math.hypot(x, z) < MAP.play - margin;
  const randPoint = () => [r.range(-MAP.half, MAP.half), r.range(-MAP.half, MAP.half)];

  // Ground cover is cosmetic and its amount depends on the graphics setting, so it uses
  // its own random stream: everything solid below stays identical for both players.
  const rc = rng(MAP.seed + 99);
  const high = quality === 'high';
  const coverPoint = () => [rc.range(-MAP.half, MAP.half), rc.range(-MAP.half, MAP.half)];

  // ferns cluster in patches
  const fernMats = props.ferns.map(() => []);
  for (let i = 0; i < (high ? 2600 : 1300); i++) {
    const [x, z] = coverPoint();
    if (density(x * 0.05 + 20, z * 0.05) < -0.05 && rc() > 0.15) continue;
    fernMats[rc.int(props.ferns.length)].push(makeMatrix(x, height.heightAt(x, z) - 0.02, z, rc() * 6.28, rc.range(0.9, 1.9)));
  }
  props.ferns.forEach((f, i) => {
    add(new Chunked(f.geometry, f.material, fernMats[i], { maxDist: 32, chunk: 12, shadow: high }));
  });

  // grass
  const grassMats = [];
  for (let i = 0; i < (high ? 24000 : 12000); i++) {
    const [x, z] = coverPoint();
    if (density(x * 0.04 - 9, z * 0.04 + 4) < 0.0 && rc() > 0.1) continue;
    grassMats.push(makeMatrix(x, height.heightAt(x, z) - 0.02, z, rc() * 6.28, rc.range(0.7, 1.4)));
  }
  add(new Chunked(props.grass.geometry, props.grass.material, grassMats, { shadow: false, maxDist: 28, chunk: 12 }));

  // rocks
  const rockMats = props.rocks.map(() => []);
  for (let i = 0; i < 170; i++) {
    const [x, z] = randPoint();
    const v = r.int(props.rocks.length), s = r() < 0.15 ? r.range(0.9, 1.6) : r.range(0.25, 0.7);
    const bb = props.rocks[v].geometry.boundingBox;
    rockMats[v].push(makeMatrix(x, height.heightAt(x, z) - bb.min.y * s * 0.5 - 0.1 * s, z, r() * 6.28, s, r.range(-0.15, 0.15), r.range(-0.15, 0.15)));
    if (s > 0.55) colliders.add(x, z, Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.45 * s);
  }
  props.rocks.forEach((p, i) => add(new Chunked(p.geometry, p.material, rockMats[i], { maxDist: 45, chunk: 16 })));

  // stumps
  const stumpMats = [];
  for (let i = 0; i < 14; i++) {
    const [x, z] = randPoint();
    const s = r.range(0.8, 1.3);
    stumpMats.push(makeMatrix(x, height.heightAt(x, z) + 0.12 * s, z, r() * 6.28, s));
    colliders.add(x, z, 0.55 * s);
  }
  add(new Chunked(props.stumps[0].geometry, props.stumps[0].material, stumpMats, { maxDist: 40, chunk: 16 }));

  // fallen logs
  const logs = [0, 1, 2].map((i) => fallenLog(500 + i, kit.barkMat));
  const logMats = logs.map(() => []);
  for (let i = 0; i < 45; i++) {
    const [x, z] = randPoint();
    const v = r.int(logs.length), rot = r() * Math.PI * 2;
    const L = logs[v].length, R = logs[v].radius;
    const hx = Math.cos(rot) * L * 0.5, hz = -Math.sin(rot) * L * 0.5;
    const y = Math.min(height.heightAt(x - hx, z - hz), height.heightAt(x + hx, z + hz), height.heightAt(x, z));
    const slope = Math.atan2(height.heightAt(x + hx, z + hz) - height.heightAt(x - hx, z - hz), L);
    logMats[v].push(makeMatrix(x, y + R * 0.6, z, rot, 1, 0, slope));
    for (let t = -0.5; t <= 0.5; t += 0.35 / L) colliders.add(x + hx * 2 * t, z + hz * 2 * t, R + 0.05);
  }
  logs.forEach((l, i) => add(new Chunked(l.geometry, l.material, logMats[i], { maxDist: 45 })));

  // --- pages
  const pageGeo = new THREE.PlaneGeometry(0.21, 0.29);
  const pageCandidates = trees.filter((t) => inPlay(t.x, t.z, 8));

  return {
    heightAt: height.heightAt,
    colliders,
    trees,
    update(dt, camPos, time) {
      props.grass.uTime.value = time;
      for (const u of updaters) u.update(camPos);
    },

    // choose PAGES trees far apart, using a per-match seed (same on both clients)
    pickPages(seed) {
      const pr = rng(seed);
      const chosen = [];
      for (let tries = 0; chosen.length < PAGES && tries < 5000; tries++) {
        const i = pr.int(pageCandidates.length);
        const t = pageCandidates[i];
        if (chosen.some((c) => Math.hypot(pageCandidates[c].x - t.x, pageCandidates[c].z - t.z) < 26)) continue;
        chosen.push(i);
      }
      return chosen.map((i, n) => ({ tree: i, face: pr() * Math.PI * 2, n: n + 1 }));
    },

    // put page meshes on their trees; returns [{ mesh, pos }]
    placePages(spots) {
      return spots.map(({ tree, face, n }) => {
        const t = pageCandidates[tree];
        const y = 1.5;
        const trunkR = t.r * (1 - (y + 0.3) / t.H) ** 1.15;
        const dir = new THREE.Vector3(Math.sin(face), 0, Math.cos(face));
        const pos = new THREE.Vector3(t.x, height.heightAt(t.x, t.z) + y, t.z).addScaledVector(dir, trunkR + 0.05);
        const mesh = new THREE.Mesh(pageGeo, new THREE.MeshStandardMaterial({ map: pageTexture(n), color: 0xb0b0b0, roughness: 0.9, side: THREE.DoubleSide }));
        mesh.position.copy(pos);
        mesh.rotation.set(0, face, (pr2(n) - 0.5) * 0.3);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        return { mesh, pos, n };
      });
    },

    // a spot on the ground far from `away` (or anywhere), clear of colliders
    spawnPoint(seed, away) {
      const sr = rng(seed);
      for (let i = 0; i < 500; i++) {
        const ang = sr() * Math.PI * 2, dist = sr.range(20, MAP.play - 8);
        const p = new THREE.Vector3(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
        if (away && p.distanceTo(away) < 70) continue;
        const q = p.clone();
        colliders.resolve(q, 0.6);
        if (q.distanceTo(p) > 0.01) continue;
        p.y = height.heightAt(p.x, p.z);
        return p;
      }
      return new THREE.Vector3(0, height.heightAt(0, 0), 0);
    },
  };
}

const pr2 = (n) => rng(n * 977)();
