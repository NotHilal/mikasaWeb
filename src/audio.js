// Synthesized sound (no audio files): wind ambience, footsteps on leaves, page pickup.
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
function out(at, vol = 1) {
  const g = ctx.createGain();
  g.gain.value = vol * (at ? 1 / (1 + at.dist / 8) : 1);
  if (at) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(600, 16000 / (1 + at.dist / 6));
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, at.pan));
    g.connect(lp).connect(p).connect(master);
  } else g.connect(master);
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
  ready(d, t) { tone(d, t, { from: 1320, decay: 0.15, vol: 0.06 }); },
  deny(d, t) { tone(d, t, { type: 'square', from: 180, decay: 0.12, vol: 0.06 }); },
};

export const audio = {
  // must be called from a click/keypress (browsers block audio until then)
  start() {
    if (ctx) { ctx.resume(); return; }
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = settings.volume;
    master.connect(ctx.destination);
    noiseBuf = noise();

    // wind: looping noise through a slowly wandering band-pass filter
    const src = ctx.createBufferSource();
    src.buffer = noise(6);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.7;
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07; lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(bp.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.16;
    src.connect(bp).connect(g).connect(master);
    src.start(); lfo.start();
  },

  setVolume(v) { if (master) master.gain.value = v; },

  step(speed) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 900; f.Q.value = 0.9;
    const g = ctx.createGain();
    const vol = Math.min(1, 0.25 + speed * 0.1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18 + Math.random() * 0.08);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 1.5, 0.3);
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
