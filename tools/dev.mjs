// `npm run dev`: starts the relay (unless one is already running) and Vite together.
// Extra arguments go to Vite, e.g. `npm run dev -- --host` to play from a phone on your Wi-Fi.
// If the relay we found running goes away later (someone else's, e.g. a test run), we start
// our own, so the game never ends up without one.
import { spawn } from 'node:child_process';

const relayUp = () => fetch('http://localhost:8788/', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);

let relay = null;
function startRelay() {
  relay = spawn(process.execPath, ['server/relay.mjs'], { stdio: 'inherit' });
  relay.on('exit', (code) => {
    if (code) console.error(`relay stopped (exit ${code})`);
    relay = null;
  });
}

if (await relayUp()) console.log('relay already running on :8788');
else startRelay();
const watch = setInterval(async () => {
  if (relay || await relayUp()) return;
  console.log('relay on :8788 went away; starting our own');
  startRelay();
}, 3000);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], { stdio: 'inherit' });
const stop = () => { clearInterval(watch); relay?.kill(); vite.kill(); };
vite.on('exit', (code) => { stop(); process.exit(code ?? 0); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
