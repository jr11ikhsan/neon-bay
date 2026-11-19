// NEON BAY — the simulation. Everything that moves, breaks, pays or arrests
// lives here; the renderer only reads it and the headless tests drive it
// through `control` exactly like the browser input does.
//
// One naming care, learned the hard way in an earlier build: the mission
// step accessor is `currentStep()` and the per-frame advance is `tick()` —
// no property and method ever share a name in this class.

import { createCity, collideCircle, lineOfSight, isOnRoad, nearestIntersection } from './city.js';
import { MISSIONS } from './missions.js';
import { Rng, clamp, dist, angDiff } from './random.js';
import { WORLD, STEP, DAY, PLAYER, WANTED, WEAPONS, WEAPON_ORDER, CAR_TYPES, TRAFFIC, PEDS, POLICE, PRICES } from './config.js';

const LANE = 26; // right-hand traffic offset from a road centre line

export class World {
  constructor(seed = 1) {
    this.seed = seed;
    this.city = createCity(seed);
    this.rng = new Rng(seed * 31 + 7);       // simulation stream
    this.rngSpawn = new Rng(seed * 131 + 3); // spawn stream
    this.t = 0;
    this.timeMinutes = DAY.start;
    this.money = 0;
    this.heat = 0;
    this.lastSeenT = -99;
    this.lastSeen = { x: this.city.spawn.x, y: this.city.spawn.y };
    this.bustMeter = 0;
    this.channel = { progress: 0, step: null };
    this.bankCooldown = 0;
    this.storyComplete = false;
    this.missionIndex = 0;
    this.stepIndex = 0;
    this.saveRequest = false;
    this.lastCard = null;                    // 'busted' | 'wasted' (for the shell)
    this.events = [];                        // audio/UI event strings
    this.toasts = [];                        // {text, until}
    this.fx = { tracers: [], parts: [] };
    this.stats = { missions: 0, stolen: 0, shots: 0, hits: 0, busted: 0, wasted: 0, timePlayed: 0, earned: 0 };
    this.control = { mx: 0, my: 0, aimX: 0, aimY: 0, fire: false, interact: false, sprint: false };
    this.weapons = { fists: true, pistol: false, smg: false, shotgun: false };
    this.weapon = 'fists';
    this.fireCd = 0; this.crimeCd = 0; this.marketIdx = 0; this.exitGraceT = 0;

    const s = this.city.spawn;
    this.player = {
      x: s.x, y: s.y, a: -Math.PI / 2, hp: PLAYER.hp, maxHp: PLAYER.hp,
      inCar: null, speedNow: 0, walkPhase: 0, dead: false,
    };
    this.cars = [];
    this.peds = [];
    this.pickups = [];
    this.ownedCar = null;
    this.targetCar = null;                   // coupe / jobcar of the live step
    this._carId = 1; this._pedId = 1;

    this.spawnParked();
    this.spawnWalkers();
    for (let i = 0; i < TRAFFIC.count; i++) this.spawnTraffic(true);
    for (let i = 0; i < POLICE.maxUnits; i++) this.spawnCop();
    this.startMission(0);
  }

  // ------------------------------------------------------------- helpers
  get stars() {
    let s = 0;
    for (let i = 0; i < WANTED.thresholds.length; i++) if (this.heat >= WANTED.thresholds[i]) s = i;
    return s;
  }
  toast(text, dur = 3.2) { this.toasts.push({ text, until: this.t + dur }); }
  emit(name) { this.events.push(name); }
  currentStep() {
    const m = MISSIONS[this.missionIndex];
    return m ? m.steps[this.stepIndex] || null : null;
  }
  currentMission() { return MISSIONS[this.missionIndex] || null; }

  missionTarget() {
    const st = this.currentStep();
    if (!st) return null;
    const P = this.city.places;
    switch (st.type) {
      case 'steal': return this.targetCar ? { x: this.targetCar.x, y: this.targetCar.y } : null;
      case 'deliver': return { x: P[st.at].x, y: P[st.at].y };
      case 'pickup': return { x: this.city.packageSpot.x, y: this.city.packageSpot.y };
      case 'goto': case 'channel': return { x: P[st.at].x, y: P[st.at].y };
      case 'meet': return { x: this.city.plaza.x, y: this.city.plaza.y };
      case 'kill': {
        let best = null, bd = Infinity;
        for (const p of this.peds) if (p.kind === 'dealer' && p.hp > 0) {
          const d = dist(this.player.x, this.player.y, p.x, p.y);
          if (d < bd) { bd = d; best = p; }
        }
        return best ? { x: best.x, y: best.y } : null;
      }
      case 'escape': return { x: P.safehouse.x, y: P.safehouse.y };
      default: return null;
    }
  }

  // ------------------------------------------------------------- spawning
  makeCar(x, y, a, type, kind) {
    const spec = CAR_TYPES[type];
    const car = {
      id: this._carId++, x, y, a, speed: 0, type, kind,
      top: spec.top, accel: spec.accel, grip: spec.grip,
      hp: spec.hp, maxHp: spec.hp, radius: 30,
      color: spec.colors[Math.floor(this.rngSpawn.next() * spec.colors.length) % spec.colors.length],
      driver: null, parked: kind !== 'traffic', dead: false,
      // traffic AI
      axis: Math.abs(Math.sin(a)) > 0.7 ? 'v' : 'h', dir: 0, cruise: 165 + this.rngSpawn.next() * 55,
      stuckT: 0, honk: 0,
      // police AI
      flank: 0, boxT: 0, regroupT: 0, officer: null, searchT: 0,
      wreckToast: false,
    };
    car.dir = car.axis === 'v' ? (Math.sin(a) > 0 ? 1 : -1) : (Math.cos(a) > 0 ? 1 : -1);
    if (car.axis === 'v') car.dir = Math.sin(a) >= 0 ? 1 : -1; else car.dir = Math.cos(a) >= 0 ? 1 : -1;
    this.cars.push(car);
    return car;
  }

  spawnParked() {
    const spots = [];
    for (const lot of this.city.lots) for (let i = 0; i < 10; i++) spots.push({ x: lot.x + 60 + (i % 5) * 84, y: lot.y + 120 + Math.floor(i / 5) * 150 });
    for (const ax of this.city.avenues) for (let i = 0; i < 3; i++) spots.push({ x: ax + 44, y: 200 + i * 1150 + this.rngSpawn.next() * 300 });
    let n = 0;
    for (const s of spots) {
      if (n++ >= TRAFFIC.parked) break;
      if (dist(s.x, s.y, 720, 700) < 130) continue; // keep the mission bay clear
      const type = this.rngSpawn.pick(['sedan', 'sedan', 'taxi', 'van', 'pickup']);
      const car = this.makeCar(s.x, s.y, Math.PI / 2, type, 'parked');
      car.parked = true;
    }
  }

