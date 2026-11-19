// NEON BAY v3 — procedural neon beach city: road grid, signed buildings, 8 working places,
// parking lots, parks, palms and lamps. Pure data + geometry helpers; no DOM, no rendering.
import { WORLD, PALETTE } from './config.js';
import { Rng, clamp } from './random.js';

export const AVENUES = [352, 1056, 1760, 2464, 3168, 3872]; // vertical road centre-lines (x)
export const STREETS = [352, 1056, 1760, 2464, 3168];       // horizontal road centre-lines (y)
export const ROAD_W = 128;
const BLOCK_X = [[416, 992], [1120, 1696], [1824, 2400], [2528, 3104], [3232, 3808]];
const BLOCK_Y = [[416, 992], [1120, 1696], [1824, 2400], [2528, 3104]];
// Block plan by [col][row]: a place id, 'lot', 'park', 'plaza', or 'b' (plain signed building).
const PLAN = [
  ['market', 'b', 'police', 'safehouse'],
  ['lot', 'bank', 'b', 'lot'],
  ['clinic', 'park', 'carlot', 'b'],
  ['b', 'b', 'b', 'plaza'],
  ['hotel', 'garage', 'b', 'b'],
];
export const PLACE_INFO = {
  market:  { name: 'Market Sol',    icon: 'M' },
  clinic:  { name: 'Clinica Sol',   icon: '+' },
  hotel:   { name: 'Hotel Lumina',  icon: 'H' },
  bank:    { name: 'Banco Neon',    icon: '$' },
  police:  { name: 'Policia',       icon: 'P' },
  garage:  { name: 'Taller Sol',    icon: 'G' },
  carlot:  { name: 'Bay Motors',    icon: 'C' },
  safehouse: { name: 'Casa Segura', icon: 'S' },
};
const SIGN_NAMES = ['NEON PALMS', 'CLUB VICE', 'RAMEN 24', 'TORRE AZUL', 'CINE ONDA', 'BAR TROPICO',
  'CAFE LUNA', 'DISCO MAR', 'GALERIA SOL', 'GYM FIT', 'LOJA MAR', 'TORRE ROSA', 'PIZZA ONDA', 'HOTEL BRISA'];

