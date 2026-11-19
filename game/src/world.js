// NEON BAY v5 — the simulation: one city, one night, one rising legend.
// Pure logic, no DOM: the browser shell feeds it control objects and the
// headless test drives it with an autopilot, through the exact same step.
// Everything random comes from the world's seeded stream.

import { WORLD, ROADS, PLAYER, DAY, WEAPONS, WEAPON_BY_SLOT, HEAT_STARS } from './config.js';
import { createCity, collide, lineOfSight, isSand, CAR_COLORS } from './city.js';
import { MISSIONS } from './missions.js';

/** Event bits returned by step(), for sound and screen effects. */
export const EV = {
  SHOT: 1, HIT: 2, MONEY: 4, MISSION: 8, BUSTED: 16,
  WASTED: 32, ENTER: 64, PICKUP: 128, TOAST: 256, SAVE: 512,
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
/** Manhattan route over the intersection grid, from a point to a point. */
function gridRoute(x0, y0, x1, y1) {
  const AV = ROADS.avenues; const ST = ROADS.streets;
  const near = (x, y) => {
    let best = null; let bd = Infinity;
    for (let ai = 0; ai < AV.length; ai += 1) for (let si = 0; si < ST.length; si += 1) {
      const d = (AV[ai] - x) ** 2 + (ST[si] - y) ** 2;
      if (d < bd) { bd = d; best = { ai, si }; }
    }
    return best;
  };
  const a = near(x0, y0); const b = near(x1, y1);
  const pts = [{ x: AV[a.ai], y: ST[a.si] }];
  let cai = a.ai; let csi = a.si;
  while (cai !== b.ai) { cai += Math.sign(b.ai - cai); pts.push({ x: AV[cai], y: ST[csi] }); }
  while (csi !== b.si) { csi += Math.sign(b.si - csi); pts.push({ x: AV[cai], y: ST[csi] }); }
  pts.push({ x: x1, y: y1 });
  return pts;
}

const TOP_SPEED = { sport: 470, police: 405, owned: 390, sedan: 380, taxi: 360, pickup: 350, van: 330 };

export function createWorld(rng) {
  const city = createCity(rng);

  const state = {
    t: 0,
    minutes: DAY.start,
    city,
    player: {
      x: city.spawn.x, y: city.spawn.y, angle: -Math.PI / 2,
      hp: PLAYER.hp, money: 0, weapon: 'fist',
      weapons: { pistol: false, smg: false, shotgun: false },
      car: null, fireCd: 0, speedNow: 0,
    },
    heat: 0, seenT: 99, lastSeen: null, bustedMeter: 0,
    cars: [], peds: [], cops: [], pickups: [], tracers: [], parts: [],
    missionIndex: 0, stepIndex: 0, kills: 0, channelT: 0, vaultT: 0, vaultCd: 0,
    storyComplete: false, respawned: null, lastEvent: null,
    toast: null, toastT: 0, savedFlag: false,
    targetCarRef: null, spawnedKey: '', ramCd: 0,
    stats: { carsStolen: 0, shotsFired: 0, timePlayed: 0, bestMoney: 0 },
    prevFire: false, prevInteract: false,
  };

  let carSeq = 1;
  function makeCar(kind, x, y, angle, color, variant) {
    const car = {
      id: carSeq++, kind, x, y, angle, speed: 0, hp: 100,
      color: color || rng.pick(CAR_COLORS), variant: variant || 'sedan',
      driver: null, dead: false, flank: 0, deployT: 0, boarded: true,
      plan: null, planI: 0, cruise: rng.range(200, 245), stopT: 0, stuckT: 0,
      lastX: x, lastY: y, hitCd: 0,
    };
    state.cars.push(car);
    return car;
  }
  function makePed(x, y, opts = {}) {
    const ped = {
      x, y, angle: rng.range(0, Math.PI * 2), hp: 100, dead: false,
      kind: opts.kind || 'ped', dealer: !!opts.dealer,
      home: { x, y }, tx: x, ty: y, speed: opts.speed || rng.range(52, 78),
      stander: !!opts.stander, fleeT: 0, fleeX: 0, fleeY: 0,
      fireCd: rng.range(0.4, 1.2), hitCd: 0, sway: rng.range(0, 9),
    };
    state.peds.push(ped);
    return ped;
  }

  // --- population -------------------------------------------------------
  // The first parked car sits in the park by the spawn corner (the
  // test's neighbour) — clear of every doorstep and lane.
  makeCar('parked', 520, 2950, 0, '#4f7ad9', 'sedan');
  for (const spot of city.lotSpots) {
    if (rng.chance(0.72)) makeCar('parked', spot.x, spot.y, spot.angle, null, rng.pick(['sedan', 'taxi', 'van', 'pickup']));
  }
  for (let i = 0; i < 20; i += 1) {
    const onAvenue = rng.chance(0.5);
    const x = onAvenue ? rng.pick(ROADS.avenues) + (rng.chance(0.5) ? -52 : 52) : rng.range(300, 4000);
    const y = onAvenue ? rng.range(300, 3400) : rng.pick(ROADS.streets) + (rng.chance(0.5) ? -52 : 52);
    makeCar('parked', x, y, onAvenue ? Math.PI / 2 : 0, null, rng.pick(['sedan', 'sedan', 'taxi', 'van', 'pickup']));
  }
  // The story coupe: gold, waiting in the Bay Motors lot from minute one.
  const coupe = makeCar('mission', 3520, 700, Math.PI / 2, '#ffc44d', 'sport');
  state.targetCarRef = coupe;
  // Traffic: three near the spawn corner, the rest anywhere on the grid.
  const seedTraffic = [
    { x: 900, y: 2790, angle: Math.PI }, { x: 1500, y: 2852, angle: 0 }, { x: 330, y: 2400, angle: Math.PI / 2 },
  ];
  for (const s of seedTraffic) { const c = makeCar('traffic', s.x, s.y, s.angle, null, rng.pick(['sedan', 'taxi', 'van'])); c.driver = 'ai'; }
  for (let i = 0; i < 27; i += 1) {
    const onAvenue = rng.chance(0.5);
    const x = onAvenue ? rng.pick(ROADS.avenues) : rng.range(300, 4000);
    const y = onAvenue ? rng.range(300, 3400) : rng.pick(ROADS.streets);
    const c = makeCar('traffic', x, y, rng.range(0, Math.PI * 2), null, rng.pick(['sedan', 'sedan', 'taxi', 'van', 'pickup', 'sport']));
    c.driver = 'ai';
  }
  // People: one loiterer on the spawn corner, then the wandering city.
  makePed(560, 2770, { stander: true });
  for (let i = 0; i < 40; i += 1) {
    const beach = rng.chance(0.25);
    if (beach) makePed(rng.range(ROADS.sandFrom + 40, ROADS.waterFrom - 80), rng.range(200, 3400));
    else {
      const onAvenue = rng.chance(0.5);
      const x = onAvenue ? rng.pick(ROADS.avenues) + (rng.chance(0.5) ? -88 : 88) : rng.range(200, 4050);
      const y = onAvenue ? rng.range(200, 3400) : rng.pick(ROADS.streets) + (rng.chance(0.5) ? -88 : 88);
      makePed(x, y);
    }
  }

  // --- helpers ----------------------------------------------------------
  function stars() {
    let n = 0;
    for (const th of HEAT_STARS) if (state.heat >= th) n += 1;
    return n;
  }
  function setToast(text) { state.toast = text; state.toastT = 3.6; }
  function witnessed(range = 310) {
    const p = state.player;
    for (const ped of state.peds) if (!ped.dead && Math.hypot(ped.x - p.x, ped.y - p.y) < range && lineOfSight(city, ped.x, ped.y, p.x, p.y)) return true;
    for (const car of state.cars) if (car.kind === 'police' && Math.hypot(car.x - p.x, car.y - p.y) < 540) return true;
    for (const cop of state.cops) if (!cop.dead && Math.hypot(cop.x - p.x, cop.y - p.y) < 540) return true;
    return false;
  }
  function crime(amount) {
    if (witnessed()) { state.heat += amount; state.seenT = 0; state.lastSeen = { x: state.player.x, y: state.player.y }; }
  }
  function playerHidden() {
    const d = city.places.hideout.door;
    return Math.hypot(state.player.x - d.x, state.player.y - d.y) < 135;
  }
  function currentStep() {
    const m = MISSIONS[state.missionIndex];
    if (!m || state.storyComplete) return null;
    return m.steps[state.stepIndex] || null;
  }
  function stepPoint(step) {
    if (!step) return null;
    if (step.place) return city.places[step.place].door;
    if (step.point === 'pier') return city.pier;
    if (step.kind === 'steal' || step.kind === 'deliverCar') {
      if (step.kind === 'steal' && state.targetCarRef) return state.targetCarRef;
      if (step.place) return city.places[step.place].door;
      return state.targetCarRef;
    }
    if (step.kind === 'kill') {
      const d = nearestDealer();
      return d || step.area;
    }
    if (step.kind === 'escape') return city.places.hideout.door;
    return null;
  }
  function objective() {
    const step = currentStep();
    if (!step) return { x: state.player.x, y: state.player.y, text: state.storyComplete ? 'STORY COMPLETE — the bay is yours' : '', dist: 0, sub: '' };
    const pt = stepPoint(step);
    const m = MISSIONS[state.missionIndex];
    let sub = '';
    if (step.kind === 'kill') sub = ` (${state.kills}/${step.count})`;
    if (step.kind === 'channel') sub = state.channelT > 0 ? ` (${Math.min(100, Math.round((state.channelT / step.seconds) * 100))}%)` : '';
    return {
      x: pt ? pt.x : state.player.x, y: pt ? pt.y : state.player.y,
      text: `${m.title}: ${step.label}${sub}`,
      dist: pt ? Math.hypot(pt.x - state.player.x, pt.y - state.player.y) : 0,
      sub: m.intro,
    };
  }
  function nearestDealer() {
    let best = null; let bd = Infinity;
    for (const ped of state.peds) {
      if (!ped.dealer || ped.dead) continue;
      const d = Math.hypot(ped.x - state.player.x, ped.y - state.player.y);
      if (d < bd) { bd = d; best = ped; }
    }
    return best;
  }
  function targetCar() { return state.targetCarRef && !state.targetCarRef.dead ? state.targetCarRef : state.targetCarRef; }
  function ownedCar() { return state.cars.find((c) => c.kind === 'owned' && !c.dead) || null; }

  function spawnStepNeeds() {
    const step = currentStep();
    if (!step) return;
    const key = `${state.missionIndex}:${state.stepIndex}`;
    if (state.spawnedKey === key) return;
    state.spawnedKey = key;
    if (step.kind === 'kill') state.kills = 0;
    state.channelT = 0;
    if (step.kind === 'steal' && step.car === 'job') {
      const job = makeCar('job', 3580, 800, Math.PI / 2, '#2ee6ff', 'sport');
      state.targetCarRef = job;
    }
    if (step.kind === 'kill') {
      const a = step.area;
      makePed(a.x - 60, a.y - 120, { dealer: true, stander: true });
      makePed(a.x + 40, a.y, { dealer: true, stander: true });
      makePed(a.x - 30, a.y + 130, { dealer: true, stander: true });
    }
    if (step.kind === 'meet') {
      makePed(city.pier.x - 20, city.pier.y + 10, { stander: true });
    }
  }

  function advanceStep(events) {
    const m = MISSIONS[state.missionIndex];
    state.stepIndex += 1;
    state.channelT = 0;
    if (state.stepIndex >= m.steps.length) {
      state.player.money += m.reward;
      state.stats.bestMoney = Math.max(state.stats.bestMoney, state.player.money);
      if (state.missionIndex === 0 && !state.player.weapons.pistol) {
        state.player.weapons.pistol = true;
        setToast(`Mission complete: +$${m.reward}. Sol left you a pistol.`);
      } else {
        setToast(`Mission complete: +$${m.reward}`);
      }
      state.missionIndex += 1;
      state.stepIndex = 0;
      if (state.missionIndex >= MISSIONS.length) {
        state.storyComplete = true;
        setToast('STORY COMPLETE — Bay Legend');
      }
      events |= EV.MISSION | EV.MONEY;
    }
    spawnStepNeeds();
    return events;
  }

  function respawn(where) {
    const p = state.player;
    if (p.car) { p.car.driver = null; p.car = null; }
    const door = where === 'police' ? city.places.policeStation.door : city.places.clinic.door;
    p.x = door.x; p.y = door.y;
    state.heat = 0;
    state.bustedMeter = 0;
    state.respawned = where;
  }
  function busted(events) {
    const p = state.player;
    p.money -= Math.min(p.money, 120);
    state.lastEvent = 'busted';
    respawn('police');
    setToast('BUSTED — the Comisaria takes $120 and your dignity.');
    return events | EV.BUSTED;
  }
  function wasted(events) {
    const p = state.player;
    p.money -= Math.min(p.money, 100);
    p.hp = PLAYER.hp;
    state.lastEvent = 'wasted';
    respawn('clinic');
    setToast('WASTED — Clinica Brisa patches you up for $100.');
    return events | EV.WASTED;
  }

  // --- interaction --------------------------------------------------------
  function enterCar(car, events) {
    const p = state.player;
    if (car.kind === 'traffic' && car.driver === 'ai') {
      state.stats.carsStolen += 1;
      crime(90);
      const driver = makePed(car.x + 20, car.y + 10);
      driver.fleeT = 3; driver.fleeX = p.x; driver.fleeY = p.y;
      car.driver = null;
    } else if (car.kind === 'parked') {
      crime(40);
      state.stats.carsStolen += 1;
    } else if (car.kind === 'police') {
      crime(150);
      state.stats.carsStolen += 1;
    }
    p.car = car;
    car.driver = 'player';
    car.speed = 0;
    p.x = car.x; p.y = car.y;
    return events | EV.ENTER;
  }

  function placeAction(place, events) {
    const p = state.player;
    const money = () => { events |= EV.MONEY; };
    switch (place.id) {
      case 'clinic':
        if (p.hp >= PLAYER.hp) setToast('Clinica Brisa: you are already whole.');
        else if (p.money < 40) setToast('Clinica Brisa: healing costs $40.');
        else { p.money -= 40; p.hp = PLAYER.hp; setToast('Clinica Brisa: patched up for $40.'); money(); }
        break;
      case 'policeStation':
        if (state.heat <= 0) setToast('Comisaria: your record is clean. Today.');
        else if (p.money < 150) setToast('Comisaria: the sergeant wants $150.');
        else { p.money -= 150; state.heat = 0; setToast('Comisaria: $150 and the slate is wiped.'); money(); }
        break;
      case 'hotel':
        if (p.money < 60) setToast('Hotel Lumina: a room is $60.');
        else {
          p.money -= 60;
          state.minutes = (state.minutes + 240) % 1440;
          state.savedFlag = true;
          setToast('Hotel Lumina: you sleep. Game saved.');
          money(); events |= EV.SAVE;
        }
        break;
      case 'market':
        if (!p.weapons.smg && p.money >= 600) { p.money -= 600; p.weapons.smg = true; setToast('Mercado Sol: SMG bought for $600.'); money(); }
        else if (!p.weapons.shotgun && p.money >= 900) { p.money -= 900; p.weapons.shotgun = true; setToast('Mercado Sol: Shotgun bought for $900.'); money(); }
        else if (p.money >= 15) { p.money -= 15; p.hp = Math.min(PLAYER.hp, p.hp + 25); setToast('Mercado Sol: a snack for $15.'); money(); }
        else setToast('Mercado Sol: you need money, friend.');
        break;
      case 'carLot':
        if (ownedCar()) setToast('Bay Motors: your car is already out there.');
        else if (p.money < 800) setToast('Bay Motors: a car of your own is $800.');
        else {
          p.money -= 800;
          const car = makeCar('owned', 3560, 620, Math.PI / 2, '#e86ac0', 'sedan');
          car.driver = null;
          setToast('Bay Motors: she is yours. Pink, obviously.');
          money();
        }
        break;
      case 'garage': {
        const target = p.car || ownedCar();
        if (!target) setToast('Taller Sol: bring me a car, I fix it.');
        else if (target.hp >= 100) setToast('Taller Sol: she runs fine already.');
        else if (p.money < 50) setToast('Taller Sol: repairs are $50.');
        else { p.money -= 50; target.hp = 100; setToast('Taller Sol: good as new for $50.'); money(); }
        break;
      }
      case 'hideout':
        if (state.heat > 0) { state.heat = Math.max(0, state.heat - 200); setToast('Casa Segura: you lie low. The heat cools.'); }
        else setToast('Casa Segura: quiet. Safe.');
        state.savedFlag = true;
        events |= EV.SAVE;
        break;
      case 'bank':
        setToast(state.vaultCd > 0 ? 'Banco del Sol: the vault is still hot from last time.' : 'Banco del Sol: the vault hums. Stand close and be brave.');
        break;
      default:
        break;
    }
    return events | EV.TOAST;
  }

  function doInteract(events) {
    const p = state.player;
    if (p.car) {
      const car = p.car;
      car.driver = null;
      car.speed = 0;
      p.car = null;
      p.x = car.x + Math.cos(car.angle + Math.PI / 2) * 36;
      p.y = car.y + Math.sin(car.angle + Math.PI / 2) * 36;
      collide(city, p, PLAYER.radius);
      return events | EV.ENTER;
    }
    // the story's target car outranks every other ride: when a steal
    // step is live and the marked car is in reach, E means THAT car
    const stepNow = currentStep();
    if (stepNow && stepNow.kind === 'steal' && state.targetCarRef && !state.targetCarRef.dead) {
      const tc = state.targetCarRef;
      if (Math.hypot(tc.x - p.x, tc.y - p.y) < 54) return enterCar(tc, events);
    }
    let doorPlace = null; let doorDist = Infinity;
    for (const pl of Object.values(city.places)) {
      const d = Math.hypot(pl.door.x - p.x, pl.door.y - p.y);
      if (d < doorDist) { doorDist = d; doorPlace = pl; }
    }
    let nearCar = null; let carDist = Infinity;
    for (const car of state.cars) {
      if (car.dead) continue;
      if (car.kind === 'police' && car.driver !== 'player') continue; // never jack a crewed patrol car
      if (car.driver === 'ai' && Math.abs(car.speed) > 30) continue; // too fast to grab
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d < carDist) { carDist = d; nearCar = car; }
    }
    // A doorway you are hugging wins; a car you are hugging wins over a
    // doorway across the street; otherwise the nearer of the two.
    if (doorPlace && doorDist < 42) return placeAction(doorPlace, events);
    if (nearCar && carDist < 54 && carDist < doorDist - 20) return enterCar(nearCar, events);
    if (doorPlace && doorDist < 88) return placeAction(doorPlace, events);
    if (nearCar && carDist < 54) return enterCar(nearCar, events);
    return events;
  }

  // --- driving ------------------------------------------------------------
  function moveCar(car, dt, throttle, steer) {
    const top = TOP_SPEED[car.variant] || 380;
    const sandDrag = isSand(car.x) ? 0.55 : 1;
    if (car.hp <= 0) throttle = 0;
    car.speed += throttle * 320 * dt;
    car.speed -= car.speed * 0.55 * dt;
    const maxF = top * sandDrag;
    const maxR = -130;
    if (car.speed > maxF) car.speed = maxF;
    if (car.speed < maxR) car.speed = maxR;
    if (Math.abs(car.speed) < 4 && throttle === 0) car.speed = 0;
    const turn = steer * 2.5 * dt * Math.max(-1, Math.min(1, car.speed / 130));
    car.angle += turn;
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    const impact = Math.abs(car.speed);
    if (collide(city, car, 24)) {
      if (impact > 150) car.hp -= (impact - 150) * 0.055;
      car.speed *= impact > 60 ? 0.42 : 0.7;
    }
    if (car.hp < 0) car.hp = 0;
  }

  /** Steer an AI car along its plan; brake for anything standing ahead. */
  function driveAI(car, dt, cruiseMul = 1) {
    if (!car.plan || car.planI >= car.plan.length) {
      const tx = rng.pick(ROADS.avenues) + rng.range(-40, 40);
      const ty = rng.pick(ROADS.streets) + rng.range(-40, 40);
      car.plan = gridRoute(car.x, car.y, tx, ty);
      car.planI = 0;
    }
    let wp = car.plan[car.planI];
    while (wp && Math.hypot(wp.x - car.x, wp.y - car.y) < 58) { car.planI += 1; wp = car.plan[car.planI]; }
    if (!wp) { car.plan = null; return; }
    if (car.stopT > 0) { car.stopT -= dt; moveCar(car, dt, car.speed > 10 ? -0.6 : 0, 0); return; }
    if (car.planI < car.plan.length - 1 && Math.hypot(wp.x - car.x, wp.y - car.y) < 130 && rng.chance(0.0035)) car.stopT = rng.range(0.4, 0.8);
    // obstacle ahead?
    const fx = Math.cos(car.angle); const fy = Math.sin(car.angle);
    let blocked = false;
    const aheadX = car.x + fx * 96; const aheadY = car.y + fy * 96;
    for (const other of state.cars) {
      if (other === car || other.dead) continue;
      if (Math.hypot(other.x - aheadX, other.y - aheadY) < 40) { blocked = true; break; }
    }
    if (!blocked) {
      for (const ped of state.peds) {
        if (ped.dead) continue;
        if (Math.hypot(ped.x - aheadX, ped.y - aheadY) < 34) { blocked = true; break; }
      }
    }
    if (!blocked && state.player.car !== car && Math.hypot(state.player.x - aheadX, state.player.y - aheadY) < 34) blocked = true;
    // keep a right-hand lane: offset the steering target so opposing
    // flows pass instead of meeting nose to nose
    const laneX = wp.x + Math.sin(car.angle) * 24;
    const laneY = wp.y - Math.cos(car.angle) * 24;
    const want = Math.atan2(laneY - car.y, laneX - car.x);
    const d = angDiff(want, car.angle);
    const steer = Math.max(-1, Math.min(1, d * 2.4));
    let throttle = Math.abs(d) > 1.15 ? -0.55 : 1;
    const cruise = (TOP_SPEED[car.variant] || 380) * 0.62 * cruiseMul;
    if (car.speed > cruise && throttle > 0) throttle = 0;
    if (blocked) throttle = car.speed > 8 ? -0.7 : 0;
    moveCar(car, dt, throttle, steer);
    // stuck? shuffle the plan
    if (Math.hypot(car.x - car.lastX, car.y - car.lastY) < 2 && throttle !== 0) car.stuckT += dt; else car.stuckT = 0;
    car.lastX = car.x; car.lastY = car.y;
    if (car.stuckT > 4) { car.plan = null; car.stuckT = 0; }
  }

  // --- combat ---------------------------------------------------------------
  function shoot(events, c) {
    const p = state.player;
    const w = WEAPONS[p.weapon];
    const aimAngle = Math.atan2(c.aimY - p.y, c.aimX - p.x);
    p.angle = aimAngle;
    if (p.weapon === 'fist') {
      // a swing: anything living within reach, in front
      for (const ped of [...state.peds, ...state.cops]) {
        if (ped.dead) continue;
        const d = Math.hypot(ped.x - p.x, ped.y - p.y);
        if (d < w.range + 14 && Math.abs(angDiff(Math.atan2(ped.y - p.y, ped.x - p.x), aimAngle)) < 0.8) {
          hurtPed(ped, w.damage, events, aimAngle);
          return events | EV.HIT;
        }
      }
      return events;
    }
    state.stats.shotsFired += 1;
    crime(26);
    // everyone nearby runs from the noise
    for (const ped of state.peds) {
      if (!ped.dead && Math.hypot(ped.x - p.x, ped.y - p.y) < 210) { ped.fleeT = Math.max(ped.fleeT, 2.4); ped.fleeX = p.x; ped.fleeY = p.y; }
    }
    for (let pellet = 0; pellet < w.pellets; pellet += 1) {
      const dir = aimAngle + (rng.next() * 2 - 1) * w.spread;
      const fx = Math.cos(dir); const fy = Math.sin(dir);
      let bestT = w.range; let bestEnt = null; let bestKind = null;
      const testEnt = (ent, radius, kind) => {
        const rx = ent.x - p.x; const ry = ent.y - p.y;
        const along = rx * fx + ry * fy;
        if (along < 0 || along > bestT) return;
        const perp = Math.abs(rx * fy - ry * fx);
        if (perp < radius) { bestT = along; bestEnt = ent; bestKind = kind; }
      };
      for (const ped of state.peds) if (!ped.dead) testEnt(ped, 14, 'ped');
      for (const cop of state.cops) if (!cop.dead) testEnt(cop, 14, 'cop');
      for (const car of state.cars) if (!car.dead && car !== p.car) testEnt(car, 25, 'car');
      const hx = p.x + fx * bestT; const hy = p.y + fy * bestT;
      state.tracers.push({ x1: p.x, y1: p.y, x2: hx, y2: hy, ttl: 0.08, hostile: false });
      if (bestEnt) {
        if (bestKind === 'car') { bestEnt.hp -= w.damage; if (bestEnt.hp < 0) bestEnt.hp = 0; }
        else hurtPed(bestEnt, w.damage, events, dir);
        events |= EV.HIT;
      }
    }
    return events | EV.SHOT;
  }

  function hurtPed(ped, damage, events, fromAngle) {
    ped.hp -= damage;
    ped.x += Math.cos(fromAngle) * 9;
    ped.y += Math.sin(fromAngle) * 9;
    if (ped.hp <= 0 && !ped.dead) {
      ped.dead = true;
      if (ped.cop) { state.heat += 240; state.seenT = 0; }
      else if (ped.dealer) {
        const step = currentStep();
        if (step && step.kind === 'kill') state.kills += 1;
        if (rng.chance(0.5)) state.pickups.push({ kind: 'snack', x: ped.x, y: ped.y, ttl: 40 });
      } else {
        crime(200);
        if (rng.chance(0.55)) state.pickups.push({ kind: 'snack', x: ped.x, y: ped.y, ttl: 40 });
      }
    } else if (!ped.dead) {
      ped.fleeT = Math.max(ped.fleeT, 1.6);
      ped.fleeX = state.player.x; ped.fleeY = state.player.y;
    }
    return events;
  }

  // --- police -----------------------------------------------------------------
  function updatePolice(dt, events) {
    const p = state.player;
    const st = stars();
    // sight & heat bookkeeping
    let seen = false;
    if (!playerHidden()) {
      for (const car of state.cars) {
        if (car.kind !== 'police' || car.dead) continue;
        if (Math.hypot(car.x - p.x, car.y - p.y) < 430 && lineOfSight(city, car.x, car.y, p.x, p.y)) seen = true;
      }
      for (const cop of state.cops) {
        if (cop.dead) continue;
        if (Math.hypot(cop.x - p.x, cop.y - p.y) < 430 && lineOfSight(city, cop.x, cop.y, p.x, p.y)) seen = true;
      }
    }
    if (seen) { state.seenT = 0; state.lastSeen = { x: p.x, y: p.y }; }
    else state.seenT += dt;
    if (state.seenT > 4 && state.heat > 0) state.heat = Math.max(0, state.heat - 11 * dt);

    // desired patrol cars
    const wantedCars = [0, 1, 2, 2, 3, 3][st];
    const policeCars = state.cars.filter((c) => c.kind === 'police' && !c.dead);
    if (policeCars.length < wantedCars) {
      // arrive from a far intersection
      const spots = [];
      for (const ax of ROADS.avenues) for (const sy of ROADS.streets) {
        const d = Math.hypot(ax - p.x, sy - p.y);
        if (d > 680 && d < 980) spots.push({ x: ax, y: sy });
      }
      const spot = spots.length ? rng.pick(spots) : { x: p.x + 760, y: p.y };
      const car = makeCar('police', spot.x, spot.y, 0, '#e8e4da', 'police');
      car.driver = 'ai';
      car.flank = policeCars.length - 1;
    }
    for (const car of policeCars) {
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (st === 0) {
        // stand down: leave the area, then melt away
        if (d > 850) { car.dead = true; continue; }
        car.plan = car.plan; // keep cruising away via driveAI fallback below
        driveAI(car, dt, 0.8);
        continue;
      }
      if (car.driver === 'idle') {
        // officers are out; the car waits unless the suspect escapes far
        if (d > 720) {
          for (const cop of state.cops) if (cop.unit === car.id) cop.dead = true;
          car.driver = 'ai';
        } else continue;
      }
      // chase: aim at a flank point around the player
      const baseAngle = p.car ? p.car.angle : p.angle;
      const tx = (state.lastSeen ? state.lastSeen.x : p.x) + Math.cos(baseAngle + Math.PI / 2) * car.flank * 130 - Math.cos(baseAngle) * 30;
      const ty = (state.lastSeen ? state.lastSeen.y : p.y) + Math.sin(baseAngle + Math.PI / 2) * car.flank * 130 - Math.sin(baseAngle) * 30;
      if (d > 540) {
        if (!car.plan || car.planI >= car.plan.length) { car.plan = gridRoute(car.x, car.y, tx, ty); car.planI = 0; }
        driveAI(car, dt, 1.25);
      } else {
        car.plan = [{ x: tx, y: ty }];
        car.planI = 0;
        driveAI(car, dt, 1.25);
      }
      // deploy officers: suspect on foot nearby, or boxed in a stopped
      // car — but nobody deploys against a suspect they cannot see
      const suspectSlow = p.car ? Math.abs(p.car.speed) < 25 : true;
      if (!playerHidden() && ((!p.car && d < 175) || (p.car && suspectSlow && d < 115))) {
        car.deployT += dt;
        if (car.deployT > 1.2) {
          car.deployT = 0;
          car.driver = 'idle';
          car.speed = 0;
          for (let i = 0; i < 2; i += 1) {
            const cop = makePed(car.x + rng.range(-24, 24), car.y + rng.range(-24, 24), { kind: 'cop', speed: 238 });
            cop.cop = true;
            cop.unit = car.id;
            state.cops.push(cop);
            state.peds.splice(state.peds.indexOf(cop), 1);
          }
        }
      } else car.deployT = Math.max(0, car.deployT - dt);
    }

    // foot officers
    let arresting = false;
    const hidden = playerHidden();
    for (const cop of state.cops) {
      if (cop.dead) continue;
      const d = Math.hypot(cop.x - p.x, cop.y - p.y);
      if (st === 0 && d > 260) { cop.dead = true; continue; }
      // a suspect lying low at Casa Segura is a cold trail: search the
      // last seen point briefly, then give up and melt away
      if (hidden && state.seenT > 3) { cop.dead = true; continue; }
      const target = state.lastSeen || p;
      const td = Math.hypot(target.x - cop.x, target.y - cop.y);
      if (td > 26) {
        const vx = (target.x - cop.x) / td; const vy = (target.y - cop.y) / td;
        cop.x += vx * cop.speed * dt;
        cop.y += vy * cop.speed * dt;
        cop.angle = Math.atan2(vy, vx);
        collide(city, cop, 13);
      }
      cop.fireCd -= dt;
      if (!hidden && st >= 3 && d < 380 && lineOfSight(city, cop.x, cop.y, p.x, p.y) && cop.fireCd <= 0) {
        cop.fireCd = 0.95;
        let hitChance = d < 150 ? 0.6 : d < 300 ? 0.38 : 0.18;
        if (p.speedNow > 200) hitChance *= 0.45; // a sprinting target is hard to hit
        state.tracers.push({ x1: cop.x, y1: cop.y, x2: p.x, y2: p.y, ttl: 0.08, hostile: true });
        if (rng.chance(hitChance)) {
          if (p.car) p.car.hp = Math.max(0, p.car.hp - 5);
          else { p.hp -= 7; events |= EV.HIT; }
        }
      }
      if (!hidden && !p.car && d < 48 && st > 0 && st <= 2) arresting = true;
    }
    if (arresting && p.speedNow < 120) state.bustedMeter = Math.min(1, state.bustedMeter + dt / 2.2);
    else state.bustedMeter = Math.max(0, state.bustedMeter - dt / 1.4);
    if (state.bustedMeter >= 1) events = busted(events);
    // prune the dead & the melted
    state.cops = state.cops.filter((c) => !c.dead);
    return events;
  }

  // --- people -------------------------------------------------------------------
  function updatePeds(dt, events) {
    const p = state.player;
    for (const ped of state.peds) {
      if (ped.dead) continue;
      ped.hitCd = Math.max(0, ped.hitCd - dt);
      if (ped.dealer) {
        // dealers hold their sand and shoot back
        const d = Math.hypot(ped.x - p.x, ped.y - p.y);
        ped.fireCd -= dt;
        const step = currentStep();
        const hostile = (step && step.kind === 'kill') || state.heat > 0 || state.t - (state.lastShotT || -99) < 4;
        if (hostile && d < 350 && lineOfSight(city, ped.x, ped.y, p.x, p.y)) {
          ped.angle = Math.atan2(p.y - ped.y, p.x - ped.x);
          if (ped.fireCd <= 0) {
            ped.fireCd = 1.15;
            state.tracers.push({ x1: ped.x, y1: ped.y, x2: p.x, y2: p.y, ttl: 0.08, hostile: true });
            if (rng.chance(d < 200 ? 0.45 : 0.25)) {
              if (p.car) p.car.hp = Math.max(0, p.car.hp - 4);
              else { p.hp -= 6; events |= EV.HIT; }
            }
          }
        }
        continue;
      }
      if (ped.fleeT > 0) {
        ped.fleeT -= dt;
        const d = Math.hypot(ped.x - ped.fleeX, ped.y - ped.fleeY) || 1;
        ped.x += ((ped.x - ped.fleeX) / d) * 205 * dt;
        ped.y += ((ped.y - ped.fleeY) / d) * 205 * dt;
        collide(city, ped, 12);
        continue;
      }
      if (ped.stander) { ped.angle += Math.sin(state.t * 0.7 + ped.sway) * 0.002; continue; }
      const d = Math.hypot(ped.tx - ped.x, ped.ty - ped.y);
      if (d < 14) {
        ped.tx = ped.home.x + rng.range(-130, 130);
        ped.ty = ped.home.y + rng.range(-130, 130);
      } else {
        ped.x += ((ped.tx - ped.x) / d) * ped.speed * dt;
        ped.y += ((ped.ty - ped.y) / d) * ped.speed * dt;
        ped.angle = Math.atan2(ped.ty - ped.y, ped.tx - ped.x);
        collide(city, ped, 12);
      }
    }
    return events;
  }

  // --- car contact ----------------------------------------------------------------
  function updateCarContacts(dt, events) {
    const cars = state.cars;
    for (let i = 0; i < cars.length; i += 1) {
      const a = cars[i];
      if (a.dead) continue;
      a.hitCd = Math.max(0, a.hitCd - dt);
      for (let j = i + 1; j < cars.length; j += 1) {
        const b = cars[j];
        if (b.dead) continue;
        const dx = b.x - a.x; const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01 && d < 50) {
          const push = (50 - d) / 2;
          const ux = dx / d; const uy = dy / d;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
          collide(city, a, 24);
          collide(city, b, 24);
          // damage once per impact, from the true closing speed along
          // the contact normal — a nose-to-nose crash hurts, a gentle
          // overtake does not, and resting contact never grinds hp away
          const vax = Math.cos(a.angle) * a.speed; const vay = Math.sin(a.angle) * a.speed;
          const vbx = Math.cos(b.angle) * b.speed; const vby = Math.sin(b.angle) * b.speed;
          const closing = (vax - vbx) * ux + (vay - vby) * uy;
          if (closing > 130 && a.hitCd <= 0 && b.hitCd <= 0) {
            const dmg = Math.min(14, (closing - 130) * 0.045);
            a.hp -= dmg; b.hp -= dmg;
            a.hitCd = 0.5; b.hitCd = 0.5;
          }
          a.speed *= 0.94; b.speed *= 0.94;
          if ((a.driver === 'player' && b.kind === 'police') || (b.driver === 'player' && a.kind === 'police')) {
            if (state.ramCd <= 0) { crime(60); state.ramCd = 1.5; }
          }
        }
      }
      // running people down
      if (Math.abs(a.speed) > 60) {
        for (const ped of [...state.peds, ...state.cops]) {
          if (ped.dead || ped.hitCd > 0) continue;
          if (Math.hypot(ped.x - a.x, ped.y - a.y) < 32) {
            ped.hitCd = 1;
            const wasAlive = ped.hp > 0;
            hurtPed(ped, 65, events, a.angle);
            if (a.driver === 'player' && wasAlive) crime(ped.dead ? 220 : 120);
          }
        }
      }
      if (a.hp < 0) a.hp = 0;
    }
    state.ramCd = Math.max(0, state.ramCd - dt);
    // a wrecked story car comes back to its lot — the story must go on
    const tc = state.targetCarRef;
    if (tc && tc.hp <= 0 && tc.driver !== 'player') {
      tc.hp = 100;
      tc.speed = 0;
      if (tc.kind === 'mission') { tc.x = 3520; tc.y = 700; }
      if (tc.kind === 'job') { tc.x = 3580; tc.y = 800; }
    }
    return events;
  }

  // --- the step ---------------------------------------------------------------------
  function step(dt, c) {
    let events = 0;
    const p = state.player;
    state.t += dt;
    state.stats.timePlayed += dt;
    state.minutes = (state.minutes + dt * DAY.rate) % 1440;
    if (state.toastT > 0) state.toastT -= dt;
    state.vaultCd = Math.max(0, state.vaultCd - dt);
    world.vaultReady = state.vaultCd <= 0;
    spawnStepNeeds();

    // weapon selection (switching weapons re-grips the trigger: the
    // next held pull counts as a fresh one)
    if (c.slot !== undefined && c.slot >= 0) {
      const name = WEAPON_BY_SLOT[c.slot];
      if ((name === 'fist' || p.weapons[name]) && p.weapon !== name) {
        p.weapon = name;
        state.prevFire = false;
      }
    }

    // player movement
    if (p.car) {
      const car = p.car;
      moveCar(car, dt, c.my, c.mx);
      p.x = car.x; p.y = car.y;
      p.angle = car.angle;
      p.speedNow = Math.abs(car.speed);
    } else {
      const mag = Math.hypot(c.mx, c.my);
      const speed = c.sprint ? PLAYER.runSpeed : PLAYER.walkSpeed;
      if (mag > 0.01) {
        const vx = (c.mx / Math.max(1, mag)) * speed;
        const vy = (c.my / Math.max(1, mag)) * speed;
        p.x += vx * dt;
        p.y += vy * dt;
        p.angle = Math.atan2(c.my, c.mx);
        p.speedNow = speed;
      } else p.speedNow = 0;
      collide(city, p, PLAYER.radius);
    }

    // firing
    p.fireCd -= dt;
    const fireEdge = c.fire && !state.prevFire;
    if (c.fire && p.fireCd <= 0 && (WEAPONS[p.weapon].auto || fireEdge)) {
      p.fireCd = WEAPONS[p.weapon].cooldown;
      state.lastShotT = state.t;
      events = shoot(events, c);
    }
    state.prevFire = !!c.fire;

    // interaction
    const interactEdge = c.interact && !state.prevInteract;
    if (interactEdge) events = doInteract(events);
    state.prevInteract = !!c.interact;

    // traffic
    for (const car of state.cars) {
      if (car.kind === 'traffic' && car.driver === 'ai') driveAI(car, dt);
    }
    events = updatePolice(dt, events);
    events = updatePeds(dt, events);
    events = updateCarContacts(dt, events);

    // pickups
    for (const pk of state.pickups) pk.ttl -= dt;
    state.pickups = state.pickups.filter((pk) => pk.ttl > 0);
    for (const pk of [...state.pickups]) {
      if (Math.hypot(pk.x - p.x, pk.y - p.y) < 32) {
        if (pk.kind === 'snack') p.hp = Math.min(PLAYER.hp, p.hp + 25);
        state.pickups.splice(state.pickups.indexOf(pk), 1);
        events |= EV.PICKUP;
      }
    }
    // tracers fade
    for (const tr of state.tracers) tr.ttl -= dt;
    state.tracers = state.tracers.filter((tr) => tr.ttl > 0);

    // mission engine
    const stepDef = currentStep();
    if (stepDef) {
      const pt = stepPoint(stepDef);
      const dPt = pt ? Math.hypot(pt.x - p.x, pt.y - p.y) : Infinity;
      switch (stepDef.kind) {
        case 'goto': if (dPt < stepDef.r) events = advanceStep(events); break;
        case 'pickup':
          if (dPt < stepDef.r) { state.heat = stepDef.heat; state.seenT = 0; events = advanceStep(events) | EV.PICKUP; }
          break;
        case 'steal': if (p.car && p.car === state.targetCarRef) events = advanceStep(events); break;
        case 'deliverCar': if (p.car && p.car === state.targetCarRef && dPt < stepDef.r) events = advanceStep(events); break;
        case 'kill': if (state.kills >= stepDef.count) events = advanceStep(events); break;
        case 'channel':
          if (dPt < stepDef.r) {
            state.channelT += dt;
            if (state.channelT >= stepDef.seconds) {
              state.heat += stepDef.heat;
              state.seenT = 0;
              events = advanceStep(events);
            }
          } else state.channelT = Math.max(0, state.channelT - dt * 2);
          break;
        case 'meet': if (dPt < stepDef.r) events = advanceStep(events); break;
        case 'escape': if (state.heat <= 0) events = advanceStep(events); break;
        default: break;
      }
    }
    // the bank's side vault: free-roam money for the brave, between missions
    const onBankStep = stepDef && stepDef.kind === 'channel' && stepDef.place === 'bank';
    if (!onBankStep && state.vaultCd <= 0) {
      const door = city.places.bank.door;
      if (Math.hypot(door.x - p.x, door.y - p.y) < 96) {
        state.vaultT += dt;
        if (state.vaultT >= 3) {
          state.vaultT = 0;
          state.vaultCd = 240;
          p.money += 700;
          state.heat += 330;
          state.seenT = 0;
          setToast('Side vault: +$700. The alarm disagrees.');
          events |= EV.MONEY;
        }
      } else state.vaultT = Math.max(0, state.vaultT - dt * 2);
    }

    if (p.hp <= 0) events = wasted(events);
    return events;
  }

  // --- save / restore ---------------------------------------------------------------
  function save() {
    const p = state.player;
    const oc = ownedCar();
    return {
      v: 5, x: p.x, y: p.y, angle: p.angle, hp: p.hp, money: p.money,
      weapon: p.weapon, weapons: { ...p.weapons },
      missionIndex: state.missionIndex, stepIndex: state.stepIndex,
      minutes: state.minutes, storyComplete: state.storyComplete,
      stats: { ...state.stats },
      owned: oc ? { x: oc.x, y: oc.y, angle: oc.angle, hp: oc.hp, color: oc.color } : null,
    };
  }
  function restore(snap) {
    const p = state.player;
    p.x = snap.x; p.y = snap.y; p.angle = snap.angle || 0;
    p.hp = snap.hp; p.money = snap.money;
    p.weapon = snap.weapon || 'fist';
    p.weapons = { ...snap.weapons };
    p.car = null;
    state.missionIndex = snap.missionIndex;
    state.stepIndex = snap.stepIndex;
    state.minutes = snap.minutes;
    state.storyComplete = !!snap.storyComplete;
    state.stats = { ...snap.stats };
    state.heat = 0;
    state.spawnedKey = '';
    if (snap.owned && !ownedCar()) {
      const car = makeCar('owned', snap.owned.x, snap.owned.y, snap.owned.angle, snap.owned.color, 'sedan');
      car.hp = snap.owned.hp;
    }
    // the story car of the current mission must exist again
    const step = currentStep();
    if (step && (step.kind === 'steal' || step.kind === 'deliverCar')) {
      if (step.car === 'job' || state.missionIndex >= 4) {
        const job = makeCar('job', 3580, 800, Math.PI / 2, '#2ee6ff', 'sport');
        state.targetCarRef = job;
      } else state.targetCarRef = state.cars.find((c) => c.kind === 'mission') || state.targetCarRef;
    }
    spawnStepNeeds();
  }

  const world = {
    state, step, currentStep, objective, targetCar, nearestDealer, ownedCar,
    missionKills: () => state.kills,
    stars,
    save, restore,
    vaultReady: true,
  };
  spawnStepNeeds();
  return world;
}
