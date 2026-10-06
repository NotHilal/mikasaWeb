// One round: places the pages, spawns both players, syncs positions, handles page
// pickups, catching, and the end of the round.
import * as THREE from 'three';
import { net } from './net.js';
import { hunterFigure, seekerFigure } from './figures.js';
import { audio } from './audio.js';
import { $, flash, hud } from './ui.js';
import { SEEKER, HUNTER, PAGES, MESSAGE, NET_HZ } from './config.js';

const INTERP_MS = 110; // the other player is drawn this far in the past, to smooth over network jitter

export class Match {
  constructor({ engine, world, player, flashlight }, { seed, role }, onEnd) {
    Object.assign(this, { engine, world, player, flashlight, role, onEnd });
    this.over = false;
    this.found = 0;
    this.snaps = [];
    this.sendTimer = 0;
    this.off = [];

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
    engine.scene.add(this.remote);
    this.remoteFl = true;

    // the hunter sees in the dark (dimly); the seeker relies on the flashlight
    this.saved = { hemi: engine.hemi.intensity, sat: engine.film.uniforms.uSaturation.value };
    if (role === 'hunter') {
      engine.hemi.intensity = 2.2;
      engine.film.uniforms.uSaturation.value = 0.25;
    }
    flashlight.on = role === 'seeker';

    // network
    this.off.push(
      net.on('s', (d) => {
        this.snaps.push({ t: performance.now(), ...d });
        if (this.snaps.length > 30) this.snaps.shift();
      }),
      net.on('page', ({ n }) => this.takePage(n, false)),
      net.on('caught', () => this.finish('caught', false)),
    );

    // input
    this.onKey = (e) => {
      if (!this.player.enabled || this.over) return;
      if (e.code === 'KeyF' && role === 'seeker') { flashlight.on = !flashlight.on; audio.click(); }
      if (e.code === 'KeyE') this.tryTake();
    };
    this.onClick = (e) => { if (e.button === 0 && document.pointerLockElement) this.tryTake(); };
    addEventListener('keydown', this.onKey);
    addEventListener('mousedown', this.onClick);

    // HUD
    $('#role-tag').textContent = role === 'seeker' ? 'Seeker' : 'Hunter';
    $('#pages').classList.remove('show');
    $('#page-text').classList.remove('show');
    $('#stamina-fill').parentElement.classList.toggle('show', false);
    hud(true);
    this.showCount();
  }

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
    net.send('page', { n: p.n });
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
    const el = $('#pages');
    el.textContent = `${this.found} / ${PAGES} pages`;
    if (this.found > 0 || this.role === 'hunter') flash(el, 3500);
  }

  finish(result, mine) {
    if (this.over) return;
    this.over = true;
    if (result === 'caught' && mine) net.send('caught', {});
    this.player.enabled = false;
    this.onEnd(result);
  }

  // where the other player is now (interpolated), or null before the first update
  remoteState() {
    const s = this.snaps;
    if (!s.length) return null;
    const t = performance.now() - INTERP_MS;
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

  update(dt, time) {
    const { player, engine, flashlight } = this;
    player.update(dt);

    // send my position
    this.sendTimer -= dt;
    if (this.sendTimer <= 0 && !this.over) {
      this.sendTimer = 1 / NET_HZ;
      const r = (v) => Math.round(v * 100) / 100;
      net.send('s', { x: r(player.pos.x), y: r(player.pos.y), z: r(player.pos.z), yaw: r(player.yaw), pitch: r(player.pitch), fl: flashlight.on ? 1 : 0 });
    }

    // the other player
    const rs = this.remoteState();
    if (rs) {
      this.remote.visible = true;
      this.remote.position.set(rs.x, rs.y, rs.z);
      this.remote.rotation.y = rs.yaw;
      if (this.role === 'hunter') {
        // the seeker's torch lights my world too
        flashlight.on = !!rs.fl;
        this.remote.userData.lens.visible = !!rs.fl;
        this.remote.updateMatrixWorld();
        const from = this.remote.localToWorld(this.remote.userData.torchOffset.clone());
        const dir = new THREE.Vector3(-Math.sin(rs.yaw) * Math.cos(rs.pitch), Math.sin(rs.pitch), -Math.cos(rs.yaw) * Math.cos(rs.pitch));
        flashlight.update(dt, from, dir, time, false);
        // glare when the torch points at me
        const toMe = engine.camera.position.clone().sub(from).normalize();
        const facing = Math.max(0, dir.dot(toMe));
        this.remote.userData.glare.material.opacity = rs.fl ? Math.pow(facing, 6) : 0;
        // caught?
        if (!this.over && Math.hypot(rs.x - player.pos.x, rs.z - player.pos.z) < HUNTER.catchDist) this.finish('caught', true);
      }
    }
    if (this.role === 'seeker') {
      // torch held slightly right of and below the eye
      const cam = engine.camera;
      const from = new THREE.Vector3(0.18, -0.2, 0).applyQuaternion(cam.quaternion).add(cam.position);
      flashlight.update(dt, from, player.forward, time);
      $('#prompt').classList.toggle('show', !!this.lookedAtPage() && !this.over);
      const st = $('#stamina-fill');
      st.style.width = `${(player.stamina / SEEKER.stamina) * 100}%`;
      st.parentElement.classList.toggle('show', player.stamina < SEEKER.stamina - 0.05);
    }
  }

  dispose() {
    this.off.forEach((f) => f());
    removeEventListener('keydown', this.onKey);
    removeEventListener('mousedown', this.onClick);
    for (const p of this.pages) {
      this.engine.scene.remove(p.mesh);
      p.mesh.material.map.dispose();
      p.mesh.material.dispose();
    }
    this.engine.scene.remove(this.remote);
    this.engine.hemi.intensity = this.saved.hemi;
    this.engine.film.uniforms.uSaturation.value = this.saved.sat;
    this.player.enabled = false;
    $('#prompt').classList.remove('show');
    hud(false);
  }
}
