// The gift, once Iso has won the final duel: the 5 pages turn out to be 5 pieces of a picture.
// The seeker drags them into place (a small puzzle); once it's whole, "Show message" opens the
// message (GIFT in config.js). The picture is GIFT.image; without it, a placeholder says where
// to put it.
import { GIFT, MESSAGE, PAGES } from './config.js';
import { $ } from './ui.js';

// where each piece sits in the picture, as fractions: two across the top, three along the bottom
const REGIONS = [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 1 / 3, 0.5], [1 / 3, 0.5, 1 / 3, 0.5], [2 / 3, 0.5, 1 / 3, 0.5]].slice(0, PAGES);

export const giftMessage = () => GIFT.message ?? MESSAGE.join('\n');

function placeholder() {
  const cv = document.createElement('canvas');
  cv.width = 1200; cv.height = 800;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1200, 800);
  grad.addColorStop(0, '#2a1650');
  grad.addColorStop(0.55, '#7b2f8f');
  grad.addColorStop(1, '#ff4655');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1200, 800);
  // a big soft heart, so the pieces are easy to tell apart
  g.fillStyle = 'rgba(255, 235, 240, 0.85)';
  g.beginPath();
  g.moveTo(600, 640);
  g.bezierCurveTo(250, 420, 330, 150, 600, 300);
  g.bezierCurveTo(870, 150, 950, 420, 600, 640);
  g.fill();
  g.fillStyle = 'rgba(255, 255, 255, 0.9)';
  g.font = '600 34px Barlow, sans-serif';
  g.textAlign = 'center';
  g.fillText(`Your picture goes in public/${GIFT.image}`, 600, 740);
  return cv.toDataURL('image/jpeg', 0.9);
}

function loadPicture() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ src: img.src, aspect: img.naturalWidth / img.naturalHeight });
    img.onerror = () => resolve({ src: placeholder(), aspect: 1.5 });
    img.src = GIFT.image;
  });
}

// Opens the puzzle screen (it must already be showing). onDone() when it's whole, onRead() when
// the message is opened.
export async function openPuzzle({ onDone, onRead }) {
  const root = $('#puzzle'), board = $('#puzzle-board'), tray = $('#puzzle-tray');
  root.querySelectorAll('.piece').forEach((p) => p.remove());
  board.classList.remove('done');
  $('#puzzle-title').textContent = 'Put the pieces together';
  $('#puzzle-note').textContent = 'Drag each piece to where it goes.';
  $('#show-msg').classList.remove('show');
  const pic = await loadPicture();
  $('#letter-img').src = pic.src;

  // pieces in a shuffled order in the tray
  const order = REGIONS.map((_, i) => i).sort(() => Math.random() - 0.5);
  const pieces = REGIONS.map((reg, i) => {
    const el = document.createElement('div');
    el.className = 'piece';
    el.innerHTML = `<span class="pn">${i + 1}</span>`;
    root.appendChild(el);
    return { el, reg, n: i, placed: false, x: 0, y: 0, s: 1 };
  });

  let bw = 0, bh = 0, traySlots = [];
  // size the board to the screen and put every piece where it belongs (its slot, or the tray)
  function layout() {
    const r = root.getBoundingClientRect();
    bw = Math.min(620, r.width * 0.86, (r.height - 330) * pic.aspect);
    bw = Math.max(200, bw);
    bh = bw / pic.aspect;
    board.style.width = `${bw}px`;
    board.style.height = `${bh}px`;
    board.style.backgroundImage = `url("${pic.src}")`;
    // the tray: a row of scaled-down pieces under the board
    const s = Math.min(0.5, (r.width * 0.92) / pieces.reduce((w, p) => w + p.reg[2] * bw + 16, 0));
    tray.style.height = `${bh * 0.5 * s + 16}px`;
    const tr = tray.getBoundingClientRect();
    let x = tr.left - r.left + (tr.width - pieces.reduce((w, p) => w + p.reg[2] * bw * s + 12, -12)) / 2;
    traySlots = [];
    for (const i of order) {
      const p = pieces[i];
      traySlots[i] = { x, y: tr.top - r.top + 8, s };
      x += p.reg[2] * bw * s + 12;
    }
    for (const p of pieces) {
      const [fx, fy, fw, fh] = p.reg;
      p.w = fw * bw; p.h = fh * bh;
      Object.assign(p.el.style, {
        width: `${p.w}px`, height: `${p.h}px`,
        backgroundImage: `url("${pic.src}")`, backgroundSize: `${bw}px ${bh}px`, backgroundPosition: `${-fx * bw}px ${-fy * bh}px`,
      });
      if (p.placed) put(p, slot(p).x, slot(p).y, 1); else home(p);
    }
  }
  // where a piece goes on the board, in the screen's coordinates
  function slot(p) {
    const r = root.getBoundingClientRect(), b = board.getBoundingClientRect();
    return { x: b.left - r.left + p.reg[0] * bw, y: b.top - r.top + p.reg[1] * bh };
  }
  function put(p, x, y, s) {
    Object.assign(p, { x, y, s });
    p.el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  }
  const home = (p) => { const t = traySlots[p.n]; put(p, t.x, t.y, t.s); };

  // dragging
  for (const p of pieces) {
    p.el.onpointerdown = (e) => {
      if (p.placed) return;
      e.preventDefault();
      p.el.setPointerCapture(e.pointerId);
      // keep the same spot of the piece under the pointer as it grows back to full size
      const rx = (e.clientX - root.getBoundingClientRect().left - p.x) / (p.w * p.s);
      const ry = (e.clientY - root.getBoundingClientRect().top - p.y) / (p.h * p.s);
      p.el.classList.add('drag');
      const move = (ev) => {
        const r = root.getBoundingClientRect();
        put(p, ev.clientX - r.left - rx * p.w, ev.clientY - r.top - ry * p.h, 1);
      };
      move(e);
      p.el.onpointermove = move;
      p.el.onpointerup = p.el.onpointercancel = () => {
        p.el.onpointermove = p.el.onpointerup = p.el.onpointercancel = null;
        p.el.classList.remove('drag');
        const to = slot(p);
        // close enough to its place: it snaps in; anywhere else: back to the tray
        if (Math.hypot(p.x - to.x, p.y - to.y) < Math.max(36, Math.min(p.w, p.h) * 0.3)) {
          p.placed = true;
          p.el.classList.add('placed');
          put(p, to.x, to.y, 1);
          if (pieces.every((q) => q.placed)) complete();
        } else {
          p.el.classList.add('wrong');
          setTimeout(() => p.el.classList.remove('wrong'), 400);
          home(p);
        }
      };
    };
  }

  function complete() {
    board.classList.add('done');
    $('#puzzle-title').textContent = 'Complete';
    $('#puzzle-note').textContent = 'Every piece is in its place.';
    setTimeout(() => $('#show-msg').classList.add('show'), 700);
    onDone?.();
  }

  $('#show-msg').onclick = () => {
    $('#letter-text').textContent = giftMessage();
    onRead?.();
  };

  layout();
  // (the first layout can run before the screen has its size)
  requestAnimationFrame(layout);
  const onResize = () => layout();
  addEventListener('resize', onResize);
  return () => removeEventListener('resize', onResize);
}
