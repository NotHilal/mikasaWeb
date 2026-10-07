// Boot, the menu/lobby flow and the main loop.
import * as THREE from 'three';
import { createEngine } from './engine.js';
import { buildWorld } from './world/world.js';
import { createFlashlight } from './flashlight.js';
import { Player } from './player.js';
import { createViewmodel, createHunterArms } from './viewmodel.js';
import { Effects } from './effects.js';
import { loadIso } from './iso.js';
import { loadSlender } from './slender.js';
import { loadNocturnum } from './skins/nocturnum.js';
import { hunterFigure, seekerFigure, addXray } from './figures.js';
import { renderRolePortraits } from './portraits.js';
import { drawRecap, recapStats } from './recap.js';
import { Match } from './match.js';
import { Duel, NAME } from './duel.js';
import { openHowto, stepHowto, gotoHowto } from './howto.js';
import { openPuzzle, openCard } from './gift.js';
import { PAGES } from './config.js';
import { net } from './net.js';
import { audio } from './audio.js';
import { settings, saveSettings } from './settings.js';
import { ACTIONS, DEFAULT_KEYS, bindIn, saveKeys, label, keyLabel, mouseCode } from './keys.js';
import { $, show, screen, toast } from './ui.js';

const engine = createEngine($('#view'));
const canvas = engine.renderer.domElement;

// --- loading ------------------------------------------------------------------
const manager = new THREE.LoadingManager();
manager.onProgress = (_, done, total) => { $('#load-fill').style.width = `${(done / total) * 100}%`; };
const loaded = new Promise((res) => { manager.onLoad = res; });

// Iso (the seeker's model) loads alongside the forest; if it fails, the seeker falls back to a simple figure
const isoLoading = loadIso(manager).catch((e) => console.warn('Iso model failed to load', e));
// Slenderman (the hunter's model) too; without it the hunter is a simple figure
const slenderLoading = loadSlender(manager).catch((e) => console.warn('Slenderman model failed to load', e));
// and the Classic (without it, a stand-in traced from the picture)
const gunLoading = loadNocturnum(manager).catch((e) => console.warn('Classic model failed to load', e));
const world = await buildWorld(engine.scene, manager);
await Promise.all([isoLoading, slenderLoading, gunLoading]);
const flashlight = createFlashlight(engine.scene);
const player = new Player(engine.camera, world, canvas);
const viewmodel = createViewmodel(engine.viewScene);
const hunterArms = createHunterArms(engine.viewScene);
const effects = new Effects(engine.scene, world, () => engine.scale);
// the page handwriting is drawn on canvases, so its font must be loaded first
await Promise.all([loaded, document.fonts.load('64px "Caveat"'), document.fonts.ready]);
// Compile every shader once now, so nothing stalls later: what's in the world, plus what a round
// adds (both characters and their x-ray copies, a page, the hunter's grabbing arms), drawn once
// out of sight and taken away again.
function prewarm() {
  const extra = [hunterFigure(), seekerFigure()].map((f) => {
    addXray(f);
    f.userData.xray.visible = true;
    f.position.set(0, -100, 0);
    engine.scene.add(f);
    return f;
  });
  const pages = world.placePages(world.pickPages(1));
  hunterArms.update(0, engine.camera, 1, 0);
  engine.renderer.compile(engine.scene, engine.camera);
  engine.renderer.compile(engine.viewScene, engine.camera);
  engine.render(0); // (and their shadows)
  engine.scene.remove(...extra);
  for (const p of pages) { engine.scene.remove(p.mesh); p.mesh.material.map.dispose(); p.mesh.material.dispose(); }
  hunterArms.update(0, engine.camera, 0, 0);
}
prewarm();
viewmodel.visible = false;

// --- lobby state ----------------------------------------------------------------
// ready: the guest has pressed Ready (the host can only start once they have). The host keeps
// the real value and sends it with the lobby; the guest's copy follows it.
const lobby = { host: false, hostRole: 'seeker', partner: false, ready: false };
let match = null; // what's being played: a Match (hide and seek) or a Duel (the final duel)
const myRole = () => (lobby.host ? lobby.hostRole : lobby.hostRole === 'seeker' ? 'hunter' : 'seeker');

