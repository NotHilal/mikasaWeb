// Synthesized sound: the night-forest ambience, the page pickup, and the gun and ability sounds.
// The files are the footsteps (public/sounds/steps/) and the jumpscare (audio.file, SCARE in config.js).
import { settings } from './settings.js';

let ctx = null, master = null, noiseBuf = null, whiteBuf = null;

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
// Footsteps are recordings (public/sounds/steps/): each step plays one of them at random (never the
// same twice in a row), a little higher or lower and louder or softer each time. They're quiet and
// start with a moment of silence, so each is measured once loaded: played from where its sound
// starts, brought up to the same loudness. Until they've loaded (or if they can't), the synthesized
// crunch below plays instead.
const STEP_FILES = [0, 1, 2, 3].map((n) => `sounds/steps/step${n}.mp3`);
const STEP_PEAK = 0.55; // the loudness every step file is brought up to (its peak)
let steps = []; // the loaded ones: { buf, gain, offset }
let lastStep = -1;
async function loadSteps() {
  const loaded = await Promise.all(STEP_FILES.map(async (url) => {
    const buf = await loadFile(url);
    if (!buf) return null;
    const d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak < 1e-4) return null;
    let first = 0;
    while (first < d.length && Math.abs(d[first]) < peak * 0.08) first++;
    return { buf, gain: Math.min(30, STEP_PEAK / peak), offset: Math.max(0, first / buf.sampleRate - 0.004) };
  }));
  steps = loaded.filter(Boolean);
}

// Ability and event sounds from files (public/sounds/fx/), played with audio.fx(name). They're
// recorded at very different levels (tp.mp3 is 20× quieter than dash.mp3), so each is measured once
// loaded and brought to the same loudness (FX_LEVEL, an average; never past FX_PEAK at its
// loudest), times FX_BOOST if it should stand out. Leading silence is skipped, except where it's
// part of the timing. Until loaded (or if a file can't be), the synthesized sound plays instead.
const FX = {
  recon: 'sounds/fx/recon.mp3', flash: 'sounds/fx/flash.mp3', dash: 'sounds/fx/dash.mp3',
  eye: 'sounds/fx/eye.mp3', tp: 'sounds/fx/tp.mp3', start1v1: 'sounds/fx/1v1start.mp3',
  behind: 'sounds/fx/behindyou.mp3', // (the cabin's page: right behind your head)
};
const FX_LEVEL = 0.06, FX_PEAK = 0.9;
const FX_BOOST = { tp: 1.5 }; // (the teleport: a bit stronger than the others)
const fx = {}; // name -> { buf, gain, offset }
function loadFx() {
  for (const [name, url] of Object.entries(FX)) {
    loadFile(url).then((buf) => {
      if (!buf) return;
      const d = buf.getChannelData(0);
      let peak = 0, sum = 0;
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); peak = Math.max(peak, v); sum += v * v; }
      if (peak < 1e-4) return;
      const rms = Math.sqrt(sum / d.length);
      let first = 0;
      while (first < d.length && Math.abs(d[first]) < peak * 0.08) first++;
      fx[name] = { buf, gain: Math.min(FX_LEVEL / rms, FX_PEAK / peak) * (FX_BOOST[name] ?? 1), offset: Math.max(0, first / buf.sampleRate - 0.01) };
    });
  }
}

// plain white noise: bright, for the crunch of leaves underfoot
function white(seconds = 1) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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

function noiseHit(dest, t, { type = 'bandpass', freq = 1000, q = 1, attack = 0.005, decay = 0.2, vol = 1, sweepTo = null, buf = noiseBuf }) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * (buf.duration - attack - decay - 0.06), attack + decay + 0.05);
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
  // the hunter breaks into a sprint: a rising rush of air over a low snarl
  rush(d, t) {
    noiseHit(d, t, { type: 'bandpass', freq: 300, q: 0.9, attack: 0.08, decay: 0.55, vol: 1.1, sweepTo: 1800 });
    tone(d, t, { type: 'sawtooth', from: 70, to: 110, attack: 0.05, decay: 0.5, vol: 0.18 });
    tone(d, t + 0.03, { type: 'sawtooth', from: 73, to: 104, attack: 0.05, decay: 0.45, vol: 0.12 });
  },
  // the jumpscare, when sounds/jumpscare.mp3 isn't there: a burst of shrieking noise over a low hit
  scare(d, t) {
    noiseHit(d, t, { type: 'highpass', freq: 1200, attack: 0.005, decay: 1.1, vol: 1.6, sweepTo: 4000 });
    noiseHit(d, t, { freq: 180, q: 0.8, attack: 0.005, decay: 0.9, vol: 1.8, sweepTo: 50 });
    for (const f of [740, 1010, 1390]) tone(d, t, { type: 'sawtooth', from: f, to: f * 1.4, attack: 0.01, decay: 1, vol: 0.12 });
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
// Crickets, a distant owl now and then, twigs snapping and branches creaking somewhere in the
// dark (they mean nothing, but you can't know that), and a low drone that swells with danger.
// Danger (0..1, set by the match from how close the hunter is) also hushes the crickets, like
// real ones going quiet near a predator. (No wind.) Everything goes through `amb`, whose level
// is settings.ambience.
let amb = null, crickets = null, drone = null;
const rand = (a, b) => a + Math.random() * (b - a);
const ambient = { crickets: [], nextOwl: 0, nextTwig: 0, danger: 0 };

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

  // (no wind: the night is just the crickets, the odd owl or twig, and the footsteps)

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
  // schedule a little ahead, a few times a second
  setInterval(() => {
    if (ctx.state !== 'running') return;
    const t = ctx.currentTime, ahead = t + 0.4;
    for (const c of ambient.crickets) {
      while (c.next < ahead) { chirp(c, Math.max(c.next, t)); c.next += c.period * rand(0.9, 1.1); }
    }
    if (ambient.nextOwl < ahead) { owl(Math.max(ambient.nextOwl, t)); ambient.nextOwl += rand(30, 70); }
    if (ambient.nextTwig < ahead) { twig(Math.max(ambient.nextTwig, t)); ambient.nextTwig += rand(12, 35); }
  }, 200);
}

