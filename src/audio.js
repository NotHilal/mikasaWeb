// Synthesized sound (no audio files): the night-forest ambience, footsteps on leaves, the page
// pickup, and the gun and ability sounds.
import { settings } from './settings.js';

let ctx = null, master = null, noiseBuf = null;

function noise(seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    // brown-ish noise: softer and deeper than white noise
    last = (last + (Math.random() * 2 - 1) * 0.04) * 0.995;
    d[i] = last * 6 + (Math.random() * 2 - 1) * 0.15;
  }
  return b;
}

// An output for one sound: distance fades it and muffles it, pan places it left/right.
// at = { dist, pan } (metres, -1..1); leave it out for sounds that are "in your head".
function out(at, vol = 1, dest = master) {
  const g = ctx.createGain();
  g.gain.value = vol * (at ? 1 / (1 + at.dist / 8) : 1);
  if (at) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(600, 16000 / (1 + at.dist / 6));
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, at.pan));
    g.connect(lp).connect(p).connect(dest);
  } else g.connect(dest);
  return g;
}

function noiseHit(dest, t, { type = 'bandpass', freq = 1000, q = 1, attack = 0.005, decay = 0.2, vol = 1, sweepTo = null }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.2, attack + decay + 0.05);
}

function tone(dest, t, { type = 'sine', from = 440, to = null, attack = 0.005, decay = 0.3, vol = 0.3 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + attack + decay + 0.05);
}