function renderLobby() {
  $('#lobby-code').textContent = net.room ?? '----';
  for (const el of document.querySelectorAll('.role')) {
    const role = el.dataset.role;
    const mine = role === myRole();
    el.classList.toggle('mine', mine);
    el.disabled = !lobby.host;
    // the guest's card says when they're ready
    const who = el.querySelector('.role-who');
    const guestCard = mine !== lobby.host && (mine || lobby.partner);
    who.textContent = (mine ? 'You' : lobby.partner ? 'Your friend' : '') + (guestCard && lobby.ready ? ' · Ready' : '');
    who.classList.toggle('ready', guestCard && lobby.ready);
    el.classList.toggle('ready-card', guestCard && lobby.ready);
  }
  $('#role-note').textContent = lobby.host ? 'Click a role to switch. Your friend gets the other one.' : 'The host picks the roles.';
  $('#start-game').disabled = !(lobby.host && lobby.partner && lobby.ready);
  $('#start-game').classList.toggle('go', !$('#start-game').disabled);
  // the big ready banner (once there are two of us)
  const banner = $('#ready-banner');
  banner.classList.toggle('show', lobby.partner);
  banner.classList.toggle('on', lobby.ready);
  $('#ready-banner-text').textContent = lobby.host
    ? (lobby.ready ? '✓ Your friend is ready' : 'Waiting for your friend to ready up')
    : (lobby.ready ? "✓ You're ready" : 'Press Ready when you are set');
  $('#start-game').style.display = lobby.host ? '' : 'none';
  const ready = $('#ready-game');
  ready.style.display = lobby.host ? 'none' : '';
  ready.disabled = !lobby.partner;
  ready.classList.toggle('on', lobby.ready);
  ready.textContent = lobby.ready ? 'Ready ✓' : 'Ready';
  $('#lobby-status').style.display = lobby.partner ? 'none' : ''; // (the banner says it then)
  $('#lobby-status').textContent = !lobby.partner
    ? (lobby.host ? 'Waiting for the second player… Send them the code or the invite link.' : 'Waiting for the host…')
    : lobby.host
      ? (lobby.ready ? 'Your friend is ready. Lock in to start.' : 'Your friend is here. Waiting for them to press Ready.')
      : (lobby.ready ? "You're ready. Waiting for the host to start." : 'Connected. Press Ready when you are set.');
}

function sendLobby() { net.send('lobby', { hostRole: lobby.hostRole, ready: lobby.ready }); }

// the guest says whether they're ready
net.on('ready', ({ ready }) => {
  if (!lobby.host || match) return;
  if (ready && !lobby.ready) audio.play('ready', null, 3); // (the big banner shows it)
  lobby.ready = !!ready;
  if (screen() === 'lobby') renderLobby();
});

// 'hi' comes from a page that just opened (or reloaded), so it has no round running:
// if we're in one, that round is gone for them, and we both go back to the lobby
net.on('hi', () => {
  const was = lobby.partner;
  lobby.partner = true;
  if (match) { endMatch(); show('lobby'); toast('The other player reloaded. Back to the lobby'); }
  if (lobby.host) lobby.ready = false; // a page that just opened hasn't pressed Ready
  if (lobby.host) sendLobby();
  if (screen() === 'lobby') renderLobby();
});
net.on('lobby', ({ hostRole, ready }) => {
  if (lobby.host) return;
  // the host only sends this from the lobby, so they've left the round (a reload)
  if (match) { endMatch(); show('lobby'); toast('The host reloaded. Back to the lobby'); }
  lobby.partner = true;
  lobby.hostRole = hostRole;
  lobby.ready = !!ready;
  if (screen() === 'lobby') renderLobby();
});
net.on('start', ({ seed, hostRole }) => {
  lobby.hostRole = hostRole;
  startMatch(seed);
});
net.on('bye', () => {
  lobby.partner = false;
  // (the seeker opening the gift stays on it)
  if (['puzzle', 'letter'].includes(screen())) return;
  if (match) endMatch();
  if (lobby.host) {
    toast('The other player left');
    show('lobby');
    renderLobby();
  } else {
    toast('The host left the game');
    net.leave();
    show('menu');
  }
});
// after a round, both players vote (1/2, 2/2) to go back to the lobby, or, when the seeker found
// every page, on to the final duel; both votes and it happens
const vote = { mine: false, theirs: false, duel: false };
function renderVote() {
  const n = (vote.mine ? 1 : 0) + (vote.theirs ? 1 : 0);
  const btn = $('#end-lobby');
  btn.textContent = `${vote.duel ? 'Final duel' : 'Back to lobby'} ${n}/2`;
  btn.classList.toggle('voted', vote.mine);
  btn.classList.toggle('asked', vote.theirs && !vote.mine); // they're waiting on me
  $('#end-vote-note').textContent = vote.mine && !vote.theirs ? 'Waiting for your friend…'
    : vote.theirs && !vote.mine ? (vote.duel ? 'Your friend is ready for the duel' : 'Your friend wants a rematch') : '';
}
function checkVote() {
  renderVote();
  if (!(vote.mine && vote.theirs && match)) return;
  if (vote.duel) startDuel();
  else { endMatch(); show('lobby'); renderLobby(); }
}
net.on('vote', ({ on }) => { if (!match) return; vote.theirs = !!on; checkVote(); });

