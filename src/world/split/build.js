// Builds what you see of Split from the plan (plan.js) and the grid (grid.js): floors, walls,
// roofs, facades, interiors, stairs, railings, cover, poles and cables, lamps and lanterns, signs,
// props, and the far-off towers. Everything is merged by material, so the city is a few dozen
// draw calls; the props are instanced.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rng } from '../noise.js';
import { BOUNDS, AREAS, STAIRS, ROPES, COVER, LAMPS } from './plan.js';
import * as look from './look.js';

// --- geometry helpers ---------------------------------------------------------------------------

// A frame on the ground: origin (ox, oz), R the way s runs, N the way d runs (out of a wall).
// Boxes and cards are given in s (along), y (up, world height) and d (out); u0 and w0 keep
// textures continuous from one wall to the next (UVs in world metres).
const frame = (ox, oz, rx, rz, nx, nz) => ({ ox, oz, rx, rz, nx, nz, u0: ox * rx + oz * rz, w0: ox * nx + oz * nz });
const WORLD = frame(0, 0, 1, 0, 0, 1); // s = x, d = z

function geometry(pos, nor, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// a box in a frame; UVs in metres / sc; skip: faces to leave out (f b r l t d: front back right
// left top down)
function box(F, s0, s1, y0, y1, d0, d1, sc = 1, skip = '') {
  const pos = [], nor = [], uv = [], idx = [];
  const P = (s, y, d) => [F.ox + F.rx * s + F.nx * d, y, F.oz + F.rz * s + F.nz * d];
  const face = (corners, n, uvs) => {
    const b = pos.length / 3;
    corners.forEach((c, i) => { pos.push(...P(...c)); nor.push(...n); uv.push(uvs[i][0] / sc, uvs[i][1] / sc); });
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const N = [F.nx, 0, F.nz], R = [F.rx, 0, F.rz];
  const u0 = s0 + F.u0, u1 = s1 + F.u0, w0 = d0 + F.w0, w1 = d1 + F.w0;
  if (!skip.includes('f')) face([[s0, y0, d1], [s1, y0, d1], [s1, y1, d1], [s0, y1, d1]], N, [[u0, y0], [u1, y0], [u1, y1], [u0, y1]]);
  if (!skip.includes('b')) face([[s1, y0, d0], [s0, y0, d0], [s0, y1, d0], [s1, y1, d0]], N.map((v) => -v), [[-u1, y0], [-u0, y0], [-u0, y1], [-u1, y1]]);
  if (!skip.includes('r')) face([[s1, y0, d1], [s1, y0, d0], [s1, y1, d0], [s1, y1, d1]], R, [[-w1, y0], [-w0, y0], [-w0, y1], [-w1, y1]]);
  if (!skip.includes('l')) face([[s0, y0, d0], [s0, y0, d1], [s0, y1, d1], [s0, y1, d0]], R.map((v) => -v), [[w0, y0], [w1, y0], [w1, y1], [w0, y1]]);
  if (!skip.includes('t')) face([[s0, y1, d1], [s1, y1, d1], [s1, y1, d0], [s0, y1, d0]], [0, 1, 0], [[u0, -w1], [u1, -w1], [u1, -w0], [u0, -w0]]);
  if (!skip.includes('d')) face([[s0, y0, d0], [s1, y0, d0], [s1, y0, d1], [s0, y0, d1]], [0, -1, 0], [[u0, w0], [u1, w0], [u1, w1], [u0, w1]]);
  return geometry(pos, nor, uv, idx);
}
// a flat card facing N at d, its texture stretched over it once (signs, windows)
function card(F, s0, s1, y0, y1, d) {
  const P = (s, y) => [F.ox + F.rx * s + F.nx * d, y, F.oz + F.rz * s + F.nz * d];
  return geometry([...P(s0, y0), ...P(s1, y0), ...P(s1, y1), ...P(s0, y1)], [F.nx, 0, F.nz, F.nx, 0, F.nz, F.nx, 0, F.nz, F.nx, 0, F.nz], [0, 0, 1, 0, 1, 1, 0, 1], [0, 1, 2, 0, 2, 3]);
}
// a quad from four corners (a b c d counter-clockwise seen from the front), UVs in metres
function quad4(a, b, c, d, sc, uvs) {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
  return geometry([...a.toArray(), ...b.toArray(), ...c.toArray(), ...d.toArray()], [...n.toArray(), ...n.toArray(), ...n.toArray(), ...n.toArray()], uvs.flat().map((v) => v / sc), [0, 1, 2, 0, 2, 3]);
}
// a cylinder between two points
function rod(a, b, r0, r1 = r0, seg = 8) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

// (an un-indexed geometry, given an index, so it merges with the others)
function indexed(g) {
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  return g;
}
// a concrete Jersey barrier, `len` long along x, standing on y = 0, centred
function jersey(len, w, h) {
  const s = new THREE.Shape([[-0.5, 0], [0.5, 0], [0.5, 0.1], [0.2, 0.36], [0.16, 1], [-0.16, 1], [-0.2, 0.36], [-0.5, 0.1]].map(([x, y]) => new THREE.Vector2(x * w, y * h)));
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  g.rotateY(Math.PI / 2);
  return indexed(g);
}

// geometries collected by material, merged into one mesh each at the end
class Batch {
  constructor() { this.parts = new Map(); }
  add(mat, geo) { if (!this.parts.has(mat)) this.parts.set(mat, []); this.parts.get(mat).push(geo); }
  meshes(group) {
    for (const [mat, geos] of this.parts) {
      const g = mergeGeometries(geos);
      geos.forEach((x) => x.dispose());
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = !mat.emissiveMap && !mat.transparent;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

// --- props: scanned models, instanced ------------------------------------------------------

// one model (or the parts of it `pick` keeps: a file often holds a clean and a worn variant side
// by side), its pivot at the middle of its base; size: its bounding box
async function loadKit(loader, id, pick = () => true) {
  const gltf = await loader.loadAsync(`assets/models/${id}/${id}.gltf`);
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  gltf.scene.traverse((o) => { if (o.isMesh && pick(`${o.name} ${o.parent?.name ?? ''}`)) parts.push(o); });
  const bb = new THREE.Box3();
  parts.forEach((o) => bb.expandByObject(o));
  const shift = new THREE.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  return { size: bb.getSize(new THREE.Vector3()), parts: parts.map((o) => ({ geometry: o.geometry, material: o.material, matrix: shift.clone().multiply(o.matrixWorld) })), placed: [] };
}
const KITS = {
  aircon: ['exterior_aircon_unit', (n) => !n.includes('rusted')],
  shutter: ['rollershutter_door', (n) => !n.includes('graffiti')],
  shutterTag: ['rollershutter_door', (n) => n.includes('graffiti')],
  can: ['metal_trash_can', (n) => !n.includes('rust')],
  bag: ['trashbag'],
  utility: ['utility_box_01'],
  crate: ['wooden_crate_02'],
  plastic: ['plastic_crate_01'],
  carton: ['cardboard_box_01'],
  barrel: ['Barrel_01'],
  planter: ['planter_box_01'],
  phone: ['korean_public_payphone_01'],
  camera: ['security_camera_01'],
};

// --- the city ------------------------------------------------------------------------------------

export async function buildCity(grid, mats, manager, quality) {
  const group = new THREE.Group();
  const batch = new Batch();
  const loader = new GLTFLoader(manager);
  const kits = Object.fromEntries(await Promise.all(Object.entries(KITS).map(async ([k, [id, pick]]) => [k, await loadKit(loader, id, pick)])));
  const lights = []; // { pos, color, intensity, distance, priority }
  const R0 = rng(4242);
  const hash = (...v) => rng(v.reduce((a, b) => Math.imul(a ^ Math.round(b * 10), 2654435761) >>> 0, 77))();
  const M = mats;
  const wallMat = { plaster: M.stucco, facade: M.facade, concrete: M.concrete };

  // place a prop: in a frame at (s, y, d), its front (+z in the file) facing out along N
  const place = (kit, F, s, y, d, { turn = 0, scale = [1, 1, 1] } = {}) => {
    const p = new THREE.Vector3(F.ox + F.rx * s + F.nx * d, y, F.oz + F.rz * s + F.nz * d);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(F.nx, F.nz) + turn);
    kits[kit].placed.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(...scale)));
    return p;
  };
  // and make it solid (anything bigger than a bag): raise the floor under its footprint
  const solid = (x, z, hw, hd, h) => grid.each(x - hw, z - hd, x + hw, z + hd, (c) => { if (grid.walkable(c) && !grid.stair[c]) grid.floor[c] += h; });
  const solidAt = (kit, F, s, d, scale = [1, 1, 1]) => {
    const sz = kits[kit].size, x = F.ox + F.rx * s + F.nx * d, z = F.oz + F.rz * s + F.nz * d;
    const w = sz.x * scale[0] / 2, dd = sz.z * scale[2] / 2, along = Math.abs(F.rx) > 0.5;
    solid(x, z, along ? w : dd, along ? dd : w, sz.y * scale[1]);
  };

  // --- the 1 m plan of the city: each cell an area (index) or building (-1) -------------------
  const X0 = BOUNDS.x0, Z0 = BOUNDS.z0, VX = BOUNDS.x1 - X0, VZ = BOUNDS.z1 - Z0;
  const vc = new Int16Array(VX * VZ), vstair = new Uint8Array(VX * VZ);
  for (let k = 0; k < VZ; k++) for (let i = 0; i < VX; i++) {
    const c = grid.at(X0 + i + 0.5, Z0 + k + 0.5);
    vc[k * VX + i] = grid.area[c];
    vstair[k * VX + i] = grid.stair[c];
  }
  const A = AREAS.map(([name, x0, z0, x1, z1, floor, kind, ceil]) => ({
    name, x0, z0, x1, z1, floor, kind, ceil: ceil ?? Infinity,
    indoor: ceil !== undefined, roofTop: ceil === undefined ? Infinity : ceil + (kind === 'walkway' ? 0.8 : 2.6),
    outdoorish: ['street', 'road', 'site'].includes(kind),
  }));

  // buildings: the building cells in rectangles (at most 12 m a side, so heights vary), each
  // with a height (taller towards the edge of the map) and a style
  const rect = new Int32Array(VX * VZ).fill(-1), rects = [];
  for (let k = 0; k < VZ; k++) for (let i = 0; i < VX; i++) {
    if (vc[k * VX + i] >= 0 || rect[k * VX + i] >= 0) continue;
    let w = 1; while (i + w < VX && w < 12 && vc[k * VX + i + w] < 0 && rect[k * VX + i + w] < 0) w++;
    let h = 1;
    grow: while (k + h < VZ && h < 12) { for (let j = 0; j < w; j++) if (vc[(k + h) * VX + i + j] >= 0 || rect[(k + h) * VX + i + j] >= 0) break grow; h++; }
    const id = rects.length;
    for (let kk = k; kk < k + h; kk++) for (let ii = i; ii < i + w; ii++) rect[kk * VX + ii] = id;
    rects.push({ x0: X0 + i, z0: Z0 + k, x1: X0 + i + w, z1: Z0 + k + h, i, k, w, h });
  }
  for (const r of rects) {
    let base = -1;
    for (let kk = r.k - 1; kk <= r.k + r.h; kk++) for (let ii = r.i - 1; ii <= r.i + r.w; ii++) {
      if (ii < 0 || kk < 0 || ii >= VX || kk >= VZ) continue;
      const a = vc[kk * VX + ii];
      if (a >= 0) base = Math.max(base, A[a].indoor ? A[a].roofTop - 3 : A[a].floor);
    }
    const edge = r.i === 0 || r.k === 0 || r.i + r.w === VX || r.k + r.h === VZ;
    const h1 = hash(r.x0, r.z0), h2 = hash(r.z0, r.x0, 3);
    r.H = Math.round(2 * (Math.max(base, 0) + 7 + h1 * 6 + (edge ? 5 + h2 * 9 : 0))) / 2;
    r.style = h2 < 0.5 ? 'plaster' : h2 < 0.8 ? 'facade' : 'concrete';
    r.gable = r.style === 'plaster' && Math.min(r.w, r.h) <= 11 && !edge && base >= 0;
  }

  // what's solid and what's open in a column of the 1 m plan (for the walls between columns)
  const cellAt = (i, k) => (i < 0 || k < 0 || i >= VX || k >= VZ ? null : k * VX + i);
  const open = (c) => {
    const a = vc[c];
    if (a < 0) return [[rects[rect[c]].H, Infinity]];
    return A[a].indoor ? [[A[a].floor, A[a].ceil], [A[a].roofTop, Infinity]] : [[A[a].floor, Infinity]];
  };
  const solidOf = (c) => {
    const a = vc[c];
    if (a < 0) return [[-1, rects[rect[c]].H, 'b']];
    return A[a].indoor ? [[-1, A[a].floor, 'col'], [A[a].ceil, A[a].roofTop, 'room']] : [[-1, A[a].floor, 'col']];
  };

  // --- walls: every face between an open column and a solid one, merged along each line -------
  const runs = [];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // the way the face looks (from the solid side to the open side)
  for (const [nx, nz] of DIRS) {
    // walk each line of faces: the open cell is at (i, k), the solid one at (i - nx, k - nz)
    const lines = nx ? VX : VZ, along = nx ? VZ : VX;
    for (let l = 0; l < lines; l++) {
      // a spot can have several faces (a room's inner wall, and the wall above its roof): each
      // kind of face runs on along the line for as long as it lasts
      const active = new Map();
      for (let t = 0; t <= along; t++) {
        const here = new Map();
        if (t < along) {
          const i = nx ? l : t, k = nx ? t : l;
          const ca = cellAt(i, k), cb = cellAt(i - nx, k - nz);
          if (ca !== null && cb !== null) {
            for (const [a0, a1] of open(ca)) for (const [b0, b1, kind] of solidOf(cb)) {
              const y0 = Math.max(a0, b0), y1 = Math.min(a1, b1);
              if (y1 - y0 <= 0.01) continue;
              const s = { y0, y1, kind, a: vc[ca], b: vc[cb] < 0 ? `r${rect[cb]}` : `a${vc[cb]}` };
              here.set(`${y0}|${y1}|${kind}|${s.a}|${s.b}`, s);
            }
          }
        }
        for (const [key, run] of active) if (!here.has(key)) { runs.push(run); active.delete(key); }
        for (const [key, s] of here) {
          if (active.has(key)) active.get(key).t1 = t + 1;
          else active.set(key, { key, ...s, nx, nz, l, t0: t, t1: t + 1 });
        }
      }
    }
  }
  // each run as a frame: s runs to the right as you look at the wall, d comes out of it
  for (const r of runs) {
    const lineX = X0 + r.l, lineZ = Z0 + r.l; // the face lies on the boundary on the open cell's near side
    const px = r.nx ? (r.nx > 0 ? lineX : lineX + 1) : null, pz = r.nz ? (r.nz > 0 ? lineZ : lineZ + 1) : null;
    const rx = r.nz, rz = -r.nx; // right = (nz, -nx)
    const a = r.nx ? [px, Z0 + r.t0] : [X0 + r.t0, pz], b = r.nx ? [px, Z0 + r.t1] : [X0 + r.t1, pz];
    const start = (b[0] - a[0]) * rx + (b[1] - a[1]) * rz > 0 ? a : b;
    r.F = frame(start[0], start[1], rx, rz, r.nx, r.nz);
    r.L = r.t1 - r.t0;
    r.area = r.a >= 0 ? A[r.a] : null;
    r.rect = r.b[0] === 'r' ? rects[+r.b.slice(1)] : null;
  }

  // --- floors, ceilings and roofs over the areas ----------------------------------------------
  const floorMat = (a) => ({
    street: M.pavers, road: M.asphalt, site: M.concreteFloor, heaven: M.hinoki, walkway: M.hinoki,
    sewer: M.sewerFloor, vent: M.plate, indoor: a.name === 'Mail' ? M.tileFloor : M.concreteFloor,
  })[a.kind];
  const ceilMat = (a) => ({ walkway: M.cedar, sewer: M.concrete, vent: M.plate })[a.kind] ?? (a.name === 'Mail' ? M.plaster : M.concrete);
  // rectangles of cells of the same area
  const done = new Uint8Array(VX * VZ);
  for (let k = 0; k < VZ; k++) for (let i = 0; i < VX; i++) {
    const a = vc[k * VX + i];
    if (a < 0 || done[k * VX + i]) continue;
    let w = 1; while (i + w < VX && vc[k * VX + i + w] === a && !done[k * VX + i + w]) w++;
    let h = 1;
    grow: while (k + h < VZ) { for (let j = 0; j < w; j++) if (vc[(k + h) * VX + i + j] !== a || done[(k + h) * VX + i + j]) break grow; h++; }
    for (let kk = k; kk < k + h; kk++) for (let ii = i; ii < i + w; ii++) done[kk * VX + ii] = 1;
    const x0 = X0 + i, z0 = Z0 + k, x1 = x0 + w, z1 = z0 + h, ar = A[a], fm = floorMat(ar);
    batch.add(fm, box(WORLD, x0, x1, ar.floor - 0.2, ar.floor, z0, z1, fm.userData.scale, 'fbrld'));
    if (ar.indoor) {
      const cm = ceilMat(ar);
      batch.add(cm, box(WORLD, x0, x1, ar.ceil, ar.ceil + 0.2, z0, z1, cm.userData.scale, 'fbrlt'));
      batch.add(M.concrete, box(WORLD, x0, x1, ar.roofTop - 0.2, ar.roofTop, z0, z1, 3, 'fbrld'));
    }
  }

  // --- building roofs ------------------------------------------------------------------------
  for (const r of rects) {
    if (!r.gable) {
      // flat roof with a low parapet; rooftop clutter: a water tank, an air-con unit
      batch.add(M.concrete, box(WORLD, r.x0, r.x1, r.H - 0.2, r.H, r.z0, r.z1, 3, 'fbrld'));
      const P = 0.5;
      for (const [s0, s1, d0, d1] of [[r.x0, r.x1, r.z0, r.z0 + 0.25], [r.x0, r.x1, r.z1 - 0.25, r.z1], [r.x0, r.x0 + 0.25, r.z0, r.z1], [r.x1 - 0.25, r.x1, r.z0, r.z1]]) {
        batch.add(M.concrete, box(WORLD, s0, s1, r.H, r.H + P, d0, d1, 3, 'd'));
      }
      if (hash(r.x0, r.z1) < 0.5 && r.w > 4 && r.h > 4) {
        const cx = (r.x0 + r.x1) / 2 + 1, cz = (r.z0 + r.z1) / 2;
        batch.add(M.steel, rod(new THREE.Vector3(cx, r.H, cz), new THREE.Vector3(cx, r.H + 1.6, cz), 0.8, 0.8, 14));
        for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) batch.add(M.black, rod(new THREE.Vector3(cx + dx, r.H - 0.4, cz + dz), new THREE.Vector3(cx + dx, r.H, cz + dz), 0.05));
      }
      if (hash(r.z0, r.x1) < 0.3 && r.w > 3 && r.h > 3) place('aircon', WORLD, r.x0 + 1.4, r.H, r.z0 + 1.2, { turn: Math.PI });
      continue;
    }
    // gable roof: tiled slopes from the eaves to a ridge along the longer side, the gable ends in
    // the wall's own finish, fascia boards along the eaves, and a ridge cap
    const alongX = r.w >= r.h, ov = 0.55;
    const span = alongX ? r.h : r.w, rise = Math.min(2.6, span * 0.32);
    const H = r.H, top = H + rise;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    if (alongX) {
      const xa = r.x0 - ov, xb = r.x1 + ov, za = r.z0 - ov, zb = r.z1 + ov, zc = (r.z0 + r.z1) / 2, sl = Math.hypot(zc - za, rise);
      batch.add(M.roof, quad4(V(xa, H, za), V(xa, top, zc), V(xb, top, zc), V(xb, H, za), M.roof.userData.scale, [[0, 0], [0, sl], [xb - xa, sl], [xb - xa, 0]].map(([u, v]) => [v, u])));
      batch.add(M.roof, quad4(V(xb, H, zb), V(xb, top, zc), V(xa, top, zc), V(xa, H, zb), M.roof.userData.scale, [[0, 0], [0, sl], [xb - xa, sl], [xb - xa, 0]].map(([u, v]) => [v, u])));
      batch.add(M.darkWood, quad4(V(xa, H, za), V(xb, H, za), V(xb, top, zc), V(xa, top, zc), 1.6, [[0, 0], [xb - xa, 0], [xb - xa, sl], [0, sl]]));
      batch.add(M.darkWood, quad4(V(xb, H, zb), V(xa, H, zb), V(xa, top, zc), V(xb, top, zc), 1.6, [[0, 0], [xb - xa, 0], [xb - xa, sl], [0, sl]]));
      const wm = wallMat[r.style];
      batch.add(wm, quad4(V(r.x0, H, r.z1), V(r.x0, H, r.z0), V(r.x0, top - 0.05, zc), V(r.x0, top - 0.05, zc), 3, [[r.z1, H], [r.z0, H], [zc, top], [zc, top]]));
      batch.add(wm, quad4(V(r.x1, H, r.z0), V(r.x1, H, r.z1), V(r.x1, top - 0.05, zc), V(r.x1, top - 0.05, zc), 3, [[r.z0, H], [r.z1, H], [zc, top], [zc, top]]));
      batch.add(M.darkWood, box(WORLD, xa, xb, H - 0.18, H + 0.02, za - 0.04, za + 0.08, 1.6));
      batch.add(M.darkWood, box(WORLD, xa, xb, H - 0.18, H + 0.02, zb - 0.08, zb + 0.04, 1.6));
      batch.add(M.black, box(WORLD, xa, xb, top - 0.05, top + 0.18, zc - 0.16, zc + 0.16, 1));
    } else {
      const za = r.z0 - ov, zb = r.z1 + ov, xa = r.x0 - ov, xb = r.x1 + ov, xc = (r.x0 + r.x1) / 2, sl = Math.hypot(xc - xa, rise);
      batch.add(M.roof, quad4(V(xa, H, zb), V(xc, top, zb), V(xc, top, za), V(xa, H, za), M.roof.userData.scale, [[0, 0], [0, sl], [zb - za, sl], [zb - za, 0]].map(([u, v]) => [v, u])));
      batch.add(M.roof, quad4(V(xb, H, za), V(xc, top, za), V(xc, top, zb), V(xb, H, zb), M.roof.userData.scale, [[0, 0], [0, sl], [zb - za, sl], [zb - za, 0]].map(([u, v]) => [v, u])));
      batch.add(M.darkWood, quad4(V(xa, H, za), V(xc, top, za), V(xc, top, zb), V(xa, H, zb), 1.6, [[0, 0], [0, sl], [zb - za, sl], [zb - za, 0]]));
      batch.add(M.darkWood, quad4(V(xb, H, zb), V(xc, top, zb), V(xc, top, za), V(xb, H, za), 1.6, [[0, 0], [0, sl], [zb - za, sl], [zb - za, 0]]));
      const wm = wallMat[r.style];
      batch.add(wm, quad4(V(r.x0, H, r.z0), V(r.x1, H, r.z0), V(xc, top - 0.05, r.z0), V(xc, top - 0.05, r.z0), 3, [[r.x0, H], [r.x1, H], [xc, top], [xc, top]]));
      batch.add(wm, quad4(V(r.x1, H, r.z1), V(r.x0, H, r.z1), V(xc, top - 0.05, r.z1), V(xc, top - 0.05, r.z1), 3, [[r.x1, H], [r.x0, H], [xc, top], [xc, top]]));
      batch.add(M.darkWood, box(WORLD, xa - 0.04, xa + 0.08, H - 0.18, H + 0.02, za, zb, 1.6));
      batch.add(M.darkWood, box(WORLD, xb - 0.08, xb + 0.04, H - 0.18, H + 0.02, za, zb, 1.6));
      batch.add(M.black, box(WORLD, xc - 0.16, xc + 0.16, top - 0.05, top + 0.18, za, zb, 1));
    }
  }

  // --- textures drawn in code, a few of each, shared ------------------------------------------
  const pick = (list, h) => list[Math.floor(h * list.length) % list.length];
  const shopWindows = [0, 1, 2, 3, 4, 5].map((i) => look.glowing(look.shopWindow(100 + i), 1.1));
  const shopSigns = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => look.glowing(look.shopSign(200 + i), 1.3));
  const litWindows = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => look.glowing(look.litWindow(300 + i), 0.9));
  const neon = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => look.glowing(look.neonSign(400 + i), 2.2));
  const lanternMats = [0, 1, 2, 3].map((i) => look.glowing(look.lanternPaper(500 + i), 1.5));
  const vendings = [0, 1, 2].map((i) => look.glowing(look.vendingFront(600 + i), 1.4));
  const vendBody = [0xc8202a, 0xe8e4dc, 0x1f4fa0].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.3 }));
  const shojiMat = look.glowing(look.shoji(), 0.75);
  const warmLamp = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffc98a, emissiveIntensity: 0.42, roughness: 0.4 });
  const tubeLamp = new THREE.MeshStandardMaterial({ color: 0xf2f8ff, emissive: 0xdfeaff, emissiveIntensity: 0.5 });
  const lanternGeo = new THREE.LatheGeometry([[0.04, -0.22], [0.15, -0.17], [0.19, -0.06], [0.19, 0.06], [0.15, 0.17], [0.04, 0.22]].map(([x, y]) => new THREE.Vector2(x, y)), 16);

  // a paper lantern hanging at p (with its black caps), and maybe a little light of its own
  const lantern = (p, h) => {
    const g = lanternGeo.clone(); g.translate(p.x, p.y, p.z);
    batch.add(pick(lanternMats, h), g);
    batch.add(M.black, rod(new THREE.Vector3(p.x, p.y + 0.2, p.z), new THREE.Vector3(p.x, p.y + 0.26, p.z), 0.07));
    batch.add(M.black, rod(new THREE.Vector3(p.x, p.y - 0.26, p.z), new THREE.Vector3(p.x, p.y - 0.2, p.z), 0.07));
    batch.add(M.cable, rod(new THREE.Vector3(p.x, p.y + 0.26, p.z), new THREE.Vector3(p.x, p.y + 0.6, p.z), 0.008, 0.008, 4));
  };

  // --- facades, interiors and the rest of the walls ------------------------------------------
  for (const r of runs) {
    const { F, L, y0, y1, area: ar } = r;
    if (L < 0.5) continue;
    const h = (n = 0) => hash(F.ox, F.oz, r.nx * 3 + r.nz, n);
    // what the wall is made of
    let mat = M.concrete;
    if (r.kind === 'b') mat = ar && ar.indoor && y1 <= ar.ceil + 0.01 ? ({ walkway: M.plaster, sewer: M.concrete, vent: M.plate })[ar.kind] ?? (ar.name === 'Mail' ? M.plaster : M.concrete) : wallMat[r.rect.style];
    else if (r.kind === 'room') mat = ar && ar.indoor && y1 <= ar.ceil + 0.01 ? M.plaster : M.stucco;
    batch.add(mat, box(F, 0, L, y0, y1, -0.3, 0, mat.userData.scale, 'brltd'));

    const f = ar ? ar.floor : y0;
    const ctx = !ar ? 'over' : ar.indoor && y0 >= ar.ceil - 0.01 ? 'over' : ar.indoor ? 'inside' : r.kind === 'col' ? 'column' : 'facade';

    if (ctx === 'column') {
      // the side of the upper level: concrete with a stone coping along its top
      batch.add(M.concrete, box(F, 0, L, y1 - 0.15, y1 + 0.04, -0.05, 0.1, 3, 'b'));
      continue;
    }
    if (ctx === 'inside') {
      if (ar.kind === 'walkway') {
        // the screens: shoji panels all along, under a dark beam
        for (let s = 0.2; s + 1.0 <= L - 0.1; s += 1.2) batch.add(shojiMat, card(F, s, s + 1.0, f + 0.25, f + 2.45, 0.02));
        batch.add(M.darkWood, box(F, 0, L, f + 2.45, f + 2.65, 0, 0.08, 1.6));
        batch.add(M.darkWood, box(F, 0, L, f, f + 0.25, 0, 0.05, 1.6));
      } else if (ar.kind === 'sewer') {
        // pipes along the walls, a caged lamp now and then
        batch.add(M.steel, rod(new THREE.Vector3(...pt(F, 0, f + 2.0, 0.22)), new THREE.Vector3(...pt(F, L, f + 2.0, 0.22)), 0.13));
        batch.add(M.black, rod(new THREE.Vector3(...pt(F, 0, f + 1.55, 0.16)), new THREE.Vector3(...pt(F, L, f + 1.55, 0.16)), 0.06));
        for (let s = 2; s < L - 1; s += 7) batch.add(warmLamp, box(F, s - 0.12, s + 0.12, f + 2.25, f + 2.4, 0, 0.18, 1));
      } else if (ar.kind === 'indoor' && ar.name === 'Mail') {
        // wood wainscot, the wall of post boxes, a counter
        batch.add(M.cedar, box(F, 0, L, f, f + 1.05, 0, 0.03, 1.6, 'b'));
        batch.add(M.darkWood, box(F, 0, L, f + 1.05, f + 1.12, 0, 0.05, 1.6));
        if (L >= 6 && h(1) < 0.6) {
          const s0 = L / 2 - 2;
          batch.add(M.darkWood, box(F, s0, s0 + 4, f + 1.12, f + 2.6, 0, 0.35, 1.6, 'b'));
          for (let row = 0; row < 5; row++) for (let col = 0; col < 8; col++) batch.add(M.steel, card(F, s0 + 0.08 + col * 0.49, s0 + 0.5 + col * 0.49, f + 1.18 + row * 0.28, f + 1.42 + row * 0.28, 0.36));
        }
      } else if (ar.kind === 'indoor') {
        // the garage: shutters on the walls, tube lights
        for (let s = 1; s + 3 <= L - 0.5; s += 4.5) batch.add(M.shutter, box(F, s, s + 3, f, f + 2.8, 0, 0.04, 1.6, 'b'));
      }
      continue;
    }
    if (ctx === 'over') {
      // a wall above a lower roof: just its windows
      windowsOn(F, L, y0 + 0.6, y1, r, h);
      continue;
    }

    // ctx 'facade': a building front on a street (or the room front above a doorway)
    if (r.kind === 'room') { batch.add(M.darkWood, box(F, 0, L, y0 - 0.02, y0 + 0.22, 0, 0.12, 1.6)); continue; }
    const style = r.rect.style, street = ar.outdoorish;
    // plinth and the first-floor ledge
    batch.add(M.concrete, box(F, 0, L, f, f + 0.32, 0, 0.05, 3, 'b'));
    if (y1 - f > 3.6) batch.add(style === 'plaster' ? M.darkWood : M.concrete, box(F, 0, L, f + 3.15, f + 3.33, 0, 0.14, style === 'plaster' ? 1.6 : 3));
    // the ground floor: bays of shutters, shops, doors and plain wall (with a machine or clutter)
    if (y1 - f > 3.4 && L >= 1.6) {
      const n = Math.max(1, Math.round(L / 3.4)), bw = L / n;
      for (let b = 0; b < n; b++) {
        const s0 = b * bw, s1 = s0 + bw, sm = (s0 + s1) / 2, hb = h(10 + b);
        const kind = ar.kind === 'heaven' ? 'shoji' : !street && ar.floor > 1 ? (hb < 0.5 ? 'door' : 'plain') : hb < 0.3 ? 'shutter' : hb < 0.58 ? 'shop' : hb < 0.72 ? 'door' : 'plain';
        if (kind === 'shoji') {
          batch.add(shojiMat, card(F, s0 + 0.15, s1 - 0.15, f + 0.3, f + 2.6, 0.03));
          batch.add(M.darkWood, box(F, s0, s1, f + 2.6, f + 2.8, 0, 0.08, 1.6));
        } else if (kind === 'shutter' && bw >= 1.8) {
          const sw = Math.min(bw - 0.5, 3.2), sc = [sw / kits.shutter.size.x, 2.7 / kits.shutter.size.y, 1];
          place(hb < 0.1 ? 'shutterTag' : 'shutter', F, sm, f, kits.shutter.size.z / 2, { scale: sc });
          batch.add(M.black, box(F, sm - sw / 2 - 0.12, sm - sw / 2, f, f + 2.85, 0, 0.12, 1));
          batch.add(M.black, box(F, sm + sw / 2, sm + sw / 2 + 0.12, f, f + 2.85, 0, 0.12, 1));
        } else if (kind === 'shop' && bw >= 1.8) {
          // a lit window under a sign board, an awning, lanterns either side
          batch.add(pick(shopWindows, hb * 7), card(F, s0 + 0.35, s1 - 0.35, f + 0.45, f + 2.35, 0.04));
          for (const [a, b2] of [[s0 + 0.25, s0 + 0.35], [s1 - 0.35, s1 - 0.25]]) batch.add(M.darkWood, box(F, a, b2, f, f + 2.45, 0, 0.1, 1.6));
          batch.add(M.darkWood, box(F, s0 + 0.25, s1 - 0.25, f + 2.35, f + 2.45, 0, 0.1, 1.6));
          batch.add(M.darkWood, box(F, s0 + 0.25, s1 - 0.25, f + 0.35, f + 0.45, 0, 0.14, 1.6));
          batch.add(M.black, box(F, s0 + 0.2, s1 - 0.2, f + 2.5, f + 3.08, 0, 0.1, 1));
          batch.add(pick(shopSigns, hb * 11), card(F, s0 + 0.28, s1 - 0.28, f + 2.56, f + 3.02, 0.105));
          if (hb > 0.4) batch.add(M.corrugated, box(F, s0 + 0.1, s1 - 0.1, f + 3.12, f + 3.18, 0, 0.95, 1.6));
          if (hb > 0.45) { lantern(new THREE.Vector3(...pt(F, s0 + 0.25, f + 2.55, 0.45)), hb); lantern(new THREE.Vector3(...pt(F, s1 - 0.25, f + 2.55, 0.45)), hb * 3); }
        } else if (kind === 'door') {
          batch.add(M.darkWood, box(F, sm - 0.62, sm + 0.62, f, f + 2.32, 0, 0.08, 1.6));
          batch.add(M.cedar, box(F, sm - 0.5, sm + 0.5, f, f + 2.2, 0, 0.1, 1.6));
          batch.add(warmLamp, box(F, sm + 0.75, sm + 0.9, f + 2.0, f + 2.3, 0, 0.12, 1));
          if (hb > 0.82 && street) { place('planter', F, sm - 1.2, f, 0.28); solidAt('planter', F, sm - 1.2, 0.28); }
        } else {
          // plain wall: a vending machine, a utility box, a payphone, or rubbish
          if (street && hb > 0.82 && bw >= 1.4) {
            const vb = pick(vendBody, hb * 5);
            batch.add(vb, box(F, sm - 0.47, sm + 0.47, f, f + 1.85, 0, 0.72, 1, 'b'));
            batch.add(pick(vendings, hb * 3), card(F, sm - 0.4, sm + 0.4, f + 0.15, f + 1.75, 0.725));
            const [x, , z] = pt(F, sm, f, 0.36); solid(x, z, Math.abs(F.rx) > 0.5 ? 0.47 : 0.36, Math.abs(F.rx) > 0.5 ? 0.36 : 0.47, 1.85);
          } else if (street && hb > 0.76) { place('utility', F, sm, f, 0.25); solidAt('utility', F, sm, 0.25); } else if (street && hb > 0.74 && kits.phone.placed.length < 5) { place('phone', F, sm, f + 1.0, 0.15); } else if (street) {
            // rubbish along the wall
            const hr = h(30 + b);
            if (hr < 0.4) { place('can', F, sm - 0.4, f, 0.38, { turn: hr * 6 }); solidAt('can', F, sm - 0.4, 0.38); place('bag', F, sm + 0.3, f, 0.33, { turn: hr * 9 }); } else if (hr < 0.6) { place('bag', F, sm, f, 0.3, { turn: hr * 4 }); place('bag', F, sm + 0.45, f, 0.35, { turn: hr * 7 }); } else if (hr < 0.75) { place('plastic', F, sm, f, 0.3); place('plastic', F, sm, f + 0.26, 0.3, { turn: 0.2 }); place('carton', F, sm + 0.5, f, 0.33, { turn: 0.4 }); } else if (hr < 0.85) { place('barrel', F, sm, f, 0.4); solidAt('barrel', F, sm, 0.4); } else { place('planter', F, sm, f, 0.28); solidAt('planter', F, sm, 0.28); }
          }
        }
      }
    }
    // upper floors
    windowsOn(F, L, f + 3.33, y1, r, h, style);
    // a blade neon sign out from the wall, and a drainpipe
    if (street && L >= 5 && y1 - f > 7.5 && h(40) < 0.42) {
      const s = h(41) < 0.5 ? 0.9 : L - 0.9, y = f + 3.7;
      const S = frame(...pt(F, s, 0, 0).filter((_, i) => i !== 1), F.nx, F.nz, -F.rx, -F.rz); // facing along the street
      batch.add(M.black, box(S, 0.08, 0.8, y, y + 3.4, -0.06, 0.06, 1));
      batch.add(pick(neon, h(42) * 10), card(S, 0.1, 0.78, y + 0.05, y + 3.35, 0.065));
      const back = frame(...pt(F, s, 0, 0).filter((_, i) => i !== 1), -F.nx, -F.nz, F.rx, F.rz); // (the other face: s runs into the wall here)
      batch.add(pick(neon, h(43) * 10), card(back, -0.78, -0.1, y + 0.05, y + 3.35, 0.065));
      batch.add(M.black, box(F, s - 0.04, s + 0.04, y + 3.2, y + 3.28, 0, 0.82, 1));
    }
    if (L >= 3 && y1 - f > 4 && h(50) < 0.6) batch.add(M.steel, rod(new THREE.Vector3(...pt(F, 0.28, f, 0.1)), new THREE.Vector3(...pt(F, 0.28, y1 - 0.2, 0.1)), 0.055));
  }

  // windows on a wall from y0 to y1: rows every 3 m, lit or dark, framed; timber posts on plaster
  function windowsOn(F, L, y0, y1, r, h, style = r.rect?.style ?? 'plaster') {
    if (L < 1.6 || y1 - y0 < 2) return;
    const cols = Math.max(1, Math.floor(L / 2.8)), sp = L / cols, ww = Math.min(1.5, sp - 0.8);
    if (ww < 0.6) return;
    const frameMat = style === 'facade' ? M.black : M.darkWood;
    for (let row = 0, yb = y0 + 0.75; yb + 1.5 < y1 - 0.4; row++, yb += 3) {
      for (let c = 0; c < cols; c++) {
        const sm = sp * (c + 0.5), hw = h(100 + row * 17 + c);
        const lit = hw < 0.3;
        batch.add(lit ? pick(litWindows, hw * 23) : M.glass, card(F, sm - ww / 2, sm + ww / 2, yb, yb + 1.5, 0.02));
        batch.add(frameMat, box(F, sm - ww / 2 - 0.08, sm + ww / 2 + 0.08, yb - 0.08, yb, 0, 0.12, 1.6));
        batch.add(frameMat, box(F, sm - ww / 2 - 0.08, sm + ww / 2 + 0.08, yb + 1.5, yb + 1.58, 0, 0.06, 1.6));
        batch.add(frameMat, box(F, sm - ww / 2 - 0.08, sm - ww / 2, yb, yb + 1.5, 0, 0.06, 1.6));
        batch.add(frameMat, box(F, sm + ww / 2, sm + ww / 2 + 0.08, yb, yb + 1.5, 0, 0.06, 1.6));
        batch.add(frameMat, box(F, sm - 0.025, sm + 0.025, yb, yb + 1.5, 0, 0.04, 1.6));
        if (hw > 0.93 && r.area?.outdoorish) place('aircon', F, sm + (hw > 0.9 ? 0.4 : -0.4), yb - 1.0, kits.aircon.size.z / 2 + 0.02);
      }
      if (style === 'plaster') for (let c = 0; c <= cols; c++) batch.add(M.cedar, box(F, sp * c - 0.09, sp * c + 0.09, yb - 0.75, Math.min(y1, yb + 2.25), 0, 0.05, 1.6));
    }
  }
  function pt(F, s, y, d) { return [F.ox + F.rx * s + F.nx * d, y, F.oz + F.rz * s + F.nz * d]; }

  // --- railings along the upper level's edges --------------------------------------------------
  for (const r of runs) {
    if (r.kind !== 'col' || !r.area || r.L < 0.5) continue;
    const top = r.y1, heaven = A[+r.b.slice(1)]?.kind === 'heaven';
    const rm = heaven ? M.cedar : M.steel;
    // which metres of the edge have a railing (the grid knows: not at the ropes)
    let s0 = null;
    const flushRail = (s1) => {
      if (s0 === null) return;
      const len = s1 - s0;
      for (let s = s0 + 0.05; s <= s1; s += Math.max(0.6, len / Math.max(1, Math.round(len / 1.2)))) batch.add(rm, box(r.F, s - 0.04, s + 0.04, top, top + 0.95, -0.18, -0.1, 1.6));
      batch.add(rm, box(r.F, s0, s1, top + 0.92, top + 1.0, -0.2, -0.08, 1.6));
      batch.add(rm, box(r.F, s0, s1, top + 0.48, top + 0.53, -0.17, -0.11, 1.6));
      s0 = null;
    };
    for (let s = 0; s < r.L; s += 0.25) {
      const [x, , z] = pt(r.F, s + 0.125, 0, -0.125);
      const c = grid.at(x, z), on = c >= 0 && grid.rail[c];
      if (on && s0 === null) s0 = s; else if (!on && s0 !== null) flushRail(s);
    }
    flushRail(r.L);
  }

  // --- stairs, with handrails -------------------------------------------------------------------
  for (const st of STAIRS) {
    const wood = Math.abs(st.x0) > 30 && st.z1 < -20; // the heaven stairs are wooden
    const m = wood ? M.hinoki : M.concreteFloor;
    const rise = (st.to - st.from) / st.steps;
    for (let n = 0; n < st.steps; n++) {
      const y = st.from + rise * (n + 1), a = n * st.depth, b = a + st.depth;
      if (st.up === 'n') batch.add(m, box(WORLD, st.x0, st.x1, st.from - 0.1, y, st.z1 - b, st.z1 - a, m.userData.scale, 'd'));
      if (st.up === 's') batch.add(m, box(WORLD, st.x0, st.x1, st.from - 0.1, y, st.z0 + a, st.z0 + b, m.userData.scale, 'd'));
      if (st.up === 'e') batch.add(m, box(WORLD, st.x0 + a, st.x0 + b, st.from - 0.1, y, st.z0, st.z1, m.userData.scale, 'd'));
      if (st.up === 'w') batch.add(m, box(WORLD, st.x1 - b, st.x1 - a, st.from - 0.1, y, st.z0, st.z1, m.userData.scale, 'd'));
    }
    // handrails: a sloped rail on posts, both sides
    const ns = st.up === 'n' || st.up === 's';
    for (const side of [0, 1]) {
      const lo = ns ? new THREE.Vector3(side ? st.x1 - 0.1 : st.x0 + 0.1, st.from, st.up === 'n' ? st.z1 : st.z0) : new THREE.Vector3(st.up === 'e' ? st.x0 : st.x1, st.from, side ? st.z1 - 0.1 : st.z0 + 0.1);
      const hi = ns ? new THREE.Vector3(lo.x, st.to, st.up === 'n' ? st.z0 : st.z1) : new THREE.Vector3(st.up === 'e' ? st.x1 : st.x0, st.to, lo.z);
      const off = new THREE.Vector3(0, 0.95, 0);
      batch.add(wood ? M.cedar : M.steel, rod(lo.clone().add(off), hi.clone().add(off), 0.035));
      for (let t = 0; t <= 1.001; t += 0.25) { const p = lo.clone().lerp(hi, t); batch.add(wood ? M.cedar : M.steel, rod(p, p.clone().add(off), 0.025)); }
    }
  }

  // --- cover ------------------------------------------------------------------------------------
  for (const [x, z, w, d, hgt, kind] of COVER) {
    const f = A[grid.area[grid.at(x, z)]]?.floor ?? 0, x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    if (kind === 'barrier') {
      // concrete Jersey barriers end to end, each about 1.5 m long
      const along = w >= d, len = along ? w : d, n = Math.max(1, Math.round(len / 1.5));
      for (let i = 0; i < n; i++) {
        const g = jersey(len / n - 0.04, along ? d : w, hgt);
        if (!along) g.rotateY(Math.PI / 2);
        const t = -len / 2 + (len / n) * (i + 0.5);
        g.translate(along ? x + t : x, f, along ? z : z + t);
        batch.add(M.concrete, g);
      }
    } else if (kind === 'metal') {
      batch.add(M.plate, box(WORLD, x0, x1, f, f + hgt, z0, z1, 1.6));
      batch.add(M.black, box(WORLD, x0 - 0.03, x1 + 0.03, f + hgt - 0.08, f + hgt + 0.02, z0 - 0.03, z1 + 0.03, 1, 'd'));
      batch.add(M.black, box(WORLD, x0 - 0.03, x1 + 0.03, f, f + 0.12, z0 - 0.03, z1 + 0.03, 1, 'd'));
    } else {
      // wooden crates (a stack: four on a pallet, two high)
      const crates = kind === 'stack' ? [[x0, (x0 + x1) / 2, z0, z1, f + 0.14, f + 0.14 + (hgt - 0.14) / 2], [(x0 + x1) / 2, x1, z0, z1, f + 0.14, f + 0.14 + (hgt - 0.14) / 2], [x0 + 0.1, x1 - 0.1, z0 + 0.1, z1 - 0.1, f + 0.14 + (hgt - 0.14) / 2, f + hgt]] : [[x0, x1, z0, z1, f, f + hgt]];
      if (kind === 'stack') batch.add(M.darkWood, box(WORLD, x0 - 0.05, x1 + 0.05, f, f + 0.14, z0 - 0.05, z1 + 0.05, 1.6));
      for (const [a0, a1, b0, b1, c0, c1] of crates) {
        batch.add(M.cedar, box(WORLD, a0, a1, c0, c1, b0, b1, 1.6));
        const e = 0.07;
        for (const [p0, p1, q0, q1] of [[a0 - 0.01, a0 + e, b0 - 0.01, b0 + e], [a1 - e, a1 + 0.01, b0 - 0.01, b0 + e], [a0 - 0.01, a0 + e, b1 - e, b1 + 0.01], [a1 - e, a1 + 0.01, b1 - e, b1 + 0.01]]) batch.add(M.darkWood, box(WORLD, p0, p1, c0, c1, q0, q1, 1.6));
        batch.add(M.darkWood, box(WORLD, a0 - 0.01, a1 + 0.01, c1 - e, c1 + 0.005, b0 - 0.01, b1 + 0.01, 1.6, 'd'));
      }
    }
  }

  // --- ropes up to the upper level ----------------------------------------------------------
  for (const rp of ROPES) {
    const top = grid.floorAt(rp.x + rp.out[0] * 1.5, rp.z + rp.out[1] * 1.5);
    const anchor = new THREE.Vector3(rp.x + rp.out[0] * 0.55, top + 1.6, rp.z + rp.out[1] * 0.55);
    batch.add(M.darkWood, box(WORLD, anchor.x - 0.1, anchor.x + 0.1, top, top + 1.75, anchor.z - 0.1, anchor.z + 0.1, 1.6));
    batch.add(M.darkWood, rod(anchor, new THREE.Vector3(rp.x, top + 1.6, rp.z), 0.07));
    batch.add(M.rope, rod(new THREE.Vector3(rp.x, 0.05, rp.z), new THREE.Vector3(rp.x, top + 1.6, rp.z), 0.035, 0.035, 6));
    for (let y = 0.6; y < top + 1.2; y += 0.55) { const g = new THREE.SphereGeometry(0.06, 8, 6); g.translate(rp.x, y, rp.z); batch.add(M.rope, g); }
  }

  // --- utility poles with street lamps, and the cables between them -----------------------------
  const poleTops = [];
  LAMPS.forEach(([x, z, dir], li) => {
    const f = grid.floorAt(x + 0.6, z) < 50 ? grid.floorAt(x + 0.6, z) : grid.floorAt(x, z + 0.6);
    const base = Number.isFinite(f) && f < 20 ? f : 0, top = base + 9;
    batch.add(M.concrete, rod(new THREE.Vector3(x, base, z), new THREE.Vector3(x, top, z), 0.15, 0.11, 10));
    const ax = Math.cos(dir), az = Math.sin(dir); // the crossarm runs across the lamp's direction
    batch.add(M.darkWood, box(frame(x, z, ax, az, -az, ax), -0.85, 0.85, top - 0.55, top - 0.43, -0.06, 0.06, 1.6));
    for (const s of [-0.7, 0, 0.7]) batch.add(M.stucco, rod(new THREE.Vector3(x + ax * s, top - 0.43, z + az * s), new THREE.Vector3(x + ax * s, top - 0.28, z + az * s), 0.04));
    if (hash(x, z) < 0.45) batch.add(M.steel, rod(new THREE.Vector3(x - az * 0.32, top - 2.7, z + ax * 0.32), new THREE.Vector3(x - az * 0.32, top - 1.8, z + ax * 0.32), 0.24, 0.24, 12));
    // the lamp: an arm out to the street, a head with a glowing face underneath
    const lx = -Math.sin(dir), lz = -Math.cos(dir); // dir 0 = north (-z)
    const arm0 = new THREE.Vector3(x, base + 5.6, z), arm1 = new THREE.Vector3(x + lx * 1.3, base + 5.85, z + lz * 1.3);
    batch.add(M.black, rod(arm0, arm1, 0.035));
    const H = frame(arm1.x, arm1.z, -lz, lx, lx, lz);
    batch.add(M.black, box(H, -0.16, 0.16, base + 5.72, base + 5.92, -0.08, 0.3, 1));
    batch.add(warmLamp, box(H, -0.13, 0.13, base + 5.7, base + 5.73, -0.05, 0.27, 1, 't'));
    lights.push({ pos: new THREE.Vector3(arm1.x + lx * 0.1, base + 5.4, arm1.z + lz * 0.1), color: 0xffc27a, intensity: 9, distance: 14, street: true, order: li });
    poleTops.push(new THREE.Vector3(x, top - 0.3, z));
  });
  // cables: between poles that see each other, sagging; and from poles to the nearest walls
  const sag = (a, b, drop) => {
    const mid = a.clone().lerp(b, 0.5); mid.y -= drop;
    return new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 12, 0.018, 4);
  };
  for (let i = 0; i < poleTops.length; i++) for (let j = i + 1; j < poleTops.length; j++) {
    const a = poleTops[i], b = poleTops[j], d = a.distanceTo(b);
    if (d < 6 || d > 24 || grid.colliders.blocked(a, b)) continue;
    for (const dy of [0, -0.35]) batch.add(M.cable, sag(a.clone().add(new THREE.Vector3(0, dy, 0)), b.clone().add(new THREE.Vector3(0, dy, 0)), d * 0.05));
  }
  for (const p of poleTops) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let t = 1; t < 12; t += 0.5) {
        const x = p.x + dx * t, z = p.z + dz * t;
        if (grid.floorAt(x, z) > p.y - 1.4) { if (t > 2.5 && hash(p.x, p.z, dx, dz) < 0.6) batch.add(M.cable, sag(p.clone().add(new THREE.Vector3(0, -0.6, 0)), new THREE.Vector3(x - dx * 0.05, p.y - 1.3, z - dz * 0.05), t * 0.06)); break; }
      }
    }
  }

  // --- lights indoors -------------------------------------------------------------------------
  for (const ar of A) {
    if (!ar.indoor || ar.kind === 'vent' || (ar.x1 - ar.x0) * (ar.z1 - ar.z0) < 12) continue;
    const cx = (ar.x0 + ar.x1) / 2, cz = (ar.z0 + ar.z1) / 2, long = ar.x1 - ar.x0 > ar.z1 - ar.z0;
    const len = long ? ar.x1 - ar.x0 : ar.z1 - ar.z0;
    if (len < 3) continue;
    const n = ar.kind === 'sewer' ? 1 : len > 14 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5, x = long ? cx + t * len : cx, z = long ? cz : cz + t * len;
      lights.push({ pos: new THREE.Vector3(x, ar.ceil - 0.4, z), color: ar.kind === 'sewer' ? 0xffb070 : ar.name === 'Mail' || ar.kind === 'walkway' ? 0xffdcae : 0xe6f0ff, intensity: ar.kind === 'sewer' ? 2 : 4, distance: 10, priority: 3 });
    }
    // lamps on the ceiling: tubes in the garage, paper lamps elsewhere
    for (let s = 1.5; s < len - 1; s += 3.5) {
      const x = long ? ar.x0 + s : cx, z = long ? cz : ar.z0 + s;
      if (ar.kind === 'indoor' && ar.name !== 'Mail') batch.add(tubeLamp, box(WORLD, x - (long ? 0.6 : 0.05), x + (long ? 0.6 : 0.05), ar.ceil - 0.08, ar.ceil, z - (long ? 0.05 : 0.6), z + (long ? 0.05 : 0.6), 1));
      else if (ar.kind !== 'sewer') batch.add(warmLamp, box(WORLD, x - 0.25, x + 0.25, ar.ceil - 0.3, ar.ceil - 0.02, z - 0.25, z + 0.25, 1, 't'));
    }
    if (ar.kind === 'walkway') for (let s = 0.5; s < len; s += 2) { const x = long ? ar.x0 + s : cx, z = long ? cz : ar.z0 + s; batch.add(M.darkWood, box(WORLD, long ? x - 0.08 : ar.x0, long ? x + 0.08 : ar.x1, ar.ceil - 0.22, ar.ceil, long ? ar.z0 : z - 0.08, long ? ar.z1 : z + 0.08, 1.6, 't')); }
  }
  // lanterns along the heavens' edges (each heaven glows a little)
  for (const ar of A) {
    if (ar.kind !== 'heaven') continue;
    for (let x = ar.x0 + 2; x < ar.x1 - 1; x += 4) lantern(new THREE.Vector3(x, ar.floor + 2.9, ar.z1 - 0.8), hash(x, ar.z1));
    lights.push({ pos: new THREE.Vector3((ar.x0 + ar.x1) / 2, ar.floor + 2.6, ar.z1 - 2), color: 0xff9a6a, intensity: 8, distance: 12, priority: 1 });
    // a roof over the back half, on posts
    const z0 = ar.z0, z1 = (ar.z0 + ar.z1) / 2 + 1, y = ar.floor + 3.4;
    batch.add(M.roof, quad4(new THREE.Vector3(ar.x0, y + 0.8, z0), new THREE.Vector3(ar.x0, y, z1), new THREE.Vector3(ar.x1, y, z1), new THREE.Vector3(ar.x1, y + 0.8, z0), M.roof.userData.scale, [[0, 0], [z1 - z0, 0], [z1 - z0, ar.x1 - ar.x0], [0, ar.x1 - ar.x0]]));
    batch.add(M.darkWood, quad4(new THREE.Vector3(ar.x1, y + 0.8, z0), new THREE.Vector3(ar.x1, y, z1), new THREE.Vector3(ar.x0, y, z1), new THREE.Vector3(ar.x0, y + 0.8, z0), 1.6, [[0, 0], [z1 - z0, 0], [z1 - z0, ar.x1 - ar.x0], [0, ar.x1 - ar.x0]]));
    for (let x = ar.x0 + 0.3; x < ar.x1; x += 4.4) batch.add(M.darkWood, box(WORLD, x - 0.1, x + 0.1, ar.floor, y + 0.05, z1 - 0.2, z1, 1.6));
  }

  // --- puddles in the streets (it has rained) --------------------------------------------------
  for (const ar of A) {
    if (!ar.outdoorish) continue;
    const n = Math.round(((ar.x1 - ar.x0) * (ar.z1 - ar.z0)) / 70);
    for (let i = 0; i < n; i++) {
      const x = ar.x0 + 1 + hash(ar.x0, i, 1) * (ar.x1 - ar.x0 - 2), z = ar.z0 + 1 + hash(ar.z0, i, 2) * (ar.z1 - ar.z0 - 2);
      const c = grid.at(x, z);
      if (!grid.walkable(c) || grid.stair[c] || Math.abs(grid.floor[c] - ar.floor) > 0.01) continue;
      const g = new THREE.CircleGeometry(1, 18);
      g.rotateX(-Math.PI / 2);
      g.scale(0.5 + hash(x, z, 3) * 1.4, 1, 0.35 + hash(z, x, 4) * 0.9);
      g.rotateY(hash(x, z, 5) * Math.PI);
      g.translate(x, ar.floor + 0.006, z);
      batch.add(M.puddle, g);
    }
  }

  // --- paint on the ground: the site letters, lines on the roads -------------------------------
  for (const [letter, x, z] of [['A', -44, -11], ['B', 44, -11]]) {
    const m = new THREE.MeshStandardMaterial({ map: look.siteLetter(letter), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
    const g = new THREE.PlaneGeometry(7, 7); g.rotateX(-Math.PI / 2); g.translate(x, 0.005, z);
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; group.add(mesh);
  }
  for (const ar of A) {
    if (ar.kind !== 'road') continue;
    const long = ar.x1 - ar.x0 > ar.z1 - ar.z0;
    for (let s = (long ? ar.x0 : ar.z0) + 1; s < (long ? ar.x1 : ar.z1) - 2; s += 4) {
      batch.add(M.paint, long ? box(WORLD, s, s + 2, 0.003, 0.006, (ar.z0 + ar.z1) / 2 - 0.08, (ar.z0 + ar.z1) / 2 + 0.08, 1, 'fbrld') : box(WORLD, (ar.x0 + ar.x1) / 2 - 0.08, (ar.x0 + ar.x1) / 2 + 0.08, 0.003, 0.006, s, s + 2, 1, 'fbrld'));
    }
  }
  // security cameras watching the sites' entrances
  for (const [x, z, a] of [[-41.2, -4.6, Math.PI * 0.75], [41.2, -4.6, -Math.PI * 0.75], [-28.6, -5, Math.PI * 1.25], [28.6, -5, -Math.PI * 1.25]]) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 4.2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(1, 1, 1));
    kits.camera.placed.push(m);
  }

  // --- far-off towers, lit windows, beyond the edge of the map ---------------------------------
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + R0() * 0.15, dist = 92 + R0() * 40, w = 10 + R0() * 14, hgt = 22 + R0() * 40;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist * 1.05;
    const t = look.towerWindows(700 + i); t.repeat.set(w / 12, hgt / 40);
    const m = new THREE.MeshBasicMaterial({ map: t, fog: false, color: 0x9a9aa8 });
    const g = new THREE.BoxGeometry(w, hgt, w);
    g.translate(x, hgt / 2 - 2, z);
    group.add(new THREE.Mesh(g, m));
  }

  // --- assemble ----------------------------------------------------------------------------------
  batch.meshes(group);
  const SHADOWED = new Set([kits.crate, kits.barrel, kits.utility, kits.planter, kits.can]);
  for (const kit of Object.values(kits)) {
    if (!kit.placed.length) continue;
    for (const part of kit.parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, kit.placed.length);
      kit.placed.forEach((m, i) => im.setMatrixAt(i, m.clone().multiply(part.matrix)));
      im.receiveShadow = true;
      im.castShadow = SHADOWED.has(kit); // (only the big ones: shadows draw everything again)
      im.computeBoundingSphere();
      group.add(im);
    }
  }
  // the lights (each one costs on every surface): as many as the graphics preset allows, about
  // half on the streets (spread over the map: every second, third… lamp) and half indoors (the
  // rooms first, then the heavens); the other lamps just glow
  const cap = quality === 'high' ? 18 : 8;
  const street = lights.filter((l) => l.street), inside = lights.filter((l) => !l.street).sort((a, b) => b.priority - a.priority);
  const nStreet = Math.min(street.length, Math.ceil(cap / 2)), step = street.length / nStreet;
  const chosen = [...Array.from({ length: nStreet }, (_, i) => street[Math.floor(i * step)]), ...inside.slice(0, cap - nStreet)];
  for (const l of chosen) {
    const p = new THREE.PointLight(l.color, l.intensity, l.distance, 1.4);
    p.position.copy(l.pos);
    group.add(p);
  }
  return { group };
}
