// The other player's body, as seen by you: Slenderman for the hunter (see slender.js; a figure
// built from primitives if his model didn't load), and Iso holding the Classic for the seeker
// (or a simple stand-in if his model didn't load). Each has userData.animate(dt, speed, time, pose), a walk
// cycle driven by how fast it's moving, called every frame by the match. pose (all 0..1):
// grab (the hunter reaching out and holding), struggle (the seeker fighting to get free),
// lift (the seeker held up off the ground: the last grab).
import * as THREE from 'three';
import { isoReady, cloneIso } from './iso.js';
import { slenderReady, makeSlender } from './slender.js';
import { buildNocturnum } from './skins/nocturnum.js';
import { settings } from './settings.js';

const capsule = (r, len, mat) => {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat);
  m.castShadow = true;
  return m;
};

export function hunterFigure() {
  return slenderReady() ? slenderHunter() : blockHunter();
}

// Slenderman: a statue, so he glides instead of walking (it suits him), swaying a little and
// leaning into it when he moves. His tentacles writhe; on a grab they close around the seeker.
function slenderHunter() {
  const g = new THREE.Group();
  const body = makeSlender();
  g.add(body);
  const t = body.userData.tentacles;
  let lean = 0;
  g.userData.animate = (dt, speed, time, pose = {}) => {
    t.uTime.value = time;
    t.uGrab.value = pose.grab ?? 0;
    lean += (Math.min(1, speed / 4) - lean) * Math.min(1, dt * 4);
    body.rotation.set(-0.1 * lean, 0, Math.sin(time * 0.7) * 0.02);
    body.position.y = Math.sin(time * 1.1) * 0.03;
  };
  return g;
}

// the stand-in hunter, built from primitives
function blockHunter() {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.65 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xbdbdb8, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe6e3dd, roughness: 0.45 });

  // legs hang from hip pivots and arms from shoulder pivots, so they can swing
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.11, 1.4, 0);
    const leg = capsule(0.07, 1.25, suit);
    leg.position.y = -0.7;
    hip.add(leg);
    g.add(hip);
    legs.push(hip);
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.3, 2.28, 0.02);
    const arm = capsule(0.05, 1.25, suit);
    arm.position.y = -0.66;
    arm.rotation.z = s * 0.06;
    const hand = capsule(0.035, 0.18, skin);
    hand.position.set(s * 0.04, -1.36, 0.01);
    shoulder.add(arm, hand);
    g.add(shoulder);
    arms.push(shoulder);
  }
  const torso = capsule(0.19, 0.75, suit);
  torso.scale.set(1.15, 1, 0.65);
  torso.position.y = 1.85;
  g.add(torso);
  const shirtFront = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.42), shirt);
  shirtFront.position.set(0, 2.05, 0.125);
  g.add(shirtFront);
  const neck = capsule(0.045, 0.12, skin);
  neck.position.y = 2.38;
  g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 18), skin);
  head.scale.set(0.9, 1.3, 0.95);
  head.position.y = 2.58;
  head.castShadow = true;
  g.add(head);
  g.userData.head = head;

  // a stiff, too-long stride with arms that barely move, and a slow tilt of the head.
  // Grabbing: both arms come up and in, hands meeting in front of him, and he looks down.
  let phase = 0;
  g.userData.animate = (dt, speed, time, pose = {}) => {
    const amt = Math.min(1, speed / 3.5), grab = pose.grab ?? 0;
    phase += dt * speed * 2.2;
    const sw = Math.sin(phase) * 0.32 * amt;
    legs[0].rotation.x = sw;
    legs[1].rotation.x = -sw;
    const squeeze = Math.sin(time * 9) * 0.04 * grab;
    arms[0].rotation.set(THREE.MathUtils.lerp(-sw * 0.25, 1.2 + squeeze, grab), 0, 0.3 * grab);
    arms[1].rotation.set(THREE.MathUtils.lerp(sw * 0.25, 1.2 - squeeze, grab), 0, -0.3 * grab);
    head.rotation.z = (Math.sin(time * 0.6) * 0.13 + Math.sin(time * 2.3) * 0.02) * (1 - grab * 0.6);
    head.rotation.x = Math.sin(time * 0.4) * 0.05 - 0.45 * grab;
  };
  return g;
}

function glareTexture() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.08, 'rgba(255,250,235,0.8)');
  grad.addColorStop(0.3, 'rgba(255,240,210,0.15)');
  grad.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Turn a bone so the direction to its child points along dir (figure space, figure at the
// origin and unrotated). Lets us pose a limb without knowing each bone's own axes.
function aimBone(bone, child, dir) {
  bone.updateWorldMatrix(true, true);
  const from = bone.getWorldPosition(new THREE.Vector3());
  const cur = child.getWorldPosition(new THREE.Vector3()).sub(from).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize());
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parent.invert().multiply(turn.multiply(world)));
  bone.updateWorldMatrix(false, true);
}