// --- the final duel ------------------------------------------------------------------------
// At its end both vote again: Try again (Iso lost) or Continue (Iso won: the seeker opens the
// gift). Main menu takes both players back to the menu.
const dvote = { mine: false, theirs: false, kind: null };
function startDuel() {
  endMatch();
  Object.assign(dvote, { mine: false, theirs: false, kind: null });
  match = new Duel({ engine, player, flashlight, viewmodel, effects }, { role: myRole(), host: lobby.host }, onDuelEnd);
  $('#ctp-eyebrow').textContent = 'Final duel';
  takeMouse();
}
function onDuelEnd({ winner, score, rounds }) {
  document.exitPointerLock();
  releaseKeys();
  const isoWon = winner === 'seeker', won = winner === myRole();
  dvote.kind = isoWon ? 'continue' : 'again';
  $('#de-title').textContent = won ? 'Victory' : 'Defeat';
  $('#de-sub').textContent = `${NAME.seeker} ${isoWon ? 'wins' : 'lost'} the final duel · ${score.seeker} – ${score.hunter}`;
  $('#de-rounds').innerHTML = rounds.map((w, i) => `<span class="${w}">Round ${i + 1} · ${NAME[w]}</span>`).join('');
  $('#duel-end').classList.toggle('win', won);
  $('#duel-end').classList.toggle('lose', !won);
  $('#de-again').style.display = isoWon ? 'none' : '';
  $('#de-menu').style.display = isoWon ? 'none' : '';
  $('#de-continue').style.display = isoWon ? '' : 'none';
  renderDuelVote();
  setTimeout(() => { if (match?.over) show('duel-end'); }, 400);
}
function renderDuelVote() {
  const n = (dvote.mine ? 1 : 0) + (dvote.theirs ? 1 : 0);
  const btn = dvote.kind === 'continue' ? $('#de-continue') : $('#de-again');
  btn.textContent = `${dvote.kind === 'continue' ? 'Continue' : 'Try again'} ${n}/2`;
  btn.classList.toggle('voted', dvote.mine);
  btn.classList.toggle('asked', dvote.theirs && !dvote.mine);
  $('#de-note').textContent = dvote.mine && !dvote.theirs ? 'Waiting for your friend…'
    : dvote.theirs && !dvote.mine ? (dvote.kind === 'continue' ? 'Your friend pressed Continue' : 'Your friend wants to try again') : '';
}
function checkDuelVote() {
  renderDuelVote();
  if (!(dvote.mine && dvote.theirs && match?.over)) return;
  if (dvote.kind === 'again') startDuel();
  else openGift();
}
net.on('dvote', ({ on }) => { if (!match?.over) return; dvote.theirs = !!on; checkDuelVote(); });
net.on('dmenu', () => {
  if (!match?.over) return;
  leaveToMenu();
  toast('Your friend went back to the menu');
});

// Dev only (npm run dev, never in a build): F6 jumps straight into the final duel, for testing. In a
// room with the other player both go (with the roles picked in the lobby); on your own you get the
// arena to yourself, as Iso.
if (import.meta.env.DEV) {
  addEventListener('keydown', (e) => {
    if (e.code !== 'F6') return;
    e.preventDefault(); // (the browser's own F6 goes to the address bar)
    if (lobby.partner) net.send('devduel', {});
    else if (!net.room) { lobby.host = true; lobby.hostRole = 'seeker'; }
    startDuel();
  });
  net.on('devduel', () => startDuel());
}

// the gift: the seeker puts the pieces together and reads the message; the hunter waits
let closePuzzle = null;
function openGift() {
  endMatch();
  if (myRole() === 'seeker') {
    show('puzzle');
    openPuzzle({
      onDone: () => net.send('gift', { stage: 'done' }),
      onRead: () => {
        show('letter');
        openCard({
          onFlip: () => net.send('gift', { stage: 'read' }),
          onScratched: () => { audio.play('roundWin'); net.send('gift', { stage: 'scratched' }); },
        });
      },
    }).then((close) => { closePuzzle = close; });
  } else {
    $('#gw-note').textContent = `She is putting the ${PAGES} pieces together…`;
    show('gift-wait');
  }
}
net.on('gift', ({ stage }) => {
  if (screen() !== 'gift-wait') return;
  $('#gw-note').textContent = stage === 'scratched' ? 'She scratched it off: she knows!' : stage === 'read' ? 'She is reading the message.' : 'The picture is whole. Now the card…';
});

