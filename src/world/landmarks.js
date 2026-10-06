// Landmarks: a few recognisable places spread around the forest (an abandoned cabin, a
// wrecked car, a water tank, a campsite, a ruined wall, a hunting stand, big rocks), like
// the ones in Slender. Each round the pages are pinned to some of them, so players know
// where to search. Built once from the map seed, the same on every client.
import * as THREE from 'three';
import { rng } from './noise.js';
import { MAP } from '../config.js';

// --- painted textures ---------------------------------------------------------------

function canvasTex(draw, w = 256, h = 256, repeat = [1, 1]) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}

function blotches(g, w, h, colors, n, size) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    g.globalAlpha = 0.15 + Math.random() * 0.3;
    g.beginPath();
    g.ellipse(Math.random() * w, Math.random() * h, size * (0.3 + Math.random()), size * (0.2 + Math.random() * 0.6), Math.random() * 3, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;
}

// weathered vertical boards
const planks = () => canvasTex((g, w, h) => {
  const boards = 6, bw = w / boards;
  for (let i = 0; i < boards; i++) {
    const v = 0.75 + Math.random() * 0.35;
    g.fillStyle = `rgb(${Math.floor(78 * v)},${Math.floor(62 * v)},${Math.floor(46 * v)})`;
    g.fillRect(i * bw, 0, bw, h);
    for (let k = 0; k < 18; k++) { // grain
      g.strokeStyle = `rgba(30,20,12,${0.1 + Math.random() * 0.2})`;
      g.lineWidth = 1;
      const x = i * bw + Math.random() * bw;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 6, h); g.stroke();
    }
    g.fillStyle = 'rgba(15,10,6,0.9)'; // gap between boards
    g.fillRect(i * bw, 0, 2, h);
  }
  blotches(g, w, h, ['#6b6b62', '#2a2016'], 30, 30); // grey weathering, dark rot
});

const rust = () => canvasTex((g, w, h) => {
  g.fillStyle = '#4b3324';
  g.fillRect(0, 0, w, h);
  blotches(g, w, h, ['#8a4a22', '#6e3a1c', '#2a1a12', '#46525c', '#5b616a'], 160, 26);
});

const stoneBlocks = () => canvasTex((g, w, h) => {
  g.fillStyle = '#3a3a38';
  g.fillRect(0, 0, w, h);
  const rows = 6, rh = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -20 : 0;
    while (x < w) {
      const bw = 34 + Math.random() * 30, v = 0.7 + Math.random() * 0.4;
      g.fillStyle = `rgb(${Math.floor(102 * v)},${Math.floor(100 * v)},${Math.floor(94 * v)})`;
      g.fillRect(x + 2, r * rh + 2, bw - 4, rh - 4);
      x += bw;
    }
  }
  blotches(g, w, h, ['#3d4a2a', '#24261e', '#7a7a70'], 50, 22); // moss and stains
}, 256, 256, [1, 1]);

const canvasCloth = () => canvasTex((g, w, h) => {
  g.fillStyle = '#3e4636';
  g.fillRect(0, 0, w, h);
  blotches(g, w, h, ['#2a3024', '#55604a', '#3a2c20'], 80, 30);
  for (let i = 0; i < 10; i++) { // folds
    g.strokeStyle = 'rgba(20,24,16,0.4)';
    g.lineWidth = 3;
    const x = Math.random() * w;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 40, h); g.stroke();
  }
});

// --- building blocks --------------------------------------------------------------------

function kit(rocks) {
  return {
    wood: new THREE.MeshStandardMaterial({ map: planks(), roughness: 0.95 }),
    rust: new THREE.MeshStandardMaterial({ map: rust(), roughness: 0.75, metalness: 0.45 }),
    stone: new THREE.MeshStandardMaterial({ map: stoneBlocks(), roughness: 0.95 }),
    cloth: new THREE.MeshStandardMaterial({ map: canvasCloth(), roughness: 1, side: THREE.DoubleSide }),
    dark: new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.6, metalness: 0 }), // grimy glass, charcoal
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
    ember: new THREE.MeshStandardMaterial({ color: 0x1a0d08, emissive: 0x6a1e05, emissiveIntensity: 1.2, roughness: 1 }),
    rocks,
  };
}

