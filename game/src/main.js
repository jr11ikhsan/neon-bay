// NEON BAY v5 — boot and the one loop.
// Fixed-step simulation (1/60) under a requestAnimationFrame shell, four
// screens (title, play, pause, and the busted/wasted cards), localStorage
// saves, and the ?shot= staging mode the screenshots are taken with.

import { STEP, SAVE_KEY, BEST_KEY } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EV } from './world.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_TITLE, SCREEN_PLAY, SCREEN_PAUSED } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const glCanvas = document.getElementById('game');
const hudCanvas = document.getElementById('hud');
const status = document.getElementById('status');

let world = createWorld(createRandom(seed));
const renderer = createRenderer(glCanvas, hudCanvas);
const audio = createAudio();
renderer.resize();
window.addEventListener('resize', () => renderer.resize());

function readBest() {
  try { return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0; } catch { return 0; }
}
function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(world.save()));
    const best = Math.max(readBest(), world.state.player.money, world.state.stats.bestMoney);
    window.localStorage.setItem(BEST_KEY, String(best));
  } catch { /* storage off: the night lasts this visit only */ }
}
let best = readBest();

function runShot(name) {
  renderer.setQuality(true);
  const screen = stageShot(name, world);
  renderer.snapCamera(); // stills: no fly-in, the camera starts on subject
  let painted = 0;
  function paint() {
    renderer.draw(world, screen, best, 0.016);
    painted += 1;
    if (painted < 3) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(glCanvas);
  let screen = SCREEN_TITLE;
  let cardT = 0;
  let accumulator = 0;
  let last = performance.now();

  window.__neonBay = { world, screen: () => screen };
  const announce = (msg) => { status.textContent = msg; };

  function freshWorld() {
    world = createWorld(createRandom(Math.floor(Math.random() * 4294967296)));
    window.__neonBay.world = world;
  }
  function startNight() {
    freshWorld();
    screen = SCREEN_PLAY;
    announce('Playing. Night one in Neon Bay.');
  }
  function continueNight() {
    const snap = readSave();
    if (!snap) { startNight(); return; }
    world.restore(snap);
    screen = SCREEN_PLAY;
    announce('Welcome back to Neon Bay.');
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions.has('mute')) audio.toggleMute();
    if (screen === SCREEN_TITLE) {
      if (actions.has('continue')) continueNight();
      else if (actions.has('confirm')) startNight();
      return;
    }
    if (screen === SCREEN_PAUSED) {
      if (actions.has('save')) writeSave();
      else if (actions.has('restart')) { freshWorld(); screen = SCREEN_PLAY; }
      else if (actions.has('pause') || actions.has('confirm')) screen = SCREEN_PLAY;
      return;
    }
    if (screen === SCREEN_PLAY && actions.has('pause')) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  }

  function playControls() {
    const axes = input.axes();
    const p = world.state.player;
    const c = {
      mx: axes.x, my: axes.y,
      aimX: p.x + 100, aimY: p.y,
      fire: axes.fire, interact: axes.interact, sprint: axes.sprint,
      slot: input.takeSlot(),
    };
    if (p.car) {
      c.my = -axes.y; // W (axes.y = -1) is the throttle
      c.mx = axes.x;
    }
    const aim = renderer.pickGround(input.mouse.x + glCanvas.getBoundingClientRect().left, input.mouse.y + glCanvas.getBoundingClientRect().top);
    if (aim) { c.aimX = aim.x; c.aimY = aim.y; }
    return c;
  }

  function stepOnce() {
    const events = world.step(STEP, screen === SCREEN_PLAY ? playControls() : { mx: 0, my: 0, aimX: 0, aimY: 0, fire: false, interact: false, sprint: false, slot: -1 });
    if (events & EV.SHOT) audio.shot();
    if (events & EV.HIT) audio.hit();
    if (events & EV.MONEY) audio.money();
    if (events & EV.MISSION) { audio.mission(); writeSave(); }
    if (events & EV.PICKUP) audio.pickup();
    if (events & EV.ENTER) audio.enter();
    if (events & EV.SAVE) writeSave();
    if (events & EV.BUSTED) { audio.busted(); screen = 'busted'; cardT = 2.4; announce('Busted.'); }
    if (events & EV.WASTED) { audio.wasted(); screen = 'wasted'; cardT = 2.4; announce('Wasted.'); }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    audio.unlock();
    handleActions();
    if (screen === 'busted' || screen === 'wasted') {
      cardT -= dt;
      if (cardT <= 0) screen = SCREEN_PLAY;
    } else if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      accumulator += dt;
      while (accumulator >= STEP && screen !== 'busted' && screen !== 'wasted') {
        stepOnce();
        accumulator -= STEP;
      }
      if (screen === 'busted' || screen === 'wasted') accumulator = 0;
    } else {
      accumulator = 0;
    }
    // sound of the street
    const p = world.state.player;
    audio.setEngine(p.car ? p.car.speed / 470 : 0, !!p.car);
    let siren = 0;
    for (const car of world.state.cars) {
      if (car.kind !== 'police' || car.dead) continue;
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      siren = Math.max(siren, Math.max(0, 1 - d / 720));
    }
    audio.setSiren(world.stars() > 0 ? siren : 0);
    audio.tick(dt);
    best = Math.max(best, world.state.stats.bestMoney);
    renderer.draw(world, screen, best, dt);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) screen = SCREEN_PAUSED;
  });
  announce('Neon Bay. Press Enter to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