// --- dropped connections: the round pauses for both players until everyone's back ------
const WAIT_MS = 60000; // give up on a dropped player after this long
const conn = { up: true, peer: false };
let waitTick = 0;

net.on('link', ({ up }) => { conn.up = up; checkConnection(); });
net.on('peer', ({ here }) => {
  const was = conn.peer;
  conn.peer = here;
  if (!match) {
    if (here) {
      // say hello again (after either of us reconnected), so the lobby is in sync
      if (lobby.host) sendLobby(); else net.send('hi', {});
    } else if (was && lobby.partner) {
      lobby.partner = false;
      lobby.ready = false;
      toast(lobby.host ? 'Your friend disconnected' : 'The host disconnected');
      if (screen() === 'lobby') renderLobby();
    }
  }
  checkConnection();
});

function checkConnection() {
  if (!match || match.over) return;
  const lost = net.online && (!conn.up || !conn.peer); // (the ?localnet test transport has no relay to tell us)
  if (lost && !match.pausedAt) {
    match.setPaused(true);
    show('waiting');
    document.exitPointerLock();
    clearInterval(waitTick);
    waitTick = setInterval(renderWaiting, 250);
    renderWaiting();
  } else if (!lost && match.pausedAt) {
    clearInterval(waitTick);
    match.setPaused(false);
    takeMouse();
    toast('Everyone is back. Round resumed');
  }
}

function renderWaiting() {
  if (!match?.pausedAt) { clearInterval(waitTick); return; }
  const left = Math.max(0, WAIT_MS - (performance.now() - match.pausedAt));
  $('#waiting-title').textContent = conn.up ? 'Player disconnected' : 'Connection lost';
  $('#waiting-note').textContent = (conn.up ? 'Waiting for the other player to reconnect' : 'Reconnecting to the game server')
    + ` · ${Math.ceil(left / 1000)}s`;
  if (left > 0) return;
  // they're not coming back
  clearInterval(waitTick);
  if (!conn.up) { leaveToMenu(); toast('Lost connection to the game server', 5000); }
  else if (lobby.host) { endMatch(); lobby.partner = false; show('lobby'); renderLobby(); toast("Your friend didn't come back", 5000); }
  else { leaveToMenu(); toast("The host didn't come back", 5000); }
}

// the host's room code, kept for this tab, so a reload rejoins as the host
const HOST_KEY = 'woods-host';
const hostRoom = () => { try { return sessionStorage.getItem(HOST_KEY); } catch { return null; } };
const setHostRoom = (code) => { try { code ? sessionStorage.setItem(HOST_KEY, code) : sessionStorage.removeItem(HOST_KEY); } catch {} };

async function createGame() {
  try {
    lobby.host = true; lobby.partner = false;
    show('lobby');
    $('#lobby-status').textContent = 'Creating room…';
    await net.createRoom();
    setHostRoom(net.room);
    history.replaceState(null, '', `?room=${net.room}`);
    renderLobby();
  } catch (e) {
    toast(e.message);
    show('menu');
  }
}

async function joinGame(code, asHost = false) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { $('#join-error').textContent = 'Codes are 4 letters.'; return; }
  $('#join-error').textContent = '';
  try {
    lobby.host = asHost; lobby.partner = false;
    $('#join-go').disabled = true;
    await net.joinRoom(code);
    net.send('hi', {});
    show('lobby');
    renderLobby();
  } catch (e) {
    if (asHost) setHostRoom(null);
    show('join');
    $('#join-code').value = code;
    $('#join-error').textContent = e.message;
  } finally {
    $('#join-go').disabled = false;
  }
}

function leaveToMenu() {
  if (match) endMatch();
  net.leave();
  setHostRoom(null);
  lobby.partner = false;
  history.replaceState(null, '', location.pathname);
  show('menu');
}

// Ctrl is crouch, so crouch-walking forward is Ctrl+W: the browser's "close the tab". A page can
// only keep that key (and Ctrl+T, Ctrl+N, …) with the Keyboard Lock API, which works in fullscreen
// (Chrome, Edge): so playing goes fullscreen and locks the keys. Esc isn't locked: it still frees
// the mouse (the pause menu) and leaves fullscreen; taking the mouse back goes fullscreen again.
// Where there's no keyboard lock (Firefox, Safari), closing the tab mid-round asks first.
const LOCKED_KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => `Key${c}`)
  .concat([...'0123456789'].map((d) => `Digit${d}`), ['Space', 'Tab', 'Enter']);
