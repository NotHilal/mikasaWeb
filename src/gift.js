// The gift, once Iso has won the final duel: the pages turn out to be pieces of a picture.
// The seeker drags them into place (a small puzzle); once it's whole, "Open the card" shows it as
// a card that turns over to its back and a scratch-off (GIFT in config.js). The picture is
// GIFT.image; without it, a placeholder says where to put it.
import { GIFT, PAGES } from './config.js';
import { $ } from './ui.js';

// where each piece sits in the picture, as fractions [x, y, w, h]: two rows, the smaller half of
// the pages across the top and the rest along the bottom (7 pages: three on top, four below)
const row = (n, y) => Array.from({ length: n }, (_, i) => [i / n, y, 1 / n, 0.5]);
const REGIONS = [...row(Math.floor(PAGES / 2), 0), ...row(Math.ceil(PAGES / 2), 0.5)];

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

// The card (its screen must already be showing): the picture on the front; a click turns it over
// to the back picture (and back again, unless the click was on the scratch-off). On the back, the
// scratch-off sits over GIFT.scratchArea, and its coating is that same patch of the picture.
// onFlip() the first time it's turned over, onScratched() once the prize shows. send(type, data):
// what she does goes to the other screen ('gc-flip' { flipped }, her scratch strokes 'gs' { pts },
// in fractions of the scratch-off, 'gc-done' once it's off). watch: the hunter's screen, that only
// shows it as her messages say (returns { apply(type, data) }).
export function openCard({ onFlip, onScratched, send, watch = false }) {
  const card = $('#card'), box = $('#scratch'), cv = $('#scratch-cover'), hint = $('#card-hint'), back = $('#card-back-img');
  card.classList.remove('flipped');
  box.classList.remove('revealed');
  hint.classList.remove('gone');
  // no way out until the gift is scratched off
  $('#letter-menu').classList.remove('show');
  const HINT = watch ? { front: 'She is looking at the card', back: 'She is scratching the silver', done: 'She found it ♥' }
    : { front: 'Click the card to turn it over', back: 'Scratch the silver', done: 'For you ♥' };
  hint.textContent = HINT.front;
  const [small, big, sub] = GIFT.prize;
  $('#scratch-prize').innerHTML = `<div>${small ?? ''}</div><div class="amt">${big ?? ''}</div><div class="sub">${sub ?? ''}</div>`;

  let flippedOnce = false, done = false;
  const flip = (to) => {
    card.classList.toggle('flipped', to);
    if (!done) hint.textContent = to ? HINT.back : HINT.front;
    if (to && !flippedOnce) { flippedOnce = true; onFlip?.(); }
  };
  card.style.cursor = watch ? 'default' : '';
  card.onclick = watch ? null : (e) => {
    if (box.contains(e.target)) return;
    flip(!card.classList.contains('flipped'));
    send?.('gc-flip', { flipped: card.classList.contains('flipped') });
  };

  // the scratch-off goes where the back picture has its silver patch (in fractions of the picture,
  // so it stays on it at any size); without the picture, a plain silver patch in the middle
  let pic = null;
  const place = () => {
    const a = GIFT.scratchArea, w = pic?.naturalWidth || 1, h = pic?.naturalHeight || 1;
    const [l, t, bw, bh] = pic ? [a.left / w, a.top / h, a.width / w, a.height / h] : [0.3, 0.55, 0.4, 0.3];
    Object.assign(box.style, { left: `${l * 100}%`, top: `${t * 100}%`, width: `${bw * 100}%`, height: `${bh * 100}%` });
  };
  // the coating, drawn once the card's laid out (the canvas matches the box's real size)
  let g = null, moves = 0;
  const paint = () => {
    const r = box.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!r.width) return;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    g = cv.getContext('2d', { willReadFrequently: true });
    if (pic) {
      const a = GIFT.scratchArea;
      g.drawImage(pic, a.left, a.top, a.width, a.height, 0, 0, cv.width, cv.height);
    } else {
      const grad = g.createLinearGradient(0, 0, cv.width, cv.height);
      grad.addColorStop(0, '#b9bcc2'); grad.addColorStop(0.5, '#eef0f3'); grad.addColorStop(1, '#9fa3aa');
      g.fillStyle = grad;
      g.fillRect(0, 0, cv.width, cv.height);
    }
    g.globalCompositeOperation = 'destination-out';
    g.lineCap = g.lineJoin = 'round';
    g.lineWidth = cv.height * 0.16;
    // (watching: strokes that came before the coating was ready)
    for (const pts of early.splice(0)) strokes(pts);
  };
  const early = [];
  const ready = () => { place(); requestAnimationFrame(() => requestAnimationFrame(paint)); };
  back.onload = () => { pic = back; ready(); };
  back.onerror = () => { pic = null; ready(); };
  back.src = GIFT.back;
  if (back.complete && back.naturalWidth) back.onload();

  // how much of the coating is gone (every 4th pixel's alpha is plenty)
  const cleared = () => {
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let clear = 0, n = 0;
    for (let i = 3; i < d.length; i += 16) { n++; if (d[i] < 40) clear++; }
    return clear / n;
  };
  let last = null;
  const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
  // scratch from the last spot to (x, y) (canvas pixels); a fresh stroke starts a dot
  const line = (x, y) => {
    g.beginPath();
    g.moveTo(...(last ?? [x - 0.1, y]));
    g.lineTo(x, y);
    g.stroke();
    last = [x, y];
  };
  const reveal = () => {
    done = true;
    box.classList.add('revealed');
    hint.textContent = HINT.done;
    setTimeout(() => $('#letter-menu').classList.add('show'), 1500); // (after a moment with it)
    onScratched?.();
  };
  // her strokes, sent in batches (fractions of the scratch-off; null starts a new stroke)
  let batch = [], flushT = null;
  const flush = () => { clearTimeout(flushT); flushT = null; if (batch.length) send?.('gs', { pts: batch }); batch = []; };
  const scratch = (e) => {
    if (!g || done) return;
    const [x, y] = at(e);
    if (!last) batch.push(null);
    line(x, y);
    batch.push([+(x / cv.width).toFixed(4), +(y / cv.height).toFixed(4)]);
    if (!flushT) flushT = setTimeout(flush, 50);
    if (++moves % 8 === 0 && cleared() >= GIFT.scratched) { flush(); send?.('gc-done', {}); reveal(); }
  };
  // watching: her strokes, drawn the same way on my copy
  const strokes = (pts) => {
    if (!g) { early.push(pts); return; }
    for (const p of pts) {
      if (!p) { last = null; continue; }
      line(p[0] * cv.width, p[1] * cv.height);
    }
  };
  if (!watch) {
    cv.onpointerdown = (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); last = null; scratch(e); cv.onpointermove = scratch; };
    cv.onpointerup = cv.onpointercancel = () => { cv.onpointermove = null; last = null; flush(); };
    return null;
  }
  cv.onpointerdown = cv.onpointermove = cv.onpointerup = cv.onpointercancel = null;
  cv.style.cursor = 'default';
  return {
    apply(type, d) {
      if (type === 'gc-flip') flip(!!d.flipped);
      else if (type === 'gs' && !done) strokes(d.pts || []);
      else if (type === 'gc-done' && !done) { if (!card.classList.contains('flipped')) flip(true); reveal(); }
    },
  };
}

