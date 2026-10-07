// The minimap, top left of the HUD: the woods from above, north up. Trees, landmarks, the edge of
// the play area, the pages already taken, and you (an arrow pointing where you look). Never the
// other player, and never the pages still to find: that would spoil the hunt.
import { MAP } from './config.js';

const SIZE = 168; // css px

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
    // you: { x, z, yaw }; taken: [{ x, z }]; left (dev only, F3): the pages still to find, [{ x, z, n }]
    draw(me, taken, left = []) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(bg, 0, 0);
      g.scale(dpr, dpr);
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
