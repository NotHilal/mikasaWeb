// The end-of-round recap: a top-down map (the map draws itself: world.map) with both players' paths, the pages,
// and the closest the hunter got, plus a few numbers. Drawn on a 2D canvas.
import { PAGES } from './config.js';

const COL = {
  seeker: '#3fe0c5',
  hunter: '#a87bff',
  close: '#ff4655',
  ink: 'rgba(236, 232, 225, 0.9)',
};

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function drawRecap(canvas, world, recap) {
  const size = canvas.clientWidth || 240;
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(size * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // world x → right, world z → down (north is up)
  const R = world.map.R + 4, k = size / (2 * R);
  const px = (x) => (x + R) * k, pz = (z) => (z + R) * k;

  // the play area
  g.clearRect(0, 0, size, size);
  world.map.draw(g, px, pz, k, true);

  // paths: the hunter first, so the seeker's line sits on top
  const path = (pts, color) => {
    g.strokeStyle = color;
    g.lineWidth = 1.8;
    g.lineJoin = g.lineCap = 'round';
    g.beginPath();
    let pen = false;
    for (const p of pts) {
      if (!p) { pen = false; continue; }
      if (pen) g.lineTo(px(p.x), pz(p.z)); else g.moveTo(px(p.x), pz(p.z));
      pen = true;
    }
    g.stroke();
    const first = pts.find(Boolean), last = pts.findLast(Boolean);
    if (!first) return;
    // start: a hollow ring; end: a solid dot
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(px(first.x), pz(first.z), 3.5, 0, Math.PI * 2); g.stroke();
    g.fillStyle = color;
    g.beginPath(); g.arc(px(last.x), pz(last.z), 4, 0, Math.PI * 2); g.fill();
  };
  path(recap.track.hunter, COL.hunter);
  path(recap.track.seeker, COL.seeker);

  // pages: a filled diamond if taken, an outline if not
  for (const p of recap.pages) {
    g.save();
    g.translate(px(p.x), pz(p.z));
    g.rotate(Math.PI / 4);
    g.strokeStyle = g.fillStyle = COL.ink;
    g.lineWidth = 1.2;
    if (p.taken) g.fillRect(-3, -3, 6, 6); else g.strokeRect(-3, -3, 6, 6);
    g.restore();
  }

  // the closest call: a dashed red line between where they both stood
  const c = recap.closest;
  if (c?.seeker && c?.hunter) {
    g.strokeStyle = COL.close;
    g.lineWidth = 1.5;
    g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(px(c.seeker.x), pz(c.seeker.z)); g.lineTo(px(c.hunter.x), pz(c.hunter.z)); g.stroke();
    g.setLineDash([]);
    g.beginPath(); g.arc(px(c.seeker.x), pz(c.seeker.z), 7, 0, Math.PI * 2); g.stroke();
  }
}

// the numbers next to the map
export function recapStats(recap, role) {
  const c = recap.closest;
  const caught = recap.result === 'caught';
  return [
    ['Round time', clock(recap.time)],
    ['Pages', `${recap.found} / ${PAGES}`],
    ['Closest call', caught ? 'Caught' : c ? `${c.d.toFixed(1)} m` : '–', c && !caught ? `at ${clock(c.t)}` : ''],
    [role === 'seeker' ? 'Stuns landed' : 'Times stunned', String(recap.stuns)],
  ];
}
