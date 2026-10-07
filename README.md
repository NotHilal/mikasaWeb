# Hunted Treasure

A two-player first-person hide-and-seek in a dark forest. One player, the **Seeker**, has
a flashlight and must find 5 pages pinned to trees. The other, the **Hunter**, is tall,
silent and sees in the dark, and wins by catching the Seeker first: grabbing them three
times (they can break free from the first two).

Built with [Three.js](https://threejs.org) + [Vite](https://vitejs.dev). Players connect
through a small WebSocket relay (`server/relay.mjs`).

## Run locally

```sh
npm install
npm run dev            # game on http://localhost:5180 + relay on :8788
npm run dev -- --host  # same, reachable from other PCs on your Wi-Fi
```

Open the game in two windows (or on two PCs on the same network): one clicks **Create game**,
the other clicks **Join game** and types or pastes the code (**Copy code** in the lobby; **Paste**
also takes the code out of a copied invite link), or opens the invite link (**Copy link**).
The host picks the roles; the other player presses **Ready**, then the host can **Lock in**.
Switching roles asks for Ready again.

Controls (default keys; every action can be bound to any key or mouse button, side buttons
included, in Settings → Controls): mouse to look, WASD to move, Esc to pause.

| Seeker | | Hunter | |
|---|---|---|---|
| Left-click | Classic: 3 rounds, reloads itself in 6 s once empty. Body hit stuns 2 s, headshot 4 s | Q (hold, release) | Teleport up to 14 m (not where the seeker is looking), 20 s cooldown |
| C | Recon dart: 3 scans that reveal the hunter within 30 m, 35 s cooldown | Right-click | Cancel the teleport |
| Q | Flash: blinds the hunter if he faces it or it pops within 4 m, 20 s cooldown | E | Eye: flies up to about 42 m (press again to stop it early), then reveals the seeker within 25 m, 40 s cooldown |
| E | Dash: 7 m burst in the direction you're moving, 12 s cooldown | F | Grab the seeker when close (1.9 m) and facing them, 5 s cooldown |
| F | Take a page | | |
| Space (mash) | Break free when grabbed | | |
| T | Flashlight on/off | | |
| Y | Inspect the gun | | |
| Shift | Sprint | | |
| Space | Jump (about 0.9 m: over rocks and logs) | Space | Jump (about 0.65 m) |

After a stun ends the hunter can't be stunned again for 3 s: the seeker sees a pale shield shimmer around
him (flickering as it runs out). Shots in that time are Resisted. All numbers are in `src/config.js`.

Stuck? After 4 minutes without taking a page (from the start of the round or the last page taken),
"Recon can now find pages" shows, and from then on a dart scan that reaches a page makes the closest
one glow through the trees for 5 s. Only the seeker sees where; the hunter is told a page was revealed.
Taking a page starts the 4 minutes again (`PAGE_HINT` in the config).

**How to play** (main menu) goes through the controls and every ability of both roles, one slide each,
with a short animation, the characters' own pictures (rendered from their 3D models) and the keys
from your own bindings (`src/howto.js`).

The grab (`GRAB` in the config): the seeker is pulled in front of the hunter and has to mash
Break free to fill a bar before time runs out. The first grab is easy (6 presses in 4 s), the
second is hard (16 presses in 4 s, and the bar drains); not getting free in time means caught.
After an escape the seeker is shoved away and the hunter staggers for 1.5 s. The third grab
can't be escaped: he lifts them off the ground and it's over.

When the hunter is close, the seeker's screen fills with static and they hear their heartbeat,
faster the closer he gets, and worse when they're looking right at him (`DREAD` in the config).
After each round a recap shows a map of both players' paths, the pages, the closest call and
a few numbers. Going back to the lobby takes both players' votes ("Back to lobby 1/2", then 2/2).

The pages are somewhere new every round (`PAGE_SPOTS` in the config): 2 on landmarks and 3
nailed to trees anywhere in the woods, at least 28 m apart, facing open ground, and not near
the seeker's start. Both screens pick the same spots from the round's seed. In the dark a page is
only a faint pale shape close by; it takes the flashlight to really see it.

A small map in the top left (`src/minimap.js`) shows the woods, the landmarks, the edge, the
pages you've taken and where you are and face; never the other player or the pages still to find.
The edge itself is a ring of old fence posts with a sagging rope (and a few pale rags), just
beyond where you can walk.

Mouse sensitivity and field of view can be changed in Settings or from the pause menu (Esc),
ambience and footstep volume in Settings, and every key in Settings → Controls (also on the
pause menu). Jump and Break free share Space by default (you can't jump while grabbed).

The background sound is a quiet night forest, all synthesized: a low wind bed with slow gusts,
crickets, a distant owl now and then, and twigs snapping or branches creaking somewhere in the
dark. As the hunter gets closer to the seeker the crickets fall silent and a low drone swells.

If a player loses their connection, the round pauses for both until they're back (up to 60 s),
then carries on where it was. If a player reloads the page, both go back to the lobby (the host
keeps the room). Walking is blocked while the pause menu is open.

## The final duel and the gift

When the seeker finds every page, the vote after the round is for the **Final duel** instead of the
lobby. Iso's ultimate pulls both players into a hexagonal arena of purple energy walls (48 m across, with cover),
high above the forest. Best of 5 (first to 3), both with the Classic and each keeping their character:
150 health; up to 30 m a headshot does 78, the body 26, the legs 22, and further away 66, 22 and 18.
12 rounds, reloads itself in 1.75 s once
empty. Before the first round a 5 s countdown; between rounds a recap (who took it, damage dealt and
taken, hits by zone, shots) with a 5 s countdown. The host decides each round, so two shots at the same
moment can't give it to both. Numbers in `DUEL` (`src/config.js`), code in `src/duel.js`.

- **Iso loses**: both players get *Try again* (both must press it: the best of 5 starts over) or *Main
  menu* (either one takes both players back to the menu).
- **Iso wins**: both press *Continue*. The seeker gets the 5 pages as 5 pieces of a picture to drag
  into place; once it's whole, *Show message* opens the message. The hunter sees how she's getting on.

The picture is `public/gift/picture.jpg` and the message is the 5 parts in `MESSAGE` (one per line), or
`GIFT.message` if set (`src/config.js`, code in `src/gift.js`). Without the picture a placeholder says
where to put it. Any shape of picture works; the pieces are two across the top and three along the bottom.

## Look

A dark, realistic forest with a Valorant-style UI and abilities on top.

The ground, bark, ferns, rocks and the tree stump are scanned assets from
[Poly Haven](https://polyhaven.com) (CC0, public domain), stored in `public/assets/`.
`npm run assets` downloads them again if they're missing. Everything else (trees, grass,
sky, characters, the Classic skin, ability effects, sounds) is generated in code.
Fog, lights and post-processing are in `src/engine.js`; how dark the night is (and how much
better the hunter sees in it) is `LIGHT` in `src/config.js`. It's dark enough that without the
flashlight the seeker sees little more than tree shapes against the sky.

The seeker is Iso, from `public/models/iso.glb` (loaded by `src/iso.js`, posed and given the
Classic in `src/figures.js`). The file is compressed (meshopt geometry, 1024 px WebP textures:
0.7 MB instead of 15 MB). Both characters have a walk cycle made in code, driven by how fast they
move. If the file is missing, the seeker falls back to a simple figure. Keep the game private,
since the model is Riot's.

The hunter is Slenderman, from `public/models/slender.glb` (`src/slender.js`): a compressed copy
(1.4 MB, about 99k vertices, 1024 px WebP textures) of the Sketchfab sculpt in
`models/source/slenderman.glb` (25 MB; `slenderman(1).glb` there is the same model with smaller
textures). The sculpt has no skeleton, so he glides instead of walking, and his tentacles are
moved in the vertex shader: when it loads, everything outside an outline of his body is marked
as tentacle and split into the separate tentacles, and each gets a curl (and a stretch) that
wraps it around the seeker on a grab. Without the file he falls back to a simple figure.
The role cards in the lobby show 3D renders of both characters (`src/portraits.js`).

## Layout

- `src/main.js` – boot, menu / lobby flow, main loop
- `src/match.js` – one round: spawns, pages, position sync, pistol, abilities, stuns, immunity, reveals, grabs, win/lose
- `src/duel.js` – the final duel: the arena, health and damage per hit zone, rounds, recap, best of 5
- `src/gift.js` – the picture puzzle and the message after Iso wins the duel
- `src/howto.js` – the How to play slides and their animations
- `src/engine.js` – renderer, lights, post-processing, dynamic resolution, graphics preset
- `src/world/` – forest generation: `terrain`, `trees` (procedural pines), `props` (ferns,
  rocks, stump, grass), `sky`, `world` (layout, collisions, page spots)
- `src/player.js` – first-person controller (also dash and stun freeze)
- `src/keys.js` – key bindings (remappable, saved with the settings)
- `src/viewmodel.js` – the seeker's first-person pistol (the flashlight shines from its mouth), inspect
  animation, and the hunter's arms when he grabs
- `src/skins/nocturnum.js` – the Nocturnum Classic, 4 colour variants (Settings → Classic skin): the 3D-print
  model in `public/models/nocturnum/` (`top.stl` + `grip.stl`, put back together when it loads) painted by
  projecting the reference picture onto it from the side (`paint.webp`; its pink parts glow). The STL
  originals are in `models/source/nocturnum-stl/`. Without those files, a stand-in traced from the picture.
- `src/effects.js` – Valorant-style ability effects both players see (Sova bolt, Phoenix curveball,
  Jett wind, Fade eye, Omen-like smoke), particles, scans, muzzle flash
- `src/flashlight.js` – the torch and the dust in its beam
- `src/figures.js` – the character models and their walk cycles
- `src/slender.js` – the hunter's Slenderman model and his tentacles
- `src/recap.js` – the end-of-round map and numbers
- `src/audio.js` – synthesized night-forest ambience, footsteps, gun and ability sounds (placed left/right by distance)
- `src/config.js` – gameplay numbers (speeds, reach, catch distance) and the page messages
- `src/net.js`, `server/relay.mjs` – networking (copied from Zey's Sweet Quest, port 8788)
- `tools/` – `shot.mjs` (headless screenshot), `duo.mjs` (two-browser multiplayer test),
  `drop.mjs` (disconnect / reconnect test), `fetch-assets.mjs`

## Testing

With `npm run dev` running:

```sh
node tools/duo.mjs   # create → join → start → jump → page → dread → pistol stun → flash → dart → teleport → eye
                     # → grab, escape ×2 → grab 3 caught → recap → lobby → round 2: no struggling, caught
node tools/drop.mjs  # network blip pauses and resumes the round → closed tab → rejoin → host reload
node tools/final.mjs # how to play → immunity → every page → final duel (damage, rounds, recap, 1-3) → try again
                     # → 3-0 → continue → puzzle → message
node tools/shot.mjs http://localhost:5180/ shots/menu.png
```
