// NEON BAY v5 — the city itself: a procedural neon bayside grid.
// Blocks between the avenues and streets are filled with signed buildings;
// eight of them are the working places of the story (garage, bank, clinic,
// station, hotel, market, car lot, safehouse). East of the last avenue the
// city gives up: a boardwalk promenade, a palm beach, and the bay.

import { ROADS, WORLD } from './config.js';

const SIGNS = [
  'HOTEL LUMINA', 'BANCO DEL SOL', 'GASOLINA', 'CLUB FARO', 'MAR AZUL',
  'NEON PALMS', 'CAFE BRISA', 'CINE OLA', 'PIZZA MAREA', 'JOYAS LUNA',
  'BAR CORAL', 'DISCO VELA', 'FARMACIA SOL', 'GYM TIBURON', 'FLOR DE SAL',
  'LAUNDRY LUNA', 'TATTOO FARO', 'SUSHI MAREA', 'LIBROS OLA', 'PANADERIA',
];
const BUILDING_COLORS = ['#3b2d5c', '#2d3a5c', '#4a2d4f', '#2d4a52', '#54426a', '#37415e', '#5c2d3e', '#2e4a3e'];
const CAR_COLORS = ['#d94f70', '#4f7ad9', '#e8e4da', '#3ec1a8', '#e0a83c', '#8a5fd6', '#5a6270', '#c23b2e', '#7fb069', '#e86ac0'];

/** Intervals of buildable land between two sorted road centrelines. */
function gaps(centres, halfWidth, limit) {
  const out = [];
  let prev = 40;
  for (const c of centres) {
    out.push([prev, c - halfWidth]);
    prev = c + halfWidth;
  }
  out.push([prev, limit]);
  return out;
}

/**
 * Build the static city from a seeded stream. Deterministic per seed:
 * the same seed always raises the same skyline.
 */
export function createCity(rng) {
  const half = ROADS.width / 2;
  const xGaps = gaps(ROADS.avenues, half, ROADS.boardwalkX - 60);
  const yGaps = gaps(ROADS.streets, half, WORLD.height - 40);

  // The eight places, each anchored in its own block with a door that
  // stands on open road or promenade, so a player can always reach it.
  const places = {
    carLot: { id: 'carLot', name: 'Bay Motors', letter: 'C', door: { x: 3845, y: 720 }, color: '#e0a83c' },
    garage: { id: 'garage', name: 'Taller Sol', letter: 'G', door: { x: 700, y: 2790 }, color: '#3ec1a8' },
    hotel: { id: 'hotel', name: 'Hotel Lumina', letter: 'H', door: { x: 3125, y: 1300 }, color: '#ff3d8a' },
    bank: { id: 'bank', name: 'Banco del Sol', letter: '$', door: { x: 2100, y: 1590 }, color: '#ffc44d' },
    clinic: { id: 'clinic', name: 'Clinica Brisa', letter: '+', door: { x: 1120, y: 1900 }, color: '#e8e4da' },
    policeStation: { id: 'policeStation', name: 'Comisaria', letter: 'P', door: { x: 2100, y: 455 }, color: '#4f7ad9' },
    market: { id: 'market', name: 'Mercado Sol', letter: 'M', door: { x: 1025, y: 1300 }, color: '#7fb069' },
    hideout: { id: 'hideout', name: 'Casa Segura', letter: 'S', door: { x: 700, y: 3110 }, color: '#8a5fd6' },
  };
  // Building footprints for the places that have one (the car lot is open).
  const placeBuildings = [
    { place: 'garage', x: 520, y: 2380, w: 340, h: 300 },
    { place: 'hotel', x: 2620, y: 1160, w: 380, h: 300 },
    { place: 'bank', x: 1930, y: 1180, w: 340, h: 280 },
    { place: 'clinic', x: 1230, y: 1780, w: 320, h: 260 },
    { place: 'policeStation', x: 1930, y: 560, w: 340, h: 280 },
    { place: 'market', x: 540, y: 1180, w: 340, h: 280 },
    { place: 'hideout', x: 590, y: 3180, w: 220, h: 170 },
  ];

  const buildings = [];
  for (const pb of placeBuildings) {
    buildings.push({
      x: pb.x, y: pb.y, w: pb.w, h: pb.h,
      height: pb.place === 'hotel' ? 190 : 90 + rng.range(0, 60),
      color: places[pb.place].color,
      sign: places[pb.place].name.toUpperCase(),
      place: pb.place,
      seed: Math.floor(rng.range(0, 1e9)),
    });
  }

  // Filler blocks: skip the car-lot block (open asphalt), the hideout's
  // park block and the far-east strip; subdivide the rest into towers.
  const lotBlock = { x0: 3230, y0: 490 };
  const parkBlock = { x0: 430, y0: 2890 };
  let signIdx = 0;
  for (const [x0, x1] of xGaps) {
    if (x1 - x0 < 150) continue;
    for (const [y0, y1] of yGaps) {
      if (y1 - y0 < 150) continue;
      if (x0 === lotBlock.x0 && y0 === lotBlock.y0) continue;
      if (x0 === parkBlock.x0 && y0 === parkBlock.y0) continue;
      if (placeBuildings.some((pb) => pb.x >= x0 && pb.x < x1 && pb.y >= y0 && pb.y < y1)) continue;
      const cols = x1 - x0 > 420 ? 2 : 1;
      const rows = y1 - y0 > 380 ? 2 : 1;
      const cw = (x1 - x0) / cols;
      const ch = (y1 - y0) / rows;
      for (let cx = 0; cx < cols; cx += 1) {
        for (let cy = 0; cy < rows; cy += 1) {
          const pad = 26;
          const bx = x0 + cx * cw + pad;
          const by = y0 + cy * ch + pad;
          const bw = cw - pad * 2 - rng.range(0, 40);
          const bh = ch - pad * 2 - rng.range(0, 40);
          if (bw < 90 || bh < 90) continue;
          buildings.push({
            x: bx, y: by, w: bw, h: bh,
            height: rng.range(50, 230),
            color: rng.pick(BUILDING_COLORS),
            sign: rng.chance(0.55) ? SIGNS[signIdx++ % SIGNS.length] : null,
            place: null,
            seed: Math.floor(rng.range(0, 1e9)),
          });
        }
      }
    }
  }

  // Street lamps: along both road families, offset to the kerbs.
  const lamps = [];
  for (const ax of ROADS.avenues) {
    for (let y = 120; y < WORLD.height - 60; y += 330) {
      lamps.push({ x: ax - half - 12, y });
      lamps.push({ x: ax + half + 12, y: y + 165 });
    }
  }
  for (const sy of ROADS.streets) {
    for (let x = 140; x < ROADS.boardwalkX - 80; x += 330) lamps.push({ x, y: sy - half - 12 });
  }

  // Palms: a promenade row, a beach scatter, a park cluster.
  const palms = [];
  for (let y = 140; y < WORLD.height - 100; y += 175) palms.push({ x: ROADS.boardwalkX + 55, y: y + rng.range(-24, 24), s: rng.range(0.85, 1.25) });
  for (let i = 0; i < 46; i += 1) palms.push({ x: rng.range(ROADS.sandFrom + 30, ROADS.waterFrom - 60), y: rng.range(120, WORLD.height - 120), s: rng.range(0.8, 1.35) });
  for (let i = 0; i < 22; i += 1) palms.push({ x: rng.range(120, 1150), y: rng.range(2920, 3500), s: rng.range(0.85, 1.3) });

  // Parking rows inside the car lot (the story's hunting ground).
  const lotSpots = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      lotSpots.push({ x: 3300 + col * 105, y: 580 + row * 130, angle: Math.PI / 2 });
    }
  }

  return {
    buildings, lamps, palms, places, lotSpots,
    spawn: { x: 430, y: 2820 },
    pier: { x: ROADS.boardwalkX, y: 1620 },
    beach: { x: 4360, y: 1700 },
  };
}

