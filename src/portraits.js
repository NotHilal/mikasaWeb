// Role-select portraits: renders the actual 3D characters (Iso with the Classic, and the
// hunter) once, agent-select style, and puts the pictures on the role cards. The same pictures,
// plus head shots, are drawn in How to play (characterImages).
import * as THREE from 'three';
import { seekerFigure, hunterFigure } from './figures.js';

// focus / span: frame `span` metres of the figure around the height `focus` (a head shot);
// without them, the whole figure
function portrait(figure, { rim, rimPower = 4, height, w = 480, h = 720, focus, span, turn = 0.45 }) {
  // a small separate renderer with a transparent background; thrown away afterwards
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(w, h, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xb8c4e0, 0x1a1420, 1.4));
  const key = new THREE.DirectionalLight(0xfff2e6, 2.6);
  key.position.set(1.5, 2.5, -2.5); // in front of the figure (it faces -z), up and to the side
  scene.add(key);
  // coloured rim lights from behind, like Valorant's agent select
  for (const x of [-2, 2]) {
    const r = new THREE.DirectionalLight(rim, rimPower);
    r.position.set(x, 1.5, 2.5);
    scene.add(r);
  }
  figure.rotation.y = Math.PI + turn; // turn to face the camera, a little to the side
  scene.add(figure);
  figure.traverse((o) => { if (o.isSprite) o.visible = false; }); // no torch glare in the picture
  const cam = new THREE.PerspectiveCamera(26, w / h, 0.1, 50);
  if (focus) {
    cam.position.set(0, focus, span / (2 * Math.tan(THREE.MathUtils.degToRad(13))));
    cam.lookAt(0, focus, 0);
  } else {
    cam.position.set(0, height * 0.55, height * 2.45); // a little headroom above the figure
    cam.lookAt(0, height * 0.5, 0);
  }
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}

const LOOK = {
  seeker: { rim: 0x3fe0c5, height: 1.8, head: 1.62 },
  hunter: { rim: 0x8a6cff, rimPower: 1.6, height: 2.7, head: 2.56 },
};
const images = {}; // rendered pictures, kept: seeker / hunter (whole), seekerHead / hunterHead

export function renderRolePortraits() {
  const cards = [
    ['.seeker-art', 'seeker', () => seekerFigure(), 'rgba(63, 224, 197, 0.35)'],
    ['.hunter-art', 'hunter', () => hunterFigure(), 'rgba(155, 61, 255, 0.4)'],
  ];
  for (const [sel, who, make, glow] of cards) {
    try {
      const url = images[who] ??= portrait(make(), LOOK[who]);
      const el = document.querySelector(sel);
      el.style.backgroundImage = `url(${url}), radial-gradient(ellipse at 50% 100%, ${glow}, transparent 65%)`;
      el.classList.add('rendered');
    } catch (e) {
      console.warn('portrait failed', e); // the drawing stays
    }
  }
}

// the characters' pictures for How to play (rendered the first time they're asked for):
// { seeker, hunter } whole, { seekerHead, hunterHead } head and shoulders, as image URLs
export function characterImages() {
  try {
    images.seeker ??= portrait(seekerFigure(), LOOK.seeker);
    images.hunter ??= portrait(hunterFigure(), LOOK.hunter);
    images.seekerHead ??= portrait(seekerFigure(), { ...LOOK.seeker, w: 192, h: 192, focus: LOOK.seeker.head - 0.05, span: 0.55, turn: 0.2 });
    images.hunterHead ??= portrait(hunterFigure(), { ...LOOK.hunter, w: 192, h: 192, focus: LOOK.hunter.head - 0.08, span: 0.75, turn: 0.2 });
  } catch (e) {
    console.warn('character pictures failed', e); // How to play falls back to plain shapes
  }
  return images;
}
