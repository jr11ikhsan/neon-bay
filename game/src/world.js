// NEON BAY v3 — the full simulation: player on foot and in cars, lane traffic, pedestrians,
// encircling police with a 5-star wanted system, hitscan combat, the 6-mission story engine,
// the 8-place economy, busted/wasted, and save/restore. Pure logic — no DOM, no rendering.
import { WORLD, STEP, PLAYER, DAY, WEAPONS, WEAPON_ORDER, WANTED, CRIME, PRICES, BANK_SIDE, FINE, TRAFFIC, PEDS, POLICE, CAR_TYPES } from './config.js';
import { Rng, clamp, lerp, dist, angDiff } from './random.js';
import { createCity, AVENUES, STREETS, collide, lineOfSight, isSand, placeById } from './city.js';
import { buildMissions } from './missions.js';

export class World {
  constructor(seed = 1) {
    this.seed = seed;
    this.rng = new Rng(seed * 7919 + 13);
    this.city = createCity();
    this.missions = buildMissions(this.city);
    this.timeMin = DAY.start * 60;
    this.elapsed = 0;
    this.heat = 0;
    this.lastSeenT = 99;         // seconds since a police unit last had eyes on the player
    this.missionIdx = 0;
    this.stepIdx = 0;
    this.storyComplete = false;
    this.storyNoticeT = 0;
    this.channel = null;         // {x,y,dur,t,kind}
    this.bankCd = 0;
    this.bustedMeter = 0;
    this.notice = null;          // {kind:'busted'|'wasted', t}
    this.events = [];
    this.toasts = [];
    this.tracers = [];
    this.particles = [];
    this.pickups = [];
    this.cars = [];
    this.peds = [];
    this.shotHeatCd = 0; this.contactCd = 0; this.policeSpawnT = 0; this.escapeT = 0;
    this.stats = { timePlayed: 0, carsStolen: 0, shotsFired: 0, missionsDone: 0, bestMoney: 0 };
    this.player = { x: this.city.spawn.x, y: this.city.spawn.y, a: -Math.PI / 2, hp: PLAYER.hp,
      money: PLAYER.startMoney, car: null, weapon: 'fist', owned: { fist: true }, fireCd: 0, speed: 0 };
    this.spawnTraffic(); this.spawnParked(); this.spawnPeds(); this.spawnMissionCar('coupe');
    this.toast(this.missions[0].title + ' — ' + this.missions[0].intro);
  }
  get stars() { let s = 0; for (const t of WANTED.thresholds) if (this.heat >= t) s++; return s; }
  get mission() { return this.storyComplete ? null : this.missions[this.missionIdx]; }
  get currentStep() { const m = this.mission; return m ? m.steps[this.stepIdx] : null; }
  toast(text) { this.toasts.push({ text, t: 4.2 }); if (this.toasts.length > 3) this.toasts.shift(); }
  emit(k, extra) { this.events.push(Object.assign({ k }, extra)); }

  // ---------- spawning ----------
  nodes() {
    if (this._nodes) return this._nodes;
    const nodes = [], idx = new Map();
    const key = (x, y) => x + ',' + y;
    const add = (x, y) => { if (!idx.has(key(x, y))) { idx.set(key(x, y), nodes.length); nodes.push({ x, y, next: [] }); } return idx.get(key(x, y)); };
    for (const ax of AVENUES) { add(ax, 140); add(ax, WORLD.h - 140); for (const sy of STREETS) add(ax, sy); }
    for (const sy of STREETS) { add(140, sy); add(3940, sy); }
    const link = (a, b) => { if (a !== b && !nodes[a].next.includes(b)) nodes[a].next.push(b); };
    for (const ax of AVENUES) { const col = nodes.map((n, i) => n.x === ax ? i : -1).filter(i => i >= 0).sort((p, q) => nodes[p].y - nodes[q].y); for (let i = 0; i + 1 < col.length; i++) { link(col[i], col[i + 1]); link(col[i + 1], col[i]); } }
    for (const sy of STREETS) { const row = nodes.map((n, i) => n.y === sy ? i : -1).filter(i => i >= 0).sort((p, q) => nodes[p].x - nodes[q].x); for (let i = 0; i + 1 < row.length; i++) { link(row[i], row[i + 1]); link(row[i + 1], row[i]); } }
    this._nodes = nodes; return nodes;
  }
  spawnTraffic() {
    const nodes = this.nodes(), types = Object.keys(CAR_TYPES);
    for (let i = 0; i < TRAFFIC.count; i++) {
      const from = this.rng.int(0, nodes.length - 1), to = nodes[from].next[this.rng.int(0, nodes[from].next.length - 1)];
      const type = this.rng.pick(types), car = this.makeCar(nodes[from].x, nodes[from].y, Math.atan2(nodes[to].y - nodes[from].y, nodes[to].x - nodes[from].x), type, 'traffic');
      car.from = from; car.to = to; car.spd = this.rng.range(120, 220); this.cars.push(car);
    }
  }
  spawnParked() {
    const spots = [...this.city.parkedSpots], types = Object.keys(CAR_TYPES);
    for (let i = 0; i < Math.min(30, spots.length); i++) {
      const s = spots.splice(this.rng.int(0, spots.length - 1), 1)[0];
      const car = this.makeCar(s.x, s.y, s.a, this.rng.pick(types), 'parked'); car.parked = true; this.cars.push(car);
    }
  }
  spawnPeds() {
    for (let i = 0; i < PEDS.count; i++) {
      const beach = this.rng.chance(0.3);
      const x = beach ? this.rng.range(4130, 4380) : this.rng.range(300, 3900);
      const y = this.rng.range(200, WORLD.h - 200);
      const p = { id: this.rng.int(1, 1e9), kind: 'walker', x, y, a: this.rng.range(0, 6.28), hp: 40, state: 'wander', tx: x, ty: y, t: 0, fireCd: 0, dead: false, hue: this.rng.range(0, 360) };
      const c = collide(this.city, x, y, 12); p.x = c.x; p.y = c.y; this.peds.push(p);
    }
  }
  makeCar(x, y, a, type, kind) {
    const spec = CAR_TYPES[type];
    return { id: this.rng.int(1, 1e9), x, y, a, spd: 0, type, kind, tag: null, color: this.rng.pick(spec.colors),
      hp: 100, driver: kind === 'traffic' ? 'ai' : null, wrecked: false, flank: 0, officersOut: false, boxT: 0, backoff: 0, from: -1, to: -1 };
  }
  spawnMissionCar(tag) {
    const spot = tag === 'coupe' ? this.city.missionSpots.coupe : this.city.missionSpots.job;
    const car = this.makeCar(spot.x, spot.y, spot.a, 'sport', 'mission');
    car.tag = tag; car.color = tag === 'coupe' ? 0xf2b705 : 0x22d3ee; car.parked = true; this.cars.push(car); return car;
  }
  missionCar(tag) { return this.cars.find(c => c.tag === tag); }
  spawnPolice(x, y) {
    const car = this.makeCar(x, y, 0, 'sedan', 'police');
    car.color = 0xf0f0f0; car.flank = [-1, 0, 1][this.cars.filter(c => c.kind === 'police').length % 3];
    this.cars.push(car); return car;
  }
  debugPolice(x, y) { const c = this.spawnPolice(x, y); this.dropOfficers(c, 2); return c; }
  dropOfficers(car, n) {
    for (let i = 0; i < n; i++) this.peds.push({ id: this.rng.int(1, 1e9), kind: 'officer', x: car.x + this.rng.range(-30, 30), y: car.y + this.rng.range(-30, 30),
      a: 0, hp: 70, state: 'chase', tx: 0, ty: 0, t: 0, fireCd: this.rng.range(0.2, 0.6), dead: false, hue: 220, car });
    car.officersOut = true;
  }

