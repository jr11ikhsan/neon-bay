// NEON BAY — deterministic screenshot staging.
// The shell loads ?shot=start|play|chase|end&seed=N, calls stageShot once,
// runs the returned number of fixed ticks (with per-tick control from
// shotTick), then freezes the simulation and keeps rendering — so the
// captured frame is a real moment of the real game, identical every run.

export function stageShot(world, name) {
  const P = world.city.places;
  if (name === 'start') {
    // Title over the living city at 18:42, lamps just coming on.
    world.timeMinutes = 18 * 60 + 42;
    return { ticks: 0, screen: 'title' };
  }
  if (name === 'play') {
    // Mid-story drive: gold coupe on the avenue, package run on the clock,
    // three stars and the net closing in behind.
    world.timeMinutes = 18 * 60 + 5;
    world.missionIndex = 1; world.stepIndex = 0;
    world.weapons.pistol = true;
    world.spawnStepNeeds();
    const coupe = world.makeCar(2220, 1960, -Math.PI / 2, 'sport', 'mission');
    coupe.color = 0xf4d35e;
    world.player.x = 2220; world.player.y = 1960;
    world.enterCar(coupe);
    world.heat = 380; // three stars
    const copSpots = [[2220, 2330], [2160, 2560], [2290, 2790]];
    let i = 0;
    for (const c of world.cars) {
      if (c.kind !== 'cop' || i >= copSpots.length) continue;
      c.x = copSpots[i][0]; c.y = copSpots[i][1]; c.a = -Math.PI / 2; c.axis = 'v'; c.dir = -1; i++;
    }
    return { ticks: 46, screen: 'play' };
  }
  if (name === 'chase') {
    // Night shootout on the beach, 21:21: player trading fire with the
    // first dealer under the mission pillar, a patrol car at the kerb.
    world.timeMinutes = 21 * 60 + 21;
    world.missionIndex = 2; world.stepIndex = 0;
    world.weapons.pistol = true; world.weapon = 'pistol';
    world.spawnStepNeeds();
    const d0 = world.city.beachSpots[0];
    world.player.x = d0.x - 120; world.player.y = d0.y + 26;
    world.player.a = 0;
    const cop = world.cars.find(c => c.kind === 'cop');
    if (cop) { cop.x = world.city.boardwalkX - 30; cop.y = d0.y - 190; cop.a = Math.PI / 2; cop.driver = 'ai'; }
    return { ticks: 16, screen: 'play' };
  }
  // 'end': story complete at 22:30, the gold coupe at Taller Sol.
  world.timeMinutes = 22 * 60 + 30;
  world.missionIndex = 6; world.stepIndex = 0; world.storyComplete = true;
  world.money = 6200;
  const g = P.garage;
  const coupe = world.makeCar(g.x - 92, g.y + 66, Math.PI / 5, 'sport', 'mission');
  coupe.color = 0xf4d35e;
  world.player.x = g.x - 30; world.player.y = g.y + 60;
  world.player.a = Math.PI * 0.8;
  return { ticks: 0, screen: 'play', ribbon: true };
}

// Control applied on tick i while a shot scene settles.
export function shotTick(world, name, i) {
  const c = world.control;
  c.mx = 0; c.my = 0; c.fire = false; c.sprint = false;
  if (name === 'play') {
    c.my = 1; // full throttle up the avenue; the police AI does the rest
  } else if (name === 'chase') {
    const dealer = world.peds.find(p => p.kind === 'dealer' && !p.dead);
    if (dealer) { c.aimX = dealer.x; c.aimY = dealer.y; }
    if (i >= 9) c.fire = true; // tracers + muzzle flash live in the frozen frame
  }
}
