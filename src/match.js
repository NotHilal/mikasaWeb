// One round: places the pages, spawns both players, syncs positions, handles page
// pickups, the seeker's pistol and abilities, the hunter's teleport and eye, stuns,
// reveals, catching, and the end of the round.
import * as THREE from 'three';
import { net } from './net.js';
import { hunterFigure, seekerFigure, addXray, setStunGlow } from './figures.js';
import { audio } from './audio.js';
import { $, flash, hud } from './ui.js';
import { SEEKER, HUNTER, PAGES, MESSAGE, NET_HZ, MAP, GUN, DART, FLASH, DASH, TELEPORT, EYE } from './config.js';

const INTERP_MS = 110; // the other player is drawn this far in the past, to smooth over network jitter
const v3 = (a) => new THREE.Vector3().fromArray(a);
const arr = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
const now = () => performance.now();
// first distance along a ray (unit dir) where it enters a sphere, or null
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

// first distance along a ray where it enters an upright cylinder (centre x,z; radius r;
// from y0 to y1), or null
function rayCylinder(o, d, cx, cz, r, y0, y1) {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-6) return null; // straight up or down
  const b = ox * d.x + oz * d.z, cc = ox * ox + oz * oz - r * r;
  const disc = b * b - a * cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / a, (-b + sq) / a]) {
    const y = o.y + d.y * t;
    if (t > 0 && y >= y0 && y <= y1) return t;
  }
  return null;
}

const COOLDOWN = { dart: DART.cooldown, flash: FLASH.cooldown, dash: DASH.cooldown, tp: TELEPORT.cooldown, eye: EYE.cooldown };

// ability slots shown in the HUD, per role
const KIT = {
  seeker: [['KeyC', 'C', 'Recon', 'dart'], ['KeyQ', 'Q', 'Flash', 'flash'], ['KeyE', 'E', 'Dash', 'dash']],
  hunter: [['KeyQ', 'Q', 'Teleport', 'tp'], ['KeyE', 'E', 'Eye', 'eye']],
};

export class Match {
  constructor({ engine, world, player, flashlight, viewmodel, effects }, { seed, role }, onEnd) {
    Object.assign(this, { engine, world, player, flashlight, viewmodel, effects, role, onEnd });
    this.over = false;
    this.found = 0;
    this.snaps = [];
    this.sendTimer = 0;
    this.off = [];

    // seeker kit
    this.ammo = GUN.ammo;
    this.reloadUntil = 0;
    // abilities: seconds until ready
    this.cd = role === 'seeker' ? { dart: 0, flash: 0, dash: 0 } : { tp: 0, eye: 0 };
    this.aiming = false;
    this.tpCount = 0;
    this.remoteTp = 0;
    // timers (performance.now() ms)
    this.stunnedUntil = 0;      // hunter: frozen until
    this.immuneUntil = 0;       // hunter: can't be stunned again until
    this.remoteStunUntil = 0;   // seeker: draw the hunter glowing red until
    this.revealUntil = 0;       // the other player shows through trees until
    this.meRevealedUntil = 0;   // I'm revealed (warning) until
    this.blindUntil = 0;
    this.fovKick = 0;
    this.startedAt = now();

    // pages
    this.pages = world.placePages(world.pickPages(seed));

    // spawns: far apart, both facing the middle of the map
    const seekerSpawn = world.spawnPoint(seed * 3 + 1);
    const hunterSpawn = world.spawnPoint(seed * 7 + 2, seekerSpawn);
    const mine = role === 'seeker' ? seekerSpawn : hunterSpawn;
    player.spawn(mine, role, role === 'seeker' ? SEEKER : HUNTER, new THREE.Vector3(0, 0, 0));
    player.onStep = (speed) => audio.step(speed);
    player.enabled = true;

    // the other player
    this.remote = role === 'seeker' ? hunterFigure() : seekerFigure();
    this.remote.visible = false;
    addXray(this.remote);
    engine.scene.add(this.remote);

    // the hunter sees in the dark (dimly); the seeker relies on the flashlight
    this.saved = { hemi: engine.hemi.intensity, sat: engine.film.uniforms.uSaturation.value, fov: engine.camera.fov };
    if (role === 'hunter') {
      engine.hemi.intensity = 2.2;
      engine.film.uniforms.uSaturation.value = 0.5; // muted, but reveals and markers keep their colour
    }
    flashlight.on = role === 'seeker';
    viewmodel.visible = role === 'seeker';

    // teleport target marker (only the hunter sees it)
    this.marker = new THREE.Group();
    const markMat = new THREE.MeshBasicMaterial({ color: 0xb04dff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 40), markMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8, 1, true), markMat);
    beam.position.y = 1.3;
    this.marker.add(ring, beam);
    this.marker.userData.mat = markMat;
    this.marker.visible = false;
    this.marker.traverse((o) => { o.renderOrder = 998; });
    engine.scene.add(this.marker);