export function createCity(seed = 1337) {
  const rng = new Rng(seed);
  const buildings = [], places = [], lots = [], parks = [], palms = [], lamps = [], parkedSpots = [];
  let signIdx = 0;
  for (let c = 0; c < 5; c++) for (let r = 0; r < 4; r++) {
    const [x0, x1] = BLOCK_X[c], [y0, y1] = BLOCK_Y[r];
    const kind = PLAN[c][r], cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (kind === 'lot') {
      lots.push({ x: x0 + 20, y: y0 + 20, w: x1 - x0 - 40, h: y1 - y0 - 40 });
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++)
        parkedSpots.push({ x: x0 + 110 + i * 128, y: y0 + 140 + j * 250, a: Math.PI / 2 });
      continue;
    }
    if (kind === 'park' || kind === 'plaza') {
      parks.push({ x: x0 + 16, y: y0 + 16, w: x1 - x0 - 32, h: y1 - y0 - 32, plaza: kind === 'plaza' });
      for (let i = 0; i < 7; i++) palms.push({ x: rng.range(x0 + 50, x1 - 50), y: rng.range(y0 + 50, y1 - 50), s: rng.range(0.85, 1.25) });
      continue;
    }
    let w = rng.range(370, 430), h = rng.range(370, 430), bcy = cy;
    if (kind === 'carlot') { w = 430; h = 290; bcy = y0 + 185; } // showroom north, forecourt south
    const b = { x: cx - w / 2, y: bcy - h / 2, w, h, cx, cy: bcy, hgt: rng.range(24, 62),
      name: kind === 'b' ? SIGN_NAMES[signIdx++ % SIGN_NAMES.length] : PLACE_INFO[kind].name,
      neon: PALETTE.neon[rng.int(0, PALETTE.neon.length - 1)], place: kind === 'b' ? null : kind };
    buildings.push(b);
    if (b.place) {
      // Door: midpoint of the building edge closest to a road, pushed out onto the sidewalk.
      const sides = [
        { x: b.x - 30, y: b.cy, d: Math.abs(b.x - (nearestRoadX(b.x))) },
        { x: b.x + b.w + 30, y: b.cy, d: Math.abs(b.x + b.w - (nearestRoadX(b.x + b.w))) },
        { x: b.cx, y: b.y - 30, d: Math.abs(b.y - (nearestRoadY(b.y))) },
        { x: b.cx, y: b.y + b.h + 30, d: Math.abs(b.y + b.h - (nearestRoadY(b.y + b.h))) },
      ].sort((p, q) => p.d - q.d);
      places.push({ id: b.place, name: PLACE_INFO[b.place].name, icon: PLACE_INFO[b.place].icon,
        x: sides[0].x, y: sides[0].y, bx: b.cx, by: b.cy });
    }
    for (let i = 0; i < 3; i++) palms.push({ x: rng.range(x0 + 30, x1 - 30), y: rng.range(y0 + 30, y1 - 30), s: rng.range(0.8, 1.15) });
  }
  // Car lot forecourt: mission cars and owned cars park here, clear of the showroom box.
  const carlot = places.find(p => p.id === 'carlot');
  const foreY = BLOCK_Y[2][0] + 445;
  lots.push({ x: carlot.bx - 250, y: foreY - 60, w: 500, h: 120, forecourt: true });
  const missionSpots = { coupe: { x: carlot.bx - 130, y: foreY, a: 0 }, job: { x: carlot.bx + 130, y: foreY, a: 0 } };
  // Beach + promenade palms and lamps.
  for (let y = 90; y < WORLD.h - 60; y += rng.range(105, 165)) palms.push({ x: rng.range(4130, 4360), y, s: rng.range(0.9, 1.4) });
  for (let y = 200; y < WORLD.h; y += 420) palms.push({ x: rng.range(3960, 4030), y, s: rng.range(0.85, 1.2) });
  for (const ax of AVENUES) for (const sy of STREETS) { lamps.push({ x: ax - 74, y: sy - 74 }); lamps.push({ x: ax + 74, y: sy + 74 }); }
  for (const ax of AVENUES) for (let y = 640; y < WORLD.h; y += 560) lamps.push({ x: ax - 74, y });
  // Curbside parked spots along avenues, clear of intersections.
  for (const ax of AVENUES) for (let y = 560; y < WORLD.h - 200; y += 235)
    if (!STREETS.some(sy => Math.abs(y - sy) < 190) && rng.chance(0.55)) parkedSpots.push({ x: ax - 46, y, a: -Math.PI / 2 });
  const intersections = [];
  for (const ax of AVENUES) for (const sy of STREETS) intersections.push({ x: ax, y: sy });
  return { buildings, places, lots, parks, palms, lamps, parkedSpots, intersections, missionSpots,
    spawn: { x: 352, y: 2920 }, dealers: [{ x: 4240, y: 900 }, { x: 4190, y: 1800 }, { x: 4260, y: 2700 }] };
}
function nearestRoadX(x) { let best = AVENUES[0]; for (const a of AVENUES) if (Math.abs(a - x) < Math.abs(best - x)) best = a; return best; }
function nearestRoadY(y) { let best = STREETS[0]; for (const s of STREETS) if (Math.abs(s - y) < Math.abs(best - y)) best = s; return best; }
export function placeById(city, id) { return city.places.find(p => p.id === id); }

export function isOnRoad(x, y) {
  if (AVENUES.some(a => Math.abs(x - a) <= ROAD_W / 2) && y > 0 && y < WORLD.h) return true;
  if (STREETS.some(s => Math.abs(y - s) <= ROAD_W / 2) && x > 0 && x < WORLD.beachX + 60) return true;
  return false;
}
export const isWater = (x, y) => x > WORLD.waterX;
export const isSand = (x, y) => x > WORLD.beachX && x <= WORLD.waterX;
// Push a circle out of every building AABB and keep it inside the world / out of the sea.
export function collide(city, x, y, r) {
  for (const b of city.buildings) {
    const nx = clamp(x, b.x, b.x + b.w), ny = clamp(y, b.y, b.y + b.h);
    let dx = x - nx, dy = y - ny, d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      if (d2 < 0.0001) { // centre inside the box: leave by the shallowest side
        const l = x - b.x, rt = b.x + b.w - x, t = y - b.y, bt = b.y + b.h - y;
        const m = Math.min(l, rt, t, bt);
        if (m === l) x = b.x - r; else if (m === rt) x = b.x + b.w + r; else if (m === t) y = b.y - r; else y = b.y + b.h + r;
      } else { const d = Math.sqrt(d2); x = nx + (dx / d) * r; y = ny + (dy / d) * r; }
    }
  }
  return { x: clamp(x, r, WORLD.w - r), y: clamp(y, r, WORLD.h - r) };
}
export function lineOfSight(city, x1, y1, x2, y2) {
  const d = Math.hypot(x2 - x1, y2 - y1), steps = Math.max(1, Math.floor(d / 26));
  for (let i = 1; i < steps; i++) {
    const x = x1 + (x2 - x1) * (i / steps), y = y1 + (y2 - y1) * (i / steps);
    for (const b of city.buildings) if (x > b.x - 2 && x < b.x + b.w + 2 && y > b.y - 2 && y < b.y + b.h + 2) return false;
  }
  return true;
}
