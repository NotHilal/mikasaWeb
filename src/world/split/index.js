// Split, level 2: built once (in the background, after the menu is up) and shown when the round
// moves there. Answers the game's questions the same way the forest does (see world.js), plus
// ropeAt (the ropes up to the upper level) and ceilAt (indoors). Night: the fog and sky darken,
// and the lamps, signs and windows light the streets.
import * as THREE from 'three';
import { buildGrid } from './grid.js';
import { buildCity } from './build.js';
import { splitMaterials } from './look.js';
import { BOUNDS, AREAS, ROPES, SPAWNS } from './plan.js';
import { placePages } from '../pages.js';
import { rng } from '../noise.js';
import { PAGES, PAGE_SPOTS } from '../../config.js';

const FOG = { color: 0x0a0c16, density: 0.034 };

// the map from above: where you can walk, the upper level brighter, indoors darker
function drawPlan(grid) {
  const S = 2; // pixels per metre
  const w = (BOUNDS.x1 - BOUNDS.x0) * S, h = (BOUNDS.z1 - BOUNDS.z0) * S;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  for (let k = 0; k < h; k++) for (let i = 0; i < w; i++) {
    const c = grid.at(BOUNDS.x0 + (i + 0.5) / S, BOUNDS.z0 + (k + 0.5) / S);
    if (!grid.walkable(c)) continue;
    const a = AREAS[grid.area[c]], base = a[5], raised = grid.floor[c] - base > 0.3 && !grid.stair[c] && !grid.rail[c];
    const alpha = raised ? 0.05 : a[7] !== undefined ? 0.12 : grid.stair[c] ? 0.24 : base > 1 ? 0.34 : 0.2;
    g.fillStyle = `rgba(236, 232, 225, ${alpha})`;
    g.fillRect(i, k, 1, 1);
  }
  return cv;
}

export async function buildSplit(manager, quality) {
  const grid = buildGrid();
  const mats = splitMaterials(new THREE.TextureLoader(manager));
  const { group } = await buildCity(grid, mats, manager, quality);
  const spots = grid.pageSpots();
  const plan = drawPlan(grid);
  let saved = null;

  return {
    name: 'split',
    group,
    // the floor under (x, z): Split never has one floor above another, so the height asked from
    // doesn't matter; inside a building, far up (whatever reaches it has hit a wall)
    heightAt(x, z) { const f = grid.floorAt(x, z); return Number.isFinite(f) ? f : 1000; },
    ceilAt: grid.ceilAt,
    colliders: grid.colliders,
    clamp(p, margin = 1) {
      p.x = Math.min(Math.max(p.x, BOUNDS.x0 + margin), BOUNDS.x1 - margin);
      p.z = Math.min(Math.max(p.z, BOUNDS.z0 + margin), BOUNDS.z1 - margin);
      return p;
    },
    // a rope you're standing at (and not yet at the top of): { top, out }
    ropeAt(pos) {
      for (const r of ROPES) {
        if (Math.hypot(pos.x - r.x, pos.z - r.z) > 0.75) continue;
        const top = grid.floorAt(r.x + r.out[0] * 1.5, r.z + r.out[1] * 1.5);
        if (pos.y < top) return { top, out: r.out };
      }
      return null;
    },
    map: {
      R: Math.max(-BOUNDS.x0, BOUNDS.x1, -BOUNDS.z0, BOUNDS.z1),
      draw(g, px, pz, k, big = false) {
        g.fillStyle = big ? 'rgba(8, 14, 20, 0.85)' : 'rgba(8, 14, 20, 0.78)';
        g.fillRect(px(BOUNDS.x0), pz(BOUNDS.z0), (BOUNDS.x1 - BOUNDS.x0) * k, (BOUNDS.z1 - BOUNDS.z0) * k);
        g.imageSmoothingEnabled = true;
        g.drawImage(plan, px(BOUNDS.x0), pz(BOUNDS.z0), (BOUNDS.x1 - BOUNDS.x0) * k, (BOUNDS.z1 - BOUNDS.z0) * k);
        // the sites, and the callouts on the big map
        g.fillStyle = 'rgba(255, 70, 85, 0.75)';
        g.font = `600 ${big ? 13 : 10}px "Barlow Condensed", sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('A', px(-44), pz(-11)); g.fillText('B', px(44), pz(-11));
        if (big) {
          g.fillStyle = 'rgba(236, 232, 225, 0.45)';
          g.font = '600 9px "Barlow Condensed", sans-serif';
          for (const [t, x, z] of [['MID', 0, 10], ['MAIL', 0, 33], ['A MAIN', -44.5, 10], ['B MAIN', 44.5, 10], ['A HEAVEN', -43, -38], ['B HEAVEN', 43, -38], ['MID TOP', 0, -15], ['A LOBBY', -39, 34], ['B LOBBY', 39, 34], ['SPAWN', 0, 51], ['SPAWN', 0, -50]]) g.fillText(t, px(x), pz(z));
        }
      },
    },

    // the round's pages: from the spots on walls beside the streets, spread apart, away from the
    // seeker's start, the same on both screens (the round's seed)
    pickPages(seed, avoid = null) {
      const pr = rng(seed + 9);
      const order = spots.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = pr.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
      const chosen = [];
      for (let apart = PAGE_SPOTS.apart; chosen.length < PAGES && apart > 4; apart *= 0.8) {
        for (const i of order) {
          if (chosen.length >= PAGES) break;
          const s = spots[i];
          if (avoid && Math.hypot(s.pos.x - avoid.x, s.pos.z - avoid.z) < PAGE_SPOTS.fromSeeker) continue;
          if (chosen.some((c) => c.spot === s || Math.hypot(c.pos.x - s.pos.x, c.pos.z - s.pos.z) < apart)) continue;
          chosen.push({ spot: s, pos: new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z), face: s.face });
        }
      }
      return chosen.map((c, i) => ({ pos: c.pos, face: c.face, n: i + 1 }));
    },
    placePages(chosen) { return placePages(group, chosen); },

    // the seeker starts in attacker spawn, the hunter in defender spawn
    spawnPoint(seed, away) {
      const list = away ? SPAWNS.hunter : SPAWNS.seeker, [x, z] = list[rng(seed).int(list.length)];
      return new THREE.Vector3(x, grid.floorAt(x, z), z);
    },
    update() {},

    // switching to and from it: the city's fog, and the city itself in the scene
    enter(engine) {
      const s = engine.scene;
      saved = { color: s.fog.color.getHex(), density: s.fog.density, hemi: engine.hemi.intensity, sky: engine.hemi.color.getHex() };
      s.fog.color.set(FOG.color);
      s.fog.density = FOG.density;
      // a city's night sky is never quite black: a little more glow than the forest, warmer
      engine.hemi.intensity = saved.hemi * 1.5;
      engine.hemi.color.set(0x3a3f5a);
      s.add(group);
    },
    exit(engine) {
      const s = engine.scene;
      if (saved) { s.fog.color.setHex(saved.color); s.fog.density = saved.density; engine.hemi.intensity = saved.hemi; engine.hemi.color.setHex(saved.sky); saved = null; }
      s.remove(group);
    },
  };
}
