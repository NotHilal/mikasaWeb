// The minimap, top left of the HUD: the woods from above, north up. Trees, landmarks, the edge of
// the play area, the pages already taken, the zones your own dart or eye scanned, and you (an
// arrow pointing where you look). Never the other player, and never exactly where the pages still
// to find are: that would spoil the hunt (late in a round, the seeker gets a rough circle round
// each, PAGE_ZONES).
import { MAP } from './config.js';
// (scan colours: the dart's teal, the eye's purple)
export const SCAN_COLOR = { dart: '63, 224, 197', eye: '176, 77, 255' };

const SIZE = 168; // css px
export const SCAN_SHOW = 6; // seconds a scanned zone stays on the map (fading out)
const SCAN_GROW = 0.6;      // seconds its ring takes to spread out to the full zone

export function createMinimap(canvas, world) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(SIZE * dpr);
  const g = canvas.getContext('2d');
  // world x → right, world z → down; the whole play area fits, with a little margin
  const R = MAP.play + 3, k = SIZE / (2 * R);
  const px = (x) => (x + R) * k, pz = (z) => (z + R) * k;

  // the part that never changes, drawn once
  const bg = document.createElement('canvas');
  bg.width = bg.height = canvas.width;
  const b = bg.getContext('2d');
  b.scale(dpr, dpr);
  b.fillStyle = 'rgba(8, 14, 20, 0.78)';
  b.beginPath(); b.arc(SIZE / 2, SIZE / 2, MAP.play * k + 2, 0, Math.PI * 2); b.fill();
  b.fillStyle = 'rgba(236, 232, 225, 0.11)';
  for (const t of world.trees) {
    if (Math.hypot(t.x, t.z) > MAP.play) continue;
    b.fillRect(px(t.x) - 0.6, pz(t.z) - 0.6, 1.2, 1.2);
  }
  b.fillStyle = 'rgba(236, 232, 225, 0.32)';
  for (const l of world.landmarks) b.fillRect(px(l.x) - 2.5, pz(l.z) - 2.5, 5, 5);
  // the edge, where the fence is
  b.strokeStyle = 'rgba(255, 70, 85, 0.65)';
  b.lineWidth = 1.5;
  b.beginPath(); b.arc(SIZE / 2, SIZE / 2, MAP.play * k, 0, Math.PI * 2); b.stroke();

  return {
    // you: { x, z, yaw }; taken: [{ x, z }]; left (dev only, F3): the pages still to find, [{ x, z, n }];
    // scans: zones scanned, [{ x, z, r, age (s), color: 'r, g, b' }]; zones: where a missing page
    // is, roughly, [{ x, z, r }]
    draw(me, taken, left = [], scans = [], zones = []) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(bg, 0, 0);
      g.scale(dpr, dpr);
      // page zones: a dashed gold circle, gently pulsing so it's noticed
      const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 400);
      for (const z of zones) {
        g.fillStyle = `rgba(255, 216, 77, ${0.1 * pulse})`;
        g.beginPath(); g.arc(px(z.x), pz(z.z), z.r * k, 0, Math.PI * 2); g.fill();
        g.setLineDash([3, 2.5]);
        g.strokeStyle = `rgba(255, 216, 77, ${0.85 * pulse})`;
        g.lineWidth = 1.3;
        g.stroke();
        g.setLineDash([]);
      }
      // scanned zones: a ring spreads out to the zone's edge, then the zone fades away
      g.save();
      g.beginPath(); g.arc(SIZE / 2, SIZE / 2, MAP.play * k + 2, 0, Math.PI * 2); g.clip(); // (inside the map)
      for (const s of scans) {
        const age = Math.max(0, s.age); // (a scan from this very frame can be a hair in the future)
        const fade = 1 - Math.min(1, age / SCAN_SHOW), grow = Math.min(1, age / SCAN_GROW);
        if (fade <= 0) continue;
        const r = s.r * k * (1 - (1 - grow) ** 3);
        g.fillStyle = `rgba(${s.color}, ${0.16 * fade})`;
        g.beginPath(); g.arc(px(s.x), pz(s.z), r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = `rgba(${s.color}, ${0.85 * fade})`;
        g.lineWidth = grow < 1 ? 2 : 1.2;
        g.stroke();
        g.fillStyle = `rgba(${s.color}, ${fade})`;
        g.beginPath(); g.arc(px(s.x), pz(s.z), 1.6, 0, Math.PI * 2); g.fill();
      }
      g.restore();
      g.fillStyle = 'rgba(236, 232, 225, 0.9)';
      for (const p of taken) {
        g.save(); g.translate(px(p.x), pz(p.z)); g.rotate(Math.PI / 4); g.fillRect(-2.5, -2.5, 5, 5); g.restore();
      }
      g.font = '600 8px Barlow, sans-serif';
      g.textAlign = 'center';
      for (const p of left) {
        g.fillStyle = '#ffd84d';
        g.save(); g.translate(px(p.x), pz(p.z)); g.rotate(Math.PI / 4); g.fillRect(-3.5, -3.5, 7, 7); g.restore();
        g.fillText(p.n, px(p.x), pz(p.z) - 6);
      }
      // the arrow is drawn pointing up (north, -z); turning by -yaw points it where you look
      g.save();
      g.translate(px(me.x), pz(me.z));
      g.rotate(-me.yaw);
      g.fillStyle = '#3fe0c5';
      g.beginPath(); g.moveTo(0, -6); g.lineTo(4.5, 5); g.lineTo(0, 2.5); g.lineTo(-4.5, 5); g.closePath(); g.fill();
      g.restore();
    },
  };
}
