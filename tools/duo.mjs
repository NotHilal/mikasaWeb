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
  await guest.keyboard.press('KeyE');
  await sleep(800);
  const found = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game.match.found)));
  check(found[0] === 1 && found[1] === 1, `page taken on both screens (host ${found[0]}, guest ${found[1]})`);
  await guest.screenshot({ path: 'shots/duo-page-taken.png' });

  // hunter walks onto the seeker
  await sleep(500);
  await host.evaluate(() => {
    const g = window.__game, s = g.match.remoteState();
    g.player.pos.set(s.x + 0.5, s.y, s.z);
  });
  await sleep(1000);
  const ends = await Promise.all([host, guest].map((p) => p.$eval('#end-title', (e) => e.textContent)));
  check(ends[0] === 'You win' && ends[1] === 'You lose', `end screens: host "${ends[0]}", guest "${ends[1]}"`);
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