// A landmark is built in its own space (+z is its front, where the page faces) and then
// placed in the world. `solid` collects collision circles, `spots` page positions.
function makeSite() {
  const group = new THREE.Group();
  const solid = []; // { x, z, r, h }
  const spots = []; // { x, y, z, face }
  const box = (w, h, d, mat, x, y, z, ry = 0, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  // a row of collision circles along a wall from (x0, z0) to (x1, z1)
  const wall = (x0, z0, x1, z1, r, h) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / (r * 1.4)));
    for (let i = 0; i <= n; i++) solid.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n, r, h });
  };
  return { group, solid, spots, box, wall };
}

const SITES = {
  cabin(K) {
    const s = makeSite();
    const W = 4.6, D = 3.6, H = 2.5, T = 0.18, door = 1.2, doorX = 0.7;
    s.box(W, H, T, K.wood, 0, H / 2, -D / 2);                            // back
    s.box(T, H, D, K.wood, -W / 2, H / 2, 0);                            // sides
    s.box(T, H, D, K.wood, W / 2, H / 2, 0);
    const leftW = doorX - door / 2 + W / 2, rightW = W / 2 - (doorX + door / 2);
    s.box(leftW, H, T, K.wood, -W / 2 + leftW / 2, H / 2, D / 2);         // front, with a doorway
    s.box(rightW, H, T, K.wood, W / 2 - rightW / 2, H / 2, D / 2);
    s.box(door, 0.4, T, K.wood, doorX, H - 0.2, D / 2);
    const door3d = s.box(door * 0.95, H - 0.45, 0.06, K.wood, doorX + door / 2 - 0.05, (H - 0.45) / 2, D / 2 + 0.45, 1.2); // hanging open
    door3d.position.x = doorX + door / 2 + 0.25;
    for (const side of [-1, 1]) s.box(W + 0.6, 0.12, D / 2 + 0.6, K.wood, 0, H + 0.42, side * (D / 4 + 0.15), 0, side * 0.5); // roof
    s.box(1.0, 0.7, 0.05, K.dark, -1.3, 1.5, D / 2 + 0.07);              // dark window
    s.wall(-W / 2, -D / 2, W / 2, -D / 2, 0.25, H);
    s.wall(-W / 2, -D / 2, -W / 2, D / 2, 0.25, H);
    s.wall(W / 2, -D / 2, W / 2, D / 2, 0.25, H);
    s.wall(-W / 2, D / 2, doorX - door / 2 - 0.1, D / 2, 0.25, H);
    s.wall(doorX + door / 2 + 0.1, D / 2, W / 2, D / 2, 0.25, H);
    s.spots.push({ x: -0.3, y: 1.45, z: D / 2 + T / 2 + 0.01, face: 0 });
    s.spots.push({ x: 0, y: 1.45, z: -D / 2 + T / 2 + 0.01, face: 0 }); // inside, on the back wall
    return { ...s, clear: 6.5 };
  },

  car(K) {
    const s = makeSite();
    s.box(4.2, 0.75, 1.8, K.rust, 0, 0.62, 0);                            // body
    s.box(2.2, 0.72, 1.62, K.rust, -0.25, 1.35, 0);                       // cabin
    s.box(2.0, 0.55, 1.66, K.dark, -0.25, 1.36, 0);                       // windows
    s.box(1.3, 0.08, 1.7, K.rust, 1.45, 1.1, 0, 0, 0, -0.5);              // hood, sprung open
    for (const x of [-1.35, 1.35]) for (const z of [-0.85, 0.85]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16), K.rubber);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.3, z);
      w.castShadow = true;
      s.group.add(w);
    }
    s.group.rotation.z = 0.04; // sagging on one side
    s.wall(-2.0, 0, 2.0, 0, 0.95, 1.7);
    s.spots.push({ x: 0.15, y: 0.95, z: 0.91, face: 0 });                 // on the driver's door
    return { ...s, clear: 5 };
  },

  tank(K) {
    const s = makeSite();
    for (const x of [-1.2, 1.2]) for (const z of [-1.2, 1.2]) {
      s.box(0.2, 3.2, 0.2, K.wood, x, 1.6, z);
      s.solid.push({ x, z, r: 0.25, h: 3.2 });
    }
    s.box(2.6, 0.08, 0.12, K.wood, 0, 1.2, 1.2, 0, 0, 0.6);               // cross braces
    s.box(2.6, 0.08, 0.12, K.wood, 0, 1.2, -1.2, 0, 0, -0.6);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 24), K.rust);
    tank.position.y = 4.4;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.75, 0.8, 24), K.rust);
    roof.position.y = 6.0;
    tank.castShadow = roof.castShadow = true;
    s.group.add(tank, roof);
    for (const x of [-0.25, 0.25]) s.box(0.06, 4.6, 0.06, K.rust, x, 2.3, 1.75); // ladder
    for (let y = 0.4; y < 4.5; y += 0.4) s.box(0.5, 0.04, 0.04, K.rust, 0, y, 1.75);
    s.spots.push({ x: 1.2, y: 1.5, z: 1.31, face: 0 });                   // on a leg
    return { ...s, clear: 5 };
  },

  camp(K) {
    const s = makeSite();
    // a ridge tent: a triangular prism, its front facing +z
    const tent = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 2.6, 3, 1), K.cloth);
    tent.rotation.set(Math.PI / 2, 0, 0);
    tent.rotateY(Math.PI); // one edge up
    tent.position.set(0, 0.6, -0.6);
    tent.castShadow = true;
    s.group.add(tent);
    s.wall(0, -1.9, 0, 0.7, 1.0, 1.8);
    // fire pit: a ring of stones, charred logs and glowing embers
    const rock = K.rocks[0];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const m = new THREE.Mesh(rock.geometry, rock.material);
      m.scale.setScalar(0.18);
      m.position.set(Math.cos(a) * 0.65, 0.05, 2.4 + Math.sin(a) * 0.65);
      m.rotation.y = a * 3;
      s.group.add(m);
    }
    s.box(0.9, 0.12, 0.12, K.dark, 0, 0.1, 2.4, 0.7);
    s.box(0.9, 0.12, 0.12, K.dark, 0, 0.14, 2.4, -0.7);
    s.box(0.5, 0.05, 0.5, K.ember, 0, 0.06, 2.4);
    s.solid.push({ x: 0, z: 2.4, r: 0.75, h: 0.4 });
    s.box(1.8, 0.35, 0.35, K.wood, -1.8, 0.18, 2.6, 0.4);                 // a log to sit on
    s.spots.push({ x: 0, y: 0.75, z: 0.71, face: 0 });                     // on the tent's front
    return { ...s, clear: 6 };
  },

  ruin(K) {
    const s = makeSite();
    const segs = [[-3.2, 1.0, 1.1], [-1.9, 1.3, 2.1], [-0.4, 1.4, 1.6], [1.3, 1.2, 2.3], [2.8, 0.9, 0.9]];
    for (const [x, w, h] of segs) {
      s.box(w, h, 0.5, K.stone, x, h / 2, 0);
      s.wall(x - w / 2, 0, x + w / 2, 0, 0.32, h);
    }
    s.box(0.5, 1.6, 2.2, K.stone, -3.6, 0.8, -1.1);                      // a corner going back
    s.wall(-3.6, -2.2, -3.6, 0, 0.32, 1.6);
    s.spots.push({ x: 1.3, y: 1.45, z: 0.26, face: 0 });
    s.spots.push({ x: -1.9, y: 1.45, z: 0.26, face: 0 });
    return { ...s, clear: 5.5 };
  },

  stand(K) {
    const s = makeSite();
    for (const x of [-0.8, 0.8]) for (const z of [-0.8, 0.8]) {
      s.box(0.15, 3.3, 0.15, K.wood, x, 1.65, z);
      s.solid.push({ x, z, r: 0.2, h: 3.3 });
    }
    s.box(2.0, 0.1, 2.0, K.wood, 0, 2.8, 0);                              // platform
    for (const z of [-0.95, 0.95]) s.box(2.0, 0.08, 0.08, K.wood, 0, 3.4, z); // rails
    for (const x of [-0.95, 0.95]) s.box(0.08, 0.08, 2.0, K.wood, x, 3.4, 0);
    for (let y = 0.35; y < 2.8; y += 0.35) s.box(0.7, 0.05, 0.06, K.wood, 0, y, 0.9); // ladder rungs
    s.spots.push({ x: -0.8, y: 1.5, z: 0.89, face: 0 });
    return { ...s, clear: 4.5 };
  },

  rocks(K) {
    const s = makeSite();
    const big = [[0, 0, 2.4, 0.3], [-2.2, 0.6, 1.7, 1.9], [1.9, -0.9, 1.4, 4.1]];
    for (const [x, z, sc, rot] of big) {
      const v = K.rocks[Math.floor(rot * 10) % K.rocks.length];
      const m = new THREE.Mesh(v.geometry, v.material);
      const bb = v.geometry.boundingBox;
      m.scale.setScalar(sc);
      m.position.set(x, -bb.min.y * sc * 0.6, z);
      m.rotation.y = rot;
      m.castShadow = m.receiveShadow = true;
      s.group.add(m);
      s.solid.push({ x, z, r: Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.45 * sc, h: bb.max.y * sc * 1.2 });
    }
    // a weathered post in front of them, with a page on it
    s.box(0.14, 1.9, 0.14, K.wood, 0.4, 0.95, 2.6);
    s.solid.push({ x: 0.4, z: 2.6, r: 0.18, h: 1.9 });
    s.spots.push({ x: 0.4, y: 1.4, z: 2.68, face: 0 });
    return { ...s, clear: 6 };
  },
};

