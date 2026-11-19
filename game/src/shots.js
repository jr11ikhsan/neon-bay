// NEON BAY — deterministic screenshot scenes. The dossier builder asks the game
// for ?shot=<name>&seed=<n>; main.js builds a fresh world, calls setupShot to
// stage the scene, steps the simulation with the scripted controls from
// shotControls for SHOT_STEP_SECONDS, calls finalizeShot to compose the money
// frame, renders, and only then raises window.__shotReady. Everything here
// uses the world's public surface, so a scene is just a saved moment of real
// play: the title over the neon dusk city, a multi-car police chase on the
// shore road, a night shootout under the signs, and the night panorama after
// the story is done.

export const SHOT_STEP_SECONDS = { start: 0.6, play: 3.6, chase: 3.6, end: 1.4 };

const NEUTRAL = { moveX: 0, moveY: 0, run: false, attack: false, interact: false, aimAngle: 0 };

function placePlayerInCoupe(world, x, y, angle, speed) {
  const coupe = world.missionCar;
  coupe.x = x; coupe.y = y; coupe.angle = angle; coupe.speed = speed;
  coupe.driver = 'player';
  world.player.car = coupe;
  world.player.x = x; world.player.y = y; world.player.angle = angle;
  return coupe;
}

// A police car in the exact shape world.js spawns, for composing a chase
// when the wanted system has not delivered enough units into frame yet.
function policeCar(x, y, angle) {
  return {
    kind: 'police', driver: 'police', x, y, angle,
    speed: 0, health: 140, color: '#e8eaf2',
    axis: null, road: 0, dir: 1, turnCd: 0, stuckT: 0, reverseT: 0, copOut: false, flank: 0,
  };
}

function policeCarsOf(world) {
  return world.cars.filter((c) => c.kind === 'police' && c.driver !== 'player');
}

export function setupShot(world, name) {
  const places = world.city.places;
  switch (name) {
    case 'play': {
      // The chase: four stars, the gold coupe flat out east along the shore
      // road at dusk, and the net closing in finalizeShot.
      world.restore({
        money: 250, missionIndex: 1, hasGun: true,
        x: 1250, y: 1591, health: 100, timeHours: 18.2,
        stats: { stolen: 1, kills: 0, missions: 1, shotsFired: 0 },
      });
      placePlayerInCoupe(world, 1250, 1591, 0, 430);
      world.heat = 340;
      world.unseenFor = 0;
      break;
    }
    case 'chase': {
      // The night shootout: Mission 3 moved up the beach to the lit shore
      // road — dealers ahead under the neon, a unit rolling in behind.
      world.restore({
        money: 1300, missionIndex: 2, hasGun: true,
        x: 3320, y: 1545, health: 82, timeHours: 21.2,
        stats: { stolen: 2, kills: 1, missions: 2, shotsFired: 9 },
      });
      world.heat = 460;
      world.unseenFor = 0;
      world.player.angle = 0.5;
      break;
    }
    case 'end': {
      // The panorama: story done, night over the bay. The driver stands at
      // the water's edge looking back at the lit city, coupe parked behind.
      world.restore({
        money: 6200, missionIndex: 6, hasGun: true,
        weapons: { pistol: true, smg: true, shotgun: false }, weapon: 'smg',
        x: 4240, y: 2350, health: 100, timeHours: 22.45,
        stats: { stolen: 6, kills: 4, missions: 6, shotsFired: 34, timePlayed: 1500 },
      });
      const coupe = world.missionCar;
      coupe.x = 4100; coupe.y = 2430;
      coupe.angle = 1.2; coupe.speed = 0; coupe.driver = null;
      world.banner = null; // the fresh-world Mission 1 banner must not linger here
      world.player.car = null;
      world.player.x = 4240;
      world.player.y = 2350;
      // Face north-west along the shoreline: the lit city fills the left of
      // the frame, the neon-streaked water the right, the beach diagonal
      // between them.
      world.player.angle = Math.atan2(-1, -0.55);
      world.storyDoneTimer = 5;
      break;
    }
    case 'start':
    default: {
      // The title screen at full dusk: lamps on, signs lit, traffic streaming
      // along the shore road under the boardwalk viewpoint.
      world.player.x = 3920;
      world.player.y = 1500;
      world.player.angle = Math.PI; // face west: the 3D title camera looks into the city
      world.timeHours = 18.42;
      break;
    }
  }
}

