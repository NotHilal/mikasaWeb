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

Controls: mouse to look, WASD to move, Esc to pause.

| Seeker | | Hunter | |
|---|---|---|---|
| Left-click | Classic: 3 rounds, reloads itself in 6 s once empty. Body hit stuns 2 s, headshot 4 s | Q (hold, release) | Teleport up to 14 m (not where the seeker is looking), 20 s cooldown |
| C | Recon dart: 2 scans that reveal the hunter within 30 m, 35 s cooldown | Right-click | Cancel the teleport |
| Q | Flash: blinds the hunter if he faces it or it pops within 4 m, 20 s cooldown | E | Eye: reveals the seeker within 25 m, 40 s cooldown |
| E | Dash: 7 m burst in the direction you're moving, 12 s cooldown | | |
| F | Take a page | | |
| T | Flashlight on/off | | |
| Y | Inspect the gun | | |
| Shift | Sprint | | |

After a stun ends the hunter can't be stunned again for 3 s. All numbers are in `src/config.js`.

## Look

A dark, realistic forest with a Valorant-style UI and abilities on top.

The ground, bark, ferns, rocks and the tree stump are scanned assets from
[Poly Haven](https://polyhaven.com) (CC0, public domain), stored in `public/assets/`.
`npm run assets` downloads them again if they're missing. Everything else (trees, grass,
sky, characters, the Classic skin, ability effects, sounds) is generated in code.
Fog, lights and post-processing are in `src/engine.js`.

The seeker is Iso, from `public/models/iso.glb` (loaded by `src/iso.js`, posed and given the
Classic in `src/figures.js`). It's a static pose, with no animation yet. If the file is missing,
the seeker falls back to a simple figure. Keep the game private, since the model is Riot's.
The role cards in the lobby show 3D renders of both characters (`src/portraits.js`).

## Layout

- `src/main.js` – boot, menu / lobby flow, main loop
- `src/match.js` – one round: spawns, pages, position sync, pistol, abilities, stuns, reveals, catching, win/lose
- `src/engine.js` – renderer, lights, post-processing, dynamic resolution, graphics preset
- `src/world/` – forest generation: `terrain`, `trees` (procedural pines), `props` (ferns,
  rocks, stump, grass), `sky`, `world` (layout, collisions, page spots)
- `src/player.js` – first-person controller (also dash and stun freeze)
- `src/viewmodel.js` – the seeker's first-person pistol (the flashlight shines from its mouth), inspect animation
- `src/skins/nocturnum.js` – our Nocturnum-inspired Classic, 4 colour variants (Settings → Classic skin)
- `src/effects.js` – Valorant-style ability effects both players see (Sova bolt, Phoenix curveball,
  Jett wind, Fade eye, Omen-like smoke), particles, scans, muzzle flash
- `src/flashlight.js` – the torch and the dust in its beam
- `src/figures.js` – placeholder character models (no animation yet)
- `src/audio.js` – synthesized wind, footsteps, gun and ability sounds (placed left/right by distance)
- `src/config.js` – gameplay numbers (speeds, reach, catch distance) and the page messages
- `src/net.js`, `server/relay.mjs` – networking (copied from Zey's Sweet Quest, port 8788)
- `tools/` – `shot.mjs` (headless screenshot), `duo.mjs` (two-browser multiplayer test),
  `fetch-assets.mjs`

## Testing

With `npm run dev` running:

```sh
node tools/duo.mjs   # create → join → start → page → pistol stun → flash → dart → teleport → eye → catch → lobby
node tools/shot.mjs http://localhost:5180/ shots/menu.png
```