// Build every landmark at its spot. Returns [{ name, x, z, clear, spots: [{ pos, face }] }].
export function buildLandmarks(scene, height, colliders, rocks) {
  const K = kit(rocks);
  const r = rng(MAP.seed + 500);
  const names = Object.keys(SITES);
  for (let i = names.length - 1; i > 0; i--) { const j = r.int(i + 1); [names[i], names[j]] = [names[j], names[i]]; }
  const off = r() * Math.PI * 2;
  return names.map((name, i) => {
    const ang = off + (i / names.length) * Math.PI * 2 + r.range(-0.25, 0.25);
    const dist = i % 2 ? r.range(44, 56) : r.range(20, 32);
    const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
    const site = SITES[name](K);
    // face roughly towards the middle of the map, so the page side is seen from inside
    const rotY = Math.atan2(-x, -z) + r.range(-0.6, 0.6);
    const g = site.group;
    g.rotation.y = rotY;
    g.position.set(x, height.heightAt(x, z) - 0.12, z);
    scene.add(g);
    g.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    for (const c of site.solid) {
      v.set(c.x, 0, c.z).applyMatrix4(g.matrixWorld);
      colliders.add(v.x, v.z, c.r, g.position.y + c.h);
    }
    const spots = site.spots.map((sp) => ({ pos: new THREE.Vector3(sp.x, sp.y, sp.z).applyMatrix4(g.matrixWorld), face: sp.face + rotY }));
    return { name, x, z, clear: site.clear, spots };
  });
}
