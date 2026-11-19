// NEON BAY — boot and the one loop: input is read every frame, the world advances
// in fixed 1/60 s steps, and the renderer paints what is there. Screens: title,
// play, paused, and the busted/wasted card. Saves live in localStorage; sound is
// procedural WebAudio and starts on the first interaction.
//
// ?seed=N fixes the city and the scene randomness. ?shot=start|play|chase|end
// (with &seed=N) stages that scene instead of running the loop, paints it twice
// and sets window.__shotReady for a screenshot.
import { BEST_KEY, PLAYER, SAVE_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createCity } from './city.js';
import { createWorld, EV } from './world.js';
import { ACTION_CONFIRM, ACTION_INTERACT, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const city = createCity(createRandom(seed ^ 0x9e3779b9));
const world = createWorld(createRandom(seed), city);
const renderer = createRenderer(canvas, city);
const audio = createAudio();

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(world.serialize()));
    const best = Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
    if (world.state.earned > best) window.localStorage.setItem(BEST_KEY, String(world.state.earned));
  } catch {
    // Storage can be off (private windows): the save then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, { hasSave: false, muted: false, storyDone: false, nearCar: false });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let save = readSave();
  let accumulator = 0;
  let last = performance.now();
  let interactQueued = false;

  function announce(message) {
    status.textContent = message;
  }

  function startGame(withSave) {
    world.reset(withSave ? save : null);
    accumulator = 0;
    screen = SCREEN_PLAY;
    audio.unlock();
    announce(withSave ? 'Welcome back to Neon Bay.' : 'Neon Bay. Mission 1: First Wheels.');
  }

  // Menu keys the bit-flag input does not carry.
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM') {
      const muted = audio.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
    }
    if (screen === SCREEN_TITLE && event.code === 'KeyC' && save) startGame(true);
    else if (screen === SCREEN_PAUSED && event.code === 'KeyS') {
      writeSave();
      save = readSave();
      world.toast('Game saved', 'Continue from the title screen any time.');
      screen = SCREEN_PLAY;
    } else if (screen === SCREEN_PAUSED && event.code === 'KeyR') {
      startGame(false);
    }
  });

  function react(events) {
    if (events & EV.SHOT) audio.shot();
    if (events & EV.PUNCH) audio.punch();
    if (events & EV.CASH) audio.cash();
    if (events & EV.PICKUP) audio.pickup();
    if (events & EV.ENTER || events & EV.EXIT) audio.enterCar();
    if (events & EV.CRASH) audio.crash(1);
    if (events & EV.HURT) audio.hurt();
    if (events & EV.MISSION) { audio.mission(); writeSave(); save = readSave(); }
    if (events & EV.BUSTED) { audio.busted(); screen = SCREEN_OVER; announce('Busted.'); }
    if (events & EV.WASTED) { audio.failed(); screen = SCREEN_OVER; announce('Wasted.'); }
  }

  function buildControl() {
    const aim = renderer.screenToWorld(input.pointer.x, input.pointer.y);
    return {
      mx: input.moveX(),
      my: input.moveY(),
      run: input.running(),
      attack: input.attackHeld(),
      interact: interactQueued,
      aimX: aim.x,
      aimY: aim.y,
    };
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;

    const actions = input.takeActions();
    if (actions & ACTION_INTERACT) interactQueued = true;
    if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) { screen = SCREEN_PAUSED; announce('Paused.'); }
      else if (screen === SCREEN_PAUSED) { screen = SCREEN_PLAY; announce('Playing.'); }
    }
    if (actions & ACTION_CONFIRM) {
      audio.unlock();
      if (screen === SCREEN_TITLE) startGame(false);
      else if (screen === SCREEN_OVER) {
        world.respawn();
        screen = SCREEN_PLAY;
        announce('Back on the street.');
      } else if (screen === SCREEN_PAUSED) screen = SCREEN_PLAY;
    }

    if (screen === SCREEN_TITLE) {
      while (accumulator >= STEP) {
        world.step(STEP, { mx: 0, my: 0, run: false, attack: false, interact: false, aimX: 0, aimY: 0 }, true);
        accumulator -= STEP;
      }
    } else if (screen === SCREEN_PLAY) {
      while (accumulator >= STEP && screen === SCREEN_PLAY) {
        const control = buildControl();
        interactQueued = false;
        const events = world.step(STEP, control, false);
        react(events);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }

    // Continuous sound: engine + nearest siren.
    const p = world.state.player;
    if (screen === SCREEN_PLAY && p.inCar) audio.setEngine(true, Math.abs(p.inCar.speed) / 545);
    else audio.setEngine(false, 0);
    let siren = 0;
    if (world.state.stars > 0) {
      let bestD = Infinity;
      for (const car of world.state.cars) {
        if (car.kind !== 'police') continue;
        const d = Math.hypot(car.x - p.x, car.y - p.y);
        if (d < bestD) bestD = d;
      }
      if (bestD < 950) siren = 1 - bestD / 950;
    }
    audio.setSiren(screen === SCREEN_PLAY ? siren : 0);

    let nearCar = false;
    if (!p.inCar) {
      for (const car of world.state.cars) {
        if (Math.hypot(car.x - p.x, car.y - p.y) < PLAYER.enterRange + 30) { nearCar = true; break; }
      }
    }
    renderer.draw(world.state, screen, {
      hasSave: !!save,
      muted: audio.isMuted(),
      storyDone: world.state.mission.done,
      nearCar,
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  world.reset();
  announce('Neon Bay. Press Enter to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
