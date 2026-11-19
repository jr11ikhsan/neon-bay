// NEON BAY v5 — tuning constants for the whole game.
// One fixed simulation step, one world size, one road grid: every other
// module reads its numbers from here so the sim, the renderer and the
// screenshot staging can never drift apart.

/** Fixed simulation step, seconds. The world only ever advances by this. */
export const STEP = 1 / 60;

/** Logical canvas size the HUD is laid out for. */
export const VIEW = { width: 1280, height: 720 };

/** World size in sim units. East edge is the bay: boardwalk, sand, water. */
export const WORLD = { width: 4800, height: 3600 };

/**
 * The street grid. Avenues run north-south, streets east-west; traffic and
 * the test autopilot both route over their intersections. The bay shore is
 * described here too: a boardwalk promenade, then sand, then open water.
 */
export const ROADS = {
  avenues: [360, 1060, 1760, 2460, 3160, 3860],
  streets: [420, 1020, 1620, 2220, 2820],
  width: 140,
  boardwalkX: 4140,
  sandFrom: 4240,
  waterFrom: 4520,
};

export const PLAYER = {
  radius: 14,
  walkSpeed: 168,
  runSpeed: 268,
  hp: 100,
};

/** Game clock: starts at golden dusk; minutes advance per real second. */
export const DAY = { start: 17 * 60 + 35, rate: 0.45 };

/**
 * The four ways to hurt someone. `slot` is the number key that selects the
 * weapon. Semi weapons fire once per fresh trigger pull; the SMG is the
 * only automatic. The shotgun throws six pellets per pull.
 */
export const WEAPONS = {
  fist: { slot: 0, name: 'Fists', range: 48, damage: 26, cooldown: 0.34, auto: false, pellets: 1, spread: 0 },
  pistol: { slot: 1, name: 'Pistol', range: 560, damage: 34, cooldown: 0.26, auto: false, pellets: 1, spread: 0.012 },
  smg: { slot: 2, name: 'SMG', range: 480, damage: 15, cooldown: 0.085, auto: true, pellets: 1, spread: 0.05 },
  shotgun: { slot: 3, name: 'Shotgun', range: 340, damage: 11, cooldown: 0.85, auto: false, pellets: 6, spread: 0.16 },
};
export const WEAPON_BY_SLOT = ['fist', 'pistol', 'smg', 'shotgun'];

/** Wanted heat thresholds: stars = how many of these the heat has passed. */
export const HEAT_STARS = [1, 120, 260, 420, 620];

export const SAVE_KEY = 'neon-bay.save.v5';
export const BEST_KEY = 'neon-bay.best.v5';

/** Neon Bay palette: dusk violet, hot pink, cyan, gold. */
export const PALETTE = {
  sky: '#2a1e4f',
  pink: '#ff3d8a',
  cyan: '#2ee6ff',
  gold: '#ffc44d',
  violet: '#7b4dff',
  sand: '#e8c98f',
  sea: '#14586e',
  asphalt: '#23232e',
};
