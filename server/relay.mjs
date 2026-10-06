// Relay: a tiny WebSocket server that passes messages between the two
// players of a room. It knows nothing about the game; it only forwards.
//
//   node server/relay.mjs            (PORT env, default 8788)
//
// Client → server control messages:
//   { $: 'create' }                  → { $: 'created', room }
//   { $: 'join', room, rejoin? }     → { $: 'joined', room } | { $: 'error', msg }
//     (rejoin: sent after a reconnect; recreates the room if the server restarted)
// Everything else is forwarded as-is to the other socket(s) in the room.
// Rooms survive for a while after everyone drops, so players can reconnect
// with the same code after a network blip.
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';

const PORT = +process.env.PORT || 8788;
const MAX_PER_ROOM = 2;
const ROOM_TTL_MS = 30 * 60 * 1000;  // keep an empty room this long for reconnects
const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 80;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const rooms = new Map(); // code -> { sockets: Set, emptySince: number|null }

function newCode() {
  for (let i = 0; i < 1000; i++) {
    const code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
    if (!rooms.has(code)) return code;
  }
  throw new Error('no free room codes');
}

function enter(ws, code) {
  const room = rooms.get(code);
  // replace a stale socket of the same client (reconnect before the old one timed out)
  for (const other of room.sockets) if (other.clientId && other.clientId === ws.clientId) { room.sockets.delete(other); other.terminate(); }
  if (room.sockets.size >= MAX_PER_ROOM) return false;
  room.sockets.add(ws);
  room.emptySince = null;
  ws.room = code;
  return true;
}

function leave(ws) {
  const room = ws.room && rooms.get(ws.room);
  if (!room) return;
  room.sockets.delete(ws);
  if (!room.sockets.size) room.emptySince = Date.now();
}

const send = (ws, obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };

// plain HTTP answers health checks; WebSocket upgrades go to the relay
const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`woods relay ok · ${rooms.size} rooms\n`);
});
const wss = new WebSocketServer({ server: http, maxPayload: MAX_MSG_BYTES });

wss.on('connection', (ws, req) => {
  ws.alive = true;
  ws.clientId = new URL(req.url, 'http://x').searchParams.get('id')?.slice(0, 32) || null;
  ws.budget = MAX_MSGS_PER_SEC;
  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', (raw) => {
    if (--ws.budget < 0) return; // flood protection: drop, don't disconnect
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg && msg.$) {
      if (msg.$ === 'create') {
        const code = newCode();
        rooms.set(code, { sockets: new Set(), emptySince: null });
        enter(ws, code);
        send(ws, { $: 'created', room: code });
      } else if (msg.$ === 'join') {
        const code = String(msg.room || '').toUpperCase().slice(0, 8);
        if (!rooms.has(code)) {
          if (!msg.rejoin || !/^[A-Z]{4}$/.test(code)) return send(ws, { $: 'error', msg: `No room called ${code}` });
          rooms.set(code, { sockets: new Set(), emptySince: null });
        }
        if (ws.room !== code) leave(ws);
        if (!enter(ws, code)) return send(ws, { $: 'error', msg: `Room ${code} is full` });
        send(ws, { $: 'joined', room: code });
      }
      return;
    }
    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    const data = raw.toString();
    for (const other of room.sockets) if (other !== ws && other.readyState === other.OPEN) other.send(data);
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

// heartbeat: drop dead sockets, refill message budgets, forget old empty rooms
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 15000);
setInterval(() => { for (const ws of wss.clients) ws.budget = MAX_MSGS_PER_SEC; }, 1000);
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) if (room.emptySince && now - room.emptySince > ROOM_TTL_MS) rooms.delete(code);
}, 60000);

http.listen(PORT, () => console.log(`woods relay listening on :${PORT}`));
