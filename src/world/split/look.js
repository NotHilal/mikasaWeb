// Split's materials: scanned textures (Poly Haven, CC0, in public/assets/tex/; `npm run assets`
// fetches them) for the stone, plaster, wood, tiles and metal, and textures drawn in code for the
// signs, lit windows, paper screens, vending machines and lanterns that light the streets at night.
import * as THREE from 'three';
import { rng } from '../noise.js';

// [texture, metres per repeat]
const SCANNED = {
  pavers: ['concrete_pavers_02', 2.4],
  asphalt: ['asphalt_02', 4],
  concreteFloor: ['concrete_floor_worn_001', 3],
  tileFloor: ['worn_tile_floor', 1.6],
  stucco: ['white_stucco', 3],
  plaster: ['plastered_wall', 3],
  concrete: ['concrete_wall_008', 3],
  facade: ['rectangular_facade_tiles', 1.6],
  cedar: ['japanese_cedar_planks', 1.6],
  hinoki: ['hinoki_planks', 2],
  roof: ['grey_roof_tiles', 2.2],
  shutter: ['painted_metal_shutter', 1.6],
  corrugated: ['corrugated_iron_02', 1.6],
  plate: ['metal_plate', 1.6],
  darkWood: ['dark_wood', 1.6],
};

export function splitMaterials(loader) {
  const tex = (path, color) => {
    const t = loader.load(path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const m = {};
  for (const [name, [id, scale]] of Object.entries(SCANNED)) {
    const arm = tex(`assets/tex/${id}/arm.jpg`);
    m[name] = new THREE.MeshStandardMaterial({
      map: tex(`assets/tex/${id}/diff.jpg`, true), normalMap: tex(`assets/tex/${id}/nor_gl.jpg`),
      roughnessMap: arm, metalnessMap: arm, aoMap: arm,
    });
    m[name].userData.scale = scale; // (the geometry's UVs are in metres / scale)
  }
  // tints and finishes on the same textures
  m.stucco.color.set(0xd9d4ca);
  m.plaster.color.set(0xcfc6b6);
  m.darkWood.color.set(0x8a7766);
  m.shutter.color.set(0xa9b0b4);
  m.plate.metalness = 1;
  // it has rained: the streets are a little glossy, so lamps and signs catch on them
  m.pavers.roughness = 0.62;
  m.asphalt.roughness = 0.55;
  m.puddle = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  m.puddle.userData.scale = 1;
  m.sewerFloor = m.concreteFloor.clone(); // wet
  m.sewerFloor.roughness = 0.35;
  m.sewerFloor.color.set(0x8c8a84);
  m.sewerFloor.userData.scale = 3;
  // plain finishes
  const plain = (color, rough = 0.8, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  m.black = plain(0x16171a, 0.6, 0.3);       // poles, brackets, frames
  m.steel = plain(0x6d7378, 0.45, 0.8);      // railings, pipes
  m.rope = plain(0x8a7350, 1);
  m.cable = plain(0x0c0c0e, 0.7);
  m.glass = plain(0x0b1016, 0.12, 0.6);      // dark windows: a little reflection
  m.paint = plain(0xe8e2d0, 0.7, 0, { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const k of ['black', 'steel', 'rope', 'cable', 'glass']) m[k].userData.scale = 1;
  return m;
}

// --- textures drawn in code -----------------------------------------------------------------

const canvas = (w, h, draw) => {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};
// something glowing: its texture is also its light
export const glowing = (map, intensity = 1.6, extra = {}) => new THREE.MeshStandardMaterial({
  map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: intensity, roughness: 0.6, ...extra,
});

const NEON = ['#ff4fa3', '#47e5ff', '#ffd23f', '#7cff6b', '#ff7a3d', '#c77dff'];
const WORDS = ['ラーメン', '居酒屋', '寿司', 'カラオケ', '喫茶', '薬局', '酒', '焼鳥', '本屋', 'うどん', '宿', '分裂'];

// a vertical neon sign: a dark board with glowing characters, top to bottom
export function neonSign(seed) {
  const r = rng(seed), color = NEON[r.int(NEON.length)], word = WORDS[r.int(WORDS.length)];
  return canvas(96, 384, (g, w, h) => {
    g.fillStyle = '#0c0a10'; g.fillRect(0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 4; g.shadowColor = color; g.shadowBlur = 14;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.font = '600 64px "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    const chars = [...word], step = (h - 40) / Math.max(chars.length, 2);
    chars.forEach((c, i) => {
      g.shadowBlur = 18; g.fillStyle = color; g.fillText(c, w / 2, 20 + step * (i + 0.5));
      g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillText(c, w / 2, 20 + step * (i + 0.5));
    });
  });
}

// a horizontal shop sign board, lit from inside
export function shopSign(seed) {
  const r = rng(seed), word = WORDS[r.int(WORDS.length)];
  const bg = ['#f3eee2', '#1d2b4a', '#7a1d1d', '#1e3b2a'][r.int(4)], ink = bg === '#f3eee2' ? '#1a1a1a' : '#f6efe0';
  return canvas(512, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, h - 14, w, 14);
    g.font = '600 76px "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = ink;
    g.fillText(word, w / 2, h / 2 + 4);
  });
}

// a lit shop window: warm light, shelves and the shapes of things on them
export function shopWindow(seed) {
  const r = rng(seed);
  return canvas(256, 192, (g, w, h) => {
    const warm = r() < 0.7;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, warm ? '#ffdca0' : '#d8f0ff'); grad.addColorStop(1, warm ? '#c98a4a' : '#7aa0b8');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let y = 40; y < h; y += 48) {
      g.fillStyle = 'rgba(40,25,15,0.7)'; g.fillRect(0, y, w, 5);
      for (let x = 6; x < w - 10;) {
        const bw = 8 + r() * 22, bh = 10 + r() * 26;
        g.fillStyle = `hsla(${r() * 360}, ${30 + r() * 40}%, ${25 + r() * 35}%, 0.9)`;
        g.fillRect(x, y - bh, bw, bh);
        x += bw + 3 + r() * 6;
      }
    }
    // a figure behind the counter, sometimes
    if (r() < 0.3) { g.fillStyle = 'rgba(30,20,15,0.6)'; g.beginPath(); g.ellipse(w * 0.7, h * 0.42, 16, 20, 0, 0, Math.PI * 2); g.fill(); g.fillRect(w * 0.7 - 24, h * 0.52, 48, 80); }
  });
}

// an upstairs window at night: a warm lit room with curtains, or blinds
export function litWindow(seed) {
  const r = rng(seed);
  return canvas(128, 160, (g, w, h) => {
    const hue = 28 + r() * 18;
    g.fillStyle = `hsl(${hue}, 70%, ${55 + r() * 15}%)`; g.fillRect(0, 0, w, h);
    if (r() < 0.5) { // blinds
      for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(80,50,20,0.35)'; g.fillRect(0, y, w, 3); }
    } else { // curtains
      g.fillStyle = `hsla(${r() * 360}, 35%, 30%, 0.85)`;
      g.fillRect(0, 0, w * (0.18 + r() * 0.2), h); g.fillRect(w * (0.62 + r() * 0.2), 0, w, h);
    }
    g.strokeStyle = 'rgba(30,20,10,0.8)'; g.lineWidth = 6; g.strokeRect(0, 0, w, h);
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
  });
}

// shoji: a wooden lattice over paper, lit softly from behind
export function shoji() {
  return canvas(256, 384, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h * 0.45, 20, w / 2, h / 2, h * 0.7);
    grad.addColorStop(0, '#fff3d6'); grad.addColorStop(1, '#d9b98a');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3b2a1c';
    g.fillRect(0, 0, w, 10); g.fillRect(0, h - 14, w, 14); g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h);
    for (let x = 1; x < 4; x++) g.fillRect((w * x) / 4 - 2, 0, 4, h);
    for (let y = 1; y < 6; y++) g.fillRect(0, (h * y) / 6 - 2, w, 4);
  });
}

