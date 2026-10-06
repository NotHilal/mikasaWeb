// All networking goes through this module so the transport can be swapped.
//   createRoom() -> code   joinRoom(code)   send(type, payload)   on(type, cb) -> off()   leave()
//
// Transport: our own WebSocket relay (server/relay.mjs), at VITE_RELAY_URL if set,
// otherwise: in production wss://<same host>/relay (Caddy forwards it), in dev
// ws://<same hostname>:8788 (`npm run dev` starts the relay; the hostname makes
// it work from a phone on the same Wi-Fi too).
// The connection reconnects by itself and rejoins the same room.
// Local events (not sent by the other player): 'link' { up } when our own connection drops
// or comes back, 'peer' { here } when the other player connects or drops.
// Dev-only: ?localnet uses BroadcastChannel instead (tabs of one browser, no relay).

const LOCAL = import.meta.env.DEV && new URLSearchParams(location.search).has('localnet');
const RELAY = LOCAL ? null
  : import.meta.env.VITE_RELAY_URL
    || (import.meta.env.DEV ? `ws://${location.hostname}:8788`
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay`);

const handlers = new Map(); // type -> Set(cb)
// this client, to drop our own echoes. Kept for the tab's lifetime, so after a reload the
// relay knows it's the same player and frees the old seat instead of saying the room is full.
const id = (() => {
  try {
    const saved = sessionStorage.getItem('woods-id');
    if (saved) return saved;
    const fresh = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('woods-id', fresh);
    return fresh;
  } catch { return Math.random().toString(36).slice(2, 10); }
})();
let transport = null;
let room = null;

const emit = (type, d) => handlers.get(type)?.forEach((cb) => cb(d, null));

function dispatch(msg) {
  if (!msg || msg.from === id) return;
  handlers.get(msg.t)?.forEach((cb) => cb(msg.d ?? {}, msg));
  handlers.get('*')?.forEach((cb) => cb(msg.d ?? {}, msg));
}

// WebSocket relay with automatic reconnect. first: { $: 'create' } or { $: 'join', room }
function relayTransport(first) {
  let ws = null, closed = false, retry = 0, timer = null, hold = 0;
  let settle; // resolves/rejects the first create/join
  const ready = new Promise((resolve, reject) => { settle = { resolve, reject }; });

  const connect = () => {
    ws = new WebSocket(`${RELAY}?id=${id}`);
    ws.onopen = () => {
      retry = 0;
      // after a reconnect, rejoin the room we were in
      ws.send(JSON.stringify(room ? { $: 'join', room, rejoin: true } : first));
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.$ === 'created' || msg.$ === 'joined') {
        room = msg.room;
        settle?.resolve(room); settle = null;
        emit('link', { up: true });
        emit('peer', { here: (msg.peers ?? 0) > 0 });
        return;
      }
      if (msg.$ === 'peer') { emit('peer', { here: !!msg.here }); return; }
      if (msg.$ === 'error') {
        if (settle) { settle.reject(new Error(msg.msg)); settle = null; api.close(); }
        return;
      }
      dispatch(msg);
    };
    ws.onclose = () => {
      if (closed) return;
      // first attempt failed outright: report it instead of retrying forever
      if (settle && retry >= 3) { settle.reject(new Error("Can't reach the game server. Check your connection.")); settle = null; closed = true; return; }
      if (!settle && retry === 0) emit('link', { up: false });
      retry++;
      timer = setTimeout(connect, Math.max(hold, Math.min(4000, 500 * retry)));
      hold = 0;
    };
    ws.onerror = () => {};
  };

  const api = {
    ready,
    send: (msg) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
    close: () => { closed = true; clearTimeout(timer); ws?.close(); },
    drop: (ms) => { hold = ms; ws?.close(); },
  };
  connect();
  return api;
}

function localTransport(code) {
  const bc = new BroadcastChannel(`woods-${code}`);
  bc.onmessage = (e) => dispatch(e.data);
  return { ready: Promise.resolve(code), send: (msg) => bc.postMessage(msg), close: () => bc.close() };
}

// four letters, no look-alikes (I/O/0/1); only used for the local test transport
function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

export const net = {
  id,
  get online() { return !!RELAY; },
  get room() { return room; },
  async createRoom() {
    net.leave();
    if (!RELAY) { room = randomCode(); transport = localTransport(room); return room; }
    transport = relayTransport({ $: 'create' });
    return transport.ready;
  },
  async joinRoom(code) {
    net.leave();
    code = code.trim().toUpperCase();
    if (!RELAY) { room = code; transport = localTransport(code); return room; }
    transport = relayTransport({ $: 'join', room: code });
    return transport.ready;
  },
  send(type, payload = {}) { transport?.send({ t: type, d: payload, from: id }); },
  on(type, cb) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(cb);
    return () => handlers.get(type)?.delete(cb);
  },
  // tests: cut the connection as if the network dropped, and stay offline for `ms`
  simulateDrop(ms = 2000) { transport?.drop?.(ms); },
  leave() {
    if (transport) {
      try { transport.send({ t: 'bye', d: {}, from: id }); } catch {}
      transport.close();
    }
    transport = null; room = null;
  },
};
