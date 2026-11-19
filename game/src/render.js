// NEON BAY — the renderer. Draws the procedural city from city.js (roads,
// neon-signed buildings, parks, the boardwalk, beach and animated water), every
// actor the world simulates, a day/dusk/night light model with lamp glow and
// headlights after dark, and the full HUD: money and health, the wanted stars,
// the clock, a live minimap, objective banner with a direction arrow, toasts,
// and the title / pause / busted / wasted screens. Pure canvas, no images.

import { VIEW, WORLD, ROADS, CAR, PALETTE, FONT, TITLE_FONT } from './config.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function cameraFor(world) {
  const p = world.player;
  return {
    x: clamp(p.x - VIEW.width / 2, 0, Math.max(0, WORLD.width - VIEW.width)),
    y: clamp(p.y - VIEW.height / 2, 0, Math.max(0, WORLD.height - VIEW.height)),
  };
}

/** 0 = full day, 1 = deep night, with a warm shoulder at dusk and dawn. */
function lightModel(hours) {
  if (hours < 4.5) return { dark: 0.88, warm: 0 };
  if (hours < 6.5) return { dark: 0.88 - (hours - 4.5) * 0.4, warm: 0.25 };
  if (hours < 16.5) return { dark: 0.06, warm: 0 };
  if (hours < 18.6) return { dark: 0.06 + (hours - 16.5) * 0.16, warm: 0.55 };
  if (hours < 20.2) return { dark: 0.4 + (hours - 18.6) * 0.3, warm: 0.2 };
  return { dark: 0.88, warm: 0 };
}

