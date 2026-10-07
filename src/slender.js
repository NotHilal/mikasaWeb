// The hunter's model: a Slenderman sculpt with tentacles on his back (public/models/slender.glb,
// compressed). It's a statue: there's no skeleton, and the tentacles are part of the same mesh
// as the body. So the tentacles are found when it loads: everything outside an outline of the
// body (torso, head, arms, legs) is tentacle, and the separate pieces of that are the separate
// tentacles. Each one gets where it joins his back, how far along it each point is, and a turn
// that swings it from where it hangs to around the person in front of him. The vertex shader
// does the rest: the tentacles writhe slowly, and on a grab each one curls round to the front.
// He walks the same way: the points of each leg and arm are found from the same outline, and the
// shader swings the legs from the hips (bending the knees) and the arms from the shoulders.
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
    { ...cap([s * 0.07, 0.06, Z], [s * 0.1, -0.95, Z + 0.05], 0.12), leg: s },        // leg (angled forward and out)
    { ...cap([s * 0.1, -0.93, Z + 0.03], [s * 0.1, -0.97, Z + 0.26], 0.095), leg: s }, // shoe
    { ...cap([s * 0.21, 0.58, Z], [s * 0.26, -0.12, Z], 0.08), arm: s },              // arm
    { ...cap([s * 0.26, -0.12, Z], [s * 0.27, -0.3, Z + 0.02], 0.07), arm: s },       // hand
  ]),
];
// the joints the walk turns about, in the file's space, per side (-1, 1)
const JOINT = {
  hip: (s) => new THREE.Vector3(s * 0.075, 0.03, Z),
  knee: (s) => new THREE.Vector3(s * 0.085, -0.45, Z + 0.025),
  shoulder: (s) => new THREE.Vector3(s * 0.21, 0.56, Z),
};
// the base of his neck: the head tips over sideways about this for the jumpscare (uTilt)
const NECK = new THREE.Vector3(0, 0.62, Z + 0.02);
// In the duel he holds the Classic out in front, his right arm (side -1 in the file) raised forward
// from the shoulder by this much (radians; straight down is 0). The sculpt's arms are fused to his
// jacket all the way down, so the real arm can't be lifted (it would drag the jacket up with it):
// it's tucked into his side instead, and figures.js gives him a separate arm, raised (gunArm).
const HOLD = 1.3;
const OUT = 0.03;   // further than this outside the body: tentacle
const SPLIT = 0.12; // tentacles touch near his back, so they're told apart further out than this