const files = new Map(); // url -> promise of a decoded buffer (null if it couldn't be loaded)
function loadFile(url) {
  if (!files.has(url)) {
    files.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((b) => ctx.decodeAudioData(b)).catch(() => null));
  }
  return files.get(url);
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
    whiteBuf = white();
    loadSteps();
    loadFx();
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
    if (ctx.currentTime >= (ambient.hushUntil ?? 0)) crickets.gain.setTargetAtTime(Math.max(0, 1 - k * 1.6), t, 0.6);
  },

  // a scare: the crickets stop dead for `seconds`, then come back
  hush(seconds) {
    if (!ctx) return;
    const t = ctx.currentTime;
    ambient.hushUntil = t + seconds;
    crickets.gain.cancelScheduledValues(t);
    crickets.gain.setTargetAtTime(0, t, 0.03);
    crickets.gain.setTargetAtTime(Math.max(0, 1 - ambient.danger * 1.6), t + seconds, 1.2);
  },

  // a footstep (settings.steps is its volume; faster is a little louder). heavy: Slender's, the
  // same sounds slower and deeper
  step(speed, heavy = false) {
    if (!ctx || !settings.steps) return;
    const t = ctx.currentTime;
    const vol = settings.steps * Math.min(1, 0.45 + speed * 0.08);
    if (steps.length) {
      // a recording: a different one from last time, pitched and leveled a little differently
      let i = Math.floor(Math.random() * steps.length);
      if (steps.length > 1 && i === lastStep) i = (i + 1 + Math.floor(Math.random() * (steps.length - 1))) % steps.length;
      lastStep = i;
      const s = steps[i];
      const src = ctx.createBufferSource();
      src.buffer = s.buf;
      src.playbackRate.value = (heavy ? 0.8 : 1) * (0.92 + Math.random() * 0.16);
      const g = ctx.createGain();
      g.gain.value = vol * s.gain * (0.85 + Math.random() * 0.3) * (heavy ? 1.15 : 1);
      src.connect(g).connect(master);
      src.start(t, s.offset);
      return;
    }
    this.crunch(t, vol);
  },

  // the synthesized footstep (while the recordings load, or if they can't): a step on dry leaf
  // litter, no low thud at all (too much like the heartbeat), just the crunch: a short "shhk" of
  // leaves pressed down, a quick crackle of tiny dry clicks, now and then a twig snapping
  crunch(t, vol) {
    const dest = ctx.createGain();
    dest.gain.value = vol;
    // (and nothing below the leaves: no rumble under it)
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 450;
    dest.connect(hp).connect(master);
    const w = whiteBuf;
    // the leaves pressed down: a soft band of noise that falls a little as the foot settles
    const f = 1100 + Math.random() * 600;
    noiseHit(dest, t, { buf: w, type: 'bandpass', freq: f, q: 0.9, attack: 0.012, decay: 0.11 + Math.random() * 0.05, vol: 0.32, sweepTo: f * 0.7 });
    // the crackle: many tiny bright clicks spread over the step
    const grains = 7 + Math.floor(Math.random() * 6);
    for (let i = 0; i < grains; i++) {
      noiseHit(dest, t + 0.004 + Math.random() * 0.12, {
        buf: w, type: 'bandpass', freq: 2200 + Math.random() * 3800, q: 1.6, attack: 0.001, decay: 0.006 + Math.random() * 0.018, vol: 0.06 + Math.random() * 0.1,
      });
    }
    // a twig, sometimes: one sharp, slightly louder snap
    if (Math.random() < 0.15) {
      noiseHit(dest, t + 0.02 + Math.random() * 0.06, { buf: w, type: 'bandpass', freq: 2600 + Math.random() * 1200, q: 4, attack: 0.001, decay: 0.012, vol: 0.28 });
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

  // a sound file in public/ (loaded once, then kept); played through the master volume. If the
  // file can't be loaded, `fallback` (a named sound) plays instead.
  // at: optionally placed in the world ({ dist, pan }), like play()
  async file(url, vol = 1, fallback = null, at = null) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const buf = await loadFile(url);
    if (!buf) { if (fallback) this.play(fallback, at, vol); return; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(out(at, vol));
    // (if it took a moment to load the first time, it still starts right away)
    src.start(Math.max(t, ctx.currentTime));
  },
  preload(url) { if (ctx) loadFile(url); },

  // one of the FX sounds (leveled, see FX), optionally placed in the world ({ dist, pan }); until
  // it's loaded, or if it can't be, `fallback` (a synthesized sound) instead
  fx(name, at = null, vol = 1, fallback = null) {
    if (!ctx) return;
    const f = fx[name];
    if (!f) { if (fallback) this.play(fallback, at, vol); return; }
    const src = ctx.createBufferSource();
    src.buffer = f.buf;
    src.connect(out(at, vol * f.gain));
    src.start(ctx.currentTime, f.offset);
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
