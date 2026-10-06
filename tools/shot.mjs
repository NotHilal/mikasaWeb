// Screenshot the game in a headless browser.
//   node tools/shot.mjs <url> <out.png> [waitMs] [w] [h] [--eval "js to run after load"]
// Uses the real GPU; set SOFTWARE=1 to render with SwiftShader instead.
import puppeteer from 'puppeteer-core';
import { CHROME } from './browser.mjs';

const args = process.argv.slice(2);
const evalAt = args.indexOf('--eval');
const code = evalAt >= 0 ? args.splice(evalAt, 2)[1] : null;
const [url, out, wait = '4000', w = '1280', h = '720'] = args;
const gpu = process.env.SOFTWARE
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [...gpu, '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await page.waitForFunction('window.__game', { timeout: 120000 });
if (code) { const res = await page.evaluate(code); if (res !== undefined) console.log(JSON.stringify(res)); }
await new Promise((r) => setTimeout(r, +wait));
await page.screenshot({ path: out });
if (logs.length) console.log(logs.join('\n'));
await browser.close();
