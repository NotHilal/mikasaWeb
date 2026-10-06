// Two-player test through the real relay: one browser creates a game, a second one joins
// with the invite link, the host starts, the seeker takes a page, then the hunter catches them.
// Needs `npm run dev` running.   node tools/duo.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { CHROME } from './browser.mjs';

const BASE = process.argv[2] || 'http://localhost:5180/';
await mkdir('shots', { recursive: true });
const launch = () => puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu'] });
const [ba, bb] = await Promise.all([launch(), launch()]);
const open = async (browser, name) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => console.log(`[${name} pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log(`[${name}] ${m.text()}`); });
  return page;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) ok = false; };

try {
  const host = await open(ba, 'host');
  await host.goto(BASE, { waitUntil: 'networkidle0' });
  await host.waitForFunction('window.__game');
  await host.click('[data-go="create"]');
  await host.waitForFunction(() => /^[A-Z]{4}$/.test(document.querySelector('#lobby-code').textContent));
  const code = await host.$eval('#lobby-code', (e) => e.textContent);
  check(true, `room created: ${code}`);

  const guest = await open(bb, 'guest');
  await guest.goto(`${BASE}?room=${code}`, { waitUntil: 'networkidle0' });
  await guest.waitForFunction('window.__game');
  await host.waitForFunction(() => !document.querySelector('#start-game').disabled, { timeout: 10000 });
  check(true, 'host sees the guest (Start enabled)');
  await host.screenshot({ path: 'shots/duo-lobby-host.png' });
  await guest.screenshot({ path: 'shots/duo-lobby-guest.png' });

  // host picks Hunter, so the guest is the Seeker
  await host.click('.role[data-role="hunter"]');
  await guest.waitForFunction(() => document.querySelector('.role[data-role="seeker"]').classList.contains('mine'));
  check(true, 'role switch reached the guest');

  await host.click('#start-game');
  await Promise.all([host, guest].map((p) => p.waitForFunction('window.__game.match', { timeout: 10000 })));
  const roles = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game.match.role)));
  check(roles[0] === 'hunter' && roles[1] === 'seeker', `roles: host=${roles[0]} guest=${roles[1]}`);
  const pagesSame = await Promise.all([host, guest].map((p) => p.evaluate(() => JSON.stringify(window.__game.match.pages.map((q) => q.pos.toArray().map((v) => v.toFixed(2)))))));
  check(pagesSame[0] === pagesSame[1], 'both clients placed the same pages');

  await sleep(1500);
  const seen = await host.evaluate(() => window.__game.match.remote.visible);
  check(seen, 'host sees the guest\'s character');

  // seeker walks up to page 1 and takes it
  await guest.evaluate(() => {
    const g = window.__game, m = g.match, p = m.pages[0];
    const tree = p.pos.clone();
    const dir = p.mesh.getWorldDirection(new (tree.constructor)()); // page faces away from its tree
    const stand = tree.clone().addScaledVector(dir, 1.2);
    g.player.pos.set(stand.x, g.world.heightAt(stand.x, stand.z), stand.z);
    g.player.eyeY = g.player.pos.y + 1.65;
    g.player.yaw = Math.atan2(dir.x, dir.z);
    g.player.pitch = Math.atan2(p.pos.y - (g.player.pos.y + 1.65), 1.2);
  });
  await sleep(500);
  await guest.screenshot({ path: 'shots/duo-page.png' });
  await guest.evaluate(() => window.__game.match.tryTake()); // F in game (keys need pointer lock, which headless can't get)
  await sleep(800);
  const found = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game.match.found)));
  check(found[0] === 1 && found[1] === 1, `page taken on both screens (host ${found[0]}, guest ${found[1]})`);
  await guest.screenshot({ path: 'shots/duo-page-taken.png' });

  // --- abilities ---
  const ms = () => Date.now();
  // face a point: sets yaw/pitch on that client
  const face = (page, toRemote = true) => page.evaluate((toRemote) => {
    const g = window.__game, p = g.player, s = g.match.remoteState();
    const tx = s.x, tz = s.z, ty = s.y + 1.4;
    p.yaw = Math.atan2(-(tx - p.pos.x), -(tz - p.pos.z));
    p.pitch = Math.atan2(ty - g.engine.camera.position.y, Math.hypot(tx - p.pos.x, tz - p.pos.z));
    if (!toRemote) p.yaw += Math.PI;
  }, toRemote);
  // turn the seeker away from the page's tree, then put the hunter 8 m in front of them
  const sp = await guest.evaluate(() => {
    const g = window.__game, p = g.player, eye = g.engine.camera.position;
    // pick a direction with a clear 9 m line (no trunk in the way)
    for (let i = 0; i < 32; i++) {
      p.yaw += Math.PI / 16;
      const f = p.forward;
      const end = eye.clone().addScaledVector(f, 9); end.y = g.world.heightAt(end.x, end.z) + 1.5;
      if (!g.world.colliders.blocked(eye, end)) break;
    }
    p.pitch = 0; const f = p.forward; return { x: p.pos.x, z: p.pos.z, fx: f.x, fz: f.z }; });
  await host.evaluate((sp) => {
    const g = window.__game, len = Math.hypot(sp.fx, sp.fz);
    let x = sp.x + (sp.fx / len) * 8, z = sp.z + (sp.fz / len) * 8;
    const pos = { x, z };
    g.world.colliders.resolve(pos, 0.5);
    g.player.pos.set(pos.x, g.world.heightAt(pos.x, pos.z), pos.z);
    g.player.eyeY = g.player.pos.y + 2.45;
  }, sp);
  await sleep(800);
  await face(guest);
  await face(host);
  await sleep(300);

  // pistol: hit → hunter stunned; a second hit while stunned is resisted
  await guest.evaluate(() => window.__game.match.shoot());
  await sleep(700);
  const stun1 = await host.evaluate(() => ({ stunned: window.__game.match.stunned, until: window.__game.match.stunnedUntil }));
  const seenStun = await guest.evaluate(() => window.__game.match.remoteStunUntil > performance.now());
  check(stun1.stunned && seenStun, `pistol hit stuns the hunter (hunter stunned: ${stun1.stunned}, seeker sees it: ${seenStun})`);
  await guest.screenshot({ path: 'shots/duo-stun-seeker.png' });
  await host.screenshot({ path: 'shots/duo-stun-hunter.png' });
  await guest.evaluate(() => window.__game.match.shoot());
  await sleep(600);
  const stun2 = await host.evaluate(() => window.__game.match.stunnedUntil);
  const ammo = await guest.evaluate(() => window.__game.match.ammo);
  check(stun2 === stun1.until && ammo === 1, `second hit while stunned is resisted (ammo left ${ammo})`);

  // flash: the hunter (looking at the seeker) is blinded, the thrower isn't.
  // From 3 m, so the curving throw can't clip a trunk on the way (that blocks it, as it should).
  await host.evaluate((sp) => {
    const g = window.__game, len = Math.hypot(sp.fx, sp.fz);
    const pos = { x: sp.x + (sp.fx / len) * 3, z: sp.z + (sp.fz / len) * 3 };
    g.player.pos.set(pos.x, g.world.heightAt(pos.x, pos.z), pos.z);
    g.player.eyeY = g.player.pos.y + 2.45;
  }, sp);
  await sleep(600);
  await face(guest);
  await face(host);
  await guest.evaluate(() => window.__game.match.useFlash());
  await sleep(1100);
  const blind = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game.match.blindUntil > 0)));
  check(blind[0] && !blind[1], `flash blinds the hunter only (hunter ${blind[0]}, seeker ${blind[1]})`);
  await host.screenshot({ path: 'shots/duo-flashed-hunter.png' });

  // recon dart: reveals the hunter on the seeker's screen, warns the hunter
  await guest.evaluate(() => { const g = window.__game; g.player.pitch = -0.15; g.match.useDart(); });
  await sleep(2200);
  const dart = await guest.evaluate(() => window.__game.match.revealUntil > 0);
  const warned = await host.evaluate(() => window.__game.match.meRevealedUntil > 0);
  check(dart && warned, `recon dart reveals the hunter (seeker sees: ${dart}, hunter warned: ${warned})`);

  // teleport: once the stun is over, with the seeker looking away
  await host.waitForFunction(() => !window.__game.match.stunned, { timeout: 8000 });
  await face(guest, false);
  await sleep(400);
  const before = await guest.evaluate(() => { const s = window.__game.match.remoteState(); return [s.x, s.z]; });
  const casting = await host.evaluate(() => {
    const g = window.__game, m = g.match;
    g.player.yaw += Math.PI; g.player.pitch = -0.3; // aim at the ground away from the seeker
    m.startAim();
    m.releaseAim();
    return !!m.tpCast && m.tpCount === 0; // winding up, not gone yet
  });
  await sleep(1700); // 1 s wind-up, then the move reaches the seeker
  const tp = await host.evaluate(() => ({ count: window.__game.match.tpCount, cd: window.__game.match.cd.tp }));
  const after = await guest.evaluate(() => { const s = window.__game.match.remoteState(); return [s.x, s.z]; });
  const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
  check(casting && tp.count === 1 && tp.cd > 0 && moved > 3, `hunter teleported ${moved.toFixed(1)} m after a 1 s wind-up (cooldown ${tp.cd.toFixed(0)} s)`);

  // eye: reveals the seeker to the hunter
  await face(host);
  await host.evaluate(() => window.__game.match.useEye());
  await sleep(3000);
  const eye = await host.evaluate(() => window.__game.match.revealUntil > 0);
  const eyeWarn = await guest.evaluate(() => window.__game.match.meRevealedUntil > 0);
  check(eye && eyeWarn, `eye reveals the seeker (hunter sees: ${eye}, seeker warned: ${eyeWarn})`);
  await host.screenshot({ path: 'shots/duo-eye-hunter.png' });

  // abilities come back: the seeker's flash is on cooldown, not used up
  const flashCd = await guest.evaluate(() => window.__game.match.cd.flash);
  check(flashCd > 0 && flashCd <= 20, `seeker flash is on a cooldown (${flashCd.toFixed(0)} s left)`);

  // headshot: once the hunter can be stunned again, the last round to the head stuns 4 s,
  // and the empty gun reloads by itself
  await host.waitForFunction(() => performance.now() > window.__game.match.immuneUntil + 100, { timeout: 15000 });
  await guest.evaluate((sp) => { // the seeker back where the clear line was found, facing it
    const g = window.__game;
    g.player.pos.set(sp.x, g.world.heightAt(sp.x, sp.z), sp.z);
    g.player.eyeY = g.player.pos.y + 1.65;
  }, sp);
  await host.evaluate((sp) => { // the hunter 4 m in front, on that clear line
    const g = window.__game, len = Math.hypot(sp.fx, sp.fz);
    const pos = { x: sp.x + (sp.fx / len) * 4, z: sp.z + (sp.fz / len) * 4 };
    g.player.pos.set(pos.x, g.world.heightAt(pos.x, pos.z), pos.z);
    g.player.eyeY = g.player.pos.y + 2.45;
  }, sp);
  await sleep(700);
  await face(guest);
  await guest.evaluate(() => {
    const g = window.__game, p = g.player, s = g.match.remoteState();
    // aim at his head instead of his body
    p.pitch = Math.atan2(s.y + 2.5 - g.engine.camera.position.y, Math.hypot(s.x - p.pos.x, s.z - p.pos.z));
    g.match.shoot();
  });
  await sleep(700);
  const headStun = await host.evaluate(() => Math.round(window.__game.match.stunnedUntil - performance.now()));
  check(headStun > 2500 && headStun <= 4000, `headshot stuns longer (${(headStun / 1000).toFixed(1)} s left)`);
  const empty = await guest.evaluate(() => window.__game.match.ammo);
  await sleep(6000);
  const refilled = await guest.evaluate(() => window.__game.match.ammo);
  check(empty === 0 && refilled === 3, `empty gun reloads by itself (0 → ${refilled})`);

  // hunter walks onto the seeker
  await sleep(500);
  await host.evaluate(() => {
    const g = window.__game, s = g.match.remoteState();
    g.player.pos.set(s.x + 0.5, s.y, s.z);
  });
  await sleep(1000);
  const ends = await Promise.all([host, guest].map((p) => p.$eval('#end-title', (e) => e.textContent)));
  check(ends[0] === 'Victory' && ends[1] === 'Defeat', `end screens: host "${ends[0]}", guest "${ends[1]}"`);
  await host.screenshot({ path: 'shots/duo-end-host.png' });

  // back to the lobby
  await host.click('#end-lobby');
  await guest.waitForFunction(() => document.querySelector('#lobby').classList.contains('show'), { timeout: 5000 });
  check(true, 'both back in the lobby');
} catch (e) {
  ok = false;
  console.log('FAIL', e.message);
} finally {
  await Promise.all([ba.close(), bb.close()]);
}
console.log(ok ? '\nall good' : '\nsome checks failed');
process.exit(ok ? 0 : 1);
