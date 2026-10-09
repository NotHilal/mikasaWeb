// The final duel, after the seeker has found every page: Iso's ultimate (Kill Contract) pulls both
// players into a hexagonal arena of purple energy walls, high above the forest. Best of 5 (first to 3), both
// with the Classic: 150 health, damage by hit zone and distance (DUEL.damage). Each keeps their own
// character. Between rounds a recap shows for 5 seconds while both wait at their ends of the arena.
//
// Who wins a round: each player decides their own health (the shooter says where they hit, the one
// hit takes the damage), and the host decides the round, so a shot each at the same moment can't
// give both of them the round.
import * as THREE from 'three';
import { net } from './net.js';
import { hunterFigure, seekerFigure, armHunter } from './figures.js';
import { audio } from './audio.js';
import { $, hud } from './ui.js';
import { settings } from './settings.js';
import { key, mouseCode } from './keys.js';
import { raySphere, rayCylinder, remoteAt } from './match.js';
import { crouchK } from './player.js';
import { SEEKER, HUNTER, NET_HZ, DUEL } from './config.js';

const now = () => performance.now();
const arr = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
const v3 = (a) => new THREE.Vector3().fromArray(a);
export const NAME = { seeker: 'Iso', hunter: 'Slender' };
// what a hit on `part` does from `dist` metres away (see DUEL.damage)
const damageAt = (part, dist) => DUEL.damage.find((band) => dist <= band.upTo)[part];
const RESPAWN_MS = 1500; // into the recap, both go back to their ends of the arena

// --- the arena -----------------------------------------------------------------------------
// A regular hexagon: flat sides facing the two spawns (at +z and -z), DUEL.arena.apothem from the
// centre to each side. Cover: [x, z, width, depth, height]. The 1.6 m ones can be jumped onto
// (DUEL.move.jump), the taller ones can't.
const COVER = [
  [0, 0, 1.6, 1.6, 2.8],                                                  // the middle
  [-6.4, 11, 2.4, 1, 1.6], [6.4, -11, 2.4, 1, 1.6],                       // in front of each spawn, to one side
  [-15, 0, 1, 2.4, 1.6], [15, 0, 1, 2.4, 1.6],                            // left and right
  [-12, -10, 1.4, 1.4, 2.6], [12, 10, 1.4, 1.4, 2.6],                     // pillars towards the corners
  [5, 4, 2.4, 1, 1.6], [-5, -4, 2.4, 1, 1.6],                             // near the middle
];
// the directions from the centre to the middle of each side (x, z)
const SIDES = [30, 90, 150, 210, 270, 330].map((deg) => {
  const a = THREE.MathUtils.degToRad(deg);
  return { a, x: Math.cos(a), z: Math.sin(a) };
});

// where a segment a→b (t from 0 to 1) enters a box, as t; null if it doesn't
function segBox(a, b, min, max) {
  let t0 = 0, t1 = 1;
  for (const k of ['x', 'y', 'z']) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-9) { if (a[k] < min[k] || a[k] > max[k]) return null; continue; }
    const u = (min[k] - a[k]) / d, w = (max[k] - a[k]) / d;
    t0 = Math.max(t0, Math.min(u, w));
    t1 = Math.min(t1, Math.max(u, w));
    if (t0 > t1) return null;
  }
  return t0;
}

