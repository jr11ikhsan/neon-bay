// NEON BAY's rules and state, with no drawing and no browser in it: the player on
// foot and in cars, traffic that follows the road grid, pedestrians, the wanted
// system, police that chase on wheels and on foot, simple combat, the mission
// chain, pickups, the day cycle and save data. step() advances one fixed step and
// returns what happened as bit flags so the caller can add sound and announcements.
import { CAR, DAY, GUN, PEDS, PLAYER, POLICE, ROADS, TRAFFIC, WANTED, WORLD } from './config.js';
import { collideWorld, isOnRoad, lineOfSight } from './city.js';
import { MISSIONS } from './missions.js';
import { rngTools } from './random.js';

export const EV = {
  SHOT: 1, PUNCH: 2, CASH: 4, MISSION: 8, BUSTED: 16, WASTED: 32,
  ENTER: 64, EXIT: 128, CRASH: 256, HURT: 512, PICKUP: 1024, FAILED: 2048,
};

const CAR_COLORS = ['#e63946', '#457b9d', '#f4a261', '#2a9d8f', '#e9c46a', '#9b5de5', '#00bbf9', '#f15bb5', '#8ecae6', '#ffffff', '#3a3f4a', '#84a98c'];
const PED_COLORS = ['#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#ffc6ff', '#ffadad', '#bdb2ff'];
const SKIN_COLORS = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#ffdbac'];

