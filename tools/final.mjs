// Two-player test of everything after the pages: the hunter's immunity (his shield, no text),
// the vote for the final duel, the duel itself (damage per hit zone, rounds decided once, the recap
// and countdown between rounds, best of 5), Try again after Iso loses, then Continue after Iso
// wins, the puzzle and the message. Also screenshots How to play.
// Needs `npm run dev` running.   node tools/final.mjs [baseUrl]
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

// in the page: stand somewhere and look at a point
const place = (page, at, look) => page.evaluate(({ at, look }) => {
  const { player, engine } = window.__game;
  if (at) { player.pos.x = at[0]; player.pos.z = at[1]; player.vel.set(0, 0, 0); }
  player.update(0.016);
  if (look) {
    const c = engine.camera.position, dx = look[0] - c.x, dy = look[1] - c.y, dz = look[2] - c.z;
    player.yaw = Math.atan2(-dx, -dz);
    player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    player.update(0.016);
  }
}, { at, look });

try {
  const host = await open(ba, 'host');
  await host.goto(BASE, { waitUntil: 'networkidle0' });
  await host.waitForFunction('window.__game');

  // --- how to play -------------------------------------------------------------------------
  await host.click('[data-go="howto"]');
  const slides = await host.$eval('#ht-count', (e) => e.textContent);
  check(/^1 \/ \d+$/.test(slides), `how to play opens (${slides})`);
  const n = +slides.split('/ ')[1];
  for (let i = 0; i < n; i++) {
    await sleep(i === 1 || i === n - 1 ? 1200 : 300);
    if ([1, 2, 3, 8, 10, n - 1].includes(i)) await host.screenshot({ path: `shots/howto-${i + 1}.png` });
    await host.click('#ht-next');
  }
  check(await host.evaluate(() => document.querySelector('#menu').classList.contains('show')), `Next through all ${n} slides, then back to the menu`);

  // --- a room, the guest is the seeker ---------------------------------------------------------
  await host.click('[data-go="create"]');
  await host.waitForFunction(() => /^[A-Z]{4}$/.test(document.querySelector('#lobby-code').textContent));
  const code = await host.$eval('#lobby-code', (e) => e.textContent);
  const guest = await open(bb, 'guest');
  await guest.goto(`${BASE}?room=${code}`, { waitUntil: 'networkidle0' });
  await guest.waitForFunction('window.__game');
  await host.waitForFunction(() => window.__game.lobby.partner, { timeout: 10000 });
  await host.click('.role[data-role="hunter"]');
  await guest.waitForFunction(() => document.querySelector('.role[data-role="seeker"]').classList.contains('mine'));
  await guest.waitForFunction(() => !document.querySelector('#ready-game').disabled);
  await guest.click('#ready-game');
  await host.waitForFunction(() => !document.querySelector('#start-game').disabled, { timeout: 5000 });
  await host.click('#start-game');
  await Promise.all([host, guest].map((p) => p.waitForFunction('window.__game.match', { timeout: 10000 })));
  await sleep(1500);

  // --- immunity: stun him, and when it ends both screens show the shield ------------------------
  // a spot 5 m from the seeker with nothing in between
  const spot = await guest.evaluate(() => {
    const { player, world, THREE } = window.__game, p = player.pos;
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2, x = p.x + Math.cos(a) * 5, z = p.z + Math.sin(a) * 5;
      const q = new THREE.Vector3(x, 0, z);
      world.colliders.resolve(q, 0.5);
      if (q.distanceTo(new THREE.Vector3(x, 0, z)) > 0.01) continue;
      const eye = new THREE.Vector3(p.x, world.heightAt(p.x, p.z) + 1.65, p.z), chest = new THREE.Vector3(x, world.heightAt(x, z) + 1.8, z);
      if (!world.colliders.blocked(eye, chest) && Math.abs(world.heightAt(x, z) - world.heightAt(p.x, p.z)) < 1) return [x, z];
    }
    return null;
  });
  check(!!spot, 'found a clear spot for the hunter');
  await place(host, spot, null);
  await sleep(600);
  const hunterAt = await host.evaluate(() => window.__game.player.pos.toArray());
  await place(guest, null, [hunterAt[0], hunterAt[1] + 1.8, hunterAt[2]]);
  await guest.evaluate(() => window.__game.match.shoot());
  await sleep(500);
  check(await host.evaluate(() => window.__game.match.stunned), 'shot: the hunter is stunned');
  await sleep(1700); // the 2 s stun runs out
  const shield = () => guest.evaluate(() => window.__game.match.remote.children.some((c) => c.material?.isShaderMaterial && c.visible));
  check(await shield(), 'seeker sees the shield around him');
  check(!/immune/i.test(await Promise.all([host, guest].map((p) => p.evaluate(() => document.querySelector('#hud').innerText))).then((t) => t.join(' '))), 'no immunity text on either screen');
  await place(guest, null, [hunterAt[0], hunterAt[1] + 1.5, hunterAt[2]]);
  await guest.screenshot({ path: 'shots/immune-seeker.png' });
  await host.screenshot({ path: 'shots/immune-hunter.png' });
  await guest.evaluate(() => window.__game.match.shoot());
  await sleep(500);
  check(!(await host.evaluate(() => window.__game.match.stunned)), 'a shot while immune is resisted');
  await sleep(3200);
  check(!(await shield()), 'the shield goes away when it ends');

  // --- stuck for 4 minutes: the dart finds pages -------------------------------------------------
  const page = await guest.evaluate(() => window.__game.match.pages[0].pos.toArray());
  await guest.evaluate((page) => { const m = window.__game.match; m.dartFindsPage(new window.__game.THREE.Vector3(...page).add(new window.__game.THREE.Vector3(5, 0, 0))); }, page);
  check(!(await guest.evaluate(() => window.__game.match.pageReveal)), 'before 4 minutes, a scan near a page shows nothing');
  await guest.evaluate(() => { window.__game.match.lastPageAt -= 240000; });
  await sleep(300);
  const unlocked = await guest.evaluate(() => ({ hint: window.__game.match.hintShown, text: document.querySelector('#status').textContent }));
  check(unlocked.hint && unlocked.text === 'Recon can now find pages', `after 4 minutes: "${unlocked.text}"`);
  await guest.evaluate((page) => { const m = window.__game.match; m.dartFindsPage(new window.__game.THREE.Vector3(...page).add(new window.__game.THREE.Vector3(5, 0, 0))); }, page);
  await sleep(300);
  const shown = await guest.evaluate(() => { const m = window.__game.match; return { n: m.pageReveal?.page.n, glow: !!m.pages[0].glow?.visible }; });
  check(shown.n === 1 && shown.glow, 'a scan near a page now makes it glow');
  check((await host.$eval('#status', (e) => e.textContent)) === 'A page was revealed', 'the hunter is told a page was revealed');
  // a look at it from where the seeker stands, flashlight off: the glow, then (once it's gone) the faint page
  await guest.evaluate(() => { window.__game.flashlight.on = false; });
  await place(guest, null, page);
  await sleep(200);
  await guest.screenshot({ path: 'shots/page-revealed.png' });
  await guest.evaluate((page) => {
    const { player, world } = window.__game, m = window.__game.match, pg = m.pages[0];
    // stand 4 m in front of the page, looking at it
    const out = new window.__game.THREE.Vector3(0, 0, 1).applyEuler(pg.mesh.rotation).setY(0).normalize().multiplyScalar(4);
    player.pos.set(page[0] + out.x, 0, page[2] + out.z);
    m.pageReveal = null;
  }, page);
  await place(guest, null, page);
  await sleep(300);
  await guest.screenshot({ path: 'shots/page-dark.png' });
  await guest.evaluate(() => { window.__game.flashlight.on = true; });
  await sleep(200);
  await guest.screenshot({ path: 'shots/page-lit.png' });

  // --- every page found → the vote for the final duel -------------------------------------------
  await guest.evaluate(() => { const m = window.__game.match; for (const p of m.pages) { m.send('page', { n: p.n }); m.takePage(p.n, true); } });
  await Promise.all([host, guest].map((p) => p.waitForFunction(() => document.querySelector('#end').classList.contains('show'), { timeout: 5000 })));
  const btn = await guest.$eval('#end-lobby', (e) => e.textContent);
  check(btn === 'Final duel 0/2', `after the pages, the vote is for the final duel ("${btn}")`);
  await guest.click('#end-lobby');
  await host.click('#end-lobby');
  await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.__game.match?.constructor.name === 'Duel', { timeout: 5000 })));
  check(true, 'both voted: the duel starts');
  await sleep(1000);
  await guest.screenshot({ path: 'shots/duel-intro.png' });
  // the whole arena from above one corner
  await guest.evaluate(() => { const p = window.__game.player; p.pos.set(-6, p.pos.y, 9); });
  await place(guest, null, [3, 400, -6]);
  await guest.evaluate(() => { document.querySelector('#click-to-play').classList.remove('show'); document.querySelector('#duel-banner').classList.remove('show'); });
  await sleep(200);
  await guest.screenshot({ path: 'shots/duel-arena.png' });

  // the duel: the seeker shoots from the left side lane, the hunter stands in the same lane
  const duel = (p) => p.evaluate(() => { const d = window.__game.match; return { phase: d.phase, round: d.round, hp: d.hp, score: { ...d.score }, enemyHp: d.enemyHp }; });
  const toLanes = async () => {
    await place(guest, [-9, 9], null);
    await place(host, [-9, -9], null);
    await sleep(400);
  };
  const waitLive = (round) => Promise.all([host, guest].map((p) => p.waitForFunction((r) => window.__game.match.phase === 'live' && window.__game.match.round === r, { timeout: 9000 }, round)));
  // shoot the other player in `part` (head/body/legs) from `shooter`
  const shootAt = async (shooter, target, part) => {
    const t = await target.evaluate(() => window.__game.player.pos.toArray());
    const role = await target.evaluate(() => window.__game.match.role);
    const H = { seeker: { head: 1.64, body: 1.2, legs: 0.5 }, hunter: { head: 2.58, body: 1.8, legs: 0.7 } }[role];
    await place(shooter, null, [t[0], t[1] + H[part], t[2]]);
    await shooter.evaluate(() => window.__game.match.shoot());
    await sleep(250);
  };

  await waitLive(1);
  // a close look at each other first: Slender with his Classic, Iso with hers
  await place(host, [-9, 6], null);
  await place(guest, [-9, 9.5], null);
  await sleep(500);
  await place(guest, null, [-9, 401.4, 6]);
  await place(host, null, [-9, 401.2, 9.5]);
  await sleep(300);
  await Promise.all([host, guest].map((p) => p.evaluate(() => document.querySelector('#click-to-play').classList.remove('show'))));
  await guest.screenshot({ path: 'shots/duel-close-seeker.png' });
  await host.screenshot({ path: 'shots/duel-close-hunter.png' });
  await toLanes();
  await guest.screenshot({ path: 'shots/duel-seeker.png' });
  await host.screenshot({ path: 'shots/duel-hunter.png' });
  check((await duel(host)).hp === 150, 'both start with 150 health');
  // round 1, from 38 m: a body shot does 22
  await place(guest, [-9, 19], null);
  await place(host, [-9, -19], null);
  await sleep(400);
  await shootAt(guest, host, 'body');
  check((await duel(host)).hp === 128, `body shot from 38 m: 22 damage (hunter at ${(await duel(host)).hp})`);
  // then from 18 m: legs 22, body 26, head 78, and a last headshot
  await toLanes();
  await shootAt(guest, host, 'legs');
  check((await duel(host)).hp === 106, `leg shot from 18 m: 22 damage (hunter at ${(await duel(host)).hp})`);
  await shootAt(guest, host, 'body');
  check((await duel(host)).hp === 80, `body shot from 18 m: 26 damage (hunter at ${(await duel(host)).hp})`);
  await shootAt(guest, host, 'head');
  check((await duel(host)).hp === 2, `headshot from 18 m: 78 damage (hunter at ${(await duel(host)).hp})`);
  await shootAt(guest, host, 'head');
  const tEnd = Date.now() - 250; // (shootAt waits 250 ms after the shot)
  await sleep(300);
  const r1 = await Promise.all([host, guest].map(duel));
  check(r1[0].score.seeker === 1 && r1[1].score.seeker === 1 && r1[0].phase === 'between', `headshot: round 1 to Iso on both screens (${JSON.stringify(r1[1].score)})`);
  await sleep(1800);
  const banner = await guest.$eval('#duel-banner', (e) => e.textContent.replace(/\s+/g, ' '));
  check(/Round won/.test(banner) && /Next round in/.test(banner), 'recap between rounds, with the countdown');
  await guest.screenshot({ path: 'shots/duel-recap.png' });

  // rounds 2-4: the hunter wins three (two headshots each) → Iso loses 1-3
  for (let r = 2; r <= 4; r++) {
    await waitLive(r);
    if (r === 2) { const s = (Date.now() - tEnd) / 1000; check(s > 4.6 && s < 6, `5 s between rounds (${s.toFixed(1)} s)`); }
    const hp = await duel(guest);
    check(hp.hp === 150, `round ${r}: back to full health`);
    await toLanes();
    await shootAt(host, guest, 'head');
    await sleep(160);
    await shootAt(host, guest, 'head');
    await sleep(400);
  }
  await Promise.all([host, guest].map((p) => p.waitForFunction(() => document.querySelector('#duel-end').classList.contains('show'), { timeout: 8000 })));
  const lost = await guest.evaluate(() => ({ title: document.querySelector('#de-title').textContent, sub: document.querySelector('#de-sub').textContent, again: getComputedStyle(document.querySelector('#de-again')).display !== 'none', menu: getComputedStyle(document.querySelector('#de-menu')).display !== 'none' }));
  check(lost.title === 'Defeat' && /lost/.test(lost.sub) && lost.again && lost.menu, `Iso lost 1-3: "${lost.sub}", Try again and Main menu`);
  await guest.screenshot({ path: 'shots/duel-lost.png' });

  // try again: both press it, the best of 5 starts over
  await guest.click('#de-again');
  await host.waitForFunction(() => document.querySelector('#de-again').textContent === 'Try again 1/2', { timeout: 3000 });
  check(true, 'one Try again: 1/2 on the other screen');
  await host.click('#de-again');
  await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.__game.match?.constructor.name === 'Duel' && !window.__game.match.over && window.__game.match.score.seeker === 0, { timeout: 5000 })));
  check(true, 'both pressed Try again: a new best of 5');

  // Iso wins three straight
  for (let r = 1; r <= 3; r++) {
    await waitLive(r);
    await toLanes();
    await shootAt(guest, host, 'head');
    await sleep(160);
    await shootAt(guest, host, 'head');
    await sleep(400);
  }
  await Promise.all([host, guest].map((p) => p.waitForFunction(() => document.querySelector('#duel-end').classList.contains('show'), { timeout: 8000 })));
  const won = await guest.evaluate(() => ({ title: document.querySelector('#de-title').textContent, cont: getComputedStyle(document.querySelector('#de-continue')).display !== 'none', again: getComputedStyle(document.querySelector('#de-again')).display !== 'none' }));
  check(won.title === 'Victory' && won.cont && !won.again, 'Iso wins 3-0: only Continue');
  await guest.screenshot({ path: 'shots/duel-won.png' });
  await guest.click('#de-continue');
  await sleep(300);
  check(await guest.evaluate(() => document.querySelector('#duel-end').classList.contains('show')), 'one Continue is not enough');
  await host.click('#de-continue');
  await guest.waitForFunction(() => document.querySelector('#puzzle').classList.contains('show'), { timeout: 5000 });
  await host.waitForFunction(() => document.querySelector('#gift-wait').classList.contains('show'), { timeout: 5000 });
  check(true, 'both pressed Continue: the seeker gets the puzzle, the hunter waits');
  await sleep(800);
  await guest.screenshot({ path: 'shots/puzzle.png' });

  // the puzzle: a wrong drop goes back to the tray, then every piece into its place
  const pieces = () => guest.evaluate(() => {
    const board = document.querySelector('#puzzle-board').getBoundingClientRect();
    const regions = [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 1 / 3, 0.5], [1 / 3, 0.5, 1 / 3, 0.5], [2 / 3, 0.5, 1 / 3, 0.5]];
    return [...document.querySelectorAll('.piece')].map((el, i) => {
      const r = el.getBoundingClientRect();
      const [fx, fy] = regions[i];
      return { from: [r.left + 10, r.top + 10], to: [board.left + fx * board.width + 10, board.top + fy * board.height + 10], placed: el.classList.contains('placed') };
    });
  });
  const drag = async (from, to) => {
    await guest.mouse.move(...from);
    await guest.mouse.down();
    await guest.mouse.move(from[0] + (to[0] - from[0]) / 2, from[1] + (to[1] - from[1]) / 2, { steps: 4 });
    await guest.mouse.move(...to, { steps: 4 });
    await guest.mouse.up();
    await sleep(450);
  };
  let ps = await pieces();
  await drag(ps[0].from, ps[1].to); // piece 1 onto piece 2's place
  check(!(await pieces())[0].placed, 'a piece dropped in the wrong place goes back');
  for (let i = 0; i < ps.length; i++) {
    ps = await pieces();
    await drag(ps[i].from, ps[i].to);
    if (i === 2) await guest.screenshot({ path: 'shots/puzzle-half.png' });
  }
  ps = await pieces();
  check(ps.every((p) => p.placed), 'all 5 pieces placed');
  await sleep(900);
  check(await guest.evaluate(() => document.querySelector('#show-msg').classList.contains('show')), 'Show message appears');
  await guest.screenshot({ path: 'shots/puzzle-done.png' });
  const hw = await host.$eval('#gw-note', (e) => e.textContent);
  check(/whole/.test(hw), `the hunter is told ("${hw}")`);
  await guest.click('#show-msg');
  await guest.waitForFunction(() => document.querySelector('#letter').classList.contains('show'));
  const msg = await guest.$eval('#letter-text', (e) => e.textContent);
  check(msg.includes('Part one') && msg.includes('Part five'), 'the message shows');
  await sleep(900);
  await guest.screenshot({ path: 'shots/letter.png' });
  await host.click('#gw-menu');
  await sleep(800);
  check(await guest.evaluate(() => document.querySelector('#letter').classList.contains('show')), 'the hunter leaving does not close her message');
} catch (e) {
  ok = false;
  console.log('FAIL', e.message);
} finally {
  await ba.close();
  await bb.close();
  console.log(ok ? '\nALL OK' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
}
