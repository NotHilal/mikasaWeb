// Split's layout, as data: where you can walk (areas, each at a floor height, some indoors under a
// ceiling), the stairs and ropes between the street and the upper level, and the lamps, cover and
// clutter. Everything that isn't an area is building.
//
// Metres; x runs east, z runs south. Attackers (the seeker) start in the south, defenders (the
// hunter) in the north, A is west, B is east, mid between them. The street is at 0, the upper
// level (the heavens, mid top, the screens walkways, defender spawn) at UPPER.
//
// The shapes follow the real map's callouts and flow (A lobby, A main, A ramps, A site, A heaven,
// A screens; mail, mid bottom, mid top, the vent, the sewer; B lobby, B garage, B main, B site,
// B heaven, B screens; both spawns), with distances worked from the game's minimap, so close but
// not exact.

export const BOUNDS = { x0: -56, x1: 56, z0: -62, z1: 62 };
export const UPPER = 3.5;

// [name, x0, z0, x1, z1, floor, kind, ceiling]
// kinds: street (paving), road (asphalt), site (paving, a spike site), indoor, heaven (wooden
// balconies), walkway (indoor, upper), sewer, vent (too low for the hunter to fit)
export const AREAS = [
  // attacker side
  ['Attacker spawn', -14, 44, 14, 58, 0, 'street'],
  ['A lobby street', -48, 40, -14, 50, 0, 'road'],
  ['A lobby', -48, 24, -30, 44, 0, 'street'],
  ['A main', -48, -4, -41, 24, 0, 'street'],
  ['A ramps', -41, -2, -12, 6, 0, 'road'],
  ['B lobby street', 14, 40, 48, 50, 0, 'road'],
  ['B lobby', 30, 24, 48, 44, 0, 'street'],
  ['B main', 41, -4, 48, 24, 0, 'street'],
  ['B garage', 12, -2, 41, 8, 0, 'indoor', 4.2],
  // mid
  ['Mid bottom', -12, -6, 12, 26, 0, 'street'],
  ['Mail', -8, 27, 8, 40, 0, 'indoor', 3.6],
  ['Mail', -2, 26, 2, 27, 0, 'indoor', 3.6],            // its door to mid bottom
  ['Mid spawn path', -2, 40, 2, 44, 0, 'street'],      // and to attacker spawn
  ['Sewer', -30, 30, -8, 34, 0, 'sewer', 3],          // (the hunter, 2.65 m, just fits)
  ['Vent', 8, 30, 30, 32, 0, 'vent', 2.1],
  ['Mid top', -10, -24, 10, -6, UPPER, 'street'],
  ['Mid top', -5, -40, 5, -24, UPPER, 'street'],       // up to defender spawn
  // sites
  ['A site', -52, -32, -28, -4, 0, 'site'],
  ['B site', 28, -32, 52, -4, 0, 'site'],
  ['A screens', -28, -18, -10, -10, UPPER, 'walkway', UPPER + 3],
  ['B screens', 10, -18, 28, -10, UPPER, 'walkway', UPPER + 3],
  // defender side
  ['A heaven', -52, -44, -34, -32, UPPER, 'heaven'],
  ['A back', -34, -50, -14, -42, UPPER, 'street'],
  ['Defender spawn', -14, -60, 14, -40, UPPER, 'street'],
  ['B back', 14, -50, 34, -42, UPPER, 'street'],
  ['B heaven', 34, -44, 52, -32, UPPER, 'heaven'],
];

// stairs: the rectangle they fill, from floor `from` up to `to`, rising towards `up` (n s e w)
export const STAIRS = [
  { x0: -3, z0: -6, x1: 3, z1: 4, from: 0, to: UPPER, up: 'n' },        // mid stairs, up to mid top
  { x0: -38, z0: -32, x1: -34, z1: -24, from: 0, to: UPPER, up: 'n' },  // A site up to A heaven
  { x0: 34, z0: -32, x1: 38, z1: -24, from: 0, to: UPPER, up: 'n' },    // B site up to B heaven
  { x0: -34, z0: -18, x1: -28, z1: -14, from: 0, to: UPPER, up: 'e' },  // A site up to A screens
  { x0: 28, z0: -18, x1: 34, z1: -14, from: 0, to: UPPER, up: 'w' },    // B site up to B screens
];