// Opens the puzzle screen (it must already be showing). onDone() when it's whole, onRead() when
// the card is opened. send(type, data): what she does goes to the other screen as she does it
// (the tray's order 'gp-order', a piece being dragged 'gp', dropped 'gp-up'; positions in board
// units, so any screen size draws them in the same place). watch: the other screen, the hunter's,
// that only shows it: no dragging, the pieces move as her messages say (apply(type, data)).
// Returns close() (or, watching, { close, apply }).
export async function openPuzzle({ onDone, onRead, send, watch = false }) {
  const root = $('#puzzle'), board = $('#puzzle-board'), tray = $('#puzzle-tray');
  root.querySelectorAll('.piece').forEach((p) => p.remove());
  board.classList.remove('done');
  $('#puzzle-title').textContent = watch ? 'She is putting it together' : 'Put the pieces together';
  $('#puzzle-note').textContent = watch ? 'Watch the pieces come together.' : 'Drag each piece to where it goes.';
  $('#show-msg').classList.remove('show');
  const pic = await loadPicture();
  $('#letter-img').src = pic.src;

  // pieces in a shuffled order in the tray (watching: hers, once it comes)
  let order = REGIONS.map((_, i) => i).sort(() => Math.random() - 0.5);
  if (!watch) send?.('gp-order', { order });
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
  // a spot on the screen ↔ in board units (0..1 across and down the board)
  const toBoard = (x, y) => { const r = root.getBoundingClientRect(), b = board.getBoundingClientRect(); return [(x - (b.left - r.left)) / bw, (y - (b.top - r.top)) / bh]; };
  const fromBoard = ([u, v]) => { const r = root.getBoundingClientRect(), b = board.getBoundingClientRect(); return [b.left - r.left + u * bw, b.top - r.top + v * bh]; };
  // a piece dropped: in its place, or back to the tray
  const drop = (p, placed) => {
    p.el.classList.remove('drag');
    if (placed) {
      p.placed = true;
      p.el.classList.add('placed');
      put(p, slot(p).x, slot(p).y, 1);
      if (pieces.every((q) => q.placed)) complete();
    } else {
      p.el.classList.add('wrong');
      setTimeout(() => p.el.classList.remove('wrong'), 400);
      home(p);
    }
  };

  // dragging (not when watching)
  let lastSent = 0, trailing = null;
  for (const p of pieces) {
    if (watch) { p.el.style.cursor = 'default'; continue; }
    p.el.onpointerdown = (e) => {
      if (p.placed) return;
      e.preventDefault();
      p.el.setPointerCapture(e.pointerId);
      // keep the same spot of the piece under the pointer as it grows back to full size
      const rx = (e.clientX - root.getBoundingClientRect().left - p.x) / (p.w * p.s);
      const ry = (e.clientY - root.getBoundingClientRect().top - p.y) / (p.h * p.s);
      p.el.classList.add('drag');
      const move = (ev, force = false) => {
        const r = root.getBoundingClientRect();
        put(p, ev.clientX - r.left - rx * p.w, ev.clientY - r.top - ry * p.h, 1);
        // (to the other screen, about 25 times a second, and always where it ends up when she pauses)
        const t = performance.now(), sendNow = () => { lastSent = performance.now(); trailing = null; send?.('gp', { i: p.n, at: toBoard(p.x, p.y) }); };
        clearTimeout(trailing);
        if (force || t - lastSent > 40) sendNow();
        else trailing = setTimeout(sendNow, 40 - (t - lastSent));
      };
      move(e, true);
      p.el.onpointermove = move;
      p.el.onpointerup = p.el.onpointercancel = () => {
        p.el.onpointermove = p.el.onpointerup = p.el.onpointercancel = null;
        clearTimeout(trailing); trailing = null;
        const to = slot(p);
        // close enough to its place: it snaps in; anywhere else: back to the tray
        const placed = Math.hypot(p.x - to.x, p.y - to.y) < Math.max(36, Math.min(p.w, p.h) * 0.3);
        send?.('gp-up', { i: p.n, placed });
        drop(p, placed);
      };
    };
  }

  function complete() {
    board.classList.add('done');
    $('#puzzle-title').textContent = 'Complete';
    $('#puzzle-note').textContent = watch ? 'Every piece is in its place. Now the card…' : 'Every piece is in its place.';
    if (!watch) setTimeout(() => $('#show-msg').classList.add('show'), 700);
    onDone?.();
  }

  $('#show-msg').onclick = () => onRead?.();
  $('#card').style.setProperty('--aspect', pic.aspect);

  layout();
  // (the first layout can run before the screen has its size)
  requestAnimationFrame(layout);
  const onResize = () => layout();
  addEventListener('resize', onResize);
  const close = () => removeEventListener('resize', onResize);
  if (!watch) return close;

  // watching: her moves, as they come
  const apply = (type, d) => {
    const p = pieces[d.i];
    if (type === 'gp-order') { order = d.order; layout(); }
    else if (type === 'gp' && p && !p.placed) {
      p.el.classList.add('drag');
      p.el.style.transition = 'transform 60ms linear'; // (smooth between her updates)
      const [x, y] = fromBoard(d.at);
      put(p, x, y, 1);
    } else if (type === 'gp-up' && p && !p.placed) { p.el.style.transition = ''; drop(p, d.placed); }
  };
  return { close, apply };
}
