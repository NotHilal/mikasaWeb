// The hunter's model: a Slenderman sculpt with tentacles on his back (public/models/slender.glb,
// compressed). It's a statue: there's no skeleton, and the tentacles are part of the same mesh
// as the body. So the tentacles are found when it loads: everything outside an outline of the
// body (torso, head, arms, legs) is tentacle, and the separate pieces of that are the separate
// tentacles. Each one gets where it joins his back, how far along it each point is, and a turn
// that swings it from where it hangs to around the person in front of him. The vertex shader
// does the rest: the tentacles writhe slowly, and on a grab each one curls round to the front.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const HEIGHT = 2.75; // the top of his head, in metres (the hitbox in config.js GUN matches this)
// where a grabbed seeker's chest is, in the figure's own space (he faces -z): see GRAB.holdDist
const HELD = new THREE.Vector3(0, 1.3, -0.85);

// The body as capsules, in the file's own space (about 2 units tall, centred, facing +z).
// Anything further than this from all of them is tentacle.
const Z = 0.07; // the body sits a little in front of the model's centre
const cap = (a, b, r) => ({ a: new THREE.Vector3(...a), b: new THREE.Vector3(...b), r });
const BODY = [
  cap([0, 0.04, Z], [0, 0.6, Z], 0.2),                 // torso (jacket)
  cap([0, 0.6, Z], [0, 0.88, Z + 0.04], 0.125),        // neck and head (tipped a little forward)
  ...[-1, 1].flatMap((s) => [
    cap([s * 0.07, 0.06, Z], [s * 0.1, -0.95, Z + 0.05], 0.12),        // leg (angled forward and out)
    cap([s * 0.1, -0.93, Z + 0.03], [s * 0.1, -0.97, Z + 0.26], 0.095), // shoe
    cap([s * 0.21, 0.58, Z], [s * 0.26, -0.12, Z], 0.08),              // arm
    cap([s * 0.26, -0.12, Z], [s * 0.27, -0.3, Z + 0.02], 0.07),       // hand
  ]),
];
const OUT = 0.03;   // further than this outside the body: tentacle
const SPLIT = 0.12; // tentacles touch near his back, so they're told apart further out than this

const seg = new THREE.Line3(), near = new THREE.Vector3();
function outsideBody(p) {
  let d = Infinity;
  for (const c of BODY) { seg.set(c.a, c.b); seg.closestPointToPoint(p, true, near); d = Math.min(d, near.distanceTo(p) - c.r); }
  return d;
}

// Move the tentacles in a material's vertex shader. Per point: aBase (where its tentacle joins
// his back), aAlong (0 at the base, 1 at the tip; 0 for the body), aTurn (the axis to turn about,
// times the angle for a full grab), aDir and aReach (a grab stretches the tentacle along aDir,
// base to tip, by this fraction, so it's long enough to get round the seeker). Positions are in the figure's own space: metres, feet at 0,
// facing -z.
function bendShader(uniforms, withNormals) {
  return (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const head = /* glsl */`
      attribute vec3 aBase, aTurn, aDir;
      attribute float aAlong, aReach;
      uniform float uTime, uGrab;
      // rotation by an angle (the length of v) about the axis v
      mat3 turn(vec3 v) {
        float a = length(v);
        if (a < 1e-4) return mat3(1.0);
        vec3 k = v / a;
        float c = cos(a), s = sin(a), t = 1.0 - c;
        return mat3(t * k.x * k.x + c,       t * k.x * k.y + s * k.z, t * k.x * k.z - s * k.y,
                    t * k.x * k.y - s * k.z, t * k.y * k.y + c,       t * k.y * k.z + s * k.x,
                    t * k.x * k.z + s * k.y, t * k.y * k.z - s * k.x, t * k.z * k.z + c);
      }
      // a grab curls each tentacle evenly from its base: further along turns further
      mat3 tentacleTurn() { return turn(aTurn * (uGrab * aAlong)); }
      vec3 writhe() {
        float ph = uTime * (1.0 + uGrab * 2.0) + aBase.x * 7.0 + aBase.y * 5.0;
        float amp = aAlong * aAlong * (0.07 + 0.05 * uGrab);
        return amp * vec3(sin(ph + aAlong * 6.0), 0.5 * sin(ph * 0.8 + aAlong * 4.5), cos(ph * 0.9 + aAlong * 5.0));
      }`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${head}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 rel = transformed - aBase;
        rel += aDir * dot(rel, aDir) * (uGrab * aReach); // longer, not thicker
        transformed = aBase + tentacleTurn() * rel + writhe();`);
    if (withNormals) {
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        objectNormal = tentacleTurn() * objectNormal;`);
    }
  };
}

let template = null; // { parts: geometries, material }

export async function loadSlender(manager) {
  const gltf = await new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).loadAsync('models/slender.glb');
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  let material = null;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    // into the file's own space, as plain floats (the compressed file stores small integers)
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const src = o.geometry.attributes[name];
      if (!src) continue;
      const data = new Float32Array(src.count * src.itemSize);
      for (let i = 0; i < src.count; i++) for (let k = 0; k < src.itemSize; k++) data[i * src.itemSize + k] = src.getComponent(i, k);
      g.setAttribute(name, new THREE.BufferAttribute(data, src.itemSize));
    }
    g.setIndex(o.geometry.index);
    g.applyMatrix4(o.matrixWorld);
    parts.push(g);
    material = o.material;
  });

  // how far each point is outside the body, and his height (head top, feet) from the body alone
  let top = -Infinity, bottom = Infinity;
  const p = new THREE.Vector3();
  const out = parts.map((g) => {
    const pos = g.attributes.position, d = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      d[i] = outsideBody(p);
      if (d[i] < OUT) top = Math.max(top, p.y);
      bottom = Math.min(bottom, p.y);
    }
    return d;
  });
  // turn to face -z like the other figures, scale to his height, feet on the ground
  const s = HEIGHT / (top - bottom);
  const fit = new THREE.Matrix4().makeTranslation(0, -bottom * s, 0)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  for (const g of parts) { g.applyMatrix4(fit); g.computeBoundingSphere(); }
  splitTentacles(parts, out);
  template = { parts, material };
}

