// Connection test through the real relay: a network blip pauses the round for both players
// and it picks up again; a closed tab pauses it, and a fresh page joining sends both back to
// the lobby; a host who reloads gets their room back as host.
// Needs `npm run dev` running.   node tools/drop.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { CHROME } from './browser.mjs';

const BASE = process.argv[2] || 'http://localhost:5180/';
await mkdir('shots', { recursive: true });
const launch = () => puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu'] });
const browsers = await Promise.all([launch(), launch(), launch()]);
const [ba, bb, bc] = browsers;
const open = async (browser, name) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => console.log(`[${name} pageerror] ${e.message}`));
  return page;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) ok = false; };
const shown = (page) => page.evaluate(() => [...document.querySelectorAll('.screen.show')].map((s) => s.id).filter((id) => id !== 'hud').join(','));
const paused = (page) => page.evaluate(() => !!window.__game.match?.pausedAt);

try {
  const host = await open(ba, 'host');
  await host.goto(BASE, { waitUntil: 'networkidle0' });
  await host.waitForFunction('window.__game');
  await host.click('[data-go="create"]');
  await host.waitForFunction(() => /^[A-Z]{4}$/.test(document.querySelector('#lobby-code').textContent));
  const code = await host.$eval('#lobby-code', (e) => e.textContent);

  let guest = await open(bb, 'guest');
  await guest.goto(`${BASE}?room=${code}`, { waitUntil: 'networkidle0' });
  await guest.waitForFunction('window.__game');
  await guest.waitForFunction(() => !document.querySelector('#ready-game').disabled && !window.__game.lobby.ready, { timeout: 8000 });
  await guest.click('#ready-game');
  await host.waitForFunction(() => !document.querySelector('#start-game').disabled, { timeout: 10000 });
  await host.click('#start-game');
  await Promise.all([host, guest].map((p) => p.waitForFunction('window.__game.match', { timeout: 10000 })));
  await sleep(1500);
  check(true, `round started in room ${code}`);

  // --- a 2 s network blip on the guest's side ---
  const before = await host.evaluate(() => window.__game.match.startedAt);
  await guest.evaluate(() => window.__game.net.simulateDrop(2000));
  await sleep(600);
  const during = await Promise.all([host, guest].map(paused));
  const screens = await Promise.all([host, guest].map(shown));
  const titles = await Promise.all([host, guest].map((p) => p.$eval('#waiting-title', (e) => e.textContent)));
  check(during[0] && during[1], `both paused during the blip (host ${during[0]}, guest ${during[1]})`);
  check(screens[0] === 'waiting' && screens[1] === 'waiting', `waiting screen on both (${screens})`);
  check(titles[0] === 'Player disconnected' && titles[1] === 'Connection lost', `host: "${titles[0]}", guest: "${titles[1]}"`);
  await host.screenshot({ path: 'shots/drop-waiting-host.png' });

  await Promise.all([host, guest].map((p) => p.waitForFunction(() => !window.__game.match.pausedAt, { timeout: 8000 })));
  const after = await Promise.all([host, guest].map(shown));
  check(after[0] === 'click-to-play' && after[1] === 'click-to-play', `round resumed on both (${after})`);
  const shifted = (await host.evaluate(() => window.__game.match.startedAt)) - before;
  check(shifted > 1500, `round clock didn't count the pause (moved on by ${(shifted / 1000).toFixed(1)} s)`);
  await sleep(800);
  const synced = await host.evaluate(() => !!window.__game.match.remoteState());
  check(synced, 'positions flowing again after the blip');

  // --- the guest closes the tab ---
  await bb.close();
  await sleep(800);
  check(await paused(host), 'host paused when the guest closed the tab');

  // --- a new page joins with the invite: the old round is gone, both go to the lobby ---
  guest = await open(bc, 'guest2');
  await guest.goto(`${BASE}?room=${code}`, { waitUntil: 'networkidle0' });
  await guest.waitForFunction('window.__game');
  await host.waitForFunction(() => !window.__game.match && document.querySelector('#lobby').classList.contains('show'), { timeout: 8000 });
  await guest.waitForFunction(() => !document.querySelector('#ready-game').disabled && !window.__game.lobby.ready, { timeout: 8000 });
  await guest.click('#ready-game');
  await host.waitForFunction(() => !document.querySelector('#start-game').disabled, { timeout: 8000 });
  check(true, 'new guest joined: host back in the lobby with Start enabled');

  // --- the host reloads the page: they get the room back, as host ---
  await host.reload({ waitUntil: 'networkidle0' });
  await host.waitForFunction('window.__game');
  await host.waitForFunction(() => document.querySelector('#lobby').classList.contains('show'), { timeout: 8000 });
  const back = await host.evaluate(() => ({ host: window.__game.lobby.host, code: document.querySelector('#lobby-code').textContent }));
  check(back.host && back.code === code, `host reloaded and is host of ${back.code} again`);
  await guest.waitForFunction(() => !document.querySelector('#ready-game').disabled && !window.__game.lobby.ready, { timeout: 8000 });
  await guest.click('#ready-game');
  await host.waitForFunction(() => !document.querySelector('#start-game').disabled, { timeout: 8000 });
  check(true, 'host sees the guest after reloading');
  const guestView = await guest.evaluate(() => ({ lobby: document.querySelector('#lobby').classList.contains('show'), partner: window.__game.lobby.partner }));
  check(guestView.lobby && guestView.partner, 'guest still in the lobby with the host');
} catch (e) {
  ok = false;
  console.log('FAIL', e.message);
} finally {
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));
}
console.log(ok ? '\nall good' : '\nsome checks failed');
process.exit(ok ? 0 : 1);
