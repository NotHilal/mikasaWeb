// Vercel Routing Middleware: the whole site (the game, its pictures and sounds) asks for a password
// first, the browser's own sign-in box. Any user name works; the password is SITE_PASSWORD in the
// Vercel project's environment variables. Without it set, the site stays locked.
import { next } from '@vercel/functions';

export const config = { matcher: '/:path*' };

// compare without leaking how much matched through the time it takes
function same(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export default function middleware(request) {
  const want = process.env.SITE_PASSWORD;
  const auth = request.headers.get('authorization') || '';
  if (want && auth.startsWith('Basic ')) {
    let pass = '';
    try { pass = atob(auth.slice(6)).split(':').slice(1).join(':'); } catch {}
    if (same(pass, want)) return next();
  }
  return new Response('Password needed.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Hunted Treasure", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}
