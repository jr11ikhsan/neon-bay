// NEON BAY v2 — the simulation. Pure logic, no DOM and no renderer: the
// player on foot and in cars, traffic on the road grid, pedestrians,
// dealers, the five-star wanted system with encircling police, the
// three-gun combat model, the place economy, the six-mission story,
// busted / wasted, saves and run statistics. Driven by fixed steps.

import { STEP, WORLD, DAY, PLAYER, WEAPONS, WEAPON_ORDER, CAR, TRAFFIC, WANTED, POLICE, PRICES, BANK } from './config.js';
import { createCity, collideWorld, lineOfSight, nearestIntersection, AVENUES, STREETS, BOARDWALK } from './city.js';
import { MISSIONS, POINTS } from './missions.js';
import { makeRng, clamp, angDiff, hash2 } from './random.js';

const CAR_TYPES = {
  sedan:  { top: 1.0,  hp: 100, col: ['#c94f4f', '#4f79c9', '#c9c9c9', '#5fbf77', '#c9a44f', '#7a5fc0', '#4fc0c9'] },
  taxi:   { top: 1.0,  hp: 100, col: ['#ffd23e'] },
  van:    { top: 0.8,  hp: 150, col: ['#b8bec9', '#5b6b7d', '#8a4f6b'] },
  pickup: { top: 0.9,  hp: 135, col: ['#7d8a99', '#a4552f', '#3f6b4f'] },
  sport:  { top: 1.24, hp: 92,  col: ['#ff2e88', '#00e5ff', '#b26bff', '#ff7a3e'] },
  coupe:  { top: 1.3,  hp: 105, col: ['#ffd23e'] },
  racer:  { top: 1.34, hp: 95,  col: ['#00e5ff'] },
  police: { top: 1.2,  hp: 160, col: ['#eef2f7'] },
};
const TYPE_KEYS = Object.keys(CAR_TYPES);

