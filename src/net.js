// All networking goes through this module so the transport can be swapped.
//   createRoom() -> code   joinRoom(code)   send(type, payload)   on(type, cb) -> off()   leave()
//
// Transport: our own WebSocket relay (server/relay.mjs), at VITE_RELAY_URL if set,
// otherwise: in production wss://<same host>/relay (Caddy forwards it), in dev
// ws://<same hostname>:8788 (`npm run dev` starts the relay; the hostname makes
// it work from a phone on the same Wi-Fi too).
// The connection reconnects by itself and rejoins the same room.
// Dev-only: ?localnet uses BroadcastChannel instead (tabs of one browser, no relay).

const LOCAL = import.meta.env.DEV && new URLSearchParams(location.search).has('localnet');
const RELAY = LOCAL ? null
  : import.meta.env.VITE_RELAY_URL
    || (import.meta.env.DEV ? `ws://${location.hostname}:8788`
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay`);

const handlers = new Map(); // type -> Set(cb)
const id = Math.random().toString(36).slice(2, 10); // this client, to drop our own echoes
let transport = null;
let room = null;

function dispatch(msg) {
  if (!msg || msg.from === id) return;
  handlers.get(msg.t)?.forEach((cb) => cb(msg.d ?? {}, msg));
  handlers.get('*')?.forEach((cb) => cb(msg.d ?? {}, msg));
}

// WebSocket relay with automatic reconnect. first: { $: 'create' } or { $: 'join', room }
function relayTransport(first) {
  let ws = null, closed = false, retry = 0, timer = null;
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
      if (msg.$ === 'created' || msg.$ === 'joined') { room = msg.room; settle?.resolve(room); settle = null; return; }
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
      retry++;
      timer = setTimeout(connect, Math.min(4000, 500 * retry));
    };
    ws.onerror = () => {};
  };

  const api = {
    ready,
    send: (msg) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
    close: () => { closed = true; clearTimeout(timer); ws?.close(); },
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
  leave() {
    if (transport) {
      try { transport.send({ t: 'bye', d: {}, from: id }); } catch {}
      transport.close();
    }
    transport = null; room = null;
  },
};
