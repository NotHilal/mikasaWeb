// First-person controller: mouse look (pointer lock), WASD, sprint with stamina,
// head bob, ground following and collision against the forest.
import * as THREE from 'three';
import { settings } from './settings.js';

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

    addEventListener('keydown', (e) => { this.keys.add(e.code); });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
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
    this.vel.set(0, 0, 0);
    this.yaw = lookAt ? Math.atan2(-(lookAt.x - pos.x), -(lookAt.z - pos.z)) : 0;
    this.pitch = 0;
    this.eyeY = this.world.heightAt(pos.x, pos.z) + stats.eye;
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  update(dt) {
    const k = this.keys;
    const input = new THREE.Vector2(
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
    );
    if (!this.enabled) input.set(0, 0);
    if (input.lengthSq() > 1) input.normalize();

    const st = this.stats;
    const wantSprint = k.has('ShiftLeft') && input.y > 0 && st.sprint;
    if (wantSprint && this.stamina > 0) {
      this.sprinting = true;
      this.stamina = Math.max(0, this.stamina - dt);
    } else {
      this.sprinting = false;
      if (st.stamina) this.stamina = Math.min(st.stamina, this.stamina + dt * st.staminaRegen * (input.lengthSq() ? 0.6 : 1));
    }
    const speed = this.sprinting ? st.sprint : st.walk * (input.y < 0 ? 0.75 : 1);

    // world-space wish direction from yaw only
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = new THREE.Vector3(input.x * cos - input.y * sin, 0, -input.x * sin - input.y * cos).multiplyScalar(speed);
    // smooth acceleration so movement has some weight
    this.vel.lerp(wish, 1 - Math.exp(-dt * (wish.lengthSq() ? 9 : 12)));

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.world.colliders.resolve(this.pos, 0.35);
    const ground = this.world.heightAt(this.pos.x, this.pos.z);
    this.pos.y = ground;

    // head bob + footsteps
    const moving = Math.hypot(this.vel.x, this.vel.z);
    const prev = this.bob;
    this.bob += dt * moving * (this.sprinting ? 2.1 : 2.3);
    if (Math.floor(prev / Math.PI) !== Math.floor(this.bob / Math.PI) && moving > 0.5) this.onStep?.(moving);
    const amp = Math.min(1, moving / 3) * (this.sprinting ? 0.06 : 0.035);

    // smooth the eye height over bumps
    this.eyeY += (ground + st.eye - this.eyeY) * (1 - Math.exp(-dt * 12));
    this.camera.position.set(
      this.pos.x + Math.cos(this.yaw) * Math.sin(this.bob) * amp * 0.5,
      this.eyeY + Math.abs(Math.cos(this.bob)) * amp - amp * 0.5,
      this.pos.z - Math.sin(this.yaw) * Math.sin(this.bob) * amp * 0.5,
    );
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bob) * amp * 0.08, 'YXZ');
  }
}