export function createWorld(seed = 1) {
  const city = createCity(seed);
  const rng = makeRng(seed * 31337 + 7);
  const VROADS = [...city.avenues, city.boardwalk];
  const HROADS = city.streets;

  const W = {
    city, seed, time: 0, minutes: DAY.start, day: 1,
    money: 0, storyComplete: false, bankCd: 0,
    heat: 0, unseenFor: 99, bustedMeter: 0,
    player: null, cars: [], peds: [], officers: [], pickups: [],
    fx: [], sounds: [], toasts: [], banner: null,
    mIdx: 0, sIdx: 0, stepProg: 0, stepKills: 0,
    shopIdx: 0, saveRequested: false, event: null, // event: 'busted' | 'wasted' (latched for main)
    stats: { stolen: 0, shots: 0, kills: 0, timePlayed: 0, missions: 0, earned: 0 },
    best: 0, camShake: 0,
  };

  let nextId = 1;
  const player = W.player = {
    x: city.spawn.x, y: city.spawn.y, a: -Math.PI / 2, hp: PLAYER.hp,
    car: null, weapon: 'fist', weapons: ['fist'], fireCd: 0, punchCd: 0, dead: false, hitT: 0,
  };

  // ------------------------------------------------------------- spawning
  function makeCar(kind, type, x, y, a, color) {
    const t = CAR_TYPES[type];
    const car = {
      id: nextId++, kind, type, x, y, a, speed: 0,
      hp: t.hp, maxHp: t.hp, top: t.top, color: color ?? rng.pick(t.col),
      driver: null, wrecked: false, wp: null, cruise: rng.range(240, 360),
      stuck: 0, flank: 0, light: rng.range(0, 6), smokeAcc: 0, routeT: 0,
    };
    W.cars.push(car);
    return car;
  }
  // lane-correct position + heading for a grid waypoint target
  function gridTarget(car, ni, nj) {
    return { x: ni, y: nj };
  }
  function pickWaypoint(car) {
    // choose the next intersection to drive to, from the car's position
    const here = nearestIntersection(city, car.x, car.y);
    const opts = [];
    for (const o of city.intersections) {
      const sameRow = Math.abs(o.y - here.y) < 4, sameCol = Math.abs(o.x - here.x) < 4;
      if ((sameRow || sameCol) && o !== here) opts.push(o);
    }
    if (!opts.length) return here;
    // prefer continuing in roughly the current heading
    opts.sort((p, q) => {
      const dp = Math.cos(car.a) * (p.x - car.x) + Math.sin(car.a) * (p.y - car.y);
      const dq = Math.cos(car.a) * (q.x - car.x) + Math.sin(car.a) * (q.y - car.y);
      return dq - dp;
    });
    const fwd = opts.filter((o) => Math.cos(car.a) * (o.x - car.x) + Math.sin(car.a) * (o.y - car.y) > 30);
    const pool = fwd.length && rng.chance(0.72) ? fwd : opts;
    return rng.pick(pool);
  }
  function spawnTraffic() {
    for (let i = 0; i < TRAFFIC.cars; i++) {
      const inter = rng.pick(city.intersections);
      const type = rng.pick(['sedan', 'sedan', 'sedan', 'taxi', 'van', 'pickup', 'sport']);
      const car = makeCar('traffic', type, inter.x + rng.range(-30, 30), inter.y + rng.range(-30, 30), rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]));
      car.driver = 'traffic';
      car.wp = pickWaypoint(car);
    }
  }
  function spawnParked() {
    const spots = [];
    for (const lot of city.lots) for (const s of lot.stalls) spots.push(s);
    for (const a of AVENUES) for (let y = 300; y < 3400; y += 235) {
      if (STREETS.some((s) => Math.abs(s - y) < 110)) continue;
      spots.push({ x: a - 44, y: y + hash2(a, y) * 40, a: Math.PI / 2 });
      spots.push({ x: a + 44, y: y + 120, a: -Math.PI / 2 });
    }
    // shuffle deterministically, take what we need
    for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
    for (const s of spots.slice(0, TRAFFIC.parked)) {
      if (Math.hypot(s.x - player.x, s.y - player.y) < 130) continue;
      makeCar('parked', rng.pick(['sedan', 'sedan', 'taxi', 'van', 'pickup', 'sport']), s.x, s.y, s.a);
    }
  }
  function spawnPeds() {
    for (let i = 0; i < TRAFFIC.peds; i++) {
      const onBeach = rng.chance(0.3);
      const x = onBeach ? rng.range(WORLD.beachX + 30, WORLD.waterX - 70) : rng.range(140, 3980);
      const y = rng.range(140, WORLD.h - 140);
      W.peds.push({
        id: nextId++, kind: 'ped', x, y, a: rng.range(0, 6.28), hp: 40,
        state: 'wander', tx: x, ty: y, t: rng.range(0, 3), down: 0, hue: rng.int(0, 5), fleeA: 0,
      });
    }
    for (const d of city.dealers) {
      W.peds.push({
        id: nextId++, kind: 'dealer', x: d.x, y: d.y, a: rng.range(0, 6.28), hp: 70,
        state: 'guard', tx: d.x, ty: d.y, t: 0, down: 0, hue: 9, fleeA: 0, fireCd: rng.range(0.4, 1.2),
      });
    }
  }

  const coupe = makeCar('coupe', 'coupe', city.coupeSpot.x, city.coupeSpot.y, city.coupeSpot.a);
  let jobCar = null, ownedCar = null;
  spawnTraffic(); spawnParked(); spawnPeds();

  // ------------------------------------------------------------- helpers
  const toast = (text, secs = 3.2) => { W.toasts.push({ text, t: secs }); if (W.toasts.length > 3) W.toasts.shift(); };
  const say = (s) => W.sounds.push(s);
  const stars = () => {
    let s = 0;
    for (let i = 1; i <= 5; i++) if (W.heat >= WANTED.thresholds[i]) s = i;
    return s;
  };
  const witnessed = (x, y, range = 330) => {
    for (const c of W.cars) if (c.kind === 'police' && !c.wrecked && Math.hypot(c.x - x, c.y - y) < range && lineOfSight(city, x, y, c.x, c.y)) return true;
    for (const o of W.officers) if (Math.hypot(o.x - x, o.y - y) < range && lineOfSight(city, x, y, o.x, o.y)) return true;
    for (const p of W.peds) if (!p.down && p.kind === 'ped' && Math.hypot(p.x - x, p.y - y) < 240 && lineOfSight(city, x, y, p.x, p.y)) return true;
    return false;
  };
  const addHeat = (n, x = player.x, y = player.y) => { W.heat += witnessed(x, y) ? n : n * 0.35; };
  const addFx = (fx) => { W.fx.push(fx); if (W.fx.length > 420) W.fx.splice(0, W.fx.length - 420); };
  const burst = (x, y, kind, n = 6) => { for (let i = 0; i < n; i++) addFx({ kind, x, y, vx: rng.range(-90, 90), vy: rng.range(-90, 90), ttl: rng.range(0.25, 0.6), max: 0.6 }); };

  function mission() { return MISSIONS[W.mIdx] ?? null; }
  function stepDef() { const m = mission(); return m ? m.steps[W.sIdx] : null; }
  function targetCar(kind) { return kind === 'coupe' ? coupe : jobCar; }
  function stepTarget() {
    const st = stepDef(); if (!st) return null;
    if (st.t === 'steal' || st.t === 'deliverCar') {
      if (st.t === 'steal') { const c = targetCar(st.car); return c ? { x: c.x, y: c.y } : null; }
      const p = city.places[st.place]; return { x: p.bx, y: p.by };
    }
    if (st.place) { const p = city.places[st.place]; return { x: p.bx, y: p.by }; }
    if (st.point) return POINTS[st.point](city);
    if (st.t === 'kill') {
      let best = null, bd = Infinity;
      for (const p of W.peds) if (p.kind === 'dealer' && !p.down) { const d = (p.x - player.x) ** 2 + (p.y - player.y) ** 2; if (d < bd) { bd = d; best = p; } }
      return best ? { x: best.x, y: best.y } : null;
    }
    return null;
  }
  function objective() {
    const m = mission(), st = stepDef();
    if (!m || !st) return null;
    const tgt = stepTarget();
    let sub = '';
    if (st.t === 'kill') sub = `Dealers down: ${W.stepKills}/${st.count}`;
    if (st.t === 'channel') sub = W.stepProg > 0 ? `Cracking… ${Math.floor((W.stepProg / st.secs) * 100)}%` : '';
    if (st.t === 'escape') sub = stars() ? `${stars()} star${stars() > 1 ? 's' : ''} — break line of sight` : '';
    return { x: tgt?.x, y: tgt?.y, label: st.label, sub, mission: m.title, n: W.mIdx + 1 };
  }
  function startMissionBanner() {
    const m = mission(); if (!m) return;
    W.banner = { title: `Mission ${W.mIdx + 1} — ${m.title}`, sub: m.intro, t: 4.2 };
    toast(m.intro, 4.2);
  }
  function completeStep() {
    const m = mission(), st = stepDef();
    W.sIdx++; W.stepProg = 0; W.stepKills = 0;
    say('step');
    if (W.sIdx >= m.steps.length) {
      W.money += m.reward; W.stats.earned += m.reward; W.stats.missions++;
      if (m.unlock && !player.weapons.includes(m.unlock)) { player.weapons.push(m.unlock); player.weapon = m.unlock; }
      W.banner = { title: `${m.title} — Complete`, sub: `+$${m.reward.toLocaleString()}${m.unlock ? ' · ' + WEAPONS[m.unlock].name + ' acquired' : ''}`, t: 4 };
      say('mission');
      W.mIdx++; W.sIdx = 0;
      W.saveRequested = true;
      if (W.mIdx >= MISSIONS.length) { W.storyComplete = true; W.banner = { title: 'STORY COMPLETE', sub: 'Neon Bay is yours. Free roam — the bank vault refills.', t: 6 }; }
      else { startMissionBanner(); onStepBegin(); }
    } else {
      toast(stepDef().label, 3.4);
      onStepBegin();
    }
  }
  function onStepBegin() {
    const st = stepDef(); if (!st) return;
    if (st.t === 'steal' && st.car === 'job' && !jobCar) {
      jobCar = makeCar('job', 'racer', city.jobCarSpot.x, city.jobCarSpot.y, city.jobCarSpot.a);
      toast('The cyan racer glints under the Bay Motors lights.', 3.4);
    }
    if (st.t === 'pickup') {
      const pt = POINTS[st.point](city);
      W.pickups.push({ id: nextId++, kind: 'package', x: pt.x, y: pt.y, mission: true });
    }
  }

  // ------------------------------------------------------------- combat
  function hurtPlayer(dmg) {
    if (player.dead) return;
    player.hp -= dmg;
    W.camShake = Math.min(9, W.camShake + dmg * 0.22);
    if (player.hp <= 0) { player.hp = 0; player.dead = true; W.event = 'wasted'; say('wasted'); }
  }
  function rayHit(x, y, a, range) {
    // walk the ray; return the first thing struck
    let hit = null;
    for (let d = 12; d <= range; d += 9) {
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      for (const b of city.buildings) if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return { x: px, y: py, what: 'wall' };
      for (const p of W.peds) if (!p.down && Math.hypot(p.x - px, p.y - py) < 17) { hit = { x: px, y: py, what: 'ped', ped: p }; return hit; }
      for (const c of W.cars) if (c !== player.car && Math.hypot(c.x - px, c.y - py) < 34) return { x: px, y: py, what: 'car', car: c };
      if (px < 0 || py < 0 || px > WORLD.w || py > WORLD.h) return { x: px, y: py, what: 'edge' };
    }
    return { x: x + Math.cos(a) * range, y: y + Math.sin(a) * range, what: 'air' };
  }
  function damagePed(p, dmg, kx, ky) {
    p.hp -= dmg;
    p.x += kx; p.y += ky;
    if (p.hp <= 0 && !p.down) {
      p.down = 90; W.stats.kills++;
      burst(p.x, p.y, 'spark', 8);
      if (p.kind === 'dealer') {
        const st = stepDef();
        if (st && st.t === 'kill') { W.stepKills++; toast(`Dealer down — ${W.stepKills}/${st.count}`, 2.4); }
        W.pickups.push({ id: nextId++, kind: 'cash', x: p.x, y: p.y, value: rng.int(30, 70) });
      } else if (rng.chance(0.4)) W.pickups.push({ id: nextId++, kind: 'cash', x: p.x, y: p.y, value: rng.int(8, 34) });
      else if (rng.chance(0.22)) W.pickups.push({ id: nextId++, kind: 'snack', x: p.x, y: p.y, value: 25 });
    } else if (!p.down) { p.state = 'flee'; p.fleeA = Math.atan2(p.y - player.y, p.x - player.x); p.t = 2.6; }
  }
  function damageCar(c, dmg) {
    if (c.wrecked) return;
    c.hp -= dmg;
    if (c.hp <= 0) {
      c.hp = 0; c.wrecked = true; c.speed = 0;
      burst(c.x, c.y, 'fire', 14);
      if (c.driver === 'traffic') { c.driver = null; ejectDriver(c, 'ped'); }
      if (c === targetCar('coupe') || c === targetCar('job')) setTimeoutRespawn(c);
    }
  }
  const respawnQueue = [];
  function setTimeoutRespawn(car) { respawnQueue.push({ car, t: 5 }); }
  function ejectDriver(c, kind) {
    W.peds.push({
      id: nextId++, kind: 'ped', x: c.x + 30, y: c.y, a: 0, hp: 40, state: 'flee',
      tx: c.x, ty: c.y, t: 3, down: 0, hue: rng.int(0, 5), fleeA: rng.range(0, 6.28),
    });
  }
  function playerShoot(aim) {
    const wpn = WEAPONS[player.weapon];
    player.fireCd = wpn.rate;
    W.stats.shots++;
    say('shot-' + player.weapon);
    addFx({ kind: 'flash', x: player.x + Math.cos(aim) * 22, y: player.y + Math.sin(aim) * 22, ttl: 0.05, max: 0.05 });
    for (let i = 0; i < wpn.pellets; i++) {
      const a = aim + (rng.next() - 0.5) * 2 * wpn.spread + (wpn.pellets > 1 ? (i - (wpn.pellets - 1) / 2) * 0.045 : 0);
      const hit = rayHit(player.x, player.y, a, wpn.range);
      addFx({ kind: 'tracer', x1: player.x, y1: player.y, x2: hit.x, y2: hit.y, ttl: 0.09, max: 0.09 });
      if (hit.what === 'ped') damagePed(hit.ped, wpn.dmg, Math.cos(a) * 7, Math.sin(a) * 7);
      else if (hit.what === 'car') { damageCar(hit.car, wpn.dmg); burst(hit.x, hit.y, 'spark', 3); }
      else if (hit.what === 'wall') burst(hit.x, hit.y, 'spark', 2);
    }
    addHeat(24);
    scareNearby(player.x, player.y);
  }
  function playerPunch(aim) {
    player.punchCd = PLAYER.punchRate;
    say('punch');
    let best = null, bd = PLAYER.punchRange;
    for (const p of W.peds) {
      if (p.down) continue;
      const d = Math.hypot(p.x - player.x, p.y - player.y);
      if (d < bd && Math.abs(angDiff(Math.atan2(p.y - player.y, p.x - player.x), aim)) < 1.1) { best = p; bd = d; }
    }
    if (best) { damagePed(best, PLAYER.punchDmg, Math.cos(aim) * 12, Math.sin(aim) * 12); say('hit'); addHeat(28); }
  }
  function scareNearby(x, y) {
    for (const p of W.peds) if (!p.down && p.kind === 'ped' && Math.hypot(p.x - x, p.y - y) < 300) {
      p.state = 'flee'; p.fleeA = Math.atan2(p.y - y, p.x - x); p.t = Math.max(p.t, 2.2);
    }
  }

  // ------------------------------------------------------------- car motion
  function steerCar(car, tx, ty, top, dt, arrive = 0) {
    const dx = tx - car.x, dy = ty - car.y;
    const dist = Math.hypot(dx, dy);
    const want = Math.atan2(dy, dx);
    const diff = angDiff(want, car.a);
    car.a += clamp(diff, -2.6 * dt, 2.6 * dt);
    let target = top;
    if (Math.abs(diff) > 1.15) target = top * 0.35;
    if (arrive && dist < arrive) target = Math.min(target, top * clamp(dist / arrive, 0.08, 1));
    car.speed += clamp(target - car.speed, -640 * dt, 300 * dt);
    car.x += Math.cos(car.a) * car.speed * dt;
    car.y += Math.sin(car.a) * car.speed * dt;
    const [nx, ny] = collideWorld(city, car.x, car.y, 30);
    if (nx !== car.x || ny !== car.y) { car.x = nx; car.y = ny; if (car.speed > 200) damageCar(car, 3); car.speed *= 0.55; car.stuck += dt; }
    else car.stuck = Math.max(0, car.stuck - dt * 2);
    if (car.stuck > 1.1) { // reverse out of trouble
      car.speed = -190; car.x += Math.cos(car.a) * car.speed * dt * 2.2; car.y += Math.sin(car.a) * car.speed * dt * 2.2;
      car.a += 0.9 * dt * (car.id % 2 ? 1 : -1); car.stuck = 0;
    }
    return dist;
  }
  function carObstacleAhead(car, gap) {
    const ax = car.x + Math.cos(car.a) * gap, ay = car.y + Math.sin(car.a) * gap;
    for (const c of W.cars) if (c !== car && Math.hypot(c.x - ax, c.y - ay) < 44) return true;
    for (const p of W.peds) if (!p.down && Math.hypot(p.x - ax, p.y - ay) < 30) return true;
    if (!player.car && Math.hypot(player.x - ax, player.y - ay) < 30) return true;
    return false;
  }
  function updateTraffic(car, dt) {
    if (car.wrecked || car.driver !== 'traffic') return;
    if (!car.wp) car.wp = pickWaypoint(car);
    let { x: tx, y: ty } = car.wp;
    const dx = tx - car.x, dy = ty - car.y;
    if (Math.abs(dx) > Math.abs(dy)) ty -= Math.sign(dx) * 26; else tx += Math.sign(dy) * 26; // keep a lane
    let top = car.cruise * car.top;
    if (carObstacleAhead(car, 86)) top = 0; else if (carObstacleAhead(car, 150)) top *= 0.45;
    const d = steerCar(car, tx, ty, top, dt);
    if (d < 64) car.wp = pickWaypoint(car);
  }
  function spawnPoliceCar() {
    let spot = null;
    for (let tries = 0; tries < 14 && !spot; tries++) {
      const i = rng.pick(city.intersections);
      const d = Math.hypot(i.x - player.x, i.y - player.y);
      if (d > POLICE.spawnMin && d < POLICE.spawnMax) spot = i;
    }
    if (!spot) spot = city.intersections.reduce((a, b) => (Math.hypot(b.x - player.x, b.y - player.y) > Math.hypot(a.x - player.x, a.y - player.y) ? b : a));
    const car = makeCar('police', 'police', spot.x, spot.y, Math.atan2(player.y - spot.y, player.x - spot.x));
    car.driver = 'police';
    car.flank = [-1, 0, 1][W.cars.filter((c) => c.kind === 'police').length % 3];
    return car;
  }
  function updatePolice(dt) {
    const st = stars();
    const active = W.cars.filter((c) => c.kind === 'police' && !c.wrecked);
    const want = POLICE.carsByStar[st];
    if (active.length < want) spawnPoliceCar();
    for (let i = W.cars.length - 1; i >= 0; i--) {
      const c = W.cars[i];
      if (c.kind !== 'police') continue;
      const d = Math.hypot(c.x - player.x, c.y - player.y);
      if ((c.wrecked && d > 1300) || (st === 0 && d > 1500) || d > 2400) { W.cars.splice(i, 1); continue; }
      if (c.wrecked || c.driver !== 'police') continue;
      if (st === 0) { c.driver = 'traffic'; c.wp = null; continue; } // heat gone: the patrol breaks off and rejoins traffic
      // pursuit: grid-route when far or blind, direct chase (with flanks) when close
      c.routeT -= dt;
      // a boxed-in suspect breaks the box: if we have sat on a nearly stopped
      // car for a while, pull away and come back for another run at it
      if (player.car && d < 95 && Math.abs(player.car.speed) < 45) c.boxT = (c.boxT || 0) + dt; else c.boxT = 0;
      if (c.boxT > 2.2) { c.boxT = 0; c.repoT = 2.6; const l = d || 1; c.wp = { x: clamp(c.x + (c.x - player.x) / l * 380, 60, WORLD.w - 60), y: clamp(c.y + (c.y - player.y) / l * 380, 60, WORLD.h - 60) }; }
      if (c.repoT > 0) c.repoT -= dt;
      const direct = c.repoT <= 0 && d < 430 && lineOfSight(city, c.x, c.y, player.x, player.y);
      let tx, ty;
      if (c.repoT > 0 && c.wp) { tx = c.wp.x; ty = c.wp.y; }
      else if (direct) {
        tx = player.x; ty = player.y;
        if (d < 320) { const px = -(player.y - c.y), py = (player.x - c.x); const l = Math.hypot(px, py) || 1; tx += (px / l) * c.flank * 118; ty += (py / l) * c.flank * 118; }
      } else {
        if (!c.wp || c.routeT <= 0) { const ni = nearestIntersection(city, player.x, player.y); c.wp = { x: ni.x, y: ni.y }; c.routeT = 0.8; }
        tx = c.wp.x; ty = c.wp.y;
      }
      let top = POLICE.carSpeed * c.top * (0.82 + st * 0.05);
      if (d < 74 && !player.car) top = 0;
      // pace a fleeing car from behind or alongside instead of ramming through
      // it; a unit ahead of the suspect is a roadblock, not a magnet
      if (player.car && d < 84 && (c.x - player.x) * Math.cos(player.a) + (c.y - player.y) * Math.sin(player.a) < 30) top = Math.min(top, Math.abs(player.car.speed) * 0.99 + 14);
      steerCar(c, tx, ty, top, dt);
      // officer steps out when close and the player is exposed
      const footWant = POLICE.footByStar[st];
      if (d < 150 && W.officers.length < Math.max(footWant, st >= 2 ? 1 : 0) && (!player.car || Math.abs(player.car.speed) < 55)) {
        c.driver = null; c.parked = true;
        W.officers.push({ id: nextId++, x: c.x + 34, y: c.y + 10, a: 0, hp: 60, carRef: c, fireCd: rng.range(0.3, 0.9), down: 0 });
      }
    }
    // foot officers
    for (let i = W.officers.length - 1; i >= 0; i--) {
      const o = W.officers[i];
      const d = Math.hypot(o.x - player.x, o.y - player.y);
      if (d > 1100) { W.officers.splice(i, 1); continue; }
      if (player.car && d > 330 && Math.hypot(o.x - o.carRef.x, o.y - o.carRef.y) < 60) {
        o.carRef.driver = 'police'; o.carRef.parked = false; W.officers.splice(i, 1); continue;
      }
      o.a = Math.atan2(player.y - o.y, player.x - o.x);
      if (d > 52) {
        o.x += Math.cos(o.a) * POLICE.footSpeed * dt;
        o.y += Math.sin(o.a) * POLICE.footSpeed * dt;
        const [nx, ny] = collideWorld(city, o.x, o.y, 13); o.x = nx; o.y = ny;
      }
      o.fireCd -= dt;
      // officers engage an on-foot suspect; a moving car is the patrol cars' problem
      if (st >= 2 && !player.car && d < POLICE.shootRange && o.fireCd <= 0 && lineOfSight(city, o.x, o.y, player.x, player.y)) {
        o.fireCd = POLICE.shootRate * rng.range(0.8, 1.3);
        say('shot-pistol');
        const miss = rng.chance(0.48);
        addFx({ kind: 'tracer', x1: o.x, y1: o.y, x2: player.x + (miss ? rng.range(-46, 46) : 0), y2: player.y + (miss ? rng.range(-46, 46) : 0), ttl: 0.09, max: 0.09 });
        if (!miss) hurtPlayer(POLICE.shootDmg);
      }
    }
  }

  // ------------------------------------------------------------- peds
  function updatePeds(dt) {
    for (let i = W.peds.length - 1; i >= 0; i--) {
      const p = W.peds[i];
      if (p.down) { p.down -= dt; if (p.down <= 0) W.peds.splice(i, 1); continue; }
      p.t -= dt;
      if (p.kind === 'dealer') {
        const d = Math.hypot(p.x - player.x, p.y - player.y);
        const hostile = !player.dead && d < 330 && lineOfSight(city, p.x, p.y, player.x, player.y) &&
          (player.weapon !== 'fist' || (stepDef()?.t === 'kill'));
        p.a = Math.atan2(player.y - p.y, player.x - p.x);
        if (hostile) {
          p.fireCd = (p.fireCd ?? 1) - dt;
          if (d > 190) { p.x += Math.cos(p.a) * 66 * dt; p.y += Math.sin(p.a) * 66 * dt; }
          if (p.fireCd <= 0) {
            p.fireCd = rng.range(0.85, 1.4);
            say('shot-pistol');
            const miss = rng.chance(0.55);
            addFx({ kind: 'tracer', x1: p.x, y1: p.y, x2: player.x + (miss ? rng.range(-40, 40) : 0), y2: player.y + (miss ? rng.range(-40, 40) : 0), ttl: 0.09, max: 0.09 });
            if (!miss) hurtPlayer(6);
          }
        }
        continue;
      }
      // civilian
      let sp = 0, moveA = p.a;
      if (p.state === 'flee') {
        sp = 252; moveA = p.fleeA + Math.sin(W.time * 7 + p.id) * 0.35;
        if (p.t <= 0) p.state = 'wander';
      } else {
        if (p.t <= 0 || Math.hypot(p.tx - p.x, p.ty - p.y) < 18) {
          p.tx = clamp(p.x + rng.range(-330, 330), 60, WORLD.waterX - 60);
          p.ty = clamp(p.y + rng.range(-330, 330), 60, WORLD.h - 60);
          p.t = rng.range(2.5, 6);
        }
        moveA = Math.atan2(p.ty - p.y, p.tx - p.x);
        sp = 78;
      }
      p.a = moveA;
      p.x += Math.cos(moveA) * sp * dt;
      p.y += Math.sin(moveA) * sp * dt;
      const [nx, ny] = collideWorld(city, p.x, p.y, 12); p.x = nx; p.y = ny;
    }
  }

  // ------------------------------------------------------------- player
  function drivePlayerCar(dt, inp) {
    const car = player.car;
    const th = -inp.my; // W = forward
    if (th > 0) car.speed += CAR.accel * dt * (1 - Math.max(0, car.speed) / (CAR.maxFwd * car.top));
    else if (th < 0) {
      if (car.speed > 14) car.speed -= CAR.brake * dt;
      else car.speed = Math.max(car.speed - CAR.accel * 0.55 * dt, -CAR.maxRev);
    }
    car.speed -= car.speed * CAR.drag * dt * 0.35;
    if (!th) car.speed *= (1 - 0.5 * dt);
    const steer = inp.mx;
    // arcade handling: keep at least 35% steering authority at a crawl, so a
    // car nosed into a wall can always turn itself free
    if (Math.abs(car.speed) > 4) car.a += steer * CAR.turn * dt * clamp(Math.abs(car.speed) / 250, 0.35, 1) * Math.sign(car.speed);
    const px = car.x, py = car.y;
    car.x += Math.cos(car.a) * car.speed * dt;
    car.y += Math.sin(car.a) * car.speed * dt;
    const [nx, ny] = collideWorld(city, car.x, car.y, 30);
    if (nx !== car.x || ny !== car.y) {
      const impact = Math.abs(car.speed);
      car.x = nx; car.y = ny;
      if (impact > 240) { damageCar(car, (impact - 240) * 0.03); W.camShake = Math.min(8, W.camShake + 2.4); say('crash'); }
      car.speed *= -0.22;
    }
    player.x = car.x; player.y = car.y; player.a = car.a;
    if (Math.abs(car.speed) > 60 && rng.chance(dt * 2)) addFx({ kind: 'smoke', x: px, y: py, vx: 0, vy: 0, ttl: 0.5, max: 0.5 });
    void px; void py;
  }
  function updatePlayer(dt, inp) {
    if (player.dead) return;
    player.fireCd -= dt; player.punchCd -= dt; player.hitT -= dt;
    if (inp.weapon != null) {
      const wname = WEAPON_ORDER[inp.weapon];
      if (wname && player.weapons.includes(wname)) { player.weapon = wname; say('click'); }
    }
    if (player.car) { drivePlayerCar(dt, inp); return; }
    const mag = Math.hypot(inp.mx, inp.my);
    if (mag > 0.01) {
      const sp = (inp.run ? PLAYER.run : PLAYER.walk);
      const vx = (inp.mx / mag) * sp, vy = (inp.my / mag) * sp;
      player.x += vx * dt; player.y += vy * dt;
      const [nx, ny] = collideWorld(city, player.x, player.y, PLAYER.r); player.x = nx; player.y = ny;
      if (inp.aim == null) player.a = Math.atan2(vy, vx);
    }
    if (inp.aim != null) player.a = inp.aim;
    if (inp.attack) {
      if (player.weapon === 'fist') { if (player.punchCd <= 0) playerPunch(player.a); }
      else if (player.fireCd <= 0 && (WEAPONS[player.weapon].auto || !W.prevAttack)) playerShoot(player.a);
    }
    W.prevAttack = !!inp.attack;
    // pickups
    for (let i = W.pickups.length - 1; i >= 0; i--) {
      const pk = W.pickups[i];
      if (Math.hypot(pk.x - player.x, pk.y - player.y) > 36) continue;
      if (pk.mission) continue; // mission engine collects it
      if (pk.kind === 'cash') { W.money += pk.value; W.stats.earned += pk.value; say('cash'); toast(`+$${pk.value}`, 1.4); }
      if (pk.kind === 'snack') { player.hp = Math.min(PLAYER.hp, player.hp + pk.value); say('cash'); toast('Snack — health up', 1.4); }
      W.pickups.splice(i, 1);
    }
  }

  // ------------------------------------------------------------- collisions
  function updateCollisions(dt) {
    const cars = W.cars;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 > 58 * 58 || d2 < 0.01) continue;
        const d = Math.sqrt(d2), push = (58 - d) / 2, ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
        const rel = Math.abs(a.speed - b.speed);
        if (rel > 130) {
          damageCar(a, rel * 0.028); damageCar(b, rel * 0.028);
          if (a === player.car || b === player.car) { W.camShake = Math.min(8, W.camShake + rel * 0.012); say('crash'); }
        }
        const avg = (a.speed + b.speed) / 2;
        a.speed = avg * 0.88; b.speed = avg * 0.88; // contact costs some pace, but never glues two cars together
      }
      // car vs peds / player
      if (Math.abs(a.speed) > 130) {
        for (const p of W.peds) {
          if (p.down || Math.hypot(p.x - a.x, p.y - a.y) > 34) continue;
          damagePed(p, 100, Math.cos(a.a) * 16, Math.sin(a.a) * 16);
          if (a === player.car) { addHeat(85, p.x, p.y); say('crash'); }
          a.speed *= 0.82;
        }
        if (!player.car && !player.dead && player.hitT <= 0 && a.driver && Math.hypot(player.x - a.x, player.y - a.y) < 34) {
          hurtPlayer(11);
          player.hitT = 1.1; // brief grace so one car cannot chain-hit the player to death
          player.x += Math.cos(a.a) * 26; player.y += Math.sin(a.a) * 26;
        }
      }
    }
  }

  // ------------------------------------------------------------- wanted & ends
  function updateWanted(dt) {
    let seen = false;
    for (const c of W.cars) if (c.kind === 'police' && !c.wrecked && Math.hypot(c.x - player.x, c.y - player.y) < 580 && lineOfSight(city, c.x, c.y, player.x, player.y)) { seen = true; break; }
    if (!seen) for (const o of W.officers) if (Math.hypot(o.x - player.x, o.y - player.y) < 480 && lineOfSight(city, o.x, o.y, player.x, player.y)) { seen = true; break; }
    if (seen) W.unseenFor = 0; else W.unseenFor += dt;
    if (W.unseenFor > WANTED.hiddenDelay && W.heat > 0) {
      const atSafe = Math.hypot(player.x - city.places.safehouse.bx, player.y - city.places.safehouse.by) < city.places.safehouse.r;
      W.heat = Math.max(0, W.heat - (atSafe ? WANTED.safehouseDecay : WANTED.decay) * dt);
    }
    // busted meter (only under active heat — nobody arrests a clean citizen)
    let pressure = 0;
    if (!player.car && !player.dead && stars() >= 1) {
      for (const o of W.officers) { const d = Math.hypot(o.x - player.x, o.y - player.y); if (d < POLICE.bustRange) pressure = Math.max(pressure, 1 - d / POLICE.bustRange + 0.35); }
      for (const c of W.cars) if (c.kind === 'police' && Math.abs(c.speed) < 26 && Math.hypot(c.x - player.x, c.y - player.y) < 62) pressure = Math.max(pressure, 0.6);
    }
    if (pressure > 0) W.bustedMeter += POLICE.bustRate * pressure * dt;
    else W.bustedMeter = Math.max(0, W.bustedMeter - 0.45 * dt);
    if (W.bustedMeter >= 1 && !W.event) { W.event = 'busted'; say('busted'); }
  }
  function respawn(kind) {
    const fine = kind === 'busted' ? Math.min(W.money, 100 + stars() * 60) : Math.min(W.money, 150);
    W.money -= fine;
    const at = kind === 'busted' ? city.places.police : city.places.clinic;
    player.x = at.bx; player.y = at.by; player.car = null;
    player.hp = PLAYER.hp; player.dead = false;
    W.heat = kind === 'busted' ? 0 : W.heat * 0.35;
    W.bustedMeter = 0; W.event = null;
    for (const c of W.cars) if (c.driver === 'player') c.driver = null;
    toast(kind === 'busted' ? `Busted — $${fine} fine` : `Wasted — $${fine} hospital bill`, 3.6);
  }

  // ------------------------------------------------------------- missions
  function updateMissions(dt) {
    // free-roam bank vault
    W.bankCd = Math.max(0, W.bankCd - dt);
    const bank = city.places.bank;
    const st = stepDef();
    const missionChannel = st && st.t === 'channel' && st.place === 'bank';
    if (!missionChannel && !player.car && !player.dead && W.bankCd <= 0 &&
        Math.hypot(player.x - bank.bx, player.y - bank.by) < bank.r) {
      W.bankProg = (W.bankProg || 0) + dt;
      if (rng.chance(dt * 6)) burst(player.x, player.y, 'spark', 1);
      if (W.bankProg >= BANK.channel) {
        W.bankProg = 0; W.bankCd = BANK.cooldown;
        W.money += BANK.payout; W.stats.earned += BANK.payout;
        W.heat += BANK.heat; say('cash');
        toast(`Side vault emptied — +$${BANK.payout}. The alarm disagrees.`, 3.6);
      }
    } else W.bankProg = Math.max(0, (W.bankProg || 0) - dt * 2);

    if (!st || W.storyComplete && W.mIdx >= MISSIONS.length) return;
    if (!st) return;
    const tgt = stepTarget();
    switch (st.t) {
      case 'goto': case 'meet':
        if (tgt && Math.hypot(player.x - tgt.x, player.y - tgt.y) < (st.t === 'meet' ? 78 : 92)) completeStep();
        break;
      case 'steal':
        if (player.car && player.car === targetCar(st.car)) completeStep();
        break;
      case 'deliverCar': {
        const c = targetCar(st.car);
        if (c && player.car === c && Math.hypot(c.x - tgt.x, c.y - tgt.y) < 118) completeStep();
        break;
      }
      case 'pickup':
        for (let i = 0; i < W.pickups.length; i++) {
          const pk = W.pickups[i];
          if (pk.mission && !player.car && Math.hypot(pk.x - player.x, pk.y - player.y) < 40) {
            W.pickups.splice(i, 1);
            W.heat += st.heat || 0;
            say('cash'); toast('Package secured — it is definitely not quiet now.', 3.2);
            completeStep();
            break;
          }
        }
        break;
      case 'kill':
        if (W.stepKills >= st.count) completeStep();
        break;
      case 'channel': {
        const p = city.places[st.place];
        if (!player.car && Math.hypot(player.x - p.bx, player.y - p.by) < p.r + 14) {
          W.stepProg += dt;
          if (rng.chance(dt * 7)) burst(player.x, player.y, 'spark', 1);
          if (W.stepProg >= st.secs) {
            W.heat += st.heat || 0;
            say('cash');
            completeStep();
          }
        } else W.stepProg = Math.max(0, W.stepProg - dt * 2);
        break;
      }
      case 'escape':
        if (stars() === 0) completeStep();
        break;
    }
    // a wrecked target car is quietly replaced at its lot
    for (let i = respawnQueue.length - 1; i >= 0; i--) {
      const q = respawnQueue[i];
      q.t -= dt;
      if (q.t <= 0) {
        const spot = q.car === coupe ? city.coupeSpot : city.jobCarSpot;
        q.car.x = spot.x; q.car.y = spot.y; q.car.a = spot.a; q.car.hp = q.car.maxHp; q.car.wrecked = false; q.car.speed = 0;
        toast('The target car was quietly replaced at Bay Motors.', 3);
        respawnQueue.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------- interaction
  function nearestPlace() {
    let best = null, bd = Infinity;
    for (const p of city.placeList) {
      const d = Math.hypot(player.x - p.bx, player.y - p.by);
      if (d < p.r && d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function nearCar() {
    let best = null, bd = PLAYER.enterRange;
    const st = stepDef();
    for (const c of W.cars) {
      if (c.wrecked) continue;
      const d = Math.hypot(c.x - player.x, c.y - player.y);
      if (d < bd || (st && st.t === 'steal' && c === targetCar(st.car) && d < PLAYER.enterRange + 26)) { if (d < (bd + 26)) { best = c; bd = d; } }
    }
    return best;
  }
  const SHOP = [
    { id: 'snack', label: () => `Snack $${PRICES.snack}`, can: () => true, buy: () => { player.hp = Math.min(PLAYER.hp, player.hp + 35); } },
    { id: 'smg', label: () => `SMG $${PRICES.smg}`, can: () => !player.weapons.includes('smg'), buy: () => { player.weapons.push('smg'); player.weapon = 'smg'; } },
    { id: 'shotgun', label: () => `Shotgun $${PRICES.shotgun}`, can: () => !player.weapons.includes('shotgun'), buy: () => { player.weapons.push('shotgun'); player.weapon = 'shotgun'; } },
  ];
  function shopOffer() {
    for (let i = 0; i < SHOP.length; i++) { const o = SHOP[(W.shopIdx + i) % SHOP.length]; if (o.can()) return o; }
    return SHOP[0];
  }
  function prompt() {
    if (player.dead) return null;
    if (player.car) {
      const g = city.places.garage;
      if (Math.hypot(player.x - g.bx, player.y - g.by) < g.r && player.car.hp < player.car.maxHp) return `E — Repair at Taller Sol $${PRICES.repair}`;
      return 'E — Exit car';
    }
    const c = nearCar();
    if (c) return c.kind === 'owned' ? 'E — Get in your car' : `E — ${c.driver === 'traffic' ? 'Carjack' : 'Steal'} the ${c.type}`;
    const p = nearestPlace();
    if (!p) return null;
    switch (p.id) {
      case 'clinic': return player.hp >= PLAYER.hp ? 'Clinica Sol — you are fine' : `E — Heal $${PRICES.heal}`;
      case 'police': return W.heat > 0 ? `E — Bribe the desk $${PRICES.bribe} (clear heat)` : 'Comisaria 9 — stay out of trouble';
      case 'hotel': return `E — Room, rest & save $${PRICES.hotel}`;
      case 'safehouse': return 'E — Save & lie low';
      case 'market': return `E — Buy ${shopOffer().label()}`;
      case 'carLot': return ownedCar && !ownedCar.wrecked ? 'Bay Motors — your car is on the lot' : `E — Buy a car $${PRICES.car}`;
      case 'garage': return 'Taller Sol — bring a car to repair';
      case 'bank': return stepDef()?.t === 'channel' ? 'Hold position — crack the vault' : (W.bankCd > 0 ? `Vault refills in ${Math.ceil(W.bankCd)}s` : 'Stand at the vault to crack it');
      default: return p.name;
    }
  }
  function pay(n) { if (W.money < n) { toast('Not enough cash', 2); say('error'); return false; } W.money -= n; say('cash'); return true; }
  function interact() {
    if (player.dead || W.event) return;
    if (player.car) {
      const g = city.places.garage;
      if (Math.hypot(player.x - g.bx, player.y - g.by) < g.r && player.car.hp < player.car.maxHp) {
        if (pay(PRICES.repair)) { player.car.hp = player.car.maxHp; toast('Repaired — good as new', 2.2); }
        return;
      }
      const car = player.car;
      player.car = null; car.driver = null;
      if (car.kind === 'traffic') car.kind = 'parked';
      player.x = car.x + Math.cos(car.a + Math.PI / 2) * 46;
      player.y = car.y + Math.sin(car.a + Math.PI / 2) * 46;
      const [nx, ny] = collideWorld(city, player.x, player.y, PLAYER.r); player.x = nx; player.y = ny;
      return;
    }
    // standing right at a place's door, E talks to the place — unless a car
    // is even closer (the Bay Motors lot is full of parked cars, and the
    // mission coupe sits near its door)
    const door = nearestPlace();
    const doorD = door ? Math.hypot(player.x - door.bx, player.y - door.by) : Infinity;
    const c = nearCar();
    const carD = c ? Math.hypot(c.x - player.x, c.y - player.y) : Infinity;
    if (door && doorD < 56 && doorD <= carD) { placeInteract(door); return; }
    if (c) {
      const wasTraffic = c.driver === 'traffic';
      if (wasTraffic) { ejectDriver(c, 'ped'); scareNearby(c.x, c.y); }
      if (c.kind !== 'owned') {
        W.stats.stolen++;
        if (c.kind === 'police') addHeat(85, c.x, c.y);
        else if (wasTraffic) addHeat(60, c.x, c.y);
        else addHeat(38, c.x, c.y);
      }
      c.driver = 'player'; player.car = c; player.x = c.x; player.y = c.y;
      say('door');
      return;
    }
    const p = nearestPlace();
    if (p) placeInteract(p);
  }
  function placeInteract(p) {
    switch (p.id) {
      case 'clinic': if (player.hp < PLAYER.hp && pay(PRICES.heal)) { player.hp = PLAYER.hp; toast('Patched up', 2); } break;
      case 'police': if (W.heat > 0 && pay(PRICES.bribe)) { W.heat = 0; toast('The desk sergeant nods. Heat cleared.', 2.6); } break;
      case 'hotel': if (pay(PRICES.hotel)) { player.hp = PLAYER.hp; W.minutes = 19 * 60; W.saveRequested = true; toast('Rested at Hotel Lumina — game saved', 2.6); } break;
      case 'safehouse': W.saveRequested = true; W.heat = Math.max(0, W.heat - 60); toast('Saved. Lying low burns heat fast here.', 2.6); break;
      case 'market': {
        const o = shopOffer();
        const price = o.id === 'snack' ? PRICES.snack : PRICES[o.id];
        if (pay(price)) { o.buy(); toast(`Bought ${o.label()}`, 2.2); W.shopIdx++; }
        break;
      }
      case 'carLot':
        if ((!ownedCar || ownedCar.wrecked) && pay(PRICES.car)) {
          if (!ownedCar) ownedCar = makeCar('owned', 'sedan', city.jobCarSpot.x, city.jobCarSpot.y + 90, Math.PI / 2, '#3effc8');
          else { ownedCar.x = city.jobCarSpot.x; ownedCar.y = city.jobCarSpot.y + 90; ownedCar.hp = ownedCar.maxHp; ownedCar.wrecked = false; }
          toast('Your new ride waits on the lot', 2.6);
        }
        break;
      case 'garage': toast('Bring a car here to repair it', 2); break;
    }
  }

  // ------------------------------------------------------------- step & API
  function step(dt, inp) {
    W.time += dt;
    W.stats.timePlayed += dt;
    W.minutes += DAY.rate * dt;
    if (W.minutes >= 1440) { W.minutes -= 1440; W.day++; }
    if (W.banner) { W.banner.t -= dt; if (W.banner.t <= 0) W.banner = null; }
    for (let i = W.toasts.length - 1; i >= 0; i--) { W.toasts[i].t -= dt; if (W.toasts[i].t <= 0) W.toasts.splice(i, 1); }
    for (let i = W.fx.length - 1; i >= 0; i--) { const f = W.fx[i]; f.ttl -= dt; if (f.x != null && f.vx != null) { f.x += f.vx * dt; f.y += f.vy * dt; } if (f.ttl <= 0) W.fx.splice(i, 1); }
    W.camShake = Math.max(0, W.camShake - dt * 14);
    for (const c of W.cars) {
      c.light += dt * 7;
      if (c.wrecked && rng.chance(dt * 2.2)) addFx({ kind: 'fire', x: c.x + rng.range(-14, 14), y: c.y + rng.range(-14, 14), vx: 0, vy: -30, ttl: 0.5, max: 0.5 });
      else if (c.hp < 45 && c.driver && rng.chance(dt * 3)) addFx({ kind: 'smoke', x: c.x, y: c.y, vx: 0, vy: -16, ttl: 0.7, max: 0.7 });
    }
    updatePlayer(dt, inp);
    for (const c of W.cars) { if (c.driver === 'traffic') updateTraffic(c, dt); }
    updatePolice(dt);
    updatePeds(dt);
    updateCollisions(dt);
    updateWanted(dt);
    updateMissions(dt);
  }

  function serialize() {
    const inCar = player.car ? player.car.kind : null;
    return {
      v: 2, money: W.money, hp: player.hp, weapons: [...player.weapons], weapon: player.weapon,
      mIdx: W.mIdx, minutes: W.minutes, day: W.day, px: player.x, py: player.y,
      inCar, carPos: player.car ? { x: player.car.x, y: player.car.y, a: player.car.a } : null,
      coupe: { x: coupe.x, y: coupe.y, a: coupe.a, hp: coupe.hp },
      job: jobCar ? { x: jobCar.x, y: jobCar.y, a: jobCar.a, hp: jobCar.hp } : null,
      owned: ownedCar ? { x: ownedCar.x, y: ownedCar.y, a: ownedCar.a, hp: ownedCar.hp } : null,
      stats: { ...W.stats }, storyComplete: W.storyComplete, bankCd: W.bankCd, best: W.best,
    };
  }
  function restore(d) {
    if (!d) return;
    W.money = d.money | 0; player.hp = clamp(d.hp ?? 100, 1, PLAYER.hp);
    player.weapons = Array.isArray(d.weapons) && d.weapons.length ? [...d.weapons] : ['fist'];
    player.weapon = player.weapons.includes(d.weapon) ? d.weapon : player.weapons[player.weapons.length - 1];
    W.mIdx = clamp(d.mIdx | 0, 0, MISSIONS.length); W.sIdx = 0; W.stepProg = 0; W.stepKills = 0;
    W.minutes = d.minutes ?? DAY.start; W.day = d.day ?? 1;
    W.stats = { ...W.stats, ...(d.stats || {}) };
    W.storyComplete = !!d.storyComplete; W.bankCd = d.bankCd || 0; W.best = d.best || 0;
    if (d.coupe) { coupe.x = d.coupe.x; coupe.y = d.coupe.y; coupe.a = d.coupe.a; coupe.hp = d.coupe.hp; coupe.wrecked = coupe.hp <= 0; }
    if (d.job && !jobCar) jobCar = makeCar('job', 'racer', d.job.x, d.job.y, d.job.a);
    if (d.job && jobCar) { jobCar.x = d.job.x; jobCar.y = d.job.y; jobCar.a = d.job.a; jobCar.hp = d.job.hp; jobCar.wrecked = jobCar.hp <= 0; }
    if (d.owned && !ownedCar) ownedCar = makeCar('owned', 'sedan', d.owned.x, d.owned.y, d.owned.a, '#3effc8');
    if (d.owned && ownedCar) { ownedCar.x = d.owned.x; ownedCar.y = d.owned.y; ownedCar.hp = d.owned.hp; ownedCar.wrecked = ownedCar.hp <= 0; }
    player.x = d.px ?? player.x; player.y = d.py ?? player.y;
    if (d.inCar) {
      const car = d.inCar === 'coupe' ? coupe : d.inCar === 'job' ? jobCar : d.inCar === 'owned' ? ownedCar : null;
      if (car && d.carPos) { car.x = d.carPos.x; car.y = d.carPos.y; car.a = d.carPos.a; car.driver = 'player'; player.car = car; player.x = car.x; player.y = car.y; }
    }
    onStepBegin();
    const m = mission();
    if (m) W.banner = { title: `Mission ${W.mIdx + 1} — ${m.title}`, sub: m.intro, t: 3.6 };
  }

  onStepBegin();
  startMissionBanner();

  return {
    state: W, city, player,
    get cars() { return W.cars; }, get peds() { return W.peds; }, get officers() { return W.officers; },
    get pickups() { return W.pickups; }, get fx() { return W.fx; },
    coupe, get jobCar() { return jobCar; }, get ownedCar() { return ownedCar; },
    step, interact, prompt, objective, stars, respawn, serialize, restore,
    drainSounds: () => W.sounds.splice(0, W.sounds.length),
  };
}

export { STEP };
