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