const _q = new THREE.Quaternion(), _axis = new THREE.Vector3(), _side = new THREE.Vector3();
// Turn a bone away from its rest pose by `angle` around `axis` (a world-space direction).
// Works without knowing each bone's own axes, like aimBone.
function swing(bone, rest, axis, angle) {
  bone.parent.getWorldQuaternion(_q).invert();
  _axis.copy(axis).applyQuaternion(_q);
  bone.quaternion.setFromAxisAngle(_axis, angle).multiply(rest);
}

// The seeker as Iso (if his model loaded): right arm out in front holding the Classic,
// whose mouth is where the flashlight shines from.
const ISO_SCALE = 0.85; // the model is 2.09 m tall; this makes him about 1.78 m

function isoSeeker() {
  const g = new THREE.Group();
  const iso = cloneIso();
  iso.children[0].position.set(0, 0, 0); // the file places him far from the origin
  iso.scale.setScalar(ISO_SCALE);
  g.add(iso);
  const bones = {};
  iso.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
  });
  g.updateMatrixWorld(true);
  // pose: right arm reaching forward, slightly down
  aimBone(bones.R_Shoulder, bones.R_Elbow, new THREE.Vector3(0.12, -0.32, -1));
  aimBone(bones.R_Elbow, bones.R_Hand, new THREE.Vector3(-0.06, -0.06, -1));
  g.updateMatrixWorld(true);

  // the Classic in his hand, pointing forward
  // (the rig's R_WeaponPoint bone isn't at the hand in this file, so use the hand itself:
  // halfway between the wrist and the middle knuckle is where a grip sits)
  const wrist = bones.R_Hand.getWorldPosition(new THREE.Vector3());
  const knuckle = bones.R_Middle1.getWorldPosition(new THREE.Vector3());
  const hand = wrist.lerp(knuckle, 0.6);
  const skin = buildNocturnum(settings.skin);
  const gun = new THREE.Group();
  gun.add(skin.group);
  gun.position.copy(hand).sub(new THREE.Vector3(0, -0.06, 0.045)); // put its grip in the hand
  gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.add(gun);
  g.userData.skin = skin;

  const lensPos = gun.position.clone().add(skin.lens);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  lens.position.copy(lensPos).add(new THREE.Vector3(0, 0, -0.01));
  lens.rotation.y = Math.PI;
  g.add(lens);
  g.userData.lens = lens;
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glareTexture(), color: 0xfff1dc, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0,
  }));
  glare.position.copy(lens.position);
  glare.scale.setScalar(1.6);
  g.add(glare);
  g.userData.glare = glare;
  g.userData.torchOffset = lensPos.clone().add(new THREE.Vector3(0, 0, -0.03));

  // walk cycle: legs and the free left arm swing; the gun arm stays put so the torch
  // (which shines from the gun) stays where the other screen expects it
  const limbs = ['L_Hip', 'R_Hip', 'L_Knee', 'R_Knee', 'L_Shoulder'];
  const rest = Object.fromEntries(limbs.map((n) => [n, bones[n].quaternion.clone()]));
  let phase = 0;
  g.userData.animate = (dt, speed, time, pose = {}) => {
    const struggle = pose.struggle ?? 0, lift = pose.lift ?? 0;
    const amt = THREE.MathUtils.smoothstep(speed, 0.2, 2.6) * (1 - lift), run = THREE.MathUtils.smoothstep(speed, 3.5, 5.2);
    phase += dt * speed * 2.6;
    const sin = Math.sin(phase), cos = Math.cos(phase);
    const hipA = (0.4 + run * 0.2) * amt;
    _side.set(1, 0, 0).applyQuaternion(g.getWorldQuaternion(new THREE.Quaternion())); // his left-right axis
    // + turns a leg forward; the knee bends back while that leg swings through
    // held up: the legs kick and dangle
    const kick = Math.sin(time * 9) * 0.3 * Math.max(lift, struggle * 0.5);
    swing(bones.L_Hip, rest.L_Hip, _side, sin * hipA + kick);
    swing(bones.R_Hip, rest.R_Hip, _side, -sin * hipA - kick);
    swing(bones.L_Knee, rest.L_Knee, _side, -(Math.max(0, cos) * (0.85 + run * 0.4) + 0.06) * amt);
    swing(bones.R_Knee, rest.R_Knee, _side, -(Math.max(0, -cos) * (0.85 + run * 0.4) + 0.06) * amt);
    // the free arm swings while walking, and flails while he struggles
    swing(bones.L_Shoulder, rest.L_Shoulder, _side, -sin * 0.35 * amt + Math.sin(time * 1.6) * 0.03 * (1 - amt)
      + (Math.sin(time * 11) * 0.6 + 0.5) * Math.max(struggle, lift));
    // the body dips a little at each stride; struggling twists it, the last grab lifts it
    iso.position.y = -sin * sin * 0.035 * amt;
    g.rotation.y += Math.sin(time * 16) * 0.12 * Math.max(struggle, lift);
    g.position.y += lift * 0.5;
  };
  return g;
}

