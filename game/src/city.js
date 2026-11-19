// NEON BAY's city, generated once from the seed: a road grid over grass, city blocks
// filled with neon-signed buildings, parking lots, parks and plazas, a boardwalk, a
// beach and open water to the east. Also the spatial helpers the rules use: what is
// road, what is water, and how a circle slides around the buildings.
import { ROADS, WORLD } from './config.js';
import { rngTools } from './random.js';

const WALL_COLORS = ['#5b4a68', '#6e4a5e', '#4a5e6e', '#6e5a3e', '#54486e', '#3e6e62', '#75506a', '#4f4460'];
const ROOF_COLORS = ['#2e2838', '#382e33', '#2c3438', '#38322a', '#322c40', '#28382f'];
const NEON_COLORS = ['#ff2e88', '#22d3ee', '#ffb703', '#06d6a0', '#c77dff', '#ff7b54'];
const SIGN_NAMES = [
  'HOTEL LUMINA', 'CLUB NEON PALMS', 'TACO SOL', 'CAFE MAREA', 'GYM FUERTE', 'LIQUOR LUNA',
  'SURF SHOP', 'CASINO CORAL', 'DINER ROSA', 'PHARMACY VIDA', 'GASOLINA', 'TATTOO TIDE',
  'CINEMA LUMEN', 'MARKET SOL', 'BAR ONDA', 'PIER 9', 'HOTEL AZUL', 'CLUB FLAMINGO',
  'BAY MOTORS', 'TALLER SOL', 'BANCO DEL MAR', 'CLINICA VIDA', 'PIZZA MAREA', 'HOTEL BRISA',
];