  spawnTraffic(anywhere = false) {
    const p = this.player;
    for (let tries = 0; tries < 8; tries++) {
      const inter = this.rngSpawn.pick(this.city.avenues.map(ax => this.city.streets.map(sy => ({ x: ax, y: sy }))).flat());
      const d = dist(inter.x, inter.y, p.x, p.y);
      if (!anywhere && (d < 700 || d > TRAFFIC.spawnDist)) continue;
      if (anywhere && d < 260) continue;
      const vertical = this.rngSpawn.chance(0.5);
      const a = vertical ? (this.rngSpawn.chance(0.5) ? -Math.PI / 2 : Math.PI / 2) : (this.rngSpawn.chance(0.5) ? 0 : Math.PI);
      const type = this.rngSpawn.pick(['sedan', 'sedan', 'taxi', 'van', 'pickup', 'sport']);
      const car = this.makeCar(inter.x, inter.y, a, type, 'traffic');
      car.driver = 'ai'; car.parked = false;
      car.axis = vertical ? 'v' : 'h';
      car.dir = vertical ? Math.sign(Math.sin(a)) : Math.sign(Math.cos(a));
      return car;
    }
    return null;
  }

  spawnCop() {
    const inter = this.rngSpawn.pick([{ x: 1620, y: 1620 }, { x: 2820, y: 1020 }, { x: 1020, y: 2820 }, { x: 3420, y: 2220 }, { x: 2220, y: 420 }]);
    const car = this.makeCar(inter.x + this.cars.length * 40, inter.y, 0, 'cop', 'cop');
    car.driver = 'ai'; car.parked = false; car.axis = 'h'; car.dir = 1;
    car.flank = (this.cars.filter(c => c.kind === 'cop').length % 3) - 1;
    return car;
  }

  makePed(x, y, kind) {
    const ped = {
      id: this._pedId++, x, y, a: this.rngSpawn.next() * Math.PI * 2,
      hp: kind === 'officer' ? POLICE.officerHp : kind === 'dealer' ? 50 : 30,
      kind, state: 'wander', tx: x, ty: y, fireCd: 0, fleeT: 0, homeCar: null, dead: false, walkPhase: 0,
    };
    this.peds.push(ped);
    return ped;
  }

  spawnWalkers() {
    for (let i = 0; i < PEDS.walkers; i++) {
      let x, y;
      if (i % 5 === 4) { x = this.city.boardwalkX + this.rngSpawn.range(-14, 40); y = this.rngSpawn.range(120, WORLD.h - 120); }
      else {
        const ax = this.rngSpawn.pick(this.city.avenues), sy = this.rngSpawn.pick(this.city.streets);
        if (this.rngSpawn.chance(0.5)) { x = ax + this.rngSpawn.sign() * (this.city.roadHalf + 16); y = this.rngSpawn.range(80, WORLD.h - 80); }
        else { x = this.rngSpawn.range(80, this.city.sandX - 60); y = sy + this.rngSpawn.sign() * (this.city.roadHalf + 16); }
      }
      this.makePed(x, y, 'walker');
    }
  }

  // ------------------------------------------------------------- missions
  startMission(i) {
    this.stepIndex = 0;
    const m = MISSIONS[i];
    if (m) { this.toast(m.title + ' — ' + m.brief, 5); this.spawnStepNeeds(); }
  }

  spawnStepNeeds() {
    const st = this.currentStep();
    if (!st) return;
    if (st.type === 'steal') {
      const want = st.target === 'coupe' ? { x: 760, y: 700, color: 0xf4d35e } : { x: 600, y: 780, color: 0x22d3ee };
      const stale = !this.targetCar || this.targetCar.missionTarget !== st.target || this.targetCar.dead || this.targetCar.hp <= 0;
      if (stale) {
        this.targetCar = this.makeCar(want.x, want.y, Math.PI / 2, 'sport', 'mission');
        this.targetCar.color = want.color;
        this.targetCar.missionTarget = st.target;
      }
    }
    if (st.type === 'kill' && !this.peds.some(p => p.kind === 'dealer' && p.hp > 0)) {
      for (const s of this.city.beachSpots) this.makePed(s.x, s.y, 'dealer');
    }
    if (st.type === 'pickup' && !this.pickups.some(p => p.kind === 'package')) {
      this.pickups.push({ x: this.city.packageSpot.x, y: this.city.packageSpot.y, kind: 'package', active: true });
    }
  }

  advanceStep() {
    const m = this.currentMission();
    this.stepIndex++;
    this.channel.progress = 0;
    if (this.stepIndex >= m.steps.length) {
      this.money += m.reward; this.stats.earned += m.reward; this.stats.missions++;
      this.emit('mission'); this.toast(m.title + ' complete — $' + m.reward, 4);
      if (m.id === 'm1' && !this.weapons.pistol) { this.weapons.pistol = true; this.toast('You got the Pistol', 3.5); }
      this.missionIndex++;
      this.events.push('autosave');
      if (this.missionIndex >= MISSIONS.length) { this.storyComplete = true; this.toast('STORY COMPLETE — Bay Legend', 6); }
      else this.startMission(this.missionIndex);
    } else this.spawnStepNeeds();
  }

  // ------------------------------------------------------------- crime & heat
  witnessed(x, y, radius = 280) {
    for (const c of this.cars) if (c.kind === 'cop' && !c.dead && dist(x, y, c.x, c.y) < 640 && lineOfSight(this.city, x, y, c.x, c.y)) return true;
    for (const p of this.peds) {
      if (p.dead) continue;
      if (p.kind === 'officer' && dist(x, y, p.x, p.y) < 520 && lineOfSight(this.city, x, y, p.x, p.y)) return true;
      if (p.kind === 'walker' && dist(x, y, p.x, p.y) < radius && lineOfSight(this.city, x, y, p.x, p.y)) return true;
    }
    return false;
  }

  addCrime(amount, x = this.player.x, y = this.player.y, victim = null) {
    const seen = victim || this.witnessed(x, y);
    if (seen) {
      this.heat += amount;
      this.lastSeenT = this.t; this.lastSeen = { x: this.player.x, y: this.player.y };
    } else this.heat += amount * 0.2;
  }

