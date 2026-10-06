// Seeded randomness and 2D simplex noise, so both players build the exact same forest.

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (n) => Math.floor(next() * n);
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  return next;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

export function simplex2(seed) {
  const r = rng(seed);
  const p = new Uint8Array(256).map((_, i) => i);
  for (let i = 255; i > 0; i--) { const j = r.int(i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512).map((_, i) => p[i & 255]);

  return (x, y) => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    const corner = (gx, gy, dx, dy) => {
      const tt = 0.5 - dx * dx - dy * dy;
      if (tt <= 0) return 0;
      const g = GRAD[perm[gx + perm[gy]] & 7];
      return tt * tt * tt * tt * (g[0] * dx + g[1] * dy);
    };
    n += corner(ii, jj, x0, y0);
    n += corner(ii + i1, jj + j1, x1, y1);
    n += corner(ii + 1, jj + 1, x2, y2);
    return 70 * n; // about -1..1
  };
}

// fractal noise: sum of octaves, about -1..1
export function fbm(noise, x, y, octaves = 4) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
