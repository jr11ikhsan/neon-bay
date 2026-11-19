// NEON BAY — the city itself: a deterministic procedural grid of avenues and
// streets on a tropical shore. Pure data + geometry helpers; the renderer
// turns this into 3D and the simulation collides against it.
//
// Layout (world units, 4800x3600): six avenues run north-south, six streets
// east-west, a boardwalk promenade hugs the sand, and the ocean takes the
// eastern edge. Eight named places sit in fixed blocks so missions, the
// minimap and the economy all agree on where things are.

import { Rng, hash2 } from './random.js';
import { WORLD } from './config.js';

export const AVENUES = [420, 1020, 1620, 2220, 2820, 3420, 3930];
export const STREETS = [420, 1020, 1620, 2220, 2820, 3240];
export const ROAD_HALF = 58;
export const BOARDWALK_X = 4025;   // promenade centre line
export const SAND_X = 4060;        // sand starts here
export const WATER_X = 4300;       // open water starts here (shore line)

const SIGN_NAMES = [
  'HOTEL LUMINA', 'GASOLINA', 'CAFÉ SOL', 'BAR ONDA', 'PIZZA MAR', 'CLUB NEÓN',
  'FARMACIA', 'CINE BRISA', 'TATTOO SOL', 'GYM BRISA', 'LIBROS MAR', 'JOYAS LUNA',
  'PANADERÍA', 'DISCO OLA', 'SUSHI BRISA', 'BANCO DEL SOL', 'MERCADO', 'TALLER SOL',
  'CLÍNICA SOL', 'COMISARÍA', 'BAY MOTORS', 'FLORISTERÍA', 'ÓPTICA', 'VINOS SOL',
];
const NEON = [0xff2e88, 0x22d3ee, 0xffc94d, 0x8b5cf6, 0x06d6a0, 0xff7b54];

// A place: a building block plus the door point where E interacts.
function place(id, name, sign, bx, by, bw, bh, doorX, doorY, color) {
  return { id, name, sign, bx, by, bw, bh, x: doorX, y: doorY, color };
}

export function createCity(seed = 1) {
  const rng = new Rng(seed * 7919 + 13);
  const buildings = [];
  const places = {};

  // --- the eight fixed places -------------------------------------------
  const defs = [
    place('carlot', 'Bay Motors', 'BAY MOTORS', 500, 500, 130, 84, 720, 952, 0x118ab2),
    place('bank', 'Banco del Sol', 'BANCO DEL SOL', 1150, 540, 340, 300, 1320, 878, 0xffc94d),
    place('clinic', 'Clínica Sol', 'CLÍNICA SOL', 1750, 540, 340, 300, 1920, 878, 0x06d6a0),
    place('market', 'Market Sol', 'MERCADO', 540, 1150, 320, 280, 700, 1092, 0xff2e88),
    place('police', 'Comisaría', 'COMISARÍA', 2350, 1150, 340, 280, 2520, 1092, 0x22d3ee),
    place('hotel', 'Hotel Lumina', 'HOTEL LUMINA', 3520, 1120, 320, 340, 3680, 1092, 0xff7b54),
    place('garage', 'Taller Sol', 'TALLER SOL', 2950, 2350, 340, 280, 3120, 2292, 0x8b5cf6),
    place('safehouse', 'Safehouse', 'CASA SOL', 540, 2920, 300, 220, 690, 2862, 0xf4d35e),
  ];
  for (const p of defs) {
    places[p.id] = p;
    buildings.push({ x: p.bx, y: p.by, w: p.bw, h: p.bh, height: 46 + hash2(p.bx, p.by) * 30, sign: p.sign, color: p.color, place: p.id });
  }

  // --- generic blocks -----------------------------------------------------
  // Blocks are the rectangles between roads. Some stay open: the car lot,
  // a plaza by the hotel, two parks. The rest grow 1-4 neon-signed buildings.
  const lots = [{ x: 478, y: 478, w: 484, h: 484 }];                 // Bay Motors lot
  const parks = [
    { x: 3478, y: 478, w: 394, h: 484 },                             // plaza by the hotel block
    { x: 1078, y: 2278, w: 484, h: 484 },                            // south-west park
    { x: 2278, y: 2878, w: 484, h: 304 },                            // south park
  ];
  const reserved = [
    { x: 478, y: 478, w: 484, h: 484 },   // car lot block
    { x: 3478, y: 478, w: 394, h: 484 }, // plaza block
    { x: 1078, y: 2278, w: 484, h: 484 },// park
    { x: 2278, y: 2878, w: 484, h: 304 },// park
  ];
  const inReserved = (x, y, w, h) => reserved.some(r => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);

  for (let i = 0; i < AVENUES.length - 1; i++) {
    for (let j = 0; j < STREETS.length - 1; j++) {
      const bx = AVENUES[i] + ROAD_HALF + 16, bw = AVENUES[i + 1] - AVENUES[i] - ROAD_HALF * 2 - 32;
      const by = STREETS[j] + ROAD_HALF + 16, bh = STREETS[j + 1] - STREETS[j] - ROAD_HALF * 2 - 32;
      if (bw < 120 || bh < 120) continue;
      if (inReserved(bx, by, bw, bh)) continue;
      // Skip blocks already holding a fixed place building.
      if (defs.some(p => bx < p.bx + p.bw && bx + bw > p.bx && by < p.by + p.bh && by + bh > p.by)) continue;
      const cols = bw > 380 ? 2 : 1, rows = bh > 380 ? 2 : 1;
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          const w = (bw - (cols - 1) * 26) / cols, h = (bh - (rows - 1) * 26) / rows;
          const x = bx + cx * (w + 26), y = by + cy * (h + 26);
          if (rng.chance(0.12)) continue; // an occasional empty parcel
          buildings.push({
            x, y, w, h,
            height: 34 + rng.next() * 110,
            sign: SIGN_NAMES[Math.floor(hash2(x, y) * SIGN_NAMES.length) % SIGN_NAMES.length],
            color: NEON[Math.floor(hash2(y, x) * NEON.length) % NEON.length],
            place: null,
          });
        }
      }
    }
  }

  // --- palms and lamps ------------------------------------------------------
  const palms = [];
  for (let y = 120; y < WORLD.h - 80; y += 92) palms.push({ x: BOARDWALK_X + 34, y: y + hash2(y, 7) * 30, s: 0.9 + hash2(y, 9) * 0.5 });
  for (const pk of parks) for (let k = 0; k < 9; k++) palms.push({ x: pk.x + 30 + hash2(k, pk.x) * (pk.w - 60), y: pk.y + 30 + hash2(pk.y, k) * (pk.h - 60), s: 0.8 + hash2(k, pk.y) * 0.6 });
  for (let k = 0; k < 26; k++) palms.push({ x: 4080 + hash2(k, 31) * 190, y: 100 + hash2(31, k) * (WORLD.h - 200), s: 0.85 + hash2(k, 47) * 0.55 });

  const lamps = [];
  for (const ax of AVENUES) for (const sy of STREETS) lamps.push({ x: ax + ROAD_HALF + 8, y: sy + ROAD_HALF + 8 });
  for (const ax of AVENUES) for (let y = 240; y < WORLD.h; y += 300) lamps.push({ x: ax - ROAD_HALF - 8, y });
  for (let y = 160; y < WORLD.h; y += 210) lamps.push({ x: BOARDWALK_X - 16, y });

  return {
    buildings, places, lots, parks, palms, lamps,
    avenues: AVENUES, streets: STREETS, roadHalf: ROAD_HALF,
    boardwalkX: BOARDWALK_X, sandX: SAND_X, waterX: WATER_X,
    spawn: { x: 420, y: 2900 },
    plaza: { x: 3680, y: 720 },       // open square north of the hotel block
    beachSpots: [                     // where the beach dealers hang out (M3)
      { x: 4140, y: 1250 }, { x: 4170, y: 1830 }, { x: 4130, y: 2410 },
    ],
    packageSpot: { x: BOARDWALK_X, y: 2500 },  // the M2 pick-up, on the promenade
  };
}

