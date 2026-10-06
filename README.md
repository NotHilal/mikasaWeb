# The Woods

A two-player first-person hide-and-seek in a dark forest. One player, the **Seeker**, has
a flashlight and must find 5 pages pinned to trees. The other, the **Hunter**, is tall,
silent and sees in the dark, and wins by catching the Seeker first.

Built with [Three.js](https://threejs.org) + [Vite](https://vitejs.dev). Players connect
through a small WebSocket relay (`server/relay.mjs`).

## Run locally

```sh
npm install
npm run dev            # game on http://localhost:5180 + relay on :8788
npm run dev -- --host  # same, reachable from other PCs on your Wi-Fi
```

Open the game in two windows (or on two PCs on the same network): one clicks **Create game**,
the other clicks **Join game** and types the code, or opens the invite link.
The host picks the roles and presses **Start**.

Controls: mouse to look, WASD to move, Shift to sprint (Seeker), F for the flashlight,
E or left-click to take a page, Esc to pause.

## Assets

The ground, bark, ferns, rocks and the tree stump are scanned assets from
[Poly Haven](https://polyhaven.com) (CC0, public domain), stored in `public/assets/`.
`npm run assets` downloads them again if they're missing. Everything else (trees, grass,
sky, characters, pages, sounds) is generated in code.

## Layout

- `src/main.js` – boot, menu / lobby flow, main loop
- `src/match.js` – one round: spawns, pages, position sync, catching, win/lose
- `src/engine.js` – renderer, lights, post-processing, dynamic resolution, graphics preset
- `src/world/` – forest generation: `terrain`, `trees` (procedural pines), `props` (ferns,
  rocks, grass), `sky`, `world` (layout, collisions, page spots)
- `src/player.js` – first-person controller
- `src/flashlight.js` – the torch and the dust in its beam
- `src/figures.js` – placeholder character models (no animation yet)
- `src/audio.js` – synthesized wind, footsteps, page sound
- `src/config.js` – gameplay numbers (speeds, reach, catch distance) and the page messages
- `src/net.js`, `server/relay.mjs` – networking (copied from Zey's Sweet Quest, port 8788)
- `tools/` – `shot.mjs` (headless screenshot), `duo.mjs` (two-browser multiplayer test),
  `fetch-assets.mjs`

## Testing

With `npm run dev` running:

```sh
node tools/duo.mjs                                 # create → join → start → page → catch → lobby
node tools/shot.mjs http://localhost:5180/ shots/menu.png
```
