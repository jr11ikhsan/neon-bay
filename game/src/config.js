// NEON BAY — every tuning number and colour in one place.
// The world is a fixed 4800x3600 top-down city; the renderer keeps a 1280x720 logical
// camera view and scales it to the window, so no rule below depends on screen size.

export const VIEW = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const WORLD = {
  width: 4800,
  height: 3600,
  beachX: 4020, // sand starts here
  waterX: 4260, // open water starts here (blocked for everyone)
};

export const ROADS = {
  width: 124,
  verticalX: [320, 940, 1560, 2180, 2800, 3420, 3920],
  horizontalY: [320, 940, 1560, 2180, 2800, 3320],
  laneOffset: 31,
};

export const PLAYER = {
  radius: 13,
  walkSpeed: 168,
  runSpeed: 285,
  health: 100,
  punchRange: 40,
  punchDamage: 26,
  punchCooldown: 0.34,
  enterRange: 62,
};

export const GUN = {
  range: 460,
  damage: 34,
  cooldown: 0.22,
  spread: 0.035,
};

// The armoury: three guns with genuinely different feels — the pistol is
// precise, the SMG sprays fast and weak, the shotgun throws a wall of
// pellets that ends arguments up close. Bought at Market Sol.
export const WEAPONS = {
  pistol: { label: 'PISTOL', range: 460, damage: 34, cooldown: 0.22, spread: 0.035, pellets: 1, auto: false },
  smg: { label: 'SMG', range: 430, damage: 15, cooldown: 0.085, spread: 0.075, pellets: 1, auto: true },
  shotgun: { label: 'SHOTGUN', range: 300, damage: 13, cooldown: 0.85, spread: 0.17, pellets: 6, auto: false },
};

// What the bay's places charge: the economy that turns money into progress.
export const PRICES = {
  clinicHeal: 40, policeBribe: 150, hotelRoom: 60, snack: 15,
  smg: 600, shotgun: 900, car: 800, repair: 50, bankHeist: 700,
};

export const CAR = {
  width: 46,
  length: 92,
  maxSpeed: 545, // px/s forward
  maxReverse: 150,
  accel: 330,
  brake: 620,
  drag: 0.6,
  turnRate: 2.5, // rad/s at full lock, scaled by speed
  health: 100,
};

export const TRAFFIC = {
  count: 34,
  speed: 205,
  parkedCount: 36,
};

export const PEDS = { count: 46 };

export const POLICE = {
  carSpeed: 565,
  carAccel: 380,
  footSpeed: 238,
  shootRange: 330,
  shootCooldown: 1.15,
  shootDamage: 7,
  bustRadius: 46,
  bustTime: 2.2, // seconds a cop must stay close to a slow on-foot player
  sightRange: 560,
};

export const WANTED = {
  max: 5,
  // heat points: roughly 100 per star
  carjack: 55,
  stealMoving: 90,
  hitPedCar: 120,
  killPed: 160,
  shootAt: 45,
  hitCop: 200,
  killCop: 320,
  missionCrime: 100,
  decayPerSecond: 3.2, // only while unseen by police
  hideTime: 6, // seconds unseen before decay runs at full rate
};

/** One in-game hour every this many real seconds; the game starts at 17:35 (golden dusk). */
export const DAY = { secondsPerHour: 22, startHour: 17.58 };

export const SAVE_KEY = 'neon-bay.save.v1';
export const BEST_KEY = 'neon-bay.best.v1';

export const PALETTE = {
  grass: '#3f7a4e',
  grassDark: '#356b43',
  sand: '#e8cf9e',
  sandDark: '#dcc088',
  water: '#175d7a',
  waterDeep: '#0f4763',
  boardwalk: '#9a6a4f',
  sidewalk: '#8d8296',
  sidewalkEdge: '#6f6479',
  asphalt: '#333040',
  asphaltEdge: '#282433',
  laneMark: '#e8d44f',
  crosswalk: '#cfd4dc',
  player: '#ffd23f',
  text: '#f5f2ea',
  muted: '#b9b3c9',
  panel: 'rgba(16,12,28,0.78)',
  neonPink: '#ff2e88',
  neonCyan: '#22d3ee',
  neonGold: '#ffb703',
  danger: '#ef476f',
  good: '#06d6a0',
};

export const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
export const TITLE_FONT = '"Arial Black", "Trebuchet MS", system-ui, sans-serif';
