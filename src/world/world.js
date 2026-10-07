// Builds the forest (same layout on every client, from MAP.seed) and answers
// "how high is the ground here" and "am I walking into something". The game asks every map the
// same things (Split answers them too, see split/): heightAt, colliders, clamp, map, pickPages,
// placePages, spawnPoint, update.
import * as THREE from 'three';
import { rng, simplex2 } from './noise.js';
import { makeHeight, buildTerrain } from './terrain.js';
import { treeKit, tube } from './trees.js';
import { loadProps } from './props.js';
import { buildLandmarks } from './landmarks.js';
import { Chunked, makeMatrix } from './instancing.js';
import { MAP, PAGES, PAGE_SPOTS } from '../config.js';
import { placePages } from './pages.js';
import { quality } from '../engine.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// --- collision: circles in a spatial hash ------------------------------------
// Each circle is a vertical cylinder up to height `top` (world y), so low rocks block
// walking but not a shot fired over them.
class Colliders {
  constructor(cell = 4) { this.cell = cell; this.map = new Map(); }
  key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  add(x, z, r, top = Infinity) {
    const c = this.cell;
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++)
      for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
        const k = this.key(ix, iz);
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push({ x, z, r, top });
      }
  }
  // push a circle (pos.x, pos.z, radius) out of everything it overlaps; mutates pos.
  // feet: the bottom of whoever's moving, so a jump clears things lower than that
  resolve(pos, radius, feet = -Infinity) {
    const c = this.cell;
    const ix = Math.floor(pos.x / c), iz = Math.floor(pos.z / c);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.map.get(this.key(ix + dx, iz + dz));
        if (!list) continue;
        for (const o of list) {
          if (o.top < feet) continue;
          const ox = pos.x - o.x, oz = pos.z - o.z;
          const d = Math.hypot(ox, oz), min = o.r + radius;
          if (d < min && d > 1e-5) { pos.x = o.x + (ox / d) * min; pos.z = o.z + (oz / d) * min; }
        }
      }
    const lim = MAP.play, len = Math.hypot(pos.x, pos.z);
    if (len > lim) { pos.x *= lim / len; pos.z *= lim / len; }
  }

  // first point where the segment a→b hits a cylinder, as a fraction 0..1 of the way, or null
  hit(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
    const steps = Math.ceil(Math.sqrt(len2) / (this.cell * 0.5)) + 1;
    const seen = new Set();
    let best = null;
    for (let i = 0; i <= steps; i++) {
      const px = a.x + (dx * i) / steps, pz = a.z + (dz * i) / steps;
      const ix = Math.floor(px / this.cell), iz = Math.floor(pz / this.cell);
      for (let ox = -1; ox <= 1; ox++)
        for (let oz = -1; oz <= 1; oz++) {
          const k = this.key(ix + ox, iz + oz);
          if (seen.has(k)) continue;
          seen.add(k);
          for (const o of this.map.get(k) ?? []) {
            // ray/circle intersection in XZ
            const fx = a.x - o.x, fz = a.z - o.z;
            const B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - o.r * o.r;
            if (len2 < 1e-9) continue;
            const disc = B * B - 4 * len2 * C;
            if (disc < 0) continue;
            let t = (-B - Math.sqrt(disc)) / (2 * len2);
            if (C < 0) t = 0; // starts inside
            if (t < 0 || t > 1 || (best !== null && t >= best)) continue;
            if (a.y + (b.y - a.y) * t > o.top) continue; // passes over it
            best = t;
          }
        }
    }
    return best;
  }

  // true if something solid stands between a and b
  blocked(a, b) { return this.hit(a, b) !== null; }
}