// a vending machine's front: rows of lit drinks and their buttons
export function vendingFront(seed) {
  const r = rng(seed);
  return canvas(128, 256, (g, w, h) => {
    g.fillStyle = '#e9f3ff'; g.fillRect(0, 0, w, h * 0.62);
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 6; i++) {
        const x = 8 + i * 19, y = 10 + row * 36;
        g.fillStyle = `hsl(${r() * 360}, ${50 + r() * 40}%, ${40 + r() * 25}%)`;
        g.fillRect(x, y, 13, 26);
        g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 2, y + 2, 3, 20);
        g.fillStyle = '#ff3b3b'; g.fillRect(x + 4, y + 29, 5, 3);
      }
    }
    g.fillStyle = '#20262e'; g.fillRect(0, h * 0.62, w, h);
    g.fillStyle = '#0b0d10'; g.fillRect(16, h * 0.82, w - 32, 26);
    g.fillStyle = '#58f08a'; g.fillRect(w - 34, h * 0.68, 20, 8);
  });
}

// a paper lantern (chōchin): red or white, a character on it, darker ribs
export function lanternPaper(seed) {
  const r = rng(seed), red = r() < 0.65;
  return canvas(128, 128, (g, w, h) => {
    g.fillStyle = red ? '#e0412e' : '#f6ecd6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = red ? 'rgba(90,10,0,0.35)' : 'rgba(80,60,30,0.3)'; g.lineWidth = 2;
    for (let y = 8; y < h; y += 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.font = '700 64px "Noto Sans JP", "Yu Gothic", "Meiryo", serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = red ? '#1a0a05' : '#a31d12';
    g.fillText(['祭', '酒', '宿', '茶'][r.int(4)], w / 4, h / 2);
    g.fillText(['祭', '酒', '宿', '茶'][r.int(4)], (w * 3) / 4, h / 2);
  });
}

// the big letter painted on a spike site, and the site's outline
export function siteLetter(letter) {
  const t = canvas(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = '400 420px "Bebas Neue", "Barlow Condensed", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(232, 224, 200, 0.85)'; g.fillText(letter, w / 2, h / 2 + 20);
    // worn: speckle it away
    const r = rng(letter.charCodeAt(0));
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.5})`; g.fillRect(r() * w, r() * h, 2 + r() * 5, 2 + r() * 5); }
  });
  return t;
}

// lit windows for the far-off towers around the map
export function towerWindows(seed) {
  const r = rng(seed);
  const t = canvas(128, 512, (g, w, h) => {
    g.fillStyle = '#05060a'; g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 12) {
      for (let x = 4; x < w; x += 10) {
        if (r() < 0.22) { g.fillStyle = `hsl(${30 + r() * 25}, 80%, ${45 + r() * 25}%)`; g.fillRect(x, y, 6, 7); }
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