function holdKeys() {
  if (!navigator.keyboard?.lock || !document.documentElement.requestFullscreen) return;
  const lock = () => navigator.keyboard.lock(LOCKED_KEYS).catch(() => {});
  if (document.fullscreenElement) { lock(); return; }
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(lock, () => {});
}
// back in the menus the browser's own shortcuts work again (fullscreen stays until Esc)
const releaseKeys = () => { try { navigator.keyboard?.unlock(); } catch {} };
addEventListener('beforeunload', (e) => {
  if (match && !match.over) { e.preventDefault(); e.returnValue = ''; }
});

// --- matches -------------------------------------------------------------------
function startMatch(seed) {
  if (match) match.dispose();
  vote.mine = vote.theirs = false;
  lobby.ready = false; // back in the lobby afterwards, the guest readies up again
  match = new Match({ engine, world, player, flashlight, viewmodel, hunterArms, effects }, { seed, role: myRole() }, (result, recap) => {
    document.exitPointerLock();
    releaseKeys();
    vote.duel = result === 'pages'; // every page found: the final duel comes next
    const won = (result === 'pages') === (myRole() === 'seeker');
    $('#end-title').textContent = won ? 'Victory' : 'Defeat';
    $('#end-sub').textContent = result === 'pages' ? `All ${PAGES} pages found` : 'The seeker was caught';
    $('#end').classList.toggle('win', won);
    $('#end').classList.toggle('lose', !won);
    renderVote();
    $('#recap-stats').innerHTML = recapStats(recap, myRole()).map(([k, v, sub]) =>
      `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`).join('');
    setTimeout(() => { show('end'); drawRecap($('#recap-map'), world, recap); }, 600);
  });
  $('#ctp-eyebrow').textContent = 'Round starting';
  takeMouse();
}

function endMatch() {
  clearInterval(waitTick);
  closePuzzle?.();
  closePuzzle = null;
  match?.dispose();
  match = null;
  document.exitPointerLock();
  releaseKeys();
  flashlight.on = true;
}

// --- buttons ---------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]')?.dataset.go;
  if (!go) return;
  audio.start();
  if (go === 'create') createGame();
  else if (go === 'join') { show('join'); $('#join-code').focus(); }
  else if (go === 'settings') openSettings();
  else if (go === 'howto') { openHowto(); show('howto'); }
  else show(go);
});
document.addEventListener('pointerdown', () => audio.start(), { once: true });
$('#join-go').onclick = () => joinGame($('#join-code').value);

// a room code from pasted text: the code itself, or an invite link (…?room=ABCD)
function codeFrom(text) {
  const m = String(text).match(/[?&]room=([a-z]{4})\b/i) || String(text).trim().match(/^([a-z]{4})$/i) || String(text).match(/\b([a-z]{4})\b/i);
  return m ? m[1].toUpperCase() : null;
}
function pasteCode(text) {
  const code = codeFrom(text);
  if (!code) { $('#join-error').textContent = 'No room code in what you copied.'; return; }
  $('#join-code').value = code;
  joinGame(code);
}
$('#join-paste').onclick = async () => {
  try {
    pasteCode(await navigator.clipboard.readText());
  } catch {
    // reading the clipboard is blocked (a page opened over the home network, or permission refused)
    $('#join-code').focus();
    $('#join-error').textContent = 'Press Ctrl+V to paste.';
  }
};
// Ctrl+V into the box: take the code out of a pasted link too (the box only fits 4 letters)
$('#join-code').addEventListener('paste', (e) => {
  e.preventDefault();
  pasteCode(e.clipboardData.getData('text'));
});
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame($('#join-code').value); });
// copy to the clipboard; pages opened over http on a home network (not localhost) can't use
// the clipboard API, so fall back to the old way
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}
$('#copy-code').onclick = async () => {
  if (!net.room) { toast('The room is still being created'); return; }
  toast(await copyText(net.room) ? `Code ${net.room} copied` : `The code is ${net.room}`, 4000);
};
$('#copy-link').onclick = async () => {
  if (!net.room) { toast('The room is still being created'); return; }
  const link = `${location.origin}${location.pathname}?room=${net.room}`;
  if (await copyText(link)) toast('Invite link copied'); else toast(link, 6000);
};
document.querySelectorAll('.role').forEach((el) => {
  el.onclick = () => {
    if (!lobby.host) return;
    // clicking the other card swaps roles; the guest has to ready up again for their new one
    if (lobby.hostRole !== el.dataset.role) lobby.ready = false;
    lobby.hostRole = el.dataset.role;
    sendLobby();
    renderLobby();
  };
});
$('#ready-game').onclick = () => {
  lobby.ready = !lobby.ready;
  net.send('ready', { ready: lobby.ready });
  renderLobby();
};
$('#start-game').onclick = () => {
  const seed = Math.floor(Math.random() * 1e9);
  net.send('start', { seed, hostRole: lobby.hostRole });
  startMatch(seed);
};
$('#leave-lobby').onclick = leaveToMenu;
$('#pause-leave').onclick = leaveToMenu;
$('#waiting-leave').onclick = leaveToMenu;
$('#end-menu').onclick = leaveToMenu;
$('#end-lobby').onclick = () => {
  vote.mine = !vote.mine; // (click again to take it back)
  net.send('vote', { on: vote.mine });
  checkVote();
};
$('#de-again').onclick = $('#de-continue').onclick = () => {
  dvote.mine = !dvote.mine;
  net.send('dvote', { on: dvote.mine });
  checkDuelVote();
};
$('#de-menu').onclick = () => { net.send('dmenu', {}); leaveToMenu(); };
$('#letter-menu').onclick = leaveToMenu;
$('#gw-menu').onclick = leaveToMenu;