function floorTexture() {
  const s = 256, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#fff';
  g.lineWidth = 3;
  g.strokeRect(0, 0, s, s);
  g.globalAlpha = 0.35;
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// the walls: a honeycomb of light, brightest at the bottom, with a band sweeping up
function wallMaterial(len) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLen: { value: len } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vP; varying vec2 vUv;
      void main() { vUv = uv; vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uLen; varying vec3 vP; varying vec2 vUv;
      float hex(vec2 p) {
        p.x *= 1.1547; p.y += mod(floor(p.x), 2.0) * 0.5;
        p = abs(mod(p, 1.0) - 0.5);
        return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
      }
      void main() {
        vec2 p = vec2(vUv.x * uLen, vP.y) * 2.2;
        float edge = smoothstep(0.07, 0.0, hex(p));
        float sweep = smoothstep(0.06, 0.0, abs(fract(vUv.y * 0.6 - uTime * 0.12) - 0.5) - 0.44);
        float low = pow(1.0 - vUv.y, 2.0);
        vec3 col = mix(vec3(0.55, 0.32, 1.0), vec3(0.35, 0.6, 1.0), vUv.y);
        float a = edge * (0.05 + 0.3 * low) + low * 0.025 + sweep * 0.05 + 0.004;
        gl_FragColor = vec4(col * a, 1.0);
      }`,
  });
}

function buildArena() {
  const { y: Y, apothem: A, wall: H } = DUEL.arena;
  const R = A * 2 / Math.sqrt(3); // centre to corner, which is also the length of a side
  const group = new THREE.Group();
  const geos = [], mats = [];
  const mesh = (geo, mat) => { geos.push(geo); mats.push(mat); return new THREE.Mesh(geo, mat); };

  // the floor: dark tiles with glowing seams
  const lines = floorTexture();
  lines.repeat.set(R, R); // (2 m tiles)
  const floor = mesh(new THREE.CircleGeometry(R, 6), new THREE.MeshStandardMaterial({
    color: 0x1a1530, roughness: 0.45, metalness: 0.3, emissive: 0x8a5cff, emissiveMap: lines, emissiveIntensity: 0.35,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = Y;
  floor.receiveShadow = true;
  // the void all around, so nothing of the forest shows below
  const deep = mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshBasicMaterial({ color: 0x07050e, fog: false }));
  deep.rotation.x = -Math.PI / 2;
  deep.position.y = Y - 0.05;
  group.add(floor, deep);

  // the energy walls, with a bright line along their foot
  const wallMat = wallMaterial(R);
  mats.push(wallMat);
  const strip = new THREE.MeshBasicMaterial({ color: 0xb487ff, fog: false });
  mats.push(strip);
  for (const side of SIDES) {
    const rot = -side.a - Math.PI / 2; // (turns the plane to run along the side)
    const wall = mesh(new THREE.PlaneGeometry(R, H), wallMat);
    wall.position.set(side.x * A, Y + H / 2, side.z * A);
    wall.rotation.y = rot;
    wall.renderOrder = 5;
    const foot = mesh(new THREE.BoxGeometry(R, 0.06, 0.06), strip);
    foot.position.set(side.x * A, Y + 0.03, side.z * A);
    foot.rotation.y = rot;
    group.add(wall, foot);
  }

  // cover: dark blocks with lit edges
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x221c3a, roughness: 0.7, metalness: 0.2 });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xc19bff });
  mats.push(blockMat, edgeMat);
  const boxes = COVER.map(([x, z, w, d, h]) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const block = mesh(geo, blockMat);
    block.position.set(x, Y + h / 2, z);
    block.castShadow = block.receiveShadow = true;
    const edgeGeo = new THREE.EdgesGeometry(geo);
    geos.push(edgeGeo);
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    edges.position.copy(block.position);
    group.add(block, edges);
    return { min: new THREE.Vector3(x - w / 2, Y - 1, z - d / 2), max: new THREE.Vector3(x + w / 2, Y + h, z + d / 2) };
  });

  // (no lights of its own: adding lights makes every material recompile, a long freeze; the
  // duel tints the scene's own lights instead)

  const colliders = {
    // push a circle out of the cover and keep it inside the walls (same contract as the forest's)
    resolve(pos, r, feet = -Infinity) {
      for (const b of boxes) {
        if (b.max.y < feet) continue;
        const cx = THREE.MathUtils.clamp(pos.x, b.min.x, b.max.x), cz = THREE.MathUtils.clamp(pos.z, b.min.z, b.max.z);
        const dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-5) { pos.x = cx + (dx / d) * r; pos.z = cz + (dz / d) * r; continue; }
        // the centre is inside the box: out the nearest side
        const out = [[b.min.x - r - pos.x, 'x'], [b.max.x + r - pos.x, 'x'], [b.min.z - r - pos.z, 'z'], [b.max.z + r - pos.z, 'z']]
          .sort((p, q) => Math.abs(p[0]) - Math.abs(q[0]))[0];
        pos[out[1]] += out[0];
      }
      // inside all six sides
      for (const side of SIDES) {
        const over = pos.x * side.x + pos.z * side.z - (A - r);
        if (over > 0) { pos.x -= side.x * over; pos.z -= side.z * over; }
      }
    },
    // first point (0..1 of the way) where a→b hits cover, a wall or the floor, or null
    hit(a, b) {
      let best = null;
      const take = (t) => { if (t !== null && t >= 0 && t <= 1 && (best === null || t < best)) best = t; };
      for (const side of SIDES) {
        const da = a.x * side.x + a.z * side.z, db = b.x * side.x + b.z * side.z;
        if (db > A && da <= A) take((A - da) / (db - da));
      }
      if (b.y < Y && a.y >= Y) take((a.y - Y) / (a.y - b.y));
      for (const box of boxes) {
        const t = segBox(a, b, box.min, box.max);
        if (t !== null && (best === null || t < best)) best = t;
      }
      return best;
    },
    blocked(a, b) { return this.hit(a, b) !== null; },
  };

  // the ground under (x, z): the floor, or the top of a box you're over that isn't above `below`
  // (your feet), so you can jump up onto the low ones and stand there. A little past a box's edge
  // still counts (you're not off it until your middle is), like a ledge.
  const LEDGE = 0.15;
  const heightAt = (x, z, below = Infinity) => {
    let top = Y;
    for (const b of boxes) {
      if (b.max.y > below || b.max.y <= top) continue;
      if (x >= b.min.x - LEDGE && x <= b.max.x + LEDGE && z >= b.min.z - LEDGE && z <= b.max.z + LEDGE) top = b.max.y;
    }
    return top;
  };

  const spawn = (role) => new THREE.Vector3(0, Y, (role === 'seeker' ? 1 : -1) * (A - 2.5));
  return {
    group,
    // ledges: the ground can step up and down (box tops), see Player.update
    world: { heightAt, colliders, ledges: true },
    spawn,
    update(time) { wallMat.uniforms.uTime.value = time; },
    dispose() { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); lines.dispose(); },
  };
}

// The forest and its sky, hidden while we're in the arena: the scene's direct children that are
// showing, but not its lights, the camera or the effects' particles (the duel uses those)
const forestOf = (engine, effects) => {
  const keep = new Set([engine.camera, effects.fx.points, effects.smoke.points]);
  return engine.scene.children.filter((o) => o.visible && !o.isLight && !keep.has(o));
};

// While the game loads (main.js): an arena and an armed Slender are drawn once, with the scene
// just as the duel sets it up (the forest hidden), so their shaders are compiled then and not the
// moment the duel starts (that was a freeze of up to a couple of seconds, over the rules; shaders
// depend on what else is in the scene, the lights left showing for one, so it has to be the same).
// Their materials are kept, not disposed: disposing would let the compiled shaders go too.
// The arena is built once and kept: every duel uses the same one (building it each time meant
// sending all its shapes and textures to the graphics card again, a pause as the duel started)
let theArena = null;
const arenaOnce = () => (theArena ??= buildArena());

export function prewarmDuel(engine, effects) {
  const { scene, renderer, composer, camera } = engine;
  const hidden = forestOf(engine, effects);
  hidden.forEach((o) => { o.visible = false; });
  const arena = arenaOnce();
  const slender = hunterFigure(), iso = seekerFigure();
  armHunter(slender);
  slender.position.set(0, DUEL.arena.y, 0);
  iso.position.set(2, DUEL.arena.y, 0);
  // (their own little lights are off in the duel, so here too: lights showing change the shaders)
  for (const f of [slender, iso]) f.traverse((o) => { if (o.isLight) o.visible = false; });
  scene.add(arena.group, slender, iso);
  // (for where the game really draws: the post-processing's buffer)
  renderer.setRenderTarget(composer.readBuffer);
  renderer.compile(scene, camera);
  renderer.setRenderTarget(null);
  // and draw it once from inside, so its shapes and textures are on the graphics card already
  const cam = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
  camera.position.set(0, DUEL.arena.y + 1.7, DUEL.arena.apothem - 3);
  camera.lookAt(0, DUEL.arena.y + 1.2, 0);
  engine.render(0);
  camera.position.copy(cam.pos);
  camera.quaternion.copy(cam.quat);
  scene.remove(arena.group, slender, iso);
  hidden.forEach((o) => { o.visible = true; });
}

// --- the duel ------------------------------------------------------------------------------

export class Duel {
  constructor({ engine, player, flashlight, viewmodel, effects }, { role, host }, onEnd) {
    Object.assign(this, { engine, player, flashlight, viewmodel, effects, role, host, onEnd });
    this.other = role === 'seeker' ? 'hunter' : 'seeker';
    this.over = false;
    this.pausedAt = 0;
    this.score = { seeker: 0, hunter: 0 };
    this.rounds = [];         // who won each round so far
    this.round = 0;           // the round being played (0 before the first)
    this.phase = 'between';   // 'between' (countdown, recap), 'live', 'done'
    this.snaps = [];
    this.sendTimer = 0;
    this.spawns = 0;          // how many times I've been put back at my end (the other screen restarts its view of me)
    this.remoteSpawns = -1;
    this.off = [];
    this.hurt = 0;
    this.lastShot = 0;
    this.reloadUntil = 0;

    // the arena, with the forest (and its sky) hidden while we're in it
    this.arena = arenaOnce();
    const scene = engine.scene;
    this.hidden = forestOf(engine, effects);
    this.hidden.forEach((o) => { o.visible = false; });
    scene.add(this.arena.group);
    this.saved = {
      fog: scene.fog.color.getHex(), density: scene.fog.density, bg: scene.background,
      hemi: engine.hemi.intensity, hemiSky: engine.hemi.color.getHex(), hemiGround: engine.hemi.groundColor.getHex(),
      moon: engine.moon.intensity, sat: engine.film.uniforms.uSaturation.value,
    };
    scene.fog.color.set(0x120b22);
    scene.fog.density = 0.012;
    scene.background = new THREE.Color(0x0b0716);
    engine.hemi.color.set(0xb8a8ff);
    engine.hemi.groundColor.set(0x2a1f45);
    engine.hemi.intensity = 1.6;
    engine.moon.intensity = 0.9;
    engine.film.uniforms.uSaturation.value = 1;
    this.savedWorld = player.world;
    player.world = this.arena.world;
    player.onStep = (speed) => audio.step(speed, role === 'hunter'); // footsteps (Slender's heavier), as in the woods
    flashlight.on = false;
    viewmodel.visible = true;
    viewmodel.lightOn = false;

    // the other player, with their Classic
    this.remote = this.other === 'hunter' ? hunterFigure() : seekerFigure();
    if (this.other === 'hunter') armHunter(this.remote);
    if (this.remote.userData.lens) this.remote.userData.lens.visible = false; // (Iso's torch is off in here)
    this.remote.rotation.order = 'YXZ'; // so a fall tips him over backwards, whichever way he faces
    this.remote.visible = false;
    scene.add(this.remote);
    engine.renderer.compile(scene, engine.camera);

    this.off.push(
      net.on('s', (d) => {
        if (d.sp !== this.remoteSpawns) { this.remoteSpawns = d.sp; this.snaps = []; this.remoteDeadAt = 0; }
        this.snaps.push({ t: now(), ...d });
        if (this.snaps.length > 30) this.snaps.shift();
      }),
      net.on('fx', (d) => this.remoteShot(d)),
      net.on('dhit', ({ part, d, r }) => this.onHit(part, d, r)),
      net.on('dhp', ({ hp, r }) => this.onEnemyHp(hp, r)),
      net.on('ddead', ({ r }) => {
        if (r !== this.round) return;
        if (!this.remoteDeadAt) this.remoteDeadAt = now();
        if (this.host) this.decide(this.role);
      }),
      net.on('dround', (msg) => { if (!this.host) this.applyRound(msg); }),
    );

    // input: only the Classic (and inspecting it); moving and jumping are the player's
    const press = (code) => {
      if (!this.player.enabled || this.over || !document.pointerLockElement) return;
      if (code === key('shoot')) this.shoot();
      else if (code === key('reload')) this.reload();
      else if (code === key('inspect')) this.viewmodel.inspect();
    };
    this.onKey = (e) => { if (!e.repeat) press(e.code); };
    this.onMouse = (e) => press(mouseCode(e.button));
    this.onContext = (e) => e.preventDefault();
    addEventListener('keydown', this.onKey);
    addEventListener('mousedown', this.onMouse);
    addEventListener('contextmenu', this.onContext);

    // HUD
    $('#hud').classList.add('duel');
    $('#role-tag').textContent = `Final duel · ${NAME[role]}`;
    $('#ammo').style.display = '';
    hud(true);
    player.enabled = true;
    this.between(DUEL.introMs, 0);
    this.respawn();
    this.renderBanner(true);
  }

  send(type, d = {}) { net.send(type, d); }

  // where a sound at `pos` is, relative to my ears
  at(pos) {
    const cam = this.engine.camera;
    const to = pos.clone().sub(cam.position);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const dist = to.length();
    return { dist, pan: dist > 0.01 ? to.normalize().dot(right) * 0.9 : 0 };
  }

  // back to my end of the arena, full health and a full magazine, frozen until the round starts
  respawn() {
    const p = this.player;
    const at = this.arena.spawn(this.role);
    p.spawn(at, this.role, { eye: this.role === 'seeker' ? SEEKER.eye : HUNTER.eye, ...DUEL.move }, this.arena.spawn(this.other));
    p.frozen = true;
    this.spawns++;
    this.hp = DUEL.hp;
    this.enemyHp = DUEL.hp;
    this.dead = false;
    this.ammo = DUEL.ammo;
    this.reloadUntil = 0;
    this.respawned = true;
    this.sendState();
    this.renderHud();
  }

  // the countdown before a round (and the recap of the last one): respawn after `respawnMs`
  between(ms, respawnMs) {
    const t = now();
    this.phase = 'between';
    this.nextAt = t + ms;
    this.respawnAt = t + respawnMs;
    this.respawned = false;
    this.player.frozen = true;
    this.lastCount = null;
  }

  goLive() {
    this.round++;
    this.phase = 'live';
    this.liveAt = now();
    this.player.frozen = false;
    this.stats = { dealt: 0, taken: 0, head: 0, body: 0, legs: 0, shots: 0 };
    $('#duel-banner').classList.remove('show');
    audio.play('go');
    this.renderHud();
  }

  // --- the Classic -----------------------------------------------------------------------

  // R (or by itself once it's empty): it can't fire until it's full again
  reload() {
    if (this.reloadUntil || this.dead || this.ammo >= DUEL.ammo) return;
    this.reloadUntil = now() + DUEL.reloadMs;
    this.viewmodel.reload(DUEL.reloadMs / 1000);
    this.renderHud();
  }

  // how far off the next shot can go (radians): nothing standing still, more moving, most in the air
  spread() {
    const p = this.player, s = DUEL.spread;
    const moving = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / DUEL.move.walk) * (p.quiet ? s.quiet : 1) * (p.crouch > 0.5 ? s.crouch : 1);
    return THREE.MathUtils.degToRad(s.move * moving + (p.air > 0.05 ? s.air : 0));
  }

  // dir turned off course by up to `spread`, in a random direction (any spot in the cone as likely)
  aimed(dir, spread) {
    if (spread <= 0) return dir;
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const a = Math.random() * Math.PI * 2, r = Math.tan(spread) * Math.sqrt(Math.random());
    return dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  }

  shoot() {
    const t = now();
    if (this.phase !== 'live' || this.dead || this.pausedAt || t - this.lastShot < DUEL.fireMs) return;
    if (this.reloadUntil || this.ammo <= 0) { audio.play('dry'); return; } // reloading
    this.lastShot = t;
    this.ammo--;
    this.stats.shots++;
    this.viewmodel.recoil();
    if (this.ammo === 0) this.reload();
    audio.play('shot');
    // (off by up to the spread, any way round, while moving or in the air)
    const origin = this.engine.camera.position.clone(), dir = this.aimed(this.player.forward, this.spread());
    this.player.pitch = Math.min(1.45, this.player.pitch + 0.012); // a little kick, after the shot
    const wall = this.arena.world.colliders.hit(origin, origin.clone().addScaledVector(dir, DUEL.range));
    let endDist = wall === null ? DUEL.range : wall * DUEL.range;
    const rs = remoteAt(this.snaps);
    const hit = rs && !this.remoteDeadAt ? this.hitTest(origin, dir, rs) : null;
    if (hit && hit.t < endDist) endDist = hit.t;
    const muzzle = this.viewmodel.muzzleWorld(), end = origin.clone().addScaledVector(dir, endDist);
    this.effects.muzzle(muzzle);
    this.effects.tracer(muzzle, end);
    this.send('fx', { k: 'shot', from: arr(muzzle), to: arr(end) });
    if (hit && hit.t <= endDist) {
      // (the distance goes with it: the one hit works out the damage, as they keep their own health)
      const dmg = damageAt(hit.part, hit.t);
      this.send('dhit', { part: hit.part, d: +hit.t.toFixed(2), r: this.round });
      this.stats[hit.part]++;
      this.stats.dealt += Math.min(dmg, this.enemyHp);
      this.hitmarker(hit.part, dmg);
    }
    this.renderHud();
  }

  // where a shot from origin along dir first meets the other player: { t, part } or null
  hitTest(origin, dir, rs) {
    const hb = DUEL.hitbox[this.other], h = crouchK(rs.cr); // (all heights shrink when they crouch)
    const parts = {
      head: raySphere(origin, dir, new THREE.Vector3(rs.x, rs.y + hb.head[0] * h, rs.z), hb.head[1]),
      body: rayCylinder(origin, dir, rs.x, rs.z, hb.body[2], rs.y + hb.body[0] * h, rs.y + hb.body[1] * h),
      legs: rayCylinder(origin, dir, rs.x, rs.z, hb.legs[2], rs.y + hb.legs[0] * h, rs.y + hb.legs[1] * h),
    };
    let best = null;
    for (const part in parts) if (parts[part] !== null && (!best || parts[part] < best.t)) best = { t: parts[part], part };
    return best;
  }

  hitmarker(part, amount) {
    const el = $('#hitmarker');
    el.classList.toggle('red', part === 'head');
    el.classList.add('show');
    clearTimeout(this.hmTimer);
    this.hmTimer = setTimeout(() => el.classList.remove('show'), 180);
    const dmg = $('#dmg');
    dmg.textContent = amount;
    dmg.className = `dmg ${part}`;
    void dmg.offsetWidth; // (restart its animation)
    dmg.classList.add('show');
    if (part === 'head') audio.play('headshot');
  }

  remoteShot(d) {
    if (d.k !== 'shot') return;
    const from = v3(d.from);
    this.effects.muzzle(from);
    this.effects.tracer(from, v3(d.to));
    audio.play('shot', this.at(from));
  }

  // I was hit: I keep my own health
  onHit(part, dist, r) {
    if (r !== this.round || this.phase !== 'live' || this.dead || !['head', 'body', 'legs'].includes(part)) return;
    const dmg = Math.min(this.hp, damageAt(part, +dist || 0));
    this.hp -= dmg;
    this.stats.taken += dmg;
    this.hurt = 1;
    audio.play('hurt');
    this.send('dhp', { hp: this.hp, r });
    if (this.hp <= 0) this.die();
    this.renderHud();
  }

  onEnemyHp(hp, r) {
    if (r !== this.round) return;
    this.enemyHp = hp;
    if (hp <= 0 && !this.remoteDeadAt) { this.remoteDeadAt = now(); audio.play('kill'); }
  }

  die() {
    this.dead = true;
    this.deadAt = now();
    this.player.frozen = true;
    this.send('ddead', { r: this.round });
    if (this.host) this.decide(this.other);
  }

  // host: the round goes to `winner` (the first death the host hears of decides it)
  decide(winner) {
    if (this.phase !== 'live') return;
    const score = { ...this.score, [winner]: this.score[winner] + 1 };
    const msg = { r: this.round, winner, score };
    this.send('dround', msg);
    this.applyRound(msg);
  }

  // both screens: the round is over
  applyRound({ r, winner, score }) {
    if (r !== this.round || this.rounds.length >= r) return;
    this.rounds.push(winner);
    this.score = score;
    this.player.frozen = true;
    if (winner === this.other && !this.dead) { this.dead = true; this.deadAt = now(); } // (if their shot's message was missed)
    if (winner === this.role && !this.remoteDeadAt) this.remoteDeadAt = now();
    audio.play(winner === this.role ? 'roundWin' : 'roundLose');
    if (score[winner] >= DUEL.firstTo) {
      this.phase = 'done';
      this.doneAt = now() + DUEL.endMs;
      this.winner = winner;
    } else this.between(DUEL.betweenMs, RESPAWN_MS);
    this.renderBanner(true);
    this.renderHud();
  }

  // --- HUD -------------------------------------------------------------------------------

  renderHud() {
    for (const who of ['seeker', 'hunter']) {
      $(`#score-${who}`).textContent = this.score[who];
      $(`#pips-${who}`).innerHTML = Array.from({ length: DUEL.firstTo }, (_, i) => `<i class="${i < this.score[who] ? 'on' : ''}"></i>`).join('');
    }
    $('#duel-round').textContent = `Round ${Math.max(1, this.round + (this.phase === 'between' && this.rounds.length < this.round + 1 ? 1 : 0))} · Best of 5`;
    const hp = this.hp ?? DUEL.hp;
    $('#hp-v').textContent = hp;
    $('#hp-fill').style.width = `${(hp / DUEL.hp) * 100}%`;
    $('#duel-hp').classList.toggle('low', hp <= DUEL.hp * 0.25);
    const reloading = !!this.reloadUntil;
    $('#ammo').innerHTML = `<div class="n ${reloading ? 'empty' : ''}">${this.ammo}<small>/${DUEL.ammo}</small></div><div class="w">${reloading ? 'Reloading' : 'Classic'}</div>`
      + (reloading ? '<div class="reload"><i id="reload-fill"></i></div>' : '');
  }

  // the panel in the middle: the intro before round 1, the recap between rounds, the result
  renderBanner(fresh) {
    const el = $('#duel-banner');
    const count = this.phase === 'between' ? Math.max(0, Math.ceil((this.nextAt - now()) / 1000)) : null;
    if (!fresh && count === this.lastCount) return;
    this.lastCount = count;
    let html;
    if (!this.rounds.length) {
      html = `<div class="eyebrow">Final duel</div><div class="db-title">Kill Contract</div>
        <div class="db-sub">Best of 5 · first to ${DUEL.firstTo} rounds · ${DUEL.hp} health</div>
        <div class="db-sub">${DUEL.damage.map((b, i) => `${i ? `Past ${DUEL.damage[i - 1].upTo} m` : `Up to ${b.upTo} m`}: head ${b.head} · body ${b.body} · legs ${b.legs}`).join('<br>')}</div>
        <div class="db-count">${count || ''}</div>`;
    } else {
      const winner = this.rounds[this.rounds.length - 1], won = winner === this.role, s = this.stats;
      const last = this.phase === 'done';
      html = `<div class="eyebrow">Round ${this.rounds.length}</div>
        <div class="db-title ${won ? 'win' : 'lose'}">${last ? `${NAME[winner]} wins the duel` : won ? 'Round won' : 'Round lost'}</div>
        <div class="db-sub">${NAME[winner]} takes the round · ${NAME.seeker} ${this.score.seeker} – ${this.score.hunter} ${NAME.hunter}</div>
        <div class="db-stats">
          <div class="stat"><div class="k">Damage dealt</div><div class="v">${s.dealt}</div></div>
          <div class="stat"><div class="k">Damage taken</div><div class="v">${s.taken}</div></div>
          <div class="stat"><div class="k">Head · body · legs</div><div class="v">${s.head} · ${s.body} · ${s.legs}</div></div>
          <div class="stat"><div class="k">Shots</div><div class="v">${s.shots}</div></div>
        </div>
        ${last ? '' : `<div class="db-next">Next round in <b>${count}</b></div>`}`;
    }
    el.innerHTML = html;
    el.classList.add('show');
    if (count && !fresh) audio.play('tick');
  }

  sendState() {
    const p = this.player, r = (v) => Math.round(v * 100) / 100;
    this.send('s', { x: r(p.pos.x), y: r(p.pos.y), z: r(p.pos.z), yaw: r(p.yaw), pitch: r(p.pitch), sp: this.spawns, cr: r(p.crouch) });
  }

  // freeze while a player is disconnected (see main.js), and carry on afterwards
  setPaused(on) {
    if (on === !!this.pausedAt) return;
    if (on) { this.pausedAt = now(); this.player.enabled = false; return; }
    const gap = now() - this.pausedAt;
    this.pausedAt = 0;
    for (const k of ['nextAt', 'respawnAt', 'doneAt', 'reloadUntil', 'lastShot', 'deadAt', 'remoteDeadAt', 'liveAt']) if (this[k]) this[k] += gap;
    this.snaps = [];
    this.player.enabled = !this.over;
  }

  // --- every frame -----------------------------------------------------------------------

  update(dt, time) {
    if (this.pausedAt) return;
    const { player, engine } = this;
    const t = now(), film = engine.film.uniforms;

    if (this.phase === 'between') {
      if (!this.respawned && t >= this.respawnAt) this.respawn();
      if (t >= this.nextAt) this.goLive();
      else this.renderBanner(false);
    } else if (this.phase === 'done' && t >= this.doneAt && !this.over) {
      this.over = true;
      player.enabled = false;
      this.onEnd({ winner: this.winner, score: this.score, rounds: this.rounds });
    }

    // dead: the view sinks to the floor and goes red and grey
    player.lift = this.dead ? -THREE.MathUtils.smoothstep(t - this.deadAt, 0, 500) * (player.stats.eye - 0.45) : 0;
    player.update(dt);

    // the crosshair opens up as wide as the spread (where a shot could land, on screen)
    const cam = engine.camera;
    const gap = 4 + (Math.tan(this.spread()) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) * (innerHeight / 2);
    if (Math.abs(gap - (this.chGap ?? 4)) > 0.5) { this.chGap = gap; document.querySelector('.crosshair')?.style.setProperty('--gap', `${gap.toFixed(1)}px`); }

    // reloading (R, or by itself once empty): full again when it's done
    if (this.reloadUntil) {
      const fill = document.getElementById('reload-fill');
      if (fill) fill.style.width = `${(1 - Math.max(0, this.reloadUntil - t) / DUEL.reloadMs) * 100}%`;
      if (t >= this.reloadUntil) { this.ammo = DUEL.ammo; this.reloadUntil = 0; audio.play('ready'); this.renderHud(); }
    }

    // the round's time in the top bar (it stops when the round ends, and starts over with the next)
    const secs = this.phase === 'live' ? Math.floor((t - this.liveAt) / 1000) : this.phase === 'between' && this.respawned ? 0 : this.lastSecs ?? 0;
    if (secs !== this.lastSecs) { this.lastSecs = secs; $('#duel-time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; }

    this.hurt = Math.max(0, this.hurt - dt * 3);
    film.uTint.value = Math.max(this.hurt * 0.5, this.dead ? 0.55 : 0);
    film.uSaturation.value = this.dead ? 0.35 : 1;
    if (Math.abs(engine.camera.fov - settings.fov) > 0.01) { engine.camera.fov = settings.fov; engine.camera.updateProjectionMatrix(); }

    this.sendTimer -= dt;
    if (this.sendTimer <= 0 && !this.over) { this.sendTimer = 1 / NET_HZ; this.sendState(); }

    this.effects.update(dt, engine.camera);
    this.arena.update(time);

    // the other player: walking, and falling over when they're out
    const rs = remoteAt(this.snaps);
    const r = this.remote;
    r.visible = !!rs;
    if (rs) {
      r.position.set(rs.x, rs.y, rs.z);
      r.rotation.y = rs.yaw;
      r.scale.y = r.userData.crouchPose ? 1 : crouchK(rs.cr); // crouching: bent (Iso), or squashed
      const moved = this.lastRemote ? Math.hypot(rs.x - this.lastRemote.x, rs.z - this.lastRemote.z) / Math.max(dt, 1e-3) : 0;
      this.lastRemote = { x: rs.x, z: rs.z };
      this.remoteSpeed = (this.remoteSpeed ?? 0) + ((moved > 15 ? 0 : moved) - (this.remoteSpeed ?? 0)) * Math.min(1, dt * 8);
      r.userData.animate?.(dt, this.remoteDeadAt ? 0 : this.remoteSpeed, time, { crouch: rs.cr ?? 0 });
      r.rotation.x = this.remoteDeadAt ? THREE.MathUtils.smoothstep(t - this.remoteDeadAt, 0, 450) * Math.PI * 0.48 : 0;
      r.userData.skin?.update(time);
    }

    this.viewmodel.update(dt, engine.camera, player);
  }

  dispose() {
    this.off.forEach((f) => f());
    document.querySelector('.crosshair')?.style.removeProperty('--gap'); // (back to the woods' tight crosshair)
    removeEventListener('keydown', this.onKey);
    removeEventListener('mousedown', this.onMouse);
    removeEventListener('contextmenu', this.onContext);
    clearTimeout(this.hmTimer);
    const { engine, player } = this, scene = engine.scene, s = this.saved;
    scene.remove(this.remote, this.arena.group); // (the arena itself is kept for the next duel)
    this.hidden.forEach((o) => { o.visible = true; });
    scene.fog.color.setHex(s.fog);
    scene.fog.density = s.density;
    scene.background = s.bg;
    engine.hemi.intensity = s.hemi;
    engine.hemi.color.setHex(s.hemiSky);
    engine.hemi.groundColor.setHex(s.hemiGround);
    engine.moon.intensity = s.moon;
    const film = engine.film.uniforms;
    film.uSaturation.value = s.sat;
    film.uTint.value = 0; film.uFlash.value = 0; film.uStatic.value = 0;
    this.effects.clear();
    player.world = this.savedWorld;
    player.enabled = false;
    player.frozen = false;
    player.lift = 0;
    this.viewmodel.visible = false;
    $('#duel-banner').classList.remove('show');
    $('#hud').classList.remove('duel');
    hud(false);
  }
}