// named one-shot sounds used by the abilities
const SOUNDS = {
  shot(d, t) {
    noiseHit(d, t, { type: 'lowpass', freq: 5000, decay: 0.28, vol: 1.6, sweepTo: 400 });
    tone(d, t, { from: 150, to: 45, decay: 0.18, vol: 0.9 });
    noiseHit(d, t + 0.05, { type: 'lowpass', freq: 900, decay: 0.7, vol: 0.25 }); // echo through the trees
  },
  dry(d, t) { tone(d, t, { type: 'square', from: 2400, decay: 0.02, vol: 0.06 }); tone(d, t + 0.05, { type: 'square', from: 1700, decay: 0.02, vol: 0.05 }); },
  dash(d, t) { noiseHit(d, t, { freq: 500, q: 1.5, attack: 0.03, decay: 0.3, vol: 0.9, sweepTo: 3000 }); },
  throw(d, t) { noiseHit(d, t, { freq: 1200, q: 2, attack: 0.02, decay: 0.15, vol: 0.4, sweepTo: 500 }); },
  pop(d, t) {
    noiseHit(d, t, { type: 'highpass', freq: 3000, decay: 0.25, vol: 1.2 });
    tone(d, t, { from: 3200, to: 1800, decay: 0.6, vol: 0.15 });
  },
  dartFire(d, t) {
    tone(d, t, { type: 'triangle', from: 900, to: 300, decay: 0.15, vol: 0.4 });
    noiseHit(d, t, { freq: 2500, q: 3, decay: 0.12, vol: 0.3 });
  },
  scan(d, t) {
    for (let i = 0; i < 3; i++) tone(d, t + i * 0.18, { from: 1250, decay: 0.9 - i * 0.2, vol: 0.22 / (i + 1) });
  },
  eye(d, t) {
    noiseHit(d, t, { freq: 400, q: 4, attack: 0.05, decay: 0.5, vol: 0.5, sweepTo: 150 });
    tone(d, t, { type: 'sawtooth', from: 70, to: 55, attack: 0.1, decay: 1.2, vol: 0.12 });
  },
  eyeScan(d, t) { tone(d, t, { type: 'sawtooth', from: 55, to: 220, attack: 0.3, decay: 0.5, vol: 0.18 }); noiseHit(d, t, { freq: 200, q: 6, attack: 0.3, decay: 0.4, vol: 0.4 }); },
  tp(d, t) {
    noiseHit(d, t, { freq: 2500, q: 1, attack: 0.04, decay: 0.5, vol: 0.8, sweepTo: 120 });
    tone(d, t, { type: 'sawtooth', from: 400, to: 40, decay: 0.6, vol: 0.12 });
  },
  stun(d, t) { tone(d, t, { from: 620, decay: 0.8, vol: 0.2 }); tone(d, t, { from: 931, decay: 0.6, vol: 0.12 }); noiseHit(d, t, { type: 'highpass', freq: 4000, decay: 0.1, vol: 0.4 }); },
  revealed(d, t) { tone(d, t, { type: 'square', from: 880, decay: 0.12, vol: 0.08 }); tone(d, t + 0.15, { type: 'square', from: 660, decay: 0.2, vol: 0.08 }); },
  // the hunter's grab: a lunge and a heavy, low hit
  grab(d, t) {
    noiseHit(d, t, { freq: 320, q: 1, attack: 0.01, decay: 0.28, vol: 1.1, sweepTo: 80 });
    tone(d, t, { type: 'sawtooth', from: 95, to: 42, attack: 0.02, decay: 0.7, vol: 0.2 });
  },
  struggle(d, t) { noiseHit(d, t, { freq: 700 + Math.random() * 600, q: 1.5, attack: 0.005, decay: 0.07, vol: 0.3 }); },
  breakFree(d, t) { noiseHit(d, t, { freq: 500, q: 1.2, attack: 0.02, decay: 0.3, vol: 0.8, sweepTo: 2500 }); },
  // lub-dub: a deep thump and a softer one right after (the seeker's heart, when the hunter is near)
  heart(d, t) {
    tone(d, t, { from: 70, to: 42, attack: 0.008, decay: 0.16, vol: 0.9 });
    noiseHit(d, t, { type: 'lowpass', freq: 160, attack: 0.005, decay: 0.1, vol: 1.2 });
    tone(d, t + 0.19, { from: 60, to: 38, attack: 0.008, decay: 0.2, vol: 0.55 });
    noiseHit(d, t + 0.19, { type: 'lowpass', freq: 130, attack: 0.005, decay: 0.12, vol: 0.7 });
  },
  ready(d, t) { tone(d, t, { from: 1320, decay: 0.15, vol: 0.06 }); },
  // the final duel: being hit, landing a headshot (a bright ding), a kill, the countdown, rounds won and lost
  hurt(d, t) { noiseHit(d, t, { type: 'lowpass', freq: 700, decay: 0.15, vol: 0.9 }); tone(d, t, { from: 220, to: 110, decay: 0.15, vol: 0.25 }); },
  headshot(d, t) { tone(d, t, { from: 2100, decay: 0.35, vol: 0.14 }); tone(d, t, { from: 3150, decay: 0.25, vol: 0.06 }); },
  kill(d, t) { tone(d, t, { type: 'triangle', from: 660, decay: 0.12, vol: 0.18 }); tone(d, t + 0.1, { type: 'triangle', from: 990, decay: 0.3, vol: 0.18 }); },
  tick(d, t) { tone(d, t, { type: 'square', from: 1000, decay: 0.05, vol: 0.05 }); },
  go(d, t) { tone(d, t, { type: 'square', from: 1500, decay: 0.25, vol: 0.07 }); },
  roundWin(d, t) { [523, 659, 784].forEach((f, i) => tone(d, t + i * 0.09, { type: 'triangle', from: f, decay: 0.5, vol: 0.14 })); },
  roundLose(d, t) { [392, 311, 233].forEach((f, i) => tone(d, t + i * 0.12, { type: 'triangle', from: f, decay: 0.6, vol: 0.14 })); },
  deny(d, t) { tone(d, t, { type: 'square', from: 180, decay: 0.12, vol: 0.06 }); },
};

// --- ambience: a quiet night forest ---------------------------------------------------
// A low wind bed with slow gusts, crickets, a distant owl now and then, twigs snapping and
// branches creaking somewhere in the dark (they mean nothing, but you can't know that), and
// a low drone that swells with danger. Danger (0..1, set by the match from how close the
// hunter is) also hushes the crickets, like real ones going quiet near a predator.
// Everything goes through `amb`, whose level is settings.ambience.
let amb = null, crickets = null, drone = null, windGain = null, windFilter = null;
const rand = (a, b) => a + Math.random() * (b - a);
const ambient = { crickets: [], nextOwl: 0, nextTwig: 0, nextGust: 0, danger: 0 };