  addHeatDirect(amount) {
    this.heat += amount;
    this.lastSeenT = this.t; this.lastSeen = { x: this.player.x, y: this.player.y };
  }

  spottedNow() {
    const p = this.player;
    for (const c of this.cars) if (c.kind === 'cop' && !c.dead && dist(p.x, p.y, c.x, c.y) < 560 && lineOfSight(this.city, p.x, p.y, c.x, c.y)) return true;
    for (const ped of this.peds) if (ped.kind === 'officer' && !ped.dead && dist(p.x, p.y, ped.x, ped.y) < 460 && lineOfSight(this.city, p.x, p.y, ped.x, ped.y)) return true;
    return false;
  }

  // ------------------------------------------------------------- interaction
  nearPlace() {
    let best = null, bd = PLAYER.placeRange;
    for (const id in this.city.places) {
      const pl = this.city.places[id];
      const d = dist(this.player.x, this.player.y, pl.x, pl.y);
      if (d < bd) { bd = d; best = pl; }
    }
    return best ? { place: best, d: bd } : null;
  }
  nearCar() {
    let best = null, bd = PLAYER.enterRange;
    for (const c of this.cars) {
      if (c.dead || c === this.player.inCar) continue;
      const d = dist(this.player.x, this.player.y, c.x, c.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? { car: best, d: bd } : null;
  }

  marketOffer() {
    if (!this.weapons.smg) return { item: 'smg', label: 'SMG', price: WEAPONS.smg.price };
    if (!this.weapons.shotgun) return { item: 'shotgun', label: 'Shotgun', price: WEAPONS.shotgun.price };
    return { item: 'snack', label: 'Snack (+25 HP)', price: PRICES.snack };
  }

  prompt() {
    const p = this.player, P = this.city.places;
    if (p.inCar) {
      const g = P.garage;
      if (dist(p.x, p.y, g.x, g.y) < 100 && p.inCar.hp < p.inCar.maxHp) return { kind: 'repair', text: 'E — Repair car $' + PRICES.repair };
      return { kind: 'exit', text: 'E — Exit car' };
    }
    const np = this.nearPlace(), nc = this.nearCar();
    if (nc && nc.d < 46 && !(np && np.d < 30)) return { kind: 'car', text: nc.car.kind === 'mission' ? 'E — Steal the car' : 'E — Enter car' };
    if (np) {
      const id = np.place.id;
      if (id === 'clinic') return { kind: 'place', id, text: this.player.hp >= this.player.maxHp ? 'Clínica Sol — you are fine' : 'E — Heal $' + PRICES.clinic };
      if (id === 'police') return { kind: 'place', id, text: this.heat > 0 ? 'E — Bribe the sergeant $' + PRICES.bribe : 'Comisaría — no heat on you' };
      if (id === 'hotel') return { kind: 'place', id, text: 'E — Room, rest & save $' + PRICES.hotel };
      if (id === 'safehouse') return { kind: 'place', id, text: 'E — Save & lie low' };
      if (id === 'market') { const o = this.marketOffer(); return { kind: 'place', id, text: 'E — Buy ' + o.label + ' $' + o.price }; }
      if (id === 'carlot') return { kind: 'place', id, text: this.ownedCar ? 'E — Collect your car' : 'E — Buy the sport coupe $' + PRICES.car };
      if (id === 'garage') return { kind: 'place', id, text: 'E — Repair $' + PRICES.repair };
      if (id === 'bank') {
        const st = this.currentStep();
        if (st && st.type === 'channel' && st.at === 'bank') return { kind: 'channel', text: 'Cracking the vault… hold your ground' };
        return { kind: 'channel', text: this.bankCooldown > 0 ? 'Side vault empty — come back later' : 'Stand here to crack the side vault' };
      }
    }
    if (nc) return { kind: 'car', text: nc.car.kind === 'cop' ? 'E — Steal police car' : 'E — Enter car' };
    return null;
  }

  doInteract() {
    const p = this.player;
    if (p.inCar) {
      const pr = this.prompt();
      if (pr && pr.kind === 'repair') { this.repairCar(p.inCar); return; }
      this.exitCar(); return;
    }
    const np = this.nearPlace(), nc = this.nearCar();
    if (nc && nc.d < 46 && !(np && np.d < 30)) { this.enterCar(nc.car); return; }
    if (np) { this.doPlace(np.place.id); return; }
    if (nc) this.enterCar(nc.car);
  }

  repairCar(car) {
    if (this.money < PRICES.repair) { this.toast('Need $' + PRICES.repair); return; }
    if (car.hp >= car.maxHp) { this.toast('Car is already fine'); return; }
    this.money -= PRICES.repair; car.hp = car.maxHp; this.emit('cash'); this.toast('Repaired — $' + PRICES.repair);
  }

  doPlace(id) {
    const p = this.player;
    switch (id) {
      case 'clinic':
        if (p.hp >= p.maxHp) { this.toast('You are already fine'); return; }
        if (this.money < PRICES.clinic) { this.toast('Need $' + PRICES.clinic); return; }
        this.money -= PRICES.clinic; p.hp = p.maxHp; this.emit('cash'); this.toast('Patched up — $' + PRICES.clinic); return;
      case 'police':
        if (this.heat <= 0) { this.toast('No heat to clear'); return; }
        if (this.money < PRICES.bribe) { this.toast('Need $' + PRICES.bribe); return; }
        this.money -= PRICES.bribe; this.heat = 0; this.bustMeter = 0; this.emit('cash'); this.toast('The sergeant looks the other way'); return;
      case 'hotel':
        if (this.money < PRICES.hotel) { this.toast('Need $' + PRICES.hotel); return; }
        this.money -= PRICES.hotel; p.hp = Math.min(p.maxHp, p.hp + 30); this.saveRequest = true; this.emit('cash'); this.toast('Rested and saved — $' + PRICES.hotel); return;
      case 'safehouse':
        this.heat = Math.max(0, this.heat - PRICES.lieLow); this.saveRequest = true; this.toast('Saved. You lie low for a while.'); return;
      case 'market': {
        const o = this.marketOffer();
        if (this.money < o.price) { this.toast('Need $' + o.price); return; }
        this.money -= o.price; this.emit('cash');
        if (o.item === 'snack') { p.hp = Math.min(p.maxHp, p.hp + 25); this.toast('Snack — +25 HP'); }
        else { this.weapons[o.item] = true; this.weapon = o.item; this.toast('Bought the ' + o.label); }
        return;
      }
      case 'carlot':
        if (this.ownedCar && !this.ownedCar.dead) {
          this.ownedCar.x = 840; this.ownedCar.y = 780; this.ownedCar.speed = 0; this.ownedCar.hp = this.ownedCar.maxHp;
          this.toast('Your car is waiting at Bay Motors'); return;
        }
        if (this.money < PRICES.car) { this.toast('Need $' + PRICES.car); return; }
        this.money -= PRICES.car; this.emit('cash');
        this.ownedCar = this.makeCar(840, 780, Math.PI / 2, 'sport', 'owned');
        this.ownedCar.color = 0xd7263d; this.toast('The red sport coupe is yours'); return;
      case 'garage': {
        const target = this.ownedCar && dist(p.x, p.y, this.ownedCar.x, this.ownedCar.y) < 160 ? this.ownedCar : null;
        if (target) this.repairCar(target); else this.toast('Bring a car to repair');
        return;
      }
      case 'bank': this.toast('The vault needs a moment in place — stand at the door'); return;
    }
  }

  enterCar(car) {
    const p = this.player;
    if (car.driver === 'ai' && car.kind === 'traffic') {
      // Carjack: the driver bails out and runs.
      const ped = this.makePed(car.x + Math.cos(car.a + Math.PI / 2) * 34, car.y + Math.sin(car.a + Math.PI / 2) * 34, 'walker');
      ped.state = 'flee'; ped.fleeT = 3; ped.tx = ped.x + 200; ped.ty = ped.y;
      this.addCrime(WANTED.crimeCarjack, car.x, car.y);
      this.stats.stolen++;
    }
    if (car.kind === 'cop') { this.addCrime(120, car.x, car.y); this.stats.stolen++; }
    if (car.kind === 'parked' || car.kind === 'mission') this.stats.stolen++;
    car.driver = 'player'; car.parked = false;
    p.inCar = car; p.x = car.x; p.y = car.y;
    this.emit('door');
  }

  exitCar() {
    const p = this.player, car = p.inCar;
    if (!car) return;
    car.driver = null; if (car.kind === 'traffic') car.parked = true;
    p.x = car.x + Math.cos(car.a - Math.PI / 2) * 40; p.y = car.y + Math.sin(car.a - Math.PI / 2) * 40;
    const [nx, ny] = collideCircle(this.city, p.x, p.y, PLAYER.radius); p.x = nx; p.y = ny;
    p.inCar = null;
    this.exitGraceT = 1.1; // a breath after stepping out: traffic contact is not a crime
  }

  // ------------------------------------------------------------- outcomes
  busted() {
    const fine = Math.min(this.money, 100 + this.stars * 50);
    this.money -= fine; this.stats.busted++;
    this.heat = 0; this.bustMeter = 0; this.lastCard = 'busted'; this.emit('busted');
    if (this.player.inCar) { this.player.inCar.driver = null; this.player.inCar = null; }
    const d = this.city.places.police;
    this.player.x = d.x; this.player.y = d.y + 26; this.player.hp = Math.max(this.player.hp, 50);
    this.toast('BUSTED — fined $' + fine);
  }
  wasted() {
    const fine = Math.min(this.money, 80 + this.stars * 40);
    this.money -= fine; this.stats.wasted++;
    this.heat = 0; this.bustMeter = 0; this.lastCard = 'wasted'; this.emit('wasted');
    if (this.player.inCar) { this.player.inCar.driver = null; this.player.inCar = null; }
    const d = this.city.places.clinic;
    this.player.x = d.x; this.player.y = d.y + 26; this.player.hp = this.player.maxHp;
    this.toast('WASTED — the clinic bills you $' + fine);
  }

  // ------------------------------------------------------------- combat
  fireWeapon(dt) {
    const p = this.player;
    const w = WEAPONS[this.weapon];
    if (this.fireCd > 0) return;
    if (this.weapon === 'fists') {
      this.fireCd = w.rate; this.emit('punch');
      for (const ped of this.peds) {
        if (ped.dead) continue;
        if (dist(p.x, p.y, ped.x, ped.y) < w.range + 12 && Math.abs(angDiff(p.a, Math.atan2(ped.y - p.y, ped.x - p.x))) < 1.1) {
          this.hurtPed(ped, w.dmg, Math.atan2(ped.y - p.y, ped.x - p.x));
        }
      }
      return;
    }
    this.fireCd = w.rate; this.stats.shots++; this.emit('shot');
    if (this.crimeCd <= 0) { this.addCrime(WANTED.crimeShot); this.crimeCd = 0.5; }
    const baseA = Math.atan2(this.control.aimY - p.y, this.control.aimX - p.x);
    for (let i = 0; i < w.pellets; i++) {
      const a = baseA + (this.rng.next() - 0.5) * 2 * w.spread * 3;
      this.fireRay(p.x, p.y, a, w);
    }
  }

  fireRay(x, y, a, w) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let bestT = w.range, hitPed = null, hitCar = null;
    for (const ped of this.peds) {
      if (ped.dead) continue;
      const t = (ped.x - x) * dx + (ped.y - y) * dy;
      if (t < 0 || t > bestT) continue;
      const px = x + dx * t, py = y + dy * t;
      if (dist(px, py, ped.x, ped.y) < 15) { bestT = t; hitPed = ped; hitCar = null; }
    }
    for (const c of this.cars) {
      if (c.dead || c === this.player.inCar) continue;
      const t = (c.x - x) * dx + (c.y - y) * dy;
      if (t < 0 || t > bestT) continue;
      const px = x + dx * t, py = y + dy * t;
      if (dist(px, py, c.x, c.y) < 32) { bestT = t; hitCar = c; hitPed = null; }
    }
    const ex = x + dx * bestT, ey = y + dy * bestT;
    this.fx.tracers.push({ x1: x, y1: y, x2: ex, y2: ey, life: 0.07 });
    if (hitPed) { this.stats.hits++; this.hurtPed(hitPed, w.dmg, a); }
    if (hitCar) { hitCar.hp -= w.dmg; if (hitCar.hp <= 0 && !hitCar.dead) this.wreckCar(hitCar); }
  }

  hurtPed(ped, dmg, fromA) {
    ped.hp -= dmg;
    ped.x += Math.cos(fromA) * 7; ped.y += Math.sin(fromA) * 7;
    if (ped.kind === 'walker') { ped.state = 'flee'; ped.fleeT = 2.5; ped.tx = ped.x - Math.cos(fromA) * 240; ped.ty = ped.y - Math.sin(fromA) * 240; }
    if (ped.hp <= 0 && !ped.dead) {
      ped.dead = true;
      this.addCrime(ped.kind === 'officer' ? 130 : 70, ped.x, ped.y, ped);
      if (ped.kind === 'dealer') this.pickups.push({ x: ped.x, y: ped.y, kind: 'money', amount: this.rng.int(15, 40), active: true });
      else if (ped.kind === 'walker' && this.rng.chance(0.4)) this.pickups.push({ x: ped.x, y: ped.y, kind: 'money', amount: this.rng.int(5, 20), active: true });
      if (ped.kind === 'officer') for (const c of this.cars) if (c.officer === ped) c.officer = null;
    }
  }

  wreckCar(car) {
    car.dead = true; car.speed = 0;
    if (car.driver === 'player') { this.exitCar(); this.toast('Your ride is wrecked'); }
    car.driver = null;
    if (car === this.targetCar) this.spawnStepNeeds(); // a fresh target respawns at the lot
    this.emit('crash');
  }

  hurtPlayer(dmg) {
    const p = this.player;
    if (p.inCar) { p.inCar.hp -= dmg * 0.4; if (p.inCar.hp <= 0) this.wreckCar(p.inCar); return; }
    p.hp -= dmg;
    if (p.hp <= 0) this.wasted();
  }

  // ------------------------------------------------------------- per-frame
  tick(dt) {
    this.t += dt; this.stats.timePlayed += dt;
    this.timeMinutes = (this.timeMinutes + DAY.rate * dt) % (24 * 60);
    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.crimeCd > 0) this.crimeCd -= dt;
    if (this.bankCooldown > 0) this.bankCooldown -= dt;
    if (this.exitGraceT > 0) this.exitGraceT -= dt;
    this.toasts = this.toasts.filter(t => t.until > this.t);
    for (const tr of this.fx.tracers) tr.life -= dt;
    this.fx.tracers = this.fx.tracers.filter(tr => tr.life > 0);
    for (const pt of this.fx.parts) { pt.life -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; }
    this.fx.parts = this.fx.parts.filter(pt => pt.life > 0);

    if (this.control.interact) { this.doInteract(); this.control.interact = false; }
    this.updatePlayer(dt);
    this.updateCars(dt);
    this.updatePeds(dt);
    this.updatePolice(dt);
    this.updateHeat(dt);
    this.updatePickups(dt);
    this.updateMissions(dt);
    // keep the traffic population topped up
    const live = this.cars.filter(c => c.kind === 'traffic' && !c.dead).length;
    if (live < TRAFFIC.count) this.spawnTraffic(false);
  }

