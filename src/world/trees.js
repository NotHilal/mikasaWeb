// Procedural pine trees: a bark-textured trunk with root flare and dead lower branches,
// and a crown of needle-covered branch cards higher up. A few variants are built once
// and instanced across the forest.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './noise.js';

// --- trunk / branch tube -----------------------------------------------------

// A tapered tube along a spine of points. radius(t, angle) gives the radius at height t (0..1).
export function tube(spine, radius, radial, uScale, vScale) {
  const rings = spine.length;
  const pos = [], uv = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  const tan = new THREE.Vector3(), side = new THREE.Vector3(), fwd = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i < rings; i++) {
    if (i > 0) len += spine[i].distanceTo(spine[i - 1]);
    const a = spine[Math.max(0, i - 1)], b = spine[Math.min(rings - 1, i + 1)];
    tan.subVectors(b, a).normalize();
    side.crossVectors(Math.abs(tan.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : up, tan).normalize();
    fwd.crossVectors(tan, side).normalize();
    const t = i / (rings - 1);
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const r = radius(t, ang);
      const c = Math.cos(ang), s = Math.sin(ang);
      pos.push(spine[i].x + (side.x * c + fwd.x * s) * r, spine[i].y + (side.y * c + fwd.y * s) * r, spine[i].z + (side.z * c + fwd.z * s) * r);
      uv.push((j / radial) * uScale, len / vScale);
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function branchTube(start, dir, length, r0, r) {
  const spine = [];
  const droop = r.range(0.05, 0.25);
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    spine.push(start.clone().addScaledVector(dir, length * t).add(new THREE.Vector3(0, -droop * t * t * length, 0)));
  }
  return tube(spine, (t) => r0 * (1 - t * 0.85), 5, 1, 1.6);
}

// --- needle texture (painted on a canvas) ------------------------------------

function needleTexture() {
  const w = 256, h = 512;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const r = rng(99);
  // twig along the middle, needles fanning out to both sides, growing forward (up)
  const twigs = [[w / 2, h, w / 2, 10, 1]];
  for (let i = 0; i < 7; i++) {
    const y = h * (0.15 + i * 0.11);
    const dir = i % 2 ? 1 : -1;
    twigs.push([w / 2, y, w / 2 + dir * r.range(55, 95), y - r.range(60, 110), 0.6]);
  }
  for (const [x0, y0, x1, y1, scale] of twigs) {
    g.strokeStyle = '#3a2a1a';
    g.lineWidth = 3 * scale;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.floor(len / 2.2);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const base = Math.atan2(y1 - y0, x1 - x0);
      for (const side of [-1, 1]) {
        const ang = base + side * r.range(0.5, 1.1);
        const nl = r.range(16, 30) * scale * (1 - t * 0.35);
        const shade = r.range(0.6, 1);
        g.strokeStyle = `rgb(${Math.floor(38 * shade)},${Math.floor(62 * shade)},${Math.floor(30 * shade)})`;
        g.lineWidth = r.range(1.3, 2.2);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * nl, y + Math.sin(ang) * nl); g.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// one needle card: a flat quad lying along +X from the origin, length 1, width 0.55
function cardGeometry() {
  const g = new THREE.PlaneGeometry(0.55, 1, 1, 3);
  g.rotateZ(-Math.PI / 2);   // texture "up" now runs along +X
  g.rotateX(-Math.PI / 2);   // lie flat
  g.translate(0.5, 0, 0);
  // bend the card down along its length so branches droop
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - p.getX(i) * p.getX(i) * 0.18);
  g.computeVertexNormals();
  return g;
}

// --- a whole tree --------------------------------------------------------------

const SEG = 13; // trunk rings

function buildVariant(seed, card) {
  const r = rng(seed);
  const H = r.range(15, 22);
  const R = r.range(0.22, 0.34);
  const crownStart = H * r.range(0.45, 0.6);
  const lean = new THREE.Vector2(r.range(-0.4, 0.4), r.range(-0.4, 0.4));

  const spine = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const bend = Math.sin(t * Math.PI * r.range(0.8, 1.6)) * 0.25;
    spine.push(new THREE.Vector3(lean.x * t * t + bend * 0.3, t * H - 0.3, lean.y * t * t + bend * 0.2));
  }
  const lobes = 5 + r.int(3);
  const bark = [];
  bark.push(tube(spine, (t, a) => {
    const flare = 1 + 0.9 * Math.exp(-t * H * 2.2) * (0.75 + 0.25 * Math.sin(a * lobes));
    const taper = Math.max(0.035, R * (1 - t) ** 1.15);
    return taper * flare * (1 + Math.sin(a * 3 + t * 20) * 0.03);
  }, 10, Math.max(1, Math.round((2 * Math.PI * R) / 0.6)), 1.6));

  const at = (y) => {
    const t = (y + 0.3) / H;
    const i = Math.min(SEG - 1, Math.floor(t * SEG));
    return spine[i].clone().lerp(spine[i + 1], t * SEG - i);
  };
  const trunkR = (y) => Math.max(0.035, R * (1 - (y + 0.3) / H) ** 1.15);

  // dead stubs on the lower trunk
  const stubs = 6 + r.int(8);
  for (let i = 0; i < stubs; i++) {
    const y = r.range(2.2, crownStart);
    const ang = r() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(ang), r.range(-0.3, 0.15), Math.sin(ang)).normalize();
    const start = at(y).addScaledVector(dir, trunkR(y) * 0.6);
    bark.push(branchTube(start, dir, r.range(0.25, 0.9), r.range(0.015, 0.035), r));
  }

  // living crown: whorls of branches, each with a needle card
  const cards = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let y = crownStart; y < H - 0.6; y += r.range(0.55, 0.85)) {
    const t = (y - crownStart) / (H - crownStart); // 0 at crown bottom, 1 at top
    const len = THREE.MathUtils.lerp(2.6, 0.5, t) * r.range(0.8, 1.15);
    const n = 4 + r.int(3);
    const off = r() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const ang = off + (k / n) * Math.PI * 2 + r.range(-0.3, 0.3);
      const pitch = THREE.MathUtils.lerp(-0.25, 0.25, t) + r.range(-0.15, 0.15);
      const dir = new THREE.Vector3(Math.cos(ang) * Math.cos(pitch), Math.sin(pitch), Math.sin(ang) * Math.cos(pitch));
      const start = at(y);
      // only the lowest, longest branches need wood under their needles
      if (t < 0.25 && k % 2 === 0) bark.push(branchTube(start, dir, len * 0.8, 0.03 + 0.02 * (1 - t), r));
      // one card per branch, scaled to the branch length, rolled a little so the crown has depth
      e.set(r.range(-0.5, 0.5), -ang, pitch, 'YZX');
      q.setFromEuler(e);
      m.compose(start, q, new THREE.Vector3(len, len, len * 1.25));
      cards.push(card.clone().applyMatrix4(m));
    }
  }
  // top tuft
  for (let k = 0; k < 4; k++) {
    e.set(0, (k / 4) * Math.PI * 2, 1.2, 'YZX');
    q.setFromEuler(e);
    m.compose(at(H - 0.9), q, new THREE.Vector3(1.1, 1.1, 1.1));
    cards.push(card.clone().applyMatrix4(m));
  }

  // trunk(y): the trunk's centre and radius at height y (the tree's own space), for pinning pages
  const trunk = (y) => ({ c: at(y), r: trunkR(y) * (1 + 0.9 * Math.exp(-(y + 0.3) * 2.2)) });
  return { bark: mergeGeometries(bark), needles: mergeGeometries(cards), radius: R, height: H, trunk };
}

export function treeKit(loader) {
  const load = (f, srgb) => {
    const t = loader.load(`assets/tex/pine_bark/${f}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const arm = load('arm');
  const barkMat = new THREE.MeshStandardMaterial({
    map: load('diff', true), normalMap: load('nor_gl'), roughnessMap: arm, aoMap: arm,
    metalness: 0, roughness: 1, normalScale: new THREE.Vector2(1.5, 1.5),
  });
  const needleMat = new THREE.MeshStandardMaterial({
    map: needleTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0,
  });
  const card = cardGeometry();
  const variants = [11, 23, 37, 41, 59, 67].map((s) => buildVariant(s, card));
  return { barkMat, needleMat, variants };
}
