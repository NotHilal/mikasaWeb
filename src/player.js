// First-person controller: mouse look (pointer lock), WASD, sprint with stamina,
// head bob, ground following and collision against the forest.
import * as THREE from 'three';
import { settings } from './settings.js';
import { pressed, mouseCode } from './keys.js';

const GRAVITY = 18; // m/s², a bit more than real: snappy, game-like jumps

export class Player {
  constructor(camera, world, dom) {
    this.camera = camera;
    this.world = world;
    this.dom = dom;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.enabled = false;
    this.bob = 0;
    this.eyeY = 0;
    this.onStep = null; // (speed) => {} footstep callback

    this.role = null;
    this.stats = null; // { eye, walk, sprint?, stamina? }
    this.stamina = 0;
    this.sprinting = false;
    this.winded = false;   // ran the stamina out: no sprinting until it's back to stats.recover
    this.frozen = false;   // stunned: can look around but not move
    this.dashT = 0;        // seconds of dash left
    this.dashVel = new THREE.Vector3();
    this.lift = 0;         // extra eye height (held up by the hunter)
    this.air = 0;          // jumping: height above the ground, and upward speed
    this.vy = 0;
    this.jumpHeld = false;

    // keys and mouse buttons held down, by code ('KeyW', 'Mouse0', …: see keys.js)
    addEventListener('keydown', (e) => { this.keys.add(e.code); });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('mousedown', (e) => { this.keys.add(mouseCode(e.button)); });
    addEventListener('mouseup', (e) => { this.keys.delete(mouseCode(e.button)); });
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      const s = 0.0022 * settings.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * s, -1.45, 1.45);
    });
  }

  spawn(pos, role, stats, lookAt) {
    this.pos.copy(pos);
    this.role = role;
    this.stats = stats;
    this.stamina = stats.stamina ?? 0;
    this.winded = false;
    this.vel.set(0, 0, 0);
    this.frozen = false;
    this.dashT = 0;
    this.lift = 0;
    this.air = 0;
    this.vy = 0;
    this.yaw = lookAt ? Math.atan2(-(lookAt.x - pos.x), -(lookAt.z - pos.z)) : 0;
    this.pitch = 0;
    this.eyeY = this.world.heightAt(pos.x, pos.z) + stats.eye;
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  // the direction the player is trying to move in (world space, flat), or forward if none
  moveDir() {
    const k = this.keys;
    const x = (pressed(k, 'right') ? 1 : 0) - (pressed(k, 'left') ? 1 : 0), y = (pressed(k, 'forward') ? 1 : 0) - (pressed(k, 'back') ? 1 : 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const d = x || y ? new THREE.Vector3(x * cos - y * sin, 0, -x * sin - y * cos) : new THREE.Vector3(-sin, 0, -cos);
    return d.normalize();
  }

  dash(distance, time) {
    this.dashVel.copy(this.moveDir()).multiplyScalar(distance / time);
    this.dashT = time;
  }

  update(dt) {
    const k = this.keys;
    const input = new THREE.Vector2(
      (pressed(k, 'right') ? 1 : 0) - (pressed(k, 'left') ? 1 : 0),
      (pressed(k, 'forward') ? 1 : 0) - (pressed(k, 'back') ? 1 : 0),
    );
    // no walking from the pause screen (keys still reach the page without pointer lock)
    const canMove = this.enabled && !this.frozen && document.pointerLockElement === this.dom;
    if (!canMove) input.set(0, 0);

    // jump: once per press, from the ground
    const jumpKey = pressed(k, 'jump');
    if (jumpKey && !this.jumpHeld && canMove && this.air === 0 && this.stats.jump) this.vy = this.stats.jump;
    this.jumpHeld = jumpKey;
    if (input.lengthSq() > 1) input.normalize();

    const st = this.stats;
    const wantSprint = pressed(k, 'sprint') && input.y > 0 && st.sprint;
    // out of breath: once the bar is empty, it has to refill to `recover` before sprinting again
    // (otherwise every sliver of regained stamina was spent at once, and the sprint never stopped)
    if (this.winded && this.stamina >= (st.recover ?? 0) * (st.stamina ?? 0)) this.winded = false;
    if (wantSprint && this.stamina > 0 && !this.winded) {
      this.sprinting = true;
      this.stamina = Math.max(0, this.stamina - dt);
      if (this.stamina === 0) this.winded = true;
    } else {
      this.sprinting = false;
      if (st.stamina) this.stamina = Math.min(st.stamina, this.stamina + dt * st.staminaRegen * (input.lengthSq() ? 0.6 : 1));
    }
    const speed = this.sprinting ? st.sprint : st.walk * (input.y < 0 ? 0.75 : 1);

    // world-space wish direction from yaw only
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = new THREE.Vector3(input.x * cos - input.y * sin, 0, -input.x * sin - input.y * cos).multiplyScalar(speed);
    // snappy, Valorant-like acceleration: you reach full speed (and stop) almost at once
    this.vel.lerp(wish, 1 - Math.exp(-dt * (wish.lengthSq() ? 18 : 22)));
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.copy(this.dashVel);
      if (this.dashT <= 0) this.vel.multiplyScalar(0.4); // carry a little momentum out of it
    }

    // move in small steps so a fast dash can't skip through a thin trunk
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vel.x, this.vel.z) * dt) / 0.25));
    for (let i = 0; i < steps; i++) {
      this.pos.x += (this.vel.x * dt) / steps;
      this.pos.z += (this.vel.z * dt) / steps;
      this.world.colliders.resolve(this.pos, 0.35, this.air > 0 ? this.pos.y : -Infinity);
    }
    const ground = this.world.heightAt(this.pos.x, this.pos.z);
    if (this.vy || this.air > 0) {
      this.vy -= GRAVITY * dt;
      this.air += this.vy * dt;
      if (this.air <= 0) { this.air = 0; this.vy = 0; this.onStep?.(4.5); } // landed: a heavier step
    }
    this.pos.y = ground + this.air;

    // head bob + footsteps
    const moving = Math.hypot(this.vel.x, this.vel.z);
    const prev = this.bob;
    this.bob += dt * moving * (this.sprinting ? 2.1 : 2.3);
    if (Math.floor(prev / Math.PI) !== Math.floor(this.bob / Math.PI) && moving > 0.5 && this.air === 0) this.onStep?.(moving);
    // a very light bob only (Valorant keeps the camera steady)
    const amp = Math.min(1, moving / 3) * (this.sprinting ? 0.014 : 0.007);

    // smooth the eye height over bumps
    this.eyeY += (ground + st.eye + this.lift - this.eyeY) * (1 - Math.exp(-dt * 12));
    this.camera.position.set(
      this.pos.x + Math.cos(this.yaw) * Math.sin(this.bob) * amp * 0.5,
      this.eyeY + this.air + Math.abs(Math.cos(this.bob)) * amp - amp * 0.5,
      this.pos.z - Math.sin(this.yaw) * Math.sin(this.bob) * amp * 0.5,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
