// Player settings, remembered in this browser.
const KEY = 'woods-settings';
// quality: 'auto' picks low on integrated graphics and high otherwise (see engine.js)
// skin: colour variant of the Classic (see skins/nocturnum.js)
// fov: vertical field of view in degrees (72 vertical is about 105 horizontal on a 16:9 screen)
// steps, ambience: footstep and background volume (0..1); keys: key bindings (see keys.js)
const defaults = { quality: 'auto', sensitivity: 1, volume: 0.8, skin: 'red', fov: 72, steps: 0.6, ambience: 0.6, keys: {} };

function load() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...defaults }; }
}

export const settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
}
