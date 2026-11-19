// NEON BAY v2 — deterministic screenshot scenes. The shooter loads
// ?shot=start|play|chase|end&seed=N; setup stages the world, drive feeds
// scripted inputs for ~150 fixed steps, finalize composes the last frame.
// Same seed + same scene = same picture, every run.

const IDLE = { mx: 0, my: 0, run: false, attack: false, aim: null, weapon: null };

export function stageShot(world, name) {
  const W = world.state, player = world.player, city = world.city;
  if (name === 'start') {
    W.minutes = 18 * 60 + 42;                       // lamps on, sky still burning
    player.x = 4020; player.y = 1290; player.a = -0.5;
  } else if (name === 'play') {
    W.minutes = 18 * 60 + 5;
    W.mIdx = 1;                                     // Mission 2 — Package Run
    W.banner = { title: 'Mission 2 — Package Run', sub: 'A package waits in the west park. It is hot.', t: 999 };
    const coupe = world.coupe;
    coupe.x = 1620; coupe.y = 2080; coupe.a = -Math.PI / 2; coupe.speed = 430;
    coupe.driver = 'player'; player.car = coupe;
    player.x = coupe.x; player.y = coupe.y;
    // clear the avenue corridor so the take is clean
    for (const c of W.cars) if (c !== coupe && Math.abs(c.x - 1620) < 95 && c.y > 500 && c.y < 2300) { c.x += 760; c.wp = null; }
    W.heat = 330;                                   // three stars, units inbound
  } else if (name === 'chase') {
    W.minutes = 21 * 60 + 21;                       // full night — and readable (v2)
    W.mIdx = 2;                                     // Mission 3 — Beachside Business
    W.stepKills = 1;
    W.banner = { title: 'Mission 3 — Beachside Business', sub: 'Shut down the beach dealers', t: 999 };
    player.weapons = ['fist', 'pistol']; player.weapon = 'pistol';
    player.x = 4275; player.y = 1905; player.hp = 78;
    player.a = Math.atan2(1830 - player.y, 4460 - player.x);
    const dealers = W.peds.filter((p) => p.kind === 'dealer');
    if (dealers[0]) { dealers[0].hp = 0; dealers[0].down = 80; dealers[0].x = 4360; dealers[0].y = 1870; }
    if (dealers[1]) { dealers[1].x = 4460; dealers[1].y = 1830; }
    W.heat = 320;
  } else if (name === 'end') {
    W.minutes = 22 * 60 + 30;                       // deep night panorama
    W.mIdx = 6; W.storyComplete = true;
    W.money = 7450;
    W.banner = { title: 'STORY COMPLETE', sub: 'Neon Bay is yours.', t: 999 };
    const coupe = world.coupe;
    coupe.x = 4052; coupe.y = 2820; coupe.a = 0.35; coupe.speed = 0;
    player.x = 3968; player.y = 2748; player.a = 0.35;
  }
}

export function shotDrive(world, name, frame) {
  const player = world.player;
  if (name === 'play') return { mx: 0, my: -1, run: false, attack: false, aim: null, weapon: null };
  if (name === 'chase') {
    const d = world.state.peds.find((p) => p.kind === 'dealer' && !p.down);
    const aim = d ? Math.atan2(d.y - player.y, d.x - player.x) : player.a;
    return { mx: 0, my: 0, run: false, attack: frame > 116, aim, weapon: null };
  }
  return IDLE;
}

export function finalizeShot(world, name) {
  const W = world.state, player = world.player;
  if (name === 'play') {
    const cops = W.cars.filter((c) => c.kind === 'police');
    if (cops[0]) { cops[0].x = player.x - 66; cops[0].y = player.y + 320; cops[0].a = -Math.PI / 2; cops[0].speed = 430; }
    if (cops[1]) { cops[1].x = player.x + 84; cops[1].y = player.y + 445; cops[1].a = -Math.PI / 2; cops[1].speed = 430; }
  } else if (name === 'chase') {
    const cop = W.cars.find((c) => c.kind === 'police');
    if (cop) { cop.x = 4165; cop.y = 1735; cop.a = 0.6; cop.speed = 0; }
    const d = W.peds.find((p) => p.kind === 'dealer' && !p.down);
    if (d) {
      W.fx.push({ kind: 'tracer', x1: player.x, y1: player.y, x2: d.x, y2: d.y, ttl: 0.09, max: 0.09 });
      W.fx.push({ kind: 'flash', x: player.x + Math.cos(player.a) * 24, y: player.y + Math.sin(player.a) * 24, ttl: 0.06, max: 0.06 });
    }
  }
}