    // network
    this.off.push(
      net.on('s', (d) => {
        // a teleport: jump straight there instead of sliding across the map
        if (d.tp !== undefined && d.tp !== this.remoteTp) { this.remoteTp = d.tp; this.snaps = []; }
        this.snaps.push({ t: now(), ...d });
        if (this.snaps.length > 30) this.snaps.shift();
      }),
      net.on('page', ({ n }) => this.takePage(n, false)),
      net.on('caught', () => this.finish('caught', false)),
      net.on('fx', (d) => this.remoteFx(d)),
      net.on('hit', ({ head }) => this.onHit(!!head)),
      net.on('stun', ({ ok, ms, head }) => this.onStunReply(ok, ms, head)),
      net.on('revealed', ({ ms }) => {
        this.meRevealedUntil = now() + ms;
        audio.play('revealed');
      }),
    );

    // input
    this.onKey = (e) => {
      if (!this.player.enabled || this.over || e.repeat || !document.pointerLockElement) return;
      if (role === 'seeker') {
        if (e.code === 'KeyT') { flashlight.on = !flashlight.on; audio.click(); }
        if (e.code === 'KeyF') this.tryTake();
        if (e.code === 'KeyC') this.useDart();
        if (e.code === 'KeyQ') this.useFlash();
        if (e.code === 'KeyE') this.useDash();
        if (e.code === 'KeyY') this.viewmodel.inspect();
      } else {
        if (e.code === 'KeyQ') this.startAim();
        if (e.code === 'KeyE') this.useEye();
      }
    };
    this.onKeyUp = (e) => { if (e.code === 'KeyQ' && this.aiming) this.releaseAim(); };
    this.onMouse = (e) => {
      if (!document.pointerLockElement || this.over || !this.player.enabled) return;
      if (role === 'seeker' && e.button === 0) this.shoot();
      if (role === 'hunter' && e.button === 2 && this.aiming) this.cancelAim();
    };
    this.onContext = (e) => e.preventDefault();
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('mousedown', this.onMouse);
    addEventListener('contextmenu', this.onContext);

