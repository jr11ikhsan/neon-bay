// The screenshot scenes behind ?shot=start|play|chase|end. Each one stages the
// real simulation from a fresh world with the scene's seed and steps it forward
// with a scripted driver, so the frame is what the game really looks like and
// the same seed always gives the same frame.
import { STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const IDLE = { mx: 0, my: 0, run: false, attack: false, interact: false, aimX: 0, aimY: 0 };

function stepAmbient(world, seconds) {
  const n = Math.floor(seconds / STEP);
  for (let i = 0; i < n; i += 1) world.step(STEP, IDLE, true);
}
function stepPlay(world, seconds, control) {
  const n = Math.floor(seconds / STEP);
  for (let i = 0; i < n; i += 1) world.step(STEP, control, false);
}

function stageStart(world) {
  stepAmbient(world, 5);
  return { screen: SCREEN_TITLE };
}

function stagePlay(world) {
  // A getaway already in motion: the player floors a sedan down the boardwalk
  // road at dusk with three stars and the law arriving.
  stepAmbient(world, 1.5);
  const state = world.state;
  let car = null;
  for (const c of state.cars) if (c.kind === 'parked') { car = c; break; }
  if (!car) car = state.cars[0];
  car.x = 3889; car.y = 1080; car.angle = Math.PI / 2; car.speed = 330;
  car.driver = 'player';
  state.player.inCar = car;
  state.player.x = car.x; state.player.y = car.y;
  state.player.hasGun = true;
  state.heat = 262;
  const drive = { mx: 0, my: -1, run: false, attack: false, interact: false, aimX: car.x, aimY: car.y + 300 };
  stepPlay(world, 3.4, drive);
  return { screen: SCREEN_PLAY };
}

function stageChase(world) {
  // On foot on the beach at dusk, pistol out, patrols closing in.
  stepAmbient(world, 1.5);
  const state = world.state;
  state.player.x = 4140; state.player.y = 1760;
  state.player.hasGun = true;
  state.money = 640;
  state.heat = 305;
  // Run along the sand while firing at the nearest trouble, as a player would.
  for (let i = 0; i < Math.floor(2.6 / STEP); i += 1) {
    let tx = state.player.x + 200, ty = state.player.y;
    let bestD = Infinity;
    for (const c of state.cops) { const d = Math.hypot(c.x - state.player.x, c.y - state.player.y); if (d < bestD) { bestD = d; tx = c.x; ty = c.y; } }
    for (const car of state.cars) {
      if (car.kind !== 'police') continue;
      const d = Math.hypot(car.x - state.player.x, car.y - state.player.y);
      if (d < bestD) { bestD = d; tx = car.x; ty = car.y; }
    }
    world.step(STEP, { mx: 1, my: 0, run: true, attack: i % 30 < 14, interact: false, aimX: tx, aimY: ty }, false);
  }
  return { screen: SCREEN_PLAY };
}

function stageEnd(world) {
  // After the big score: story complete, night neon, the gold coupe outside the
  // hideout and the bay still alive.
  stepAmbient(world, 2);
  const state = world.state;
  state.mission.done = true;
  state.mission.active = false;
  state.mission.index = 4;
  state.objective = null;
  state.objectiveText = 'Free roam — the bay is yours';
  state.money = 2965;
  state.earned = 2965;
  state.player.hasGun = true;
  state.hour = 20.4;
  if (state.targetCar) {
    state.targetCar.x = 3090; state.targetCar.y = 3160; state.targetCar.angle = 0.4;
    state.targetCar.missionTarget = false;
    state.player.x = 3040; state.player.y = 3206;
  }
  world.toast('NEON BAY — story complete', 'Free roam: the city, the cops and the beach are still out there.');
  stepPlay(world, 1.2, IDLE);
  return { screen: SCREEN_PLAY };
}

export function stageShot(name, world) {
  world.reset();
  if (name === 'play') return stagePlay(world);
  if (name === 'chase') return stageChase(world);
  if (name === 'end') return stageEnd(world);
  return stageStart(world);
}