// Push a circle out of every building and keep it inside the world and out
// of the sea. Returns the corrected [x, y].
export function collideCircle(city, x, y, r) {
  for (const b of city.buildings) {
    const nx = Math.max(b.x, Math.min(x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(y, b.y + b.h));
    let dx = x - nx, dy = y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      if (d2 < 0.0001) { // centre inside the rect: push out along the smallest exit
        const left = x - b.x, right = b.x + b.w - x, top = y - b.y, bot = b.y + b.h - y;
        const m = Math.min(left, right, top, bot);
        if (m === left) x = b.x - r; else if (m === right) x = b.x + b.w + r;
        else if (m === top) y = b.y - r; else y = b.y + b.h + r;
      } else {
        const d = Math.sqrt(d2); x = nx + (dx / d) * r; y = ny + (dy / d) * r;
      }
    }
  }
  if (x < r + 8) x = r + 8;
  if (y < r + 8) y = r + 8;
  if (y > WORLD.h - r - 8) y = WORLD.h - r - 8;
  if (x > WATER_X - r) x = WATER_X - r;
  return [x, y];
}

function segHitsRect(x1, y1, x2, y2, b) {
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  const axes = [
    [-dx, x1 - b.x], [dx, b.x + b.w - x1],
    [-dy, y1 - b.y], [dy, b.y + b.h - y1],
  ];
  for (const [p, q] of axes) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; }
    else {
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

// True when no building blocks the straight line between two points.
export function lineOfSight(city, x1, y1, x2, y2) {
  for (const b of city.buildings) if (segHitsRect(x1, y1, x2, y2, b)) return false;
  return true;
}

export function isOnRoad(city, x, y) {
  if (x > city.sandX) return false;
  for (const ax of city.avenues) if (Math.abs(x - ax) <= ROAD_HALF) return true;
  for (const sy of city.streets) if (Math.abs(y - sy) <= ROAD_HALF) return true;
  return false;
}

export function nearestIntersection(city, x, y) {
  let bx = city.avenues[0], by = city.streets[0], bd = Infinity;
  for (const ax of city.avenues) for (const sy of city.streets) {
    const d = (ax - x) * (ax - x) + (sy - y) * (sy - y);
    if (d < bd) { bd = d; bx = ax; by = sy; }
  }
  return { x: bx, y: by };
}
