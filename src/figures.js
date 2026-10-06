// The other player's body, as seen by you. Placeholder models built from primitives
// (no animation yet): a very tall, thin figure in a black suit for the hunter, and a
// person in a jacket holding a torch for the seeker.
import * as THREE from 'three';

const capsule = (r, len, mat) => {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat);
  m.castShadow = true;
  return m;
};

export function hunterFigure() {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.65 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xbdbdb8, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe6e3dd, roughness: 0.45 });

  for (const s of [-1, 1]) {
    const leg = capsule(0.07, 1.25, suit);
    leg.position.set(s * 0.11, 0.7, 0);
    g.add(leg);
    const arm = capsule(0.05, 1.25, suit);
    arm.position.set(s * 0.3, 1.62, 0.02);
    arm.rotation.z = s * 0.06;
    g.add(arm);
    const hand = capsule(0.035, 0.18, skin);
    hand.position.set(s * 0.34, 0.92, 0.03);
    g.add(hand);
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

export function seekerFigure() {
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
