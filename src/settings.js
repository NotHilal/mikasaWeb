// Player settings, remembered in this browser.
const KEY = 'woods-settings';
// quality: 'auto' picks low on integrated graphics and high otherwise (see engine.js)
const defaults = { quality: 'auto', sensitivity: 1, volume: 0.8 };

function load() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...defaults }; }
}

export const settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
}