  // ---------- heat / wanted ----------
  addHeat(n) { this.heat = Math.min(950, this.heat + n); }
  policeUnits() { return [...this.cars.filter(c => c.kind === 'police' && !c.wrecked), ...this.peds.filter(p => p.kind === 'officer' && !p.dead)]; }
  updateWanted(dt) {
    let seen = false;
    const safe = placeById(this.city, 'safehouse');
    const nearSafe = dist(this.player.x, this.player.y, safe.x, safe.y) < 150;
    for (const u of this.policeUnits()) if (dist(u.x, u.y, this.player.x, this.player.y) < (nearSafe ? 380 : 720) && lineOfSight(this.city, u.x, u.y, this.player.x, this.player.y)) { seen = true; break; }
    if (seen) { this.lastSeenT = 0; this.lastSeenX = this.player.x; this.lastSeenY = this.player.y; }
    else this.lastSeenT = this.lastSeenT + dt;
    if (this.lastSeenT > WANTED.grace && this.heat > 0) {
      const boost = nearSafe ? WANTED.hideBoost : 1;
      this.heat = Math.max(0, this.heat - WANTED.decay * boost * dt);
    }
    // Police director: keep roughly one patrol car per star in play.
    this.policeSpawnT -= dt;
    const cops = this.cars.filter(c => c.kind === 'police');
    if (this.stars > 0 && cops.length < this.stars && this.policeSpawnT <= 0) {
      this.policeSpawnT = POLICE.spawnGap;
      const st = placeById(this.city, 'police');
      const nearStation = dist(this.player.x, this.player.y, st.x, st.y) > 500;
      const spot = nearStation ? { x: st.x, y: st.y } : this.city.intersections[this.rng.int(0, this.city.intersections.length - 1)];
      this.spawnPolice(spot.x, spot.y);
    }
    if (this.stars === 0) {
      for (const c of cops) { c.kind = 'traffic'; c.driver = 'ai'; const nodes = this.nodes(); let best = 0, bd = 1e12; nodes.forEach((n, i) => { const d = dist(c.x, c.y, n.x, n.y); if (d < bd) { bd = d; best = i; } }); c.from = best; c.to = nodes[best].next[0]; }
      for (const ped of this.peds) if (ped.kind === 'officer' && !ped.dead) { ped.dead = true; ped.deadT = 0; } // foot officers stand down
    }
  }

  // ---------- main step ----------
  step(inp) {
    const dt = STEP;
    this.elapsed += dt; this.stats.timePlayed += dt;
    this.timeMin = (this.timeMin + DAY.minPerSec * dt) % (24 * 60);
    this.bankCd = Math.max(0, this.bankCd - dt);
    this.shotHeatCd = Math.max(0, this.shotHeatCd - dt);
    this.contactCd = Math.max(0, this.contactCd - dt);
    for (const c of this.cars) if (c.crashCd) c.crashCd = Math.max(0, c.crashCd - dt);
    this.player.fireCd = Math.max(0, this.player.fireCd - dt);
    for (const t of this.toasts) t.t -= dt; this.toasts = this.toasts.filter(t => t.t > 0);
    for (const tr of this.tracers) tr.t -= dt; this.tracers = this.tracers.filter(t => t.t > 0);
    for (const p of this.particles) { p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; } this.particles = this.particles.filter(p => p.t > 0);
    if (this.storyNoticeT > 0) this.storyNoticeT -= dt;
    if (this.notice) { this.notice.t -= dt; if (this.notice.t <= 0) this.notice = null; this.updateFx(dt); return; }
    if (inp.weaponTo) { const w = WEAPON_ORDER[inp.weaponTo - 1]; if (w && this.player.owned[w]) this.player.weapon = w; }
    if (inp.interact) this.tryInteract();
    this.updatePlayer(inp, dt);
    this.updateCars(inp, dt);
    this.updatePeds(dt);
    this.updateWanted(dt);
    this.updateChannel(inp, dt);
    this.updateMissions(dt);
    this.updateBusted(dt);
    this.updatePickups(dt);
    this.updateFx(dt);
    if (this.player.hp <= 0 && !this.notice) this.punish('wasted');
  }
  updateFx() {}
  updatePickups(dt) {
    for (const pk of this.pickups) {
      pk.t += dt;
      if (!this.player.car && dist(pk.x, pk.y, this.player.x, this.player.y) < 30) {
        pk.taken = true;
        if (pk.kind === 'cash') { this.player.money += pk.amt; this.emit('cash'); this.toast('+$' + pk.amt); }
        else { this.player.hp = Math.min(PLAYER.hp, this.player.hp + 22); this.toast('Snack +22 HP'); }
      }
    }
    this.pickups = this.pickups.filter(p => !p.taken);
  }

