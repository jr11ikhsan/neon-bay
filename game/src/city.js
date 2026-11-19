// NEON BAY v2 — procedural city. A grid of avenues and streets on a
// 4800x3600 world, the beach and the ocean to the east. All geometry is
// generated from a seed: buildings with neon signs, parking lots, parks,
// palms, lamps and the eight working places of the city economy.

import { WORLD, PALETTE } from './config.js';
import { makeRng, hash2, clamp } from './random.js';

export const AVENUES = [420, 1020, 1620, 2220, 2820, 3420]; // vertical roads, centre x
export const AVENUE_W = 120;
export const BOARDWALK = 4020;                                // last vertical road, by the sand
export const BOARDWALK_W = 96;
export const STREETS = [400, 950, 1500, 2050, 2600, 3150];    // horizontal roads, centre y
export const STREET_W = 110;
const WALK = 26;                                              // sidewalk margin around blocks

const SIGN_NAMES = [
  'CLUB SOL', 'BAR MAREA', 'PIZZA LUNA', 'GYM TORO', 'CINE MAR', 'FARMACIA VIDA',
  'TACOS REY', 'HOTEL BRISA', 'DISCO FARO', 'CAFE OLE', 'JOYAS LUZ', 'LIBROS MAR',
  'SUSHI ONDA', 'HELADERIA', 'TATTOO SOL', 'BARBERIA', 'PANADERIA', 'CLUB NOCTA',
  'VINOS MAR', 'OPTICA LUZ', 'DEPORTES SUR', 'FLORISTERIA', 'MERCADO 9', 'BAR LUNA',
];

function colRect(c) {
  if (c < 5) return { x0: AVENUES[c] + AVENUE_W / 2 + WALK, x1: AVENUES[c + 1] - AVENUE_W / 2 - WALK };
  return { x0: AVENUES[5] + AVENUE_W / 2 + WALK, x1: BOARDWALK - BOARDWALK_W / 2 - WALK };
}
function rowRect(r) {
  return { y0: STREETS[r] + STREET_W / 2 + WALK, y1: STREETS[r + 1] - STREET_W / 2 - WALK };
}

// Special blocks, keyed "col,row".
const BLOCK_KIND = {
  '5,0': 'carLot', '5,1': 'hotel', '5,2': 'lot', '5,3': 'safehouse', '5,4': 'garage',
  '2,2': 'bank', '1,3': 'clinic', '3,4': 'police', '3,0': 'market',
  '0,2': 'park', '4,1': 'park',
  '1,0': 'lot', '0,3': 'lot', '2,4': 'lot', '4,2': 'lot', '3,1': 'lot',
};
const PLACE_DEF = {
  hotel:     { name: 'Hotel Lumina', icon: 'H', height: 132 },
  bank:      { name: 'Banco Neon',   icon: '$', height: 216 },
  clinic:    { name: 'Clinica Sol',  icon: '+', height: 56 },
  police:    { name: 'Comisaria 9',  icon: 'P', height: 48 },
  market:    { name: 'Market Sol',   icon: 'M', height: 40 },
  safehouse: { name: 'Safehouse Mar', icon: 'S', height: 27 },
  garage:    { name: 'Taller Sol',   icon: 'G', height: 30 },
  carLot:    { name: 'Bay Motors',   icon: 'C', height: 0 },
};