export function createRenderer(canvas) {
  canvas.width = VIEW.width;
  canvas.height = VIEW.height;
  const ctx = canvas.getContext('2d');
  let minimapBase = null;
  let minimapCity = null;
  // Smooth camera state: the view glides after the player with a touch of
  // lookahead in the direction of travel, instead of locking rigidly on.
  let smoothCam = null;
  let vignette = null;

  function currentCamera(world) {
    const base = cameraFor(world);
    const p = world.player;
    let lx = 0, ly = 0;
    if (p.car) {
      const lead = Math.min(110, Math.abs(p.car.speed) * 0.24);
      lx = Math.cos(p.car.angle) * lead * Math.sign(p.car.speed || 1);
      ly = Math.sin(p.car.angle) * lead * Math.sign(p.car.speed || 1);
    } else {
      lx = Math.cos(p.angle) * 26;
      ly = Math.sin(p.angle) * 26;
    }
    const target = {
      x: clamp(base.x + lx, 0, Math.max(0, WORLD.width - VIEW.width)),
      y: clamp(base.y + ly, 0, Math.max(0, WORLD.height - VIEW.height)),
    };
    if (!smoothCam) smoothCam = { ...target };
    else {
      smoothCam.x += (target.x - smoothCam.x) * 0.13;
      smoothCam.y += (target.y - smoothCam.y) * 0.13;
    }
    const shake = world.shake || 0;
    return {
      x: smoothCam.x + (shake ? (Math.random() * 2 - 1) * shake : 0),
      y: smoothCam.y + (shake ? (Math.random() * 2 - 1) * shake : 0),
    };
  }

  function buildMinimap(city) {
    const w = 264, h = 198;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const sx = w / WORLD.width, sy = h / WORLD.height;
    g.fillStyle = PALETTE.grassDark;
    g.fillRect(0, 0, w, h);
    g.fillStyle = PALETTE.sand;
    g.fillRect(WORLD.beachX * sx, 0, (WORLD.waterX - WORLD.beachX) * sx, h);
    g.fillStyle = PALETTE.waterDeep;
    g.fillRect(WORLD.waterX * sx, 0, w - WORLD.waterX * sx, h);
    g.fillStyle = '#4a4458';
    for (const b of city.buildings) g.fillRect(b.x * sx, b.y * sy, Math.max(2, b.w * sx), Math.max(2, b.h * sy));
    g.strokeStyle = '#9a94a8';
    g.lineWidth = 2;
    for (const r of city.roadsV) { g.beginPath(); g.moveTo(r.x * sx, 0); g.lineTo(r.x * sx, h); g.stroke(); }
    for (const r of city.roadsH) { g.beginPath(); g.moveTo(0, r.y * sy); g.lineTo(WORLD.beachX * sx, r.y * sy); g.stroke(); }
    minimapBase = c;
    minimapCity = city;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawWorld(world, cam, light) {
    const city = world.city;
    const t = world.elapsed;
    const vx0 = cam.x - 90, vy0 = cam.y - 90, vx1 = cam.x + VIEW.width + 90, vy1 = cam.y + VIEW.height + 90;
    const inView = (x, y, m = 0) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

    // Grass with a mowed checker so movement reads against the ground.
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    ctx.fillStyle = PALETTE.grassDark;
    const cell = 300;
    const gx0 = Math.floor(cam.x / cell), gy0 = Math.floor(cam.y / cell);
    for (let gx = gx0; gx <= gx0 + VIEW.width / cell + 1; gx += 1) {
      for (let gy = gy0; gy <= gy0 + VIEW.height / cell + 1; gy += 1) {
        if ((gx + gy) % 2 === 0) ctx.fillRect(gx * cell - cam.x, gy * cell - cam.y, cell, cell);
      }
    }

    // Beach, boardwalk, water.
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(WORLD.beachX - cam.x, 0, WORLD.waterX - WORLD.beachX, VIEW.height);
    ctx.fillStyle = PALETTE.sandDark;
    for (let y = -((cam.y * 0.5) % 90); y < VIEW.height; y += 90) ctx.fillRect(WORLD.beachX - cam.x, y, WORLD.waterX - WORLD.beachX, 3);
    ctx.fillStyle = PALETTE.boardwalk;
    ctx.fillRect(3946 - cam.x, 0, 74, VIEW.height);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = -(cam.y % 46); y < VIEW.height; y += 46) ctx.fillRect(3946 - cam.x, y, 74, 3);
    const wg = ctx.createLinearGradient(WORLD.waterX - cam.x, 0, VIEW.width, 0);
    wg.addColorStop(0, PALETTE.water);
    wg.addColorStop(1, PALETTE.waterDeep);
    ctx.fillStyle = wg;
    ctx.fillRect(WORLD.waterX - cam.x, 0, VIEW.width - (WORLD.waterX - cam.x), VIEW.height);
    ctx.strokeStyle = 'rgba(190,240,255,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i += 1) {
      const wx = WORLD.waterX + 26 + i * 44 - cam.x;
      if (wx < -60 || wx > VIEW.width + 60) continue;
      const wy = ((i * 173 + t * 26) % (VIEW.height + 80)) - 40;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.quadraticCurveTo(wx + 14, wy + 7, wx + 30, wy);
      ctx.stroke();
    }
    // Foam line where the sea meets the sand.
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    for (let y = 0; y <= VIEW.height; y += 24) {
      const fx = WORLD.waterX - cam.x + Math.sin(t * 1.4 + y * 0.05) * 5;
      if (y === 0) ctx.moveTo(fx, y); else ctx.lineTo(fx, y);
    }
    ctx.stroke();
    // Neon reflections: as the light drops, the shore signs smear down the
    // water in shimmering columns — the bay's signature postcard detail.
    if (light.dark > 0.18) {
      const neon = ['#ff2e88', '#22d3ee', '#ffb703', '#06d6a0', '#c77dff', '#ff7b54'];
      ctx.lineWidth = 5;
      for (let i = 0; i < 26; i += 1) {
        const wy = ((i * 149 + Math.floor(cam.y)) % (VIEW.height + 120)) - 60;
        const wob = Math.sin(t * 2.2 + i * 1.7) * 7;
        const wx = WORLD.waterX - cam.x + 16 + (i % 5) * 30 + wob;
        if (wx > VIEW.width + 30) continue;
        ctx.strokeStyle = neon[i % neon.length];
        ctx.globalAlpha = light.dark * (0.10 + 0.07 * (0.5 + 0.5 * Math.sin(t * 3 + i * 2.3)));
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx + Math.sin(t * 2.6 + i) * 5, wy + 26 + (i % 3) * 10);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Parks and plazas.
    for (const p of city.parks) {
      if (!inView(p.x + p.w / 2, p.y + p.h / 2, 500)) continue;
      ctx.fillStyle = '#2f6b3e';
      ctx.fillRect(p.x - cam.x, p.y - cam.y, p.w, p.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.strokeRect(p.x - cam.x + 8, p.y - cam.y + 8, p.w - 16, p.h - 16);
    }
    for (const p of city.plazas) {
      if (!inView(p.x + p.w / 2, p.y + p.h / 2, 500)) continue;
      ctx.fillStyle = '#7d7468';
      ctx.fillRect(p.x - cam.x, p.y - cam.y, p.w, p.h);
    }
    // Parking lots with their marked spots.
    for (const lot of city.lots) {
      if (!inView(lot.x + lot.w / 2, lot.y + lot.h / 2, 500)) continue;
      ctx.fillStyle = '#3a3644';
      ctx.fillRect(lot.x - cam.x, lot.y - cam.y, lot.w, lot.h);
      ctx.strokeStyle = 'rgba(230,230,240,0.4)';
      ctx.lineWidth = 2;
      for (const s of lot.spots) {
        ctx.save();
        ctx.translate(s.x - cam.x, s.y - cam.y);
        ctx.rotate(s.angle);
        ctx.strokeRect(-16, -30, 32, 60);
        ctx.restore();
      }
    }

    // Roads: sidewalk slab, asphalt, dashes, crosswalks.
    const half = ROADS.width / 2;
    ctx.fillStyle = PALETTE.sidewalk;
    for (const r of city.roadsV) ctx.fillRect(r.x - half - 15 - cam.x, 0, ROADS.width + 30, VIEW.height);
    for (const r of city.roadsH) ctx.fillRect(0, r.y - half - 15 - cam.y, VIEW.width, ROADS.width + 30);
    ctx.fillStyle = PALETTE.asphalt;
    for (const r of city.roadsV) ctx.fillRect(r.x - half - cam.x, 0, ROADS.width, VIEW.height);
    for (const r of city.roadsH) ctx.fillRect(0, r.y - half - cam.y, VIEW.width, ROADS.width);
    // Tyre-worn dark streaks down each lane and seams across the sidewalks:
    // the cheap details that stop a road reading as a flat grey ribbon.
    ctx.fillStyle = 'rgba(0,0,0,0.055)';
    for (const r of city.roadsV) {
      ctx.fillRect(r.x - ROADS.laneOffset - 13 - cam.x, 0, 26, VIEW.height);
      ctx.fillRect(r.x + ROADS.laneOffset - 13 - cam.x, 0, 26, VIEW.height);
    }
    for (const r of city.roadsH) {
      ctx.fillRect(0, r.y - ROADS.laneOffset - 13 - cam.y, VIEW.width, 26);
      ctx.fillRect(0, r.y + ROADS.laneOffset - 13 - cam.y, VIEW.width, 26);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 2;
    for (const r of city.roadsV) {
      for (let y = -(cam.y % 52); y < VIEW.height; y += 52) {
        ctx.beginPath();
        ctx.moveTo(r.x - half - 15 - cam.x, y); ctx.lineTo(r.x - half - 2 - cam.x, y);
        ctx.moveTo(r.x + half + 2 - cam.x, y); ctx.lineTo(r.x + half + 15 - cam.x, y);
        ctx.stroke();
      }
    }
    for (const r of city.roadsH) {
      for (let x = -(cam.x % 52); x < VIEW.width; x += 52) {
        ctx.beginPath();
        ctx.moveTo(x, r.y - half - 15 - cam.y); ctx.lineTo(x, r.y - half - 2 - cam.y);
        ctx.moveTo(x, r.y + half + 2 - cam.y); ctx.lineTo(x, r.y + half + 15 - cam.y);
        ctx.stroke();
      }
    }
    // Worn patches and old repairs on the asphalt, placed deterministically.
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (let i = 0; i < city.roadsV.length; i += 1) {
      const r = city.roadsV[i];
      for (let k = 0; k < 7; k += 1) {
        const py = ((i * 613 + k * 887) % 3400) - cam.y;
        if (py < -60 || py > VIEW.height + 60) continue;
        ctx.beginPath();
        ctx.ellipse(r.x + ((k % 3) - 1) * 26 - cam.x, py, 30 + (k % 4) * 9, 17, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = PALETTE.laneMark;
    for (const r of city.roadsV) {
      for (let y = -(cam.y % 64); y < VIEW.height; y += 64) ctx.fillRect(r.x - 2 - cam.x, y, 4, 34);
    }
    for (const r of city.roadsH) {
      for (let x = -(cam.x % 64); x < VIEW.width; x += 64) ctx.fillRect(x, r.y - 2 - cam.y, 34, 4);
    }
    ctx.fillStyle = PALETTE.crosswalk;
    for (const c of city.intersections) {
      if (!inView(c.x, c.y, 160)) continue;
      for (let i = -2; i <= 2; i += 1) {
        ctx.fillRect(c.x - half - 12 - cam.x, c.y + i * 24 - 7 - cam.y, 9, 14);
        ctx.fillRect(c.x + half + 3 - cam.x, c.y + i * 24 - 7 - cam.y, 9, 14);
        ctx.fillRect(c.x + i * 24 - 7 - cam.x, c.y - half - 12 - cam.y, 14, 9);
        ctx.fillRect(c.x + i * 24 - 7 - cam.x, c.y + half + 3 - cam.y, 14, 9);
      }
    }

    // Buildings: sun shadow, walls, roof, windows, neon signs after dark.
    const shX = clamp((12 - world.timeHours) * 1.6, -14, 14);
    const shY = 9;
    for (const b of city.buildings) {
      if (!inView(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h))) continue;
      const x = b.x - cam.x, y = b.y - cam.y;
      // Layered soft shadow: three passes, growing and fading, read as blur
      // without paying for a canvas shadow pass per building.
      ctx.fillStyle = 'rgba(10,10,20,0.10)';
      ctx.fillRect(x + shX * 2.1, y + shY * 2.1, b.w, b.h);
      ctx.fillStyle = 'rgba(10,10,20,0.16)';
      ctx.fillRect(x + shX * 1.5, y + shY * 1.5, b.w, b.h);
      ctx.fillStyle = 'rgba(10,10,20,0.30)';
      ctx.fillRect(x + shX, y + shY, b.w, b.h);
      ctx.fillStyle = b.wall;
      ctx.fillRect(x, y, b.w, b.h);
      ctx.fillStyle = b.roof;
      ctx.fillRect(x + 7, y + 7, b.w - 14, b.h - 14);
      // Windows: a seeded grid, lit warm at night.
      const cols = Math.max(2, Math.floor(b.w / 34));
      const rows = Math.max(2, Math.floor(b.h / 34));
      for (let cx = 0; cx < cols; cx += 1) {
        for (let ry = 0; ry < rows; ry += 1) {
          const lit = ((b.seed * 977 + cx * 131 + ry * 57) % 10) < (light.dark > 0.3 ? 6 : 2);
          ctx.fillStyle = lit ? (light.dark > 0.3 ? '#ffd98a' : '#aebfd0') : '#232030';
          ctx.fillRect(x + 14 + cx * 30, y + 14 + ry * 30, 13, 17);
        }
      }
      if (b.sign) {
        ctx.save();
        ctx.font = `bold 17px ${FONT}`;
        ctx.textAlign = 'center';
        if (light.dark > 0.22) {
          ctx.shadowColor = b.sign.color;
          ctx.shadowBlur = 16;
          ctx.fillStyle = b.sign.color;
        } else {
          ctx.fillStyle = 'rgba(240,240,245,0.75)';
        }
        ctx.fillText(b.sign.text, x + b.w / 2, y + b.h / 2 + 6);
        ctx.restore();
      }
    }

    // Props.
    for (const p of city.props) {
      if (!inView(p.x, p.y, 60)) continue;
      const x = p.x - cam.x, y = p.y - cam.y;
      if (p.kind === 'dumpster') { ctx.fillStyle = '#2e5339'; ctx.fillRect(x - 17, y - 12, 34, 24); ctx.fillStyle = '#22402c'; ctx.fillRect(x - 17, y - 12, 34, 6); }
      else if (p.kind === 'crate') { ctx.fillStyle = '#8a6b45'; ctx.fillRect(x - 11, y - 11, 22, 22); ctx.strokeStyle = '#6d5435'; ctx.strokeRect(x - 11, y - 11, 22, 22); }
      else { ctx.fillStyle = '#3d8fa8'; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#bfefff'; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); }
    }
    // Palms: a curved trunk and a fan of fronds.
    ctx.strokeStyle = '#6d5435';
    for (const palm of city.palms) {
      if (!inView(palm.x, palm.y, 60)) continue;
      const x = palm.x - cam.x, y = palm.y - cam.y, s = palm.s;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 4 * s, y - 12 * s, x + 8 * s, y - 20 * s); ctx.stroke();
      ctx.strokeStyle = '#2e8b57';
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 + palm.x * 0.01;
        ctx.beginPath();
        ctx.moveTo(x + 8 * s, y - 20 * s);
        ctx.quadraticCurveTo(x + 8 * s + Math.cos(a) * 13 * s, y - 20 * s + Math.sin(a) * 8 * s - 4, x + 8 * s + Math.cos(a) * 21 * s, y - 20 * s + Math.sin(a) * 13 * s + 3);
        ctx.stroke();
      }
      ctx.strokeStyle = '#6d5435';
    }
    // Lamp posts.
    ctx.fillStyle = '#22222c';
    for (const lamp of city.lamps) {
      if (!inView(lamp.x, lamp.y, 30)) continue;
      ctx.beginPath(); ctx.arc(lamp.x - cam.x, lamp.y - cam.y, 4, 0, Math.PI * 2); ctx.fill();
    }
  }


  function drawCar(car, cam, t) {
    const x = car.x - cam.x, y = car.y - cam.y;
    if (x < -120 || x > VIEW.width + 120 || y < -120 || y > VIEW.height + 120) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(car.angle);
    // Soft two-pass shadow so the car sits on the road instead of pasted on.
    ctx.fillStyle = 'rgba(8,8,16,0.16)';
    ctx.beginPath(); ctx.ellipse(7, 10, CAR.length * 0.58, CAR.width * 0.62, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(8,8,16,0.32)';
    ctx.beginPath(); ctx.ellipse(4, 6, CAR.length * 0.52, CAR.width * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    const wrecked = car.health <= 0;
    ctx.fillStyle = wrecked ? '#3c3c44' : car.color;
    roundRect(-CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width, 10);
    ctx.fill();
    if (car.kind === 'police') {
      ctx.fillStyle = '#2b3a8f';
      ctx.fillRect(-CAR.length / 2, -CAR.width / 2, CAR.length, 9);
      ctx.fillRect(-CAR.length / 2, CAR.width / 2 - 9, CAR.length, 9);
      const flash = Math.floor(t * 6) % 2 === 0;
      ctx.fillStyle = flash ? '#ff3355' : '#3355ff';
      ctx.fillRect(-9, -11, 18, 22);
      ctx.fillStyle = flash ? '#3355ff' : '#ff3355';
      ctx.fillRect(-9, -11, 8, 22);
    }
    if (car.kind === 'mission') {
      ctx.fillStyle = '#111';
      ctx.fillRect(-CAR.length / 2, -4, CAR.length, 8);
    }
    // Cabin and glass.
    ctx.fillStyle = '#1d2733';
    roundRect(-16, -CAR.width / 2 + 7, 36, CAR.width - 14, 6);
    ctx.fill();
    ctx.fillStyle = '#7fb2d9';
    ctx.fillRect(12, -CAR.width / 2 + 9, 7, CAR.width - 18);
    // Headlights.
    ctx.fillStyle = '#fff6c9';
    ctx.fillRect(CAR.length / 2 - 4, -CAR.width / 2 + 5, 4, 8);
    ctx.fillRect(CAR.length / 2 - 4, CAR.width / 2 - 13, 4, 8);
    ctx.fillStyle = '#ff4455';
    ctx.fillRect(-CAR.length / 2, -CAR.width / 2 + 5, 3, 7);
    ctx.fillRect(-CAR.length / 2, CAR.width / 2 - 12, 3, 7);
    if (car.health < 45 && !wrecked) {
      ctx.fillStyle = 'rgba(20,20,26,0.85)';
      ctx.fillRect(6, -8, 16, 16);
    }
    ctx.restore();
  }

  function drawPerson(x, y, angle, shirt, opts = {}) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(8,8,16,0.35)';
    ctx.beginPath(); ctx.ellipse(2, 4, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
    if (opts.dead) {
      ctx.rotate(angle);
      ctx.fillStyle = shirt;
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8b98d';
      ctx.beginPath(); ctx.arc(19, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    ctx.fillStyle = shirt;
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8b98d';
    ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
    if (opts.cap) {
      ctx.fillStyle = opts.cap;
      ctx.beginPath(); ctx.arc(0, 0, 6.5, Math.PI * 0.9, Math.PI * 2.1); ctx.fill();
    }
    if (opts.gun) {
      ctx.strokeStyle = '#14141c';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 8, Math.sin(angle) * 8);
      ctx.lineTo(Math.cos(angle) * 21, Math.sin(angle) * 21);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawActors(world, cam, light) {
    const t = world.elapsed;
    // Skid marks lie on the ground under everything that moves.
    for (const s of world.skids) {
      const x = s.x - cam.x, y = s.y - cam.y;
      if (x < -20 || x > VIEW.width + 20 || y < -20 || y > VIEW.height + 20) continue;
      const fade = clamp(s.ttl / s.maxT, 0, 1);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(s.angle);
      ctx.fillStyle = s.sand ? `rgba(146,118,74,${0.4 * fade})` : `rgba(12,12,16,${0.42 * fade})`;
      ctx.fillRect(-7, -2.5, 14, 5);
      ctx.restore();
    }
    // Pickups first, under everything alive.
    for (const pk of world.pickups) {
      const x = pk.x - cam.x, y = pk.y - cam.y + Math.sin(pk.bob) * 3;
      if (x < -30 || x > VIEW.width + 30 || y < -30 || y > VIEW.height + 30) continue;
      if (pk.kind === 'money') {
        ctx.fillStyle = '#2fa84f';
        ctx.fillRect(x - 10, y - 6, 20, 12);
        ctx.fillStyle = '#b9f4c9';
        ctx.fillRect(x - 3, y - 6, 6, 12);
      } else {
        ctx.fillStyle = '#ff8c42';
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(x - 1.5, y - 6, 3, 12); ctx.fillRect(x - 6, y - 1.5, 12, 3);
      }
    }
    // Mission marker: a pillar of light on the objective.
    const target = world.objectiveTarget();
    if (target && !world.fate) {
      const x = target.x - cam.x, y = target.y - cam.y;
      if (x > -80 && x < VIEW.width + 80 && y > -80 && y < VIEW.height + 80) {
        const pulse = 0.65 + Math.sin(t * 4) * 0.25;
        const grad = ctx.createLinearGradient(0, y - 260, 0, y);
        grad.addColorStop(0, 'rgba(255,183,3,0)');
        grad.addColorStop(1, `rgba(255,183,3,${0.5 * pulse})`);
        ctx.fillStyle = grad;
        ctx.fillRect(x - 13, y - 260, 26, 260);
        ctx.strokeStyle = `rgba(255,183,3,${pulse})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, 26 + Math.sin(t * 4) * 5, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = PALETTE.neonGold;
        ctx.beginPath();
        ctx.moveTo(x, y - 44 - Math.sin(t * 4) * 5);
        ctx.lineTo(x - 10, y - 62 - Math.sin(t * 4) * 5);
        ctx.lineTo(x + 10, y - 62 - Math.sin(t * 4) * 5);
        ctx.closePath(); ctx.fill();
      }
    }
    for (const car of world.cars) drawCar(car, cam, t);
    for (const ped of world.peds) {
      drawPerson(ped.x - cam.x, ped.y - cam.y, ped.angle, ped.dealer ? '#20242c' : ped.shirt,
        { dead: ped.dead, cap: ped.dealer ? '#c9184a' : null });
    }
    for (const cop of world.cops) {
      drawPerson(cop.x - cam.x, cop.y - cam.y, cop.angle, '#2b3a8f', { dead: cop.dead, cap: '#16224f', gun: !cop.dead && world.stars() >= 2 });
    }
    // The player (hidden inside the car: the car is the avatar then).
    const p = world.player;
    if (!p.car) {
      if (p.hurtT > 0) {
        ctx.strokeStyle = 'rgba(239,71,111,0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x - cam.x, p.y - cam.y, 17, 0, Math.PI * 2); ctx.stroke();
      }
      drawPerson(p.x - cam.x, p.y - cam.y, p.angle, PALETTE.player, { gun: p.hasGun, cap: '#111' });
    }
    // Muzzle flash: a brief star at the barrel, gone in two frames.
    if (world.muzzle) {
      const m = world.muzzle;
      const x = m.x - cam.x, y = m.y - cam.y;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(m.angle);
      ctx.globalAlpha = clamp(m.ttl / m.maxT, 0, 1);
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.moveTo(26, 0); ctx.lineTo(8, -6); ctx.lineTo(12, 0); ctx.lineTo(8, 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffb703';
      ctx.beginPath(); ctx.arc(6, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // Tracers and particles.
    for (const tr of world.tracers) {
      ctx.strokeStyle = tr.hostile ? 'rgba(255,90,90,0.9)' : 'rgba(255,240,180,0.95)';
      ctx.lineWidth = 2;
      ctx.globalAlpha = clamp(tr.ttl / tr.maxT, 0, 1);
      ctx.beginPath();
      ctx.moveTo(tr.x0 - cam.x, tr.y0 - cam.y);
      ctx.lineTo(tr.x1 - cam.x, tr.y1 - cam.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const pt of world.particles) {
      ctx.globalAlpha = clamp(pt.ttl / pt.maxT, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - cam.x - pt.size / 2, pt.y - cam.y - pt.size / 2, pt.size, pt.size);
      ctx.globalAlpha = 1;
    }
  }

  function drawLighting(world, cam, light) {
    // Dusk gradient: violet up top melting into warm amber near the ground.
    if (light.warm > 0.03) {
      const grad = ctx.createLinearGradient(0, 0, 0, VIEW.height);
      grad.addColorStop(0, `rgba(58,30,96,${light.warm * 0.20})`);
      grad.addColorStop(0.55, `rgba(255,110,64,${light.warm * 0.10})`);
      grad.addColorStop(1, `rgba(255,170,80,${light.warm * 0.05})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
    if (light.dark > 0.04) {
      ctx.fillStyle = `rgba(10,12,44,${light.dark * 0.52})`;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
    if (light.warm > 0.02) {
      ctx.fillStyle = `rgba(255,138,61,${light.warm * 0.13})`;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
    if (light.dark < 0.25) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, color, a) => {
      if (x < -r || x > VIEW.width + r || y < -r || y > VIEW.height + r) return;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, color.replace('A', String(a)));
      g.addColorStop(1, color.replace('A', '0'));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const lamp of world.city.lamps) glow(lamp.x - cam.x, lamp.y - cam.y, 74, 'rgba(255,196,110,A)', 0.16);
    // Neon signs bleed their colour onto the street around them.
    for (const b of world.city.buildings) {
      if (!b.sign) continue;
      const bx = b.x + b.w / 2 - cam.x, by = b.y + b.h / 2 - cam.y;
      if (bx < -90 || bx > VIEW.width + 90 || by < -90 || by > VIEW.height + 90) continue;
      const hex = b.sign.color;
      const r = parseInt(hex.slice(1, 3), 16), gcol = parseInt(hex.slice(3, 5), 16), bl = parseInt(hex.slice(5, 7), 16);
      glow(bx, by, 96, `rgba(${r},${gcol},${bl},A)`, 0.10);
    }
    for (const car of world.cars) {
      const hx = car.x + Math.cos(car.angle) * 60 - cam.x;
      const hy = car.y + Math.sin(car.angle) * 60 - cam.y;
      glow(hx, hy, 66, 'rgba(255,240,190,A)', 0.13);
      // A proper headlight cone thrown ahead of every moving car.
      const cxp = car.x - cam.x, cyp = car.y - cam.y;
      if (cxp > -180 && cxp < VIEW.width + 180 && cyp > -180 && cyp < VIEW.height + 180) {
        const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
        const rx = -fy, ry = fx;
        const tipX = cxp + fx * 150, tipY = cyp + fy * 150;
        ctx.fillStyle = 'rgba(255,240,190,0.045)';
        ctx.beginPath();
        ctx.moveTo(cxp + fx * 40 + rx * 15, cyp + fy * 40 + ry * 15);
        ctx.lineTo(tipX + rx * 40, tipY + ry * 40);
        ctx.lineTo(tipX - rx * 40, tipY - ry * 40);
        ctx.lineTo(cxp + fx * 40 - rx * 15, cyp + fy * 40 - ry * 15);
        ctx.closePath();
        ctx.fill();
      }
      if (car.kind === 'police' && car.driver !== null) {
        glow(car.x - cam.x, car.y - cam.y, 90, Math.floor(world.elapsed * 6) % 2 ? 'rgba(255,51,85,A)' : 'rgba(51,85,255,A)', 0.2);
      }
    }
    const target = world.objectiveTarget();
    if (target) glow(target.x - cam.x, target.y - cam.y, 90, 'rgba(255,183,3,A)', 0.15);
    ctx.restore();
  }

  function drawMinimap(world) {
    if (!minimapBase || minimapCity !== world.city) buildMinimap(world.city);
    const x0 = 16, y0 = VIEW.height - 214;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.drawImage(minimapBase, x0, y0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(245,242,234,0.5)';
    ctx.strokeRect(x0, y0, 264, 198);
    const sx = 264 / WORLD.width, sy = 198 / WORLD.height;
    const dot = (x, y, color, r = 3) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x0 + x * sx, y0 + y * sy, r, 0, Math.PI * 2); ctx.fill();
    };
    for (const car of world.cars) if (car.kind === 'police') dot(car.x, car.y, '#5b8cff', 2.5);
    for (const cop of world.cops) if (!cop.dead) dot(cop.x, cop.y, '#5b8cff', 2);
    for (const ped of world.peds) if (ped.dealer && !ped.dead) dot(ped.x, ped.y, '#ff3355', 2.5);
    const target = world.objectiveTarget();
    if (target) {
      dot(target.x, target.y, PALETTE.neonGold, 4 + Math.sin(world.elapsed * 5) * 1.2);
    }
    const p = world.player;
    ctx.save();
    ctx.translate(x0 + p.x * sx, y0 + p.y * sy);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = PALETTE.panel;
    roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,242,234,0.18)';
    ctx.stroke();
    // A hairline of neon along the top edge: the modern-HUD tell.
    ctx.fillStyle = 'rgba(34,211,238,0.35)';
    ctx.fillRect(x + 12, y + 1, w - 24, 2);
  }

  let hudCam = null;
  function drawHUD(world, opts) {
    const p = world.player;
    // Money + health, top left.
    panel(16, 14, 252, 74);
    ctx.save();
    ctx.shadowColor = 'rgba(6,214,160,0.55)';
    ctx.shadowBlur = 9;
    ctx.fillStyle = PALETTE.good;
    ctx.font = `bold 30px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(`$${world.money.toLocaleString('en-US')}`, 30, 50);
    ctx.restore();
    ctx.fillStyle = 'rgba(245,242,234,0.25)';
    ctx.fillRect(30, 62, 220, 10);
    const hpFrac = clamp(p.health / 100, 0, 1);
    ctx.fillStyle = hpFrac > 0.35 ? PALETTE.good : PALETTE.danger;
    ctx.fillRect(30, 62, 220 * hpFrac, 10);
    if (world.bust > 0.02) {
      ctx.fillStyle = PALETTE.danger;
      ctx.font = `bold 15px ${FONT}`;
      ctx.fillText('BUSTED', 30, 108);
      ctx.fillStyle = 'rgba(245,242,234,0.25)';
      ctx.fillRect(96, 97, 154, 9);
      ctx.fillStyle = PALETTE.danger;
      ctx.fillRect(96, 97, 154 * world.bust, 9);
    }
    // Clock + stars, top right.
    const hh = Math.floor(world.timeHours);
    const mm = Math.floor((world.timeHours - hh) * 60);
    panel(VIEW.width - 246, 14, 230, 74);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `bold 26px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, VIEW.width - 32, 48);
    const stars = world.stars();
    ctx.font = '24px sans-serif';
    for (let i = 0; i < 5; i += 1) {
      const lit = i < stars;
      const flashOff = lit && world.unseenFor > 3 && Math.floor(world.elapsed * 2.4) % 2 === 0;
      ctx.fillStyle = lit ? (flashOff ? 'rgba(255,183,3,0.35)' : PALETTE.neonGold) : 'rgba(245,242,234,0.22)';
      ctx.fillText('★', VIEW.width - 196 + i * 34, 78);
    }
    // Driving readout, bottom right.
    if (p.car) {
      panel(VIEW.width - 246, VIEW.height - 96, 230, 80);
      ctx.fillStyle = PALETTE.text;
      ctx.font = `bold 22px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(Math.abs(p.car.speed) * 0.32)} km/h`, VIEW.width - 32, VIEW.height - 62);
      ctx.fillStyle = 'rgba(245,242,234,0.25)';
      ctx.fillRect(VIEW.width - 232, VIEW.height - 52, 200, 8);
      ctx.fillStyle = p.car.health > 30 ? PALETTE.neonCyan : PALETTE.danger;
      ctx.fillRect(VIEW.width - 232, VIEW.height - 52, 200 * clamp(p.car.health / 100, 0, 1), 8);
    } else {
      panel(VIEW.width - 190, VIEW.height - 62, 174, 46);
      ctx.fillStyle = PALETTE.muted;
      ctx.font = `bold 16px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(p.hasGun ? 'WEAPON: PISTOL' : 'WEAPON: FISTS', VIEW.width - 30, VIEW.height - 33);
    }
    drawMinimap(world);
    // Objective banner, bottom centre, with distance.
    const text = world.objectiveText();
    if (text) {
      ctx.font = `bold 18px ${FONT}`;
      const w = Math.min(620, ctx.measureText(text).width + 90);
      panel(VIEW.width / 2 - w / 2, VIEW.height - 58, w, 42);
      ctx.fillStyle = PALETTE.text;
      ctx.textAlign = 'center';
      let label = text;
      const target = world.objectiveTarget();
      if (target) label += `  ·  ${Math.round(Math.hypot(target.x - p.x, target.y - p.y) / 10)} m`;
      ctx.fillText(label, VIEW.width / 2, VIEW.height - 30);
    }
    // Direction arrow around the player when the target is far.
    const target = world.objectiveTarget();
    if (target && !p.car) {
      const d = Math.hypot(target.x - p.x, target.y - p.y);
      if (d > 340) {
        const a = Math.atan2(target.y - p.y, target.x - p.x);
        const cam = hudCam || cameraFor(world);
        const cx = p.x - cam.x + Math.cos(a) * 52;
        const cy = p.y - cam.y + Math.sin(a) * 52;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.fillStyle = PALETTE.neonGold;
        ctx.beginPath();
        ctx.moveTo(13, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    // Toasts above the objective banner.
    ctx.font = `bold 17px ${FONT}`;
    ctx.textAlign = 'center';
    world.toasts.forEach((toast, i) => {
      ctx.globalAlpha = clamp(toast.ttl, 0, 1);
      ctx.fillStyle = PALETTE.neonCyan;
      ctx.fillText(toast.text, VIEW.width / 2, VIEW.height - 78 - i * 24);
      ctx.globalAlpha = 1;
    });
    // Mission banner.
    if (world.banner) {
      const b = world.banner;
      ctx.globalAlpha = clamp(b.ttl, 0, 1);
      panel(VIEW.width / 2 - 330, 104, 660, 84);
      ctx.fillStyle = PALETTE.neonGold;
      ctx.font = `bold 25px ${FONT}`;
      ctx.fillText(b.title, VIEW.width / 2, 140);
      ctx.fillStyle = PALETTE.text;
      ctx.font = `16px ${FONT}`;
      const sub = b.sub.length > 92 ? `${b.sub.slice(0, 92)}…` : b.sub;
      ctx.fillText(sub, VIEW.width / 2, 168);
      ctx.globalAlpha = 1;
    }
    if (opts && opts.muted) {
      ctx.fillStyle = PALETTE.muted;
      ctx.font = `bold 14px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText('MUTED (M)', VIEW.width - 18, VIEW.height - 108);
    }
  }

  function drawTitle(world, opts) {
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW.height);
    grad.addColorStop(0, 'rgba(24,8,44,0.62)');
    grad.addColorStop(0.5, 'rgba(64,20,60,0.28)');
    grad.addColorStop(1, 'rgba(10,6,26,0.74)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    // Poster sun: a striped setting sun hanging over the bay behind the logo.
    ctx.save();
    const sunX = VIEW.width / 2, sunY = 252, sunR = 148;
    const sunGrad = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
    sunGrad.addColorStop(0, 'rgba(255,183,3,0.55)');
    sunGrad.addColorStop(0.6, 'rgba(255,46,136,0.45)');
    sunGrad.addColorStop(1, 'rgba(199,125,255,0.35)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.fill();
    // Retro stripes cut across the lower sun (painted in the overlay's tone,
    // clipped to the disc so the city behind is never touched).
    ctx.clip();
    ctx.fillStyle = 'rgba(18,8,32,0.6)';
    for (let i = 0; i < 5; i += 1) {
      ctx.fillRect(sunX - sunR, sunY + 18 + i * 26, sunR * 2, 5 + i * 2);
    }
    ctx.restore();
    // Poster frame.
    ctx.strokeStyle = 'rgba(255,46,136,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, VIEW.width - 28, VIEW.height - 28);
    ctx.strokeStyle = 'rgba(34,211,238,0.4)';
    ctx.strokeRect(20, 20, VIEW.width - 40, VIEW.height - 40);
    ctx.textAlign = 'center';
    ctx.save();
    ctx.font = `96px ${TITLE_FONT}`;
    ctx.shadowColor = PALETTE.neonPink;
    ctx.shadowBlur = 48;
    ctx.fillStyle = PALETTE.neonPink;
    ctx.fillText('NEON', VIEW.width / 2, 208);
    ctx.shadowBlur = 20;
    ctx.fillText('NEON', VIEW.width / 2, 208);
    ctx.shadowColor = PALETTE.neonCyan;
    ctx.shadowBlur = 48;
    ctx.fillStyle = PALETTE.neonCyan;
    ctx.fillText('BAY', VIEW.width / 2, 304);
    ctx.shadowBlur = 20;
    ctx.fillText('BAY', VIEW.width / 2, 304);
    ctx.restore();
    // Neon underline sweeping pink into cyan.
    const bar = ctx.createLinearGradient(VIEW.width / 2 - 210, 0, VIEW.width / 2 + 210, 0);
    bar.addColorStop(0, PALETTE.neonPink);
    bar.addColorStop(0.5, PALETTE.neonGold);
    bar.addColorStop(1, PALETTE.neonCyan);
    ctx.fillStyle = bar;
    ctx.fillRect(VIEW.width / 2 - 210, 322, 420, 4);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `21px ${FONT}`;
    ctx.fillText('A top-down crime story on a neon beach — steal the coupe, run the package, take the bank.', VIEW.width / 2, 356);
    panel(VIEW.width / 2 - 300, 392, 600, 176);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `18px ${FONT}`;
    const lines = [
      'WASD / Arrows — move & drive      Mouse — aim',
      'Click — punch / shoot             E — enter / exit car',
      'Shift — run                       P / Esc — pause',
      'M — mute                          Follow the gold pillar',
    ];
    lines.forEach((line, i) => ctx.fillText(line, VIEW.width / 2, 434 + i * 32));
    ctx.save();
    ctx.shadowColor = PALETTE.neonGold;
    ctx.shadowBlur = 12;
    ctx.fillStyle = PALETTE.neonGold;
    ctx.font = `bold 26px ${FONT}`;
    const blink = Math.floor(world.elapsed * 1.6) % 2 === 0;
    if (blink) ctx.fillText(opts && opts.hasSave ? 'CLICK OR PRESS ENTER — START      C — CONTINUE' : 'CLICK OR PRESS ENTER — START', VIEW.width / 2, 624);
    ctx.restore();
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(8,6,18,0.62)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    panel(VIEW.width / 2 - 240, VIEW.height / 2 - 150, 480, 300);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.neonCyan;
    ctx.font = `bold 40px ${TITLE_FONT}`;
    ctx.fillText('PAUSED', VIEW.width / 2, VIEW.height / 2 - 84);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `20px ${FONT}`;
    const lines = ['P / Esc — resume', 'S — save game', 'R — restart story', 'M — mute / unmute'];
    lines.forEach((line, i) => ctx.fillText(line, VIEW.width / 2, VIEW.height / 2 - 22 + i * 42));
  }

  function drawFate(world) {
    const busted = world.fate === 'busted';
    ctx.fillStyle = busted ? 'rgba(20,30,90,0.45)' : 'rgba(90,10,26,0.45)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.shadowColor = busted ? '#3355ff' : PALETTE.danger;
    ctx.shadowBlur = 30;
    ctx.fillStyle = busted ? '#8fb2ff' : '#ff8fa8';
    ctx.font = `96px ${TITLE_FONT}`;
    ctx.fillText(busted ? 'BUSTED' : 'WASTED', VIEW.width / 2, VIEW.height / 2 + 10);
    ctx.restore();
    ctx.fillStyle = PALETTE.text;
    ctx.font = `20px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(busted ? 'The bay police finally got their hands on you.' : 'Clinica Vida is already on its way.', VIEW.width / 2, VIEW.height / 2 + 58);
  }

  function render(world, screen, opts = {}) {
    const cam = currentCamera(world);
    const light = lightModel(world.timeHours);
    drawWorld(world, cam, light);
    drawActors(world, cam, light);
    drawLighting(world, cam, light);
    if (screen === 'title') {
      drawTitle(world, opts);
      // The vignette still applies over the title's living backdrop.
      if (!vignette) {
        vignette = ctx.createRadialGradient(
          VIEW.width / 2, VIEW.height / 2, VIEW.height * 0.42,
          VIEW.width / 2, VIEW.height / 2, VIEW.height * 0.95,
        );
        vignette.addColorStop(0, 'rgba(5,4,14,0)');
        vignette.addColorStop(1, 'rgba(5,4,14,0.34)');
      }
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
      return;
    }
    hudCam = cam;
    drawHUD(world, opts);
    // Aim reticle.
    if (!world.player.car && opts.pointer) {
      const px = opts.pointer.x, py = opts.pointer.y;
      ctx.strokeStyle = 'rgba(245,242,234,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - 14, py); ctx.lineTo(px - 5, py);
      ctx.moveTo(px + 5, py); ctx.lineTo(px + 14, py);
      ctx.moveTo(px, py - 14); ctx.lineTo(px, py - 5);
      ctx.moveTo(px, py + 5); ctx.lineTo(px, py + 14);
      ctx.stroke();
    }
    if (world.storyDone && world.storyDoneTimer > 0) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.shadowColor = PALETTE.neonGold;
      ctx.shadowBlur = 18;
      ctx.fillStyle = PALETTE.neonGold;
      ctx.font = `44px ${TITLE_FONT}`;
      ctx.fillText('STORY COMPLETE', VIEW.width / 2, 240);
      ctx.restore();
    }
    if (world.fate) drawFate(world);
    if (screen === 'paused') drawPause();
    // A permanent soft vignette: cheap, and it makes every frame feel graded.
    if (!vignette) {
      vignette = ctx.createRadialGradient(
        VIEW.width / 2, VIEW.height / 2, VIEW.height * 0.42,
        VIEW.width / 2, VIEW.height / 2, VIEW.height * 0.95,
      );
      vignette.addColorStop(0, 'rgba(5,4,14,0)');
      vignette.addColorStop(1, 'rgba(5,4,14,0.34)');
    }
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  }

  return { render, getCamera: () => smoothCam || { x: 0, y: 0 } };
}