// a sound somewhere around you in the dark: distance (m) and a random side
const somewhere = (near, far) => ({ dist: rand(near, far), pan: rand(-1, 1) });

function chirp(c, t) {
  // one cricket call: a few very short, high pulses
  for (let i = 0; i < c.pulses; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = c.freq;
    const at = t + i * c.gap;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(c.vol, at + 0.004);
    g.gain.linearRampToValueAtTime(0, at + 0.018);
    o.connect(g).connect(c.out);
    o.start(at); o.stop(at + 0.03);
  }
}

function owl(t) {
  // hoo … hoo-hoo, far away and muffled
  const d = out(somewhere(35, 60), 1.4, amb);
  const f = rand(330, 390);
  for (const [dt, len, k] of [[0, 0.45, 1], [0.75, 0.22, 0.8], [1.05, 0.5, 0.9]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f * 1.04, t + dt);
    o.frequency.exponentialRampToValueAtTime(f * 0.94, t + dt + len);
    g.gain.setValueAtTime(0.0001, t + dt);
    g.gain.exponentialRampToValueAtTime(0.14 * k, t + dt + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dt + len);
    o.connect(g).connect(d);
    o.start(t + dt); o.stop(t + dt + len + 0.05);
  }
}

function twig(t) {
  const d = out(somewhere(7, 22), 1, amb);
  if (Math.random() < 0.6) {
    // a twig snapping: a sharp crack and a splinter or two
    noiseHit(d, t, { type: 'highpass', freq: 1800, attack: 0.001, decay: 0.035, vol: 0.5 });
    noiseHit(d, t + rand(0.03, 0.08), { type: 'bandpass', freq: 2500, q: 3, attack: 0.001, decay: 0.025, vol: 0.25 });
    noiseHit(d, t, { type: 'lowpass', freq: 400, attack: 0.002, decay: 0.06, vol: 0.3 });
  } else {
    // a branch creaking: a slow, wavering groan
    const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    const f = rand(70, 120), len = rand(0.8, 1.6);
    o.frequency.setValueAtTime(f, t);
    for (let i = 1; i <= 6; i++) o.frequency.linearRampToValueAtTime(f * rand(0.9, 1.12), t + (len * i) / 6);
    bp.type = 'bandpass'; bp.frequency.value = rand(500, 900); bp.Q.value = 6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(bp).connect(g).connect(d);
    o.start(t); o.stop(t + len + 0.05);
  }
}

