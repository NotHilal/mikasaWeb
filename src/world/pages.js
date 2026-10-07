// The pages themselves (the same on every map): a sheet of worn paper with its number, pinned
// where the map's pickPages chose.
import * as THREE from 'three';
import { rng } from './noise.js';
import { PAGES } from '../config.js';

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

const pageGeo = new THREE.PlaneGeometry(0.21, 0.29);
const tilt = (n) => rng(n * 977)();
// the paper's own faint glow: enough to make out a pale shape close by in the dark, but it
// takes the flashlight to really see it (it was 0.32: bright enough to spot from far off)
const PAGE_GLOW = 0.05;

// pin page meshes into `parent` where pickPages chose ([{ pos, face, n }]); returns [{ mesh, pos, n }]
export function placePages(parent, chosen) {
  return chosen.map(({ pos, face, n }) => {
    const map = pageTexture(n);
    const mesh = new THREE.Mesh(pageGeo, new THREE.MeshStandardMaterial({
      map, color: 0xb0b0b0, roughness: 0.9, side: THREE.DoubleSide,
      emissive: 0xffffff, emissiveMap: map, emissiveIntensity: PAGE_GLOW,
    }));
    mesh.position.copy(pos);
    mesh.rotation.set(0, face, (tilt(n) - 0.5) * 0.3);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return { mesh, pos: mesh.position, n };
  });
}