function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}
function angleDiff(a, b) {
  let d = Math.abs((a - b) % (Math.PI * 2));
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createWorld(random, city) {
  const R = rngTools(random);
  const places = city.places;

  const state = {
    time: 0,
    hour: DAY.startHour,
    player: null,
    cars: [],
    peds: [],
    cops: [],
    bullets: [],
    particles: [],
    pickups: [],
    heat: 0,
    stars: 0,
    seenTimer: 99,
    bust: 0,
    money: 0,
    earned: 0,
    mission: { index: 0, step: 0, kills: 0, channel: 0, active: false, done: false },
    objective: null,
    objectiveText: '',
    objectiveSub: '',
    toasts: [],
    stats: { stolen: 0, downed: 0, shots: 0, missionsDone: 0 },
    over: null,
    targetCar: null,
    muted: false,
  };

  function toast(text, sub = '') {
    state.toasts.push({ text, sub, t: 4.2 });
    if (state.toasts.length > 3) state.toasts.shift();
  }

  // ---------- cars ----------
  let carId = 0;
  function makeCar(x, y, angle, kind, color) {
    const car = {
      id: carId += 1, x, y, angle, speed: 0, kind, color,
      health: CAR.health, driver: null, dead: false, smoke: 0,
      ai: null, copExitDone: false, missionTarget: false, honk: 0,
    };
    state.cars.push(car);
    return car;
  }

  // Right-hand traffic lanes: on a vertical road, southbound (+y) uses the west
  // lane (center - offset) and northbound the east lane; on a horizontal road,
  // eastbound (+x) uses the south lane (center + offset), westbound the north.
  function laneCoord(axis, center, dirSign) {
    return axis === 'V' ? center - dirSign * ROADS.laneOffset : center + dirSign * ROADS.laneOffset;
  }

  function trafficInit(car) {
    // Put the car on a lane of the nearest road, aimed along it, target = next crossing.
    let bestV = null, bestVd = Infinity;
    for (const r of city.roadsV) { const d = Math.abs(car.x - r.x); if (d < bestVd) { bestVd = d; bestV = r; } }
    let bestH = null, bestHd = Infinity;
    for (const r of city.roadsH) { const d = Math.abs(car.y - r.y); if (d < bestHd) { bestHd = d; bestH = r; } }
    const axis = bestVd <= bestHd ? 'V' : 'H';
    const dirSign = R.chance(0.5) ? 1 : -1;
    if (axis === 'V') {
      car.x = laneCoord('V', bestV.x, dirSign);
      car.angle = dirSign * Math.PI / 2;
      car.ai = { axis, center: bestV.x, dirSign, phase: 'go', tx: car.x, ty: car.y };
    } else {
      car.y = laneCoord('H', bestH.y, dirSign);
      car.angle = dirSign > 0 ? 0 : Math.PI;
      car.ai = { axis, center: bestH.y, dirSign, phase: 'go', tx: car.x, ty: car.y };
    }
    setTrafficTarget(car);
  }

  function setTrafficTarget(car) {
    const ai = car.ai;
    // Next intersection along the direction of travel (or the world edge).
    if (ai.axis === 'V') {
      const ys = ROADS.horizontalY.filter((y) => (ai.dirSign > 0 ? y > car.y + 4 : y < car.y - 4));
      const next = ai.dirSign > 0 ? Math.min(...ys, WORLD.height - 60) : Math.max(...ys, 60);
      ai.tx = car.x; ai.ty = next;
    } else {
      const xs = ROADS.verticalX.filter((x) => (ai.dirSign > 0 ? x > car.x + 4 : x < car.x - 4));
      const next = ai.dirSign > 0 ? Math.min(...xs, WORLD.beachX - 60) : Math.max(...xs, 60);
      ai.tx = next; ai.ty = car.y;
    }
  }

  function chooseTurn(car) {
    const ai = car.ai;
    // At an intersection: pick straight / left / right (never a U-turn).
    const roll = random();
    const turn = roll < 0.55 ? 0 : roll < 0.775 ? -1 : 1; // -1 left, +1 right
    if (turn === 0) { setTrafficTarget(car); return; }
    // The crossing road's centre line is the target coordinate we just reached.
    const crossCenter = ai.axis === 'V' ? ai.ty : ai.tx;
    const newAxis = ai.axis === 'V' ? 'H' : 'V';
    const newDir = ai.axis === 'V' ? -turn * ai.dirSign : turn * ai.dirSign;
    ai.axis = newAxis;
    ai.dirSign = newDir;
    ai.center = crossCenter;
    ai.phase = 'turn';
    // Aim at a point just past the corner, already on the new lane.
    if (newAxis === 'H') {
      ai.tx = car.x + newDir * 150;
      ai.ty = laneCoord('H', crossCenter, newDir);
    } else {
      ai.tx = laneCoord('V', crossCenter, newDir);
      ai.ty = car.y + newDir * 150;
    }
  }

  function steerCar(car, tx, ty, dt, maxSpeed, turnRate = 2.4) {
    const desired = Math.atan2(ty - car.y, tx - car.x);
    const diff = angleDiff(car.angle, desired);
    car.angle = angleLerp(car.angle, desired, Math.min(1, turnRate * dt * (diff > 0.2 ? 1 : 1.6)));
    const slow = diff > 0.9 ? 0.35 : diff > 0.4 ? 0.65 : 1;
    const target = maxSpeed * slow;
    car.speed += Math.sign(target - car.speed) * Math.min(Math.abs(target - car.speed), 320 * dt);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
  }

  // ---------- peds & cops ----------
  function makePed(x, y, kind = 'civilian') {
    const ped = {
      x, y, angle: R.range(0, Math.PI * 2), health: kind === 'dealer' ? 80 : 45,
      kind, state: 'walk', tx: x, ty: y, wait: R.range(0, 2), fleeT: 0,
      color: R.pick(PED_COLORS), skin: R.pick(SKIN_COLORS), phase: R.range(0, 6),
      punchCd: 0, dead: false, mission: kind === 'dealer',
    };
    state.peds.push(ped);
    return ped;
  }
  function makeCop(x, y) {
    const cop = {
      x, y, angle: 0, health: 90, state: 'chase', shootCd: R.range(0.4, 1.2),
      punchCd: 0, dead: false, color: '#2b4acb', skin: R.pick(SKIN_COLORS), phase: R.range(0, 6),
    };
    state.cops.push(cop);
    return cop;
  }

  function sidewalkTarget(p) {
    // A point on a sidewalk near the ped: along a road, offset past the kerb.
    const onV = R.chance(0.5);
    if (onV) {
      const cx = R.pick(ROADS.verticalX);
      p.tx = cx + (R.chance(0.5) ? -1 : 1) * (ROADS.width / 2 + 15);
      p.ty = Math.min(WORLD.height - 40, Math.max(40, p.y + R.range(-520, 520)));
    } else {
      const cy = R.pick(ROADS.horizontalY);
      p.ty = cy + (R.chance(0.5) ? -1 : 1) * (ROADS.width / 2 + 15);
      p.tx = Math.min(WORLD.beachX - 30, Math.max(40, p.x + R.range(-520, 520)));
    }
  }

  // ---------- world setup ----------
  function spawnTrafficAndParked() {
    for (let i = 0; i < TRAFFIC.count; i += 1) {
      const onV = R.chance(0.5);
      const x = onV ? R.pick(ROADS.verticalX) + R.range(-20, 20) : R.range(120, WORLD.beachX - 200);
      const y = onV ? R.range(120, WORLD.height - 120) : R.pick(ROADS.horizontalY) + R.range(-20, 20);
      const car = makeCar(x, y, 0, 'traffic', R.pick(CAR_COLORS));
      car.driver = 'ai';
      trafficInit(car);
      car.speed = TRAFFIC.speed * R.range(0.75, 1);
    }
    // Parked cars: in lots first, then parallel-parked along roads.
    const spots = [];
    for (const lot of city.lots) for (const s of lot.spots) spots.push(s);
    for (let i = spots.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
    let parked = 0;
    for (const s of spots) {
      if (parked >= TRAFFIC.parkedCount) break;
      if (R.chance(0.45)) continue;
      makeCar(s.x, s.y, s.angle, 'parked', R.pick(CAR_COLORS));
      parked += 1;
    }
    while (parked < TRAFFIC.parkedCount) {
      const onV = R.chance(0.5);
      const cx = R.pick(ROADS.verticalX), cy = R.pick(ROADS.horizontalY);
      const x = onV ? cx + (R.chance(0.5) ? -1 : 1) * (ROADS.width / 2 - 20) : R.range(100, WORLD.beachX - 120);
      const y = onV ? R.range(100, WORLD.height - 100) : cy + (R.chance(0.5) ? -1 : 1) * (ROADS.width / 2 - 20);
      makeCar(x, y, onV ? Math.PI / 2 : 0, 'parked', R.pick(CAR_COLORS));
      parked += 1;
    }
    // The mission-1 gold coupe waits in the Bay Motors lot.
    const lot = places.carLot.lot;
    const spot = lot && lot.spots.length ? lot.spots[Math.floor(lot.spots.length / 2)] : { x: places.carLot.x, y: places.carLot.y, angle: 0 };
    state.targetCar = makeCar(spot.x, spot.y, spot.angle, 'mission', '#ffb703');
    state.targetCar.missionTarget = true;
  }

  function reset(save) {
    state.time = 0;
    state.hour = save?.hour ?? DAY.startHour;
    state.cars = [];
    state.peds = [];
    state.cops = [];
    state.bullets = [];
    state.particles = [];
    state.pickups = [];
    state.heat = 0;
    state.stars = 0;
    state.seenTimer = 99;
    state.bust = 0;
    state.money = save?.money ?? 0;
    state.earned = save?.earned ?? 0;
    state.over = null;
    state.stats = save?.stats ?? { stolen: 0, downed: 0, shots: 0, missionsDone: 0 };
    state.player = {
      x: save?.px ?? places.hotel.x, y: save?.py ?? places.hotel.y + 30,
      angle: -Math.PI / 2, health: PLAYER.health, inCar: null,
      hasGun: save?.hasGun ?? false, punchCd: 0, shootCd: 0, hurtT: 0, phase: 0,
      skin: '#e0ac69', color: '#ffd23f',
    };
    for (let i = 0; i < PEDS.count; i += 1) {
      const onV = R.chance(0.5);
      const x = onV ? R.pick(ROADS.verticalX) + (R.chance(0.5) ? -1 : 1) * (ROADS.width / 2 + 15) : R.range(80, WORLD.beachX - 60);
      const y = onV ? R.range(80, WORLD.height - 80) : R.pick(ROADS.horizontalY) + (R.chance(0.5) ? -1 : 1) * (ROADS.width / 2 + 15);
      const p = makePed(x, y);
      sidewalkTarget(p);
    }
    spawnTrafficAndParked();
    state.mission = { index: save?.missionIndex ?? 0, step: 0, kills: 0, channel: 0, active: false, done: false };
    if (state.mission.index >= MISSIONS.length) {
      state.mission.done = true;
      state.objective = null;
      state.objectiveText = 'Free roam — the bay is yours';
    } else {
      startMission(state.mission.index, !save);
    }
  }

  // ---------- missions ----------
  function currentStep() {
    const m = MISSIONS[state.mission.index];
    return m ? m.steps[state.mission.step] : null;
  }
  function stepTarget(step) {
    if (!step) return null;
    if (step.type === 'steal') return state.targetCar ? { x: state.targetCar.x, y: state.targetCar.y } : null;
    if (step.place === 'carLot' && state.targetCar) return { x: state.targetCar.x, y: state.targetCar.y };
    if (step.type === 'kill') {
      let best = null, bestD = Infinity;
      for (const p of state.peds) {
        if (p.mission && !p.dead) { const d = dist(state.player, p); if (d < bestD) { bestD = d; best = p; } }
      }
      return best ? { x: best.x, y: best.y } : null;
    }
    if (step.place) return places[step.place];
    return null;
  }
  function startMission(index, announce = true) {
    const m = MISSIONS[index];
    state.mission.index = index;
    state.mission.step = 0;
    state.mission.kills = 0;
    state.mission.channel = 0;
    state.mission.active = true;
    if (announce && m) toast(m.title, m.intro);
    startStep();
  }
  function startStep() {
    const step = currentStep();
    state.mission.kills = 0;
    state.mission.channel = 0;
    if (!step) return;
    if (step.onStart === 'spawnDealers') {
      for (const d of places.dealers) {
        const p = makePed(d.x, d.y, 'dealer');
        p.state = 'stand';
      }
      toast('Three dealers on the beach', 'Follow the markers. Fists or the pistol — your call.');
    }
    refreshObjective();
  }
  function refreshObjective() {
    const step = currentStep();
    if (!step) { state.objective = null; state.objectiveText = ''; return; }
    state.objective = stepTarget(step);
    state.objectiveText = step.text;
    state.objectiveSub = step.type === 'kill' ? `${state.mission.kills} / ${step.count}` : '';
  }
  function completeStep(events) {
    const m = MISSIONS[state.mission.index];
    state.mission.step += 1;
    if (state.mission.step >= m.steps.length) {
      state.money += m.reward;
      state.earned += m.reward;
      state.stats.missionsDone += 1;
      toast(`${m.title} — complete`, `+$${m.reward}`);
      events |= EV.MISSION | EV.CASH;
      if (state.mission.index === 0 && !state.player.hasGun) {
        state.player.hasGun = true;
        toast('Pistol found in the glovebox', 'Aim with the mouse, click to shoot.');
      }
      state.mission.index += 1;
      if (state.mission.index >= MISSIONS.length) {
        state.mission.done = true;
        state.mission.active = false;
        state.objective = null;
        state.objectiveText = 'Free roam — the bay is yours';
        toast('NEON BAY — story complete', 'Free roam unlocked. The city is still alive out there.');
      } else {
        startMission(state.mission.index);
      }
    } else {
      toast('Objective updated', currentStep().text);
      startStep();
    }
    return events;
  }

  // ---------- crime & wanted ----------
  function witnessed(x, y, radius = 340) {
    for (const c of state.cops) if (!c.dead && Math.hypot(c.x - x, c.y - y) < radius && lineOfSight(city, x, y, c.x, c.y)) return true;
    for (const car of state.cars) {
      if ((car.kind === 'police' || (car.kind === 'traffic' && car.driver === 'ai')) && Math.hypot(car.x - x, car.y - y) < radius && lineOfSight(city, x, y, car.x, car.y)) return true;
    }
    for (const p of state.peds) if (!p.dead && Math.hypot(p.x - x, p.y - y) < radius * 0.8 && lineOfSight(city, x, y, p.x, p.y)) return true;
    return false;
  }
  function crime(points, x, y) {
    const w = witnessed(x, y);
    state.heat += w ? points : points * 0.35;
    if (w) state.seenTimer = 0;
  }

  // ---------- combat helpers ----------
  function hurtPed(p, dmg, events, byPlayer = true) {
    p.health -= dmg;
    p.fleeT = 3;
    if (p.kind !== 'dealer') p.state = 'flee';
    else p.state = 'flee';
    if (p.health <= 0 && !p.dead) {
      p.dead = true;
      state.stats.downed += byPlayer ? 1 : 0;
      if (byPlayer) {
        crime(p.mission ? WANTED.missionCrime : WANTED.killPed, p.x, p.y);
        if (p.mission) {
          state.mission.kills += 1;
          refreshObjective();
        }
        if (R.chance(0.6)) state.pickups.push({ x: p.x + R.range(-8, 8), y: p.y + R.range(-8, 8), kind: 'money', amount: R.int(5, 28), life: 40 });
        else if (R.chance(0.3)) state.pickups.push({ x: p.x, y: p.y, kind: 'snack', amount: 30, life: 40 });
      }
    }
    return events;
  }
  function hurtCop(c, dmg, events) {
    c.health -= dmg;
    if (c.health <= 0 && !c.dead) {
      c.dead = true;
      state.stats.downed += 1;
      crime(WANTED.killCop, c.x, c.y);
      if (R.chance(0.5)) state.pickups.push({ x: c.x, y: c.y, kind: 'money', amount: R.int(10, 30), life: 40 });
    } else {
      crime(WANTED.hitCop * 0.4, c.x, c.y);
    }
    return events;
  }
  function tracer(x0, y0, x1, y1, color) {
    state.bullets.push({ x0, y0, x1, y1, life: 0.09, color });
  }
  function burst(x, y, color, n = 6, speed = 130) {
    for (let i = 0; i < n; i += 1) {
      const a = R.range(0, Math.PI * 2);
      state.particles.push({ x, y, vx: Math.cos(a) * R.range(20, speed), vy: Math.sin(a) * R.range(20, speed), life: R.range(0.25, 0.6), color, r: R.range(1.5, 3.5) });
    }
  }

  // ---------- police ----------
  function spawnPoliceCar() {
    const p = state.player;
    for (let tries = 0; tries < 12; tries += 1) {
      const a = R.range(0, Math.PI * 2);
      const d = R.range(680, 880);
      const x = Math.min(WORLD.beachX - 80, Math.max(80, p.x + Math.cos(a) * d));
      const y = Math.min(WORLD.height - 80, Math.max(80, p.y + Math.sin(a) * d));
      if (!isOnRoad(city, x, y)) continue;
      const car = makeCar(x, y, a, 'police', '#e8eaf2');
      car.driver = 'cop';
      car.mode = 'chase';
      return car;
    }
    return null;
  }
  function policeWanted() {
    let chaseCars = 0;
    let patrol = null;
    for (const car of state.cars) {
      if (car.kind !== 'police') continue;
      if (car.mode === 'chase' && car.driver === 'cop') chaseCars += 1;
      if (car.mode === 'patrol') patrol = car;
    }
    if (state.stars === 0) {
      // One patrol car cruises the grid; chase cars fall back to patrolling.
      for (const car of state.cars) {
        if (car.kind === 'police' && car.mode === 'chase' && car.driver === 'cop') {
          car.mode = 'patrol';
          trafficInit(car);
        }
      }
      if (!patrol && R.chance(0.01)) {
        const car = spawnPoliceCar();
        if (car) { car.mode = 'patrol'; trafficInit(car); }
      }
      return;
    }
    if (patrol) { patrol.mode = 'chase'; patrol.driver = 'cop'; }
    const desired = state.stars + (state.stars >= 3 ? 1 : 0);
    if (chaseCars < desired) spawnPoliceCar();
    // Despawn far police cars while the heat is low.
    if (state.stars <= 1) {
      for (let i = state.cars.length - 1; i >= 0; i -= 1) {
        const car = state.cars[i];
        if (car.kind === 'police' && car.driver === 'cop' && dist(car, state.player) > 1250) state.cars.splice(i, 1);
      }
    }
  }

  function hurtPlayer(dmg, events) {
    const p = state.player;
    if (state.over) return events;
    if (p.inCar) {
      if (R.chance(0.55)) { p.inCar.health -= dmg; return events; }
      dmg *= 0.6;
    }
    p.health -= dmg;
    p.hurtT = 0.25;
    events |= EV.HURT;
    if (p.health <= 0) {
      p.health = 0;
      state.over = 'wasted';
      events |= EV.WASTED;
      burst(p.x, p.y, '#ef476f', 14, 180);
    }
    return events;
  }

  // ---------- per-entity updates ----------
  function updateTrafficCar(car, dt) {
    const ai = car.ai;
    if (ai.panicT > 0) ai.panicT -= dt;
    // A car ahead in our lane means brakes.
    let blocked = ai.panicT > 0.4;
    if (!blocked) {
      for (const other of state.cars) {
        if (other === car) continue;
        const d = dist(car, other);
        if (d < 96 && angleDiff(car.angle, Math.atan2(other.y - car.y, other.x - car.x)) < 0.55) { blocked = true; break; }
      }
    }
    if (!blocked && state.player.inCar) {
      const pc = state.player.inCar;
      if (dist(car, pc) < 96 && angleDiff(car.angle, Math.atan2(pc.y - car.y, pc.x - car.x)) < 0.55) blocked = true;
    }
    steerCar(car, ai.tx, ai.ty, dt, blocked ? 0 : TRAFFIC.speed * (ai.speedF ?? 1));
    if (ai.phase === 'go') {
      if (Math.hypot(ai.tx - car.x, ai.ty - car.y) < 58) chooseTurn(car);
    } else if (ai.phase === 'turn') {
      const heading = ai.axis === 'V' ? ai.dirSign * Math.PI / 2 : (ai.dirSign > 0 ? 0 : Math.PI);
      if (angleDiff(car.angle, heading) < 0.3) { ai.phase = 'go'; setTrafficTarget(car); }
    }
    const pt = collideWorld(city, { x: car.x, y: car.y }, 30);
    car.x = pt.x; car.y = pt.y;
  }

  function updatePoliceCar(car, dt) {
    const p = state.player;
    const target = p.inCar ?? p;
    // Far away with no line of sight, drive the grid: aim for the crossing
    // nearest the player instead of grinding along a building wall.
    let tx = target.x, ty = target.y;
    if (Math.hypot(tx - car.x, ty - car.y) > 230 && !lineOfSight(city, car.x, car.y, tx, ty)) {
      let bi = null, bd = Infinity;
      for (const i of city.intersections) {
        const dd = Math.hypot(i.x - target.x, i.y - target.y);
        if (dd < bd) { bd = dd; bi = i; }
      }
      if (bi) { tx = bi.x; ty = bi.y; }
    }
    steerCar(car, tx, ty, dt, POLICE.carSpeed, 2.1);
    const pt = collideWorld(city, { x: car.x, y: car.y }, 30);
    car.x = pt.x; car.y = pt.y;
    // Unstick: if a wall has held the car for a second, hop back and re-aim.
    if (Math.abs(car.speed) < 25) car.stuckT = (car.stuckT ?? 0) + dt;
    else car.stuckT = 0;
    if (car.stuckT > 1.1) {
      car.angle += 0.9;
      car.x += Math.cos(car.angle) * 30;
      car.y += Math.sin(car.angle) * 30;
      const r = collideWorld(city, { x: car.x, y: car.y }, 30);
      car.x = r.x; car.y = r.y;
      car.stuckT = 0;
    }
    // Officers pile out when the player is on foot and close.
    if (!car.copExitDone && !p.inCar && dist(car, p) < 155 && state.stars >= 1) {
      car.copExitDone = true;
      car.driver = 'none';
      car.speed = 0;
      makeCop(car.x + R.range(-24, 24), car.y + R.range(-24, 24));
      makeCop(car.x + R.range(-24, 24), car.y + R.range(-24, 24));
    }
  }

  function moveWalker(w, tx, ty, speed, dt) {
    const d = Math.hypot(tx - w.x, ty - w.y);
    if (d < 4) return false;
    const desired = Math.atan2(ty - w.y, tx - w.x);
    w.angle = angleLerp(w.angle, desired, Math.min(1, 10 * dt));
    w.x += Math.cos(w.angle) * speed * dt;
    w.y += Math.sin(w.angle) * speed * dt;
    w.phase += speed * dt * 0.055;
    const pt = collideWorld(city, { x: w.x, y: w.y }, 13);
    w.x = pt.x; w.y = pt.y;
    return true;
  }

  function updatePed(p, dt, events) {
    if (p.dead) return events;
    if (p.punchCd > 0) p.punchCd -= dt;
    const player = state.player;
    const dp = dist(p, player);
    if (p.state === 'stand') {
      p.angle = angleLerp(p.angle, Math.atan2(player.y - p.y, player.x - p.x), dt * 3);
      // Dealers swing at a player who crowds them.
      if (p.kind === 'dealer' && dp < 34 && p.punchCd <= 0) {
        p.punchCd = 0.9;
        events = hurtPlayer(6, events);
        burst(player.x, player.y, '#ffd23f', 3, 80);
      }
      return events;
    }
    if (p.fleeT > 0) {
      p.fleeT -= dt;
      const away = Math.atan2(p.y - player.y, p.x - player.x);
      moveWalker(p, p.x + Math.cos(away) * 220, p.y + Math.sin(away) * 220, 250, dt);
      if (p.fleeT <= 0) { p.state = 'walk'; sidewalkTarget(p); }
      return events;
    }
    // Danger sense: a speeding car or a nearby gunshot scatters the sidewalk.
    if (player.inCar && Math.abs(player.inCar.speed) > 300 && dp < 130) { p.fleeT = 1.6; return events; }
    if (p.wait > 0) { p.wait -= dt; return events; }
    if (!moveWalker(p, p.tx, p.ty, 92, dt) || Math.hypot(p.tx - p.x, p.ty - p.y) < 18) {
      p.wait = R.range(0, 2.4);
      sidewalkTarget(p);
    }
    return events;
  }

  function updateCop(c, dt, events) {
    if (c.dead) return events;
    if (c.shootCd > 0) c.shootCd -= dt;
    const p = state.player;
    const target = p.inCar ?? p;
    const d = dist(c, target);
    const los = d < POLICE.sightRange && lineOfSight(city, c.x, c.y, target.x, target.y);
    if (d > 52) moveWalker(c, target.x, target.y, POLICE.footSpeed, dt);
    else c.angle = angleLerp(c.angle, Math.atan2(target.y - c.y, target.x - c.x), dt * 8);
    if (state.stars >= 2 && los && d < POLICE.shootRange && c.shootCd <= 0) {
      c.shootCd = POLICE.shootCooldown * R.range(0.8, 1.3);
      const hitChance = Math.min(0.5, Math.max(0.13, 0.58 - d / 850));
      const hit = R.chance(hitChance);
      const ex = target.x + (hit ? 0 : R.range(-46, 46));
      const ey = target.y + (hit ? 0 : R.range(-46, 46));
      tracer(c.x, c.y, ex, ey, '#ffd23f');
      burst(c.x + Math.cos(c.angle) * 16, c.y + Math.sin(c.angle) * 16, '#ffb703', 2, 60);
      if (hit) events = hurtPlayer(POLICE.shootDamage, events);
    }
    return events;
  }

  // ---------- player ----------
  function playerShoot(events) {
    const p = state.player;
    p.shootCd = GUN.cooldown;
    state.stats.shots += 1;
    const aim = Math.atan2(state.aimY - p.y, state.aimX - p.x) + R.range(-GUN.spread, GUN.spread);
    let bestT = null, bestD = GUN.range;
    const consider = (obj, r, kind) => {
      const d = Math.hypot(obj.x - p.x, obj.y - p.y);
      if (d > GUN.range + r) return;
      const diff = angleDiff(aim, Math.atan2(obj.y - p.y, obj.x - p.x));
      if (diff < Math.atan(r / Math.max(24, d)) + 0.015 && d < bestD) { bestD = d; bestT = { obj, kind }; }
    };
    for (const ped of state.peds) if (!ped.dead) consider(ped, 15, 'ped');
    for (const cop of state.cops) if (!cop.dead) consider(cop, 15, 'cop');
    for (const car of state.cars) if (car !== p.inCar) consider(car, 36, 'car');
    const mx = p.x + Math.cos(aim) * 18, my = p.y + Math.sin(aim) * 18;
    if (bestT) {
      tracer(mx, my, bestT.obj.x, bestT.obj.y, '#ffe66d');
      burst(bestT.obj.x, bestT.obj.y, '#ffd23f', 3, 90);
      if (bestT.kind === 'ped') events = hurtPed(bestT.obj, GUN.damage, events);
      else if (bestT.kind === 'cop') events = hurtCop(bestT.obj, GUN.damage, events);
      else {
        bestT.obj.health -= GUN.damage;
        if (bestT.obj.kind === 'police') crime(WANTED.hitCop * 0.5, bestT.obj.x, bestT.obj.y);
        burst(bestT.obj.x, bestT.obj.y, '#cfd4dc', 4, 110);
      }
    } else {
      tracer(mx, my, p.x + Math.cos(aim) * GUN.range, p.y + Math.sin(aim) * GUN.range, '#ffe66d');
    }
    crime(WANTED.shootAt, p.x, p.y);
    for (const ped of state.peds) if (!ped.dead && dist(ped, p) < 280) { ped.fleeT = Math.max(ped.fleeT, 2.2); if (ped.state !== 'stand') ped.state = 'flee'; }
    return events | EV.SHOT;
  }

  function playerPunch(events) {
    const p = state.player;
    p.punchCd = PLAYER.punchCooldown;
    const aim = Math.atan2(state.aimY - p.y, state.aimX - p.x);
    let hit = false;
    const swing = (w, isCop) => {
      if (w.dead) return;
      const d = Math.hypot(w.x - p.x, w.y - p.y);
      if (d > PLAYER.punchRange + 12) return;
      if (angleDiff(aim, Math.atan2(w.y - p.y, w.x - p.x)) > 1.05) return;
      hit = true;
      const kb = { x: w.x + Math.cos(aim) * 16, y: w.y + Math.sin(aim) * 16 };
      const resolved = collideWorld(city, kb, 13);
      w.x = resolved.x; w.y = resolved.y;
      if (isCop) events = hurtCop(w, PLAYER.punchDamage, events);
      else events = hurtPed(w, PLAYER.punchDamage, events);
      burst(w.x, w.y, '#ffd23f', 4, 90);
    };
    for (const ped of state.peds) swing(ped, false);
    for (const cop of state.cops) swing(cop, true);
    return events | EV.PUNCH;
  }

  function enterCar(car, events) {
    const p = state.player;
    if (car.health <= 0) { toast('This car is wrecked', 'Find another ride.'); return events; }
    if (car.driver === 'ai') {
      // Carjacking: the driver bails out and runs.
      const driver = makePed(car.x + R.range(-20, 20), car.y + R.range(-20, 20));
      driver.fleeT = 3;
      driver.state = 'flee';
      crime(car.speed > 30 ? WANTED.stealMoving : WANTED.carjack, car.x, car.y);
      state.stats.stolen += 1;
      car.driver = 'none';
      car.kind = 'parked';
      car.ai = null;
    } else if (car.kind === 'police') {
      crime(WANTED.hitCop * 0.8, car.x, car.y);
      state.stats.stolen += 1;
    } else if (!car.missionTarget) {
      // Any other unoccupied car — parked or abandoned — is a theft if seen.
      crime(WANTED.carjack, car.x, car.y);
      state.stats.stolen += 1;
    }
    p.inCar = car;
    car.driver = 'player';
    return events | EV.ENTER;
  }

  function exitCar(events) {
    const p = state.player;
    const car = p.inCar;
    if (!car) return events;
    const side = { x: car.x + Math.cos(car.angle + Math.PI / 2) * -42, y: car.y + Math.sin(car.angle + Math.PI / 2) * -42 };
    const resolved = collideWorld(city, side, PLAYER.radius);
    p.x = resolved.x; p.y = resolved.y;
    car.driver = 'none';
    if (car.kind === 'traffic') car.kind = 'parked';
    car.speed = 0;
    p.inCar = null;
    return events | EV.EXIT;
  }

  function driveCar(dt, control, events) {
    const p = state.player;
    const car = p.inCar;
    const fwd = (control.my < 0 ? 1 : 0) - (control.my > 0 ? 1 : 0);
    const steer = control.mx;
    const healthF = 0.45 + 0.55 * Math.max(0, car.health) / CAR.health;
    if (car.health <= 0) {
      car.speed = 0;
    } else if (fwd > 0) {
      car.speed = Math.min(CAR.maxSpeed * healthF, car.speed + CAR.accel * dt);
    } else if (fwd < 0) {
      car.speed = car.speed > 12 ? Math.max(0, car.speed - CAR.brake * dt) : Math.max(-CAR.maxReverse, car.speed - CAR.accel * 0.7 * dt);
    }
    car.speed -= car.speed * CAR.drag * dt;
    if (Math.abs(car.speed) < 2 && fwd === 0) car.speed = 0;
    const speedF = Math.max(-1, Math.min(1, car.speed / 170));
    car.angle += steer * CAR.turnRate * speedF * dt * (car.speed < 0 ? -1 : 1);
    const ox = car.x, oy = car.y;
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    const resolved = collideWorld(city, { x: car.x, y: car.y }, 30);
    if (Math.hypot(resolved.x - car.x, resolved.y - car.y) > 2) {
      if (Math.abs(car.speed) > 200) {
        car.health -= 12;
        burst(car.x, car.y, '#ffb703', 8, 160);
        events |= EV.CRASH;
      }
      car.speed *= -0.25;
      car.x = ox; car.y = oy;
      const retry = collideWorld(city, { x: car.x, y: car.y }, 30);
      car.x = retry.x; car.y = retry.y;
    } else {
      car.x = resolved.x; car.y = resolved.y;
    }
    p.x = car.x; p.y = car.y;
    p.angle = car.angle;
    // Running people down.
    if (Math.abs(car.speed) > 105) {
      for (const ped of state.peds) {
        if (!ped.dead && Math.hypot(ped.x - car.x, ped.y - car.y) < 52) {
          events = hurtPed(ped, 100, events);
          burst(ped.x, ped.y, '#ef476f', 8, 150);
          car.speed *= 0.82;
        }
      }
      for (const cop of state.cops) {
        if (!cop.dead && Math.hypot(cop.x - car.x, cop.y - car.y) < 52) {
          events = hurtCop(cop, 100, events);
          burst(cop.x, cop.y, '#ef476f', 8, 150);
          car.speed *= 0.8;
        }
      }
    }
    return events;
  }

  function carCollisions(dt, events) {
    const cars = state.cars;
    for (let i = 0; i < cars.length; i += 1) {
      for (let j = i + 1; j < cars.length; j += 1) {
        const a = cars[i], b = cars[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d >= 62 || d === 0) continue;
        const push = (62 - d) / 2;
        const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
        if (a.driver !== 'player') { a.x -= nx * push; a.y -= ny * push; }
        if (b.driver !== 'player') { b.x += nx * push; b.y += ny * push; }
        const rel = Math.abs(a.speed - b.speed);
        if (rel > 130) {
          a.health -= 8; b.health -= 8;
          if (a.driver === 'player' || b.driver === 'player') {
            events |= EV.CRASH;
            burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffb703', 7, 150);
            const other = a.driver === 'player' ? b : a;
            if (other.kind === 'police') crime(WANTED.hitCop * 0.5, other.x, other.y);
            if (other.driver === 'ai') { other.driver = 'none'; other.kind = 'parked'; other.ai = null; const d2 = makePed(other.x, other.y); d2.fleeT = 3; d2.state = 'flee'; }
          }
          a.speed *= 0.55; b.speed *= 0.55;
        }
      }
    }
    return events;
  }

  // ---------- missions ----------
  function checkMission(events) {
    if (state.mission.done || state.over) return events;
    const step = currentStep();
    if (!step) return events;
    const p = state.player;
    const target = stepTarget(step);
    switch (step.type) {
      case 'goto':
        if (target && Math.hypot(p.x - target.x, p.y - target.y) < step.radius) events = completeStep(events);
        break;
      case 'steal':
        if (state.targetCar && p.inCar === state.targetCar) events = completeStep(events);
        break;
      case 'deliverCar':
        if (state.targetCar && p.inCar === state.targetCar && target && Math.hypot(p.x - target.x, p.y - target.y) < step.radius) {
          state.targetCar.missionTarget = false;
          state.targetCar.kind = 'parked';
          events = completeStep(events);
        }
        break;
      case 'pickup':
        if (!p.inCar && target && Math.hypot(p.x - target.x, p.y - target.y) < step.radius) {
          state.heat = Math.max(state.heat, 215);
          toast('The package was hot!', 'Every patrol in the bay just heard your name.');
          events = completeStep(events);
        }
        break;
      case 'channel':
        if (!p.inCar && target && Math.hypot(p.x - target.x, p.y - target.y) < step.radius) {
          state.mission.channel += STEP_DT;
          state.objectiveSub = `${Math.ceil(step.seconds - state.mission.channel)}…`;
          if (state.mission.channel >= step.seconds) {
            state.heat = Math.max(state.heat, 420);
            toast('Alarm!', 'Four stars. Run.');
            events = completeStep(events);
          }
        } else {
          state.mission.channel = Math.max(0, state.mission.channel - STEP_DT);
          refreshObjective();
        }
        break;
      case 'kill':
        if (state.mission.kills >= step.count) events = completeStep(events);
        break;
      case 'escape':
        if (state.heat <= 20) events = completeStep(events);
        break;
      default:
        break;
    }
    return events;
  }

  // ---------- main step ----------
  const STEP_DT = 1 / 60;
  function step(dt, control, ambient = false) {
    let events = 0;
    state.time += dt;
    state.hour = (state.hour + dt / DAY.secondsPerHour) % 24;
    for (let i = state.toasts.length - 1; i >= 0; i -= 1) {
      state.toasts[i].t -= dt;
      if (state.toasts[i].t <= 0) state.toasts.splice(i, 1);
    }
    for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
      state.bullets[i].life -= dt;
      if (state.bullets[i].life <= 0) state.bullets.splice(i, 1);
    }
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const pt = state.particles[i];
      pt.life -= dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.92; pt.vy *= 0.92;
      if (pt.life <= 0) state.particles.splice(i, 1);
    }
    if (state.over) return events;

    // Traffic & parked life always runs (also behind the title screen).
    for (const car of state.cars) {
      if (car.driver === 'ai' && car.ai) updateTrafficCar(car, dt);
      else if (car.kind === 'police' && car.mode === 'patrol' && car.ai) updateTrafficCar(car, dt);
      if (car.health < 42 && car.health > 0 && R.chance(0.3)) {
        state.particles.push({ x: car.x + R.range(-8, 8), y: car.y - 6, vx: R.range(-6, 6), vy: R.range(-26, -14), life: R.range(0.4, 0.9), color: 'rgba(40,40,48,0.7)', r: R.range(3, 6) });
      }
    }
    for (const ped of state.peds) events = updatePed(ped, dt, events);
    if (ambient) return events;

    const p = state.player;
    if (p.punchCd > 0) p.punchCd -= dt;
    if (p.shootCd > 0) p.shootCd -= dt;
    if (p.hurtT > 0) p.hurtT -= dt;
    state.aimX = control.aimX;
    state.aimY = control.aimY;

    if (control.interact) {
      if (p.inCar) events = exitCar(events);
      else {
        let best = null, bestD = PLAYER.enterRange + 30;
        for (const car of state.cars) {
          const d = Math.hypot(car.x - p.x, car.y - p.y);
          if (d < bestD) { bestD = d; best = car; }
        }
        // The mission car wins ties: it is the one the player came for.
        if (state.targetCar && state.targetCar !== best) {
          const d = Math.hypot(state.targetCar.x - p.x, state.targetCar.y - p.y);
          if (d < PLAYER.enterRange + 30) best = state.targetCar;
        }
        if (best) events = enterCar(best, events);
      }
    }

    if (p.inCar) {
      events = driveCar(dt, control, events);
    } else {
      const mx = control.mx, my = control.my;
      const moving = mx !== 0 || my !== 0;
      if (moving) {
        const len = Math.hypot(mx, my);
        const speed = control.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
        p.x += (mx / len) * speed * dt;
        p.y += (my / len) * speed * dt;
        p.phase += speed * dt * 0.055;
        const resolved = collideWorld(city, { x: p.x, y: p.y }, PLAYER.radius);
        p.x = resolved.x; p.y = resolved.y;
      }
      p.angle = Math.atan2(state.aimY - p.y, state.aimX - p.x);
      if (control.attack) {
        if (p.hasGun && p.shootCd <= 0) events = playerShoot(events);
        else if (!p.hasGun && p.punchCd <= 0) events = playerPunch(events);
        else if (p.hasGun && p.shootCd <= 0) events = playerShoot(events);
      }
      // The clinic heals anyone who reaches its door.
      if (Math.hypot(p.x - places.clinic.x, p.y - places.clinic.y) < 64 && p.health < PLAYER.health) {
        p.health = Math.min(PLAYER.health, p.health + 26 * dt);
      }
    }

    events = carCollisions(dt, events);

    // Wanted bookkeeping.
    const newStars = state.heat <= 0 ? 0 : Math.min(WANTED.max, Math.ceil(state.heat / 100));
    if (newStars !== state.stars) state.stars = newStars;
    let seen = false;
    for (const c of state.cops) {
      if (!c.dead && Math.hypot(c.x - p.x, c.y - p.y) < POLICE.sightRange && lineOfSight(city, p.x, p.y, c.x, c.y)) { seen = true; break; }
    }
    if (!seen) {
      for (const car of state.cars) {
        if (car.kind === 'police' && car.driver === 'cop' && Math.hypot(car.x - p.x, car.y - p.y) < POLICE.sightRange && lineOfSight(city, p.x, p.y, car.x, car.y)) { seen = true; break; }
      }
    }
    if (seen) state.seenTimer = 0;
    else {
      state.seenTimer += dt;
      if (state.seenTimer > WANTED.hideTime && state.heat > 0) {
        state.heat = Math.max(0, state.heat - WANTED.decayPerSecond * dt * (state.seenTimer > WANTED.hideTime * 2 ? 2 : 1));
      }
    }

    policeWanted();
    for (const car of state.cars) {
      if (car.kind === 'police' && car.mode === 'chase' && car.driver === 'cop') updatePoliceCar(car, dt);
    }
    for (let i = state.cops.length - 1; i >= 0; i -= 1) {
      const c = state.cops[i];
      events = updateCop(c, dt, events);
      if (!c.dead && state.stars === 0 && Math.hypot(c.x - p.x, c.y - p.y) > 700) state.cops.splice(i, 1);
    }

    // Bust meter: a cop close to a slow player fills it.
    const playerSpeed = p.inCar ? Math.abs(p.inCar.speed) : (control.mx !== 0 || control.my !== 0 ? (control.run ? PLAYER.runSpeed : PLAYER.walkSpeed) : 0);
    let copClose = false;
    for (const c of state.cops) if (!c.dead && Math.hypot(c.x - p.x, c.y - p.y) < POLICE.bustRadius) { copClose = true; break; }
    if (copClose && playerSpeed < 70 && state.stars >= 1) state.bust = Math.min(1, state.bust + dt / POLICE.bustTime);
    else state.bust = Math.max(0, state.bust - dt * 0.8);
    if (state.bust >= 1 && !state.over) {
      state.over = 'busted';
      events |= EV.BUSTED;
    }

    // Pickups.
    for (let i = state.pickups.length - 1; i >= 0; i -= 1) {
      const pk = state.pickups[i];
      pk.life -= dt;
      if (pk.life <= 0) { state.pickups.splice(i, 1); continue; }
      if (Math.hypot(pk.x - p.x, pk.y - p.y) < 24) {
        if (pk.kind === 'money') {
          state.money += pk.amount;
          state.earned += pk.amount;
          events |= EV.CASH;
        } else {
          p.health = Math.min(PLAYER.health, p.health + pk.amount);
          events |= EV.PICKUP;
        }
        state.pickups.splice(i, 1);
      }
    }

    events = checkMission(events);
    if (state.objective && currentStep() && currentStep().type !== 'channel') {
      const t = stepTarget(currentStep());
      if (t) state.objective = t;
    }
    return events;
  }

  function respawn() {
    const kind = state.over;
    const p = state.player;
    const fine = kind === 'busted' ? Math.min(state.money, 100 + Math.floor(state.money * 0.1)) : Math.min(state.money, 60 + Math.floor(state.money * 0.08));
    state.money -= fine;
    if (p.inCar) { p.inCar.driver = 'none'; if (p.inCar.kind === 'traffic') p.inCar.kind = 'parked'; p.inCar = null; }
    const at = kind === 'busted' ? places.policeStation : places.clinic;
    p.x = at.x; p.y = at.y + 24;
    p.health = PLAYER.health;
    state.heat = 0;
    state.stars = 0;
    state.bust = 0;
    state.cops = [];
    state.cars = state.cars.filter((c) => c.kind !== 'police');
    state.over = null;
    // Restart the current mission from its first step, clearing mission actors.
    state.peds = state.peds.filter((pd) => !pd.mission);
    if (!state.mission.done && state.mission.index < MISSIONS.length) {
      if (state.targetCar && state.mission.index === 0) {
        const lot = places.carLot.lot;
        const spot = lot && lot.spots.length ? lot.spots[Math.floor(lot.spots.length / 2)] : { x: places.carLot.x, y: places.carLot.y, angle: 0 };
        state.targetCar.x = spot.x; state.targetCar.y = spot.y; state.targetCar.angle = spot.angle;
        state.targetCar.health = CAR.health; state.targetCar.driver = null; state.targetCar.missionTarget = true; state.targetCar.kind = 'mission';
      }
      state.mission.step = 0;
      startStep();
      toast(kind === 'busted' ? 'Busted' : 'Wasted', `Fine $${fine}. The job restarts — ${MISSIONS[state.mission.index].title}.`);
    } else {
      toast(kind === 'busted' ? 'Busted' : 'Wasted', `Fine $${fine}.`);
    }
  }

  function serialize() {
    const p = state.player;
    return {
      money: state.money, earned: state.earned, missionIndex: state.mission.index,
      hasGun: p.hasGun, hour: state.hour, px: p.x, py: p.y, stats: state.stats,
      done: state.mission.done,
    };
  }

  return { state, reset, step, respawn, serialize, toast };
}
