// Gameplay numbers in one place, so balancing doesn't mean hunting through files.

export const MAP = {
  seed: 1337,      // the forest layout (same for every match)
  half: 85,        // the ground runs from -half to +half metres
  play: 74,        // players can't go further than this from the centre
};

export const PAGES = 7;
// Where pages go, different every round (from the round's seed, so the same on both screens):
// a few on landmarks, the rest nailed to trees anywhere in the woods, spread out, facing open
// ground, and not right where the seeker starts.
export const PAGE_SPOTS = {
  landmarks: 2,      // how many of the pages are on landmarks
  apart: 28,         // metres between any two pages (relaxed if the forest can't fit them)
  fromSeeker: 25,    // metres from the seeker's start
  height: 1.45,      // on a tree: how high up the trunk
};
// Placeholder text for the 7 parts of the message (shown when a page is picked up), one per page.
export const MESSAGE = ['Part one', 'Part two', 'Part three', 'Part four', 'Part five', 'Part six', 'Part seven'];
// The gift at the very end (Iso wins the final duel): the seeker puts the 7 pieces of `image`
// together. Without the image file, a placeholder picture says where to put it.
// Then the card opens: `image` on the front; clicked, it turns over to `back`, where a scratch-off
// over `scratchArea` hides `prize` (its lines: the first small, the second big, the third handwritten).
export const GIFT = {
  image: 'gift/picture.jpg',   // in public/
  back: 'gift/back.jpg',       // in public/, the same size as `image`
  scratchArea: { left: 525, top: 564, width: 615, height: 261 }, // in `back`'s pixels: inside its red frame
  prize: ['A tiny', '200 €', 'Amazon gift card for your monitor c:'],
  scratched: 0.5,              // how much has to be scratched off before it all comes off
};

// The jumpscare each time the seeker is grabbed (only the seeker sees it): the view rushes up to
// his face, his head tips over to the side, and `sound` plays. Without the file, a made-up shriek
// plays. Breaking free starts after it (the escape time in GRAB doesn't count it).
export const SCARE = {
  sound: 'sounds/jumpscare.mp3', // in public/
  volume: 1,
  ms: 1600,         // how long it lasts
  dist: 0.75,       // how close his face comes (m)
  rushMs: 140,      // how fast the view gets there
  fovDrop: 10,      // degrees the view narrows (his head fills the screen)
};

// Crouching (hold the key, both players): you stand `height` as tall (your view, how the other
// player sees you, and in the duel your hitbox), move at `speed` × your walk, and can't sprint or jump.
export const CROUCH = { height: 0.65, speed: 0.45 };
// Walking quietly (hold the key): `speed` × your walk, no sprinting, and your footsteps make no
// sound (landing from a jump still does). Who can: Iso in the hunt (SEEKER.quiet), both in the duel.
export const QUIET = { speed: 0.5 };

export const SEEKER = {
  eye: 1.65,        // camera height (m)
  walk: 3.0,        // m/s
  sprint: 5.4,
  stamina: 6,       // seconds of sprint
  staminaRegen: 0.6,// stamina seconds regained per second
  recover: 0.35,    // after running it empty, sprinting comes back once the bar is this full
  reach: 2.2,       // how close a page must be to take it
  jump: 5.7,        // take-off speed (m/s): about 0.9 m high
  quiet: true,      // can walk quietly (QUIET)
};

