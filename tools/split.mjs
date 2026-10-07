// Level 2 (Split), played on one screen: walking into walls, up the mid stairs, off a ledge, up a
// rope, the vent (the seeker fits, the hunter doesn't), the pages, shots against walls, and how
// fast it draws. Needs `npm run dev` running.   node tools/split.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { CHROME } from './browser.mjs';

const BASE = process.argv[2] || 'http://localhost:5180/';
await mkdir('shots', { recursive: true });
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 960, height: 540 });
p.on('pageerror', (e) => console.log('pageerror', e.message));
let ok = true;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) ok = false; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await p.goto(BASE, { waitUntil: 'networkidle0' });
  await p.waitForFunction('window.__game');
  await p.waitForFunction(() => window.__game.split, { timeout: 60000 });
  // headless can't capture the mouse: pretend it's captured, so the keys move the player
  await p.evaluate(() => Object.defineProperty(document, 'pointerLockElement', { get: () => document.querySelector('#view canvas'), configurable: true }));

  const start = (role) => p.evaluate((role) => {
    const g = window.__game;
    g.lobby.host = true; g.lobby.hostRole = role;
    g.startMatch(12345, 2);
  }, role);
  // stand at (x, z) facing yaw, hold `keys` for ms, and say where it ended up
  const walk = async (x, z, yaw, ms, keys = ['KeyW']) => {
    await p.evaluate(({ x, z, yaw }) => {
      const g = window.__game, pl = g.player;
      pl.pos.set(x, g.match.world.heightAt(x, z), z);
      pl.air = 0; pl.vy = 0; pl.eyeY = pl.pos.y + pl.stats.eye; pl.yaw = yaw; pl.pitch = 0; pl.vel.set(0, 0, 0);
    }, { x, z, yaw });
    await sleep(100);
    for (const k of keys) await p.keyboard.down(k === 'KeyW' ? 'w' : k === 'Space' ? ' ' : k);
    await sleep(ms);
    for (const k of keys) await p.keyboard.up(k === 'KeyW' ? 'w' : k === 'Space' ? ' ' : k);
    await sleep(600);
    return p.evaluate(() => { const q = window.__game.player.pos; return { x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2) }; });
  };
  const N = 0, S = Math.PI, E = -Math.PI / 2, W = Math.PI / 2; // yaw: forward is (-sin yaw, -cos yaw)

  await start('seeker');
  await sleep(1500);
  check(await p.evaluate(() => window.__game.match.world.name === 'split'), 'F7 / level 2: the round is on Split');
  const spawn = await p.evaluate(() => window.__game.player.pos.toArray().map((v) => +v.toFixed(1)));
  check(spawn[2] > 44, `the seeker starts in attacker spawn (${spawn})`);

  // walls
  let at = await walk(10, 56, E, 2000);
  check(at.x < 13.7 && at.x > 12, `walking east into spawn's wall stops at it (x ${at.x})`);
  at = await walk(-46, -20, W, 2500);
  check(at.x > -51.7 && at.x < -50, `and into A site's west wall (x ${at.x})`);

  // the mid stairs up to mid top, then off the edge at the rope (where there's no railing)
  at = await walk(0, 7, N, 5600);
  check(at.y > 3.3 && at.z < -5, `up the mid stairs onto mid top (y ${at.y}, z ${at.z})`);
  at = await walk(7, -7.5, S, 1500);
  check(at.y < 0.2 && at.z > -6, `walking off mid top at the rope drops to mid bottom (y ${at.y}, z ${at.z})`);
  at = await walk(-6, -8, S, 1500);
  check(at.y > 3.3 && at.z < -6, `but the railing stops you elsewhere (y ${at.y}, z ${at.z})`);

  // the rope back up
  at = await walk(7, -5.0, N, 2600);
  check(at.y > 3.3 && at.z < -6, `climbing the mid rope gets you onto mid top (y ${at.y}, z ${at.z})`);

  // the vent: the seeker goes through
  at = await walk(6, 31, E, 3500);
  check(at.x > 12, `the seeker walks into the vent (x ${at.x})`);

  // the pages: five, on walls beside places to walk
  const pages = await p.evaluate(() => window.__game.match.pages.map((q) => ({ x: +q.pos.x.toFixed(1), y: +q.pos.y.toFixed(2), z: +q.pos.z.toFixed(1) })));
  check(pages.length === 5, `5 pages placed (${JSON.stringify(pages)})`);
  const apart = Math.min(...pages.flatMap((a, i) => pages.slice(i + 1).map((c) => Math.hypot(a.x - c.x, a.z - c.z))));
  check(apart > 15, `spread out (closest two ${apart.toFixed(1)} m apart)`);

  // a shot along mid stops at a wall
  const hit = await p.evaluate(() => {
    const g = window.__game, V = g.THREE.Vector3;
    return g.match.world.colliders.hit(new V(6, 1.6, 20), new V(6, 1.6, 60));
  });
  check(hit !== null && Math.abs(hit - 0.15) < 0.02, `a shot from mid bottom towards mail stops at mail's wall, 6 m away (t ${hit?.toFixed(3)})`);

  // how fast it draws (headless, so only a rough idea)
  const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); }; requestAnimationFrame(f); }));
  console.log(`     about ${fps.toFixed(0)} frames a second (headless, 960 x 540)`);

  // the hunter doesn't fit in the vent
  await p.evaluate(() => window.__game.startMatch(777, 2));
  await start('hunter');
  await sleep(1200);
  check(await p.evaluate(() => window.__game.match.role === 'hunter'), 'now as the hunter');
  const hs = await p.evaluate(() => window.__game.player.pos.z);
  check(hs < -38, `the hunter starts in defender spawn (z ${hs.toFixed(1)})`);
  at = await walk(6, 31, E, 3500);
  check(at.x < 8.2, `the hunter can't get into the vent (x ${at.x})`);
  at = await walk(-20, 32, W, 2500);
  check(at.x < -26, `but walks the sewer (x ${at.x})`);
} catch (e) {
  ok = false;
  console.log('FAIL', e.message);
} finally {
  await b.close();
  console.log(ok ? '\nALL OK' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
}