function startAmbience() {
  amb = ctx.createGain();
  amb.gain.value = settings.ambience;
  amb.connect(master);
  const now = ctx.currentTime;

  // wind: low and soft, with a gust every so often (scheduled below)
  const src = ctx.createBufferSource();
  src.buffer = noise(6);
  src.loop = true;
  windFilter = ctx.createBiquadFilter();
  windFilter.type = 'lowpass'; windFilter.frequency.value = 320;
  windGain = ctx.createGain();
  windGain.gain.value = 0.035;
  src.connect(windFilter).connect(windGain).connect(amb);
  src.start();

  // crickets: a few, each with its own pitch, rhythm and place
  crickets = ctx.createGain();
  crickets.connect(amb);
  for (let i = 0; i < 4; i++) {
    const p = ctx.createStereoPanner();
    p.pan.value = rand(-0.9, 0.9);
    p.connect(crickets);
    ambient.crickets.push({
      out: p, freq: rand(4100, 5200), vol: rand(0.006, 0.013), pulses: 2 + Math.floor(rand(0, 3)),
      gap: rand(0.028, 0.04), period: rand(0.7, 1.4), next: now + rand(0, 1.5),
    });
  }

  // the danger drone: two slightly detuned low saws and a sub, kept silent until needed
  drone = ctx.createGain();
  drone.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 170;
  lp.connect(drone).connect(amb);
  for (const [type, f, v] of [['sawtooth', 55, 0.5], ['sawtooth', 55.6, 0.5], ['sine', 41, 0.8]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f; g.gain.value = v;
    o.connect(g).connect(lp);
    o.start();
  }

  ambient.nextOwl = now + rand(15, 30);
  ambient.nextTwig = now + rand(8, 20);
  ambient.nextGust = now + rand(5, 12);
  // schedule a little ahead, a few times a second
  setInterval(() => {
    if (ctx.state !== 'running') return;
    const t = ctx.currentTime, ahead = t + 0.4;
    for (const c of ambient.crickets) {
      while (c.next < ahead) { chirp(c, Math.max(c.next, t)); c.next += c.period * rand(0.9, 1.1); }
    }
    if (ambient.nextOwl < ahead) { owl(Math.max(ambient.nextOwl, t)); ambient.nextOwl += rand(30, 70); }
    if (ambient.nextTwig < ahead) { twig(Math.max(ambient.nextTwig, t)); ambient.nextTwig += rand(12, 35); }
    if (ambient.nextGust < ahead) {
      // a gust: swell for a few seconds, then settle back
      const at = Math.max(ambient.nextGust, t), up = rand(2, 4), down = rand(3, 6);
      windGain.gain.setTargetAtTime(rand(0.07, 0.11), at, up / 3);
      windGain.gain.setTargetAtTime(0.035, at + up, down / 3);
      windFilter.frequency.setTargetAtTime(rand(500, 750), at, up / 3);
      windFilter.frequency.setTargetAtTime(320, at + up, down / 3);
      ambient.nextGust = at + up + down + rand(6, 16);
    }
  }, 200);
}

export const audio = {
  // must be called from a click/keypress (browsers block audio until then)
  start() {
    if (ctx) { ctx.resume(); return; }
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = settings.volume;
    master.connect(ctx.destination);
    noiseBuf = noise();
    startAmbience();
  },

  setVolume(v) { if (master) master.gain.value = v; },
  setAmbience(v) { if (amb) amb.gain.value = v; },

  // 0..1: how much danger the player is in (the hunter's closeness): the drone swells and
  // the crickets fall silent
  setDanger(k) {
    if (!ctx || Math.abs(k - ambient.danger) < 0.01) return;
    ambient.danger = k;
    const t = ctx.currentTime;
    drone.gain.setTargetAtTime(k * k * 0.16, t, 0.4);
    crickets.gain.setTargetAtTime(Math.max(0, 1 - k * 1.6), t, 0.6);
  },

  // a footstep on leaf litter: a soft, muffled heel thud and a few faint crackles
  // (quieter and darker than plain noise, which hissed); settings.steps is its volume
  step(speed) {
    if (!ctx || !settings.steps) return;
    const t = ctx.currentTime;
    const dest = ctx.createGain();
    dest.gain.value = settings.steps * Math.min(1, 0.45 + speed * 0.08);
    dest.connect(master);
    noiseHit(dest, t, { type: 'lowpass', freq: 240 + Math.random() * 90, attack: 0.006, decay: 0.09 + Math.random() * 0.03, vol: 0.5 });
    const crackles = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < crackles; i++) {
      noiseHit(dest, t + 0.01 + Math.random() * 0.07, {
        type: 'bandpass', freq: 1300 + Math.random() * 1500, q: 2.5, attack: 0.002, decay: 0.02 + Math.random() * 0.03, vol: 0.04 + Math.random() * 0.05,
      });
    }
  },

  page() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // paper rustle
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(hp).connect(g).connect(master);
    src.start(t, 0, 0.4);
    // low drone hit
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(41, t + 2.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 300;
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.35, t + 0.1);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    o.connect(lp).connect(og).connect(master);
    o.start(t); o.stop(t + 3.1);
  },

  // play a named sound, optionally placed in the world ({ dist, pan })
  play(name, at, vol = 1) {
    if (!ctx) return;
    SOUNDS[name]?.(out(at, vol), ctx.currentTime);
  },

  click() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 1800;
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.05);
  },
};
