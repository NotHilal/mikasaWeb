// Split as a fine grid (CELL metres a side): each cell has a floor height (NaN where it's
// building) and a ceiling (Infinity in the open). Split has no floor above another floor, so this
// is all the collision the map needs: walking (you can step up STEP), walking off a ledge, ceilings
// (the vent is too low for the hunter), shots and scans, teleports. The visible map is built from
// the same plan, so what blocks you is what you see.
import { BOUNDS, AREAS, STAIRS, ROPES, COVER, LAMPS, UPPER } from './plan.js';

export const CELL = 0.25;
export const STEP = 0.45;      // what you walk up without jumping (a stair is 0.2)
export const RAIL = 0.8;       // the railings along the upper level: a seeker can hop over (jump 0.9)
const NX = Math.round((BOUNDS.x1 - BOUNDS.x0) / CELL), NZ = Math.round((BOUNDS.z1 - BOUNDS.z0) / CELL);

export function buildGrid() {
  const floor = new Float32Array(NX * NZ).fill(NaN);
  const ceil = new Float32Array(NX * NZ).fill(Infinity);
  const area = new Int16Array(NX * NZ).fill(-1);
  const stair = new Uint8Array(NX * NZ);
  const rail = new Uint8Array(NX * NZ);
  const ix = (x) => Math.floor((x - BOUNDS.x0) / CELL), iz = (z) => Math.floor((z - BOUNDS.z0) / CELL);
  const at = (x, z) => {
    const i = ix(x), k = iz(z);
    return i < 0 || k < 0 || i >= NX || k >= NZ ? -1 : k * NX + i;
  };
  // every cell whose centre is inside the rectangle
  const each = (x0, z0, x1, z1, fn) => {
    for (let k = Math.max(0, Math.ceil((z0 - BOUNDS.z0) / CELL - 0.5)); k < Math.min(NZ, Math.ceil((z1 - BOUNDS.z0) / CELL - 0.5)); k++) {
      for (let i = Math.max(0, Math.ceil((x0 - BOUNDS.x0) / CELL - 0.5)); i < Math.min(NX, Math.ceil((x1 - BOUNDS.x0) / CELL - 0.5)); i++) {
        fn(k * NX + i, BOUNDS.x0 + (i + 0.5) * CELL, BOUNDS.z0 + (k + 0.5) * CELL);
      }
    }
  };
  const walkable = (c) => c >= 0 && !Number.isNaN(floor[c]);

  AREAS.forEach(([, x0, z0, x1, z1, y, , top], n) => each(x0, z0, x1, z1, (c) => { floor[c] = y; ceil[c] = top ?? Infinity; area[c] = n; }));
  // stairs: steps of about 0.2 m, each the same depth
  for (const s of STAIRS) {
    const along = s.up === 'n' || s.up === 's' ? s.z1 - s.z0 : s.x1 - s.x0;
    const steps = Math.ceil((s.to - s.from) / 0.2), depth = along / steps;
    s.steps = steps; s.depth = depth;
    each(s.x0, s.z0, s.x1, s.z1, (c, x, z) => {
      const d = s.up === 'n' ? s.z1 - z : s.up === 's' ? z - s.z0 : s.up === 'e' ? x - s.x0 : s.x1 - x; // from the bottom
      floor[c] = s.from + (s.to - s.from) * Math.min(steps, Math.floor(d / depth) + 1) / steps;
      ceil[c] = Infinity;
      stair[c] = 1;
      if (area[c] < 0) area[c] = 0;
    });
  }
  // cover and lamp poles stand on the floor
  for (const [x, z, w, d, h] of COVER) each(x - w / 2, z - d / 2, x + w / 2, z + d / 2, (c) => { if (walkable(c)) floor[c] += h; });
  for (const [x, z] of LAMPS) each(x - 0.15, z - 0.15, x + 0.15, z + 0.15, (c) => { if (walkable(c)) floor[c] += 8; });

  // railings along the upper level's edges where it drops to the street, except at the ropes
  const drop = (c, n) => n >= 0 && walkable(n) && floor[n] < floor[c] - 1.5;
  for (let c = 0; c < NX * NZ; c++) {
    if (!walkable(c) || floor[c] < UPPER - 0.05 || stair[c]) continue;
    const i = c % NX, k = (c - i) / NX;
    const near = [i > 0 ? c - 1 : -1, i < NX - 1 ? c + 1 : -1, k > 0 ? c - NX : -1, k < NZ - 1 ? c + NX : -1];
    if (!near.some((n) => drop(c, n))) continue;
    const x = BOUNDS.x0 + (i + 0.5) * CELL, z = BOUNDS.z0 + (k + 0.5) * CELL;
    if (ROPES.some((r) => Math.hypot(r.x - x, r.z - z) < 1.2)) continue;
    rail[c] = 1;
  }
  for (let c = 0; c < NX * NZ; c++) if (rail[c]) floor[c] += RAIL;

  // --- questions the game asks -------------------------------------------------------------
  const floorAt = (x, z) => { const c = at(x, z); return c < 0 || Number.isNaN(floor[c]) ? Infinity : floor[c]; };
  const ceilAt = (x, z) => { const c = at(x, z); return c < 0 ? -Infinity : ceil[c]; };

  const colliders = {
    // push a circle out of what it can't stand in: building, anything higher than it can step up
    // (or, in the air, higher than its feet), anywhere the ceiling is lower than its head.
    // feet: set while in the air; standing: the floor it's on; height: how tall it is
    resolve(pos, r, feet = -Infinity, standing = undefined, height = 1.8) {
      const base = standing ?? (Number.isFinite(feet) ? feet : floorAt(pos.x, pos.z));
      const lim = Number.isFinite(feet) ? feet + 0.05 : base + STEP, head = base + height;
      for (let pass = 0; pass < 2; pass++) {
        for (let k = iz(pos.z - r); k <= iz(pos.z + r); k++) {
          for (let i = ix(pos.x - r); i <= ix(pos.x + r); i++) {
            const out = i < 0 || k < 0 || i >= NX || k >= NZ, c = k * NX + i;
            if (!out && !Number.isNaN(floor[c]) && floor[c] <= lim && ceil[c] >= head) continue;
            // push out of this cell's square
            const cx0 = BOUNDS.x0 + i * CELL, cz0 = BOUNDS.z0 + k * CELL;
            const qx = Math.min(Math.max(pos.x, cx0), cx0 + CELL), qz = Math.min(Math.max(pos.z, cz0), cz0 + CELL);
            const dx = pos.x - qx, dz = pos.z - qz, d = Math.hypot(dx, dz);
            if (d >= r) continue;
            if (d > 1e-5) { pos.x = qx + (dx / d) * r; pos.z = qz + (dz / d) * r; }
          }
        }
      }
      pos.x = Math.min(Math.max(pos.x, BOUNDS.x0 + r), BOUNDS.x1 - r);
      pos.z = Math.min(Math.max(pos.z, BOUNDS.z0 + r), BOUNDS.z1 - r);
    },
    // first point (0..1 of the way) where a→b runs into building, cover, a floor or a ceiling
    hit(a, b) {
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (len < 1e-6) return null;
      const n = Math.ceil(len / (CELL * 0.5));
      for (let s = 1; s <= n; s++) {
        const t = s / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
        if (y < floorAt(x, z) || y > ceilAt(x, z)) return (s - 1) / n;
      }
      return null;
    },
    blocked(a, b) { return this.hit(a, b) !== null; },
  };

  // where a page can go: on a wall beside somewhere you can walk, about every 3 m along the
  // edges of each area, at chest height, facing out from the wall
  function pageSpots() {
    const spots = [];
    AREAS.forEach(([name, x0, z0, x1, z1, y, kind]) => {
      if (kind === 'vent') return;
      const edges = [
        [x0, z0, x1, z0, 0, -1], [x0, z1, x1, z1, 0, 1], // north, south walls (outward normal of the area)
        [x0, z0, x0, z1, -1, 0], [x1, z0, x1, z1, 1, 0], // west, east
      ];
      for (const [ax, az, bx, bz, nx, nz] of edges) {
        const L = Math.hypot(bx - ax, bz - az);
        for (let s = 1.5; s < L - 1.5; s += 3) {
          const x = ax + ((bx - ax) * s) / L, z = az + ((bz - az) * s) / L;
          const inside = at(x - nx * 0.4, z - nz * 0.4), outside = at(x + nx * 0.4, z + nz * 0.4);
          if (!walkable(inside) || stair[inside] || walkable(outside) || Math.abs(floor[inside] - y) > 0.01) continue;
          spots.push({ pos: { x: x - nx * 0.02, y: y + 1.45, z: z - nz * 0.02 }, face: Math.atan2(-nx, -nz), area: name });
        }
      }
    });
    return spots;
  }

  return { NX, NZ, floor, ceil, area, stair, rail, at, each, walkable, floorAt, ceilAt, colliders, pageSpots };
}
