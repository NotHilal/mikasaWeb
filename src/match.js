// One round: places the pages, spawns both players, syncs positions, handles page
// pickups, the seeker's pistol and abilities, the hunter's teleport, eye and grab, stuns,
// reveals, and the end of the round.
import * as THREE from 'three';
import { net } from './net.js';
import { hunterFigure, seekerFigure, addXray, addShield, setStunGlow } from './figures.js';
import { audio } from './audio.js';
import { $, flash, hud, toast } from './ui.js';
import { settings } from './settings.js';
import { createMinimap, SCAN_SHOW, SCAN_COLOR } from './minimap.js';
import { crouchK } from './player.js';
import { actionFor, key, label, mouseCode } from './keys.js';
import { SEEKER, HUNTER, PAGES, MESSAGE, NET_HZ, MAP, GUN, DART, PAGE_HINT, FLASH, DASH, TELEPORT, EYE, DREAD, GRAB, LIGHT, SCARE, PAGE_ZONES } from './config.js';

const INTERP_MS = 110; // the other player is drawn this far in the past, to smooth over network jitter
const v3 = (a) => new THREE.Vector3().fromArray(a);
const arr = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
const now = () => performance.now();
// first distance along a ray (unit dir) where it enters a sphere, or null
export function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

// first distance along a ray where it enters an upright cylinder (centre x,z; radius r;
// from y0 to y1), or null
export function rayCylinder(o, d, cx, cz, r, y0, y1) {
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

// where the other player is now, from their latest position updates ({ t, x, y, z, yaw, pitch, … },
// oldest first), interpolated INTERP_MS in the past; null before the first one
export function remoteAt(s) {
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
    cr: (a.cr ?? 0) + ((b.cr ?? 0) - (a.cr ?? 0)) * k, // crouched (0..1)
  };
}

// Dev only (npm run dev, never in a build): F3 shows every page still to find on the minimap.
let devPages = false;
if (import.meta.env.DEV) {
  addEventListener('keydown', (e) => {
    if (e.code !== 'F3') return;
    e.preventDefault(); // (the browser's own F3 is Find)
    devPages = !devPages;
    toast(`Dev: pages on the map ${devPages ? 'on' : 'off'}`);
  });
}

const COOLDOWN = { dart: DART.cooldown, flash: FLASH.cooldown, dash: DASH.cooldown, tp: TELEPORT.cooldown, eye: EYE.cooldown, grab: GRAB.cooldown };

