// NEON BAY v3 — deterministic screenshot staging for ?shot=start|play|chase|end&seed=N.
// Each scene arranges the real simulation (no mock objects), runs a few fixed steps to
// settle physics and particles, and leaves the world ready for one rendered frame.
import { placeById } from './city.js';

const IDLE = { mx: 0, my: 0, sprint: false, fire: false, firePressed: false, interact: false, aim: null, throttle: 0, steer: 0, weaponTo: null };
function settle(world, frames, inp = IDLE) { for (let i = 0; i < frames; i++) world.step(inp); }
function teleport(world, x, y, a) { const p = world.player; p.x = x; p.y = y; p.a = a; if (p.car) { p.car.x = x; p.car.y = y; p.car.a = a; } }

export function stageShot(world, name) {
  const p = world.player, city = world.city;
  const hotel = placeById(city, 'hotel'), garage = placeById(city, 'garage');
  if (name === 'start') {
    world.timeMin = 18 * 60 + 42; // lamps on, sky still glowing
    teleport(world, 3400, 700, -Math.PI / 2);
    settle(world, 30);
    return { screen: 'title' };
  }
  if (name === 'play') {
    world.timeMin = 18 * 60 + 5;
    world.missionIdx = 1; world.stepIdx = 0; // Package Run banner
    p.owned.pistol = true; p.weapon = 'pistol'; p.money = 250;
    const coupe = world.missionCar('coupe');
    coupe.x = 2464; coupe.y = 1500; coupe.a = -Math.PI / 2; coupe.spd = 330;
    p.car = coupe; coupe.driver = 'player'; teleport(world, 2464, 1500, -Math.PI / 2);
    world.heat = 300; // 3 stars
    const spots = [[2464, 1780, -Math.PI / 2], [2400, 1290, -Math.PI / 2], [2540, 1660, -Math.PI / 2]];
    for (const [x, y, a] of spots) { const cop = world.spawnPolice(x, y); cop.a = a; cop.spd = 300; }
    settle(world, 26, { ...IDLE, throttle: 1 });
    return { screen: 'play' };
  }
  if (name === 'chase') {
    world.timeMin = 21 * 60 + 21; // night firefight, bright rig
    world.missionIdx = 2; world.stepIdx = 1;
    p.owned.pistol = true; p.weapon = 'pistol'; p.money = 1150;
    world.spawnStepNeeds();
    const dealers = world.peds.filter(d => d.kind === 'dealer');
    teleport(world, 4150, 1870, 0.5);
    if (dealers[0]) { dealers[0].hp = 0; dealers[0].dead = true; dealers[0].deadT = 60; }
    if (dealers[1]) { dealers[1].x = 4280; dealers[1].y = 1790; dealers[1].aggro = true; }
    world.heat = 240;
    const cop = world.spawnPolice(3960, 1760); cop.a = Math.PI / 2; cop.spd = 0;
    // One visible tracer from the player's muzzle toward the standing dealer.
    settle(world, 12);
    world.tracers.push({ x1: p.x, y1: p.y, x2: 4280, y2: 1790, t: 5 });
    world.burst(p.x + 30, p.y - 8, 3, '#ffd23e');
    return { screen: 'play' };
  }
  // end: story complete panorama at the garage, deep night but readable.
  world.timeMin = 22 * 60 + 30;
  world.storyComplete = true; world.missionIdx = 6; world.storyNoticeT = 600;
  p.money = 6200; p.owned = { fist: true, pistol: true, smg: true, shotgun: true }; p.weapon = 'smg';
  const coupe = world.missionCar('coupe');
  coupe.x = garage.x + 40; coupe.y = garage.y + 95; coupe.a = Math.PI / 4;
  p.car = coupe; coupe.driver = 'player'; teleport(world, garage.x + 40, garage.y + 95, Math.PI / 4);
  settle(world, 20);
  return { screen: 'play' };
}
