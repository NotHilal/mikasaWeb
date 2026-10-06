// Boot, the menu/lobby flow and the main loop.
import * as THREE from 'three';
import { createEngine } from './engine.js';
import { buildWorld } from './world/world.js';
import { createFlashlight } from './flashlight.js';
import { Player } from './player.js';
import { Match } from './match.js';
import { net } from './net.js';
import { audio } from './audio.js';
import { settings, saveSettings } from './settings.js';
import { $, show, screen, toast } from './ui.js';

const engine = createEngine($('#view'));
const canvas = engine.renderer.domElement;

// --- loading ------------------------------------------------------------------
const manager = new THREE.LoadingManager();
manager.onProgress = (_, done, total) => { $('#load-fill').style.width = `${(done / total) * 100}%`; };
const loaded = new Promise((res) => { manager.onLoad = res; });

const world = await buildWorld(engine.scene, manager);
const flashlight = createFlashlight(engine.scene);
const player = new Player(engine.camera, world, canvas);
// the page handwriting is drawn on canvases, so its font must be loaded first
await Promise.all([loaded, document.fonts.load('64px "Caveat"'), document.fonts.ready]);
// compile every shader once now, so the first frames don't stutter
engine.renderer.compile(engine.scene, engine.camera);

// --- lobby state ----------------------------------------------------------------
const lobby = { host: false, hostRole: 'seeker', partner: false };
let match = null;
const myRole = () => (lobby.host ? lobby.hostRole : lobby.hostRole === 'seeker' ? 'hunter' : 'seeker');

function renderLobby() {
  $('#lobby-code').textContent = net.room ?? '----';
  for (const el of document.querySelectorAll('.role')) {
    const role = el.dataset.role;
    const mine = role === myRole();
    el.classList.toggle('mine', mine);
    el.disabled = !lobby.host;
    el.querySelector('.role-who').textContent = mine ? 'You' : lobby.partner ? 'Your friend' : '';
  }
  $('#role-note').textContent = lobby.host ? '· click to switch' : '· the host picks';
  $('#start-game').disabled = !(lobby.host && lobby.partner);
  $('#start-game').style.display = lobby.host ? '' : 'none';
  $('#lobby-status').textContent = !lobby.partner
    ? 'Waiting for the second player… Send them the code or the invite link.'
    : lobby.host ? 'Your friend is here. Press Start when you are ready.' : 'Connected. Waiting for the host to start.';
}

function sendLobby() { net.send('lobby', { hostRole: lobby.hostRole }); }

net.on('hi', () => {
  if (!lobby.host) return;
  lobby.partner = true;
  sendLobby();
  if (screen() === 'lobby') renderLobby();
  if (!match) toast('A player joined');
});
net.on('lobby', ({ hostRole }) => {
  if (lobby.host) return;
  lobby.partner = true;
  lobby.hostRole = hostRole;
  if (screen() === 'lobby') renderLobby();
});
net.on('start', ({ seed, hostRole }) => {
  lobby.hostRole = hostRole;
  startMatch(seed);
});
net.on('bye', () => {
  lobby.partner = false;
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
net.on('to-lobby', () => { if (match) { endMatch(); show('lobby'); renderLobby(); } });

async function createGame() {
  try {
    lobby.host = true; lobby.partner = false;
    show('lobby');
    $('#lobby-status').textContent = 'Creating room…';
    await net.createRoom();
    history.replaceState(null, '', `?room=${net.room}`);
    renderLobby();
  } catch (e) {
    toast(e.message);
    show('menu');
  }
}

async function joinGame(code) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { $('#join-error').textContent = 'Codes are 4 letters.'; return; }
  $('#join-error').textContent = '';
  try {
    lobby.host = false; lobby.partner = false;
    $('#join-go').disabled = true;
    await net.joinRoom(code);
    net.send('hi', {});
    show('lobby');
    renderLobby();
  } catch (e) {
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
  lobby.partner = false;
  history.replaceState(null, '', location.pathname);
  show('menu');
}

// --- matches -------------------------------------------------------------------
function startMatch(seed) {
  if (match) match.dispose();
  match = new Match({ engine, world, player, flashlight }, { seed, role: myRole() }, (result) => {
    document.exitPointerLock();
    const won = (result === 'pages') === (myRole() === 'seeker');
    $('#end-title').textContent = won ? 'You win' : 'You lose';
    $('#end-sub').textContent = result === 'pages' ? 'All the pages were found.' : 'The seeker was caught.';
    $('#end-lobby').style.display = lobby.host ? '' : 'none';
    setTimeout(() => show('end'), 600);
  });
  show('click-to-play');
}

function endMatch() {
  match?.dispose();
  match = null;
  document.exitPointerLock();
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
  else show(go);
});
document.addEventListener('pointerdown', () => audio.start(), { once: true });
$('#join-go').onclick = () => joinGame($('#join-code').value);
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame($('#join-code').value); });
$('#copy-link').onclick = async () => {
  const link = `${location.origin}${location.pathname}?room=${net.room}`;
  try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch { toast(link, 6000); }
};
document.querySelectorAll('.role').forEach((el) => {
  el.onclick = () => {
    if (!lobby.host) return;
    // clicking the other card swaps roles
    lobby.hostRole = el.dataset.role;
    sendLobby();
    renderLobby();
  };
});
$('#start-game').onclick = () => {
  const seed = Math.floor(Math.random() * 1e9);
  net.send('start', { seed, hostRole: lobby.hostRole });
  startMatch(seed);
};
$('#leave-lobby').onclick = leaveToMenu;
$('#pause-leave').onclick = leaveToMenu;
$('#end-menu').onclick = leaveToMenu;
$('#end-lobby').onclick = () => { net.send('to-lobby', {}); endMatch(); show('lobby'); renderLobby(); };

// pointer lock: click to play, Esc pauses
$('#click-to-play').onclick = () => canvas.requestPointerLock();
$('#resume').onclick = () => canvas.requestPointerLock();
document.addEventListener('pointerlockchange', () => {
  if (!match || match.over) return;
  if (document.pointerLockElement === canvas) show(null);
  else show('pause');
});

// settings
function openSettings() {
  $('#set-quality').value = settings.quality;
  $('#set-sens').value = settings.sensitivity;
  $('#set-vol').value = settings.volume;
  show('settings');
}
$('#set-quality').onchange = (e) => { settings.quality = e.target.value; saveSettings(); };
$('#set-sens').oninput = (e) => { settings.sensitivity = +e.target.value; saveSettings(); };
$('#set-vol').oninput = (e) => { settings.volume = +e.target.value; audio.setVolume(settings.volume); saveSettings(); };
$('#settings-back').onclick = () => show('menu');

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
if (invite) joinGame(invite);
else show('menu');

// for headless tests
window.__game = { engine, world, player, net, lobby, flashlight, get match() { return match; }, startMatch };
