// NEON BAY — deterministic screenshot scenes. The dossier builder asks the game
// for ?shot=<name>&seed=<n>; main.js builds a fresh world, calls setupShot to
// stage the scene, steps the simulation with the scripted controls from
// shotControls for SHOT_STEP_SECONDS, renders, and only then raises
// window.__shotReady. Everything here uses the world's public surface, so a
// scene is just a saved moment of real play: the title over the living city, a
// getaway drive with the law converging, the beach shootout from Mission 3,
// and the quiet night after the story is done.

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

export function setupShot(world, name) {
  const places = world.city.places;
  switch (name) {
    case 'play': {
      // Fresh from Mission 1: the coupe is rolling east along the shore road
      // with three stars on it and the package run about to begin.
      world.restore({
        money: 250, missionIndex: 1, hasGun: true,
        x: 2100, y: 1591, health: 100, timeHours: 18.05,
        stats: { stolen: 1, kills: 0, missions: 1, shotsFired: 0 },
      });
      placePlayerInCoupe(world, 2100, 1591, 0, 380);
      world.heat = 255;
      world.unseenFor = 0;
      break;
    }
    case 'chase': {
      // Mission 3 on the sand: dealers in front, police coming down the beach.
      world.restore({
        money: 650, missionIndex: 2, hasGun: true,
        x: 4052, y: 1912, health: 82, timeHours: 18.5,
        stats: { stolen: 1, kills: 0, missions: 2, shotsFired: 6 },
      });
      world.heat = 290;
      world.unseenFor = 0;
      world.player.angle = Math.atan2(1830 - 1912, 4170 - 4052);
      break;
    }
    case 'end': {
      // The story is done. Night, the gold coupe parked at Taller Sol, and the
      // driver standing beside it taking in the neon.
      world.restore({
        money: 2800, missionIndex: 4, hasGun: true,
        x: places.garage.x - 70, y: places.garage.y + 26, health: 100, timeHours: 21.35,
        stats: { stolen: 4, kills: 3, missions: 4, shotsFired: 21 },
      });
      const coupe = world.missionCar;
      coupe.x = places.garage.x; coupe.y = places.garage.y;
      coupe.angle = Math.PI / 2; coupe.speed = 0; coupe.driver = null;
      world.banner = null; // the fresh-world Mission 1 banner must not linger here
      world.player.car = null;
      world.player.x = places.garage.x - 70;
      world.player.y = places.garage.y + 26;
      world.player.angle = 0.4;
      world.storyDoneTimer = 5;
      break;
    }
    case 'start':
    default: {
      // The title screen watches the city wake up at golden hour, from the
      // boardwalk above the beach road.
      world.player.x = 3860;
      world.player.y = 1500;
      world.player.angle = Math.PI; // face west: the 3D title camera looks into the city
      world.timeHours = 17.58;
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
