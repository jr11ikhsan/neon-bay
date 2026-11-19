// NEON BAY v3 — tuning constants shared by the simulation, renderer and tests.
export const WORLD = { w: 4800, h: 3600, beachX: 4080, waterX: 4440 };
export const STEP = 1 / 60;
export const SAVE_KEY = 'neon-bay.save.v3';
export const BEST_KEY = 'neon-bay.best.v3';

export const PLAYER = { r: 14, walk: 178, run: 278, hp: 100, startMoney: 0 };
// Game clock: starts at golden dusk 17:35 and runs 0.55 game-minutes per real second.
export const DAY = { start: 17 + 35 / 60, minPerSec: 0.55 };

export const WEAPONS = {
  fist:    { name: 'Fists',   dmg: 34, rate: 0.38, range: 54,  pellets: 1, spread: 0,     auto: false, price: 0 },
  pistol:  { name: 'Pistol',  dmg: 34, rate: 0.32, range: 470, pellets: 1, spread: 0.012, auto: false, price: 0 },
  smg:     { name: 'SMG',     dmg: 13, rate: 0.09, range: 430, pellets: 1, spread: 0.05,  auto: true,  price: 600 },
  shotgun: { name: 'Shotgun', dmg: 11, rate: 0.85, range: 305, pellets: 6, spread: 0.16,  auto: false, price: 900 },
};
export const WEAPON_ORDER = ['fist', 'pistol', 'smg', 'shotgun'];

// Heat thresholds for wanted stars 1..5; heat decays only while no police unit sees you.
export const WANTED = { thresholds: [1, 90, 220, 420, 650], decay: 16, hideBoost: 3.5, grace: 1.2 };
export const CRIME = { shot: 25, carjack: 60, hitPed: 120, killPed: 170, killDealer: 90, ram: 30, steal: 60 };

export const PRICES = { heal: 40, bribe: 150, hotel: 60, snack: 15, car: 800, repair: 50 };
export const BANK_SIDE = { reward: 700, cooldown: 240, heat: 330, channel: 3 };
export const FINE = { base: 80, perStar: 40 };

export const TRAFFIC = { count: 30, parkedMin: 26 };
export const PEDS = { count: 42 };
export const POLICE = { spawnGap: 2.6, carSpeed: 545, footSpeed: 238, shootRange: 330, shootDmg: 6 };

export const CAR_TYPES = {
  sedan:  { top: 400, accel: 300, w: 44, l: 84,  colors: [0xb8c0cc, 0x707a88, 0x30405c, 0x7a2020, 0x20503a] },
  taxi:   { top: 390, accel: 300, w: 44, l: 84,  colors: [0xf2b705] },
  van:    { top: 350, accel: 260, w: 50, l: 98,  colors: [0xd8d8d8, 0x5a6a7a, 0x806a4a] },
  pickup: { top: 380, accel: 290, w: 48, l: 96,  colors: [0x8a4a2a, 0x3a5a78, 0x666666] },
  sport:  { top: 520, accel: 380, w: 46, l: 88,  colors: [0xc03a5a, 0x2a7ac0, 0x30b080, 0xe0e0e0] },
};
export const PALETTE = {
  sand: '#e8cf9e', water: '#1a5f8a', road: '#33363e', walk: '#9aa0a8', grass: '#4a7a4a',
  neon: ['#ff5da2', '#22d3ee', '#ffd23e', '#8aff5d', '#c084fc', '#ff8a3e', '#3ee6c4', '#ff3e6c'],
};