/** Is the point on asphalt (road, boardwalk or the car lot)? */
export function isOnRoad(city, x, y) {
  const half = ROADS.width / 2;
  for (const ax of ROADS.avenues) if (Math.abs(x - ax) <= half) return true;
  for (const sy of ROADS.streets) if (Math.abs(y - sy) <= half && x < ROADS.sandFrom) return true;
  if (Math.abs(x - ROADS.boardwalkX) <= 46) return true;
  if (x > 3230 && x < 3790 && y > 490 && y < 950) return true; // the lot
  return false;
}

export function isWater(x) { return x >= ROADS.waterFrom; }
export function isSand(x) { return x >= ROADS.sandFrom && x < ROADS.waterFrom; }

/**
 * Push a circle (entity at ent.x/ent.y with radius r) out of every building
 * and out of the water, and clamp it to the world. Returns true when the
 * circle hit something this call — vehicles use that for impact damage.
 */
export function collide(city, ent, r) {
  let hit = false;
  for (const b of city.buildings) {
    const nx = Math.max(b.x, Math.min(ent.x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(ent.y, b.y + b.h));
    const dx = ent.x - nx;
    const dy = ent.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      ent.x = nx + (dx / d) * r;
      ent.y = ny + (dy / d) * r;
    } else {
      // Centre inside the box: leave by the shallowest face.
      const left = ent.x - b.x; const right = b.x + b.w - ent.x;
      const top = ent.y - b.y; const bottom = b.y + b.h - ent.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) ent.x = b.x - r;
      else if (m === right) ent.x = b.x + b.w + r;
      else if (m === top) ent.y = b.y - r;
      else ent.y = b.y + b.h + r;
    }
  }
  if (ent.x > ROADS.waterFrom - r - 6) { ent.x = ROADS.waterFrom - r - 6; hit = true; }
  if (ent.x < r + 4) { ent.x = r + 4; hit = true; }
  if (ent.y < r + 4) { ent.y = r + 4; hit = true; }
  if (ent.y > WORLD.height - r - 4) { ent.y = WORLD.height - r - 4; hit = true; }
  return hit;
}

/** Straight-line sight between two points; buildings block it. */
export function lineOfSight(city, x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.floor(dist / 42));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    for (const b of city.buildings) {
      if (x > b.x - 2 && x < b.x + b.w + 2 && y > b.y - 2 && y < b.y + b.h + 2) return false;
    }
  }
  return true;
}

export { CAR_COLORS };