const seg = new THREE.Line3(), near = new THREE.Vector3();
function outsideBody(p) {
  let d = Infinity;
  for (const c of BODY) { seg.set(c.a, c.b); seg.closestPointToPoint(p, true, near); d = Math.min(d, near.distanceTo(p) - c.r); }
  return d;
}

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
// Which limb a body point (p, with its normal n) belongs to, and how much it follows each joint:
// [leg side, hip weight, knee weight, arm side, arm weight] (sides -1 / 1, or 0). The weights fade
// in below each joint, so the cloth stretches smoothly there instead of tearing.
// Usually that's the nearest capsule, but his hands hang right against his thighs, where the
// capsules overlap: there, of the capsules the point is close to, it goes with the one whose
// surface faces the way the point's does (the outside of the thigh faces away from the leg,
// the inside of the hand away from the hand).
const CLOSE = 0.05, away = new THREE.Vector3();
function limbOf(p, n) {
  let best = null, bestD = Infinity, facing = null, bestFace = -Infinity;
  for (const c of BODY) {
    seg.set(c.a, c.b);
    seg.closestPointToPoint(p, true, near);
    const d = near.distanceTo(p) - c.r;
    if (d < bestD) { bestD = d; best = c; }
    if (d < CLOSE) {
      const f = n.dot(away.subVectors(p, near).normalize());
      if (f > bestFace) { bestFace = f; facing = c; }
    }
  }
  if (facing) best = facing;
  if (best.leg) return [best.leg, smooth(0.06, -0.12, p.y), smooth(-0.38, -0.52, p.y), 0, 0];
  if (best.arm) return [0, 0, 0, best.arm, smooth(0.56, 0.4, p.y)];
  return [0, 0, 0, 0, 0];
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
      attribute vec3 aLeg;   // leg side (-1, 1; 0: not a leg), hip weight, knee weight
      attribute vec2 aArm;   // arm side, weight
      uniform float uTime, uGrab;
      uniform float uPhase, uStride, uHold; // the walk: where in the stride, how big (0..1); uHold: the gun arm (side -1) is raised to aim
      uniform vec3 uHipL, uHipR, uKneeL, uKneeR, uShoulderL, uShoulderR;
      uniform vec3 uTuck; // where the gun arm goes while he holds the Classic: inside his right side (x, lowest y, z)
      uniform vec3 uNeck; uniform float uTilt; // the jumpscare: his head tipped over sideways about the neck (radians)
      // a turn about the x axis (his left-right): + swings a limb forward (he faces -z)
      mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
      // and about the z axis (the way he faces): tips the head over onto a shoulder
      mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
      // how much a point is part of the head (body only: not a limb or a tentacle), fading in up the neck
      float headK(vec3 p) { return aAlong > 0.0 || aLeg.x != 0.0 || aArm.x != 0.0 ? 0.0 : smoothstep(uNeck.y - 0.04, uNeck.y + 0.12, p.y); }
      // each leg swings from the hip, half a stride apart; the knee bends as the leg comes through
      float legPhase() { return uPhase + (aLeg.x < 0.0 ? 0.0 : 3.14159); }
      float legSwing() { return sin(legPhase()) * 0.42 * uStride * aLeg.y; }
      float kneeBend() { return -max(0.0, cos(legPhase())) * 0.75 * uStride * aLeg.z; }
      // the arms swing against the legs (the arm on one side with the leg on the other)
      float armSwing() { return sin(uPhase + (aArm.x < 0.0 ? 3.14159 : 0.0)) * 0.3 * uStride * aArm.y; }
      // while he holds the Classic, the real gun arm is tucked away inside his side
      bool tucked() { return aArm.x < 0.0 && uHold > 0.0; }
      vec3 walkPoint(vec3 p) {
        if (aLeg.x != 0.0) {
          vec3 hip = aLeg.x < 0.0 ? uHipL : uHipR, knee = aLeg.x < 0.0 ? uKneeL : uKneeR;
          p = knee + rotX(kneeBend()) * (p - knee);
          p = hip + rotX(legSwing()) * (p - hip);
        }
        if (tucked()) p = mix(p, vec3(uTuck.x, max(p.y, uTuck.y), uTuck.z), uHold * aArm.y);
        else if (aArm.x != 0.0) { vec3 sh = aArm.x < 0.0 ? uShoulderL : uShoulderR; p = sh + rotX(armSwing()) * (p - sh); }
        if (uTilt != 0.0) p = uNeck + rotZ(uTilt * headK(p)) * (p - uNeck);
        return p;
      }
      mat3 walkTurn() {
        if (aLeg.x != 0.0) return rotX(legSwing()) * rotX(kneeBend());
        if (aArm.x != 0.0) return tucked() ? mat3(1.0) : rotX(armSwing());
        return rotZ(uTilt * headK(position));
      }
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
      // Two directions across each tentacle (it runs along aDir), and its own offset in time, so
      // no two move together
      float seed() { return aBase.x * 11.0 + aBase.y * 7.0 + aBase.z * 5.0; }
      vec3 across1() { return abs(aDir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : normalize(cross(aDir, vec3(0.0, 1.0, 0.0))); }
      vec3 across2() { return normalize(cross(aDir, across1())); }
      // Venom-like: each tentacle keeps curling from its base, one way then another, further
      // along turning further, so the tips sweep about the most. A grab curls them round the
      // seeker instead (and calms the sway).
      vec3 sway() {
        float s = seed(), calm = 1.0 - 0.8 * uGrab;
        float a = sin(uTime * 1.3 + s) * 0.6 + sin(uTime * 3.1 + s * 1.7) * 0.22;
        float b = sin(uTime * 1.05 + s * 2.3) * 0.5 + sin(uTime * 3.7 + s * 0.6) * 0.18;
        return (across1() * a + across2() * b) * calm;
      }
      mat3 tentacleTurn() {
        if (aAlong <= 0.0) return mat3(1.0);
        return turn((aTurn * uGrab + sway()) * aAlong);
      }
      // and ripples running down to the tips, which whip
      vec3 writhe() {
        if (aAlong <= 0.0) return vec3(0.0);
        float ph = uTime * (3.0 + uGrab * 2.0) - aAlong * 9.0 + seed();
        float amp = pow(aAlong, 1.6) * (0.12 + 0.05 * uGrab);
        return amp * (across1() * sin(ph) + across2() * cos(ph * 0.83));
      }`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${head}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 rel = transformed - aBase;
        rel += aDir * dot(rel, aDir) * (uGrab * aReach); // longer, not thicker
        transformed = walkPoint(aBase + tentacleTurn() * rel + writhe());`);
    if (withNormals) {
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        objectNormal = walkTurn() * tentacleTurn() * objectNormal;`);
    }
  };
}

let template = null; // { parts: geometries, material, joints: the walk's joint uniforms }

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

  // how far each point is outside the body, which limb it's on, and his height (head top, feet)
  // from the body alone
  let top = -Infinity, bottom = Infinity;
  const p = new THREE.Vector3(), nrm = new THREE.Vector3();
  const limbs = [];
  const hand = new THREE.Vector3(); // his gun hand (side -1): the middle of its points, below the wrist
  let handN = 0;
  const out = parts.map((g) => {
    const pos = g.attributes.position, d = new Float32Array(pos.count), limb = new Float32Array(pos.count * 5);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      d[i] = outsideBody(p);
      if (d[i] < OUT) top = Math.max(top, p.y);
      bottom = Math.min(bottom, p.y);
      nrm.fromBufferAttribute(g.attributes.normal, i);
      limb.set(limbOf(p, nrm), i * 5);
      if (limb[i * 5 + 3] === -1 && p.y < -0.14 && d[i] < OUT) { hand.add(p); handN++; }
    }
    limbs.push(limb);
    return d;
  });
  // turn to face -z like the other figures, scale to his height, feet on the ground
  const s = HEIGHT / (top - bottom);
  const fit = new THREE.Matrix4().makeTranslation(0, -bottom * s, 0)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  for (const g of parts) { g.applyMatrix4(fit); g.computeBoundingSphere(); }
  const tentacle = splitTentacles(parts, out);
  // the limbs (tentacle points aren't part of any)
  parts.forEach((g, gi) => {
    const n = g.attributes.position.count, leg = new Float32Array(n * 3), arm = new Float32Array(n * 2), l = limbs[gi];
    for (let i = 0; i < n; i++) {
      if (tentacle[gi][i]) continue;
      leg.set([l[i * 5], l[i * 5 + 1], l[i * 5 + 2]], i * 3);
      arm.set([l[i * 5 + 3], l[i * 5 + 4]], i * 2);
    }
    g.setAttribute('aLeg', new THREE.BufferAttribute(leg, 3));
    g.setAttribute('aArm', new THREE.BufferAttribute(arm, 2));
  });
  const at = (v) => ({ value: v.applyMatrix4(fit) });
  const joints = {
    uHipL: at(JOINT.hip(-1)), uHipR: at(JOINT.hip(1)), uKneeL: at(JOINT.knee(-1)), uKneeR: at(JOINT.knee(1)),
    uShoulderL: at(JOINT.shoulder(-1)), uShoulderR: at(JOINT.shoulder(1)), uNeck: at(NECK.clone()),
  };
  // the tucked gun arm: a little inside the side of his jacket, no lower than his hips (where the
  // jacket ends)
  const sh = joints.uShoulderL.value;
  joints.uTuck = { value: new THREE.Vector3(sh.x * 0.55, joints.uHipL.value.y + 0.25, sh.z) };
  // (if the hand wasn't found, where the outline puts it)
  if (handN) hand.divideScalar(handN); else hand.set(-0.265, -0.21, Z + 0.01);
  hand.applyMatrix4(fit);
  template = { parts, material, joints, hand };
}

// Find the separate tentacles (connected pieces of the points outside the body; the file's
// parts are welded by position first) and give their points aBase, aAlong and aTurn. Returns, per
// part, which points are tentacle.
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
  const isTentacle = parts.map((g) => new Uint8Array(g.attributes.position.count));
  parts.forEach((g, gi) => {
    const pos = g.attributes.position, n = pos.count;
    const base = new Float32Array(n * 3), turn = new Float32Array(n * 3), dir = new Float32Array(n * 3);
    const along = new Float32Array(n), reach = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = point.get(local[gi][i]);
      if (!t) continue;
      isTentacle[gi][i] = 1;
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
  return isTentacle;
}

export const slenderReady = () => !!template;

// His raised gun arm (figure space): from the shoulder to where the hand ends up (the model's own
// hand, turned forward about the shoulder by HOLD), and how far that is.
export function gunArm() {
  const sh = template.joints.uShoulderL.value.clone(), hand = template.hand.clone().sub(sh);
  const c = Math.cos(HOLD), s = Math.sin(HOLD);
  hand.set(hand.x, c * hand.y - s * hand.z, s * hand.y + c * hand.z).add(sh);
  return { shoulder: sh, hand, length: hand.distanceTo(sh) };
}

// a new Slenderman: a group with userData.tentacles = { uTime, uGrab, uPhase, uStride, uHold, uTilt }
// uniforms to drive (the tentacles, the walk, and the jumpscare's head tilt)
export function makeSlender() {
  const g = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uGrab: { value: 0 }, uPhase: { value: 0 }, uStride: { value: 0 }, uHold: { value: 0 }, uTilt: { value: 0 }, ...template.joints };
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
