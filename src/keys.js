// Key bindings: which key or mouse button does each action. Remappable in Settings → Controls
// and saved with the other settings. Keys are KeyboardEvent.code values ('KeyW', 'Space', …), so
// they stay on the same physical key whatever the keyboard layout; mouse buttons are 'Mouse0'
// (left), 'Mouse1' (middle), 'Mouse2' (right), 'Mouse3' / 'Mouse4' (the side buttons).
import { settings, saveSettings } from './settings.js';

// [id, label, group, default key]
export const ACTIONS = [
  ['forward', 'Move forward', 'Movement', 'KeyW'],
  ['back', 'Move back', 'Movement', 'KeyS'],
  ['left', 'Move left', 'Movement', 'KeyA'],
  ['right', 'Move right', 'Movement', 'KeyD'],
  ['sprint', 'Sprint', 'Movement', 'ShiftLeft'],
  ['jump', 'Jump', 'Movement', 'Space'],
  ['shoot', 'Shoot', 'Seeker', 'Mouse0'],
  ['take', 'Take page', 'Seeker', 'KeyF'],
  ['light', 'Flashlight on/off', 'Seeker', 'KeyT'],
  ['inspect', 'Inspect gun', 'Seeker', 'KeyY'],
  ['dart', 'Recon dart', 'Seeker', 'KeyC'],
  ['flash', 'Flash', 'Seeker', 'KeyQ'],
  ['dash', 'Dash', 'Seeker', 'KeyE'],
  ['escape', 'Break free (mash)', 'Seeker', 'Space'],
  ['teleport', 'Teleport (hold)', 'Hunter', 'KeyQ'],
  ['cancelTp', 'Cancel teleport', 'Hunter', 'Mouse2'],
  ['eye', 'Eye', 'Hunter', 'KeyE'],
  ['grab', 'Grab', 'Hunter', 'KeyF'],
];
const GROUP = Object.fromEntries(ACTIONS.map(([id, , group]) => [id, group]));
export const DEFAULT_KEYS = Object.fromEntries(ACTIONS.map(([id, , , key]) => [id, key]));

// fill in actions missing from saved settings (older saves, or actions added later)
settings.keys = { ...DEFAULT_KEYS, ...settings.keys };

export const key = (id) => settings.keys[id];
export const mouseCode = (button) => `Mouse${button}`;
export const pressed = (keys, id) => keys.has(settings.keys[id]);

// Seeker and hunter keys can share a key (you're only ever one of them); movement can't
// share with anything, except that Jump and Break free can (you can't jump while grabbed).
const SHARE = new Set(['jump escape', 'escape jump']);
const clash = (a, b) => a !== b && !SHARE.has(`${a} ${b}`)
  && (GROUP[a] === 'Movement' || GROUP[b] === 'Movement' || GROUP[a] === GROUP[b]);

// the action this key does for this role, if any
export function actionFor(code, role) {
  const group = role === 'seeker' ? 'Seeker' : 'Hunter';
  return ACTIONS.find(([id, , g]) => (g === group || g === 'Movement') && settings.keys[id] === code)?.[0] ?? null;
}

// bind a key in `keys` (a draft copy being edited in Controls); an action that clashes with it
// takes this action's old key (a swap)
export function bindIn(keys, id, code) {
  const old = keys[id];
  for (const [other] of ACTIONS) if (clash(id, other) && keys[other] === code) keys[other] = old;
  keys[id] = code;
}

// make a draft the bindings in use, and remember them
export function saveKeys(keys) {
  settings.keys = { ...keys };
  saveSettings();
}


// how a key is written on screen: 'KeyQ' → 'Q', 'ShiftLeft' → 'L-Shift', 'ArrowUp' → '↑'
const NAMES = {
  Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  BrowserBack: 'Mouse back', BrowserForward: 'Mouse forward', // side buttons sent as keys by some mouse software
  Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Tab: 'Tab', CapsLock: 'Caps', Enter: 'Enter', Backspace: 'Bksp', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Comma: ',', Period: '.', Slash: '/',
};
export function keyLabel(code) {
  if (!code) return '–';
  if (NAMES[code]) return NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}
export const label = (id) => keyLabel(settings.keys[id]);