// how to play
$('#ht-next').onclick = () => { if (!stepHowto(1)) show('menu'); };
$('#ht-back').onclick = () => stepHowto(-1);
$('#ht-close').onclick = () => show('menu');
$('#ht-dots').onclick = (e) => { const i = e.target.closest('[data-ht]')?.dataset.ht; if (i !== undefined) gotoHowto(+i); };

// Pointer lock (the captured mouse); Esc pauses. Browsers only allow taking the mouse right after
// a click or a key press, so when a round starts or carries on it's taken at once if this player's
// own click started it (Lock in, the last vote, Resume); otherwise a small hint shows (no screen to
// click through), and the next click or key press (any but Esc) takes it, so just starting to
// walk does.
function lockMouse() {
  holdKeys(); // (fullscreen, so Ctrl+W crouch-walks instead of closing the tab)
  try { canvas.requestPointerLock()?.catch?.(() => {}); } catch {}
}
function takeMouse() {
  show('click-to-play');
  if (navigator.userActivation?.isActive ?? true) lockMouse();
}
$('#click-to-play').onclick = lockMouse;
addEventListener('keydown', (e) => { if (screen() === 'click-to-play' && e.code !== 'Escape') lockMouse(); });
$('#resume').onclick = lockMouse;
document.addEventListener('pointerlockchange', () => {
  if (!match || match.over || match.pausedAt) return;
  // drop focus from the pause slider, so arrow keys in game don't change the sensitivity
  if (document.pointerLockElement === canvas) { document.activeElement?.blur(); show(null); }
  // lost again right after Esc resumed it: that's the browser, not the player, so just ask for a click
  else if (performance.now() - escResumedAt < 600) show('click-to-play');
  else { show('pause'); pausedAt = performance.now(); escDownOnPause = false; }
});

// settings
// sensitivity and field of view have sliders in Settings and on the pause screen; keep them in step
const SLIDERS = {
  sensitivity: (v) => v.toFixed(2),
  fov: (v) => `${v}°`,
  steps: (v) => `${Math.round(v * 100)}%`,
  ambience: (v) => `${Math.round(v * 100)}%`,
};
function renderSliders() {
  for (const el of document.querySelectorAll('input[data-setting]')) {
    const key = el.dataset.setting;
    el.value = settings[key];
    el.nextElementSibling.textContent = SLIDERS[key](settings[key]);
  }
}
function openSettings() {
  $('#set-quality').value = settings.quality;
  $('#set-skin').value = settings.skin;
  $('#set-vol').value = settings.volume;
  renderSliders();
  show('settings');
}
$('#set-quality').onchange = (e) => { settings.quality = e.target.value; saveSettings(); };
$('#set-skin').onchange = (e) => { settings.skin = e.target.value; saveSettings(); viewmodel.setSkin(settings.skin); };
document.querySelectorAll('input[data-setting]').forEach((el) => {
  el.oninput = () => {
    settings[el.dataset.setting] = +el.value;
    saveSettings();
    renderSliders();
    if (el.dataset.setting === 'fov') { engine.camera.fov = settings.fov; engine.camera.updateProjectionMatrix(); }
    if (el.dataset.setting === 'ambience') audio.setAmbience(settings.ambience);
  };
});
renderSliders();
$('#set-vol').oninput = (e) => { settings.volume = +e.target.value; audio.setVolume(settings.volume); saveSettings(); };
$('#settings-back').onclick = () => show('menu');