// Find the separate tentacles (connected pieces of the points outside the body; the file's
// parts are welded by position first) and give their points aBase, aAlong and aTurn.
function splitTentacles(parts, out) {
  const ids = new Map(), parent = [], pts = [], dist = [];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const v = new THREE.Vector3();
  const local = parts.map((g, gi) => {
    const pos = g.attributes.position, map = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const key = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
      let id = ids.get(key);
      if (id === undefined) { id = pts.length; ids.set(key, id); pts.push(v.clone()); parent.push(id); dist.push(out[gi][i]); }
      map[i] = id;
    }
    // join along edges whose both ends are outside the body
    const idx = g.index;
    for (let t = 0; t < idx.count; t += 3) {
      const a = map[idx.getX(t)], b = map[idx.getX(t + 1)], c = map[idx.getX(t + 2)];
      for (const [x, y] of [[a, b], [b, c], [c, a]]) {
        if (dist[x] > SPLIT && dist[y] > SPLIT) { const rx = find(x), ry = find(y); if (rx !== ry) parent[rx] = ry; }
      }
    }
    return map;
  });

  // each piece: where it joins the body (its points nearest the body), its tip, its length
  const pieces = new Map();
  for (let i = 0; i < pts.length; i++) {
    if (dist[i] <= SPLIT) continue;
    const r = find(i);
    if (!pieces.has(r)) pieces.set(r, []);
    pieces.get(r).push(i);
  }
  const tentacles = [...pieces.values()].filter((list) => list.length > 300) // (not stray bits of suit)
    .map((list) => {
      const byDist = [...list].sort((a, b) => dist[a] - dist[b]);
      const n = Math.max(1, Math.floor(byDist.length * 0.03));
      const base = new THREE.Vector3();
      for (let k = 0; k < n; k++) base.add(pts[byDist[k]]);
      base.divideScalar(n);
      let tip = base, len = 0;
      for (const i of list) { const d = pts[i].distanceTo(base); if (d > len) { len = d; tip = pts[i]; } }
      return { list, base, tip, len };
    });

  // each tentacle's turn: from pointing at its tip to pointing at a spot around the held seeker
  // (spots spread round them by where the tentacle sits on his back, so they wrap all sides),
  // and a little more, so the tips hook round
  const point = new Map(); // point id → { base, turn, dir, reach, len }
  for (const t of tentacles) {
    const side = Math.atan2(t.base.x, t.tip.y - t.base.y);
    const spot = HELD.clone().add(new THREE.Vector3(Math.sin(side * 1.6) * 0.32, (t.tip.y - t.base.y) * 0.25, Math.cos(side * 1.6) * 0.25));
    const reach = Math.max(0, (spot.distanceTo(t.base) * 1.25 + 0.25) / t.len - 1); // to get there and round
    const from = t.tip.clone().sub(t.base).normalize(), to = spot.sub(t.base).normalize();
    const axis = new THREE.Vector3().crossVectors(from, to);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    const turn = axis.normalize().multiplyScalar(from.angleTo(to) + 0.5);
    for (const i of t.list) point.set(i, { base: t.base, turn, dir: from, reach, len: t.len });
  }

  // write the attributes (body points: no turn, along = 0)
  parts.forEach((g, gi) => {
    const pos = g.attributes.position, n = pos.count;
    const base = new Float32Array(n * 3), turn = new Float32Array(n * 3), dir = new Float32Array(n * 3);
    const along = new Float32Array(n), reach = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = point.get(local[gi][i]);
      if (!t) continue;
      v.fromBufferAttribute(pos, i);
      base.set([t.base.x, t.base.y, t.base.z], i * 3);
      turn.set([t.turn.x, t.turn.y, t.turn.z], i * 3);
      dir.set([t.dir.x, t.dir.y, t.dir.z], i * 3);
      reach[i] = t.reach;
      along[i] = Math.min(1, v.distanceTo(t.base) / t.len);
    }
    g.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
    g.setAttribute('aTurn', new THREE.BufferAttribute(turn, 3));
    g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('aReach', new THREE.BufferAttribute(reach, 1));
  });
  console.info(`Slenderman: ${tentacles.length} tentacles (${tentacles.map((t) => `${t.list.length} pts, ${t.len.toFixed(1)} m`).join('; ')})`);
}

export const slenderReady = () => !!template;

// a new Slenderman: a group with userData.tentacles = { uTime, uGrab } uniforms to drive
export function makeSlender() {
  const g = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uGrab: { value: 0 } };
  const material = template.material.clone();
  material.onBeforeCompile = bendShader(uniforms, true);
  // his shadow bends the same way
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = bendShader(uniforms, false);
  for (const geo of template.parts) {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    m.customDepthMaterial = depth;
    m.frustumCulled = false; // the tentacles move outside the mesh's bounds
    m.userData.bend = bendShader(uniforms, false); // for copies of the mesh (the x-ray)
    g.add(m);
  }
  g.userData.tentacles = uniforms;
  return g;
}