// ability slots shown in the HUD, per role: [key binding, name, cooldown id]
const KIT = {
  seeker: [['dart', 'Recon', 'dart'], ['flash', 'Flash', 'flash'], ['dash', 'Dash', 'dash']],
  hunter: [['teleport', 'Teleport', 'tp'], ['eye', 'Eye', 'eye'], ['grab', 'Grab', 'grab']],
};
const turnTo = (from, to, k) => from + ((((to - from + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * k;

export class Match {
  constructor({ engine, world, player, flashlight, viewmodel, hunterArms, effects }, { seed, role }, onEnd) {
    Object.assign(this, { engine, world, player, flashlight, viewmodel, hunterArms, effects, role, onEnd });
    this.over = false;
    this.found = 0;
    this.snaps = [];
    this.sendTimer = 0;
    this.off = [];

    // seeker kit
    this.ammo = GUN.ammo;
    this.reloadUntil = 0;
    // abilities: seconds until ready
    this.cd = role === 'seeker' ? { dart: 0, flash: 0, dash: 0 } : { tp: 0, eye: 0, grab: 0 };
    // the grab: how many times the hunter has grabbed the seeker (both screens count), and the
    // one in progress: { n, kill, start, until, need, drain, progress } (times in ms)
    this.grabs = 0;
    this.grab = null;
    this.pose = { grab: 0, struggle: 0, lift: 0, scare: 0 }; // the other player's figure, smoothed
    this.scare = null; // the jumpscare, each time the seeker is grabbed: { start, until, light }
    if (role === 'seeker') audio.preload(SCARE.sound);
    this.aiming = false;
    this.tpCount = 0;
    this.remoteTp = 0;
    // timers (performance.now() ms)
    this.stunnedUntil = 0;      // hunter: frozen until
    this.immuneUntil = 0;       // hunter: can't be stunned again until
    this.remoteStunUntil = 0;   // seeker: draw the hunter glowing red until
    this.remoteImmuneUntil = 0; // seeker: the hunter can't be stunned (his shield shows) until
    this.revealUntil = 0;       // the other player shows through trees until
    this.meRevealedUntil = 0;   // I'm revealed (warning) until
    this.blindUntil = 0;
    this.fovKick = 0;
    this.dread = 0;             // seeker: 0..1, how close/visible the hunter is (static + heartbeat)
    this.beatT = 0;
    this.startedAt = now();
    // stuck without a page for a while: the dart finds pages too (see PAGE_HINT)
    this.lastPageAt = this.startedAt;
    this.hintShown = false;     // told the seeker the dart can find pages now
    this.pageReveal = null;     // { page, until }: the page glowing through the trees
    // for the end-of-round recap: both paths, the closest the hunter got, stuns landed
    this.track = { seeker: [], hunter: [] };
    this.trackT = 0;
    this.closest = { d: Infinity, seeker: null, hunter: null, t: 0 };
    this.stuns = 0;

    // spawns: far apart, both facing the middle of the map
    const seekerSpawn = world.spawnPoint(seed * 3 + 1);
    const hunterSpawn = world.spawnPoint(seed * 7 + 2, seekerSpawn);

    // pages: new spots every round (not right where the seeker starts)
    this.pages = world.placePages(world.pickPages(seed, seekerSpawn));
    const mine = role === 'seeker' ? seekerSpawn : hunterSpawn;
    player.spawn(mine, role, role === 'seeker' ? SEEKER : HUNTER, new THREE.Vector3(0, 0, 0));
    player.onStep = (speed) => audio.step(speed);
    player.enabled = true;

    // the other player
    this.remote = role === 'seeker' ? hunterFigure() : seekerFigure();
    this.remote.visible = false;
    addXray(this.remote);
    if (role === 'seeker') addShield(this.remote, GUN.headCenter + GUN.headRadius);
    engine.scene.add(this.remote);

    // the hunter sees in the dark (dimly); the seeker relies on the flashlight
    this.saved = { hemi: engine.hemi.intensity, moon: engine.moon.intensity, sat: engine.film.uniforms.uSaturation.value };
    if (role === 'hunter') {
      engine.hemi.intensity = LIGHT.hunterAmbient;
      engine.moon.intensity = LIGHT.hunterMoon;
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
      net.on('stun', ({ ok, ms, head, left }) => this.onStunReply(ok, ms, head, left)),
      net.on('grab', ({ n }) => this.onGrabbed(n)),
      net.on('escaped', () => this.onEscaped()),
      net.on('pagehint', () => { if (role === 'hunter') this.status('A page was revealed', 2000); }),
      net.on('revealed', ({ ms }) => {
        this.meRevealedUntil = now() + ms;
        audio.play('revealed');
      }),
    );

    // input: keys and mouse buttons alike, by code (see keys.js)
    const press = (code) => {
      if (!this.player.enabled || this.over || !document.pointerLockElement) return;
      const a = actionFor(code, role);
      // during a grab the only thing either of them can do is (the seeker) try to break free
      if (this.grab) { if (code === key('escape')) this.struggle(); return; }
      if (role === 'seeker') {
        if (a === 'shoot') this.shoot();
        if (a === 'reload') this.reload();
        if (a === 'light') { flashlight.on = !flashlight.on; audio.click(); }
        if (a === 'take') this.tryTake();
        if (a === 'dart') this.useDart();
        if (a === 'flash') this.useFlash();
        if (a === 'dash') this.useDash();
        if (a === 'inspect') this.viewmodel.inspect();
      } else {
        if (a === 'teleport') this.startAim();
        if (a === 'eye') this.useEye();
        if (a === 'grab') this.tryGrab();
        if (a === 'cancelTp' && this.aiming) this.cancelAim();
      }
    };
    const release = (code) => { if (code === key('teleport') && this.aiming) this.releaseAim(); };
    this.onKey = (e) => { if (!e.repeat) press(e.code); };
    this.onKeyUp = (e) => release(e.code);
    this.onMouse = (e) => press(mouseCode(e.button));
    this.onMouseUp = (e) => release(mouseCode(e.button));
    this.onContext = (e) => e.preventDefault();
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('mousedown', this.onMouse);
    addEventListener('mouseup', this.onMouseUp);
    addEventListener('contextmenu', this.onContext);

    // HUD
    $('#role-tag').textContent = role === 'seeker' ? 'Seeker' : 'Hunter';
    $('#pages').classList.remove('show');
    $('#page-text').classList.remove('show');
    $('#stamina-fill').parentElement.classList.toggle('show', false);
    $('#abilities').innerHTML = KIT[role].map(([action, name, id]) =>
      `<div class="ab" data-ab="${id}"><div class="key">${label(action)}</div><div class="name">${name}</div><div class="state"></div><div class="cd"></div></div>`).join('');
    $('#escape').classList.remove('show');
    $('#escape-key').textContent = label('escape');
    $('#ammo').style.display = role === 'seeker' ? '' : 'none';
    $('#tb-total').textContent = PAGES;
    this.minimap = createMinimap($('#minimap'), world);
    this.mapT = 0;
    this.scans = []; // zones my dart or eye scanned, for the minimap: { x, z, r, color, at }
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

  // freeze the round while a player is disconnected, and pick it up where it was afterwards
  setPaused(on) {
    if (on === !!this.pausedAt) return;
    if (on) {
      this.pausedAt = now();
      this.player.enabled = false;
      if (this.aiming) this.cancelAim();
      return;
    }
    // push every running timer back by the time we were frozen
    const gap = now() - this.pausedAt;
    this.pausedAt = 0;
    for (const k of ['startedAt', 'stunnedUntil', 'immuneUntil', 'remoteStunUntil', 'remoteImmuneUntil', 'revealUntil', 'meRevealedUntil', 'blindUntil', 'reloadUntil']) {
      if (this[k]) this[k] += gap;
    }
    if (this.tpCast) this.tpCast.until += gap;
    for (const s of this.scans) s.at += gap;
    this.lastPageAt += gap;
    if (this.pageReveal) this.pageReveal.until += gap;
    if (this.grab) { this.grab.start += gap; this.grab.until += gap; }
    this.snaps = []; // the other player's old positions; fresh ones follow at once
    this.player.enabled = !this.over;
  }

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
    this.lastPageAt = now(); // (the wait for the dart to find pages starts over)
    this.hintShown = false;
    if (this.pageReveal?.page === p) this.pageReveal = null;
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

  // R (or by itself once it's empty): the Classic can't fire until it's full again
  reload() {
    if (this.reloadUntil || this.ammo >= GUN.ammo) return;
    this.reloadUntil = now() + GUN.reloadMs;
    this.viewmodel.reload(GUN.reloadMs / 1000);
    this.renderHud();
  }

  shoot() {
    if (this.reloadUntil || this.ammo <= 0) { audio.play('dry'); return; } // reloading
    this.ammo--;
    this.viewmodel.recoil();
    if (this.ammo === 0) this.reload();
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
      const h = crouchK(rs.cr); // (shorter when he crouches)
      const tHead = raySphere(origin, dir, new THREE.Vector3(rs.x, rs.y + GUN.headCenter * h, rs.z), GUN.headRadius);
      const tBody = rayCylinder(origin, dir, rs.x, rs.z, GUN.bodyRadius, rs.y + 0.1, rs.y + GUN.bodyTop * h);
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
    // (the reply says how long it lasts, so the seeker's screen shows it even if a message was missed)
    if (t < this.stunnedUntil || t < this.immuneUntil) { this.send('stun', { ok: false, left: Math.max(this.stunnedUntil, this.immuneUntil) - t }); return; }
    const ms = head ? GUN.headStunMs : GUN.bodyStunMs;
    this.stunnedUntil = t + ms;
    this.shoved = false;
    this.immuneUntil = this.stunnedUntil + GUN.immuneMs;
    this.stuns++;
    if (this.aiming) this.cancelAim();
    audio.play('stun');
    this.send('stun', { ok: true, ms, head });
  }

  // seeker side: did my hit stun him?
  onStunReply(ok, ms, head, left = 0) {
    if (ok) {
      this.stuns++;
      this.remoteStunUntil = now() + ms;
      this.remoteImmuneUntil = this.remoteStunUntil + GUN.immuneMs;
      this.hitmarker(true);
      this.status(head ? 'Headshot · stunned 4s' : 'Stunned 2s', 1500);
      audio.play('stun');
    } else {
      this.remoteImmuneUntil = Math.max(this.remoteImmuneUntil, now() + left);
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
        this.mapScan(p, DART.radius, 'dart');
        this.dartFindsPage(p);
        // reveal the hunter if he's in range (the scan goes through trees, like sonar:
        // in a forest this dense a clear line of sight is rare)
        const rs = this.remoteState();
        if (!rs) return;
        if (new THREE.Vector3(rs.x, rs.y + 1.5, rs.z).distanceTo(p) < DART.radius) this.reveal(DART.revealMs);
      },
    });
  }

  // seeker, once the round has run PAGE_ZONES.afterMs: each missing page gets a circle on the
  // minimap, with the page somewhere inside it (not at the middle)
  showPageZones() {
    this.zonesShown = true;
    const r = PAGE_ZONES.radius;
    for (const p of this.pages) {
      if (p.taken) continue;
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * PAGE_ZONES.offset * r;
      p.zone = { x: p.pos.x + Math.cos(a) * d, z: p.pos.z + Math.sin(a) * d, r };
    }
    const left = this.pages.filter((p) => !p.taken).length;
    this.status(`${left === 1 ? 'The last page is' : `The ${left} missing pages are`} circled on your map`, 4000);
    audio.play('ready');
    this.mapT = 0;
  }

  // my own dart or eye scanned here: the zone shows on my minimap for a few seconds
  mapScan(p, r, kind) {
    this.scans.push({ x: p.x, z: p.z, r, color: SCAN_COLOR[kind], at: now() });
    this.mapT = 0; // (draw it now)
  }

  // after PAGE_HINT.afterMs without a page, a dart scan shows the closest page in its range
  dartFindsPage(at) {
    if (now() - this.lastPageAt < PAGE_HINT.afterMs) return;
    let best = null, bestD = DART.radius;
    for (const p of this.pages) {
      if (p.taken) continue;
      const d = p.pos.distanceTo(at);
      if (d < bestD) { best = p; bestD = d; }
    }
    if (!best) return;
    const fresh = this.pageReveal?.page !== best || now() > this.pageReveal.until;
    this.pageReveal = { page: best, until: now() + PAGE_HINT.revealMs };
    if (!fresh) return;
    this.status('Page revealed', 1500);
    audio.play('ready');
    this.send('pagehint', {});
  }

  // a page glowing through the trees: a bright copy drawn over everything, with a halo
  pageGlow(p) {
    if (p.glow) return p.glow;
    const g = new THREE.Group();
    const paper = new THREE.Mesh(p.mesh.geometry, new THREE.MeshBasicMaterial({
      map: p.mesh.material.map, color: 0xc8fff4, transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    const halo = this.effects.sprite(0x3fe0c5, 2.8, 0.8); // (big enough to spot from across a scan)
    halo.material.depthTest = false;
    halo.material.fog = false;
    g.add(paper, halo);
    g.traverse((o) => { o.renderOrder = 999; });
    p.mesh.add(g);
    p.glow = g;
    return g;
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
    this.player.air = 0; this.player.vy = 0;
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

  // press once to throw the eye; press again while it's flying to stop it there and reveal
  useEye() {
    if (this.eyeOut?.flying) {
      this.eyeOut.stop();
      this.send('fx', { k: 'eyestop', p: arr(this.eyeOut.pos) });
      this.eyeOut = null;
      audio.click();
      this.renderHud();
      return;
    }
    if (this.cd.eye > 0 || this.stunned) return audio.play('deny');
    this.cd.eye = EYE.cooldown;
    const cam = this.engine.camera, f = this.player.forward;
    const origin = cam.position.clone().addScaledVector(f, 0.6);
    this.eyeOut = this.launchEye(origin, f, true);
    this.send('fx', { k: 'eye', p: arr(origin), d: arr(f) });
    audio.play('eye');
    this.renderHud();
  }

  launchEye(origin, dir, mine) {
    return this.effects.eye(origin, dir, {
      speed: EYE.speed, flight: EYE.flight, delay: EYE.delay, radius: EYE.radius,
      onScan: (p) => {
        audio.play('eyeScan', this.at(p));
        if (!mine) return;
        this.mapScan(p, EYE.radius, 'eye');
        const rs = this.remoteState();
        if (!rs) return;
        // like the dart, the eye sees through trees, but not as far
        if (new THREE.Vector3(rs.x, rs.y + 1.2, rs.z).distanceTo(p) < EYE.radius) this.reveal(EYE.revealMs);
      },
    });
  }

  // --- hunter: grab ------------------------------------------------------------------------
  // Get close and press Grab. The seeker is pulled in and has to mash Break free; the first
  // grab is easy to escape, the second hard, the third can't be escaped (see GRAB).
  // The hunter decides a grab happened; the seeker decides whether they broke free.

  // is the seeker close enough, and in front of me?
  canGrab(rs = this.remoteState()) {
    if (this.role !== 'hunter' || this.grab || this.cd.grab > 0 || this.stunned || this.tpCast || this.over || !rs) return false;
    const to = new THREE.Vector3(rs.x - this.player.pos.x, 0, rs.z - this.player.pos.z);
    const d = to.length();
    if (d > GRAB.range) return false;
    const f = this.player.forward.setY(0).normalize();
    return d < 0.6 || to.normalize().dot(f) > Math.cos(THREE.MathUtils.degToRad(GRAB.angle));
  }

  tryGrab() {
    if (!this.canGrab()) return audio.play('deny');
    if (this.aiming) this.cancelAim();
    const n = ++this.grabs, kill = n >= GRAB.kill, t = now();
    const e = GRAB.escape[Math.min(n, GRAB.escape.length) - 1];
    // if the seeker never answers (they'd have broken free or been caught by then), let go
    this.grab = { n, kill, start: t, until: t + (kill ? GRAB.killMs : e.time * 1000 + SCARE.ms + 2500) };
    this.send('grab', { n });
    audio.play('grab');
    this.status(kill ? 'Got them' : `Grab ${n} of ${GRAB.kill}`, 1600);
    this.renderHud();
  }

  // seeker side: he's got me
  onGrabbed(n) {
    if (this.role !== 'seeker' || this.over) return;
    this.grabs = n;
    const kill = n >= GRAB.kill, t = now();
    const e = GRAB.escape[Math.min(n, GRAB.escape.length) - 1];
    // (an escapable grab's clock starts once the jumpscare is over; the hunter allows for that)
    this.grab = { n, kill, start: t, until: t + (kill ? GRAB.killMs : e.time * 1000 + SCARE.ms), need: e.presses, drain: e.drain, progress: 0 };
    this.player.dashT = 0;
    this.jolt = 1;
    audio.play('grab');
    if (kill) this.status('Caught', GRAB.killMs);
    this.startScare(kill);
  }

  // seeker: grabbed: his face, right up close, for SCARE.ms; then (unless it's the last grab)
  // the fight to break free
  startScare(last = false) {
    if (this.role !== 'seeker') return;
    // (the last grab: it lasts until the round ends)
    this.scare = { start: now(), until: last ? Infinity : now() + SCARE.ms, light: this.flashlight.on };
    this.viewmodel.visible = false;
    hud(false); // nothing in front of his face
    this.setPrompt(null);
    this.flashlight.on = true; // (so his face is lit)
    $('#escape').classList.remove('show');
    this.engine.film.uniforms.uStatic.value = 1;
    audio.file(SCARE.sound, SCARE.volume, 'scare');
  }

  endScare() {
    const s = this.scare;
    this.scare = null;
    this.scareFace = null;
    if (this.over) return; // (the last grab: the round's end screen takes over)
    this.viewmodel.visible = true;
    this.flashlight.on = s.light;
    hud(true);
    // now the fight: its time bar starts full
    if (this.grab && !this.grab.kill) { this.grab.start = now(); $('#escape').classList.add('show'); }
  }

  // every frame of the jumpscare, after the player has placed the camera: pull it up to his
  // face, shaking, and look him in the eye
  updateScare(t) {
    const s = this.scare, r = this.remote, cam = this.engine.camera;
    if (!s) return;
    if (t >= s.until && !this.over) return this.endScare();
    if (!r.visible) return;
    const k = THREE.MathUtils.clamp((t - s.start) / SCARE.rushMs, 0, 1), ease = 1 - (1 - k) ** 3;
    // his face, in his own space (he faces -z), where the tilted head puts it
    r.updateMatrixWorld();
    const u = r.userData.tentacles, tilt = u?.uTilt.value ?? 0;
    const neck = u ? u.uNeck.value.clone() : new THREE.Vector3(0, 2.2, 0);
    const face = r.localToWorld(neck.add(new THREE.Vector3(-Math.sin(tilt) * 0.28,Math.cos(tilt) * 0.28, -0.1)));
    const front = r.localToWorld(new THREE.Vector3(0, 0, -1)).sub(r.getWorldPosition(new THREE.Vector3())).setY(0).normalize();
    const to = face.clone().addScaledVector(front, SCARE.dist);
    const shake = 0.012 + 0.04 * (1 - THREE.MathUtils.smoothstep(t - s.start, 0, 600));
    cam.position.lerp(to, ease).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake));
    cam.lookAt(face);
    cam.fov = settings.fov - SCARE.fovDrop * ease;
    cam.updateProjectionMatrix();
    this.scareFace = face; // (the flashlight lights it)
    // and keep the player looking the same way, so nothing pulls the view back
    const d = face.clone().sub(cam.position);
    this.player.yaw = Math.atan2(-d.x, -d.z);
    this.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    // static: a burst as he lunges, then a light flicker with the odd spike
    const film = this.engine.film.uniforms, since = t - s.start;
    film.uStatic.value = since < SCARE.rushMs + 80 ? 0.9 : Math.random() < 0.06 ? 0.6 : 0.12 + 0.1 * Math.random();
  }

  // seeker: one press of Break free
  struggle() {
    const g = this.grab;
    if (this.role !== 'seeker' || !g || g.kill || this.scare) return; // (not while he's in my face)
    g.progress++;
    this.jolt = 1;
    audio.play('struggle');
    if (g.progress >= g.need) this.breakFree();
  }

  breakFree() {
    const n = this.grab.n, p = this.player;
    this.grab = null;
    this.send('escaped', {});
    // shove off him: a quick burst straight away
    const rs = this.remoteState();
    const away = rs ? new THREE.Vector3(p.pos.x - rs.x, 0, p.pos.z - rs.z) : new THREE.Vector3();
    if (away.lengthSq() < 1e-4) away.copy(p.forward).setY(0).negate();
    p.dashVel.copy(away.normalize()).multiplyScalar(GRAB.shoveDist / 0.3);
    p.dashT = 0.3;
    p.lift = 0;
    $('#escape').classList.remove('show');
    audio.play('breakFree');
    this.status(n >= GRAB.kill - 1 ? "Broke free · one more grab and you're dead" : 'Broke free · the next grab is harder', 2600);
  }

  // hunter side: they got away
  onEscaped() {
    if (this.role !== 'hunter' || !this.grab) return;
    this.release(true);
  }

  release(escaped) {
    this.grab = null;
    this.cd.grab = GRAB.cooldown;
    if (escaped) {
      // they shoved me: I stagger for a moment
      this.stunnedUntil = Math.max(this.stunnedUntil, now() + GRAB.shoveMs);
      this.shoved = true;
      audio.play('breakFree');
    }
    this.renderHud();
  }

  // every frame of a grab (both screens): the seeker is pulled in front of the hunter and they
  // look at each other; then it ends one way or the other
  holdGrab(dt, rs, t) {
    const g = this.grab, p = this.player, k = Math.min(1, dt * 10);
    if (rs) {
      if (this.role === 'seeker') {
        const away = new THREE.Vector3(p.pos.x - rs.x, 0, p.pos.z - rs.z);
        if (away.lengthSq() < 1e-4) away.set(-Math.sin(rs.yaw), 0, -Math.cos(rs.yaw));
        away.normalize();
        p.pos.x += (rs.x + away.x * GRAB.holdDist - p.pos.x) * k;
        p.pos.z += (rs.z + away.z * GRAB.holdDist - p.pos.z) * k;
        // the last grab lifts them off the ground
        p.lift = g.kill ? THREE.MathUtils.smoothstep(t - g.start, 0, GRAB.killMs * 0.6) * 0.5 : 0;
      }
      const lookY = this.role === 'seeker' ? rs.y + HUNTER.eye : rs.y + 1.4 + (this.pose.lift * 0.5);
      const flat = Math.max(0.3, Math.hypot(rs.x - p.pos.x, rs.z - p.pos.z));
      p.yaw = turnTo(p.yaw, Math.atan2(-(rs.x - p.pos.x), -(rs.z - p.pos.z)), k);
      p.pitch += (Math.atan2(lookY - this.engine.camera.position.y, flat) - p.pitch) * k;
    }
    if (this.role === 'seeker') {
      if (!g.kill) {
        g.progress = Math.max(0, g.progress - g.drain * dt);
        // didn't get free in time: caught
        if (t >= g.until) { this.send('caught', {}); this.finish('caught', false); }
      } else if (t >= g.until + 2500) this.finish('caught', false); // (if his message never comes)
    } else if (t >= g.until) {
      if (g.kill) this.finish('caught', true);
      else this.release(false);
    }
  }

  setPrompt(html) {
    if (html === this.promptHtml) return;
    this.promptHtml = html;
    const el = $('#prompt');
    if (html) el.innerHTML = html;
    el.classList.toggle('show', !!html);
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
      case 'eye': this.remoteEye = this.launchEye(v3(d.p), v3(d.d), false); audio.play('eye', this.at(v3(d.p))); break;
      case 'eyestop': this.remoteEye?.stop(v3(d.p)); this.remoteEye = null; break; // stopped early: at the hunter's spot
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
      el.classList.toggle('active', (id === 'tp' && (this.aiming || !!this.tpCast)) || (id === 'grab' && !!this.grab) || (id === 'eye' && !!this.eyeOut?.flying));
      state.textContent = id === 'tp' && this.tpCast ? 'casting' : id === 'eye' && this.eyeOut?.flying ? 'stop' : left > 0 ? `${Math.ceil(left)}s` : id === 'tp' && this.aiming ? 'release'
        : id === 'grab' ? (this.grab ? 'holding' : `${this.grabs} / ${GRAB.kill}`) : 'ready';
      bar.style.width = `${(left / total) * 100}%`;
    }
    if (this.role === 'seeker') {
      const reloading = !!this.reloadUntil;
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
    $('#escape').classList.remove('show');
    this.setPrompt(null);
    this.record(this.remoteState(), 0, true);
    this.onEnd(result, this.recap(result));
  }

  // --- recap -----------------------------------------------------------------------------------

  // add both players' positions to their paths (4 times a second, or right now if `force`)
  record(rs, dt, force = false) {
    const mine = this.track[this.role], theirs = this.track[this.role === 'seeker' ? 'hunter' : 'seeker'];
    const add = (list, x, z) => {
      const last = list[list.length - 1];
      // a jump (teleport, dash, a lag spike) starts a new stretch of line instead of drawing across the map
      if (last && Math.hypot(last.x - x, last.z - z) > 6) list.push(null);
      list.push({ x, z });
    };
    if (rs) {
      // the closest call, on this screen's view of things
      const d = Math.hypot(rs.x - this.player.pos.x, rs.z - this.player.pos.z);
      if (d < this.closest.d) {
        const me = { x: this.player.pos.x, z: this.player.pos.z }, them = { x: rs.x, z: rs.z };
        Object.assign(this.closest, { d, t: now() - this.startedAt }, this.role === 'seeker' ? { seeker: me, hunter: them } : { seeker: them, hunter: me });
      }
    }
    this.trackT -= dt;
    if (this.trackT > 0 && !force) return;
    this.trackT = 0.25;
    add(mine, this.player.pos.x, this.player.pos.z);
    if (rs) add(theirs, rs.x, rs.z);
  }

  recap(result) {
    return {
      result,
      track: this.track,
      closest: this.closest.d < Infinity ? this.closest : null,
      pages: this.pages.map((p) => ({ x: p.pos.x, z: p.pos.z, taken: p.taken })),
      found: this.found,
      time: now() - this.startedAt,
      stuns: this.stuns,
    };
  }

  // where the other player is now (interpolated), or null before the first update
  remoteState() { return remoteAt(this.snaps); }

  sendState() {
    const p = this.player, r = (v) => Math.round(v * 100) / 100;
    this.send('s', { x: r(p.pos.x), y: r(p.pos.y), z: r(p.pos.z), yaw: r(p.yaw), pitch: r(p.pitch), fl: this.flashlight.on ? 1 : 0, tp: this.tpCount, cr: r(p.crouch) });
  }

  // --- every frame ---------------------------------------------------------------------------

  update(dt, time) {
    if (this.pausedAt) return;
    const { player, engine, flashlight } = this;
    const t = now();
    const film = engine.film.uniforms;
    const rs = this.remoteState(); // the other player, now

    if (this.grab && !this.over) this.holdGrab(dt, rs, t);

    // stun (hunter)
    if (this.role === 'hunter') {
      // a stun interrupts a teleport wind-up
      if (this.tpCast && this.stunned) { this.tpCast = null; this.renderHud(); }
      if (this.tpCast && now() >= this.tpCast.until) this.finishTeleport();
      player.frozen = this.stunned || !!this.tpCast || !!this.grab;
      film.uTint.value += ((this.stunned ? 1 : 0) - film.uTint.value) * Math.min(1, dt * 8);
    } else player.frozen = !!this.grab;
    player.update(dt);

    // cooldowns (hunter)
    let cdChanged = false;
    for (const k in this.cd) if (this.cd[k] > 0) {
      const before = Math.ceil(this.cd[k]);
      this.cd[k] = Math.max(0, this.cd[k] - dt);
      if (Math.ceil(this.cd[k]) !== before) cdChanged = true;
      if (this.cd[k] === 0) audio.play('ready');
    }
    // reloading (R, or by itself once empty): full again when it's done
    if (this.role === 'seeker' && this.reloadUntil) {
      const fill = document.getElementById('reload-fill');
      if (fill) fill.style.width = `${(1 - Math.max(0, this.reloadUntil - t) / GUN.reloadMs) * 100}%`;
      if (t >= this.reloadUntil) { this.ammo = GUN.ammo; this.reloadUntil = 0; audio.play('ready'); cdChanged = true; }
    }
    if (this.eyeOut && !this.eyeOut.flying) { this.eyeOut = null; cdChanged = true; }
    if (cdChanged) this.renderHud();

    // blinded by a flash: full white, fading out over the last 0.6 s
    film.uFlash.value = THREE.MathUtils.clamp((this.blindUntil - t) / 600, 0, 1);
    film.uStatic.value = Math.max(0, film.uStatic.value - dt * 2);

    // dash: a quick FOV punch
    this.fovKick = Math.max(0, this.fovKick - dt * 3);
    const fov = settings.fov + this.fovKick * 12; // (the setting can change from the pause screen)
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
    if (rs) {
      const r = this.remote;
      r.visible = true;
      r.position.set(rs.x, rs.y, rs.z);
      r.rotation.y = rs.yaw;
      r.scale.y = crouchK(rs.cr); // crouching
      // walk cycle, at the speed they're really moving (a teleport's jump doesn't count)
      const moved = this.lastRemote ? Math.hypot(rs.x - this.lastRemote.x, rs.z - this.lastRemote.z) / Math.max(dt, 1e-3) : 0;
      this.lastRemote = { x: rs.x, z: rs.z };
      this.remoteSpeed = (this.remoteSpeed ?? 0) + ((moved > 15 ? 0 : moved) - (this.remoteSpeed ?? 0)) * Math.min(1, dt * 8);
      // grab poses: on my screen he reaches for me, or (hunter) they struggle / are lifted
      const g = this.grab;
      const want = this.role === 'seeker' ? { grab: g ? 1 : 0, struggle: 0, lift: 0, scare: this.scare ? 1 : 0 }
        : { grab: 0, struggle: g && !g.kill ? 1 : 0, lift: g?.kill ? THREE.MathUtils.smoothstep(t - g.start, 0, GRAB.killMs * 0.6) : 0, scare: 0 };
      for (const k in this.pose) this.pose[k] += (want[k] - this.pose[k]) * Math.min(1, dt * (k === 'scare' ? 14 : 10));
      // the jumpscare: he turns to face me
      if (this.scare) r.rotation.y = Math.atan2(-(this.player.pos.x - rs.x), -(this.player.pos.z - rs.z));
      r.userData.animate?.(dt, this.remoteSpeed, time, this.pose);
      r.userData.xray.visible = t < this.revealUntil;
      r.userData.skin?.update(time); // the glow in the Classic's mouth
      if (this.role === 'seeker') {
        setStunGlow(r, t < this.remoteStunUntil ? 0.6 + 0.4 * Math.sin(time * 14) : 0);
        // his shield while he's immune: fades in, and flickers in its last half second
        const left = t < this.remoteStunUntil ? 0 : this.remoteImmuneUntil - t;
        const k = left <= 0 ? 0 : Math.min(1, (GUN.immuneMs - left) / 150) * (left < 600 ? 0.35 + 0.65 * (Math.sin(time * 38) > 0) : 1);
        r.userData.shield(k, time);
      }
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
      }
    }

    this.updateScare(t);

    if (this.role === 'hunter') {
      // my own arms reach out while I hold them
      this.armK = (this.armK ?? 0) + ((this.grab ? 1 : 0) - (this.armK ?? 0)) * Math.min(1, dt * 9);
      this.hunterArms?.update(dt, engine.camera, this.armK, time);
      this.setPrompt(this.canGrab(rs) ? `<b>${label('grab')}</b> Grab` : null);
    }

    if (this.role === 'seeker') {
      this.updateDread(dt, rs);
      // the dart can find pages now: say so once
      if (!this.hintShown && !this.over && t - this.lastPageAt >= PAGE_HINT.afterMs) {
        this.hintShown = true;
        this.status('Recon can now find pages', 3500);
        audio.play('ready');
      }
      // late in the round: a rough circle round each missing page on the minimap
      if (!this.zonesShown && !this.over && t - this.startedAt >= PAGE_ZONES.afterMs) this.showPageZones();
      // the revealed page: fades out over its last half second
      for (const p of this.pages) {
        const left = this.pageReveal?.page === p ? this.pageReveal.until - t : 0;
        if (left > 0) {
          const g = this.pageGlow(p), k = Math.min(1, left / 500);
          g.visible = true;
          g.children[0].material.opacity = 0.9 * k;
          g.children[1].material.opacity = (0.55 + 0.25 * Math.sin(time * 6)) * k;
        } else if (p.glow) p.glow.visible = false;
      }
    }
    if (!this.over) this.record(rs, dt);

    if (this.role === 'seeker') {
      this.viewmodel.lightOn = flashlight.on;
      this.viewmodel.update(dt, engine.camera, player);
      // the light is mounted under the pistol's barrel; in the jumpscare it lights his face from below
      if (this.scare && this.scareFace) {
        const from = engine.camera.position.clone().add(new THREE.Vector3(0, -0.4, 0));
        flashlight.update(dt, from, this.scareFace.clone().sub(from).normalize(), time, false);
        // (dimmer: at this distance the full beam just turns him white) and stuttering
        flashlight.light.intensity *= Math.random() < 0.08 ? 0.05 : 0.18;
      } else flashlight.update(dt, this.viewmodel.lensWorld(), player.forward, time);
      this.setPrompt(this.lookedAtPage() && !this.over && !this.grab ? `<b>${label('take')}</b> Take page` : null);
      // held: the view shakes, harder each time they struggle; the bars show how it's going
      const g = this.grab;
      if (g && !this.over) {
        this.jolt = Math.max(0, (this.jolt ?? 0) - dt * 6);
        const sh = 0.008 + 0.03 * this.jolt + (g.kill ? 0.02 : 0);
        engine.camera.position.x += (Math.random() - 0.5) * sh;
        engine.camera.position.y += (Math.random() - 0.5) * sh;
        if (!g.kill) {
          $('#escape-fill').style.width = `${Math.min(1, g.progress / g.need) * 100}%`;
          $('#escape-time').style.width = `${Math.max(0, (g.until - t) / (g.until - g.start)) * 100}%`;
        }
      }
      const st = $('#stamina-fill');
      st.style.width = `${(player.stamina / SEEKER.stamina) * 100}%`;
      st.parentElement.classList.toggle('show', player.stamina < SEEKER.stamina - 0.05);
      st.parentElement.classList.toggle('winded', player.winded); // (the bar shows it can't be used yet)
    }

    // minimap: ten times a second is plenty (every frame while a scan's ring is spreading out)
    this.mapT -= dt;
    this.scans = this.scans.filter((s) => t - s.at < SCAN_SHOW * 1000);
    if (this.mapT <= 0 || this.scans.some((s) => t - s.at < 700)) {
      this.mapT = 0.1;
      this.minimap.draw({ x: player.pos.x, z: player.pos.z, yaw: player.yaw }, this.pages.filter((p) => p.taken).map((p) => p.pos),
        devPages ? this.pages.filter((p) => !p.taken).map((p) => ({ x: p.pos.x, z: p.pos.z, n: p.n })) : [],
        this.scans.map((s) => ({ ...s, age: (t - s.at) / 1000 })),
        this.pages.filter((p) => p.zone && !p.taken).map((p) => p.zone));
    }

    // round timer in the top bar
    if (!this.over) {
      const secs = Math.floor((t - this.startedAt) / 1000);
      const txt = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      if (txt !== this.lastTime) { $('#tb-time').textContent = txt; this.lastTime = txt; }
    }

    // status line: stunned / revealed
    const el = $('#status');
    const sticky = this.role === 'hunter' && this.stunned ? `${this.shoved ? 'Staggered' : 'Stunned'}  ${((this.stunnedUntil - t) / 1000).toFixed(1)}`
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

  // the hunter near (and worse, in sight): static on screen and a heartbeat that speeds up
  updateDread(dt, rs) {
    const film = this.engine.film.uniforms;
    let target = 0, close = 0;
    if (rs && !this.over) {
      const d = Math.hypot(rs.x - this.player.pos.x, rs.z - this.player.pos.z);
      close = 1 - THREE.MathUtils.smoothstep(d, DREAD.near, DREAD.far);
      target = close * DREAD.static;
      // looking at him with nothing in between
      if (d < DREAD.seenDist) {
        const eye = this.engine.camera.position, chest = new THREE.Vector3(rs.x, rs.y + 1.8, rs.z);
        const facing = chest.clone().sub(eye).normalize().dot(this.player.forward);
        if (facing > Math.cos(THREE.MathUtils.degToRad(30)) && !this.world.colliders.blocked(eye, chest)) {
          target += DREAD.seen * (1 - d / DREAD.seenDist) * THREE.MathUtils.smoothstep(facing, 0.866, 0.97);
        }
      }
    }
    if (this.grab) { close = 1; target = Math.max(target, this.grab.kill ? 0.6 : 0.35); } // in his hands
    if (this.scare) { close = 1; target = 0.1; this.dread = Math.min(this.dread, 0.1); } // (his face has to show through: updateScare flickers its own)
    this.dread += (target - this.dread) * Math.min(1, dt * 4);
    audio.setDanger(Math.min(1, close * 1.1));
    // (the teleport's own burst of static fades out on top of this)
    film.uStatic.value = Math.max(film.uStatic.value, this.dread);

    this.beatT -= dt;
    if (close > 0.05 && this.beatT <= 0) {
      audio.play('heart', null, 0.25 + close * 0.75);
      this.beatT = THREE.MathUtils.lerp(DREAD.beatSlow, DREAD.beatFast, close);
    }
  }

  dispose() {
    this.off.forEach((f) => f());
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('mousedown', this.onMouse);
    removeEventListener('mouseup', this.onMouseUp);
    removeEventListener('contextmenu', this.onContext);
    for (const p of this.pages) {
      this.engine.scene.remove(p.mesh);
      p.mesh.material.map.dispose();
      p.mesh.material.dispose();
      p.glow?.children.forEach((o) => o.material.dispose());
    }
    this.engine.scene.remove(this.remote, this.marker);
    this.effects.clear();
    const film = this.engine.film.uniforms;
    film.uFlash.value = 0; film.uTint.value = 0; film.uStatic.value = 0;
    this.engine.hemi.intensity = this.saved.hemi;
    this.engine.moon.intensity = this.saved.moon;
    film.uSaturation.value = this.saved.sat;
    this.engine.camera.fov = settings.fov;
    this.engine.camera.updateProjectionMatrix();
    this.viewmodel.visible = false;
    this.player.enabled = false;
    this.player.frozen = false;
    this.setPrompt(null);
    $('#status').classList.remove('show');
    $('#escape').classList.remove('show');
    this.hunterArms?.update(0, this.engine.camera, 0, 0);
    this.player.lift = 0;
    audio.setDanger(0);
    hud(false);
  }
}
