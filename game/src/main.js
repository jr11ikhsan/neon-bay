// NEON BAY — the shell: boot, the fixed-step loop, screen state, saves,
// audio wiring. The simulation (world.js) and the picture (render.js) meet
// here; input is translated from screen space into world space with the
// camera yaw, so W always walks away from the camera and the mouse aims
// where it points.

import { World } from './world.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { stageShot, shotTick } from './shots.js';
import { STEP, SAVE_KEY, BEST_KEY, WEAPON_ORDER } from './config.js';

const params = new URLSearchParams(location.search);
const seed = parseInt(params.get('seed') || '1', 10) || 1;
const shotName = params.get('shot');

const glCanvas = document.getElementById('gl');
const hudCanvas = document.getElementById('hud');

let world = new World(seed);
const renderer = new Renderer(world, glCanvas, hudCanvas, { shotMode: !!shotName });
const input = new Input(glCanvas);
const audio = new AudioSys();

let screen = 'title';
let cardT = 0, ribbonT = 0, muted = false;
let prevMouse = false;

const hasSave = () => { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } };
const bestEarned = () => { try { return +(localStorage.getItem(BEST_KEY) || 0); } catch { return 0; } };
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(world.serialize()));
    localStorage.setItem(BEST_KEY, String(Math.max(world.stats.earned, bestEarned())));
  } catch { /* storage unavailable: the run simply will not persist */ }
}
function setWorld(w) { world = w; renderer.bindWorld(w); }
function startNew() { setWorld(new World(seed)); screen = 'play'; audio.init(); }
function continueGame() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (data) { const w = new World(seed); w.restore(data); setWorld(w); }
  } catch { /* corrupt save: start fresh instead of crashing */ }
  screen = 'play'; audio.init();
}

// ------------------------------------------------------------ shot mode
let shotPlan = null, shotIdx = 0, shotFrames = 0, shotDone = false;
if (shotName) {
  renderer.setQuality(true);
  shotPlan = stageShot(world, shotName);
  screen = shotPlan.screen;
  if (shotPlan.ribbon) ribbonT = 9999;
}

// ------------------------------------------------------------ control
function buildControl() {
  const c = world.control;
  const mv = input.moveVec();
  const yaw = renderer.yaw;
  const fx = Math.cos(yaw), fy = Math.sin(yaw);
  const rx = -Math.sin(yaw), ry = Math.cos(yaw);
  if (world.player.inCar) { c.mx = mv.x; c.my = -mv.y; }
  else {
    c.mx = rx * mv.x + fx * -mv.y;
    c.my = ry * mv.x + fy * -mv.y;
  }
  const aim = renderer.aimPoint(input.mouseX, input.mouseY, glCanvas.width, glCanvas.height);
  if (aim) { c.aimX = aim.x; c.aimY = aim.y; }
  c.fire = input.mouseDown;
  c.sprint = input.sprint;
  if (input.take('interact')) c.interact = true;
  const slot = input.take('weaponSlot');
  if (slot >= 0 && slot <= 3) { const w = WEAPON_ORDER[slot]; if (world.weapons[w]) world.weapon = w; }
  else if (slot === 9) {
    const owned = WEAPON_ORDER.filter(w => world.weapons[w]);
    world.weapon = owned[(owned.indexOf(world.weapon) + 1) % owned.length];
  }
}
function zeroControl() {
  const c = world.control;
  c.mx = 0; c.my = 0; c.fire = false; c.sprint = false;
}

function drainEvents() {
  for (const e of world.events) {
    if (e === 'autosave') { save(); if (world.storyComplete) ribbonT = 9; continue; }
    if (audio[e]) audio[e]();
  }
  world.events.length = 0;
  if (world.saveRequest) { world.saveRequest = false; save(); }
}

function updateAudio(dt) {
  const p = world.player;
  if (p.inCar) audio.setEngine(Math.abs(p.inCar.speed) / 520, true);
  else audio.setEngine(0, false);
  let prox = 0;
  if (world.stars > 0) {
    let bd = Infinity;
    for (const c of world.cars) if (c.kind === 'cop' && !c.dead) bd = Math.min(bd, Math.hypot(c.x - p.x, c.y - p.y));
    prox = Math.max(0, 1 - bd / 780);
  }
  audio.setSiren(prox);
  audio.updatePad(dt);
}

function uiState() {
  return { screen, hasSave: hasSave(), best: bestEarned(), muted, ribbon: ribbonT > 0 };
}

// ------------------------------------------------------------ screens
function handleKeys() {
  const clickEdge = input.mouseDown && !prevMouse;
  if (screen === 'title') {
    if (input.take('confirm') || clickEdge) { startNew(); return; }
    if (input.take('continueKey') && hasSave()) { continueGame(); return; }
    input.take('pause'); input.take('saveKey');
  } else if (screen === 'play') {
    if (input.take('pause')) screen = 'pause';
    input.take('confirm'); input.take('continueKey'); input.take('saveKey');
  } else if (screen === 'pause') {
    if (input.take('pause') || input.take('confirm')) screen = 'play';
    if (input.take('saveKey')) { save(); world.toast('Saved'); }
    input.take('continueKey');
  } else { // busted / wasted card: keys are ignored until it fades
    input.take('pause'); input.take('confirm'); input.take('continueKey'); input.take('saveKey');
  }
}

// ------------------------------------------------------------ main loop
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (input.take('mute')) { muted = !muted; audio.setMuted(muted); }

  if (shotName) {
    if (!shotDone) {
      if (shotIdx < shotPlan.ticks) { shotTick(world, shotName, shotIdx); world.tick(STEP); shotIdx++; }
      else {
        if (shotFrames === 0) world.toasts.length = 0; // setup toasts would otherwise freeze on screen: world time stops here
        if (++shotFrames >= 6) { shotDone = true; window.__shotReady = true; }
      }
    }
    renderer.draw(dt, uiState());
    prevMouse = input.mouseDown;
    return;
  }

  handleKeys();
  if (screen === 'play') {
    buildControl();
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 6) {
      world.tick(STEP); acc -= STEP; n++;
      if (world.lastCard) { screen = world.lastCard; cardT = 2.6; world.lastCard = null; zeroControl(); break; }
    }
    if (n === 6) acc = 0;
    if (ribbonT > 0) ribbonT -= dt;
  } else if (screen === 'busted' || screen === 'wasted') {
    cardT -= dt;
    if (cardT <= 0) screen = 'play';
  }
  drainEvents();
  updateAudio(dt);
  renderer.draw(dt, uiState());
  prevMouse = input.mouseDown;
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => renderer.applySize());

// Test hooks: the playtest drives the real game through these.
window.__neonBay = {
  get world() { return world; },
  renderer,
  get screen() { return screen; },
  startNew, continueGame, save,
};
