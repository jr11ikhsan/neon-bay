// NEON BAY — the simulation. Everything that moves or can be hurt lives here:
// the player on foot and behind the wheel, traffic that follows the lanes,
// pedestrians who mind their business until they don't, police cars and foot
// cops driven by a five-star wanted system, fists and a pistol, pickups, and
// the four-mission story engine that reads missions.js. This module is kept
// free of DOM calls so it can be stepped headlessly; the loop in main.js feeds
// it a controls object and the audio facade, and render.js only reads it.

import {
  WORLD, ROADS, PLAYER, GUN, CAR, TRAFFIC, PEDS, POLICE, WANTED, DAY,
} from './config.js';
import { createCity, collideWorld, lineOfSight, isOnRoad } from './city.js';
import { createRandom, rngTools } from './random.js';
import { MISSIONS } from './missions.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

function angleWrap(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
function angleTurn(current, target, maxStep) {
  const d = angleWrap(target - current);
  return current + clamp(d, -maxStep, maxStep);
}

const CAR_PAINTS = ['#c94f6d', '#4f7dc9', '#53b06a', '#c9c9d1', '#7a4fc9', '#c97b2d', '#3fb6b2', '#8a8f98', '#d1d5db', '#374151'];
const PED_SHIRTS = ['#e07a5f', '#81b29a', '#f2cc8f', '#6d8ea0', '#bc6c25', '#9b5de5', '#00bbf9', '#f15bb5', '#e5e5e5', '#588157'];

function sfx(audio, name, ...args) {
  if (audio && typeof audio[name] === 'function') audio[name](...args);
}

export function createWorld(seed = 1) {
  const random = createRandom(seed * 100003 + 77);
  const R = rngTools(random);
  const city = createCity(createRandom(seed * 7919 + 13));

  const world = {
    city,
    seed,
    elapsed: 0,
    timeHours: DAY.startHour,
    money: 0,
    heat: 0,
    unseenFor: 99, // seconds since any cop last had eyes on the player
    bust: 0, // 0..1 arrest progress
    fate: null, // null | 'busted' | 'wasted'
    fateTimer: 0,
    storyDone: false,
    storyDoneTimer: 0,
    carrying: false,
    toasts: [],
    banner: null,
    particles: [],
    tracers: [],
    pickups: [],
    cars: [],
    peds: [],
    cops: [],
    stats: { stolen: 0, kills: 0, missions: 0, shotsFired: 0 },
    onMissionComplete: null,
    mission: null,
    missionCar: null,
    player: null,
  };

  const player = {
    x: 636, y: 2952, angle: -Math.PI / 2,
    health: PLAYER.health, car: null, hasGun: false,
    punchCd: 0, shootCd: 0, hurtT: 0, dead: false,
  };
  world.player = player;

  // ---------- spawning ----------

  function laneFor(axis, road, dir) {
    // Right-hand traffic: your lane sits on your right side of the centre line.
    if (axis === 'v') return { x: road + (dir > 0 ? -ROADS.laneOffset : ROADS.laneOffset) };
    return { y: road + (dir > 0 ? ROADS.laneOffset : -ROADS.laneOffset) };
  }

  function spawnTrafficCar() {
    const axis = R.chance(0.5) ? 'v' : 'h';
    const road = axis === 'v' ? R.pick(ROADS.verticalX) : R.pick(ROADS.horizontalY);
    const dir = R.chance(0.5) ? 1 : -1;
    const lane = laneFor(axis, road, dir);
    const along = axis === 'v' ? R.range(80, WORLD.height - 80) : R.range(80, WORLD.beachX - 80);
    const car = {
      kind: 'traffic', driver: 'traffic',
      x: axis === 'v' ? lane.x : along,
      y: axis === 'v' ? along : lane.y,
      angle: axis === 'v' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI),
      speed: 0, health: CAR.health, color: R.pick(CAR_PAINTS),
      axis, road, dir, turnCd: R.range(0, 2), stuckT: 0, reverseT: 0, copOut: false,
    };
    if (dist(car.x, car.y, player.x, player.y) < 500) { car.x += 700; car.y += 500; }
    world.cars.push(car);
    return car;
  }

  function spawnParkedCars() {
    const spots = [];
    for (const lot of city.lots) for (const s of lot.spots) spots.push(s);
    // Shuffle deterministically, then fill a slice of the spots.
    for (let i = spots.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    const n = Math.min(TRAFFIC.parkedCount, spots.length);
    for (let i = 0; i < n; i += 1) {
      const s = spots[i];
      world.cars.push({
        kind: 'parked', driver: null, x: s.x, y: s.y, angle: s.angle,
        speed: 0, health: CAR.health, color: R.pick(CAR_PAINTS),
        axis: null, road: 0, dir: 1, turnCd: 0, stuckT: 0, reverseT: 0, copOut: false,
      });
    }
    // A handful of kerbside cars along the avenues.
    for (let i = 0; i < 8; i += 1) {
      const vx = R.pick(ROADS.verticalX);
      world.cars.push({
        kind: 'parked', driver: null,
        x: vx + (R.chance(0.5) ? -1 : 1) * (ROADS.width / 2 - 24),
        y: R.range(140, WORLD.height - 140),
        angle: R.chance(0.5) ? Math.PI / 2 : -Math.PI / 2,
        speed: 0, health: CAR.health, color: R.pick(CAR_PAINTS),
        axis: null, road: 0, dir: 1, turnCd: 0, stuckT: 0, reverseT: 0, copOut: false,
      });
    }
  }

  function spawnMissionCoupe() {
    const lotPlace = city.places.carLot;
    let x = lotPlace.x, y = lotPlace.y, angle = Math.PI / 2;
    if (lotPlace.lot && lotPlace.lot.spots.length > 2) {
      const s = lotPlace.lot.spots[2];
      x = s.x; y = s.y; angle = s.angle;
    }
    const coupe = {
      kind: 'mission', driver: null, x, y, angle,
      speed: 0, health: CAR.health, color: '#ffb703',
      axis: null, road: 0, dir: 1, turnCd: 0, stuckT: 0, reverseT: 0, copOut: false,
    };
    world.cars.push(coupe);
    world.missionCar = coupe;
    return coupe;
  }

  function spawnPed(x, y, dealer = false) {
    const ped = {
      x, y, angle: R.range(0, TAU), hp: dealer ? 70 : 40,
      dealer, dead: false, deadT: 0, state: 'walk',
      tx: x, ty: y, retarget: R.range(0, 3), fleeT: 0, fleeX: 0, fleeY: 0,
      shootCd: R.range(0.6, 1.6), shirt: dealer ? '#20242c' : R.pick(PED_SHIRTS),
      speedJitter: R.range(0.85, 1.15),
    };
    world.peds.push(ped);
    return ped;
  }

  function scatterPeds() {
    for (let i = 0; i < PEDS.count; i += 1) {
      // Sidewalk life: near a random intersection, offset to a corner.
      const cross = R.pick(city.intersections);
      const sx = R.chance(0.5) ? -1 : 1, sy = R.chance(0.5) ? -1 : 1;
      const p = { x: cross.x + sx * (ROADS.width / 2 + R.range(14, 60)), y: cross.y + sy * (ROADS.width / 2 + R.range(14, 60)) };
      collideWorld(city, p, 12);
      spawnPed(p.x, p.y, false);
    }
    // Beach strollers.
    for (let i = 0; i < 6; i += 1) {
      spawnPed(R.range(WORLD.beachX + 40, WORLD.waterX - 60), R.range(120, WORLD.height - 120), false);
    }
  }

  for (let i = 0; i < TRAFFIC.count; i += 1) spawnTrafficCar();
  spawnParkedCars();
  spawnMissionCoupe();
  scatterPeds();

  // ---------- wanted ----------

  world.stars = () => (world.heat <= 0 ? 0 : clamp(Math.ceil(world.heat / 100), 1, WANTED.max));

  function witnessed(x, y, radius = 430) {
    for (const ped of world.peds) {
      if (!ped.dead && dist(x, y, ped.x, ped.y) < radius && lineOfSight(city, x, y, ped.x, ped.y)) return true;
    }
    for (const cop of world.cops) {
      if (!cop.dead && dist(x, y, cop.x, cop.y) < radius + 140) return true;
    }
    for (const car of world.cars) {
      if (car.kind === 'police' && dist(x, y, car.x, car.y) < radius + 160) return true;
    }
    return world.stars() > 0 && world.unseenFor < 2;
  }

  world.crime = (points, x = player.x, y = player.y) => {
    const seen = witnessed(x, y);
    world.heat += seen ? points : Math.round(points * 0.4);
    if (seen) world.unseenFor = 0;
  };

  world.toast = (text, seconds = 3.4) => {
    world.toasts.push({ text, ttl: seconds });
    if (world.toasts.length > 3) world.toasts.shift();
  };

  function showBanner(title, sub, seconds = 3.6) {
    world.banner = { title, sub, ttl: seconds };
  }

  // ---------- damage & death ----------

  function burst(x, y, color, n, speed = 130) {
    for (let i = 0; i < n; i += 1) {
      const a = random() * TAU;
      const v = speed * (0.3 + random() * 0.7);
      world.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        ttl: 0.35 + random() * 0.4, maxT: 0.7, color, size: 2 + random() * 3,
      });
    }
  }

  function dropLoot(ped) {
    if (random() < 0.55) {
      world.pickups.push({ x: ped.x + R.range(-8, 8), y: ped.y + R.range(-8, 8), kind: 'money', value: R.int(8, 42), ttl: 40, bob: random() * TAU });
    } else if (random() < 0.3) {
      world.pickups.push({ x: ped.x, y: ped.y, kind: 'snack', value: 25, ttl: 40, bob: random() * TAU });
    }
  }

  function killPed(ped, byPlayer) {
    if (ped.dead) return;
    ped.dead = true;
    ped.deadT = 0;
    burst(ped.x, ped.y, '#c9184a', 10);
    dropLoot(ped);
    if (byPlayer) {
      world.stats.kills += 1;
      if (ped.dealer && world.mission && world.mission.stepType === 'kill') {
        world.mission.kills += 1;
        world.toast(`Dealer down — ${world.mission.kills} of ${world.mission.stepCount}`);
      }
      world.crime(ped.dealer ? WANTED.killPed * 0.75 : WANTED.killPed, ped.x, ped.y);
    }
  }

  function killCop(cop, byPlayer) {
    if (cop.dead) return;
    cop.dead = true;
    cop.deadT = 0;
    burst(cop.x, cop.y, '#4361ee', 10);
    if (byPlayer) {
      world.stats.kills += 1;
      world.crime(WANTED.killCop, cop.x, cop.y);
    }
  }

  world.hurtPlayer = (dmg, audio) => {
    if (world.fate) return;
    if (player.car) {
      player.car.health -= dmg * 0.55;
      player.health -= dmg * 0.3;
    } else {
      player.health -= dmg;
    }
    player.hurtT = 0.35;
    sfx(audio, 'hurt');
    if (player.health <= 0 && !world.fate) {
      player.health = 0;
      world.fate = 'wasted';
      world.fateTimer = 2.8;
      sfx(audio, 'failed');
    }
  };


  // ---------- mission engine ----------

  function placePoint(key) {
    const p = city.places[key];
    return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
  }

  function startMission(index) {
    if (index >= MISSIONS.length) {
      world.mission = null;
      world.storyDone = true;
      world.storyDoneTimer = 6;
      return;
    }
    const def = MISSIONS[index];
    world.mission = {
      index, def, stepIndex: 0, stepType: null, stepCount: 0,
      kills: 0, channelT: 0, started: false,
    };
    showBanner(def.title, def.intro, 4.6);
    startStep();
  }

  function startStep() {
    const m = world.mission;
    if (!m) return;
    const step = m.def.steps[m.stepIndex];
    m.stepType = step.type;
    m.stepCount = step.count || 0;
    m.kills = 0;
    m.channelT = 0;
    if (step.onStart === 'spawnDealers') {
      for (const spot of city.places.dealers) {
        if (!world.peds.some((p) => p.dealer && !p.dead && dist(p.x, p.y, spot.x, spot.y) < 30)) {
          spawnPed(spot.x, spot.y, true);
        }
      }
      world.toast('Three dealers are working the beach');
    }
  }

  function completeStep(audio) {
    const m = world.mission;
    if (!m) return;
    const step = m.def.steps[m.stepIndex];
    if (step.type === 'pickup') {
      world.carrying = true;
      world.heat = Math.max(world.heat, 200);
      world.unseenFor = 0;
      world.toast('The package is hot — the whole bay saw that');
      sfx(audio, 'pickup');
    }
    if (step.type === 'channel') {
      world.heat = Math.max(world.heat, 400);
      world.unseenFor = 0;
      world.toast('Alarm! Every unit in the bay is coming');
    }
    m.stepIndex += 1;
    if (m.stepIndex >= m.def.steps.length) {
      completeMission(audio);
    } else {
      startStep();
    }
  }

  function completeMission(audio) {
    const m = world.mission;
    if (!m) return;
    world.money += m.def.reward;
    world.stats.missions += 1;
    if (m.index === 0 && !player.hasGun) {
      player.hasGun = true;
      world.toast('Lucho left you a pistol — mouse to aim, click to fire');
    }
    if (m.index === 1) world.carrying = false;
    showBanner('Mission complete', `${m.def.title} — +$${m.def.reward}`, 3.8);
    sfx(audio, 'mission');
    sfx(audio, 'cash');
    const next = m.index + 1;
    if (typeof world.onMissionComplete === 'function') world.onMissionComplete(next);
    startMission(next);
    if (world.storyDone) showBanner('NEON BAY — Story Complete', 'The bay is yours. Free roam.', 6);
  }

  world.objectiveText = () => {
    if (world.storyDone) return 'Free roam — the bay is yours';
    const m = world.mission;
    if (!m) return '';
    const step = m.def.steps[m.stepIndex];
    if (!step) return '';
    if (step.type === 'kill') return `${step.text} (${m.kills}/${step.count})`;
    if (step.type === 'channel') return `${step.text} — hold the door ${Math.floor((m.channelT / (step.seconds || 3)) * 100)}%`;
    return step.text;
  };

  world.objectiveTarget = () => {
    const m = world.mission;
    if (!m || world.storyDone) return null;
    const step = m.def.steps[m.stepIndex];
    if (!step) return null;
    switch (step.type) {
      case 'goto': case 'pickup': case 'channel': return placePoint(step.place);
      case 'steal': return world.missionCar ? { x: world.missionCar.x, y: world.missionCar.y } : null;
      case 'deliverCar': return placePoint(step.place);
      case 'kill': {
        let best = null, bd = Infinity;
        for (const p of world.peds) {
          if (p.dealer && !p.dead) {
            const d = dist2(player.x, player.y, p.x, p.y);
            if (d < bd) { bd = d; best = p; }
          }
        }
        return best ? { x: best.x, y: best.y } : null;
      }
      default: return null; // escape: nowhere to go, just vanish
    }
  };

  startMission(0);

  // ---------- save / restore ----------

  world.serialize = () => ({
    money: world.money,
    missionIndex: world.mission ? world.mission.index : MISSIONS.length,
    storyDone: world.storyDone,
    hasGun: !!player.hasGun,
    x: Math.round(player.x), y: Math.round(player.y),
    health: Math.round(player.health),
    timeHours: Math.round(world.timeHours * 100) / 100,
    stats: { ...world.stats },
  });

  world.restore = (data) => {
    if (!data) return;
    world.money = data.money | 0;
    world.heat = 0;
    world.carrying = false;
    player.hasGun = !!data.hasGun;
    player.health = clamp(data.health || 100, 1, PLAYER.health);
    player.car = null;
    const p = { x: data.x || player.x, y: data.y || player.y };
    collideWorld(city, p, PLAYER.radius);
    player.x = p.x; player.y = p.y;
    world.timeHours = data.timeHours || DAY.startHour;
    if (data.stats) world.stats = { ...world.stats, ...data.stats };
    world.storyDone = !!data.storyDone;
    startMission(clamp(data.missionIndex | 0, 0, MISSIONS.length));
    if (world.storyDone) world.mission = null;
  };

  // ---------- entering / leaving cars ----------

  function nearestEnterableCar() {
    let best = null, bd = PLAYER.enterRange ** 2;
    // The mission car always wins ties: the story depends on finding it.
    const ordered = [...world.cars].sort((a, b) => (b.kind === 'mission') - (a.kind === 'mission'));
    for (const car of ordered) {
      if (car.driver === 'player') continue;
      const d = dist2(player.x, player.y, car.x, car.y);
      if (d < bd || (car.kind === 'mission' && d < (PLAYER.enterRange + 26) ** 2 && !best)) {
        bd = d; best = car;
      }
    }
    return best;
  }

  function enterCar(car, audio) {
    if (car.driver === 'traffic') {
      // Carjacking a moving car: the driver bails and runs.
      const bail = spawnPed(car.x + 20, car.y + 10, false);
      bail.state = 'flee';
      bail.fleeT = 3;
      bail.fleeX = car.x; bail.fleeY = car.y;
      world.crime(WANTED.stealMoving, car.x, car.y);
      world.toast('Carjacked!');
    } else if (car.driver === 'police') {
      world.crime(WANTED.hitCop, car.x, car.y);
    } else if (car.kind !== 'parked' || car.stolenBefore) {
      world.crime(WANTED.carjack, car.x, car.y);
    } else {
      world.crime(Math.round(WANTED.carjack * 0.7), car.x, car.y);
    }
    car.stolenBefore = true;
    car.driver = 'player';
    car.kind = car.kind === 'traffic' ? 'player' : car.kind;
    player.car = car;
    player.x = car.x; player.y = car.y;
    world.stats.stolen += 1;
    sfx(audio, 'enterCar');
  }

  function exitCar() {
    const car = player.car;
    if (!car) return;
    car.driver = car.kind === 'police' ? 'police' : null;
    if (car.kind === 'player') car.kind = 'parked';
    car.speed = 0;
    const side = { x: car.x + Math.cos(car.angle + Math.PI / 2) * -34, y: car.y + Math.sin(car.angle + Math.PI / 2) * -34 };
    collideWorld(city, side, PLAYER.radius);
    player.x = side.x; player.y = side.y;
    player.car = null;
  }

  // ---------- combat ----------

  function playerAttack(audio) {
    if (player.hasGun && player.shootCd <= 0) {
      player.shootCd = GUN.cooldown;
      world.stats.shotsFired += 1;
      sfx(audio, 'shot');
      const a = player.angle + R.range(-GUN.spread, GUN.spread);
      const x0 = player.x + Math.cos(player.angle) * 18;
      const y0 = player.y + Math.sin(player.angle) * 18;
      let hx = x0 + Math.cos(a) * GUN.range;
      let hy = y0 + Math.sin(a) * GUN.range;
      let bestT = 1;
      let hitPed = null, hitCop = null, hitCar = null;
      const consider = (tx, ty, r) => {
        const dx = tx - x0, dy = ty - y0;
        const t = (dx * Math.cos(a) + dy * Math.sin(a)) / GUN.range;
        if (t < 0 || t > bestT) return -1;
        const px = x0 + Math.cos(a) * GUN.range * t;
        const py = y0 + Math.sin(a) * GUN.range * t;
        if (dist(px, py, tx, ty) > r + 6) return -1;
        if (!lineOfSight(city, x0, y0, tx, ty)) return -1;
        return t;
      };
      for (const ped of world.peds) {
        if (ped.dead) continue;
        const t = consider(ped.x, ped.y, 13);
        if (t >= 0) { bestT = t; hitPed = ped; hitCop = null; hitCar = null; }
      }
      for (const cop of world.cops) {
        if (cop.dead) continue;
        const t = consider(cop.x, cop.y, 13);
        if (t >= 0) { bestT = t; hitCop = cop; hitPed = null; hitCar = null; }
      }
      for (const car of world.cars) {
        if (car === player.car) continue;
        const t = consider(car.x, car.y, 40);
        if (t >= 0) { bestT = t; hitCar = car; hitPed = null; hitCop = null; }
      }
      hx = x0 + Math.cos(a) * GUN.range * bestT;
      hy = y0 + Math.sin(a) * GUN.range * bestT;
      world.tracers.push({ x0, y0, x1: hx, y1: hy, ttl: 0.07, maxT: 0.07 });
      burst(hx, hy, '#ffd166', 3, 90);
      if (hitPed) {
        hitPed.hp -= GUN.damage;
        hitPed.state = 'flee'; hitPed.fleeT = 2.5; hitPed.fleeX = player.x; hitPed.fleeY = player.y;
        world.crime(WANTED.shootAt, hitPed.x, hitPed.y);
        if (hitPed.hp <= 0) killPed(hitPed, true);
      } else if (hitCop) {
        hitCop.hp -= GUN.damage;
        world.crime(WANTED.hitCop, hitCop.x, hitCop.y);
        if (hitCop.hp <= 0) killCop(hitCop, true);
      } else if (hitCar) {
        hitCar.health -= GUN.damage * 0.5;
        if (hitCar.kind === 'police') world.crime(WANTED.hitCop, hitCar.x, hitCar.y);
      } else if (witnessed(x0, y0, 320)) {
        world.crime(Math.round(WANTED.shootAt * 0.5), x0, y0);
      }
      // Gunfire panics nearby civilians.
      for (const ped of world.peds) {
        if (!ped.dead && !ped.dealer && dist(ped.x, ped.y, player.x, player.y) < 260) {
          ped.state = 'flee'; ped.fleeT = Math.max(ped.fleeT, 2); ped.fleeX = player.x; ped.fleeY = player.y;
        }
      }
    } else if (!player.hasGun && player.punchCd <= 0) {
      player.punchCd = PLAYER.punchCooldown;
      sfx(audio, 'punch');
      const reach = PLAYER.punchRange;
      const tx = player.x + Math.cos(player.angle) * reach * 0.7;
      const ty = player.y + Math.sin(player.angle) * reach * 0.7;
      for (const ped of world.peds) {
        if (ped.dead) continue;
        if (dist(tx, ty, ped.x, ped.y) < reach * 0.75) {
          ped.hp -= PLAYER.punchDamage;
          ped.x += Math.cos(player.angle) * 14;
          ped.y += Math.sin(player.angle) * 14;
          ped.state = 'flee'; ped.fleeT = 2; ped.fleeX = player.x; ped.fleeY = player.y;
          burst(ped.x, ped.y, '#ffe8d6', 4, 80);
          if (ped.hp <= 0) killPed(ped, true);
          else world.crime(Math.round(WANTED.shootAt * 0.8), ped.x, ped.y);
        }
      }
      for (const cop of world.cops) {
        if (cop.dead) continue;
        if (dist(tx, ty, cop.x, cop.y) < reach * 0.75) {
          cop.hp -= PLAYER.punchDamage;
          world.crime(WANTED.hitCop, cop.x, cop.y);
          if (cop.hp <= 0) killCop(cop, true);
        }
      }
    }
  }


  // ---------- police ----------

  function desiredPoliceCars() {
    const s = world.stars();
    if (s === 0 || world.fate) return 0;
    return clamp(s, 1, 4);
  }

  function spawnPoliceCar() {
    // Appear at the intersection nearest the player but well out of sight.
    let best = null, bd = Infinity;
    for (const cross of city.intersections) {
      const d = dist(cross.x, cross.y, player.x, player.y);
      if (d > 620 && d < bd) { bd = d; best = cross; }
    }
    const at = best || city.places.policeStation;
    const car = {
      kind: 'police', driver: 'police', x: at.x, y: at.y,
      angle: Math.atan2(player.y - at.y, player.x - at.x),
      speed: 0, health: CAR.health * 1.4, color: '#e8eaf2',
      axis: null, road: 0, dir: 1, turnCd: 0, stuckT: 0, reverseT: 0, copOut: false,
    };
    world.cars.push(car);
    return car;
  }

  function managePolice(dt) {
    const want = desiredPoliceCars();
    const active = world.cars.filter((c) => c.kind === 'police' && c.driver !== 'player');
    if (active.length < want) {
      world.policeSpawnCd = (world.policeSpawnCd || 0) - dt;
      if (world.policeSpawnCd <= 0) {
        spawnPoliceCar();
        world.policeSpawnCd = 1.6;
      }
    } else if (active.length > want) {
      // Extras give up: farthest one leaves the chase and despawns off-screen.
      const far = active[active.length - 1];
      if (dist(far.x, far.y, player.x, player.y) > 800) {
        world.cars.splice(world.cars.indexOf(far), 1);
        world.cops = world.cops.filter((c) => c.car !== far);
      }
    }
    // Foot cops: step out when their car is close and the player is catchable.
    for (const car of world.cars) {
      if (car.kind !== 'police' || car.driver !== 'police') continue;
      const hasCop = world.cops.some((c) => c.car === car && !c.dead);
      const d = dist(car.x, car.y, player.x, player.y);
      if (!hasCop && !car.copOut && d < 250 && (!player.car || Math.abs(player.car.speed) < 70)) {
        car.copOut = true;
        world.cops.push({
          x: car.x + 24, y: car.y, angle: 0, hp: 60, dead: false, deadT: 0,
          car, shootCd: R.range(0.5, 1.2), busting: false,
        });
      }
    }
  }

  function updatePoliceCar(car, dt) {
    const d = dist(car.x, car.y, player.x, player.y);
    let tx = player.x, ty = player.y;
    if (d > 640 || !lineOfSight(city, car.x, car.y, player.x, player.y)) {
      // Route by intersections until the player is in reach.
      let best = null, bd = Infinity;
      for (const cross of city.intersections) {
        const dd = dist2(cross.x, cross.y, player.x, player.y);
        if (dd < bd) { bd = dd; best = cross; }
      }
      if (best && d > 300) { tx = best.x; ty = best.y; }
    }
    if (player.car) {
      tx += Math.cos(player.car.angle) * player.car.speed * 0.35;
      ty += Math.sin(player.car.angle) * player.car.speed * 0.35;
    }
    const want = Math.atan2(ty - car.y, tx - car.x);
    if (car.reverseT > 0) {
      car.reverseT -= dt;
      car.speed = Math.max(car.speed - POLICE.carAccel * dt, -130);
      car.angle = angleTurn(car.angle, want + Math.PI, 1.6 * dt);
    } else {
      const top = d < 70 ? 70 : d < 130 ? POLICE.carSpeed * 0.45 : POLICE.carSpeed;
      car.speed = Math.min(car.speed + POLICE.carAccel * dt, top);
      car.angle = angleTurn(car.angle, want, 2.4 * dt);
    }
    const ox = car.x, oy = car.y;
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    const p = { x: car.x, y: car.y };
    collideWorld(city, p, 30);
    if (Math.abs(p.x - car.x) > 1 || Math.abs(p.y - car.y) > 1) {
      car.x = p.x; car.y = p.y;
      if (Math.abs(car.speed) > 200) car.health -= 4;
      car.speed *= 0.4;
    }
    // Stuck detection: throttle on but barely moving -> back out.
    if (Math.abs(car.speed) > 120 && dist(ox, oy, car.x, car.y) < 3 * dt * 60 * 0.06) {
      car.stuckT += dt;
      if (car.stuckT > 0.7) { car.reverseT = 0.55; car.stuckT = 0; }
    } else car.stuckT = Math.max(0, car.stuckT - dt);
    // Ram pressure: a hard touch on the player's car costs it some health,
    // but a grinding pursuit must not melt a car in two seconds flat.
    if (player.car && car !== player.car && dist(car.x, car.y, player.car.x, player.car.y) < 52 && Math.abs(car.speed) > 240) {
      player.car.health -= 8 * dt;
      if (random() < dt * 6) burst(player.car.x, player.car.y, '#ffd166', 2, 70);
    }
  }

  function updateFootCop(cop, dt, audio) {
    if (cop.dead) { cop.deadT += dt; return; }
    const d = dist(cop.x, cop.y, player.x, player.y);
    const playerCatchable = !player.car || Math.abs(player.car.speed) < 60;
    cop.busting = false;
    if (!playerCatchable && cop.car) {
      // Get back in the car and resume the chase on wheels.
      const cd = dist(cop.x, cop.y, cop.car.x, cop.car.y);
      if (cd < 30) {
        cop.car.copOut = false;
        world.cops.splice(world.cops.indexOf(cop), 1);
        return;
      }
      moveToward(cop, cop.car.x, cop.car.y, POLICE.footSpeed, dt);
      return;
    }
    if (d > 26) moveToward(cop, player.x, player.y, POLICE.footSpeed * (world.stars() >= 3 ? 1.08 : 1), dt);
    cop.angle = Math.atan2(player.y - cop.y, player.x - cop.x);
    // Shooting: only at 2+ stars, with line of sight.
    cop.shootCd -= dt;
    if (world.stars() >= 2 && d < POLICE.shootRange && cop.shootCd <= 0
      && lineOfSight(city, cop.x, cop.y, player.x, player.y)) {
      cop.shootCd = POLICE.shootCooldown * R.range(0.85, 1.25);
      world.tracers.push({ x0: cop.x, y0: cop.y, x1: player.x + R.range(-9, 9), y1: player.y + R.range(-9, 9), ttl: 0.07, maxT: 0.07, hostile: true });
      sfx(audio, 'shot');
      if (random() < 0.62) world.hurtPlayer(POLICE.shootDamage, audio);
    }
    // Arrest pressure.
    if (!player.car && d < POLICE.bustRadius && Math.abs(world.playerSpeed || 0) < 60) cop.busting = true;
  }

  function moveToward(unit, tx, ty, speed, dt) {
    const a = Math.atan2(ty - unit.y, tx - unit.x);
    unit.angle = angleTurn(unit.angle || 0, a, 8 * dt);
    const p = { x: unit.x + Math.cos(a) * speed * dt, y: unit.y + Math.sin(a) * speed * dt };
    collideWorld(city, p, 12);
    unit.x = p.x; unit.y = p.y;
  }

  // ---------- traffic & parked ----------

  function obstacleAhead(car, lookDist) {
    const fx = car.x + Math.cos(car.angle) * lookDist;
    const fy = car.y + Math.sin(car.angle) * lookDist;
    for (const other of world.cars) {
      if (other === car) continue;
      if (dist(fx, fy, other.x, other.y) < 44) return true;
    }
    for (const ped of world.peds) {
      if (!ped.dead && dist(fx, fy, ped.x, ped.y) < 30) return true;
    }
    if (player.car !== car && dist(fx, fy, player.x, player.y) < 34) return true;
    return false;
  }

  function updateTrafficCar(car, dt) {
    const blocked = obstacleAhead(car, 86);
    const target = blocked ? 0 : TRAFFIC.speed;
    car.speed += clamp(target - car.speed, -CAR.brake * dt, CAR.accel * 0.6 * dt);
    if (car.axis === 'v') car.y += car.dir * car.speed * dt;
    else car.x += car.dir * car.speed * dt;
    car.turnCd -= dt;
    // Turning: when the centre crosses an intersection line, sometimes swing onto it.
    const crossLines = car.axis === 'v' ? ROADS.horizontalY : ROADS.verticalX;
    const along = car.axis === 'v' ? car.y : car.x;
    for (const line of crossLines) {
      if (Math.abs(along - line) < Math.abs(car.speed) * dt + 2 && car.turnCd <= 0) {
        if (random() < 0.38) {
          const newDir = R.chance(0.5) ? 1 : -1;
          if (car.axis === 'v') {
            car.axis = 'h'; car.road = line; car.dir = newDir;
            car.y = line + (newDir > 0 ? ROADS.laneOffset : -ROADS.laneOffset);
            car.angle = newDir > 0 ? 0 : Math.PI;
          } else {
            car.axis = 'v'; car.road = line; car.dir = newDir;
            car.x = line + (newDir > 0 ? -ROADS.laneOffset : ROADS.laneOffset);
            car.angle = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
          }
          car.turnCd = 2.5;
        } else car.turnCd = 0.4;
        break;
      }
    }
    // Despawn-and-respawn at the world edge keeps traffic flowing forever.
    if (car.x < -80 || car.x > WORLD.width + 80 || car.y < -80 || car.y > WORLD.height + 80) {
      const fresh = spawnTrafficCar();
      world.cars.splice(world.cars.indexOf(fresh), 1);
      Object.assign(car, fresh, { x: car.x, y: car.y });
      if (car.axis === 'v') { car.x = laneFor('v', car.road, car.dir).x; car.y = car.dir > 0 ? -60 : WORLD.height + 60; }
      else { car.y = laneFor('h', car.road, car.dir).y; car.x = car.dir > 0 ? -60 : WORLD.beachX + 40; }
      car.angle = car.axis === 'v' ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.dir > 0 ? 0 : Math.PI);
    }
    if (car.x > WORLD.waterX - 50 && car.axis === 'h') { car.dir = -1; car.angle = Math.PI; car.y = car.road - ROADS.laneOffset; }
  }

  // ---------- pedestrians & dealers ----------

  function updatePed(ped, dt, audio) {
    if (ped.dead) { ped.deadT += dt; return; }
    if (ped.dealer) {
      // Dealers hold their corner; they shoot back when threatened up close.
      const d = dist(ped.x, ped.y, player.x, player.y);
      ped.angle = Math.atan2(player.y - ped.y, player.x - ped.x);
      ped.shootCd -= dt;
      if (d < 240 && d > 30 && ped.shootCd <= 0 && lineOfSight(city, ped.x, ped.y, player.x, player.y)
        && (world.mission && world.mission.stepType === 'kill')) {
        ped.shootCd = 1.5;
        world.tracers.push({ x0: ped.x, y0: ped.y, x1: player.x + R.range(-10, 10), y1: player.y + R.range(-10, 10), ttl: 0.07, maxT: 0.07, hostile: true });
        sfx(audio, 'shot');
        if (random() < 0.4) world.hurtPlayer(4, audio);
      }
      return;
    }
    if (ped.state === 'flee') {
      ped.fleeT -= dt;
      const a = Math.atan2(ped.y - ped.fleeY, ped.x - ped.fleeX);
      const p = { x: ped.x + Math.cos(a) * 215 * dt, y: ped.y + Math.sin(a) * 215 * dt };
      collideWorld(city, p, 11);
      ped.x = p.x; ped.y = p.y; ped.angle = a;
      if (ped.fleeT <= 0) { ped.state = 'walk'; ped.retarget = 0; }
      return;
    }
    // Wander between sidewalk points.
    ped.retarget -= dt;
    if (ped.retarget <= 0 || dist(ped.x, ped.y, ped.tx, ped.ty) < 14) {
      ped.retarget = R.range(2, 5);
      const cross = R.pick(city.intersections);
      ped.tx = clamp(ped.x + R.range(-420, 420), 30, WORLD.beachX + 160);
      ped.ty = clamp(ped.y + R.range(-420, 420), 30, WORLD.height - 30);
      if (random() < 0.4) { ped.tx = cross.x + (R.chance(0.5) ? -1 : 1) * (ROADS.width / 2 + 20); ped.ty = cross.y + R.range(-160, 160); }
    }
    const d = dist(ped.x, ped.y, ped.tx, ped.ty);
    if (d > 6) {
      const sp = 74 * ped.speedJitter;
      const p = { x: ped.x + ((ped.tx - ped.x) / d) * sp * dt, y: ped.y + ((ped.ty - ped.y) / d) * sp * dt };
      collideWorld(city, p, 11);
      ped.angle = Math.atan2(p.y - ped.y, p.x - ped.x);
      ped.x = p.x; ped.y = p.y;
    }
    // Cars are terrifying: step away from anything fast and close.
    for (const car of world.cars) {
      if (Math.abs(car.speed) > 200 && dist(ped.x, ped.y, car.x, car.y) < 90) {
        ped.state = 'flee'; ped.fleeT = 1.4; ped.fleeX = car.x; ped.fleeY = car.y;
        break;
      }
    }
  }

  // ---------- running people over ----------

  function checkRunOvers(audio) {
    for (const car of world.cars) {
      if (Math.abs(car.speed) < 150) continue;
      const driven = car.driver === 'player';
      for (const ped of world.peds) {
        if (ped.dead) continue;
        if (dist(car.x, car.y, ped.x, ped.y) < 34) {
          killPed(ped, driven);
          if (driven) {
            world.crime(WANTED.hitPedCar, ped.x, ped.y);
            car.health -= 3;
            sfx(audio, 'crash', 0.7);
          }
        }
      }
      if (driven) {
        for (const cop of world.cops) {
          if (cop.dead) continue;
          if (dist(car.x, car.y, cop.x, cop.y) < 34) {
            killCop(cop, true);
            world.crime(WANTED.hitCop, cop.x, cop.y);
          }
        }
      }
    }
  }


  // ---------- player ----------

  function updatePlayer(dt, ctl, audio) {
    player.punchCd = Math.max(0, player.punchCd - dt);
    player.shootCd = Math.max(0, player.shootCd - dt);
    player.hurtT = Math.max(0, player.hurtT - dt);

    if (ctl.interact) {
      if (player.car) exitCar();
      else {
        const car = nearestEnterableCar();
        if (car) enterCar(car, audio);
      }
    }

    if (player.car) {
      const car = player.car;
      if (car.health <= 0) {
        car.speed = 0;
        world.toast('This car is wrecked — get out and find another');
      } else {
        const fwd = -ctl.moveY; // W / ArrowUp is up on screen = accelerate
        const steer = ctl.moveX;
        if (fwd > 0) car.speed += CAR.accel * dt;
        else if (fwd < 0) car.speed -= (car.speed > 4 ? CAR.brake : CAR.accel * 0.7) * dt;
        car.speed -= car.speed * CAR.drag * dt;
        car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
        if (Math.abs(car.speed) > 4) {
          const grip = clamp(Math.abs(car.speed) / 190, 0.25, 1);
          car.angle += steer * CAR.turnRate * grip * dt * (car.speed >= 0 ? 1 : -1);
        }
        const ox = car.x, oy = car.y;
        car.x += Math.cos(car.angle) * car.speed * dt;
        car.y += Math.sin(car.angle) * car.speed * dt;
        const p = { x: car.x, y: car.y };
        collideWorld(city, p, 32);
        if (Math.abs(p.x - car.x) > 0.5 || Math.abs(p.y - car.y) > 0.5) {
          const impact = Math.abs(car.speed);
          car.x = p.x; car.y = p.y;
          if (impact > 230) {
            car.health -= (impact - 200) * 0.05;
            player.health -= (impact - 200) * 0.012;
            sfx(audio, 'crash', clamp(impact / 500, 0.3, 1));
            burst(car.x, car.y, '#ffd166', 6, 110);
            if (witnessed(car.x, car.y, 300)) world.crime(18, car.x, car.y);
          }
          car.speed *= -0.18;
        }
        // Shoving other cars around.
        for (const other of world.cars) {
          if (other === car) continue;
          const d = dist(car.x, car.y, other.x, other.y);
          if (d < 58 && d > 0) {
            const push = (58 - d) / 2;
            const a = Math.atan2(other.y - car.y, other.x - car.x);
            other.x += Math.cos(a) * push;
            other.y += Math.sin(a) * push;
            if (Math.abs(car.speed) > 200) {
              other.health -= 5;
              car.health -= 2;
              sfx(audio, 'crash', 0.5);
              // One continuous shove is one offence, not sixty a second.
              if (other.kind === 'police' && !other.crimeCd) {
                world.crime(WANTED.hitCop, other.x, other.y);
                other.crimeCd = 2.5;
              }
            }
            if (other.driver === 'traffic') { other.speed = Math.min(other.speed, 40); }
          }
        }
        if (car.health < 45 && random() < dt * 8) {
          world.particles.push({
            x: car.x + R.range(-8, 8), y: car.y - 6, vx: R.range(-8, 8), vy: R.range(-34, -18),
            ttl: 0.8, maxT: 0.8, color: 'rgba(60,60,70,0.55)', size: 6 + random() * 6,
          });
        }
      }
      player.x = car.x; player.y = car.y;
      player.angle = car.angle;
      world.playerSpeed = car.speed;
      sfx(audio, 'setEngine', true, clamp(Math.abs(car.speed) / CAR.maxSpeed, 0, 1));
    } else {
      sfx(audio, 'setEngine', false, 0);
      const mx = ctl.moveX, my = ctl.moveY;
      const len = Math.hypot(mx, my);
      const speed = ctl.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
      if (len > 0) {
        const nx = mx / (len || 1), ny = my / (len || 1);
        const p = { x: player.x + nx * speed * dt, y: player.y + ny * speed * dt };
        collideWorld(city, p, PLAYER.radius);
        player.x = p.x; player.y = p.y;
        world.playerSpeed = speed;
      } else world.playerSpeed = 0;
      if (typeof ctl.aimAngle === 'number') player.angle = ctl.aimAngle;
      else if (len > 0) player.angle = Math.atan2(my, mx);
      if (ctl.attack) playerAttack(audio);
      // The clinic heals anyone who walks in off the street.
      const clinic = city.places.clinic;
      if (dist(player.x, player.y, clinic.x, clinic.y) < 90 && player.health < PLAYER.health) {
        player.health = Math.min(PLAYER.health, player.health + 16 * dt);
      }
    }
  }

  // ---------- mission step checks ----------

  function checkMissionStep(audio) {
    const m = world.mission;
    if (!m || world.storyDone) return;
    const step = m.def.steps[m.stepIndex];
    if (!step) return;
    const px = player.x, py = player.y;
    switch (step.type) {
      case 'goto': {
        const t = placePoint(step.place);
        if (dist(px, py, t.x, t.y) < (step.radius || 70)) completeStep(audio);
        break;
      }
      case 'steal':
        if (player.car && player.car === world.missionCar) completeStep(audio);
        break;
      case 'deliverCar': {
        const t = placePoint(step.place);
        if (player.car === world.missionCar && dist(px, py, t.x, t.y) < (step.radius || 120)) completeStep(audio);
        break;
      }
      case 'pickup': {
        const t = placePoint(step.place);
        if (!player.car && dist(px, py, t.x, t.y) < (step.radius || 46)) completeStep(audio);
        break;
      }
      case 'kill':
        if (m.kills >= (step.count || 3)) completeStep(audio);
        break;
      case 'escape':
        if (world.stars() === 0) completeStep(audio);
        break;
      case 'channel': {
        const t = placePoint(step.place);
        if (!player.car && dist(px, py, t.x, t.y) < (step.radius || 46)) {
          m.channelT += dtSafe;
          if (m.channelT >= (step.seconds || 3)) completeStep(audio);
        } else {
          m.channelT = Math.max(0, m.channelT - dtSafe * 0.5);
        }
        break;
      }
      default: break;
    }
  }

  let dtSafe = 0;

  // ---------- fate: busted / wasted ----------

  function applyFate() {
    const atClinic = world.fate === 'wasted';
    const spot = atClinic ? city.places.clinic : city.places.policeStation;
    const fine = atClinic ? 120 : 150 + world.stars() * 110;
    world.money = Math.max(0, world.money - fine);
    world.heat = 0;
    world.bust = 0;
    world.carrying = false;
    if (player.car) { player.car.driver = null; player.car = null; }
    player.health = PLAYER.health;
    player.x = spot.x; player.y = spot.y + 14;
    world.toast(atClinic ? `Clinica Vida patched you up — $${fine}` : `Busted — the bay takes $${fine}`);
    world.fate = null;
    // Clear the immediate area so respawning is not an instant re-arrest.
    world.cops.length = 0;
    for (const car of world.cars) if (car.kind === 'police') car.copOut = false;
  }

  // ---------- the step ----------

  world.update = (dt, ctl, audio) => {
    dtSafe = dt;
    world.elapsed += dt;
    world.timeHours = (world.timeHours + dt / DAY.secondsPerHour) % 24;

    for (const t of world.toasts) t.ttl -= dt;
    world.toasts = world.toasts.filter((t) => t.ttl > 0);
    if (world.banner) {
      world.banner.ttl -= dt;
      if (world.banner.ttl <= 0) world.banner = null;
    }
    if (world.storyDoneTimer > 0) world.storyDoneTimer -= dt;

    if (world.fate) {
      world.fateTimer -= dt;
      sfx(audio, 'setEngine', false, 0);
      sfx(audio, 'setSiren', 0);
      if (world.fateTimer <= 0) applyFate();
      // The world keeps breathing behind the card.
      for (const car of world.cars) if (car.driver === 'traffic') updateTrafficCar(car, dt);
      for (const ped of world.peds) updatePed(ped, dt, audio);
      return;
    }

    updatePlayer(dt, ctl, audio);

    for (const car of world.cars) car.crimeCd = Math.max(0, (car.crimeCd || 0) - dt);
    for (const car of world.cars) {
      if (car.driver === 'traffic') updateTrafficCar(car, dt);
      else if (car.kind === 'police' && car.driver === 'police') updatePoliceCar(car, dt);
    }
    managePolice(dt);
    for (let i = world.cops.length - 1; i >= 0; i -= 1) updateFootCop(world.cops[i], dt, audio);
    for (const ped of world.peds) updatePed(ped, dt, audio);
    checkRunOvers(audio);

    // Who can see the player right now?
    let seen = false;
    if (world.stars() > 0) {
      for (const cop of world.cops) {
        if (!cop.dead && dist(cop.x, cop.y, player.x, player.y) < POLICE.sightRange
          && lineOfSight(city, cop.x, cop.y, player.x, player.y)) { seen = true; break; }
      }
      if (!seen) {
        for (const car of world.cars) {
          if (car.kind === 'police' && dist(car.x, car.y, player.x, player.y) < POLICE.sightRange
            && lineOfSight(city, car.x, car.y, player.x, player.y)) { seen = true; break; }
        }
      }
    }
    if (seen) world.unseenFor = 0;
    else world.unseenFor += dt;
    if (world.heat > 0 && world.unseenFor > WANTED.hideTime) {
      const lostBonus = world.unseenFor > WANTED.hideTime + 5 ? 2.6 : 1;
      world.heat = Math.max(0, world.heat - WANTED.decayPerSecond * lostBonus * dt);
    }

    // Arrest meter.
    const anyBusting = world.cops.some((c) => c.busting);
    if (anyBusting && !player.car) world.bust = Math.min(1, world.bust + dt / POLICE.bustTime);
    else world.bust = Math.max(0, world.bust - dt * 0.7);
    if (world.bust >= 1 && !world.fate) {
      world.fate = 'busted';
      world.fateTimer = 2.8;
      sfx(audio, 'busted');
    }

    // Siren loudness follows the nearest police unit.
    let nearestCop = Infinity;
    for (const car of world.cars) if (car.kind === 'police') nearestCop = Math.min(nearestCop, dist(car.x, car.y, player.x, player.y));
    for (const cop of world.cops) if (!cop.dead) nearestCop = Math.min(nearestCop, dist(cop.x, cop.y, player.x, player.y));
    sfx(audio, 'setSiren', world.stars() > 0 && nearestCop < 700 ? clamp(1 - nearestCop / 760, 0.08, 1) : 0);

    // Pickups.
    for (let i = world.pickups.length - 1; i >= 0; i -= 1) {
      const pk = world.pickups[i];
      pk.ttl -= dt;
      pk.bob += dt * 3;
      if (pk.ttl <= 0) { world.pickups.splice(i, 1); continue; }
      if (!player.car && dist(pk.x, pk.y, player.x, player.y) < 26) {
        if (pk.kind === 'money') { world.money += pk.value; sfx(audio, 'cash'); world.toast(`+$${pk.value}`); }
        if (pk.kind === 'snack') { player.health = Math.min(PLAYER.health, player.health + pk.value); sfx(audio, 'pickup'); world.toast('Snack — health up'); }
        world.pickups.splice(i, 1);
      }
    }

    checkMissionStep(audio);

    // Particles & tracers.
    for (let i = world.particles.length - 1; i >= 0; i -= 1) {
      const p = world.particles[i];
      p.ttl -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
      if (p.ttl <= 0) world.particles.splice(i, 1);
    }
    for (let i = world.tracers.length - 1; i >= 0; i -= 1) {
      world.tracers[i].ttl -= dt;
      if (world.tracers[i].ttl <= 0) world.tracers.splice(i, 1);
    }
    // Corpses fade so the streets do not fill up forever.
    world.peds = world.peds.filter((p) => !p.dead || p.deadT < 26);
    world.cops = world.cops.filter((c) => !c.dead || c.deadT < 20);
    // Keep civilian numbers up.
    if (world.peds.filter((p) => !p.dead && !p.dealer).length < PEDS.count - 6) {
      const cross = R.pick(city.intersections);
      spawnPed(cross.x + R.range(-70, 70), cross.y + R.range(-70, 70), false);
    }
    if (player.health <= 0 && !world.fate) {
      world.fate = 'wasted';
      world.fateTimer = 2.8;
      sfx(audio, 'failed');
    }
    void isOnRoad;
  };

  return world;
}
