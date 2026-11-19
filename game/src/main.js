// NEON BAY v2 — boot and game loop. Owns the screen state machine
// (title / play / pause / busted / wasted), the fixed-step accumulator,
// save & continue through localStorage, and the deterministic shot mode
// the screenshot harness drives.

import { createWorld, STEP } from './world.js';
import { createRender } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { SAVE_KEY, BEST_KEY, WEAPON_ORDER } from './config.js';
import { stageShot, shotDrive, finalizeShot } from './shots.js';

const glCanvas = document.getElementById('gl');
const hudCanvas = document.getElementById('hud');
const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const seed = parseInt(params.get('seed') || '1', 10) || 1;

const world = createWorld(seed);
const render = createRender(glCanvas, hudCanvas, world);
const input = createInput(hudCanvas);
const audio = createAudio();
const player = world.player, W = world.state;

let screen = 'title';
let cardT = 0, savedFlashT = 0;
let shotFrame = 0, shotDone = false;

function loadSave() {
  try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function doSave() {
  try {
    W.best = Math.max(W.best, W.money);
    localStorage.setItem(SAVE_KEY, JSON.stringify(world.serialize()));
    localStorage.setItem(BEST_KEY, String(W.best));
    savedFlashT = 2.2;
  } catch { /* storage unavailable: play on unsaved */ }
}
try { W.best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch { /* noop */ }

function startStory() { screen = 'play'; audio.resume(); }
function continueStory() {
  const save = loadSave();
  if (save) { world.restore(save); startStory(); }
}

if (shotName) {
  render.setQuality(true);
  stageShot(world, shotName);
  screen = shotName === 'start' ? 'title' : 'play';
} else if (sessionStorage.getItem('nb2-autostart') === '1') {
  sessionStorage.removeItem('nb2-autostart');
  screen = 'play';
}

window.addEventListener('resize', () => render.resize(window.innerWidth, window.innerHeight));
render.resize(window.innerWidth, window.innerHeight);

const gesture = () => audio.resume();
window.addEventListener('pointerdown', gesture);
window.addEventListener('keydown', gesture);

function cycleWeapon() {
  const owned = WEAPON_ORDER.filter((w) => player.weapons.includes(w));
  const next = owned[(owned.indexOf(player.weapon) + 1) % owned.length];
  return WEAPON_ORDER.indexOf(next);
}
function buildInput() {
  const mv = input.moveVec();
  let weapon = input.weaponKey();
  if (weapon == null && input.pressed('KeyQ')) weapon = cycleWeapon();
  return {
    mx: mv.mx, my: mv.my, run: input.run(), attack: input.attack(),
    aim: player.car ? null : render.aimAngle(input.mouse.x, input.mouse.y),
    weapon,
  };
}

let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  savedFlashT = Math.max(0, savedFlashT - dt);

  if (shotName) {
    // deterministic: exactly 150 fixed steps, then compose and hold
    if (!shotDone) {
      for (let i = 0; i < 3 && shotFrame < 150; i++, shotFrame++) {
        world.step(STEP, shotDrive(world, shotName, shotFrame));
      }
      if (shotFrame >= 148 && !window.__shotFinalized) { finalizeShot(world, shotName); window.__shotFinalized = true; }
      if (shotFrame >= 150) { shotDone = true; window.__shotReady = true; }
    }
    render.frame(STEP, { screen, canContinue: false, muted: false });
    input.endFrame();
    return;
  }

  // screen-level keys
  if (screen === 'title') {
    if (input.pressed('Enter') || input.mouse.clicked) startStory();
    else if (input.pressed('KeyC') && loadSave()) continueStory();
  } else if (screen === 'play') {
    if (input.pressed('KeyP') || input.pressed('Escape')) screen = 'pause';
    else if (input.pressed('KeyE')) world.interact();
  } else if (screen === 'pause') {
    if (input.pressed('KeyP') || input.pressed('Escape') || input.pressed('Enter')) screen = 'play';
    else if (input.pressed('KeyS')) doSave();
    else if (input.pressed('KeyR')) { sessionStorage.setItem('nb2-autostart', '1'); location.reload(); }
  }
  if (input.pressed('KeyM')) { audio.setMuted(!audio.isMuted()); }

  // simulate
  if (screen === 'play' || screen === 'title') {
    acc += dt;
    let n = 0;
    const inp = screen === 'play' ? buildInput() : { mx: 0, my: 0, run: false, attack: false, aim: null, weapon: null };
    while (acc >= STEP && n < 5) { world.step(STEP, inp); acc -= STEP; n++; }
    if (n === 5) acc = 0;
    for (const s of world.drainSounds()) audio.play(s);
    if (W.saveRequested) { W.saveRequested = false; doSave(); }
    if (screen === 'play' && W.event) { screen = W.event; cardT = 2.4; }
  } else if (screen === 'busted' || screen === 'wasted') {
    cardT -= dt;
    if (cardT <= 0) { world.respawn(screen); screen = 'play'; }
  }

  // continuous audio: engine + nearest siren
  const inCar = !!player.car;
  audio.setEngine(inCar && screen === 'play', inCar ? Math.abs(player.car.speed) / 660 : 0);
  let siren = 0;
  if (world.stars() > 0) {
    let d = Infinity;
    for (const c of W.cars) if (c.kind === 'police') d = Math.min(d, Math.hypot(c.x - player.x, c.y - player.y));
    if (d < Infinity) siren = Math.max(0, 1 - d / 950);
  }
  audio.setSiren(screen === 'play' ? siren : 0);

  render.frame(dt, { screen, canContinue: !!loadSave(), muted: audio.isMuted(), savedFlash: savedFlashT > 0 });
  input.endFrame();
}
requestAnimationFrame(frame);

window.__neonBay = { world, render, get screen() { return screen; }, startStory, continueStory };