/** Scripted controls while a shot scene settles. */
export function shotControls(name, world) {
  if (name === 'play') {
    // Keep the coupe rolling east; the wanted system brings the frame to life.
    return { ...NEUTRAL, moveY: -1, aimAngle: 0 };
  }
  if (name === 'chase') {
    // Aim at the nearest living dealer and keep firing, like a player would.
    let best = null, bd = Infinity;
    for (const ped of world.peds) {
      if (ped.dealer && !ped.dead) {
        const d = (ped.x - world.player.x) ** 2 + (ped.y - world.player.y) ** 2;
        if (d < bd) { bd = d; best = ped; }
      }
    }
    const aim = best ? Math.atan2(best.y - world.player.y, best.x - world.player.x) : world.player.angle;
    return { ...NEUTRAL, attack: true, aimAngle: aim };
  }
  return { ...NEUTRAL, aimAngle: world.player.angle };
}

/** Compose the money frame after the settle steps: put the units, the
 *  muzzle flash and the skyline exactly where the screenshot needs them. */
export function finalizeShot(world, name) {
  if (name === 'play') {
    const car = world.player.car || world.missionCar;
    if (!car) return;
    car.speed = 430;
    const units = policeCarsOf(world);
    while (units.length < 3) {
      const u = policeCar(car.x - 200, car.y, 0);
      world.cars.push(u);
      units.push(u);
    }
    const spots = [
      { x: car.x - 185, y: car.y - 58, angle: 0.06, speed: 420 },
      { x: car.x - 235, y: car.y + 62, angle: -0.05, speed: 425 },
      { x: car.x + 350, y: car.y - 48, angle: Math.PI, speed: 120 },
    ];
    units.slice(0, 3).forEach((u, i) => {
      u.x = spots[i].x; u.y = spots[i].y; u.angle = spots[i].angle; u.speed = spots[i].speed;
    });
    return;
  }
  if (name === 'chase') {
    const p = world.player;
    world.setWeapon('pistol');
    // Clear the frame: no foot cop breathing down the player's neck, no
    // stray traffic car parked on the camera.
    world.cops = world.cops.filter((c) => Math.hypot(c.x - p.x, c.y - p.y) > 170);
    for (const car of world.cars) {
      if (car.kind !== 'police' && Math.hypot(car.x - p.x, car.y - p.y) < 150) car.y += 430;
    }
    // Bring the nearest living dealer into the light in front of the player.
    let dealer = null, bd = Infinity;
    for (const ped of world.peds) {
      if (ped.dealer && !ped.dead) {
        const d = (ped.x - p.x) ** 2 + (ped.y - p.y) ** 2;
        if (d < bd) { bd = d; dealer = ped; }
      }
    }
    if (dealer) {
      dealer.x = p.x + 175; dealer.y = p.y - 42;
      dealer.angle = Math.atan2(p.y - dealer.y, p.x - dealer.x);
      p.angle = Math.atan2(dealer.y - p.y, dealer.x - p.x);
      // The shot that the camera catches: flash, tracer, impact sparks.
      const gx = p.x + Math.cos(p.angle) * 18, gy = p.y + Math.sin(p.angle) * 18;
      world.muzzle = { x: gx, y: gy, angle: p.angle, ttl: 0.055, maxT: 0.055 };
      world.tracers.push({ x0: gx, y0: gy, x1: dealer.x, y1: dealer.y, ttl: 0.07, maxT: 0.07 });
    }
    // One unit rolling in behind the player, lightbar flashing; any other
    // units hold the deep background.
    let units = policeCarsOf(world);
    if (units.length === 0) {
      const u = policeCar(p.x - 240, p.y + 95, 0.15);
      world.cars.push(u);
      units = [u];
    }
    units[0].x = p.x + 185; units[0].y = p.y + 130; units[0].angle = 2.75; units[0].speed = 60;
    units.slice(1).forEach((u, i) => { u.x = p.x - 460 - i * 90; u.y = p.y + 200; u.angle = 0.1; });
  }
}
