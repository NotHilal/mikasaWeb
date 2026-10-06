// The seeker's first-person pistol: a Nocturnum-style Classic (see skins/nocturnum.js) held in
// a gloved hand. The flashlight shines out of its mouth. Lives in engine.viewScene so it's
// drawn over the world. Y plays an inspect animation with the floating sphere, which also
// loads the gun when it reloads.
import * as THREE from 'three';
import { buildNocturnum } from './skins/nocturnum.js';
import { settings } from './settings.js';

const BASE = new THREE.Vector3(0.095, -0.118, -0.27); // camera-space rest position
const INSPECT_TIME = 2.8;

function buildHand() {
  const g = new THREE.Group();
  const glove = new THREE.MeshStandardMaterial({ color: 0x1e2226, roughness: 0.9 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.95 });
  const hand = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.05, 4, 10), glove);
  hand.scale.set(1.15, 1, 0.9);
  hand.position.set(0.004, -0.072, 0.05);
  hand.rotation.x = 0.32;
  // short enough that it never reaches past the camera (that drew a sliver across the screen)
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.17, 12), sleeve);
  arm.position.set(0.012, -0.11, 0.13);
  arm.rotation.x = Math.PI / 2 - 0.45;
  g.add(hand, arm);
  g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return g;
}

const ease = (k) => k * k * (3 - 2 * k);

export function createViewmodel(viewScene) {
  const pivot = new THREE.Group();   // follows the camera
  const holder = new THREE.Group();  // sway, bob, recoil
  const gun = new THREE.Group();
  gun.rotation.set(-0.03, 0.27, -0.05); // pointing away, turned enough that the painted side (jaw, teeth, glow) shows beside the crest
  gun.add(buildHand());
  holder.add(gun);
  let skin = null;
  // swap the skin (colour variant) in place
  function setSkin(variant) {
    if (skin) { gun.remove(skin.group); holder.remove(skin.orb); }
    skin = buildNocturnum(variant);
    gun.add(skin.group);
    holder.add(skin.orb);
    flashSprite.material.color.set(skin.color).lerp(new THREE.Color(0xffc070), 0.5);
    flashSprite.position.copy(skin.muzzle).add(new THREE.Vector3(0, 0, -0.02));
  }
  pivot.add(holder);
  viewScene.add(pivot);
  // light bouncing back off whatever the torch is pointed at, plus a faint cool rim
  const bounce = new THREE.PointLight(0xffe2c0, 1.2, 1.5, 1);
  bounce.position.set(0.05, 0.05, -0.9);
  pivot.add(bounce);
  const rim = new THREE.DirectionalLight(0xcfc8dc, 1.6); // (near neutral: the gun is grey, not blue)
  rim.position.set(-1, 1, 0.5);
  pivot.add(rim, rim.target);

  // muzzle flash: a light that also lights the world (added to the main scene by the match)
  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  flashSprite.scale.setScalar(0.12);
  gun.add(flashSprite);
  setSkin(settings.skin);

  let kick = 0, flashT = 0, lastYaw = null, lastPitch = 0, inspectT = -1, time = 0, reloadT = -1, reloadDur = 6;
  const sway = new THREE.Vector2();

  return {
    get visible() { return pivot.visible; },
    set visible(on) { pivot.visible = on; },

    recoil() { kick = 1; flashT = 0.05; inspectT = -1; },
    inspect() { if (inspectT < 0 && reloadT < 0) inspectT = 0; },
    reload(seconds) { reloadT = 0; reloadDur = seconds; inspectT = -1; },
    setSkin,
    set lightOn(on) { bounce.intensity = on ? 1.2 : 0.15; },

    // world-space positions (call after update)
    muzzleWorld() { return gun.localToWorld(skin.muzzle.clone()); },
    lensWorld() { return gun.localToWorld(skin.lens.clone()); },

    update(dt, camera, player) {
      pivot.position.copy(camera.position);
      pivot.quaternion.copy(camera.quaternion);
      // sway: the gun lags behind quick turns
      if (lastYaw === null) { lastYaw = player.yaw; lastPitch = player.pitch; }
      const dy = player.yaw - lastYaw, dp = player.pitch - lastPitch;
      lastYaw = player.yaw; lastPitch = player.pitch;
      sway.x += (THREE.MathUtils.clamp(dy * 1.5, -0.06, 0.06) - sway.x) * Math.min(1, dt * 10);
      sway.y += (THREE.MathUtils.clamp(-dp * 1.5, -0.05, 0.05) - sway.y) * Math.min(1, dt * 10);
      const moving = Math.min(1, Math.hypot(player.vel.x, player.vel.z) / 3);
      const bobX = Math.sin(player.bob) * 0.008 * moving, bobY = Math.abs(Math.cos(player.bob)) * 0.008 * moving;
      kick = Math.max(0, kick - dt * 6);
      holder.position.set(BASE.x + sway.x * 0.3 + bobX, BASE.y + sway.y * 0.3 - bobY, BASE.z + kick * 0.05);
      holder.rotation.set(kick * 0.25 + sway.y, sway.x, sway.x * 0.5);

      // inspect: turn the gun to show it off while the sphere floats in from the other hand
      time += dt;
      skin.update(time);
      const orb = skin.orb;
      // sphere: in from the left, hovers, then flies into the grip (a: 0..1 through that path)
      const moveOrb = (a) => {
        orb.visible = a > 0 && a < 1;
        const from = new THREE.Vector3(-0.24, 0.0, -0.02), hover = new THREE.Vector3(-0.07, 0.02, -0.06), to = new THREE.Vector3(0, -0.1, 0.06);
        if (a < 0.6) orb.position.lerpVectors(from, hover, ease(a / 0.6));
        else orb.position.lerpVectors(hover, to, ease((a - 0.6) / 0.4));
        orb.position.y += Math.sin(time * 6) * 0.004;
        orb.rotation.set(time * 2, time * 3, 0);
        orb.scale.setScalar(a > 0.9 ? (1 - a) * 10 : 1);
      };
      if (reloadT >= 0) {
        // reload: the gun dips while empty, and the sphere floats in to load it near the end
        reloadT += dt;
        const left = reloadDur - reloadT;
        const dip = ease(Math.min(1, reloadT / 0.35)) * ease(Math.min(1, Math.max(0, left) / 0.4));
        holder.position.y -= dip * 0.05;
        holder.rotation.x -= dip * 0.5;
        holder.rotation.z += dip * 0.25;
        moveOrb(THREE.MathUtils.clamp(1 - left / 2.2, 0, 1));
        if (left <= 0) { reloadT = -1; orb.visible = false; }
      } else if (inspectT >= 0) {
        inspectT += dt;
        const k = inspectT / INSPECT_TIME;
        const show = ease(Math.min(1, k * 3)) * (1 - ease(Math.max(0, (k - 0.75) / 0.25)));
        holder.position.x -= show * 0.06;
        holder.position.y += show * 0.03;
        holder.rotation.y += show * 1.15;
        holder.rotation.z += show * 0.35;
        moveOrb(THREE.MathUtils.clamp((k - 0.15) / 0.75, 0, 1));
        if (k >= 1) { inspectT = -1; orb.visible = false; }
      } else orb.visible = false;
      flashT -= dt;
      flashSprite.material.opacity = flashT > 0 ? 1 : 0;
      flashSprite.material.rotation = Math.random() * 6;
      pivot.updateMatrixWorld(true);
    },
  };
}