    // HUD
    $('#role-tag').textContent = role === 'seeker' ? 'Seeker' : 'Hunter';
    $('#pages').classList.remove('show');
    $('#page-text').classList.remove('show');
    $('#stamina-fill').parentElement.classList.toggle('show', false);
    $('#abilities').innerHTML = KIT[role].map(([, key, name, id]) =>
      `<div class="ab" data-ab="${id}"><div class="key">${key}</div><div class="name">${name}</div><div class="state"></div><div class="cd"></div></div>`).join('');
    $('#ammo').style.display = role === 'seeker' ? '' : 'none';
    this.renderHud();
    hud(true);
    this.showCount();
  }

  // --- helpers --------------------------------------------------------------------

  // where a sound at `pos` is, relative to my ears
  at(pos) {
    const cam = this.engine.camera;
    const to = pos.clone().sub(cam.position);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const dist = to.length();
    return { dist, pan: dist > 0.01 ? to.normalize().dot(right) * 0.9 : 0 };
  }

  send(type, d = {}) { net.send(type, d); }

  get stunned() { return now() < this.stunnedUntil; }

  // --- pages ------------------------------------------------------------------------

  // the page the seeker is looking at and close enough to take, if any
  lookedAtPage() {
    if (this.role !== 'seeker') return null;
    const eye = this.engine.camera.position, fwd = this.player.forward;
    let best = null, bestDot = Math.cos(THREE.MathUtils.degToRad(14));
    for (const p of this.pages) {
      if (p.taken) continue;
      const to = p.pos.clone().sub(eye);
      const d = to.length();
      if (d > SEEKER.reach) continue;
      const dot = to.normalize().dot(fwd);
      if (dot > bestDot) { best = p; bestDot = dot; }
    }
    return best;
  }

  tryTake() {
    const p = this.lookedAtPage();
    if (!p) return;
    this.send('page', { n: p.n });
    this.takePage(p.n, true);
  }

  takePage(n, mine) {
    const p = this.pages.find((q) => q.n === n);
    if (!p || p.taken || this.over) return;
    p.taken = true;
    p.mesh.visible = false;
    this.found++;
    this.showCount();
    if (mine) {
      audio.page();
      const el = $('#page-text');
      el.textContent = MESSAGE[n - 1] ?? '';
      flash(el, 4500);
    }
    if (this.found >= PAGES) this.finish('pages', mine);
  }

  showCount() {
    $('#tb-pages').textContent = this.found;
    const el = $('#pages');
    el.textContent = `${this.found} / ${PAGES} pages`;
    if (this.found > 0 || this.role === 'hunter') flash(el, 3500);
  }

  // --- seeker: pistol ------------------------------------------------------------------

  shoot() {
    if (this.ammo <= 0) { audio.play('dry'); return; } // reloading
    this.ammo--;
    if (this.ammo === 0) { this.reloadUntil = now() + GUN.reloadMs; this.viewmodel.reload(GUN.reloadMs / 1000); }
    this.viewmodel.recoil();
    this.player.pitch = Math.min(1.45, this.player.pitch + 0.025); // a little kick
    audio.play('shot');
    const cam = this.engine.camera;
    const origin = cam.position.clone(), dir = this.player.forward;
    const far = origin.clone().addScaledVector(dir, GUN.range);
    const treeT = this.world.colliders.hit(origin, far);
    let endDist = treeT === null ? GUN.range : treeT * GUN.range;
    // ground along the way
    for (let d = 1; d < endDist; d += 0.5) {
      const p = origin.clone().addScaledVector(dir, d);
      if (p.y < this.world.heightAt(p.x, p.z)) { endDist = d; break; }
    }
    // did it hit the hunter where I see him? His head is a sphere, his body a cylinder below it.
    const rs = this.remoteState();
    let hit = false, head = false;
    if (rs) {
      const tHead = raySphere(origin, dir, new THREE.Vector3(rs.x, rs.y + GUN.headCenter, rs.z), GUN.headRadius);
      const tBody = rayCylinder(origin, dir, rs.x, rs.z, GUN.bodyRadius, rs.y + 0.1, rs.y + GUN.bodyTop);
      const t = Math.min(tHead ?? Infinity, tBody ?? Infinity);
      if (t < endDist) { hit = true; head = tHead !== null && tHead <= t; endDist = t; }
    }
    const muzzle = this.viewmodel.muzzleWorld();
    const end = origin.clone().addScaledVector(dir, endDist);
    this.effects.muzzle(muzzle);
    this.effects.tracer(muzzle, end);
    this.send('fx', { k: 'shot', from: arr(muzzle), to: arr(end) });
    if (hit) {
      this.send('hit', { head });
      this.hitmarker(false);
    }
    this.renderHud();
  }

  hitmarker(red) {
    const el = $('#hitmarker');
    el.classList.toggle('red', red);
    flash(el, 180);
  }

  // hunter side: I was shot
  onHit(head) {
    if (this.role !== 'hunter' || this.over) return;
    const t = now();
    if (t < this.stunnedUntil || t < this.immuneUntil) { this.send('stun', { ok: false }); return; }
    const ms = head ? GUN.headStunMs : GUN.bodyStunMs;
    this.stunnedUntil = t + ms;
    this.immuneUntil = this.stunnedUntil + GUN.immuneMs;
    if (this.aiming) this.cancelAim();
    audio.play('stun');
    this.send('stun', { ok: true, ms, head });
  }

  // seeker side: did my hit stun him?
  onStunReply(ok, ms, head) {
    if (ok) {
      this.remoteStunUntil = now() + ms;
      this.hitmarker(true);
      this.status(head ? 'Headshot · stunned 4s' : 'Stunned 2s', 1500);
      audio.play('stun');
    } else {
      this.status('Resisted', 1000);
    }
  }

  // --- seeker: abilities ----------------------------------------------------------------

  useDart() {
    if (this.cd.dart > 0) return audio.play('deny');
    this.cd.dart = DART.cooldown;
    const cam = this.engine.camera, f = this.player.forward;
    const origin = cam.position.clone().addScaledVector(f, 0.5);
    const vel = f.clone().multiplyScalar(DART.speed).add(new THREE.Vector3(0, 2, 0));
    this.launchDart(origin, vel, true);
    this.send('fx', { k: 'dart', p: arr(origin), v: arr(vel) });
    audio.play('dartFire');
    this.renderHud();
  }

  launchDart(origin, vel, mine) {
    this.effects.dart(origin, vel, {
      gravity: DART.gravity, pulses: DART.pulses, gap: DART.pulseGap, radius: DART.radius,
      onPulse: (p) => {
        audio.play('scan', this.at(p));
        if (!mine) return;
        // reveal the hunter if he's in range (the scan goes through trees, like sonar:
        // in a forest this dense a clear line of sight is rare)
        const rs = this.remoteState();
        if (!rs) return;
        if (new THREE.Vector3(rs.x, rs.y + 1.5, rs.z).distanceTo(p) < DART.radius) this.reveal(DART.revealMs);
      },
    });
  }

  useFlash() {
    if (this.cd.flash > 0) return audio.play('deny');
    this.cd.flash = FLASH.cooldown;
    const cam = this.engine.camera, f = this.player.forward;
    const origin = cam.position.clone().addScaledVector(f, 0.4);
    const vel = f.clone().multiplyScalar(FLASH.speed).add(new THREE.Vector3(0, 3, 0));
    this.launchFlash(origin, vel, true);
    this.send('fx', { k: 'flash', p: arr(origin), v: arr(vel) });
    audio.play('throw');
    this.renderHud();
  }

  // both players run the flash; the hunter checks whether it blinds him (the thrower is immune)
  launchFlash(origin, vel, mine) {
    // it pops early right next to the hunter's head, so a flash thrown at him can't fly past
    // and go off behind his back (both screens check, so they pop at the same spot)
    const hunterHead = () => {
      if (this.role === 'hunter') return this.engine.camera.position;
      const rs = this.remoteState();
      return rs ? new THREE.Vector3(rs.x, rs.y + HUNTER.eye, rs.z) : null;
    };
    this.effects.flash(origin, vel, {
      gravity: FLASH.gravity, fuse: FLASH.fuse, near: { at: hunterHead, dist: FLASH.nearPop },
      onPop: (p) => {
        audio.play('pop', this.at(p));
        if (mine) return;
        const eye = this.engine.camera.position;
        const to = p.clone().sub(eye);
        const d = to.length();
        if (d > FLASH.range || this.world.colliders.blocked(p, eye)) return;
        const facing = to.normalize().dot(this.player.forward);
        // right next to you it blinds whichever way you look; further away you have to be facing it
        const ms = d < FLASH.closeRange || facing > Math.cos(THREE.MathUtils.degToRad(50)) ? FLASH.fullMs
          : facing > Math.cos(THREE.MathUtils.degToRad(100)) ? FLASH.partialMs : 0;
        if (ms) this.blindUntil = Math.max(this.blindUntil, now() + ms);
      },
    });
  }

  useDash() {
    if (this.cd.dash > 0) return audio.play('deny');
    this.cd.dash = DASH.cooldown;
    const dir = this.player.moveDir();
    this.effects.wind(this.player.pos.clone(), dir);
    this.player.dash(DASH.distance, DASH.time);
    flash($('#speedlines'), 350);
    this.fovKick = 1;
    audio.play('dash');
    this.send('fx', { k: 'dash', p: arr(this.player.pos), d: arr(dir) });
    this.renderHud();
  }

  // the seeker sees the revealed hunter through trees; the hunter is told
  reveal(ms) {
    this.revealUntil = now() + ms;
    this.send('revealed', { ms });
  }

  // --- hunter: teleport --------------------------------------------------------------------

  startAim() {
    if (this.cd.tp > 0 || this.stunned || this.tpCast) return audio.play('deny');
    this.aiming = true;
    this.marker.visible = true;
    this.renderHud();
  }

  cancelAim() {
    this.aiming = false;
    this.marker.visible = false;
    this.renderHud();
  }

  // where the crosshair meets the ground, at most TELEPORT.range away, on a free spot
  aimPoint() {
    const cam = this.engine.camera, f = this.player.forward;
    let pt = null;
    for (let d = 1; d <= TELEPORT.range; d += 0.4) {
      const p = cam.position.clone().addScaledVector(f, d);
      if (p.y <= this.world.heightAt(p.x, p.z)) { pt = p; break; }
    }
    if (!pt) {
      // looking up: take the spot straight below the end of the range
      pt = cam.position.clone().addScaledVector(new THREE.Vector3(f.x, 0, f.z).normalize(), TELEPORT.range * Math.max(0.2, Math.hypot(f.x, f.z)));
    }
    const len = Math.hypot(pt.x, pt.z), lim = MAP.play - 1;
    if (len > lim) { pt.x *= lim / len; pt.z *= lim / len; }
    this.world.colliders.resolve(pt, 0.5);
    pt.y = this.world.heightAt(pt.x, pt.z);
    return pt;
  }

  // can the seeker see this spot right now?
  seekerSees(pt) {
    const rs = this.remoteState();
    if (!rs) return false;
    const eye = new THREE.Vector3(rs.x, rs.y + SEEKER.eye, rs.z);
    const target = pt.clone().add(new THREE.Vector3(0, 1.3, 0));
    const to = target.clone().sub(eye);
    const d = to.length();
    if (d > TELEPORT.seekerViewDist) return false;
    const fwd = new THREE.Vector3(-Math.sin(rs.yaw) * Math.cos(rs.pitch), Math.sin(rs.pitch), -Math.cos(rs.yaw) * Math.cos(rs.pitch));
    if (to.normalize().dot(fwd) < Math.cos(THREE.MathUtils.degToRad(TELEPORT.seekerView))) return false;
    return !this.world.colliders.blocked(eye, target);
  }

  releaseAim() {
    const pt = this.aimPoint();
    const ok = !this.seekerSees(pt);
    this.cancelAim();
    if (!ok) { audio.play('deny'); this.status('The seeker can see that spot', 1500); return; }
    // wind up for a moment first: smoke gathers where he stands and where he's going
    // (the seeker sees it too, a warning), and he can't move until it's done
    const from = this.player.pos.clone();
    this.tpCast = { until: now() + TELEPORT.castMs, from, to: pt };
    this.effects.tpWindup(from, TELEPORT.castMs / 1000);
    this.effects.tpWindup(pt, TELEPORT.castMs / 1000);
    audio.play('eye');
    this.send('fx', { k: 'tpcast', from: arr(from), to: arr(pt) });
    this.renderHud();
  }

  finishTeleport() {
    const { from, to: pt } = this.tpCast;
    this.tpCast = null;
    this.player.pos.copy(pt);
    this.player.vel.set(0, 0, 0);
    this.player.eyeY = pt.y + HUNTER.eye;
    this.tpCount++;
    this.cd.tp = TELEPORT.cooldown;
    this.effects.puff(from);
    this.effects.puff(pt);
    audio.play('tp');
    this.engine.film.uniforms.uStatic.value = 0.6;
    this.send('fx', { k: 'tp', from: arr(from), to: arr(pt) });
    this.sendState(); // right away, so the seeker sees him vanish at once
    this.renderHud();
  }

  // --- hunter: eye ------------------------------------------------------------------------

  useEye() {
    if (this.cd.eye > 0 || this.stunned) return audio.play('deny');
    this.cd.eye = EYE.cooldown;
    const cam = this.engine.camera, f = this.player.forward;
    const origin = cam.position.clone().addScaledVector(f, 0.6);
    this.launchEye(origin, f, true);
    this.send('fx', { k: 'eye', p: arr(origin), d: arr(f) });
    audio.play('eye');
    this.renderHud();
  }

  launchEye(origin, dir, mine) {
    this.effects.eye(origin, dir, {
      speed: EYE.speed, flight: EYE.flight, delay: EYE.delay, radius: EYE.radius,
      onScan: (p) => {
        audio.play('eyeScan', this.at(p));
        if (!mine) return;
        const rs = this.remoteState();
        if (!rs) return;
        // like the dart, the eye sees through trees, but not as far
        if (new THREE.Vector3(rs.x, rs.y + 1.2, rs.z).distanceTo(p) < EYE.radius) this.reveal(EYE.revealMs);
      },
    });
  }

  // --- the other player's effects ---------------------------------------------------------

  remoteFx(d) {
    if (this.over) return;
    switch (d.k) {
      case 'shot': {
        const from = v3(d.from);
        this.effects.muzzle(from);
        this.effects.tracer(from, v3(d.to));
        audio.play('shot', this.at(from));
        break;
      }
      case 'dart': this.launchDart(v3(d.p), v3(d.v), false); audio.play('dartFire', this.at(v3(d.p))); break;
      case 'flash': this.launchFlash(v3(d.p), v3(d.v), false); audio.play('throw', this.at(v3(d.p))); break;
      case 'dash': this.effects.wind(v3(d.p), d.d ? v3(d.d) : new THREE.Vector3(0, 0, -1)); audio.play('dash', this.at(v3(d.p))); break;
      case 'eye': this.launchEye(v3(d.p), v3(d.d), false); audio.play('eye', this.at(v3(d.p))); break;
      case 'tpcast':
        this.effects.tpWindup(v3(d.from), TELEPORT.castMs / 1000);
        this.effects.tpWindup(v3(d.to), TELEPORT.castMs / 1000);
        audio.play('eye', this.at(v3(d.to)));
        break;
      case 'tp':
        this.effects.puff(v3(d.from));
        this.effects.puff(v3(d.to));
        audio.play('tp', this.at(v3(d.from)));
        break;
    }
  }

  // --- HUD ---------------------------------------------------------------------------------

  status(text, ms) {
    const el = $('#status');
    el.textContent = text;
    flash(el, ms);
  }

  renderHud() {
    for (const el of document.querySelectorAll('#abilities .ab')) {
      const id = el.dataset.ab;
      const state = el.querySelector('.state'), bar = el.querySelector('.cd');
      const left = this.cd[id], total = COOLDOWN[id];
      el.classList.toggle('cooling', left > 0);
      el.classList.toggle('active', id === 'tp' && (this.aiming || !!this.tpCast));
      state.textContent = id === 'tp' && this.tpCast ? 'casting' : left > 0 ? `${Math.ceil(left)}s` : id === 'tp' && this.aiming ? 'release' : 'ready';
      bar.style.width = `${(left / total) * 100}%`;
    }
    if (this.role === 'seeker') {
      const reloading = this.ammo === 0;
      $('#ammo').innerHTML = `<div class="n ${reloading ? 'empty' : ''}">${this.ammo}</div><div class="w">${reloading ? 'Reloading' : 'Classic'}</div>`
        + (reloading ? '<div class="reload"><i id="reload-fill"></i></div>' : '');
    }
  }

  // --- round end -----------------------------------------------------------------------------

  finish(result, mine) {
    if (this.over) return;
    this.over = true;
    if (result === 'caught' && mine) this.send('caught', {});
    this.player.enabled = false;
    this.cancelAim();
    this.onEnd(result);
  }

  // where the other player is now (interpolated), or null before the first update
  remoteState() {
    const s = this.snaps;
    if (!s.length) return null;
    const t = now() - INTERP_MS;
    let i = s.length - 1;
    while (i > 0 && s[i - 1].t > t) i--;
    const b = s[i], a = s[Math.max(0, i - 1)];
    if (a === b || t >= b.t) return b;
    const k = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1);
    let dy = b.yaw - a.yaw;
    dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return {
      x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k,
      yaw: a.yaw + dy * k, pitch: a.pitch + (b.pitch - a.pitch) * k, fl: b.fl,
    };
  }

  sendState() {
    const p = this.player, r = (v) => Math.round(v * 100) / 100;
    this.send('s', { x: r(p.pos.x), y: r(p.pos.y), z: r(p.pos.z), yaw: r(p.yaw), pitch: r(p.pitch), fl: this.flashlight.on ? 1 : 0, tp: this.tpCount });
  }

  // --- every frame ---------------------------------------------------------------------------

  update(dt, time) {
    const { player, engine, flashlight } = this;
    const t = now();
    const film = engine.film.uniforms;

    // stun (hunter)
    if (this.role === 'hunter') {
      // a stun interrupts a teleport wind-up
      if (this.tpCast && this.stunned) { this.tpCast = null; this.renderHud(); }
      if (this.tpCast && now() >= this.tpCast.until) this.finishTeleport();
      player.frozen = this.stunned || !!this.tpCast;
      film.uTint.value += ((this.stunned ? 1 : 0) - film.uTint.value) * Math.min(1, dt * 8);
    }
    player.update(dt);

    // cooldowns (hunter)
    let cdChanged = false;
    for (const k in this.cd) if (this.cd[k] > 0) {
      const before = Math.ceil(this.cd[k]);
      this.cd[k] = Math.max(0, this.cd[k] - dt);
      if (Math.ceil(this.cd[k]) !== before) cdChanged = true;
      if (this.cd[k] === 0) audio.play('ready');
    }
    // the Classic reloads by itself once it's empty
    if (this.role === 'seeker' && this.ammo === 0) {
      const fill = document.getElementById('reload-fill');
      if (fill) fill.style.width = `${(1 - Math.max(0, this.reloadUntil - t) / GUN.reloadMs) * 100}%`;
      if (t >= this.reloadUntil) { this.ammo = GUN.ammo; audio.play('ready'); cdChanged = true; }
    }
    if (cdChanged) this.renderHud();

    // blinded by a flash: full white, fading out over the last 0.6 s
    film.uFlash.value = THREE.MathUtils.clamp((this.blindUntil - t) / 600, 0, 1);
    film.uStatic.value = Math.max(0, film.uStatic.value - dt * 2);

    // dash: a quick FOV punch
    this.fovKick = Math.max(0, this.fovKick - dt * 3);
    const fov = this.saved.fov + this.fovKick * 12;
    if (Math.abs(engine.camera.fov - fov) > 0.01) { engine.camera.fov = fov; engine.camera.updateProjectionMatrix(); }

    // send my position
    this.sendTimer -= dt;
    if (this.sendTimer <= 0 && !this.over) { this.sendTimer = 1 / NET_HZ; this.sendState(); }

    // teleport aim marker
    if (this.aiming) {
      const pt = this.aimPoint();
      this.marker.position.copy(pt);
      this.marker.userData.mat.color.set(this.seekerSees(pt) ? 0xff4655 : 0xb04dff);
    }

    this.effects.update(dt, engine.camera);

    // the other player
    const rs = this.remoteState();
    if (rs) {
      const r = this.remote;
      r.visible = true;
      r.position.set(rs.x, rs.y, rs.z);
      r.rotation.y = rs.yaw;
      r.userData.xray.visible = t < this.revealUntil;
      r.userData.skin?.update(time); // the glow in the Classic's mouth
      if (this.role === 'seeker') setStunGlow(r, t < this.remoteStunUntil ? 0.6 + 0.4 * Math.sin(time * 14) : 0);
      if (this.role === 'hunter') {
        // the seeker's torch lights my world too
        flashlight.on = !!rs.fl;
        r.userData.lens.visible = !!rs.fl;
        r.updateMatrixWorld();
        const from = r.localToWorld(r.userData.torchOffset.clone());
        const dir = new THREE.Vector3(-Math.sin(rs.yaw) * Math.cos(rs.pitch), Math.sin(rs.pitch), -Math.cos(rs.yaw) * Math.cos(rs.pitch));
        flashlight.update(dt, from, dir, time, false);
        // glare when the torch points at me
        const toMe = engine.camera.position.clone().sub(from).normalize();
        r.userData.glare.material.opacity = rs.fl ? Math.pow(Math.max(0, dir.dot(toMe)), 6) : 0;
        // caught? (not while stunned)
        if (!this.over && !this.stunned && Math.hypot(rs.x - player.pos.x, rs.z - player.pos.z) < HUNTER.catchDist) this.finish('caught', true);
      }
    }

    if (this.role === 'seeker') {
      this.viewmodel.lightOn = flashlight.on;
      this.viewmodel.update(dt, engine.camera, player);
      // the light is mounted under the pistol's barrel
      flashlight.update(dt, this.viewmodel.lensWorld(), player.forward, time);
      $('#prompt').classList.toggle('show', !!this.lookedAtPage() && !this.over);
      const st = $('#stamina-fill');
      st.style.width = `${(player.stamina / SEEKER.stamina) * 100}%`;
      st.parentElement.classList.toggle('show', player.stamina < SEEKER.stamina - 0.05);
    }

    // round timer in the top bar
    if (!this.over) {
      const secs = Math.floor((t - this.startedAt) / 1000);
      const txt = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      if (txt !== this.lastTime) { $('#tb-time').textContent = txt; this.lastTime = txt; }
    }

    // status line: stunned / revealed
    const el = $('#status');
    const sticky = this.role === 'hunter' && this.stunned ? `Stunned  ${((this.stunnedUntil - t) / 1000).toFixed(1)}`
      : t < this.meRevealedUntil ? 'You are revealed' : null;
    if (sticky) {
      el.textContent = sticky;
      el.classList.add('show');
      this.sticky = true;
    } else if (this.sticky) {
      el.classList.remove('show');
      this.sticky = false;
    }
  }

  dispose() {
    this.off.forEach((f) => f());
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('mousedown', this.onMouse);
    removeEventListener('contextmenu', this.onContext);
    for (const p of this.pages) {
      this.engine.scene.remove(p.mesh);
      p.mesh.material.map.dispose();
      p.mesh.material.dispose();
    }
    this.engine.scene.remove(this.remote, this.marker);
    this.effects.clear();
    const film = this.engine.film.uniforms;
    film.uFlash.value = 0; film.uTint.value = 0; film.uStatic.value = 0;
    this.engine.hemi.intensity = this.saved.hemi;
    film.uSaturation.value = this.saved.sat;
    this.engine.camera.fov = this.saved.fov;
    this.engine.camera.updateProjectionMatrix();
    this.viewmodel.visible = false;
    this.player.enabled = false;
    this.player.frozen = false;
    $('#prompt').classList.remove('show');
    $('#status').classList.remove('show');
    hud(false);
  }
}