export const HUNTER = {
  eye: 2.45,
  walk: 3.9,
  jump: 4.8,        // about 0.65 m: he's tall, not agile
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
// The final duel (after the seeker finds every page): Iso's ultimate pulls both players into an
// arena; best of 5, both with the Classic. Each keeps their character; hitboxes are measured from
// the feet: the head a sphere [height, radius], body and legs upright cylinders [from, to, radius].
export const DUEL = {
  firstTo: 3,
  hp: 150,
  // damage by distance, like the real Classic: up to 30 m, then 30 to 50 m (and past that, which
  // only the arena's far corners allow)
  damage: [
    { upTo: 30, head: 78, body: 26, legs: 22 },
    { upTo: Infinity, head: 66, body: 22, legs: 18 },
  ],
  ammo: 12,
  reloadMs: 1750,    // reloads by itself once empty
  fireMs: 150,       // the fastest it fires (it's semi-automatic)
  range: 80,
  introMs: 5000,     // the countdown before the first round
  betweenMs: 5000,   // the recap and countdown between rounds
  endMs: 2500,       // after the deciding round, before the result screen
  // the same for both. The jump (take-off speed, m/s) is much higher than in the woods: 2 m
  // (√(2 × 18 × 2)), so both can get up on the arena's 1.6 m blocks, not the taller pillars
  move: { walk: 5, jump: 8.49, quiet: true }, // (both can walk quietly in the duel)
  hitbox: {
    seeker: { head: [1.64, 0.14], body: [0.95, 1.52, 0.25], legs: [0.05, 0.95, 0.2] },
    hunter: { head: [GUN.headCenter, GUN.headRadius], body: [1.3, GUN.bodyTop, GUN.bodyRadius], legs: [0.1, 1.3, 0.28] },
  },
  // a hexagon (apothem: metres from the centre to each side), high above the forest, out of sight of it
  arena: { y: 400, apothem: 24, wall: 9 },
};

// cooldowns in seconds
export const DART = { speed: 30, gravity: 6, radius: 30, pulses: 3, pulseGap: 2.2, revealMs: 2000, cooldown: 35 };
// Stuck? After `afterMs` without taking a page (from the round's start or the last page taken), the
// dart's scans also find pages: the closest one in range glows through the trees for `revealMs`
// (on the seeker's screen only; the hunter is told a page was revealed, not where).
export const PAGE_HINT = { afterMs: 240000, revealMs: 5000 };
// And once the round has run `afterMs` (12 minutes), both players' minimaps circle every page still
// missing (the same circles on both): 2 × `radius` metres across (40 m), the page anywhere inside
// it, any spot as likely as any other (up to `offset` of the radius from the middle: 0.95, so not
// right on the line). A circle goes once its page is taken.
export const PAGE_ZONES = { afterMs: 12 * 60000, radius: 20, offset: 0.95 };
export const FLASH = { speed: 15, gravity: 7, fuse: 0.55, range: 30, closeRange: 4, nearPop: 2.5, fullMs: 2200, partialMs: 700, cooldown: 20 };
export const DASH = { distance: 7, time: 0.2, cooldown: 12 };

// Hunter
export const TELEPORT = { range: 14, cooldown: 20, castMs: 1000 /* wind-up before he moves */, seekerView: 50 /* degrees */, seekerViewDist: 45 };
// eye: flies up to speed × flight metres (about 42 m); pressing Eye again while it flies stops it there
export const EYE = { speed: 16, flight: 2.6, delay: 0.5, radius: 25, revealMs: 3000, cooldown: 40 };

// The seeker's dread: screen static and a heartbeat as the hunter gets close (Slender-style).
// Static starts at `far` metres and is strongest at `near`; looking right at him adds `seen`.
export const DREAD = { far: 18, near: 3, static: 0.22, seen: 0.28, seenDist: 25, beatSlow: 1.05, beatFast: 0.42 };

// The hunter's grab: get close, face the seeker and press Grab. Grabs 1 and 2 can be escaped by
// mashing Break free: fill the bar (`presses`) before `time` runs out; it drains by `drain`
// presses a second. Grab 2 is much harder. Grab number `kill` can't be escaped: caught.
export const GRAB = {
  range: 1.9,          // metres (centre to centre, on the ground)
  angle: 70,           // degrees either side of where the hunter is looking
  escape: [
    { presses: 6, time: 4, drain: 0.5 },  // 1st grab: easy
    { presses: 16, time: 4, drain: 2.5 }, // 2nd grab: mash hard (about 6 presses a second)
  ],
  kill: 3,
  holdDist: 0.85,      // the seeker is pulled this close, in front of him
  killMs: 1800,        // the last grab: how long he holds them up before it's over
  shoveMs: 1500,       // after an escape the hunter staggers (can't move) this long...
  shoveDist: 3.5,      // ...while the seeker is pushed this far away
  cooldown: 5,         // seconds before he can grab again
};

// How dark the night is. Kept low so the seeker needs the flashlight to see much more than
// shapes; the flashlight itself isn't affected. The hunter sees in the dark: his ambient light
// is brighter than the seeker's, but still dim.
export const LIGHT = {
  ambient: 0.25,       // sky glow, everywhere (was 1.0)
  moon: 0.12,          // moonlight, with its soft shadows (was 0.75)
  fog: 0x06080b,       // the colour far things fade into: nearly black (was 0x0d1117)
  hunterAmbient: 1.8,  // the hunter's night vision: sky glow... (was 2.2)
  hunterMoon: 0.5,     // ...and moonlight (the seeker gets `moon`)
  weapon: 1.3,         // light on the seeker's own pistol only (the world stays dark), before the torch's bounce
};