function flashTexture() {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.25, 'rgba(255,200,110,0.9)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, r = i % 2 ? s * 0.2 : s * 0.5;
    g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
  }
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The hunter's own arms, seen only while he grabs: two long black sleeves with pale hands
// reaching in from the bottom of the screen and closing on the seeker. Lives in viewScene
// like the pistol. update(dt, camera, k, time): k 0..1 is how far they're reached out.
export function createHunterArms(viewScene) {
  const pivot = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.65 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe6e3dd, roughness: 0.45 });
  const UP = new THREE.Vector3(0, 1, 0);
  const arms = [-1, 1].map((s) => {
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 1, 4, 10), suit);
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.05, 4, 10), skin);
    palm.scale.set(1.25, 1, 0.55);
    hand.add(palm);
    // long thin fingers, curling in as the hand closes
    const fingers = [];
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0075, 0.1, 3, 6), skin);
      f.geometry.translate(0, 0.058, 0);
      f.position.set((i - 1.5) * 0.017, 0.045, 0);
      hand.add(f);
      fingers.push(f);
    }
    pivot.add(sleeve, hand);
    return { s, sleeve, hand, fingers };
  });
  pivot.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  pivot.visible = false;
  viewScene.add(pivot);

  const a = new THREE.Vector3(), b = new THREE.Vector3(), dir = new THREE.Vector3();
  return {
    update(dt, camera, k, time) {
      pivot.visible = k > 0.01;
      if (!pivot.visible) return;
      pivot.position.copy(camera.position);
      pivot.quaternion.copy(camera.quaternion);
      const e = k * k * (3 - 2 * k);
      for (const { s, sleeve, hand, fingers } of arms) {
        // shoulder below and beside the camera; the hand reaches from out of view to the middle
        a.set(s * 0.34, -0.62, 0.2);
        b.set(s * (0.32 - 0.2 * e), -0.75 + 0.73 * e + Math.sin(time * 9 + s) * 0.01 * e, -0.25 - 0.33 * e);
        dir.subVectors(b, a);
        const len = dir.length();
        sleeve.position.lerpVectors(a, b, 0.5);
        sleeve.quaternion.setFromUnitVectors(UP, dir.normalize());
        sleeve.scale.set(1, (len - 0.02) / 1.056, 1);
        hand.position.copy(b);
        hand.quaternion.copy(sleeve.quaternion);
        hand.rotateY(s * 0.5);
        for (const f of fingers) f.rotation.x = -0.2 - 1.1 * e; // closing around him
      }
      pivot.updateMatrixWorld(true);
    },
  };
}
