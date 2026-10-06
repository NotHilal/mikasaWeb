// Small DOM helpers for the overlay screens.
export const $ = (sel) => document.querySelector(sel);

let current = null;
export function show(id) {
  document.querySelectorAll('.screen.show').forEach((s) => { if (s.id !== 'hud') s.classList.remove('show'); });
  if (id) $(`#${id}`).classList.add('show');
  current = id;
}
export const screen = () => current;

export function hud(on) { $('#hud').classList.toggle('show', on); }

let toastTimer = 0;
export function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// show an element briefly (adds .show, removes it after ms)
const flashTimers = new Map();
export function flash(el, ms) {
  el.classList.add('show');
  clearTimeout(flashTimers.get(el));
  flashTimers.set(el, setTimeout(() => el.classList.remove('show'), ms));
}