  updatePlayer(dt) {
    const p = this.player, c = this.control;
    if (p.inCar) {
      const car = p.inCar;
      this.driveCar(car, c.my, c.mx, dt, true);
      p.x = car.x; p.y = car.y; p.a = car.a; p.speedNow = Math.abs(car.speed);
      if (c.fire && this.weapon !== 'fists') this.fireWeapon(dt); // drive-by with a gun
      return;
    }
    let mx = c.mx, my = c.my;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const sp = c.sprint ? PLAYER.sprint : PLAYER.walk;
    p.x += mx * sp * dt; p.y += my * sp * dt;
    p.speedNow = Math.hypot(mx, my) * sp;
    if (len > 0.05) { p.walkPhase += dt * (c.sprint ? 13 : 9); p.a = Math.atan2(my, mx); }
    if (c.aimX || c.aimY) p.a = Math.atan2(c.aimY - p.y, c.aimX - p.x);
    const [nx, ny] = collideCircle(this.city, p.x, p.y, PLAYER.radius);
    p.x = nx; p.y = ny;
    if (c.fire) this.fireWeapon(dt);
  }

  // Shared car movement: throttle -1..1, steer -1..1.
  driveCar(car, throttle, steer, dt, isPlayer = false) {
    const spec = CAR_TYPES[car.type];
    if (throttle > 0) car.speed += spec.accel * throttle * dt * (car.speed < 0 ? 2.2 : 1);
    else if (throttle < 0) car.speed += spec.accel * throttle * dt * (car.speed > 0 ? 2.4 : 0.55);
    car.speed -= car.speed * 0.55 * dt;                       // drag
    if (!isOnRoad(this.city, car.x, car.y)) car.speed -= car.speed * 0.5 * dt; // sand/grass drag
    car.speed = clamp(car.speed, -130, spec.top);
    // Steering authority scales with speed but never drops under 35% —
    // a car nosed into a wall can always work itself free.
    const auth = clamp(Math.abs(car.speed) / 150, 0.35, 1) * Math.sign(car.speed || 1);
    car.a += steer * spec.grip * auth * dt * clamp(Math.abs(car.speed) / spec.top, 0.25, 1) * 2.2;
    const ox = car.x, oy = car.y;
    car.x += Math.cos(car.a) * car.speed * dt;
    car.y += Math.sin(car.a) * car.speed * dt;
    const [nx, ny] = collideCircle(this.city, car.x, car.y, car.radius);
    if (nx !== car.x || ny !== car.y) {
      const impact = Math.abs(car.speed);
      car.x = nx; car.y = ny;
      if (impact > 190) { car.hp -= (impact - 190) * 0.12; this.emit('crash'); if (car.hp <= 0 && !car.dead) this.wreckCar(car); }
      car.speed *= -0.18;
    }
    // car vs car: soft push-apart, momentum softened
    for (const o of this.cars) {
      if (o === car || o.dead) continue;
      const d = dist(car.x, car.y, o.x, o.y);
      if (d < 56 && d > 0.01) {
        const push = (56 - d) / 2, ux = (car.x - o.x) / d, uy = (car.y - o.y) / d;
        car.x += ux * push; car.y += uy * push;
        if (!o.parked) { o.x -= ux * push; o.y -= uy * push; }
        const rel = Math.abs(car.speed - o.speed);
        if (rel > 120) {
          car.hp -= (rel - 120) * 0.06; o.hp -= (rel - 120) * 0.06;
          this.emit('crash');
          if (isPlayer) this.addCrime(WANTED.crimeHitCar, car.x, car.y);
          if (car.hp <= 0 && !car.dead) this.wreckCar(car);
          if (o.hp <= 0 && !o.dead) this.wreckCar(o);
        }
        car.speed *= 0.88; o.speed *= 0.88;
      }
    }
    // running a pedestrian down
    if (Math.abs(car.speed) > 60) {
      for (const ped of this.peds) {
        if (ped.dead) continue;
        if (dist(car.x, car.y, ped.x, ped.y) < 34) {
          this.hurtPed(ped, 100, car.a);
          if (isPlayer && !(this.exitGraceT > 0)) this.addCrime(WANTED.crimeHitPed, ped.x, ped.y, ped);
          else if (isPlayer) this.addCrime(10, ped.x, ped.y, ped);
          car.speed *= 0.72;
        }
      }
    }
    void ox; void oy;
  }