export function createCity(random) {
  const R = rngTools(random);
  const half = ROADS.width / 2;

  const roadsV = ROADS.verticalX.map((x) => ({ x, w: ROADS.width }));
  const roadsH = ROADS.horizontalY.map((y) => ({ y, w: ROADS.width }));
  const intersections = [];
  for (const vx of ROADS.verticalX) for (const hy of ROADS.horizontalY) intersections.push({ x: vx, y: hy });

  // Block rectangles between the roads (and the world edges / the beach).
  const colEdges = [0, ...ROADS.verticalX, WORLD.beachX];
  const rowEdges = [0, ...ROADS.horizontalY, WORLD.height];
  const blocks = [];
  for (let c = 0; c < colEdges.length - 1; c += 1) {
    for (let r = 0; r < rowEdges.length - 1; r += 1) {
      const x0 = colEdges[c] + (c === 0 ? 0 : half);
      const x1 = colEdges[c + 1] - (c === colEdges.length - 2 ? 0 : half);
      const y0 = rowEdges[r] + (r === 0 ? 0 : half);
      const y1 = rowEdges[r + 1] - (r === rowEdges.length - 2 ? 0 : half);
      if (x1 - x0 < 120 || y1 - y0 < 120) continue;
      blocks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, col: c, row: r });
    }
  }

  const buildings = [];
  const parks = [];
  const lots = [];
  const plazas = [];
  const palms = [];
  const props = [];
  const lamps = [];

  function addBuilding(x, y, w, h) {
    const floors = R.int(2, 9);
    const sign = R.chance(0.55) ? { text: R.pick(SIGN_NAMES), color: R.pick(NEON_COLORS) } : null;
    buildings.push({
      x, y, w, h, floors,
      wall: R.pick(WALL_COLORS), roof: R.pick(ROOF_COLORS),
      sign, seed: random(),
    });
  }

  for (const block of blocks) {
    const roll = random();
    const m = 30; // block margin: sidewalks and alleys
    const ix = block.x + m, iy = block.y + m, iw = block.w - m * 2, ih = block.h - m * 2;
    if (roll < 0.52) {
      // Buildings: one tower, a pair, or a quad.
      const layout = random();
      if (layout < 0.34) {
        addBuilding(ix, iy, iw, ih);
      } else if (layout < 0.67) {
        const gap = 26;
        if (iw > ih) {
          const w1 = (iw - gap) * R.range(0.4, 0.6);
          addBuilding(ix, iy, w1, ih);
          addBuilding(ix + w1 + gap, iy, iw - w1 - gap, ih);
        } else {
          const h1 = (ih - gap) * R.range(0.4, 0.6);
          addBuilding(ix, iy, iw, h1);
          addBuilding(ix, iy + h1 + gap, iw, ih - h1 - gap);
        }
      } else {
        const gap = 24;
        const w1 = (iw - gap) / 2, h1 = (ih - gap) / 2;
        addBuilding(ix, iy, w1, h1);
        addBuilding(ix + w1 + gap, iy, w1, h1);
        addBuilding(ix, iy + h1 + gap, w1, h1);
        addBuilding(ix + w1 + gap, iy + h1 + gap, w1, h1);
      }
      // Alley props behind the buildings.
      if (R.chance(0.7)) props.push({ x: block.x + R.range(8, 20), y: block.y + R.range(20, block.h - 20), r: 13, kind: 'dumpster' });
      if (R.chance(0.5)) props.push({ x: block.x + block.w - R.range(8, 20), y: block.y + R.range(20, block.h - 20), r: 11, kind: 'crate' });
    } else if (roll < 0.68) {
      // Parking lot with marked spots along both long edges.
      const spots = [];
      const horizontal = iw >= ih;
      const n = Math.floor((horizontal ? iw : ih) / 58);
      for (let i = 0; i < n; i += 1) {
        if (horizontal) {
          spots.push({ x: ix + 29 + i * 58, y: iy + 34, angle: Math.PI / 2 });
          spots.push({ x: ix + 29 + i * 58, y: iy + ih - 34, angle: -Math.PI / 2 });
        } else {
          spots.push({ x: ix + 34, y: iy + 29 + i * 58, angle: 0 });
          spots.push({ x: ix + iw - 34, y: iy + 29 + i * 58, angle: Math.PI });
        }
      }
      lots.push({ x: ix, y: iy, w: iw, h: ih, spots });
    } else if (roll < 0.84) {
      parks.push({ x: ix, y: iy, w: iw, h: ih });
      const count = R.int(4, 9);
      for (let i = 0; i < count; i += 1) palms.push({ x: ix + R.range(16, iw - 16), y: iy + R.range(16, ih - 16), s: R.range(0.8, 1.25) });
    } else {
      plazas.push({ x: ix, y: iy, w: iw, h: ih });
      for (let i = 0; i < R.int(2, 5); i += 1) palms.push({ x: ix + R.range(14, iw - 14), y: iy + R.range(14, ih - 14), s: R.range(0.8, 1.1) });
      if (R.chance(0.8)) props.push({ x: ix + iw / 2, y: iy + ih / 2, r: 15, kind: 'fountain' });
    }
  }

  // Boardwalk palms and beach palms.
  for (let y = 120; y < WORLD.height - 80; y += R.range(120, 190)) palms.push({ x: 3988, y, s: R.range(0.9, 1.3) });
  for (let i = 0; i < 26; i += 1) palms.push({ x: R.range(WORLD.beachX + 30, WORLD.waterX - 40), y: R.range(60, WORLD.height - 60), s: R.range(0.85, 1.3) });
  // A few palms on random sidewalks.
  for (let i = 0; i < 40; i += 1) {
    const onV = R.chance(0.5);
    const road = onV ? R.pick(ROADS.verticalX) : R.pick(ROADS.horizontalY);
    const along = R.range(60, (onV ? WORLD.height : WORLD.beachX) - 60);
    const side = R.chance(0.5) ? -1 : 1;
    palms.push(onV
      ? { x: road + side * (half + 16), y: along, s: R.range(0.75, 1.05) }
      : { x: along, y: road + side * (half + 16), s: R.range(0.75, 1.05) });
  }

  // Street lamps: intersection corners plus a run along every road.
  for (const p of intersections) {
    lamps.push({ x: p.x - half - 10, y: p.y - half - 10 });
    lamps.push({ x: p.x + half + 10, y: p.y + half + 10 });
  }
  for (const vx of ROADS.verticalX) for (let y = 210; y < WORLD.height; y += 300) lamps.push({ x: vx - half - 10, y });
  for (const hy of ROADS.horizontalY) for (let x = 210; x < WORLD.beachX; x += 300) lamps.push({ x, y: hy - half - 10 });

  // Named places the story uses, anchored to real generated spots.
  function nearestBuilding(x, y) {
    let best = null, bestD = Infinity;
    for (const b of buildings) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }
  function doorOf(b) { return { x: b.x + b.w / 2, y: b.y + b.h + 26 }; }
  function nearestLot(x, y) {
    let best = null, bestD = Infinity;
    for (const l of lots) {
      const d = (l.x + l.w / 2 - x) ** 2 + (l.y + l.h / 2 - y) ** 2;
      if (d < bestD) { bestD = d; best = l; }
    }
    return best;
  }

  const hotelB = nearestBuilding(3700, 1500);
  if (hotelB) hotelB.sign = { text: 'HOTEL LUMINA', color: '#ff2e88' };
  const bankB = nearestBuilding(1150, 1150);
  if (bankB) bankB.sign = { text: 'BANCO DEL MAR', color: '#ffb703' };
  const clinicB = nearestBuilding(650, 650);
  if (clinicB) clinicB.sign = { text: 'CLINICA VIDA', color: '#22d3ee' };
  const policeB = nearestBuilding(2250, 1650);
  if (policeB) policeB.sign = { text: 'POLICIA', color: '#22d3ee' };
  const hideoutB = nearestBuilding(3100, 3050);
  if (hideoutB) hideoutB.sign = { text: 'TALLER SOL', color: '#ff7b54' };
  const marketB = nearestBuilding(2500, 520);
  if (marketB) marketB.sign = { text: 'MARKET SOL', color: '#06d6a0' };
  const carLot = nearestLot(1900, 2500);

  const places = {
    hotel: hotelB ? doorOf(hotelB) : { x: 3700, y: 1560 },
    bank: bankB ? doorOf(bankB) : { x: 1150, y: 1250 },
    clinic: clinicB ? doorOf(clinicB) : { x: 650, y: 750 },
    policeStation: policeB ? doorOf(policeB) : { x: 2250, y: 1750 },
    hideout: hideoutB ? doorOf(hideoutB) : { x: 3100, y: 3150 },
    market: marketB ? doorOf(marketB) : { x: 2500, y: 620 },
    carLot: carLot ? { x: carLot.x + carLot.w / 2, y: carLot.y + carLot.h / 2, lot: carLot } : { x: 1900, y: 2500, lot: null },
    dealers: [
      { x: 4140, y: 880 },
      { x: 4170, y: 1830 },
      { x: 4120, y: 2740 },
    ],
    garage: { x: 560, y: 3060 },
  };
  // The drop-off garage is the lot nearest the south-west, when one exists there.
  const garageLot = nearestLot(560, 3060);
  if (garageLot) places.garage = { x: garageLot.x + garageLot.w / 2, y: garageLot.y + garageLot.h / 2 };

  return { roadsV, roadsH, intersections, buildings, parks, lots, plazas, palms, props, lamps, places };
}

