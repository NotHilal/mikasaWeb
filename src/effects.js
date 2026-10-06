// Ability effects in the world, the same on both screens, styled after their Valorant
// counterparts: Sova's recon bolt (blue arrow, sonar scan), Phoenix's curveball (a fireball
// that bends and pops), Jett's tailwind (a gust of wind), Fade's haunt (a dark inky eye)
// and an Omen-like shadow step (purple-black smoke). Plus muzzle flashes and tracers.
// Each effect is simulated on both clients from the same launch message; only the owner
// passes the callbacks that decide gameplay (reveals, blinding).
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();

function canvasTexture(draw, s = 64) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  draw(cv.getContext('2d'), s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTexture = () => canvasTexture((g, s) => {
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
});
// a lumpy smoke puff
const smokeTexture = () => canvasTexture((g, s) => {
  for (let i = 0; i < 14; i++) {
    const x = s / 2 + (Math.random() - 0.5) * s * 0.4, y = s / 2 + (Math.random() - 0.5) * s * 0.4, r = s * (0.15 + Math.random() * 0.2);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }
}, 128);

// --- particles: two pooled point clouds (glowing/additive and smoky/normal) ---------
class Particles {
  constructor(scene, texture, additive, max, getScale) {
    this.max = max;
    this.list = [];
    this.getScale = getScale;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: texture }, uScale: { value: 400 } },
      vertexShader: /* glsl */`
        attribute float alpha; attribute float size; attribute vec3 color;
        uniform float uScale; varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  // p: { pos, vel, life, size, size1, color, color1, alpha, drag, gravity, swirl }
  emit(p) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      pos: p.pos.clone(), vel: p.vel ? p.vel.clone() : new THREE.Vector3(), age: 0, life: p.life ?? 0.5,
      size: p.size ?? 0.2, size1: p.size1 ?? p.size ?? 0.2, color: new THREE.Color(p.color ?? 0xffffff),
      color1: new THREE.Color(p.color1 ?? p.color ?? 0xffffff), alpha: p.alpha ?? 1, drag: p.drag ?? 0, gravity: p.gravity ?? 0,
      swirl: p.swirl ?? null,
    });
  }

  update(dt, camera) {
    this.mat.uniforms.uScale.value = (innerHeight * this.getScale()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const c = new THREE.Color();
    this.list = this.list.filter((p) => (p.age += dt) < p.life);
    this.list.forEach((p, i) => {
      const k = p.age / p.life;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.vel.y -= p.gravity * dt;
      if (p.swirl) { // spin around a vertical axis (wind)
        tmp.subVectors(p.pos, p.swirl.center).setY(0);
        p.pos.add(tmp.set(-tmp.z, 0, tmp.x).multiplyScalar(p.swirl.rate * dt));
      }
      p.pos.addScaledVector(p.vel, dt);
      this.pos.set([p.pos.x, p.pos.y, p.pos.z], i * 3);
      c.copy(p.color).lerp(p.color1, k);
      this.col.set([c.r, c.g, c.b], i * 3);
      this.alpha[i] = p.alpha * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      this.size[i] = p.size + (p.size1 - p.size) * k;
    });
    this.geo.setDrawRange(0, this.list.length);
    for (const a of ['position', 'color', 'alpha', 'size']) this.geo.attributes[a].needsUpdate = true;
  }

  clear() { this.list = []; this.geo.setDrawRange(0, 0); }
}

const rand = (a) => (Math.random() - 0.5) * 2 * a;
const randDir = () => new THREE.Vector3().randomDirection();

export class Effects {
  constructor(scene, world, getScale = () => 1) {
    this.scene = scene;
    this.world = world;
    this.items = [];
    this.glow = glowTexture();
    this.fx = new Particles(scene, this.glow, true, 900, getScale);        // glowing bits
    this.smoke = new Particles(scene, smokeTexture(), false, 500, getScale); // smoke and ink
    // A fixed pool of point lights, always in the scene (intensity 0 when unused): adding
    // or removing lights at runtime would make every material recompile and stutter.
    this.lights = [0, 1, 2].map(() => {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      scene.add(l);
      return { light: l, t: 0, dur: 1, peak: 0 };
    });
    this.pulseGeo = new THREE.SphereGeometry(1, 32, 16);
    this.ringGeo = new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);
  }

  // borrow a light for a short burst
  burst(pos, color, intensity, distance, dur) {
    const done = (s) => (s.peak ? s.t / s.dur : 2); // free slots first, then the most finished one
    const slot = this.lights.reduce((a, b) => (done(a) >= done(b) ? a : b));
    slot.light.color.set(color);
    slot.light.distance = distance;
    slot.light.position.copy(pos);
    Object.assign(slot, { t: 0, dur, peak: intensity });
    slot.light.intensity = intensity;
    return slot;
  }

  sprite(color, size, opacity = 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
    s.scale.setScalar(size);
    return s;
  }

  add(obj, item) {
    if (obj) this.scene.add(obj);
    this.items.push({ obj, age: 0, ...item });
  }

  // move a projectile one step; returns 'ground' | 'tree' | null and leaves p.pos at the impact
  step(p, dt, gravity) {
    const prev = p.pos.clone();
    p.vel.y -= gravity * dt;
    p.pos.addScaledVector(p.vel, dt);
    const t = this.world.colliders.hit(prev, p.pos);
    if (t !== null) { p.pos.lerpVectors(prev, p.pos, Math.max(0, t - 0.02)); return 'tree'; }
    const g = this.world.heightAt(p.pos.x, p.pos.z);
    if (p.pos.y < g + 0.05) { p.pos.y = g + 0.05; return 'ground'; }
    return null;
  }

  // --- Sova: recon bolt ----------------------------------------------------------
  // A blue-glowing arrow that arcs, sticks, then sends sonar pulses.
  dart(origin, vel, { gravity, pulses, gap, radius, onPulse }) {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x6a7488, metalness: 0.8, roughness: 0.3 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x58c8ff).multiplyScalar(2.5) });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6), metal);
    shaft.rotation.x = Math.PI / 2;
    g.add(shaft);
    // three-bladed head with a glowing core, and fletching at the back
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 3), metal);
      blade.rotation.x = -Math.PI / 2;
      blade.position.set(Math.cos((i / 3) * Math.PI * 2) * 0.018, Math.sin((i / 3) * Math.PI * 2) * 0.018, -0.33);
      g.add(blade);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.1), glow);
      fin.position.z = 0.27;
      fin.rotation.z = (i / 3) * Math.PI * 2;
      fin.translateY(0.03);
      g.add(fin);
    }
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), glow);
    core.position.z = -0.28;
    g.add(core);
    const halo = this.sprite(0x58c8ff, 0.55);
    halo.position.z = -0.28;
    g.add(halo);
    g.position.copy(origin);
    const p = { pos: origin.clone(), vel: vel.clone() };
    this.add(g, {
      p, stuck: false, pulse: 0, next: 0.35,
      tick(dt, it) {
        if (!it.stuck) {
          const hit = this.step(p, dt, gravity);
          g.position.copy(p.pos);
          g.lookAt(p.pos.clone().sub(p.vel)); // point the tip along the flight
          // trail of blue light
          for (let i = 0; i < 3; i++) this.fx.emit({ pos: p.pos, vel: randDir().multiplyScalar(0.3), life: 0.35, size: 0.12, size1: 0.02, color: 0x8fe0ff, color1: 0x2050ff, alpha: 0.9 });
          if (hit || it.age > 4) { it.stuck = true; this.burst(p.pos, 0x58c8ff, 6, 5, 0.4); }
          return;
        }
        it.next -= dt;
        halo.material.opacity = 0.6 + 0.4 * Math.sin(it.age * 14);
        if (it.next <= 0 && it.pulse < pulses) {
          it.pulse++;
          it.next = it.pulse >= pulses ? 0.4 : gap; // after the last scan it only stays a moment
          this.pulse(p.pos, 0x58c8ff, radius, 1.0);
          this.groundRing(p.pos, 0x58c8ff, radius, 1.0);
          this.burst(p.pos, 0x58c8ff, 12, 10, 0.5);
          for (let i = 0; i < 24; i++) this.fx.emit({ pos: p.pos, vel: randDir().setY(Math.random() * 2).multiplyScalar(2.5), life: 0.6, size: 0.08, size1: 0, color: 0xbff0ff, color1: 0x3a7dff, drag: 2 });
          onPulse?.(p.pos.clone());
        }
        if (it.pulse >= pulses) {
          g.scale.setScalar(Math.max(0, it.next / 0.4)); // shrink away once the reveal is done
          if (it.next <= 0) return 'done';
        }
      },
    });
    return p;
  }

  // --- Phoenix: curveball ------------------------------------------------------------
  // A fireball that bends sideways as it flies, then pops in a white-hot flash.
  // near: optional { at() → Vector3 | null, dist }: pop early when passing that close to it
  flash(origin, vel, { gravity, fuse, curve = 1.6, near, onPop }) {
    const orb = new THREE.Group();
    const core = this.sprite(0xfff0c0, 0.35);
    const flame = this.sprite(0xff7a20, 0.9, 0.85);
    orb.add(flame, core);
    orb.position.copy(origin);
    const p = { pos: origin.clone(), vel: vel.clone() };
    // bend to the thrower's right: turn the velocity around the vertical axis
    const turn = -curve;
    this.add(orb, {
      tick(dt, it) {
        if (!it.stopped) {
          p.vel.applyAxisAngle(UP, turn * dt * (1 - it.age / fuse));
          if (this.step(p, dt, gravity)) { it.stopped = true; p.vel.set(0, 0, 0); }
        }
        orb.position.copy(p.pos);
        const flick = 0.85 + Math.random() * 0.3;
        flame.scale.setScalar(0.9 * flick);
        for (let i = 0; i < 3; i++) this.fx.emit({ pos: p.pos.clone().add(randDir().multiplyScalar(0.06)), vel: randDir().multiplyScalar(0.4).add(new THREE.Vector3(0, 0.8, 0)), life: 0.35, size: 0.28, size1: 0.04, color: 0xffd060, color1: 0xff2a00, alpha: 0.9 });
        const target = near?.at();
        if (it.age >= fuse || (target && it.age > 0.08 && p.pos.distanceTo(target) < near.dist)) {
          this.burst(p.pos, 0xfff1d8, 260, 35, 0.4);
          const pop = this.sprite(0xffffff, 7);
          pop.position.copy(p.pos);
          this.add(pop, { tick(d, me) { pop.material.opacity = Math.max(0, 1 - me.age / 0.3); pop.scale.setScalar(7 + me.age * 12); if (me.age > 0.3) return 'done'; } });
          for (let i = 0; i < 40; i++) this.fx.emit({ pos: p.pos, vel: randDir().multiplyScalar(6 + Math.random() * 4), life: 0.45, size: 0.12, size1: 0, color: 0xffffff, color1: 0xff8a20, drag: 4 });
          onPop?.(p.pos.clone());
          return 'done';
        }
      },
    });
  }

  // --- Jett: tailwind ---------------------------------------------------------------
  // A swirl of wind left where the dash started.
  wind(pos, dir) {
    const center = pos.clone().add(new THREE.Vector3(0, 0.1, 0));
    for (let i = 0; i < 46; i++) {
      const ang = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.7;
      const p = center.clone().add(new THREE.Vector3(Math.cos(ang) * r, Math.random() * 1.8, Math.sin(ang) * r));
      this.smoke.emit({
        pos: p, vel: new THREE.Vector3(Math.cos(ang) * 0.8, 0.7 + Math.random(), Math.sin(ang) * 0.8).addScaledVector(dir, -1.5),
        life: 0.9, size: 0.35, size1: 1.0, color: 0xe8fbff, color1: 0xb8e0ff, alpha: 0.45, drag: 1.5,
        swirl: { center, rate: 5 },
      });
    }
    for (let i = 0; i < 20; i++) this.fx.emit({ pos: center.clone().add(new THREE.Vector3(rand(0.6), Math.random() * 1.6, rand(0.6))), vel: dir.clone().multiplyScalar(-4).add(randDir()), life: 0.4, size: 0.06, size1: 0, color: 0xffffff, color1: 0x9fe8ff, drag: 2 });
    this.groundRing(center, 0xcff4ff, 2.2, 0.5);
  }

  // --- Fade: haunt --------------------------------------------------------------------
  // A dark, inky eye with tendrils: flies straight, stops, opens and scans once, then fades.
  eye(origin, dir, { speed, flight, delay, radius, onScan }) {
    const g = new THREE.Group();
    const ink = new THREE.MeshStandardMaterial({ color: 0x07060c, roughness: 0.25, metalness: 0.3 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), ink);
    g.add(ball);
    // lids that open when it scans
    const lidTop = new THREE.Mesh(new THREE.SphereGeometry(0.175, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), ink);
    const lidBottom = lidTop.clone();
    lidBottom.rotation.x = Math.PI;
    g.add(lidTop, lidBottom);
    const irisMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2e6a).multiplyScalar(2.2) });
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 10), irisMat);
    iris.position.z = -0.14;
    iris.scale.set(1, 1.4, 0.4);
    g.add(iris);
    // tendrils trailing behind
    const tendrils = [];
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.45, 5), ink);
      t.geometry.translate(0, -0.22, 0);
      const holder = new THREE.Group();
      holder.rotation.set(Math.PI / 2 + rand(0.6), 0, (i / 6) * Math.PI * 2);
      holder.add(t);
      holder.position.z = 0.08;
      g.add(holder);
      tendrils.push(holder);
    }
    g.position.copy(origin);
    const p = { pos: origin.clone(), vel: dir.clone().normalize().multiplyScalar(speed) };
    let flying = true, scanned = false, stopNow = false;
    // returned to the caller: is it still flying, and stop it early (optionally at a given spot,
    // so the other screen's copy stops exactly where the thrower's did)
    const handle = {
      get flying() { return flying; },
      get pos() { return p.pos; },
      stop(at) { if (!flying) return; if (at) p.pos.copy(at); stopNow = true; },
    };
    this.add(g, {
      tick(dt, it) {
        tendrils.forEach((h, i) => { h.rotation.y = Math.sin(it.age * 6 + i) * 0.35; });
        if (Math.random() < 0.6) this.smoke.emit({ pos: p.pos.clone().add(randDir().multiplyScalar(0.12)), vel: randDir().multiplyScalar(0.2).add(p.vel.clone().multiplyScalar(-0.05)), life: 1.1, size: 0.25, size1: 0.8, color: 0x140a1e, color1: 0x0a0610, alpha: 0.7, drag: 1 });
        if (flying) {
          if (stopNow || this.step(p, dt, 0) || it.age > flight) { flying = false; it.stopAt = it.age; }
          g.position.copy(p.pos);
          g.lookAt(p.pos.clone().add(p.vel));
          g.rotateY(Math.PI);
          lidTop.rotation.x = 0; lidBottom.rotation.x = Math.PI;
          return;
        }
        const since = it.age - it.stopAt;
        g.position.y = p.pos.y + Math.sin(it.age * 3) * 0.05;
        // open the lids just before the scan
        const open = THREE.MathUtils.clamp((since - delay + 0.3) / 0.3, 0, 1);
        lidTop.rotation.x = -open * 0.9;
        lidBottom.rotation.x = Math.PI + open * 0.9;
        if (!scanned && since > delay) {
          scanned = true;
          this.burst(p.pos, 0xff2e6a, 20, 12, 1.0);
          this.pulse(p.pos, 0xd0306a, radius, 1.1);
          this.groundRing(p.pos, 0xd0306a, radius, 1.1);
          for (let i = 0; i < 30; i++) this.smoke.emit({ pos: p.pos, vel: randDir().multiplyScalar(3), life: 1.0, size: 0.4, size1: 1.2, color: 0x1a0a22, color1: 0x05030a, alpha: 0.75, drag: 3 });
          onScan?.(p.pos.clone());
        }
        if (since > delay + 0.35) { // gone once its reveal is done
          const fade = Math.max(0, 1 - (since - delay - 0.35) / 0.35);
          g.scale.setScalar(fade);
          if (fade <= 0) return 'done';
        }
      },
    });
    return handle;
  }

  // --- Omen-style shadow step ---------------------------------------------------------
  puff(pos) {
    for (let i = 0; i < 50; i++) {
      this.smoke.emit({ pos: pos.clone().add(new THREE.Vector3(rand(0.5), Math.random() * 2.6, rand(0.5))), vel: new THREE.Vector3(rand(1.2), Math.random() * 1.2, rand(1.2)), life: 1.4, size: 0.6, size1: 1.6, color: 0x2a1240, color1: 0x0a0514, alpha: 0.8, drag: 1.2 });
    }
    for (let i = 0; i < 30; i++) {
      this.fx.emit({ pos: pos.clone().add(new THREE.Vector3(rand(0.4), Math.random() * 2.4, rand(0.4))), vel: new THREE.Vector3(rand(0.6), 0.6 + Math.random() * 1.5, rand(0.6)), life: 1.0, size: 0.07, size1: 0, color: 0xc070ff, color1: 0x5a20c0 });
    }
    this.groundRing(pos, 0x9b3dff, 1.6, 0.6);
    this.burst(pos.clone().addScaledVector(UP, 1.2), 0x8a3dff, 20, 8, 0.4);
  }

  // the teleport's wind-up: dark smoke spiralling in and rising, a ring closing in
  tpWindup(pos, dur) {
    const center = pos.clone();
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9b3dff).multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.set(pos.x, this.world.heightAt(pos.x, pos.z) + 0.08, pos.z);
    this.add(ring, {
      tick(dt, it) {
        const k = it.age / dur;
        ring.scale.setScalar(2.2 * (1 - k) + 0.3);
        ring.material.opacity = 0.4 + 0.5 * k;
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2, r = 1.6 * (1 - k * 0.6);
          this.smoke.emit({ pos: center.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.random() * 0.4, Math.sin(a) * r)), vel: new THREE.Vector3(-Math.cos(a) * 1.4, 1.2 + Math.random() * 1.5, -Math.sin(a) * 1.4), life: 0.9, size: 0.45, size1: 1.1, color: 0x2a1240, color1: 0x0a0514, alpha: 0.75, drag: 1, swirl: { center, rate: 3 } });
        }
        if (Math.random() < 0.6) this.fx.emit({ pos: center.clone().add(new THREE.Vector3(rand(0.5), Math.random() * 2, rand(0.5))), vel: new THREE.Vector3(0, 1.5, 0), life: 0.6, size: 0.06, size1: 0, color: 0xc070ff, color1: 0x5a20c0 });
        if (k >= 1) return 'done';
      },
    });
  }

  // --- shared pieces --------------------------------------------------------------------

  // an expanding scan wave: a sphere that only glows at its edge (like a shockwave)
  pulse(pos, color, radius, dur) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
          float lines = 0.5 + 0.5 * step(0.5, fract(vP.y * 10.0)); // scan lines, like Sova's sonar
          gl_FragColor = vec4(uColor * 1.8, rim * lines * uOpacity);
        }`,
    });
    const m = new THREE.Mesh(this.pulseGeo, mat);
    m.position.copy(pos);
    this.add(m, {
      tick(dt, it) {
        const k = it.age / dur;
        m.scale.setScalar(0.3 + radius * k);
        mat.uniforms.uOpacity.value = (1 - k) * (1 - k);
        if (k >= 1) return 'done';
      },
    });
  }

  // a flat ring racing outwards over the ground
  groundRing(pos, color, radius, dur) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(pos.x, this.world.heightAt(pos.x, pos.z) + 0.08, pos.z);
    this.add(m, {
      tick(dt, it) {
        const k = it.age / dur;
        m.scale.setScalar(0.2 + radius * k);
        m.material.opacity = (1 - k) * 0.9;
        if (k >= 1) return 'done';
      },
    });
  }

  muzzle(pos) {
    this.burst(pos, 0xffb060, 40, 14, 0.06);
    for (let i = 0; i < 6; i++) this.fx.emit({ pos, vel: randDir().multiplyScalar(2), life: 0.12, size: 0.05, size1: 0, color: 0xffe0a0, color1: 0xff6020 });
  }

  tracer(a, b) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.add(line, { tick(dt, it) { line.material.opacity = 0.8 * (1 - it.age / 0.08); if (it.age > 0.08) return 'done'; } });
  }

  update(dt, camera) {
    for (const s of this.lights) {
      if (!s.peak) continue;
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      s.light.intensity = s.peak * (1 - k) * (1 - k);
      if (k >= 1) { s.peak = 0; s.light.intensity = 0; }
    }
    // effects can start other effects while ticking (a flash's pop, a dart's scan wave); those
    // land in the fresh list, so they're kept instead of lost (and left on screen forever)
    const ticking = this.items;
    this.items = [];
    const alive = ticking.filter((it) => {
      it.age += dt;
      if (it.tick?.call(this, dt, it) !== 'done') return true;
      this.remove(it);
      return false;
    });
    this.items = alive.concat(this.items);
    if (camera) { this.fx.update(dt, camera); this.smoke.update(dt, camera); }
  }

  remove(it) {
    if (!it.obj) return;
    this.scene.remove(it.obj);
    it.obj.traverse((o) => {
      if (o.geometry && o.geometry !== this.pulseGeo && o.geometry !== this.ringGeo) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  clear() {
    this.items.forEach((it) => this.remove(it));
    this.items = [];
    this.fx.clear();
    this.smoke.clear();
    for (const s of this.lights) { s.peak = 0; s.light.intensity = 0; }
  }
}