  updateCars(dt) {
    for (const car of this.cars) {
      if (car.dead || car.driver === 'player') continue;
      if (car.kind === 'cop') continue; // police drive in updatePolice
      if (car.kind !== 'traffic' || car.driver !== 'ai') continue;
      // Lane target: ahead on the current road, offset to the right-hand lane.
      let tx, ty;
      if (car.axis === 'v') {
        const ax = nearestAvenue(this.city, car.x);
        tx = ax + (car.dir > 0 ? -LANE : LANE);
        ty = car.y + car.dir * 300;
      } else {
        const sy = nearestStreet(this.city, car.y);
        tx = car.x + car.dir * 300;
        ty = sy + (car.dir > 0 ? LANE : -LANE);
      }
      // At an intersection, sometimes turn onto the crossing road.
      const inter = nearestIntersection(this.city, car.x, car.y);
      if (dist(car.x, car.y, inter.x, inter.y) < 42 && car.stuckT <= 0) {
        if (this.rng.chance(0.3)) {
          car.axis = car.axis === 'v' ? 'h' : 'v';
          car.dir = this.rng.sign();
          car.a = car.axis === 'v' ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.dir > 0 ? 0 : Math.PI);
        }
        car.stuckT = 1.2; // decision cooldown so it doesn't re-roll every frame in the junction
      }
      if (car.stuckT > 0) car.stuckT -= dt;
      // Edge of the grid: turn around.
      if (car.x < 120 || car.x > this.city.sandX - 60 || car.y < 120 || car.y > WORLD.h - 120) {
        car.axis = car.axis === 'v' ? 'v' : 'h';
        if (car.x < 120 || car.x > this.city.sandX - 60) { car.axis = 'h'; car.dir = car.x < 120 ? 1 : -1; }
        else { car.axis = 'v'; car.dir = car.y < 120 ? 1 : -1; }
      }
      const want = Math.atan2(ty - car.y, tx - car.x);
      let steer = clamp(angDiff(car.a, want) * 1.6, -1, 1);
      // Brake for anything ahead: cars, the player, pedestrians.
      let throttle = car.speed < car.cruise ? 0.75 : 0;
      const aheadX = car.x + Math.cos(car.a) * 86, aheadY = car.y + Math.sin(car.a) * 86;
      const blocked =
        this.cars.some(o => o !== car && !o.dead && dist(aheadX, aheadY, o.x, o.y) < 44) ||
        dist(aheadX, aheadY, this.player.x, this.player.y) < 44 ||
        this.peds.some(pd => !pd.dead && dist(aheadX, aheadY, pd.x, pd.y) < 34);
      if (blocked) throttle = car.speed > 8 ? -0.85 : 0;
      this.driveCar(car, throttle, steer, dt);
      // despawn far-away traffic
      if (dist(car.x, car.y, this.player.x, this.player.y) > TRAFFIC.despawnDist) {
        car.dead = true; car.driver = null;
      }
    }
    this.cars = this.cars.filter(c => !c.dead || c.kind !== 'traffic' || c === this.targetCar || c === this.ownedCar);
  }

  updatePeds(dt) {
    for (const ped of this.peds) {
      if (ped.dead || ped.kind === 'officer') continue;
      if (ped.kind === 'dealer') { this.updateDealer(ped, dt); continue; }
      // walkers
      if (ped.state === 'flee') {
        ped.fleeT -= dt;
        this.movePed(ped, ped.tx, ped.ty, 205, dt);
        if (ped.fleeT <= 0) ped.state = 'wander';
        continue;
      }
      if (dist(ped.x, ped.y, ped.tx, ped.ty) < 18 || ped.tx === ped.x && ped.ty === ped.y) {
        ped.tx = clamp(ped.x + this.rng.range(-420, 420), 40, this.city.waterX - 30);
        ped.ty = clamp(ped.y + this.rng.range(-420, 420), 40, WORLD.h - 40);
        if (!isOnRoad(this.city, ped.tx, ped.ty) && this.rng.chance(0.6)) {
          const inter = nearestIntersection(this.city, ped.tx, ped.ty);
          ped.tx = inter.x + this.rng.sign() * (this.city.roadHalf + 16); ped.ty = inter.y;
        }
      }
      this.movePed(ped, ped.tx, ped.ty, PEDS.speed, dt);
    }
    this.peds = this.peds.filter(p => !p.dead || p.kind === 'dealer');
  }

  movePed(ped, tx, ty, speed, dt) {
    const d = dist(ped.x, ped.y, tx, ty);
    if (d < 4) return;
    const a = Math.atan2(ty - ped.y, tx - ped.x);
    ped.a = a; ped.walkPhase += dt * 8;
    ped.x += Math.cos(a) * speed * dt; ped.y += Math.sin(a) * speed * dt;
    const [nx, ny] = collideCircle(this.city, ped.x, ped.y, 13);
    ped.x = nx; ped.y = ny;
  }

  updateDealer(ped, dt) {
    const p = this.player;
    const d = dist(ped.x, ped.y, p.x, p.y);
    ped.fireCd -= dt;
    const st = this.currentStep();
    const active = st && st.type === 'kill';
    if ((active || ped.provoked) && !p.inCar && d < 350 && lineOfSight(this.city, ped.x, ped.y, p.x, p.y)) {
      ped.a = Math.atan2(p.y - ped.y, p.x - ped.x);
      if (ped.fireCd <= 0) {
        ped.fireCd = 0.95;
        this.fx.tracers.push({ x1: ped.x, y1: ped.y, x2: p.x, y2: p.y, life: 0.07 });
        this.emit('shot');
        if (this.rng.chance(0.42)) this.hurtPlayer(7);
      }
      if (d > 210) this.movePed(ped, p.x, p.y, 120, dt);
    } else if (d < 130) this.movePed(ped, ped.x - (p.x - ped.x), ped.y - (p.y - ped.y), 90, dt);
  }

  // ------------------------------------------------------------- police
  updatePolice(dt) {
    const p = this.player, stars = this.stars;
    for (const car of this.cars) {
      if (car.kind !== 'cop' || car.dead) continue;
      const d = dist(car.x, car.y, p.x, p.y);
      if (stars === 0) {
        // Calm: officers climb back in and the unit patrols like traffic.
        if (car.officer && !car.officer.dead) {
          this.movePed(car.officer, car.x, car.y, 230, dt);
          if (dist(car.officer.x, car.officer.y, car.x, car.y) < 30) { car.officer.dead = true; car.officer = null; car.driver = 'ai'; }
        }
        if (!car.officer && car.driver === 'ai') this.patrolDrive(car, dt);
        continue;
      }
      // Deploy the officer when the suspect is on foot nearby, or boxed in.
      const wantOfficer = (!p.inCar && d < 250) || (p.inCar && Math.abs(p.inCar.speed) < 22 && d < 140);
      if (wantOfficer && !car.officer && car.driver === 'ai') {
        car.driver = null; car.speed = 0;
        const off = this.makePed(car.x + 36, car.y + 10, 'officer');
        off.homeCar = car; car.officer = off;
      }
      if (car.officer && !car.officer.dead) {
        if (p.inCar && Math.abs(p.inCar.speed) > 60) {
          // Suspect is driving off: officer runs back to the unit.
          this.movePed(car.officer, car.x, car.y, 240, dt);
          if (dist(car.officer.x, car.officer.y, car.x, car.y) < 30) { car.officer.dead = true; car.officer = null; car.driver = 'ai'; }
        } else this.updateOfficer(car.officer, dt);
        continue;
      }
      if (car.driver !== 'ai') continue;
      // Pursuit driving: aim at the suspect with a flank offset so units
      // form a net instead of a conga line.
      let tx = p.x, ty = p.y;
      if (d < 430) {
        const perpA = p.a + Math.PI / 2;
        tx += Math.cos(perpA) * car.flank * 135; ty += Math.sin(perpA) * car.flank * 135;
      }
      if (!lineOfSight(this.city, car.x, car.y, p.x, p.y) && d > 300) { tx = this.lastSeen.x; ty = this.lastSeen.y; }
      let want = Math.atan2(ty - car.y, tx - car.x);
      let steer = clamp(angDiff(car.a, want) * 1.7, -1, 1);
      let throttle = 1;
      // Pacing: right behind a slower suspect, match speed instead of ramming through.
      const behind = Math.cos(p.a) * (car.x - p.x) + Math.sin(p.a) * (car.y - p.y) < 0;
      if (behind && d < 165 && p.inCar && Math.abs(car.speed) > Math.abs(p.inCar.speed) + 30) throttle = -0.4;
      // Anti box-lock: boxing a stopped suspect car for too long -> back off and regroup.
      if (p.inCar && Math.abs(p.inCar.speed) < 22 && d < 95) car.boxT += dt; else car.boxT = 0;
      if (car.boxT > POLICE.boxBackoff) { car.regroupT = 1.15; car.boxT = 0; }
      if (car.regroupT > 0) { car.regroupT -= dt; throttle = -0.8; steer = -steer; }
      this.driveCar(car, throttle, steer, dt);
    }
    // Bust meter resolution (officers do the grabbing).
    let grabbed = false;
    for (const ped of this.peds) {
      if (ped.kind !== 'officer' || ped.dead) continue;
      const d = dist(ped.x, ped.y, p.x, p.y);
      if (this.stars >= 2 && d < POLICE.bustRange && p.speedNow < POLICE.bustMaxSpeed) grabbed = true;
    }
    if (grabbed) {
      this.bustMeter += dt / POLICE.bustTime;
      if (this.bustMeter >= 1) { this.busted(); return; }
    } else this.bustMeter = Math.max(0, this.bustMeter - dt * 1.6);
  }

  patrolDrive(car, dt) {
    if (car.axis === undefined) { car.axis = 'h'; car.dir = 1; }
    let tx, ty;
    if (car.axis === 'v') { const ax = nearestAvenue(this.city, car.x); tx = ax + (car.dir > 0 ? -LANE : LANE); ty = car.y + car.dir * 300; }
    else { const sy = nearestStreet(this.city, car.y); tx = car.x + car.dir * 300; ty = sy + (car.dir > 0 ? LANE : -LANE); }
    const inter = nearestIntersection(this.city, car.x, car.y);
    if (dist(car.x, car.y, inter.x, inter.y) < 42 && car.stuckT <= 0) {
      if (this.rng.chance(0.35)) { car.axis = car.axis === 'v' ? 'h' : 'v'; car.dir = this.rng.sign(); }
      car.stuckT = 1.4;
    }
    if (car.stuckT > 0) car.stuckT -= dt;
    if (car.x < 120 || car.x > this.city.sandX - 60) { car.axis = 'h'; car.dir = car.x < 120 ? 1 : -1; }
    if (car.y < 120 || car.y > WORLD.h - 120) { car.axis = 'v'; car.dir = car.y < 120 ? 1 : -1; }
    const want = Math.atan2(ty - car.y, tx - car.x);
    this.driveCar(car, car.speed < 130 ? 0.6 : 0, clamp(angDiff(car.a, want) * 1.6, -1, 1), dt);
  }

  updateOfficer(off, dt) {
    const p = this.player;
    const d = dist(off.x, off.y, p.x, p.y);
    off.fireCd -= dt;
    if (d > POLICE.bustClose - 6) this.movePed(off, p.x, p.y, POLICE.officerSpeed, dt);
    else off.a = Math.atan2(p.y - off.y, p.x - off.x);
    // Officers shoot only from 3 stars, and only at a suspect on foot.
    if (this.stars >= POLICE.shootStars && !p.inCar && d < POLICE.shootRange && lineOfSight(this.city, off.x, off.y, p.x, p.y)) {
      if (off.fireCd <= 0) {
        off.fireCd = POLICE.shootCd;
        this.fx.tracers.push({ x1: off.x, y1: off.y, x2: p.x, y2: p.y, life: 0.07 });
        this.emit('shot');
        if (this.rng.chance(0.55 - d / 1400)) this.hurtPlayer(POLICE.shootDmg);
      }
    }
  }

  updateHeat(dt) {
    if (this.heat <= 0) { this.heat = 0; return; }
    if (this.spottedNow()) { this.lastSeenT = this.t; this.lastSeen = { x: this.player.x, y: this.player.y }; }
    const hiddenFor = this.t - this.lastSeenT;
    this.heat -= (hiddenFor > WANTED.hideDelay ? WANTED.decayHidden : WANTED.decaySeen) * dt;
    if (this.heat < 0) this.heat = 0;
  }

  updatePickups(dt) {
    void dt;
    const p = this.player;
    for (const pk of this.pickups) {
      if (!pk.active) continue;
      if (!p.inCar && dist(p.x, p.y, pk.x, pk.y) < 30) {
        pk.active = false;
        if (pk.kind === 'money') { this.money += pk.amount; this.stats.earned += pk.amount; this.emit('cash'); this.toast('+$' + pk.amount); }
        if (pk.kind === 'snack') { p.hp = Math.min(p.maxHp, p.hp + 25); this.toast('Snack — +25 HP'); }
        // 'package' is collected by the mission engine, not here.
        if (pk.kind === 'package') pk.active = true; // engine handles it below
      }
    }
    this.pickups = this.pickups.filter(pk => pk.active);
  }

  updateMissions(dt) {
    const st = this.currentStep();
    if (!st) { this.channel.progress = 0; return; }
    const p = this.player, P = this.city.places;
    switch (st.type) {
      case 'steal': if (this.targetCar && p.inCar === this.targetCar) this.advanceStep(); break;
      case 'deliver': if (this.targetCar && p.inCar === this.targetCar && dist(p.x, p.y, P[st.at].x, P[st.at].y) < 100) this.advanceStep(); break;
      case 'pickup': {
        const pk = this.pickups.find(q => q.kind === 'package' && q.active);
        if (pk && !p.inCar && dist(p.x, p.y, pk.x, pk.y) < 32) {
          pk.active = false; this.emit('pickup'); this.addHeatDirect(st.heat || 0);
          this.toast('Got the package — it is hot'); this.advanceStep();
        }
        break;
      }
      case 'goto': if (dist(p.x, p.y, P[st.at].x, P[st.at].y) < 85) this.advanceStep(); break;
      case 'kill': if (!this.peds.some(q => q.kind === 'dealer' && q.hp > 0)) this.advanceStep(); break;
      case 'channel': {
        const door = P[st.at];
        if (!p.inCar && dist(p.x, p.y, door.x, door.y) < 48) {
          this.channel.progress += dt;
          if (this.channel.progress >= st.dur) { this.addHeatDirect(st.heat || 0); this.emit('cash'); this.advanceStep(); }
        } else this.channel.progress = Math.max(0, this.channel.progress - dt * 2);
        break;
      }
      case 'meet': if (!p.inCar && dist(p.x, p.y, this.city.plaza.x, this.city.plaza.y) < 52) this.advanceStep(); break;
      case 'escape': if (this.stars === 0) this.advanceStep(); break;
    }
    // Free-roam side vault at the bank door (not during a mission channel).
    if (!(st.type === 'channel' && st.at === 'bank')) {
      const door = P.bank;
      if (!p.inCar && dist(p.x, p.y, door.x, door.y) < 48 && this.bankCooldown <= 0) {
        this.channel.progress += dt;
        if (this.channel.progress >= 3) {
          this.channel.progress = 0; this.bankCooldown = PRICES.vaultCooldown;
          this.money += PRICES.vault; this.stats.earned += PRICES.vault;
          this.addHeatDirect(PRICES.vaultHeat); this.emit('cash'); this.toast('Side vault — +$' + PRICES.vault);
        }
      } else if (this.channel.progress > 0 && !(st.type === 'channel')) this.channel.progress = Math.max(0, this.channel.progress - dt * 2);
    }
  }

  // ------------------------------------------------------------- save / restore
  serialize() {
    const p = this.player;
    return {
      v: 4, money: this.money, hp: p.hp, timeMinutes: this.timeMinutes,
      missionIndex: this.missionIndex, stepIndex: this.stepIndex,
      weapons: { ...this.weapons }, weapon: this.weapon,
      px: p.x, py: p.y, storyComplete: this.storyComplete,
      bankCooldown: this.bankCooldown, stats: { ...this.stats },
      ownedCar: this.ownedCar && !this.ownedCar.dead ? { x: this.ownedCar.x, y: this.ownedCar.y, a: this.ownedCar.a, hp: this.ownedCar.hp } : null,
    };
  }

  restore(data) {
    const fresh = new World(this.seed);
    this.city = fresh.city; this.cars = fresh.cars; this.peds = fresh.peds; this.pickups = fresh.pickups;
    this.rng = fresh.rng; this.rngSpawn = fresh.rngSpawn;
    this.t = 0; this.toasts = []; this.events = []; this.fx = { tracers: [], parts: [] };
    this.money = data.money | 0; this.heat = 0; this.bustMeter = 0; this.lastCard = null;
    this.timeMinutes = data.timeMinutes ?? DAY.start;
    this.missionIndex = data.missionIndex | 0; this.stepIndex = data.stepIndex | 0;
    this.weapons = { fists: true, pistol: false, smg: false, shotgun: false, ...(data.weapons || {}) };
    this.weapon = data.weapon || 'fists';
    this.storyComplete = !!data.storyComplete;
    this.bankCooldown = data.bankCooldown || 0;
    this.stats = { missions: 0, stolen: 0, shots: 0, hits: 0, busted: 0, wasted: 0, timePlayed: 0, earned: 0, ...(data.stats || {}) };
    this.player = fresh.player;
    this.player.x = data.px ?? this.city.spawn.x; this.player.y = data.py ?? this.city.spawn.y;
    this.player.hp = clamp(data.hp ?? PLAYER.hp, 1, PLAYER.hp);
    this.ownedCar = null; this.targetCar = null;
    if (data.ownedCar) {
      this.ownedCar = this.makeCar(data.ownedCar.x, data.ownedCar.y, data.ownedCar.a || 0, 'sport', 'owned');
      this.ownedCar.color = 0xd7263d; this.ownedCar.hp = data.ownedCar.hp;
    }
    this.spawnStepNeeds();
  }
}

function nearestAvenue(city, x) {
  let best = city.avenues[0], bd = Infinity;
  for (const ax of city.avenues) { const d = Math.abs(ax - x); if (d < bd) { bd = d; best = ax; } }
  return best;
}
function nearestStreet(city, y) {
  let best = city.streets[0], bd = Infinity;
  for (const sy of city.streets) { const d = Math.abs(sy - y); if (d < bd) { bd = d; best = sy; } }
  return best;
}

export { STEP };