function fallenLog(seed, barkMat) {
  const r = rng(seed);
  const L = r.range(3.5, 7), R = r.range(0.18, 0.3);
  const spine = [];
  for (let i = 0; i <= 10; i++) spine.push(new THREE.Vector3((i / 10 - 0.5) * L, Math.sin(i * 0.7) * 0.04, Math.sin(i * 0.5) * 0.08));
  const g = tube(spine, (t, a) => R * (1 - t * 0.35) * (1 + Math.sin(a * 5 + t * 9) * 0.05) * (t < 0.03 || t > 0.97 ? 0.75 : 1), 12, 3, 1.6);
  return { geometry: g, material: barkMat, length: L, radius: R };
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
  const props = await loadProps(manager, texLoader);

  // landmarks first, so the forest leaves room around them
  const sites = buildLandmarks(scene, height, colliders, props.rocks);
  const nearSite = (x, z, pad = 0) => sites.some((st) => Math.hypot(x - st.x, z - st.z) < st.clear + pad);

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
      if (!edge && nearSite(x, z, 1.5)) continue; // room around the landmarks
      const v = r.int(kit.variants.length), scale = r.range(0.85, 1.2), rot = r() * Math.PI * 2;
      treeMats[v].push(makeMatrix(x, height.heightAt(x, z), z, rot, scale));
      const radius = kit.variants[v].radius * scale;
      trees.push({ x, z, r: radius, variant: v, scale, rot, H: kit.variants[v].height * scale });
      colliders.add(x, z, radius + 0.08, height.heightAt(x, z) + kit.variants[v].height * scale);
    }
  }
  kit.variants.forEach((v, i) => {
    const bark = new Chunked(v.bark, kit.barkMat, treeMats[i], { maxDist: 52 });
    const tint = treeMats[i].map(() => new THREE.Color().setHSL(0.25 + r.range(-0.03, 0.03), 0.3, r.range(0.75, 1)));
    const needles = new Chunked(v.needles, kit.needleMat, treeMats[i], { colors: tint, maxDist: 52, shadow: quality === 'high' });
    add(bark); add(needles);
  });

  // --- props
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
    if (nearSite(x, z, -1)) continue;
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
    if (nearSite(x, z, -2)) continue;
    grassMats.push(makeMatrix(x, height.heightAt(x, z) - 0.02, z, rc() * 6.28, rc.range(0.7, 1.4)));
  }
  add(new Chunked(props.grass.geometry, props.grass.material, grassMats, { shadow: false, maxDist: 28, chunk: 12 }));

  // rocks
  const rockMats = props.rocks.map(() => []);
  for (let i = 0; i < 170; i++) {
    const [x, z] = randPoint();
    const v = r.int(props.rocks.length), s = r() < 0.15 ? r.range(0.9, 1.6) : r.range(0.25, 0.7);
    const bb = props.rocks[v].geometry.boundingBox;
    if (nearSite(x, z, 1)) continue;
    rockMats[v].push(makeMatrix(x, height.heightAt(x, z) - bb.min.y * s * 0.5 - 0.1 * s, z, r() * 6.28, s, r.range(-0.15, 0.15), r.range(-0.15, 0.15)));
    if (s > 0.55) colliders.add(x, z, Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.45 * s, height.heightAt(x, z) + bb.max.y * s * 0.7);
  }
  props.rocks.forEach((p, i) => add(new Chunked(p.geometry, p.material, rockMats[i], { maxDist: 45, chunk: 16 })));

  // stumps
  const stumpMats = [];
  for (let i = 0; i < 14; i++) {
    const [x, z] = randPoint();
    const s = r.range(0.8, 1.3);
    if (nearSite(x, z, 1)) continue;
    stumpMats.push(makeMatrix(x, height.heightAt(x, z) + 0.12 * s, z, r() * 6.28, s));
    colliders.add(x, z, 0.55 * s, height.heightAt(x, z) + 0.5 * s);
  }
  add(new Chunked(props.stumps[0].geometry, props.stumps[0].material, stumpMats, { maxDist: 40, chunk: 16 }));

  // fallen logs
  const logs = [0, 1, 2].map((i) => fallenLog(500 + i, kit.barkMat));
  const logMats = logs.map(() => []);
  for (let i = 0; i < 45; i++) {
    const [x, z] = randPoint();
    const v = r.int(logs.length), rot = r() * Math.PI * 2;
    const L = logs[v].length, R = logs[v].radius;
    if (nearSite(x, z, L / 2 + 1)) continue;
    const hx = Math.cos(rot) * L * 0.5, hz = -Math.sin(rot) * L * 0.5;
    const y = Math.min(height.heightAt(x - hx, z - hz), height.heightAt(x + hx, z + hz), height.heightAt(x, z));
    const slope = Math.atan2(height.heightAt(x + hx, z + hz) - height.heightAt(x - hx, z - hz), L);
    logMats[v].push(makeMatrix(x, y + R * 0.6, z, rot, 1, 0, slope));
    for (let t = -0.5; t <= 0.5; t += 0.35 / L) colliders.add(x + hx * 2 * t, z + hz * 2 * t, R + 0.05, y + R * 1.8);
  }
  logs.forEach((l, i) => add(new Chunked(l.geometry, l.material, logMats[i], { maxDist: 45 })));

  // --- the edge of the play area: a ring of old fence posts with a sagging rope between them,
  // just outside where you can walk, so the flashlight finds the limit before you bump into it
  // (pale weathered wood, and a pale rag on some posts, to catch the torch; some spans of rope
  // are missing; its own random stream, so nothing else moves)
  {
    const fr = rng(MAP.seed + 777);
    const count = Math.round((2 * Math.PI * MAP.play) / 3.2), radius = MAP.play + 0.35;
    const postGeo = new THREE.BoxGeometry(0.1, 1, 0.1);
    postGeo.translate(0, 0.5, 0);
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.95 });
    const posts = new THREE.InstancedMesh(postGeo, wood, count);
    const ragGeo = new THREE.PlaneGeometry(0.09, 0.42);
    ragGeo.translate(0, -0.21, 0.056); // hangs down the post's outside face from its top
    const rags = new THREE.InstancedMesh(ragGeo, new THREE.MeshStandardMaterial({ color: 0xd6d0c2, roughness: 1, side: THREE.DoubleSide }), count);
    let rag = 0;
    const tops = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      const a = ((i + fr.range(-0.2, 0.2)) / count) * Math.PI * 2;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius, h = fr.range(1.0, 1.35);
      q.setFromEuler(e.set(fr.range(-0.12, 0.12), -a, fr.range(-0.12, 0.12)));
      m.compose(new THREE.Vector3(x, height.heightAt(x, z) - 0.1, z), q, new THREE.Vector3(1, h, 1));
      posts.setMatrixAt(i, m);
      tops.push(new THREE.Vector3(0, 0.88, 0).applyMatrix4(m));
      if (fr() < 0.33) {
        // a rag tied near the top, swinging a little off straight
        const r = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.95, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(fr.range(-0.2, 0.2), 0, fr.range(-0.25, 0.25))), new THREE.Vector3(1, 1 / h, 1));
        rags.setMatrixAt(rag++, m.clone().multiply(r));
      }
    }
    posts.castShadow = posts.receiveShadow = true;
    rags.count = rag;
    const spans = [];
    for (let i = 0; i < count; i++) {
      if (fr() < 0.12) continue; // a broken span
      const a = tops[i], b = tops[(i + 1) % count];
      const mid = a.clone().lerp(b, 0.5); mid.y -= fr.range(0.12, 0.28); // the rope sags
      spans.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 6, 0.02, 5));
    }
    const rope = new THREE.Mesh(mergeGeometries(spans), new THREE.MeshStandardMaterial({ color: 0x9a8a70, roughness: 1 }));
    scene.add(posts, rags, rope);
  }

  return {
    name: 'forest',
    heightAt: height.heightAt, // (x, z): the forest has one ground, so the height asked from doesn't matter
    colliders,
    trees,
    landmarks: sites,
    // keep a point inside the play area (the fence), `margin` metres in
    clamp(p, margin = 1) {
      const len = Math.hypot(p.x, p.z), lim = MAP.play - margin;
      if (len > lim) { p.x *= lim / len; p.z *= lim / len; }
      return p;
    },
    // the map from above, for the minimap and the recap: R is how far it reaches from the centre;
    // draw(g, px, pz, k) draws it (px, pz turn world x, z into the canvas, k is pixels per metre)
    map: {
      R: MAP.play,
      draw(g, px, pz, k, big = false) {
        g.fillStyle = big ? 'rgba(8, 14, 20, 0.85)' : 'rgba(8, 14, 20, 0.78)';
        g.beginPath(); g.arc(px(0), pz(0), MAP.play * k + (big ? 0 : 2), 0, Math.PI * 2); g.fill();
        if (big) { g.strokeStyle = 'rgba(236, 232, 225, 0.18)'; g.lineWidth = 1; g.stroke(); }
        g.fillStyle = big ? 'rgba(236, 232, 225, 0.09)' : 'rgba(236, 232, 225, 0.11)';
        for (const t of trees) {
          if (Math.hypot(t.x, t.z) > MAP.play) continue;
          if (big) { g.beginPath(); g.arc(px(t.x), pz(t.z), Math.max(0.8, t.r * k * 1.6), 0, Math.PI * 2); g.fill(); } else g.fillRect(px(t.x) - 0.6, pz(t.z) - 0.6, 1.2, 1.2);
        }
        g.fillStyle = big ? 'rgba(236, 232, 225, 0.2)' : 'rgba(236, 232, 225, 0.32)';
        const s = big ? 6 : 5;
        for (const l of sites) g.fillRect(px(l.x) - s / 2, pz(l.z) - s / 2, s, s);
        if (!big) {
          // the edge, where the fence is
          g.strokeStyle = 'rgba(255, 70, 85, 0.65)';
          g.lineWidth = 1.5;
          g.beginPath(); g.arc(px(0), pz(0), MAP.play * k, 0, Math.PI * 2); g.stroke();
        }
      },
    },
    update(dt, camPos, time) {
      props.grass.uTime.value = time;
      for (const u of updaters) u.update(camPos);
    },

    // Choose where the round's pages go (see PAGE_SPOTS), from the round's seed so both screens
    // agree: a few on landmarks, the rest on trees, spread out, away from `avoid` (the seeker's
    // start). Returns [{ pos, face, n }]: where, which way the page faces, its number.
    pickPages(seed, avoid = null) {
      const pr = rng(seed);
      const chosen = [];
      let apart = PAGE_SPOTS.apart;
      const fits = (pos) => (!avoid || Math.hypot(pos.x - avoid.x, pos.z - avoid.z) > PAGE_SPOTS.fromSeeker)
        && chosen.every((c) => Math.hypot(pos.x - c.pos.x, pos.z - c.pos.z) > apart);
      // landmarks: in a shuffled order, the first that fit
      const order = sites.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = pr.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
      for (const si of order) {
        if (chosen.length >= Math.min(PAGE_SPOTS.landmarks, PAGES)) break;
        const spot = sites[si].spots[pr.int(sites[si].spots.length)];
        if (fits(spot.pos)) chosen.push({ pos: spot.pos.clone(), face: spot.face });
      }
      // trees: a random trunk and side, if the page would face open ground; when a crowded map
      // makes that hard, the spacing is relaxed a little at a time
      const UP = new THREE.Vector3(0, 1, 0);
      for (let tries = 0; chosen.length < PAGES && tries < 4000; tries++) {
        if (tries && tries % 400 === 0) apart *= 0.85;
        const t = trees[pr.int(trees.length)];
        if (Math.hypot(t.x, t.z) > MAP.play - 6 || nearSite(t.x, t.z, 2)) continue;
        const ground = height.heightAt(t.x, t.z);
        const { c, r: rr } = kit.variants[t.variant].trunk(PAGE_SPOTS.height / t.scale);
        const centre = c.multiplyScalar(t.scale).applyAxisAngle(UP, t.rot).add(new THREE.Vector3(t.x, ground, t.z));
        const ang = pr() * Math.PI * 2, dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
        const pos = centre.clone().addScaledVector(dir, rr * t.scale * 1.04 + 0.015);
        if (!fits(pos)) continue;
        // something to stand on in front of it, and nothing right in the way
        const front = pos.clone().addScaledVector(dir, 2.6);
        if (colliders.blocked(pos.clone().addScaledVector(dir, 0.35), front)) continue;
        if (Math.abs(height.heightAt(front.x, front.z) - ground) > 1.2) continue;
        chosen.push({ pos, face: ang });
      }
      // in a random order, so page 1 isn't always on a landmark
      for (let i = chosen.length - 1; i > 0; i--) { const j = pr.int(i + 1); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
      return chosen.map((c, i) => ({ ...c, n: i + 1 }));
    },

    // pin page meshes where pickPages chose; returns [{ mesh, pos, n }]
    placePages(chosen) { return placePages(scene, chosen); },

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

