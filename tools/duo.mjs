// Two-player test through the real relay: one browser creates a game, a second one joins
// with the invite link, the host starts, the seeker takes a page, abilities are tried, then
// the hunter grabs the seeker three times (two escapes, then caught). A second round checks
// that a seeker who doesn't struggle is caught when the time runs out.
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
  await host.waitForFunction(() => window.__game.lobby.partner, { timeout: 10000 });
  await guest.waitForFunction(() => !document.querySelector('#ready-game').disabled, { timeout: 10000 });
  check(await host.$eval('#start-game', (e) => e.disabled), "host sees the guest; Start stays locked until they're ready");
  await guest.click('#ready-game');
  await host.waitForFunction(() => !document.querySelector('#start-game').disabled, { timeout: 5000 });
  check(true, 'guest pressed Ready: Start unlocked');
  await host.screenshot({ path: 'shots/duo-lobby-host.png' });
  await guest.screenshot({ path: 'shots/duo-lobby-guest.png' });

  // host picks Hunter, so the guest is the Seeker
  await host.click('.role[data-role="hunter"]');
  await guest.waitForFunction(() => document.querySelector('.role[data-role="seeker"]').classList.contains('mine'));
  check(true, 'role switch reached the guest');
  const unready = await Promise.all([host.$eval('#start-game', (e) => e.disabled), guest.evaluate(() => window.__game.lobby.ready)]);
  check(unready[0] && !unready[1], 'switching roles un-readies the guest (Start locked again)');
  await guest.click('#ready-game');
  await host.waitForFunction(() => !document.querySelector('#start-game').disabled, { timeout: 5000 });

  await host.click('#start-game');
  await Promise.all([host, guest].map((p) => p.waitForFunction('window.__game.match', { timeout: 10000 })));
  const roles = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game.match.role)));
  check(roles[0] === 'hunter' && roles[1] === 'seeker', `roles: host=${roles[0]} guest=${roles[1]}`);
  const pagesSame = await Promise.all([host, guest].map((p) => p.evaluate(() => JSON.stringify(window.__game.match.pages.map((q) => q.pos.toArray().map((v) => v.toFixed(2)))))));
  check(pagesSame[0] === pagesSame[1], 'both clients placed the same pages');

  await sleep(1500);
  const seen = await host.evaluate(() => window.__game.match.remote.visible);
  check(seen, 'host sees the guest\'s character');

  // the seeker jumps (as Space would): up about half a metre, seen from the other screen too, and back down
  const jumping = guest.evaluate(async () => {
    const p = window.__game.player, ground = p.pos.y;
    p.vy = p.stats.jump;
    let top = 0;
    for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 50)); top = Math.max(top, p.pos.y - ground); }
    await new Promise((r) => setTimeout(r, 700));
    return { top, landed: p.air === 0 };
  });
  const seenUp = await host.evaluate(async () => {
    const m = window.__game.match, ground = m.remoteState().y;
    let top = 0;
    for (let i = 0; i < 16; i++) { await new Promise((r) => setTimeout(r, 50)); top = Math.max(top, m.remoteState().y - ground); }
    return top;
  });
  const jump = await jumping;
  check(jump.top > 0.75 && jump.top < 1.05 && jump.landed && seenUp > 0.6, `seeker jumps ${jump.top.toFixed(2)} m and lands (the hunter sees ${seenUp.toFixed(2)} m)`);

  // seeker walks up to page 1 and takes it. Stand 1.2 m in front of it; if that spot is inside a
  // trunk or rock the game pushes them out (maybe out of reach), so try spots fanning out around it.
  const inReach = await guest.evaluate(async () => {
    const g = window.__game, m = g.match, p = m.pages[0], V = p.pos.constructor;
    const out = p.mesh.getWorldDirection(new V()); // page faces away from its tree
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 12; i++) {
      const dir = out.clone().applyAxisAngle(new V(0, 1, 0), (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.3);
      const stand = p.pos.clone().addScaledVector(dir, 1.2);
      g.player.pos.set(stand.x, g.world.heightAt(stand.x, stand.z), stand.z);
      g.player.eyeY = g.player.pos.y + 1.65;
      await wait(150); // a frame or two: collisions settle where they really stand
      const eye = g.engine.camera.position;
      g.player.yaw = Math.atan2(-(p.pos.x - eye.x), -(p.pos.z - eye.z));
      g.player.pitch = Math.atan2(p.pos.y - eye.y, Math.hypot(p.pos.x - eye.x, p.pos.z - eye.z));
      await wait(100);
      if (m.lookedAtPage()) return true;
    }
    return false;
  });
  check(inReach, 'seeker stands at page 1, looking at it');
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

  // the hunter 8 m away, in plain sight: static on the seeker's screen (and a heartbeat)
  const dread = await guest.evaluate(() => ({ d: window.__game.match.dread, s: window.__game.engine.film.uniforms.uStatic.value }));
  check(dread.d > 0.15 && dread.s >= dread.d, `seeker feels the hunter close (dread ${dread.d.toFixed(2)}, static ${dread.s.toFixed(2)})`);

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

  // eye: thrown at the seeker, stopped early by pressing it again, and it reveals them
  await face(host);
  await host.evaluate(() => {
    // thrown level, towards them, or the nearest way with no trunk in the first 6 m (so it's still flying when stopped)
    const g = window.__game, p = g.player, eye = g.engine.camera.position;
    p.pitch = 0;
    for (let i = 0; i < 24 && g.world.colliders.blocked(eye, eye.clone().addScaledVector(p.forward, 6)); i++) p.yaw += (i % 2 ? 1 : -1) * (i + 1) * 0.13;
    g.match.useEye();
  });
  await sleep(200);
  const stopped = await host.evaluate(() => {
    const m = window.__game.match, eye = m.eyeOut, state = document.querySelector('[data-ab="eye"] .state').textContent;
    const flyingBefore = !!eye?.flying;
    m.useEye(); // pressed again: stop here
    return { flyingBefore, state };
  });
  await sleep(1500);
  const eye = await host.evaluate(() => window.__game.match.revealUntil > 0);
  const eyeWarn = await guest.evaluate(() => window.__game.match.meRevealedUntil > 0);
  check(stopped.flyingBefore && stopped.state === 'stop', `eye in flight, its slot says "${stopped.state}"`);
  check(eye && eyeWarn, `pressing again stops it and it reveals the seeker (hunter sees: ${eye}, seeker warned: ${eyeWarn})`);

  // left alone, it flies a long way (aimed up, over the trees)
  const far = await host.evaluate(async () => {
    const g = window.__game, m = g.match;
    m.cd.eye = 0; g.player.pitch = 0.75;
    const from = g.engine.camera.position.clone();
    m.useEye();
    const eye = m.eyeOut;
    await new Promise((r) => setTimeout(r, 3000));
    return eye.pos.distanceTo(from);
  });
  check(far > 35, `unstopped, the eye flies ${far.toFixed(0)} m (was about 18)`);
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

  // grabs: the hunter walks up and grabs; the seeker mashes Break free and escapes, twice
  const grabNow = async () => {
    await host.evaluate(() => {
      const g = window.__game, m = g.match, s = m.remoteState();
      m.cd.grab = 0; m.stunnedUntil = 0; // skip the cooldown and the stagger
      g.player.pos.set(s.x + 1.2, s.y, s.z);
      g.player.eyeY = g.player.pos.y + 2.45;
    });
    await sleep(300);
    await face(host);
    return host.evaluate(() => { const m = window.__game.match; const could = m.canGrab(); m.tryGrab(); return could && !!m.grab; });
  };
  for (const n of [1, 2]) {
    const grabbed = await grabNow();
    await sleep(500);
    const held = await guest.evaluate(() => ({ n: window.__game.match.grab?.n, bar: document.querySelector('#escape').classList.contains('show') }));
    check(grabbed && held.n === n && held.bar, `grab ${n}: the seeker is held and sees the break-free bar`);
    if (n === 1) {
      await sleep(300);
      await guest.screenshot({ path: 'shots/duo-grabbed-seeker.png' });
      await host.screenshot({ path: 'shots/duo-grab-hunter.png' });
    }
    await guest.evaluate(() => { const m = window.__game.match; for (let i = 0; i < 40 && m.grab; i++) m.struggle(); });
    await sleep(500);
    const after = await host.evaluate(() => { const m = window.__game.match; return { held: !!m.grab, staggered: m.stunned, cd: m.cd.grab }; });
    check(!after.held && after.staggered && after.cd > 0, `grab ${n}: the seeker broke free, the hunter staggers`);
  }
  // the third grab can't be escaped
  const third = await grabNow();
  await sleep(600);
  const lifted = await guest.evaluate(() => ({ kill: window.__game.match.grab?.kill, bar: document.querySelector('#escape').classList.contains('show') }));
  check(third && lifted.kill && !lifted.bar, 'grab 3: no way out');
  await host.screenshot({ path: 'shots/duo-kill-hunter.png' });
  await sleep(2400);
  const ends = await Promise.all([host, guest].map((p) => p.$eval('#end-title', (e) => e.textContent)));
  check(ends[0] === 'Victory' && ends[1] === 'Defeat', `end screens: host "${ends[0]}", guest "${ends[1]}"`);
  const recap = await guest.evaluate(() => ({ stats: document.querySelector('#recap-stats').innerText, map: document.querySelector('#recap-map').width, path: window.__game.match.track.seeker.filter(Boolean).length }));
  check(/Caught/i.test(recap.stats) && /1 \/ 5/.test(recap.stats) && recap.map > 0 && recap.path > 5, `recap: map drawn, ${recap.path} path points, stats "${recap.stats.replace(/\s+/g, ' ')}"`);
  await host.screenshot({ path: 'shots/duo-end-host.png' });

  // back to the lobby: both have to vote (1/2, then 2/2)
  await host.click('#end-lobby');
  await sleep(600);
  const half = await Promise.all([host, guest].map((p) => p.evaluate(() => ({ label: document.querySelector('#end-lobby').textContent, end: document.querySelector('#end').classList.contains('show') }))));
  check(half.every((h) => h.label === 'Back to lobby 1/2' && h.end), `one vote: both see "${half[0].label}" / "${half[1].label}" and stay on the end screen`);
  await guest.click('#end-lobby');
  await Promise.all([host, guest].map((p) => p.waitForFunction(() => document.querySelector('#lobby').classList.contains('show'), { timeout: 5000 })));
  check(true, 'second vote (2/2): both back in the lobby');

  // a second round: the seeker doesn't struggle, so the first grab catches them when time runs out
  await guest.waitForFunction(() => !document.querySelector('#ready-game').disabled && !window.__game.lobby.ready, { timeout: 8000 });
  await guest.click('#ready-game');
  await host.waitForFunction(() => !document.querySelector('#start-game').disabled, { timeout: 5000 });
  await host.click('#start-game');
  await Promise.all([host, guest].map((p) => p.waitForFunction('window.__game.match && !window.__game.match.over', { timeout: 10000 })));
  await sleep(1500);
  check(await grabNow(), 'round 2: grabbed');
  await sleep(4000 + 1200);
  const ends2 = await Promise.all([host, guest].map((p) => p.$eval('#end-title', (e) => e.textContent)));
  check(ends2[0] === 'Victory' && ends2[1] === 'Defeat', `no struggling: caught when the time ran out (host "${ends2[0]}", guest "${ends2[1]}")`);
} catch (e) {
  ok = false;
  console.log('FAIL', e.message);
} finally {
  await Promise.all([ba.close(), bb.close()]);
}
console.log(ok ? '\nall good' : '\nsome checks failed');
process.exit(ok ? 0 : 1);
