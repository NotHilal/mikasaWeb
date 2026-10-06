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