export function createCity(seed) {
  const rng = makeRng(seed * 7919 + 13);
  const buildings = [], lots = [], parks = [], palms = [], lamps = [], places = {};
  const placeList = [];

  const addBuilding = (x, y, w, h, opts = {}) => {
    const b = {
      x, y, w, h,
      height: opts.height ?? rng.range(26, 84),
      color: opts.color ?? rng.pick(PALETTE.facade),
      sign: opts.sign ?? null,
      signColor: opts.signColor ?? rng.pick(PALETTE.neon),
      place: opts.place ?? null,
      seed: rng.int(1, 1e9),
    };
    buildings.push(b);
    return b;
  };
  const addPlace = (id, blockX, blockY, bx, by) => {
    const def = PLACE_DEF[id];
    const p = { id, name: def.name, icon: def.icon, x: bx, y: by, bx, by, r: 96 };
    places[id] = p; placeList.push(p);
    return p;
  };

  // ---- blocks -------------------------------------------------------------
  for (let c = 0; c < 6; c++) {
    for (let r = 0; r < 5; r++) {
      const { x0, x1 } = colRect(c), { y0, y1 } = rowRect(r);
      const bw = x1 - x0, bh = y1 - y0, key = c + ',' + r, kind = BLOCK_KIND[key] ?? 'buildings';
      if (kind === 'park') {
        parks.push({ x: x0, y: y0, w: bw, h: bh });
        for (let i = 0; i < 9; i++) palms.push({ x: rng.range(x0 + 20, x1 - 20), y: rng.range(y0 + 20, y1 - 20), s: rng.range(0.85, 1.25) });
        continue;
      }
      if (kind === 'lot' || kind === 'carLot') {
        const lot = { x: x0, y: y0, w: bw, h: bh, stalls: [], place: kind === 'carLot' ? 'carLot' : null };
        // two rows of marked stalls along the long edges
        for (let i = 0; i < 7; i++) {
          lot.stalls.push({ x: x0 + 34 + i * ((bw - 68) / 6), y: y0 + 30, a: Math.PI / 2 });
          lot.stalls.push({ x: x0 + 34 + i * ((bw - 68) / 6), y: y1 - 30, a: -Math.PI / 2 });
        }
        lots.push(lot);
        if (kind === 'carLot') addPlace('carLot', x0, y0, x0 + bw / 2, y0 + bh / 2);
        continue;
      }
      if (PLACE_DEF[kind]) {
        // one signature building; interaction point on its west sidewalk
        const def = PLACE_DEF[kind];
        const w = Math.min(bw * 0.78, 330), h = Math.min(bh * 0.8, 300);
        const bx = x0 + (bw - w) / 2, by = y0 + (bh - h) / 2;
        addBuilding(bx, by, w, h, { height: def.height, sign: def.name.toUpperCase(), place: kind, color: kind === 'bank' ? '#26355e' : undefined });
        addPlace(kind, x0, y0, bx - 44, by + h / 2);
        continue;
      }
      // generic block: subdivide into 1, 2 or 4 buildings
      const layout = rng.pick(['h2', 'v2', 'quad', 'quad', 'h2', 'v2']);
      const cells = [];
      if (layout === 'single') cells.push([x0, y0, bw, bh]);
      else if (layout === 'h2') { const w2 = (bw - 18) / 2; cells.push([x0, y0, w2, bh], [x0 + w2 + 18, y0, w2, bh]); }
      else if (layout === 'v2') { const h2 = (bh - 18) / 2; cells.push([x0, y0, bw, h2], [x0, y0 + h2 + 18, bw, h2]); }
      else { const w2 = (bw - 18) / 2, h2 = (bh - 18) / 2; cells.push([x0, y0, w2, h2], [x0 + w2 + 18, y0, w2, h2], [x0, y0 + h2 + 18, w2, h2], [x0 + w2 + 18, y0 + h2 + 18, w2, h2]); }
      for (const [cx, cy, cw, ch] of cells) {
        const downtown = 1 - Math.min(1, Math.hypot(cx - 1920, cy - 1775) / 2100);
        addBuilding(cx + 6, cy + 6, cw - 12, ch - 12, {
          height: rng.range(26, 82) + downtown * rng.range(20, 125),
          sign: rng.chance(0.72) ? rng.pick(SIGN_NAMES) : null,
        });
      }
    }
  }

  // ---- beach huts (collidable, on the sand) --------------------------------
  for (let i = 0; i < 4; i++) {
    addBuilding(4260 + (i % 2) * 190, 760 + i * 640, 92, 64, { height: 13, sign: i % 2 ? 'BAR PLAYA' : 'HELADOS', color: '#5e4632' });
  }

  // ---- palms: boardwalk rows, beach scatter, sidewalk sprinkles ------------
  for (let y = 180; y < 3480; y += 148) {
    if (STREETS.some((s) => Math.abs(s - y) < 96)) continue;
    palms.push({ x: BOARDWALK - BOARDWALK_W / 2 - 20, y: y + hash2(3, y) * 30, s: 0.9 + hash2(5, y) * 0.4 });
    palms.push({ x: BOARDWALK + BOARDWALK_W / 2 + 26, y: y + 60 + hash2(7, y) * 30, s: 0.9 + hash2(9, y) * 0.4 });
  }
  for (let i = 0; i < 42; i++) palms.push({ x: rng.range(WORLD.beachX + 60, WORLD.waterX - 90), y: rng.range(160, WORLD.h - 160), s: rng.range(0.8, 1.35) });
  for (let i = 0; i < 26; i++) {
    const a = rng.pick(AVENUES), s = rng.range(200, WORLD.h - 200);
    palms.push({ x: a + (AVENUE_W / 2 + 16) * rng.sign(), y: s, s: rng.range(0.8, 1.1) });
  }

  // ---- street lamps ----------------------------------------------------------
  for (const a of [...AVENUES, BOARDWALK]) {
    const w = a === BOARDWALK ? BOARDWALK_W : AVENUE_W;
    for (let y = 190; y < 3500; y += 205) {
      lamps.push({ x: a - w / 2 - 9, y });
      lamps.push({ x: a + w / 2 + 9, y: y + 102 });
    }
  }
  for (const s of STREETS) for (let x = 240; x < 3960; x += 260) lamps.push({ x, y: s - STREET_W / 2 - 9 });

  // ---- intersections ---------------------------------------------------------
  const intersections = [];
  for (const a of [...AVENUES, BOARDWALK]) for (const s of STREETS) intersections.push({ x: a, y: s });

  // ---- mission geography -------------------------------------------------------
  const dealers = [
    { x: 4380, y: 1180 }, { x: 4460, y: 1830 }, { x: 4350, y: 2470 },
  ];
  const coupeSpot = { x: places.carLot.x - 60, y: places.carLot.y - 40, a: Math.PI / 2 };
  const jobCarSpot = { x: places.carLot.x + 70, y: places.carLot.y + 46, a: Math.PI / 2 };
  const spawn = { x: BOARDWALK, y: 3330 };

  return {
    buildings, lots, parks, palms, lamps, places, placeList, intersections, dealers,
    coupeSpot, jobCarSpot, spawn,
    avenues: AVENUES.map((c) => ({ axis: 'v', c, w: AVENUE_W })),
    boardwalk: { axis: 'v', c: BOARDWALK, w: BOARDWALK_W },
    streets: STREETS.map((c) => ({ axis: 'h', c, w: STREET_W })),
  };
}

