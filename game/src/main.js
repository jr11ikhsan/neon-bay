// NEON BAY v3 — boot + game loop: fixed-step simulation, screen state machine
// (title -> play <-> pause, busted/wasted cards come from the world), localStorage
// saves, event fan-out to audio and camera shake, and the ?shot= staging mode.
import { World } from './world.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { AudioEngine } from './audio.js';
import { stageShot } from './shots.js';
import { STEP, SAVE_KEY, BEST_KEY } from './config.js';

const params = new URLSearchParams(location.search);
const seed = parseInt(params.get('seed') || '1', 10) || 1;
const shotName = params.get('shot');

const glCanvas = document.getElementById('gl');
const hudCanvas = document.getElementById('hud');
const world = new World(seed);
const renderer = new Renderer(glCanvas, hudCanvas);
renderer.buildWorld(world.city);
const input = new Input(glCanvas);
const audio = new AudioEngine();

let screen = 'title';
let hasSave = false;
try { hasSave = !!localStorage.getItem(SAVE_KEY); } catch { hasSave = false; }

function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(world.serialize()));
    const best = Math.max(world.player.money, world.stats.bestMoney);
    localStorage.setItem(BEST_KEY, String(best));
    hasSave = true;
  } catch { /* storage unavailable: play on without saving */ }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    world.restore(JSON.parse(raw));
    return true;
  } catch { return false; }
}

let shotInfo = null;
if (shotName) {
  shotInfo = stageShot(world, shotName);
  screen = shotInfo.screen;
  renderer.setQuality(true);
}

let last = performance.now(), acc = 0, shotFrames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  const aimPoint = renderer.groundPoint(input.mouseX, input.mouseY);
  const snap = input.snapshot(renderer.yaw, aimPoint, world.player);
  if (snap.mute) { audio.ensure(); audio.setMuted(!audio.muted); }
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    acc -= STEP; steps++;
    if (screen === 'play') {
      world.step(snap);
      // Only the first snapshot in a multi-step frame carries the edge presses.
      snap.interact = false; snap.firePressed = false; snap.weaponTo = null;
    } else if (screen === 'title' && !shotName) {
      world.step({ mx: 0, my: 0, aim: null }); // the city idles behind the title
    }
  }
  if (screen === 'title') {
    if (snap.confirm) { audio.ensure(); screen = 'play'; world.toast('Welcome to Neon Bay'); }
    else if (snap.cont && hasSave && loadSave()) { audio.ensure(); screen = 'play'; world.toast('Welcome back to Neon Bay'); }
  } else if (screen === 'play') {
    if (snap.pause && !world.notice) screen = 'pause';
  } else if (screen === 'pause') {
    if (snap.pause || snap.confirm) screen = 'play';
    else if (snap.save) { persist(); world.toast('Saved'); screen = 'play'; }
  }
  for (const ev of world.events.splice(0)) {
    audio.handle(ev);
    renderer.handleEvent(ev);
    if (ev.k === 'save') persist();
  }
  audio.update(dt, world);
  renderer.render(world, { screen, hasSave }, dt);
  if (shotName && ++shotFrames > 6) window.__shotReady = true;
}
requestAnimationFrame(frame);
addEventListener('resize', () => renderer.resize());
window.__neonBay = { world, renderer, get screen() { return screen; } };