export function seekerFigure() {
  if (isoReady()) return isoSeeker();
  return blockSeeker();
}

// fallback if the model didn't load: a simple person made of primitives
function blockSeeker() {
  const g = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.85 });
  const jeans = new THREE.MeshStandardMaterial({ color: 0x1d2433, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc69c7d, roughness: 0.6 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.9 });

  for (const s of [-1, 1]) {
    const leg = capsule(0.075, 0.7, jeans);
    leg.position.set(s * 0.1, 0.45, 0);
    g.add(leg);
  }
  const torso = capsule(0.2, 0.42, jacket);
  torso.scale.set(1, 1, 0.7);
  torso.position.y = 1.15;
  g.add(torso);
  const armL = capsule(0.06, 0.5, jacket);
  armL.position.set(-0.26, 1.1, 0);
  g.add(armL);
  // right arm held forward with the torch
  const armR = capsule(0.06, 0.45, jacket);
  armR.position.set(0.22, 1.3, -0.22);
  armR.rotation.x = Math.PI / 2.3;
  g.add(armR);
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6, roughness: 0.4 }));
  torch.rotation.x = Math.PI / 2;
  torch.position.set(0.22, 1.36, -0.5);
  g.add(torch);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  lens.position.set(0.22, 1.36, -0.601);
  lens.rotation.y = Math.PI;
  g.add(lens);
  g.userData.lens = lens;
  // glare you see when the torch points at you (opacity set every frame by the match)
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glareTexture(), color: 0xfff1dc, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0,
  }));
  glare.position.copy(lens.position);
  glare.scale.setScalar(1.6);
  g.add(glare);
  g.userData.glare = glare;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), skin);
  head.position.y = 1.58;
  head.castShadow = true;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), hair);
  cap.position.y = 1.6;
  g.add(cap);
  g.userData.torchOffset = new THREE.Vector3(0.22, 1.36, -0.62);
  return g;
}

// A red see-through copy of a figure, drawn on top of everything: how a revealed player
// looks (through trees and fog). Added as a child, hidden until a reveal.
const XRAY = new THREE.MeshBasicMaterial({ color: 0xff4655, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, fog: false });
export function addXray(figure) {
  const copies = [];
  const parts = [];
  figure.traverse((o) => { if (o.isMesh && o !== figure.userData.lens) parts.push(o); });
  for (const o of parts) {
    if (o.isSkinnedMesh) {
      // a skinned body: a second skinned mesh on the same skeleton, so it follows the pose
      const m = new THREE.SkinnedMesh(o.geometry, XRAY);
      m.bind(o.skeleton, o.bindMatrix);
      m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
      m.renderOrder = 999;
      m.frustumCulled = false;
      m.visible = false;
      o.parent.add(m);
      copies.push(m);
    } else {
      // a copy next to the original, so it moves with it when the figure animates
      // (Slenderman's bends its tentacles the same way his mesh does)
      let mat = XRAY;
      if (o.userData.bend) { mat = XRAY.clone(); mat.onBeforeCompile = o.userData.bend; }
      const m = new THREE.Mesh(o.geometry, mat);
      m.frustumCulled = o.frustumCulled;
      m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
      m.renderOrder = 999;
      m.visible = false;
      o.parent.add(m);
      copies.push(m);
    }
  }
  let on = false;
  figure.userData.xray = {
    get visible() { return on; },
    set visible(v) { if (v !== on) { on = v; copies.forEach((m) => { m.visible = v; }); } },
  };
  return figure.userData.xray;
}

// glow red while stunned (0..1)
export function setStunGlow(figure, k) {
  if (!figure.userData.mats) {
    const set = new Set();
    figure.traverse((o) => { if (o.isMesh && o.material.emissive && o.material !== XRAY) set.add(o.material); });
    figure.userData.mats = [...set];
  }
  for (const m of figure.userData.mats) m.emissive.setRGB(0.6 * k, 0.02 * k, 0.04 * k);
}
