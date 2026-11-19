// NEON BAY v5 — deterministic screenshot scenes behind ?shot=.
// Each scene builds the real world from the given seed, poses it with
// direct state writes, then plays the actual simulation forward with
// scripted controls — so the frame is a moment the game itself produced,
// identical on every run. Scenes: start (title at dusk), play (a fast
// drive under three stars), chase (a beach shootout at night), end
// (story complete, gold coupe by the garage, deep night).

const IDLE = { mx: 0, my: 0, aimX: 0, aimY: 0, fire: false, interact: false, sprint: false, slot: -1 };

function stepN(world, n, controls) {
  for (let i = 0; i < n; i += 1) world.step(1 / 60, typeof controls === 'function' ? controls(i) : controls);
}
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function stageShot(name, world) {
  const state = world.state;
  const p = state.player;
  if (name === 'play') {
    state.minutes = 18 * 60 + 5;
    state.missionIndex = 1;
    state.stepIndex = 0;
    state.spawnedKey = '';
    p.money = 250;
    p.weapons.pistol = true;
    p.weapon = 'pistol';
    const coupe = state.cars.find((c) => c.id === 'coupe');
    coupe.x = 2460; coupe.y = 700; coupe.angle = Math.PI / 2; coupe.speed = 200;
    p.car = coupe;
    coupe.driver = 'player';
    p.x = coupe.x; p.y = coupe.y;
    state.heat = 300; // three stars, sirens behind
    stepN(world, 300, () => {
      const want = Math.atan2((coupe.y + 600) - coupe.y, 2460 - coupe.x);
      const steer = Math.max(-1, Math.min(1, angDiff(want, coupe.angle) * 2.4));
      return { ...IDLE, mx: steer, my: 1, aimX: coupe.x, aimY: coupe.y + 400 };
    });
    return 'play';
  }
  if (name === 'chase') {
    state.minutes = 21 * 60 + 21;
    state.missionIndex = 2;
    state.stepIndex = 0;
    state.spawnedKey = '';
    p.money = 1500;
    p.weapons.pistol = true;
    p.weapon = 'pistol';
    p.x = 4290; p.y = 1600; p.angle = 0.7;
    p.hp = 10000; // staging armour: the scene must survive its own gunfight
    state.heat = 330;
    stepN(world, 280, IDLE); // dealers take their sand, the law rolls in
    // one dealer already down, one in the player's sights
    const first = world.nearestDealer();
    if (first) { first.dead = true; state.kills = 1; }
    const second = world.nearestDealer();
    if (second) {
      p.x = second.x - 165; p.y = second.y - 60;
      p.angle = Math.atan2(second.y - p.y, second.x - p.x);
      stepN(world, 1, IDLE);
      stepN(world, 3, { ...IDLE, fire: true, aimX: second.x, aimY: second.y, slot: 1 });
    }
    p.hp = 82;
    return 'play';
  }
  if (name === 'end') {
    state.minutes = 22 * 60 + 30;
    state.missionIndex = 6;
    state.stepIndex = 0;
    state.storyComplete = true;
    p.money = 6200;
    p.weapons.pistol = true; p.weapons.smg = true; p.weapons.shotgun = true;
    const coupe = state.cars.find((c) => c.id === 'coupe');
    coupe.x = 770; coupe.y = 2720; coupe.angle = 0.35; coupe.speed = 0;
    p.x = 715; p.y = 2745;
    p.angle = Math.atan2(coupe.y - p.y, coupe.x - p.x);
    stepN(world, 90, IDLE);
    return 'play';
  }
  // start: the title at golden dusk, the city alive behind the poster
  state.minutes = 18 * 60 + 42;
  stepN(world, 200, IDLE);
  return 'title';
}