  // ---------- player ----------
  updatePlayer(inp, dt) {
    const p = this.player;
    if (p.car) {
      const car = p.car, spec = CAR_TYPES[car.type];
      const sand = isSand(car.x, car.y) ? 0.55 : 1;
      const throttle = car.wrecked ? 0 : (inp.throttle || 0);
      car.spd += throttle * spec.accel * dt * (throttle < 0 ? 0.6 : 1);
      car.spd -= car.spd * 0.55 * dt;
      car.spd = clamp(car.spd, -150, spec.top * sand);
      const auth = clamp(Math.abs(car.spd) / 160, 0.35, 1); // low-speed steering authority
      car.a += (inp.steer || 0) * 2.35 * auth * dt * (car.spd < 0 ? -1 : 1) * clamp(Math.abs(car.spd) / 120, 0, 1);
      this.moveCar(car, dt);
      p.x = car.x; p.y = car.y; p.a = car.a; p.speed = Math.abs(car.spd);
      if (Math.abs(car.spd) > 60) this.checkRunOver(car, dt);
    } else {
      const mag = Math.hypot(inp.mx || 0, inp.my || 0);
      const sp = inp.sprint ? PLAYER.run : PLAYER.walk;
      let vx = 0, vy = 0;
      if (mag > 0.01) { vx = (inp.mx / mag) * sp * Math.min(1, mag); vy = (inp.my / mag) * sp * Math.min(1, mag); p.a = Math.atan2(vy, vx); }
      if (inp.aim !== undefined && inp.aim !== null) p.a = inp.aim;
      const nx = p.x + vx * dt, ny = p.y + vy * dt;
      const c = collide(this.city, nx, ny, PLAYER.r);
      p.x = Math.min(c.x, WORLD.waterX - 10); p.y = c.y; p.speed = mag > 0.01 ? sp : 0;
      if (inp.fire || inp.firePressed) this.tryFire(inp);
      this._prevFire = !!(inp.fire || inp.firePressed);
    }
  }
  tryFire(inp) {
    const p = this.player, w = WEAPONS[p.weapon];
    if (p.fireCd > 0) return;
    const edge = inp.firePressed || !this._prevFire;
    if (!w.auto && !edge) return; // semi-auto weapons need a fresh trigger pull
    p.fireCd = w.rate;
    this._lastShotT = this.elapsed;
    this.stats.shotsFired++;
    this.emit('shot', { weapon: p.weapon, x: p.x, y: p.y });
    if (this.shotHeatCd <= 0 && p.weapon !== 'fist') { this.addHeat(CRIME.shot); this.shotHeatCd = 0.8; }
    if (p.weapon === 'fist') {
      for (const ped of this.peds) {
        if (ped.dead) continue;
        const d = dist(p.x, p.y, ped.x, ped.y);
        if (d < w.range + 12 && Math.abs(angDiff(p.a, Math.atan2(ped.y - p.y, ped.x - p.x))) < 0.95) { this.hurtPed(ped, w.dmg, p.a); break; }
      }
      this.emit('punch'); return;
    }
    for (let i = 0; i < w.pellets; i++) {
      const a = p.a + this.rng.range(-w.spread, w.spread);
      const dx = Math.cos(a), dy = Math.sin(a);
      let bestT = w.range, hitPed = null, hitCar = null;
      for (const ped of this.peds) {
        if (ped.dead) continue;
        const t = (ped.x - p.x) * dx + (ped.y - p.y) * dy;
        if (t < 0 || t > bestT) continue;
        const perp = Math.abs((ped.x - p.x) * dy - (ped.y - p.y) * dx);
        if (perp < 15) { bestT = t; hitPed = ped; hitCar = null; }
      }
      for (const car of this.cars) {
        if (car === p.car) continue;
        const t = (car.x - p.x) * dx + (car.y - p.y) * dy;
        if (t < 0 || t > bestT) continue;
        const perp = Math.abs((car.x - p.x) * dy - (car.y - p.y) * dx);
        if (perp < 30) { bestT = t; hitCar = car; hitPed = null; }
      }
      const ex = p.x + dx * bestT, ey = p.y + dy * bestT;
      if ((hitPed || hitCar) && !lineOfSight(this.city, p.x, p.y, ex, ey)) { this.tracers.push({ x1: p.x, y1: p.y, x2: ex, y2: ey, t: 0.07 }); continue; }
      this.tracers.push({ x1: p.x, y1: p.y, x2: ex, y2: ey, t: 0.07 });
      if (hitPed) this.hurtPed(hitPed, w.dmg, a);
      if (hitCar) { hitCar.hp -= w.dmg * 0.6; if (hitCar.kind === 'police') this.addHeat(40); if (hitCar.hp <= 0 && !hitCar.wrecked) this.wreck(hitCar); }
    }
  }
  hurtPed(ped, dmg, fromA) {
    ped.hp -= dmg; ped.state = 'flee'; ped.t = 0;
    if (ped.kind === 'dealer') ped.aggro = true;
    this.burst(ped.x, ped.y, 4, '#e0483e');
    if (ped.hp <= 0 && !ped.dead) {
      ped.dead = true; ped.deadT = 6;
      this.addHeat(ped.kind === 'dealer' ? CRIME.killDealer : ped.kind === 'officer' ? 260 : CRIME.killPed);
      if (this.rng.chance(0.6)) this.pickups.push({ kind: this.rng.chance(0.7) ? 'cash' : 'snack', x: ped.x, y: ped.y, amt: this.rng.int(10, 25), t: 0 });
      this.emit('down');
    }
  }
  burst(x, y, n, color) { for (let i = 0; i < n; i++) { const a = this.rng.range(0, 6.28), s = this.rng.range(30, 130); this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: this.rng.range(0.2, 0.5), color }); } }
  wreck(car) { car.wrecked = true; car.spd = 0; if (this.player.car === car) { this.player.car = null; this.toast('Your ride is wrecked'); } this.burst(car.x, car.y, 10, '#888888'); }

  // ---------- cars ----------
  moveCar(car, dt) {
    const steps = Math.abs(car.spd) * dt > 22 ? 2 : 1, sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const ox = car.x, oy = car.y;
      car.x += Math.cos(car.a) * car.spd * sdt; car.y += Math.sin(car.a) * car.spd * sdt;
      const c = collide(this.city, car.x, car.y, 30);
      if (c.x !== car.x || c.y !== car.y) {
        // Impact damage is charged once per impact (crashCd), never per step of wall contact.
        if (Math.abs(car.spd) > 210 && (car.crashCd || 0) <= 0) { car.crashCd = 0.4; car.hp -= (Math.abs(car.spd) - 200) / 11; if (car === this.player.car && Math.abs(car.spd) > 300) this.player.hp -= (Math.abs(car.spd) - 300) / 20; this.emit('crash'); this.burst(car.x, car.y, 6, '#cccccc'); if (car.hp <= 0 && !car.wrecked) this.wreck(car); }
        car.x = c.x; car.y = c.y; car.spd *= 0.45;
      }
      if (car.x > WORLD.waterX - 16) { car.x = WORLD.waterX - 16; car.spd *= 0.3; }
      for (const o of this.cars) {
        if (o === car) continue;
        const d = dist(car.x, car.y, o.x, o.y);
        if (d < 62 && d > 0.01) {
          const push = (62 - d) / 2, ux = (car.x - o.x) / d, uy = (car.y - o.y) / d;
          car.x += ux * push; car.y += uy * push; o.x -= ux * push; o.y -= uy * push;
          const rel = Math.abs(car.spd - o.spd);
          if (rel > 150 && (car.crashCd || 0) <= 0) { car.crashCd = 0.4; o.crashCd = 0.4; car.hp -= rel / 16; o.hp -= rel / 16; if ((car === this.player.car || o === this.player.car) && rel > 280) this.player.hp -= (rel - 280) / 22; this.emit('crash'); if (car.hp <= 0 && !car.wrecked) this.wreck(car); if (o.hp <= 0 && !o.wrecked) this.wreck(o); }
          car.spd *= 0.88; o.spd *= 0.88; // softened contact momentum
        }
      }
      if (car.x === ox && car.y === oy) break;
    }
  }
  checkRunOver(car, dt) {
    for (const ped of this.peds) {
      if (ped.dead) continue;
      if (dist(car.x, car.y, ped.x, ped.y) < 40) {
        if (this.contactCd <= 0) { this.contactCd = 2.5; this.addHeat(ped.kind === 'dealer' ? CRIME.killDealer : CRIME.killPed); }
        ped.hp = 0; ped.dead = true; ped.deadT = 6; car.spd *= 0.92; this.emit('down'); this.burst(ped.x, ped.y, 6, '#e0483e');
      }
    }
  }
  updateCars(inp, dt) {
    const nodes = this.nodes();
    for (const car of this.cars) {
      if (car === this.player.car || car.wrecked) continue;
      if (car.kind === 'traffic') this.driveTraffic(car, nodes, dt);
      else if (car.kind === 'police') this.drivePolice(car, dt);
      // parked / mission / owned cars sit still
    }
  }
  obstacleAhead(car, distA) {
    const ax = car.x + Math.cos(car.a) * distA, ay = car.y + Math.sin(car.a) * distA;
    for (const o of this.cars) if (o !== car && dist(ax, ay, o.x, o.y) < 50) return true;
    for (const p of this.peds) if (!p.dead && dist(ax, ay, p.x, p.y) < 42) return true;
    if (!this.player.car && dist(ax, ay, this.player.x, this.player.y) < 42) return true;
    return false;
  }
  steerToward(car, tx, ty, topSpeed, dt) {
    const want = Math.atan2(ty - car.y, tx - car.x), d = angDiff(car.a, want);
    car.a += clamp(d, -2.5 * dt, 2.5 * dt);
    const align = Math.max(0, 1 - Math.abs(d) * 0.55);
    let target = topSpeed * align;
    if (this.obstacleAhead(car, 105) && car.kind === 'traffic') target = 0;
    else if (this.obstacleAhead(car, 80)) target = Math.min(target, 130);
    car.spd += clamp(target - car.spd, -420 * dt, 240 * dt);
    this.moveCar(car, dt);
  }
  driveTraffic(car, nodes, dt) {
    if (car.to < 0 || !nodes[car.to]) { car.to = 0; car.from = 0; }
    const target = nodes[car.to];
    const segA = Math.atan2(target.y - nodes[car.from].y, target.x - nodes[car.from].x);
    const rx = -Math.sin(segA), ry = Math.cos(segA); // right-hand lane offset
    const tx = target.x + rx * 34, ty = target.y + ry * 34;
    if (dist(car.x, car.y, tx, ty) < 62) {
      const opts = target.next.filter(n => n !== car.from);
      let next;
      if (!opts.length) next = car.from;
      else if (this.rng.chance(0.62)) { const straight = opts.find(n => Math.abs(angDiff(segA, Math.atan2(nodes[n].y - target.y, nodes[n].x - target.x))) < 0.1); next = straight !== undefined ? straight : this.rng.pick(opts); }
      else next = this.rng.pick(opts);
      car.from = car.to; car.to = next;
    }
    this.steerToward(car, tx, ty, CAR_TYPES[car.type].top * 0.72, dt);
  }
  drivePolice(car, dt) {
    const p = this.player, d = dist(car.x, car.y, p.x, p.y);
    const los = d < 560 && lineOfSight(this.city, car.x, car.y, p.x, p.y);
    // Officers bail out when close to an on-foot suspect and the car is slow.
    if (!p.car && d < 230 && Math.abs(car.spd) < 70 && !car.officersOut) this.dropOfficers(car, 2);
    if (p.car && car.officersOut) car.officersOut = false;
    let tx, ty;
    if (los || d < 300) {
      const lead = 0.35, px = p.x + Math.cos(p.a) * p.speed * lead, py = p.y + Math.sin(p.a) * p.speed * lead;
      const perp = car.flank * 85;
      tx = px + -Math.sin(p.a) * perp * (d < 320 ? 1 : 0); ty = py + Math.cos(p.a) * perp * (d < 320 ? 1 : 0);
    } else if (this.lastSeenT > 5 && this.lastSeenX !== undefined) {
      tx = this.lastSeenX; ty = this.lastSeenY; // search the last confirmed sighting, not the player
    } else {
      let best = this.city.intersections[0], bd = 1e12;
      for (const n of this.city.intersections) { const dd = dist(p.x, p.y, n.x, n.y); if (dd < bd) { bd = dd; best = n; } }
      tx = d > 640 ? best.x : p.x; ty = d > 640 ? best.y : p.y;
    }
    // Pacing: match a slow suspect instead of grinding into them; back off a completed box.
    let top = POLICE.carSpeed;
    if (d < 150) top = Math.min(top, Math.max(p.speed + 130, 120));
    if (d < 90) top = Math.min(top, p.speed + 45);
    if (!p.car || Math.abs(p.car ? p.car.spd : 0) < 25) {
      if (d < 95) { car.boxT += dt; if (car.boxT > 2.2) car.backoff = 1.1; } else car.boxT = Math.max(0, car.boxT - dt);
    }
    if (car.backoff > 0) { car.backoff -= dt; car.spd += clamp(-160 - car.spd, -380 * dt, 380 * dt); this.moveCar(car, dt); return; }
    this.steerToward(car, tx, ty, top, dt);
  }

  // ---------- peds ----------
  updatePeds(dt) {
    const p = this.player;
    for (const ped of this.peds) {
      if (ped.dead) { ped.deadT -= dt; continue; }
      if (ped.kind === 'officer') { this.updateOfficer(ped, dt); continue; }
      if (ped.kind === 'dealer') { this.updateDealer(ped, dt); continue; }
      ped.t -= dt;
      const danger = (this.elapsed - (this._lastShotT || -99) < 2.5 && dist(ped.x, ped.y, p.x, p.y) < 320) || (p.car && Math.abs(p.car.spd) > 200 && dist(ped.x, ped.y, p.x, p.y) < 130);
      if (danger) { ped.state = 'flee'; ped.t = 1.6; }
      if (ped.state === 'flee') {
        if (ped.t <= 0) { ped.state = 'wander'; }
        else { const a = Math.atan2(ped.y - p.y, ped.x - p.x); this.walkPed(ped, ped.x + Math.cos(a) * 120, ped.y + Math.sin(a) * 120, 205, dt); continue; }
      }
      if (ped.t <= 0 || dist(ped.x, ped.y, ped.tx, ped.ty) < 24) {
        ped.t = this.rng.range(2, 6);
        if (ped.x > WORLD.beachX) { ped.tx = this.rng.range(4120, 4390); ped.ty = this.rng.range(120, WORLD.h - 120); }
        else { const b = this.rng.pick(this.city.buildings); ped.tx = clamp(b.cx + this.rng.range(-330, 330), 60, WORLD.beachX - 40); ped.ty = clamp(b.cy + this.rng.range(-330, 330), 60, WORLD.h - 60); }
      }
      this.walkPed(ped, ped.tx, ped.ty, 78, dt);
    }
    this.peds = this.peds.filter(ped => !ped.dead || ped.deadT > 0);
  }
  walkPed(ped, tx, ty, speed, dt) {
    const d = dist(ped.x, ped.y, tx, ty); if (d < 4) return;
    const a = Math.atan2(ty - ped.y, tx - ped.x); ped.a = a;
    const c = collide(this.city, ped.x + Math.cos(a) * speed * dt, ped.y + Math.sin(a) * speed * dt, 12);
    ped.x = Math.min(c.x, WORLD.waterX - 8); ped.y = c.y;
  }
  updateOfficer(ped, dt) {
    const p = this.player, d = dist(ped.x, ped.y, p.x, p.y);
    if (this.lastSeenT > 12) { ped.dead = true; ped.deadT = 0; return; } // lost the trail: stand down
    if (this.lastSeenT > 5 && this.lastSeenX !== undefined && d > 60) { this.walkPed(ped, this.lastSeenX, this.lastSeenY, 210, dt); return; } // search last sighting
    if (p.car) { // suspect fled by car: climb back in and resume the chase
      if (ped.car && !ped.car.wrecked) { if (dist(ped.x, ped.y, ped.car.x, ped.car.y) < 42) { ped.dead = true; ped.deadT = 0; ped.car.officersOut = false; } else this.walkPed(ped, ped.car.x, ped.car.y, 230, dt); }
      else { ped.dead = true; ped.deadT = 0; }
      return;
    }
    if (d > 38) this.walkPed(ped, p.x, p.y, POLICE.footSpeed, dt); // close all the way to grabbing distance
    ped.a = Math.atan2(p.y - ped.y, p.x - ped.x);
    ped.fireCd -= dt;
    // Officers hold fire at two stars — there they try to make the arrest; shooting starts at three.
    if (this.stars >= 3 && d < POLICE.shootRange && ped.fireCd <= 0 && lineOfSight(this.city, ped.x, ped.y, p.x, p.y)) {
      ped.fireCd = 0.7;
      this.tracers.push({ x1: ped.x, y1: ped.y, x2: p.x, y2: p.y, t: 0.07 });
      this.emit('shot', { weapon: 'cop', x: ped.x, y: ped.y });
      if (this.rng.chance(lerp(0.55, 0.22, d / POLICE.shootRange))) { p.hp -= POLICE.shootDmg; this.burst(p.x, p.y, 2, '#e0483e'); }
    }
  }
  updateDealer(ped, dt) {
    const p = this.player, d = dist(ped.x, ped.y, p.x, p.y);
    const active = this.currentStep && this.currentStep.t === 'kill';
    if ((active && d < 430) || ped.aggro) {
      ped.aggro = true;
      if (d > 240) this.walkPed(ped, p.x, p.y, 150, dt);
      ped.a = Math.atan2(p.y - ped.y, p.x - ped.x);
      ped.fireCd -= dt;
      if (!p.car && d < 300 && ped.fireCd <= 0 && lineOfSight(this.city, ped.x, ped.y, p.x, p.y)) {
        ped.fireCd = 0.85; this.tracers.push({ x1: ped.x, y1: ped.y, x2: p.x, y2: p.y, t: 0.07 });
        this.emit('shot', { weapon: 'dealer', x: ped.x, y: ped.y });
        if (this.rng.chance(0.3)) p.hp -= 5;
      }
    }
  }

  // ---------- interaction & places ----------
  prompt() {
    const p = this.player;
    if (p.car) return 'E — exit car';
    if (this.channel) return 'Stay in the circle…';
    const near = this.nearInteract();
    if (!near) return null;
    if (near.kind === 'car') return near.car.kind === 'police' ? 'E — steal police car' : 'E — drive';
    const id = near.place.id;
    const table = { clinic: `E — heal ($${PRICES.heal})`, police: `E — bribe, clear heat ($${PRICES.bribe})`, hotel: `E — room, rest + save ($${PRICES.hotel})`,
      safehouse: 'E — lie low + save', market: 'E — shop (weapons / snack)', carlot: `E — buy a car ($${PRICES.car})`, garage: `E — repair car ($${PRICES.repair})`,
      bank: this.bankCd > 0 ? `Vault re-arming (${Math.ceil(this.bankCd)}s)` : `E — crack side vault (+$${BANK_SIDE.reward})` };
    return table[id] || null;
  }
  nearInteract() {
    const p = this.player;
    let best = null, bd = 1e9, bestCar = null, bestPlace = null;
    for (const pl of this.city.places) { const d = dist(p.x, p.y, pl.x, pl.y); if (d < 98 && d < bd) { bd = d; best = { kind: 'place', place: pl, d }; bestPlace = best; } }
    for (const car of this.cars) { if (car.wrecked) continue; const d = dist(p.x, p.y, car.x, car.y); if (d < 88 && d < bd) { bd = d; best = { kind: 'car', car, d }; } if (d < 88 && (!bestCar || d < bestCar.d)) bestCar = { kind: 'car', car, d }; }
    // Pressed up against a car, E gets in — unless you are hugging a doorway instead.
    if (bestCar && bestCar.d < 56 && (!bestPlace || bestPlace.d > 30)) return bestCar;
    return best;
  }
  tryInteract() {
    const p = this.player;
    if (p.car) { const car = p.car; p.car = null; car.driver = null; p.x = car.x + 40; p.y = car.y + 10; const c = collide(this.city, p.x, p.y, PLAYER.r); p.x = c.x; p.y = c.y; return; }
    const near = this.nearInteract();
    if (!near) return;
    if (near.kind === 'car') {
      const car = near.car;
      const wasDriven = car.driver === 'ai';
      if (car.kind === 'traffic' || car.kind === 'parked' || car.kind === 'mission' || car.kind === 'police') {
        if (car.tag !== 'owned' && !car.everStolen) { car.everStolen = true; this.stats.carsStolen++; this.addHeat(car.kind === 'police' ? 150 : CRIME.steal); if (wasDriven) this.toast('Carjacked!'); }
      }
      car.driver = 'player'; car.parked = false; p.car = car; p.x = car.x; p.y = car.y;
      this.emit('enter');
      return;
    }
    this.placeInteract(near.place);
  }
  spend(n) { if (this.player.money < n) { this.toast('Not enough cash'); return false; } this.player.money -= n; return true; }
  placeInteract(pl) {
    const p = this.player;
    switch (pl.id) {
      case 'clinic': if (p.hp >= PLAYER.hp) { this.toast('Already at full health'); return; } if (this.spend(PRICES.heal)) { p.hp = PLAYER.hp; this.toast('Patched up'); this.emit('cash'); } return;
      case 'police': if (this.heat <= 0) { this.toast('No heat to clear'); return; } if (this.spend(PRICES.bribe)) { this.heat = 0; this.toast('The desk sergeant looks away'); this.emit('cash'); } return;
      case 'hotel': if (this.spend(PRICES.hotel)) { p.hp = Math.min(PLAYER.hp, p.hp + 30); this.timeMin = (this.timeMin + 240) % (24 * 60); this.toast('Rested at Hotel Lumina — saved'); this.emit('save'); this.emit('cash'); } return;
      case 'safehouse': this.heat = Math.max(0, this.heat - 200); this.toast('Lying low at Casa Segura — saved'); this.emit('save'); return;
      case 'market': {
        if (!p.owned.smg && p.money >= WEAPONS.smg.price) { p.money -= WEAPONS.smg.price; p.owned.smg = true; p.weapon = 'smg'; this.toast('Bought the SMG'); this.emit('cash'); }
        else if (!p.owned.shotgun && p.money >= WEAPONS.shotgun.price) { p.money -= WEAPONS.shotgun.price; p.owned.shotgun = true; p.weapon = 'shotgun'; this.toast('Bought the Shotgun'); this.emit('cash'); }
        else if (this.spend(PRICES.snack)) { p.hp = Math.min(PLAYER.hp, p.hp + 25); this.toast('Snack +25 HP'); this.emit('cash'); }
        return; }
      case 'carlot': {
        if (!this.spend(PRICES.car)) return;
        const old = this.cars.find(c => c.tag === 'owned'); if (old) this.cars.splice(this.cars.indexOf(old), 1);
        const car = this.makeCar(this.city.missionSpots.job.x, this.city.missionSpots.job.y, 0, 'sedan', 'owned');
        car.tag = 'owned'; car.everStolen = true; this.cars.push(car); this.toast('A sedan is yours — parked on the forecourt'); this.emit('cash'); return; }
      case 'garage': {
        const car = p.car || this.cars.find(c => c.tag === 'owned');
        if (!car) { this.toast('No car to repair'); return; }
        if (car.hp >= 100) { this.toast('Car is already pristine'); return; }
        if (this.spend(PRICES.repair)) { car.hp = 100; car.wrecked = false; this.toast('Taller Sol fixed her up'); this.emit('cash'); } return; }
      case 'bank': {
        if (this.bankCd > 0) { this.toast('The side vault is still re-arming'); return; }
        if (this.currentStep && this.currentStep.t === 'channel') { this.toast('The story vault comes first'); return; }
        this.channel = { x: pl.x, y: pl.y, dur: BANK_SIDE.channel, t: 0, kind: 'bank' }; return; }
    }
  }

  // ---------- channels & missions ----------
  updateChannel(inp, dt) {
    const p = this.player, s = this.currentStep;
    if (!this.channel && s && s.t === 'channel' && !p.car && dist(p.x, p.y, s.x, s.y) < 58)
      this.channel = { x: s.x, y: s.y, dur: s.dur, t: 0, kind: 'mission' };
    if (!this.channel) return;
    if (p.car || dist(p.x, p.y, this.channel.x, this.channel.y) > 68) { this.channel = null; return; }
    this.channel.t += dt;
    if (this.channel.t >= this.channel.dur) {
      const kind = this.channel.kind; this.channel = null;
      if (kind === 'bank') { p.money += BANK_SIDE.reward; this.bankCd = BANK_SIDE.cooldown; this.addHeat(BANK_SIDE.heat); this.toast('Side vault emptied +$' + BANK_SIDE.reward); this.emit('cash'); }
      else { if (this.currentStep && this.currentStep.heat) this.addHeat(this.currentStep.heat); this.completeStep(); }
    }
  }
  objective() {
    const s = this.currentStep, p = this.player;
    if (!s) return this.storyComplete ? { label: 'Free roam — Neon Bay is yours', x: p.x, y: p.y, dist: 0 } : null;
    if (s.t === 'escape') return { label: s.label, x: p.x, y: p.y, dist: 0 };
    if (s.t === 'kill') { const alive = this.peds.filter(d => d.kind === 'dealer' && !d.dead); const d0 = alive[0]; return { label: s.label + ' (' + (s.n - alive.length) + '/' + s.n + ')', x: d0 ? d0.x : p.x, y: d0 ? d0.y : p.y, dist: d0 ? dist(p.x, p.y, d0.x, d0.y) : 0 }; }
    return { label: s.label, x: s.x, y: s.y, dist: dist(p.x, p.y, s.x, s.y) };
  }
  spawnStepNeeds() {
    const s = this.currentStep; if (!s) return;
    if (s.t === 'kill' && !this.peds.some(d => d.kind === 'dealer')) {
      for (const spot of this.city.dealers) this.peds.push({ id: this.rng.int(1, 1e9), kind: 'dealer', x: spot.x, y: spot.y, a: -Math.PI / 2, hp: 60, state: 'guard', tx: spot.x, ty: spot.y, t: 0, fireCd: 0.4, dead: false, hue: 0, aggro: false });
    }
    if ((s.t === 'steal' || s.t === 'deliver') && s.car) {
      const mc = this.missionCar(s.car);
      if (mc && mc.wrecked && this.player.car !== mc) { this.cars.splice(this.cars.indexOf(mc), 1); this.spawnMissionCar(s.car); }
      else if (!mc && !this.player.car) this.spawnMissionCar(s.car);
    }
  }
  updateMissions(dt) {
    const s = this.currentStep, p = this.player;
    if (!s) return;
    this.spawnStepNeeds();
    let done = false;
    switch (s.t) {
      case 'goto': done = dist(p.x, p.y, s.x, s.y) < 95; break;
      case 'meet': done = dist(p.x, p.y, s.x, s.y) < 95; break;
      case 'steal': done = !!(p.car && p.car.tag === s.car); break;
      case 'deliver': done = s.car ? !!(p.car && p.car.tag === s.car && dist(p.x, p.y, s.x, s.y) < 125) : dist(p.x, p.y, s.x, s.y) < 95; break;
      case 'pickup': done = !p.car && dist(p.x, p.y, s.x, s.y) < 55; if (done && s.heat) this.addHeat(s.heat); break;
      case 'kill': done = this.peds.filter(d => d.kind === 'dealer' && !d.dead).length === 0 && this.peds.some(d => d.kind === 'dealer'); break;
      case 'channel': break; // completed by updateChannel
      case 'escape': if (this.heat < 1) { this.escapeT += dt; done = this.escapeT >= 1; } else this.escapeT = 0; break;
    }
    if (done) this.completeStep();
  }
  completeStep() {
    const m = this.mission;
    this.stepIdx++;
    if (this.stepIdx >= m.steps.length) {
      this.player.money += m.reward;
      this.stats.missionsDone++;
      this.stats.bestMoney = Math.max(this.stats.bestMoney, this.player.money);
      this.toast(m.title + ' complete +$' + m.reward);
      this.emit('jingle'); this.emit('save');
      this.missionIdx++; this.stepIdx = 0; this.escapeT = 0;
      if (this.missionIdx >= this.missions.length) { this.storyComplete = true; this.storyNoticeT = 7; this.toast('STORY COMPLETE — Bay Legend'); }
      else this.toast(this.missions[this.missionIdx].title + ' — ' + this.missions[this.missionIdx].intro);
      if (m.id === 'm1') { this.player.owned.pistol = true; this.player.weapon = 'pistol'; this.toast('You got the Pistol'); }
    }
  }

  // ---------- busted / wasted ----------
  updateBusted(dt) {
    const p = this.player;
    let threat = false;
    // A grab needs the suspect slow or cornered: nobody gets cuffed at a full sprint.
    if (!p.car && p.speed < 240) for (const o of this.peds) if (o.kind === 'officer' && !o.dead && dist(o.x, o.y, p.x, p.y) < 46) threat = true;
    // In a car you are only busted when genuinely boxed in: two or more units close while you crawl.
    if (this.heat > 0 && p.speed < 40) { let near = 0; for (const c of this.cars) if (c.kind === 'police' && !c.wrecked && dist(c.x, c.y, p.x, p.y) < 85) near++; if (near >= 2) threat = true; }
    if (threat && this.heat > 0) this.bustedMeter += dt / 2.2; else this.bustedMeter = Math.max(0, this.bustedMeter - dt * 0.7);
    if (this.bustedMeter >= 1) this.punish('busted');
  }
  punish(kind) {
    const p = this.player, fine = Math.min(p.money, FINE.base + FINE.perStar * this.stars);
    p.money -= fine;
    const at = placeById(this.city, kind === 'wasted' ? 'clinic' : 'police');
    if (p.car) { p.car.driver = null; p.car = null; }
    p.x = at.x; p.y = at.y; p.hp = PLAYER.hp; this.heat = 0; this.bustedMeter = 0; this.channel = null;
    for (const ped of this.peds) if (ped.kind === 'officer') { ped.dead = true; ped.deadT = 0; }
    for (const c of this.cars) if (c.kind === 'police') c.kind = 'traffic', c.driver = 'ai';
    if (this.mission) { this.stepIdx = 0; this.peds = this.peds.filter(d => d.kind !== 'dealer'); }
    this.notice = { kind, t: 2.6, fine };
    this.emit(kind);
    this.toast(kind === 'wasted' ? 'WASTED — the clinic patched you up, fine $' + fine : 'BUSTED — fine $' + fine);
  }

  // ---------- save / restore ----------
  serialize() {
    const p = this.player, owned = this.cars.find(c => c.tag === 'owned');
    return { v: 3, money: p.money, hp: p.hp, x: Math.round(p.x), y: Math.round(p.y), missionIdx: this.missionIdx,
      weapons: Object.keys(p.owned).filter(k => p.owned[k]), weapon: p.weapon, timeMin: Math.round(this.timeMin),
      stats: { ...this.stats }, storyComplete: this.storyComplete,
      ownedCar: owned ? { type: owned.type, color: owned.color, x: Math.round(owned.x), y: Math.round(owned.y), a: owned.a, hp: owned.hp } : null };
  }
  restore(d) {
    const p = this.player;
    p.money = d.money; p.hp = d.hp; p.x = d.x; p.y = d.y; p.car = null;
    p.owned = { fist: true }; for (const w of d.weapons) p.owned[w] = true;
    p.weapon = d.weapon || 'fist';
    this.missionIdx = d.missionIdx; this.stepIdx = 0; this.timeMin = d.timeMin;
    this.stats = { ...this.stats, ...d.stats }; this.storyComplete = !!d.storyComplete;
    this.heat = 0; this.bustedMeter = 0; this.channel = null; this.notice = null;
    this.peds = this.peds.filter(x => x.kind === 'walker');
    this.cars = this.cars.filter(c => c.kind === 'traffic' || c.kind === 'parked');
    if (d.ownedCar) { const car = this.makeCar(d.ownedCar.x, d.ownedCar.y, d.ownedCar.a, d.ownedCar.type, 'owned'); car.tag = 'owned'; car.color = d.ownedCar.color; car.hp = d.ownedCar.hp; car.everStolen = true; this.cars.push(car); }
    const s = this.currentStep;
    if (s && (s.t === 'steal' || s.t === 'deliver') && s.car && !this.missionCar(s.car)) this.spawnMissionCar(s.car);
    if (s && s.t === 'kill') this.spawnStepNeeds();
  }
  // Deterministic snapshot for tests.
  hash() {
    const p = this.player;
    const parts = [Math.round(p.x), Math.round(p.y), p.money, this.missionIdx, this.stepIdx, this.cars.length, this.peds.length,
      ...this.cars.slice(0, 6).map(c => Math.round(c.x) + ':' + Math.round(c.y))];
    return parts.join('|');
  }
}
