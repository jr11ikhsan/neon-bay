// NEON BAY v2 — tuning constants. Hand-written for the make.fun gta6-01
// contest. Everything the simulation and renderer need lives here so the
// balance of the game can be read (and tuned) in one place.

export const STEP = 1 / 60;               // fixed simulation step, seconds
export const WORLD = {
  w: 4800, h: 3600,                        // world size in units
  beachX: 4140,                            // sand starts here
  waterX: 4620,                            // open water starts here
};

export const DAY = {
  start: 17 * 60 + 35,                     // the story opens at 17:35, golden dusk
  rate: 0.45,                              // game-minutes per real second
  night: 0.62,                             // daylight factor at full night (v2: nights stay readable)
};

export const PLAYER = {
  r: 14,                                   // collision radius on foot
  walk: 172, run: 278,                     // speeds, units per second
  hp: 100,
  punchRange: 54, punchDmg: 34, punchRate: 0.34,
  enterRange: 74,                          // how close to a car door to get in
};

// damage / fire-rate / range / spread(rad) / auto / pellets per trigger pull
export const WEAPONS = {
  fist:    { name: 'Fists',   dmg: 0,  rate: 0.34, range: 54,  spread: 0,    auto: false, pellets: 1 },
  pistol:  { name: 'Pistol',  dmg: 34, rate: 0.27, range: 620, spread: 0.012, auto: false, pellets: 1 },
  smg:     { name: 'SMG',     dmg: 13, rate: 0.092, range: 540, spread: 0.055, auto: true,  pellets: 1 },
  shotgun: { name: 'Shotgun', dmg: 12, rate: 0.88, range: 380, spread: 0.17,  auto: false, pellets: 6 },
};
export const WEAPON_ORDER = ['fist', 'pistol', 'smg', 'shotgun'];

export const CAR = {
  r: 30,                                   // rough collision radius
  accel: 340, brake: 620, drag: 0.55,
  maxFwd: 660, maxRev: 190,                // sedan baseline; per-type scale in world
  turn: 2.35,                              // steering rate at speed
  hp: 100,
};

export const TRAFFIC = { cars: 34, parked: 36, peds: 46 };

export const WANTED = {
  // heat needed to hold each star level (index = stars)
  thresholds: [0, 80, 180, 320, 520, 760],
  decay: 13,                               // heat per second while unseen
  hiddenDelay: 4,                          // seconds unseen before decay starts
  safehouseDecay: 46,                      // decay while lying low at the safehouse
};

export const POLICE = {
  carsByStar: [0, 2, 3, 4, 5, 6],
  footByStar: [0, 0, 1, 2, 3, 4],
  carSpeed: 640,                           // pursuit top speed
  footSpeed: 238,
  shootRange: 300, shootDmg: 7, shootRate: 0.85,
  bustRange: 58, bustRate: 0.55,           // meter per second at closest range
  spawnMin: 720, spawnMax: 1080,
};

export const PRICES = {
  heal: 40, bribe: 150, hotel: 60, snack: 15,
  smg: 600, shotgun: 900, car: 800, repair: 50,
};

export const BANK = { payout: 700, heat: 330, cooldown: 240, channel: 3 };

export const SAVE_KEY = 'neon-bay.save.v2';
export const BEST_KEY = 'neon-bay.best.v2';

export const PALETTE = {
  neon: ['#ff2e88', '#00e5ff', '#ffd23e', '#7cff4f', '#b26bff', '#ff7a3e', '#3effc8', '#ff4f6d'],
  facade: ['#2b3550', '#3a2b4d', '#24384a', '#4d2f3a', '#2e4a3e', '#51432a', '#333a5e', '#402e55'],
  sand: '#d9b77c', water: '#0b3d5c',
};