// Push a circle at (x,y) out of every building and back inside the world.
export function collideWorld(city, x, y, r) {
  x = clamp(x, r, WORLD.waterX - r);
  y = clamp(y, r, WORLD.h - r);
  for (const b of city.buildings) {
    const nx = clamp(x, b.x, b.x + b.w), ny = clamp(y, b.y, b.y + b.h);
    const dx = x - nx, dy = y - ny, d2 = dx * dx + dy * dy;
    if (d2 > r * r) continue;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      x = nx + (dx / d) * r; y = ny + (dy / d) * r;
    } else {
      // centre inside the box: leave by the shallowest face
      const pl = x - b.x, pr = b.x + b.w - x, pt = y - b.y, pb = b.y + b.h - y;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) x = b.x - r; else if (m === pr) x = b.x + b.w + r;
      else if (m === pt) y = b.y - r; else y = b.y + b.h + r;
    }
  }
  return [x, y];
}

function segHitsBox(ax, ay, bx, by, b) {
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[ax, dx, b.x, b.x + b.w], [ay, dy, b.y, b.y + b.h]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; }
    else {
      let ta = (lo - p) / d, tb = (hi - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function lineOfSight(city, ax, ay, bx, by) {
  for (const b of city.buildings) if (segHitsBox(ax, ay, bx, by, b)) return false;
  return true;
}

export function isOnRoad(x, y) {
  for (const a of AVENUES) if (Math.abs(x - a) <= AVENUE_W / 2) return true;
  if (Math.abs(x - BOARDWALK) <= BOARDWALK_W / 2) return true;
  for (const s of STREETS) if (Math.abs(y - s) <= STREET_W / 2) return true;
  return false;
}

export const isWater = (x) => x >= WORLD.waterX;
export const isSand = (x) => x >= WORLD.beachX && x < WORLD.waterX;

export function nearestIntersection(city, x, y) {
  let best = null, bd = Infinity;
  for (const i of city.intersections) {
    const d = (i.x - x) ** 2 + (i.y - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
