// Vercel Routing Middleware: the whole site (the game, its pictures and sounds) is behind a
// password page in the main menu's style. The password is SITE_PASSWORD in the Vercel project's
// environment variables (never in the code); without it set, the site stays locked. Once it's
// entered, a cookie (a hash of the password: it can't be made without knowing it) keeps the
// browser in for 30 days, and changing the password signs everyone out. The page asked for is
// kept through the sign-in, so invite links (?room=ABCD) still work.
import { next } from '@vercel/functions';

export const config = { matcher: '/:path*' };

const COOKIE = 'ht_pass';
const UNLOCK = '/__unlock';
const DAYS = 30;

async function token(password) {
  const data = new TextEncoder().encode(`hunted-treasure:${password}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

// compare without leaking how much matched through the time it takes
function same(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

const cookieOf = (request) => request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]+)`))?.[1] || '';
// only ever back to a page of this site
const safeNext = (v) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith(UNLOCK) ? v : '/');
const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default async function middleware(request) {
  const want = process.env.SITE_PASSWORD;
  const url = new URL(request.url);
  const good = want ? await token(want) : null;

  if (url.pathname === UNLOCK && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const to = safeNext(form?.get('next'));
    if (good && same(await token(String(form?.get('password') ?? '')), good)) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: to,
          'Set-Cookie': `${COOKIE}=${good}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return page(to, true);
  }

  if (good && same(cookieOf(request), good)) return next();
  return page(url.pathname + url.search, false);
}

function page(to, wrong) {
  return new Response(html(safeNext(to), wrong), {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// the page: like the main menu (the brand line, the big title, the red tagline), with one field
const html = (to, wrong) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Hunted Treasure</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@500;600&family=Barlow+Condensed:wght@500;600;700&family=Bebas+Neue&display=swap" rel="stylesheet" />
<style>
  :root {
    --red: #ff4655; --navy: #0f1923; --ink: #ece8e1; --muted: rgba(236, 232, 225, 0.55); --line: rgba(236, 232, 225, 0.14);
    --head: 'Bebas Neue', 'Barlow Condensed', sans-serif; --cond: 'Barlow Condensed', 'Barlow', sans-serif; --body: 'Barlow', system-ui, sans-serif;
    --cut: polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    min-height: 100vh; color: var(--ink); font-family: var(--body); overflow-x: hidden;
    /* the woods at night: dark trunks against a faint glow, darker towards the menu side */
    background:
      linear-gradient(90deg, rgba(15, 25, 35, 0.95) 0%, rgba(15, 25, 35, 0.7) 40%, rgba(15, 25, 35, 0.15) 75%),
      repeating-linear-gradient(90deg, transparent 0 7%, rgba(5, 9, 13, 0.85) 7% 8.2%, transparent 8.2% 15%, rgba(5, 9, 13, 0.6) 15% 15.8%, transparent 15.8% 23%),
      radial-gradient(ellipse at 72% 55%, rgba(120, 140, 160, 0.22), transparent 55%),
      radial-gradient(ellipse at 80% 100%, rgba(255, 70, 85, 0.12), transparent 50%),
      var(--navy);
  }
  main { position: relative; display: flex; align-items: center; min-height: 100vh; padding: 32px clamp(16px, 7vw, 120px); }
  .col { width: min(460px, 100%); animation: in 0.5s ease; }
  .brand { display: flex; align-items: center; gap: 10px; font: 600 13px var(--cond); letter-spacing: 0.3em; text-transform: uppercase; color: var(--muted); }
  .mark { width: 22px; height: 22px; background: var(--red); clip-path: polygon(0 0, 100% 0, 100% 70%, 70% 100%, 0 100%); }
  h1 { font: 400 clamp(72px, 12vw, 150px)/0.85 var(--head); letter-spacing: 0.01em; margin: 10px 0 8px; text-transform: uppercase; text-shadow: 0 6px 30px rgba(0, 0, 0, 0.5); }
  .tag { font: 600 15px var(--cond); letter-spacing: 0.3em; text-transform: uppercase; color: var(--red); margin: 0 0 40px; }
  form { background: rgba(15, 25, 35, 0.78); border-left: 3px solid var(--red); padding: 26px 28px 28px; backdrop-filter: blur(6px); }
  label { display: block; font: 600 13px var(--cond); letter-spacing: 0.28em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; }
  .row { display: flex; gap: 10px; }
  input {
    flex: 1; min-width: 0; background: rgba(5, 9, 13, 0.6); border: 1px solid var(--line); border-bottom: 2px solid var(--muted); color: var(--ink);
    font: 500 18px var(--body); letter-spacing: 0.08em; padding: 12px 14px; outline: none; transition: border-color 0.15s;
  }
  input:focus { border-bottom-color: var(--red); }
  button {
    border: 1px solid var(--red); background: var(--red); color: #fff; font: 400 26px/1 var(--head); letter-spacing: 0.12em;
    padding: 12px 26px 9px; cursor: pointer; clip-path: var(--cut); transition: background 0.15s, color 0.15s;
  }
  button:hover, button:focus-visible { background: #fff; color: var(--red); outline: none; }
  .err { min-height: 20px; margin: 12px 0 0; font: 600 13px var(--cond); letter-spacing: 0.18em; text-transform: uppercase; color: var(--red); }
  .wrong form { animation: shake 0.4s; }
  @keyframes in { from { opacity: 0; transform: translateX(-16px); } }
  @keyframes shake { 20%, 60% { transform: translateX(-8px); } 40%, 80% { transform: translateX(8px); } }
  @media (prefers-reduced-motion: reduce) { .col, .wrong form { animation: none; } }
</style>
</head>
<body class="${wrong ? 'wrong' : ''}">
<main>
  <div class="col">
    <div class="brand"><span class="mark"></span>Private game</div>
    <h1>Hunted Treasure</h1>
    <p class="tag">1v1 · One hunts · One searches</p>
    <form method="post" action="${UNLOCK}">
      <label for="pw">Password</label>
      <div class="row">
        <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required />
        <button type="submit">Enter</button>
      </div>
      <input type="hidden" name="next" value="${esc(to)}" />
      <p class="err">${wrong ? 'Wrong password' : ''}</p>
    </form>
  </div>
</main>
</body>
</html>`;
