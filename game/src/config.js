// NEON BAY — tuning constants for the whole game.
// One flat module every other file imports; nothing here touches the DOM,
// three.js or storage, so the headless sim tests can use it as-is.

export const WORLD = { w: 4800, h: 3600 };
export const STEP = 1 / 60;                 // fixed simulation step (seconds)
export const VIEW = { w: 1280, h: 720 };    // reference viewport for HUD layout

// The day starts at golden dusk and rolls into a bright, readable night.
// timeMinutes is minutes since midnight; TIME_RATE is game-minutes per real second.
export const DAY = { start: 17 * 60 + 35, rate: 0.55, nightStart: 19 * 60 + 10, nightEnd: 5 * 60 };

export const PLAYER = {
  radius: 14,
  walk: 168,
  sprint: 268,
  hp: 100,
  enterRange: 62,        // how close to a car door E works
  placeRange: 68,        // how close to a place door E works
};

// Heat is the raw wanted score; stars are derived from it.
// 210 heat (the M2 package) must read as 2 stars, 540 (the M4 vault) as 4.
export const WANTED = {
  thresholds: [0, 60, 150, 300, 480, 750],
  decayHidden: 7.5,      // heat per second once nobody has seen you for a while
  decaySeen: 0.6,        // heat per second while in plain sight (barely cools)
  hideDelay: 3.0,        // seconds unseen before the fast decay starts
  crimeShot: 26,         // firing a gun where witnesses can hear/see
  crimeHitPed: 90,       // running a pedestrian down
  crimeCarjack: 55,      // pulling a driver out of a moving car
  crimeHitCar: 18,       // ramming another vehicle hard
};

export const WEAPONS = {
  fists:   { name: 'Fists',   dmg: 13, rate: 0.34, range: 52,  pellets: 1, auto: false, spread: 0.02, price: 0 },
  pistol:  { name: 'Pistol',  dmg: 34, rate: 0.27, range: 560, pellets: 1, auto: false, spread: 0.012, price: 0 },
  smg:     { name: 'SMG',     dmg: 16, rate: 0.095, range: 470, pellets: 1, auto: true,  spread: 0.05, price: 600 },
  shotgun: { name: 'Shotgun', dmg: 13, rate: 0.82, range: 310, pellets: 6, auto: false, spread: 0.16, price: 900 },
};
export const WEAPON_ORDER = ['fists', 'pistol', 'smg', 'shotgun'];

export const CAR_TYPES = {
  sedan:  { top: 330, accel: 210, grip: 3.4, hp: 130, colors: [0xb8bec9, 0x707a8c, 0x3f6fb5, 0x8c2f39, 0x2e7d5b, 0xd9d9d9] },
  taxi:   { top: 320, accel: 205, grip: 3.4, hp: 130, colors: [0xf2b01e] },
  van:    { top: 285, accel: 175, grip: 3.0, hp: 190, colors: [0xcfd4da, 0x5b7fa6, 0x777777] },
  pickup: { top: 310, accel: 195, grip: 3.1, hp: 170, colors: [0x94562e, 0x446644, 0x8899aa] },
  sport:  { top: 520, accel: 320, grip: 4.1, hp: 150, colors: [0xd7263d, 0x118ab2, 0xf4d35e, 0x06d6a0] },
  cop:    { top: 465, accel: 300, grip: 3.9, hp: 210, colors: [0xf2f2f2] },
};
export const TRAFFIC = { count: 30, parked: 30, despawnDist: 2600, spawnDist: 1500 };
export const PEDS = { walkers: 42, speed: 62 };

export const POLICE = {
  maxUnits: 5,           // patrol cars that can be active at once
  officerSpeed: 208,     // faster than a walk, slower than a sprint: a fair chase
  officerHp: 60,
  bustRange: 46,         // an officer must be this close to build the bust meter
  bustClose: 38,         // officers press in to this distance while arresting
  bustTime: 2.2,         // seconds of being cornered before BUSTED
  bustMaxSpeed: 92,      // suspect faster than this cannot be grabbed
  shootStars: 3,         // officers open fire from this star level up
  shootRange: 390,
  shootCd: 0.75,
  shootDmg: 8,
  boxBackoff: 2.2,       // seconds boxing a stopped car before backing off to regroup
};

export const PRICES = {
  clinic: 40, bribe: 150, hotel: 60, car: 800, repair: 50, snack: 15,
  vault: 700, vaultHeat: 330, vaultCooldown: 240, lieLow: 200,
};

export const SAVE_KEY = 'neon-bay.save.v4';
export const BEST_KEY = 'neon-bay.best.v4';

export const PALETTE = {
  sky: 0x1b1035, water: 0x0b3d5c, sand: 0xe0c290, road: 0x2c2f38,
  neonPink: 0xff2e88, neonCyan: 0x22d3ee, neonGold: 0xffc94d, neonViolet: 0x8b5cf6,
};