// --- controls: remap keys ----------------------------------------------------------------
// Changes are made to a draft, and only take effect when saved (leaving asks first).
let controlsFrom = 'settings', listening = null; // listening: the action waiting for a key
let justBound = false; // a mouse button was just bound: its release mustn't start listening again
let draft = {};
const dirty = () => ACTIONS.some(([id]) => draft[id] !== settings.keys[id]);
function renderControls() {
  let html = '', group = '';
  for (const [id, name, g] of ACTIONS) {
    if (g !== group) { html += `<h3>${g}</h3>`; group = g; }
    html += `<div class="bind"><span>${name}</span><button data-bind="${id}" class="${listening === id ? 'listening' : ''}">${listening === id ? 'Press a key' : keyLabel(draft[id])}</button></div>`;
  }
  $('#binds').innerHTML = html;
  $('#controls-save').disabled = !dirty();
}
function openControls() {
  controlsFrom = screen();
  listening = null;
  draft = { ...settings.keys };
  $('#confirm').classList.remove('show');
  renderControls();
  show('controls');
}
function saveControls() {
  saveKeys(draft);
  renderControls();
  renderKeyHints();
  toast('Controls saved');
}
// leave Controls, asking first if there's something unsaved
function closeControls(force = false) {
  listening = null;
  if (!force && dirty()) { renderControls(); $('#confirm').classList.add('show'); return; }
  $('#confirm').classList.remove('show');
  show(controlsFrom === 'pause' ? 'pause' : 'settings');
}
// key labels shown around the menus follow the bindings
function renderKeyHints() {
  const move = ['forward', 'left', 'back', 'right'].map(label);
  const moveText = move.every((k) => k.length === 1) ? move.join('') : move.join(' ');
  $('#footer-hint').innerHTML = [[moveText, 'move'], [label('sprint'), 'sprint'], [label('jump'), 'jump'], [label('crouch'), 'crouch'], [label('shoot'), 'shoot'], [label('reload'), 'reload'],
    [`${label('dart')} ${label('flash')} ${label('dash')}`, 'abilities'], [label('take'), 'take page'], [label('light'), 'light'], [label('inspect'), 'inspect']]
    .map(([k, what]) => `<span><b>${k}</b> ${what}</span>`).join('');
  for (const el of document.querySelectorAll('[data-kit]')) el.innerHTML = el.dataset.kit.split(' ').map((id) => `<i>${label(id)}</i>`).join('');
}
document.querySelectorAll('[data-controls]').forEach((el) => { el.onclick = openControls; });
// start listening on mouse *up*, so the click that picks an action isn't taken as its new button
$('#binds').addEventListener('mouseup', (e) => {
  const id = e.target.closest('[data-bind]')?.dataset.bind;
  if (justBound) { justBound = false; return; }
  if (!id || e.button !== 0 || listening) return;
  setTimeout(() => { listening = id; renderControls(); });
});
// The mouse side buttons can be bound, but browsers use them for Back / Forward. They can arrive
// as mouse buttons 3 / 4, or, with some mouse software, as the keyboard keys BrowserBack /
// BrowserForward. Cancelling the event stops the page change in some browsers; for the others, a
// spare history entry takes the "back" that comes right after a side button, and we step forward
// onto it again. A real Back (toolbar, Alt+Left) still leaves the page.
// (Registered before the binding listeners below, which stop events from going further.)
const SIDE_KEYS = new Set(['BrowserBack', 'BrowserForward']);
let sideButtonAt = -1e9;
for (const type of ['mousedown', 'mouseup', 'auxclick']) {
  addEventListener(type, (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    sideButtonAt = performance.now();
  }, true);
}
addEventListener('keydown', (e) => {
  if (!SIDE_KEYS.has(e.code)) return;
  e.preventDefault();
  sideButtonAt = performance.now();
}, true);
history.pushState({ woods: true }, '', location.href);
addEventListener('popstate', () => {
  if (performance.now() - sideButtonAt < 1500) history.pushState({ woods: true }, '', location.href);
  else history.back();
});

