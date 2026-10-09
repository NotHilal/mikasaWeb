// The seeker's nerves, on his screen only (nothing here changes the game, and the hunter sees
// none of it except the flashlight going out, which is the real flashlight):
// - the flashlight acting up: a flicker, then dark for a moment (FLICKER);
// - fake scares now and then (SCARES): Slender glimpsed between the trees, the crickets stopping
//   dead; the whisper, once a game; and after taking a page, sometimes, Slender standing right
//   behind you until you turn round.
// Created by the match for the seeker; update() every frame, onPage() when he takes a page.
import * as THREE from 'three';
import { audio } from './audio.js';
import { hunterFigure } from './figures.js';
import { FLICKER, SCARES } from './config.js';

const now = () => performance.now();
const rand = (a, b) => a + Math.random() * (b - a);

export function createScares({ engine, world, player, flashlight }) {
  const t0 = now();
  // a Slender of our own, for the fakes (the same model, so nothing new to compile)
  const phantom = hunterFigure();
  phantom.visible = false;
  engine.scene.add(phantom);
  audio.preload(SCARES.whisper);

  let flickerNext = t0 + Math.max(FLICKER.first, rand(FLICKER.min, FLICKER.max)) * 1000;
  let scareNext = t0 + Math.max(SCARES.first, rand(SCARES.min, SCARES.max)) * 1000;
  let whisperAt = t0 + rand(...SCARES.whisperAt) * 1000; // (once a game; 0 once it's been)
  let blackout = null; // { start, toggles: [ms…] }
  let shown = null;    // the phantom on show: { kind: 'sight' | 'behind', until }

  const place = (x, z) => {
    phantom.position.set(x, world.heightAt(x, z), z);
    phantom.rotation.y = Math.atan2(-(player.pos.x - x), -(player.pos.z - z)); // (facing me)
  };
  const hide = () => { phantom.visible = false; shown = null; };
  const whisper = () => audio.file(SCARES.whisper, SCARES.whisperVol, null, { dist: 1.2, pan: Math.random() < 0.5 ? -0.8 : 0.8 });

  // one of the fakes, at random (SCARES.kinds: how likely each is)
  function scare(t) {
    let roll = Math.random() * Object.values(SCARES.kinds).reduce((a, b) => a + b, 0), kind = 'sight';
    for (const [k, w] of Object.entries(SCARES.kinds)) { if ((roll -= w) <= 0) { kind = k; break; } }
    if (kind === 'sight') {
      // right ahead, close, between the trees
      const a = player.yaw + rand(-0.25, 0.25), d = rand(...SCARES.sightDist);
      place(player.pos.x - Math.sin(a) * d, player.pos.z - Math.cos(a) * d);
      phantom.visible = true;
      shown = { kind: 'sight', until: t + SCARES.sightMs };
    } else audio.hush(SCARES.silenceMs / 1000);
  }

  return {
    // is the flashlight out of the seeker's hands right now (it can't be switched meanwhile)
    get blackout() { return !!blackout; },

    // every frame. calm: may a scare start now (no grab, no jumpscare, the round on); dread 0..1;
    // hunterDist: how far the real hunter is (Infinity if unknown)
    update(dt, time, { calm, dread, hunterDist }) {
      const t = now();
      // the flashlight: flickering, then dark, then back on (cut short by a grab or the jumpscare:
      // those need the light, his face has to be seen)
      if (blackout && !calm) {
        blackout = null;
        flashlight.on = true;
        flickerNext = t + rand(FLICKER.min, FLICKER.max) * 1000;
      } else if (blackout) {
        const since = t - blackout.start;
        if (since < FLICKER.flickerMs) flashlight.on = blackout.toggles.filter((ms) => ms < since).length % 2 === 0;
        else if (since < FLICKER.flickerMs + FLICKER.darkMs) flashlight.on = false;
        else {
          flashlight.on = true;
          blackout = null;
          // (sooner when he's near)
          flickerNext = t + (rand(FLICKER.min, FLICKER.max) * 1000) / THREE.MathUtils.lerp(1, FLICKER.nearFaster, Math.min(1, dread / 0.5));
        }
      } else if (calm && t >= flickerNext) {
        if (flashlight.on) {
          // a run of quick, uneven blinks
          const toggles = [];
          for (let ms = rand(40, 90); ms < FLICKER.flickerMs; ms += rand(50, 140)) toggles.push(ms);
          blackout = { start: t, toggles };
        } else flickerNext = t + rand(10, 30) * 1000; // (it's off anyway: try again soon)
      }

      // the fakes
      if (!calm && shown) hide();
      if (calm && !shown && !blackout && t >= scareNext) {
        if (hunterDist > SCARES.safeDist) scare(t);
        scareNext = t + rand(SCARES.min, SCARES.max) * 1000;
      }
      // the whisper, once a game (if he's near when its moment comes, a little later)
      if (whisperAt && t >= whisperAt && calm) {
        if (hunterDist > SCARES.safeDist) { whisper(); whisperAt = 0; } else whisperAt = t + 20000;
      }
      if (shown) {
        place(phantom.position.x, phantom.position.z); // (keep facing me)
        phantom.userData.animate?.(dt, 0, time, {});
        if (shown.kind === 'behind') {
          // turned round to look at him: a moment later he's gone
          const to = phantom.position.clone().setY(player.pos.y).sub(player.pos).normalize();
          const fwd = player.forward.setY(0).normalize();
          if (!shown.seen && to.dot(fwd) > Math.cos(THREE.MathUtils.degToRad(30))) {
            shown.seen = true;
            shown.until = t + 400;
          }
        }
        if (t >= shown.until) hide();
      }
    },

    // the seeker took a page: sometimes (always: every time, the cabin's page), Slender is right
    // behind him
    onPage({ calm, hunterDist, always = false }) {
      if (!calm || shown || hunterDist <= SCARES.safeDist || (!always && Math.random() >= SCARES.behindChance)) return;
      const f = player.forward.setY(0).normalize();
      place(player.pos.x - f.x * SCARES.behindDist, player.pos.z - f.z * SCARES.behindDist);
      phantom.visible = true;
      shown = { kind: 'behind', until: now() + SCARES.behindMs, seen: false };
    },

    // the round was frozen for `gap` ms (a dropped player): push every timer back
    shift(gap) {
      flickerNext += gap; scareNext += gap;
      if (whisperAt) whisperAt += gap;
      if (blackout) blackout.start += gap;
      if (shown) shown.until += gap;
    },

    dispose() {
      engine.scene.remove(phantom);
      if (blackout) flashlight.on = true;
    },
  };
}