/** True when the point is on a road surface (not the sidewalk). */
export function isOnRoad(city, x, y) {
  const half = ROADS.width / 2;
  if (x > WORLD.beachX) return false;
  for (const r of city.roadsV) if (Math.abs(x - r.x) <= half) return true;
  for (const r of city.roadsH) if (Math.abs(y - r.y) <= half) return true;
  return false;
}

export function isWater(x) {
  return x >= WORLD.waterX;
}

/**
 * Push a circle (x, y, r) out of every building and prop, keep it inside the world
 * and out of the water. Mutates and returns the point.
 */
export function collideWorld(city, point, r) {
  point.x = Math.min(WORLD.width - r, Math.max(r, point.x));
  point.y = Math.min(WORLD.height - r, Math.max(r, point.y));
  if (point.x > WORLD.waterX - r) point.x = WORLD.waterX - r;
  for (const b of city.buildings) {
    const nx = Math.min(b.x + b.w, Math.max(b.x, point.x));
    const ny = Math.min(b.y + b.h, Math.max(b.y, point.y));
    const dx = point.x - nx, dy = point.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      if (d2 === 0) { point.y = b.y + b.h + r; continue; }
      const d = Math.sqrt(d2);
      point.x = nx + (dx / d) * r;
      point.y = ny + (dy / d) * r;
    }
  }
  for (const p of city.props) {
    const dx = point.x - p.x, dy = point.y - p.y;
    const rr = r + p.r;
    const d2 = dx * dx + dy * dy;
    if (d2 < rr * rr && d2 > 0) {
      const d = Math.sqrt(d2);
      point.x = p.x + (dx / d) * rr;
      point.y = p.y + (dy / d) * rr;
    }
  }
  for (const t of city.palms) {
    const dx = point.x - t.x, dy = point.y - t.y;
    const rr = r + 7;
    const d2 = dx * dx + dy * dy;
    if (d2 < rr * rr && d2 > 0) {
      const d = Math.sqrt(d2);
      point.x = t.x + (dx / d) * rr;
      point.y = t.y + (dy / d) * rr;
    }
  }
  return point;
}

/** Building whose footprint contains the point, or null (used for line-of-sight). */
export function buildingAt(city, x, y) {
  for (const b of city.buildings) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

/** Cheap line-of-sight: sample the segment; blocked if it crosses a tall building. */
export function lineOfSight(city, x0, y0, x1, y1) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.floor(dist / 46));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const b = buildingAt(city, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    if (b && b.floors >= 3) return false;
  }
  return true;
}