// the next key or mouse button pressed goes to the action that's listening (Esc is kept for pausing).
// The Controls screen also shows the last input it saw, to tell what a mouse really sends.
function capture(e, code, seen) {
  if (screen() !== 'controls') return;
  $('#last-input').textContent = `Last input: ${seen}`;
  if (!listening) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (code !== 'Escape') bindIn(draft, listening, code);
  justBound = code.startsWith('Mouse');
  listening = null;
  renderControls();
}
addEventListener('keydown', (e) => capture(e, e.code, `key ${e.code}`), true);
addEventListener('mousedown', (e) => capture(e, mouseCode(e.button), `mouse button ${e.button}`), true);
addEventListener('contextmenu', (e) => { if (screen() === 'controls') e.preventDefault(); });
addEventListener('mouseup', () => setTimeout(() => { justBound = false; })); // (after the list's own mouseup has seen it)
$('#controls-reset').onclick = () => { draft = { ...DEFAULT_KEYS }; listening = null; renderControls(); };
$('#controls-save').onclick = saveControls;
$('#controls-back').onclick = () => closeControls();
$('#confirm-save').onclick = () => { saveControls(); closeControls(true); };
$('#confirm-discard').onclick = () => closeControls(true);
$('#confirm-cancel').onclick = () => $('#confirm').classList.remove('show');
renderKeyHints();

// --- Esc: back out of the menu that's open --------------------------------------------------
// (While the round is running, Esc is the browser's: it frees the mouse, which opens the pause
// menu. These are the presses that come after, with the mouse already free.)
let pausedAt = 0, escResumedAt = -1e9, escDownOnPause = false;
function resume() {
  escResumedAt = performance.now();
  // Browsers may refuse to take the mouse again from an Esc press (it doesn't count as the
  // player interacting); then "click to play" does it with the next click.
  holdKeys();
  try {
    const req = canvas.requestPointerLock();
    req?.catch?.(() => { if (screen() === 'pause') show('click-to-play'); });
  } catch { show('click-to-play'); }
}
document.addEventListener('pointerlockerror', () => { if (match && screen() === 'pause') show('click-to-play'); });
addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || e.repeat) return;
  const at = screen();
  if (at === 'controls') {
    if ($('#confirm').classList.contains('show')) $('#confirm').classList.remove('show'); // Esc = Cancel
    else closeControls();
  } else if (at === 'settings' || at === 'join' || at === 'howto') show('menu');
  // the pause menu resumes when Esc is *released*: taking the mouse back while the key is still
  // down lets the browser read that same press as "free the mouse", which paused again at once
  else if (at === 'pause' && performance.now() - pausedAt > 300) escDownOnPause = true;
});
// arrow keys step through How to play
addEventListener('keydown', (e) => {
  if (screen() !== 'howto') return;
  if (e.code === 'ArrowRight' && !stepHowto(1)) show('menu');
  if (e.code === 'ArrowLeft') stepHowto(-1);
});
addEventListener('keyup', (e) => {
  if (e.code !== 'Escape' || !escDownOnPause) return;
  escDownOnPause = false;
  if (screen() === 'pause') resume();
});

// --- menu camera: a slow walk through the woods with the torch on ----------------
const menuCam = { t: 0 };
function menuCamera(dt, time) {
  menuCam.t += dt * 0.018;
  const a = menuCam.t;
  const x = Math.cos(a) * 30, z = Math.sin(a) * 30;
  const cam = engine.camera;
  cam.position.set(x, world.heightAt(x, z) + 1.7 + Math.sin(time * 0.9) * 0.02, z);
  const ahead = a + 0.25;
  const lx = Math.cos(ahead) * 30 + Math.sin(time * 0.21) * 3, lz = Math.sin(ahead) * 30;
  cam.lookAt(lx, world.heightAt(lx, lz) + 1.5 + Math.sin(time * 0.33) * 0.3, lz);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const from = new THREE.Vector3(0.2, -0.2, 0).applyQuaternion(cam.quaternion).add(cam.position);
  flashlight.update(dt, from, dir, time);
}

// --- main loop -------------------------------------------------------------------
const timer = new THREE.Timer();
function frame(now) {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.05);
  const time = timer.getElapsed();
  if (match) match.update(dt, time);
  else menuCamera(dt, time);
  world.update(dt, engine.camera.position, time);
  engine.render(time);
  requestAnimationFrame(frame);
}
frame();

// open the menu (or straight into the join flow from an invite link)
const invite = new URLSearchParams(location.search).get('room');
if (invite) joinGame(invite, invite.toUpperCase() === hostRoom());
else show('menu');

// draw the characters onto the role cards (after the menu is up, so it doesn't delay loading)
setTimeout(renderRolePortraits, 300);

// for headless tests
window.__game = { THREE, engine, world, player, net, lobby, flashlight, viewmodel, effects, get match() { return match; }, startMatch, startDuel, openGift };
