// Gameplay numbers in one place, so balancing doesn't mean hunting through files.

export const MAP = {
  seed: 1337,      // the forest layout (same for every match)
  half: 85,        // the ground runs from -half to +half metres
  play: 74,        // players can't go further than this from the centre
};

export const PAGES = 5;
// Placeholder text for the 5 parts of the message (shown when a page is picked up).
export const MESSAGE = ['Part one', 'Part two', 'Part three', 'Part four', 'Part five'];

export const SEEKER = {
  eye: 1.65,        // camera height (m)
  walk: 3.0,        // m/s
  sprint: 5.4,
  stamina: 6,       // seconds of sprint
  staminaRegen: 0.6,// stamina seconds regained per second
  reach: 2.2,       // how close a page must be to take it
};

export const HUNTER = {
  eye: 2.45,
  walk: 3.9,
  catchDist: 1.4,
};

export const NET_HZ = 20; // position updates per second

// --- abilities ------------------------------------------------------------------
// Seeker: three abilities on cooldowns, plus a pistol.
// The dart and eye scans see through trees (radius only); shots and flashes need a clear line.
export const GUN = {
  ammo: 3,
  reloadMs: 6000,    // once all 3 rounds are fired, the gun reloads by itself in this time
  range: 60,
  bodyStunMs: 2000,  // a body hit freezes the hunter this long
  headStunMs: 4000,  // a headshot
  headCenter: 2.58,  // the hunter's head: a sphere this high above his feet...
  headRadius: 0.24,  // ...this big (generous, so the whole head counts, top included)
  bodyTop: 2.36,     // his body: a cylinder from his feet up to here...
  bodyRadius: 0.34,  // ...this wide
  immuneMs: 3000,    // after a stun ends, the hunter can't be stunned again for this long
};
// cooldowns in seconds
export const DART = { speed: 30, gravity: 6, radius: 30, pulses: 3, pulseGap: 2.2, revealMs: 2000, cooldown: 35 };
export const FLASH = { speed: 15, gravity: 7, fuse: 0.55, range: 30, closeRange: 4, nearPop: 2.5, fullMs: 2200, partialMs: 700, cooldown: 20 };
export const DASH = { distance: 7, time: 0.2, cooldown: 12 };

// Hunter
export const TELEPORT = { range: 14, cooldown: 20, castMs: 1000 /* wind-up before he moves */, seekerView: 50 /* degrees */, seekerViewDist: 45 };
export const EYE = { speed: 16, flight: 1.1, delay: 0.5, radius: 25, revealMs: 3000, cooldown: 40 };
