// The minimap, top left of the HUD: the map from above, north up (the map draws itself: see
// world.map), the pages already taken, and you (an arrow pointing where you look). Never the
// other player, and never the pages still to find: that would spoil the hunt.

const SIZE = 168; // css px

export function createMinimap(canvas, world) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(SIZE * dpr);
  const g = canvas.getContext('2d');
  // world x → right, world z → down; the whole play area fits, with a little margin
  const R = world.map.R + 3, k = SIZE / (2 * R);
  const px = (x) => (x + R) * k, pz = (z) => (z + R) * k;

  // the part that never changes, drawn once
  const bg = document.createElement('canvas');
  bg.width = bg.height = canvas.width;
  const b = bg.getContext('2d');
  b.scale(dpr, dpr);
  world.map.draw(b, px, pz, k);

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
