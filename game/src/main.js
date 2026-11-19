// NEON BAY — boot and the main loop. Owns the screens (title, playing, paused),
// the fixed-step clock that feeds world.js its 1/60 updates, the localStorage
// save/continue flow, the extra menu keys (M mute, S save, R restart, C
// continue), and the ?shot= staging path the screenshot harness drives. The
// simulation itself lives in world.js and every pixel in render.js; this file
// is only the wiring between input, world, audio and screen.

import { STEP, SAVE_KEY, BEST_KEY } from './config.js';
import { createInput, ACTION_CONFIRM, ACTION_PAUSE, ACTION_INTERACT } from './input.js';
import { createAudio } from './audio.js';
import { createWorld } from './world.js';
import { createRenderer } from './render.js';
import { setupShot, shotControls, SHOT_STEP_SECONDS } from './shots.js';

const canvas = document.getElementById('game');
const renderer = createRenderer(document.getElementById('gl'), canvas);
const input = createInput(canvas);
const audio = createAudio();

const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed') || 1) || 1;
const shotName = params.get('shot');

// A silent stand-in for the audio facade while staging screenshots, so a
// headless browser never has to start an AudioContext without a gesture.
const silentAudio = {
  unlock() {}, toggleMute() { return true; }, isMuted() { return true; },
  shot() {}, punch() {}, hurt() {}, cash() {}, pickup() {}, enterCar() {},
  crash() {}, mission() {}, failed() {}, busted() {},
  setEngine() {}, setSiren() {},
};

let world = null;
let screen = 'title';

function wireWorld(w) {
  w.onMissionComplete = () => saveGame();
  return w;
}

function newWorld() {
  world = wireWorld(createWorld(seed));
  return world;
}

function hasSave() {
  try { return !!window.localStorage.getItem(SAVE_KEY); } catch { return false; }
}

function saveGame() {
  if (!world) return;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(world.serialize()));
    const best = Number(window.localStorage.getItem(BEST_KEY) || 0);
    if (world.money > best) window.localStorage.setItem(BEST_KEY, String(world.money));
    world.toast('Game saved');
  } catch { /* storage unavailable: play on without saves */ }
}

function loadGame() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    newWorld();
    world.restore(JSON.parse(raw));
    world.toast('Welcome back to Neon Bay');
    return true;
  } catch { return false; }
}

newWorld();

// Menu keys that input.js does not turn into actions.
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyM') audio.toggleMute();
  if (screen === 'title' && event.code === 'KeyC' && hasSave()) {
    if (loadGame()) { audio.unlock(); screen = 'playing'; }
  } else if (screen === 'paused' && event.code === 'KeyS') {
    saveGame();
  } else if (screen === 'paused' && event.code === 'KeyR') {
    newWorld();
    screen = 'playing';
  }
});

let lastAim = -Math.PI / 2;
function controlsForPlayer() {
  // Aim by casting the pointer through the 3D camera onto the ground plane:
  // where the crosshair rests on the street is where the player aims.
  const ground = renderer.screenToGround(input.pointer.x, input.pointer.y);
  if (ground) {
    lastAim = Math.atan2(ground.y - world.player.y, ground.x - world.player.x);
  }
  const aimAngle = lastAim;
  return {
    moveX: input.moveX(),
    moveY: input.moveY(),
    run: input.running(),
    attack: input.attackHeld(),
    aimAngle,
    interact: false, // filled by the loop from the one-shot action flags
  };
}

const IDLE = { moveX: 0, moveY: 0, run: false, attack: false, interact: false, aimAngle: 0 };

function stepOnce(actions) {
  if (screen === 'title') {
    if (actions & ACTION_CONFIRM) {
      audio.unlock();
      screen = 'playing';
      return;
    }
    world.update(STEP, { ...IDLE, aimAngle: world.player.angle }, audio);
    return;
  }
  if (screen === 'paused') {
    if (actions & ACTION_PAUSE) screen = 'playing';
    return;
  }
  // playing
  if (actions & ACTION_PAUSE) {
    screen = 'paused';
    return;
  }
  const ctl = controlsForPlayer();
  ctl.interact = !!(actions & ACTION_INTERACT);
  world.update(STEP, ctl, audio);
}

// Screenshot staging: build the scene, settle it with scripted controls,
// render twice (the second frame carries the settled lighting), then signal.
if (shotName) {
  renderer.setQuality(true); // stills get the full pass, however slow the GPU
  setupShot(world, shotName);
  screen = shotName === 'start' ? 'title' : 'playing';
  const seconds = SHOT_STEP_SECONDS[shotName] || 1;
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    world.update(STEP, shotControls(shotName, world), silentAudio);
  }
  renderer.render(world, screen, { hasSave: false, muted: true, pointer: null });
  requestAnimationFrame(() => {
    renderer.render(world, screen, { hasSave: false, muted: true, pointer: null });
    window.__shotReady = true;
  });
} else {
  let last = performance.now();
  let accumulator = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    accumulator += dt;
    const actions = input.takeActions();
    let first = true;
    while (accumulator >= STEP) {
      stepOnce(first ? actions : 0);
      first = false;
      accumulator -= STEP;
    }
    renderer.render(world, screen, {
      hasSave: hasSave(),
      muted: audio.isMuted(),
      pointer: input.pointer,
    });
  };
  requestAnimationFrame(frame);
}

// A handle for automated playtests and curious players in the console.
window.__neonBay = { get world() { return world; }, get screen() { return screen; }, saveGame, loadGame };