// ropes from the street up to the upper level: where they hang, and which way the ledge is
export const ROPES = [
  { x: -45, z: -31.4, out: [0, -1], name: 'A rope' },   // A site to A heaven
  { x: 45, z: -31.4, out: [0, -1], name: 'B rope' },    // B site to B heaven
  { x: 7, z: -5.4, out: [0, -1], name: 'Mid rope' },    // mid bottom to mid top
];

// street lamps (on utility poles): x, z, and which way the lamp arm points (radians, 0 = north)
export const LAMPS = [
  [-6, 50, 0], [8, 54, Math.PI],                 // attacker spawn
  [-38, 46, 0], [-24, 42, Math.PI],              // A lobby street
  [-42, 30, Math.PI / 2], [-33, 38, -Math.PI / 2], // A lobby
  [-45, 10, Math.PI / 2],                        // A main
  [-40, -24, Math.PI / 2], [-30, -8, -Math.PI / 2], // A site
  [24, 42, Math.PI], [38, 46, 0],                // B lobby street
  [42, 30, -Math.PI / 2], [33, 38, Math.PI / 2],   // B lobby
  [45, 10, -Math.PI / 2],                        // B main
  [40, -24, -Math.PI / 2], [30, -8, Math.PI / 2],  // B site
  [-9, 12, Math.PI / 2], [9, 20, -Math.PI / 2],    // mid bottom
  [-8, -20, Math.PI / 2],                        // mid top
  [0, -52, 0],                                   // defender spawn
];

// cover (crates, boxes, barriers) the players can hide behind: [x, z, width, depth, height, kind]
// kinds: crate (wooden), metal (steel box), barrier (concrete), stack (crates on a pallet)
export const COVER = [
  // A site: the big boxes in the middle, crates by the walls
  [-40, -18, 2.4, 2.4, 1.9, 'metal'], [-37.6, -18.4, 1.4, 1.4, 1.2, 'crate'],
  [-47, -9, 1.6, 1.6, 1.4, 'crate'], [-46.6, -11, 1.2, 1.2, 1, 'crate'],
  [-31, -27, 3, 1, 1.1, 'barrier'], [-49, -26, 1.6, 1.6, 2, 'stack'],
  [-33, -6.6, 1.4, 1.4, 1.4, 'crate'],
  // B site
  [40, -18, 2.4, 2.4, 1.9, 'metal'], [37.6, -17.6, 1.4, 1.4, 1.2, 'crate'],
  [47, -9, 1.6, 1.6, 1.4, 'crate'], [46.6, -11, 1.2, 1.2, 1, 'crate'],
  [31, -27, 3, 1, 1.1, 'barrier'], [49, -26, 1.6, 1.6, 2, 'stack'],
  [33, -6.6, 1.4, 1.4, 1.4, 'crate'],
  // mid bottom, mid top
  [-7, 4, 1.4, 1.4, 1.3, 'crate'], [8, 14, 1.6, 1.6, 1.5, 'stack'], [-9, 22, 2.6, 0.9, 1.1, 'barrier'],
  [5, -14, 1.4, 1.4, 1.2, 'crate'], [-6, -10, 1.2, 1.2, 1.1, 'crate'],
  // lobbies, mains, spawns
  [-36, 28, 1.6, 1.6, 1.5, 'stack'], [-44, 36, 2.6, 0.9, 1.1, 'barrier'], [-45, 4, 1.2, 1.2, 1, 'crate'],
  [36, 28, 1.6, 1.6, 1.5, 'stack'], [44, 36, 2.6, 0.9, 1.1, 'barrier'], [45, 4, 1.2, 1.2, 1, 'crate'],
  [-20, 45, 1.4, 1.4, 1.2, 'crate'], [20, 45, 1.4, 1.4, 1.2, 'crate'],
  [24, 2, 1.6, 1.6, 1.4, 'crate'], [-24, 2, 2.6, 0.9, 1.1, 'barrier'],
  [-8, -50, 1.4, 1.4, 1.3, 'crate'], [8, -50, 1.4, 1.4, 1.3, 'crate'],
];

// where each player can start: the seeker in attacker spawn, the hunter in defender spawn
export const SPAWNS = {
  seeker: [[-8, 52], [0, 54], [8, 52], [-4, 48], [4, 48]],
  hunter: [[-8, -52], [0, -56], [8, -52], [-4, -46], [4, -46]],
};
