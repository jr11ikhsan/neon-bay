// Drawing only: NEON BAY's world state and the current screen in, pixels out.
// Top-down canvas art, all procedural: pseudo-3D buildings with sun shadows and
// neon signs, a beach and animated water, lamp glow and headlights after dark, a
// day/dusk/night tint driven by the game clock, a full HUD and a live minimap.
import { FONT, PALETTE, ROADS, TITLE_FONT, VIEW, WORLD } from './config.js';
import { createRandom } from './random.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function createRenderer(canvas, city) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const cam = { x: 3700, y: 1560 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    view.scale = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
    view.x = (canvas.width - VIEW.width * view.scale) / 2;
    view.y = (canvas.height - VIEW.height * view.scale) / 2;
  }
  resize();
  window.addEventListener('resize', resize);

  function font(size, family = FONT, weight = '') {
    const key = `${weight}${size}${family}`;
    if (!fonts.has(key)) fonts.set(key, `${weight} ${size}px ${family}`);
    return fonts.get(key);
  }
  function text(value, x, y, size, color, align = 'left', family = FONT, weight = '') {
    ctx.font = font(size, family, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, y);
  }

  // ---- static minimap base, painted once ----
  const MM = { w: 232, h: 174 };
  const mmBase = document.createElement('canvas');
  mmBase.width = MM.w; mmBase.height = MM.h;
  {
    const m = mmBase.getContext('2d');
    const sx = MM.w / WORLD.width, sy = MM.h / WORLD.height;
    m.fillStyle = '#274d33';
    m.fillRect(0, 0, MM.w, MM.h);
    m.fillStyle = PALETTE.sand;
    m.fillRect(WORLD.beachX * sx, 0, (WORLD.waterX - WORLD.beachX) * sx, MM.h);
    m.fillStyle = PALETTE.water;
    m.fillRect(WORLD.waterX * sx, 0, MM.w - WORLD.waterX * sx, MM.h);
    m.fillStyle = '#565064';
    for (const r of city.roadsV) m.fillRect((r.x - r.w / 2) * sx, 0, r.w * sx, MM.h);
    for (const r of city.roadsH) m.fillRect(0, (r.y - r.w / 2) * sy, WORLD.beachX * sx, r.w * sy);
    m.fillStyle = 'rgba(20,16,30,0.55)';
    for (const b of city.buildings) m.fillRect(b.x * sx, b.y * sy, Math.max(1.5, b.w * sx), Math.max(1.5, b.h * sy));
  }

  // ---- light & time ----
  function lightAt(hour) {
    // sun: 0 at night, 1 at midday; dusk peaks around 18:10.
    const sun = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const dusk = Math.max(0, 1 - Math.abs(hour - 18.2) / 1.6) * (hour > 12 ? 1 : 0);
    const dawn = Math.max(0, 1 - Math.abs(hour - 6.4) / 1.4) * (hour < 12 ? 1 : 0);
    return { sun: Math.min(1, sun * 1.25), dark: Math.max(0, 0.88 - sun * 1.05), dusk: Math.max(dusk, dawn * 0.7) };
  }

  function drawGround(light, t) {
    const x0 = cam.x - VIEW.width / 2 - 60, x1 = cam.x + VIEW.width / 2 + 60;
    const y0 = cam.y - VIEW.height / 2 - 60, y1 = cam.y + VIEW.height / 2 + 60;
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // Grass mow stripes.
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    for (let gx = Math.floor(x0 / 240) * 240; gx < x1; gx += 480) ctx.fillRect(gx, y0, 240, y1 - y0);
    // Parks and plazas.
    for (const p of city.parks) {
      ctx.fillStyle = PALETTE.grassDark;
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }
    for (const p of city.plazas) {
      ctx.fillStyle = '#7a6a72';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(p.x, p.y, p.w, 3);
    }
    // Parking lots.
    for (const l of city.lots) {
      ctx.fillStyle = '#3a3547';
      ctx.fillRect(l.x, l.y, l.w, l.h);
      ctx.strokeStyle = 'rgba(230,230,240,0.5)';
      ctx.lineWidth = 2;
      for (const s of l.spots) {
        ctx.beginPath();
        ctx.moveTo(s.x - 16, s.y - 22);
        ctx.lineTo(s.x - 16, s.y + 22);
        ctx.lineTo(s.x + 16, s.y + 22);
        ctx.lineTo(s.x + 16, s.y - 22);
        ctx.stroke();
      }
    }
    // Beach, boardwalk, water.
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(WORLD.beachX, y0, WORLD.waterX - WORLD.beachX, y1 - y0);
    ctx.fillStyle = PALETTE.sandDark;
    for (let y = Math.floor(y0 / 90) * 90; y < y1; y += 90) ctx.fillRect(WORLD.beachX, y, WORLD.waterX - WORLD.beachX, 3);
    ctx.fillStyle = PALETTE.boardwalk;
    ctx.fillRect(3962, y0, 44, y1 - y0);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = Math.floor(y0 / 26) * 26; y < y1; y += 26) ctx.fillRect(3962, y, 44, 2);
    const wg = ctx.createLinearGradient(WORLD.waterX, 0, WORLD.width, 0);
    wg.addColorStop(0, PALETTE.water);
    wg.addColorStop(1, PALETTE.waterDeep);
    ctx.fillStyle = wg;
    ctx.fillRect(WORLD.waterX, y0, WORLD.width - WORLD.waterX, y1 - y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = Math.floor(y0 / 64) * 64; y < y1; y += 64) {
      for (let x = WORLD.waterX + 18; x < WORLD.width; x += 130) {
        const off = Math.sin(t * 1.3 + (x + y) * 0.02) * 7;
        ctx.moveTo(x + off, y);
        ctx.quadraticCurveTo(x + 16 + off, y - 5, x + 32 + off, y);
      }
    }
    ctx.stroke();
    // Wet-sand shine line.
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.fillRect(WORLD.waterX - 4, y0, 5, y1 - y0);

    // Roads: sidewalk slab first, asphalt on top.
    ctx.fillStyle = PALETTE.sidewalk;
    for (const r of city.roadsV) ctx.fillRect(r.x - r.w / 2 - 17, y0, r.w + 34, y1 - y0);
    for (const r of city.roadsH) ctx.fillRect(x0, r.y - r.w / 2 - 17, WORLD.beachX - x0, r.w + 34);
    ctx.fillStyle = PALETTE.asphalt;
    for (const r of city.roadsV) ctx.fillRect(r.x - r.w / 2, y0, r.w, y1 - y0);
    for (const r of city.roadsH) ctx.fillRect(x0, r.y - r.w / 2, WORLD.beachX - x0, r.w);
    // Lane dashes.
    ctx.fillStyle = PALETTE.laneMark;
    for (const r of city.roadsV) {
      for (let y = Math.floor(y0 / 72) * 72; y < y1; y += 72) {
        if (city.intersections.some((i) => i.x === r.x && Math.abs(i.y - (y + 18)) < 90)) continue;
        ctx.fillRect(r.x - 2.5, y, 5, 36);
      }
    }
    for (const r of city.roadsH) {
      for (let x = Math.floor(x0 / 72) * 72; x < Math.min(x1, WORLD.beachX); x += 72) {
        if (city.intersections.some((i) => i.y === r.y && Math.abs(i.x - (x + 18)) < 90)) continue;
        ctx.fillRect(x, r.y - 2.5, 36, 5);
      }
    }
    // Crosswalks at intersections.
    ctx.fillStyle = 'rgba(207,212,220,0.5)';
    for (const i of city.intersections) {
      if (i.x < x0 - 90 || i.x > x1 + 90 || i.y < y0 - 90 || i.y > y1 + 90) continue;
      for (let s = -2; s <= 2; s += 1) {
        ctx.fillRect(i.x - 52, i.y + s * 22 - 5, 16, 10);
        ctx.fillRect(i.x + 36, i.y + s * 22 - 5, 16, 10);
        ctx.fillRect(i.x + s * 22 - 5, i.y - 52, 10, 16);
        ctx.fillRect(i.x + s * 22 - 5, i.y + 36, 10, 16);
      }
    }
    void light;
  }

  function drawBuilding(b, light, t) {
    const sh = b.floors * 2.6;
    ctx.fillStyle = 'rgba(10,8,20,0.35)';
    ctx.fillRect(b.x + sh, b.y + sh, b.w, b.h);
    ctx.fillStyle = b.wall;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof;
    const inset = Math.min(12, b.w * 0.12, b.h * 0.12);
    ctx.fillRect(b.x + inset, b.y + inset, b.w - inset * 2, b.h - inset * 2);
    // Windows: deterministic from the building's seed; more lit as it gets dark.
    const rnd = createRandom(Math.floor(b.seed * 1e9) + 7);
    const cols = Math.max(1, Math.floor(b.w / 30));
    const rows = Math.max(1, Math.floor(b.h / 30));
    const litRatio = 0.16 + light.dark * 0.5;
    for (let cx = 0; cx < cols; cx += 1) {
      for (let cy = 0; cy < rows; cy += 1) {
        const lit = rnd() < litRatio;
        ctx.fillStyle = lit ? 'rgba(255,214,120,0.9)' : 'rgba(160,170,200,0.28)';
        ctx.fillRect(b.x + 8 + cx * 30, b.y + 8 + cy * 30, 13, 9);
      }
    }
    // Neon sign on the street face.
    if (b.sign) {
      const sx = b.x + b.w / 2;
      const sy = b.y + b.h + 15;
      ctx.save();
      if (light.dark > 0.15) {
        ctx.shadowColor = b.sign.color;
        ctx.shadowBlur = 16 * light.dark;
      }
      ctx.font = font(15, FONT, 'bold');
      ctx.fillStyle = b.sign.color;
      ctx.textAlign = 'center';
      ctx.fillText(b.sign.text, sx, sy);
      ctx.restore();
    }
    void t;
  }

  function drawPalm(p) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(p.x + 7, p.y + 9, 15 * p.s, 6 * p.s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2e7d46';
    ctx.lineWidth = 3.4 * p.s;
    ctx.beginPath();
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2 + p.x * 0.01;
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(
        p.x + Math.cos(a) * 13 * p.s, p.y + Math.sin(a) * 13 * p.s - 4,
        p.x + Math.cos(a) * 21 * p.s, p.y + Math.sin(a) * 21 * p.s + 3,
      );
    }
    ctx.stroke();
    ctx.fillStyle = '#6d4c2f';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.6 * p.s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawProp(p) {
    if (p.kind === 'fountain') {
      ctx.fillStyle = '#5b7a8c';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f8fbf';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'dumpster') {
      ctx.fillStyle = '#2f6e4f';
      ctx.fillRect(p.x - p.r, p.y - p.r * 0.7, p.r * 2, p.r * 1.4);
      ctx.fillStyle = '#265c41';
      ctx.fillRect(p.x - p.r, p.y - p.r * 0.7, p.r * 2, 4);
    } else {
      ctx.fillStyle = '#9a6a3f';
      ctx.fillRect(p.x - p.r * 0.8, p.y - p.r * 0.8, p.r * 1.6, p.r * 1.6);
      ctx.strokeStyle = '#77512c';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - p.r * 0.8, p.y - p.r * 0.8, p.r * 1.6, p.r * 1.6);
    }
  }

  function drawCar(car, light, t) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    // Shadow.
    ctx.fillStyle = 'rgba(8,6,16,0.35)';
    roundRect(ctx, -44, -19, 92, 46, 10);
    ctx.fill();
    // Headlight cones after dark.
    if (light.dark > 0.12 && car.health > 0) {
      const grad = ctx.createLinearGradient(46, 0, 190, 0);
      grad.addColorStop(0, `rgba(255,240,180,${0.30 * light.dark})`);
      grad.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(44, -14);
      ctx.lineTo(190, -34);
      ctx.lineTo(190, 34);
      ctx.lineTo(44, 14);
      ctx.closePath();
      ctx.fill();
    }
    const wrecked = car.health <= 0;
    ctx.fillStyle = wrecked ? '#2c2c33' : car.color;
    roundRect(ctx, -46, -23, 92, 46, 11);
    ctx.fill();
    if (car.kind === 'police') {
      ctx.fillStyle = '#22242e';
      roundRect(ctx, -46, -23, 30, 46, 10); ctx.fill();
      roundRect(ctx, 18, -23, 28, 46, 10); ctx.fill();
      // Light bar: red/blue strobing.
      const phase = Math.floor(t * 6) % 2 === 0;
      ctx.fillStyle = phase ? '#ff3355' : '#3355ff';
      roundRect(ctx, -8, -15, 15, 30, 4); ctx.fill();
      if (light.dark > 0.1) {
        ctx.save();
        ctx.shadowColor = phase ? '#ff3355' : '#3355ff';
        ctx.shadowBlur = 22;
        ctx.fillRect(-8, -15, 15, 30);
        ctx.restore();
      }
    }
    // Cabin and glass.
    ctx.fillStyle = 'rgba(16,20,30,0.85)';
    roundRect(ctx, -12, -18, 34, 36, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(140,190,230,0.55)';
    roundRect(ctx, 14, -16, 8, 32, 3);
    ctx.fill();
    roundRect(ctx, -20, -16, 7, 32, 3);
    ctx.fill();
    // Wheels.
    ctx.fillStyle = '#101014';
    for (const [wx, wy] of [[-30, -24], [30, -24], [-30, 19], [30, 19]]) ctx.fillRect(wx - 7, wy, 15, 6);
    // Headlights / taillights.
    ctx.fillStyle = '#fff3b0';
    ctx.fillRect(43, -17, 4, 9);
    ctx.fillRect(43, 8, 4, 9);
    ctx.fillStyle = '#ff4455';
    ctx.fillRect(-47, -17, 4, 9);
    ctx.fillRect(-47, 8, 4, 9);
    ctx.restore();
    // Mission target ring.
    if (car.missionTarget) {
      const bob = Math.sin(t * 4) * 5;
      ctx.fillStyle = PALETTE.neonGold;
      ctx.save();
      ctx.translate(car.x, car.y - 58 + bob);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-9, -9, 18, 18);
      ctx.restore();
    }
    // Damage smoke is emitted as particles by the world; a health tick for hurt cars:
    if (car.health < 100 && car.health > 0 && car.driver === 'player') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(car.x - 26, car.y - 44, 52, 6);
      ctx.fillStyle = car.health > 40 ? PALETTE.good : PALETTE.danger;
      ctx.fillRect(car.x - 25, car.y - 43, 50 * (car.health / 100), 4);
    }
  }

  function drawWalker(w, t, isPlayer) {
    const bob = Math.sin(w.phase * 6) * 2.2;
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.fillStyle = 'rgba(8,6,16,0.3)';
    ctx.beginPath();
    ctx.ellipse(2, 4, 13, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(w.angle);
    if (w.dead) {
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#55505e';
      ctx.beginPath(); ctx.ellipse(0, 0, 16, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = w.skin;
      ctx.beginPath(); ctx.arc(15, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    // Legs.
    ctx.fillStyle = '#2c2c38';
    ctx.fillRect(-4, -8 + bob * 0.4, 10, 5);
    ctx.fillRect(-4, 3 - bob * 0.4, 10, 5);
    // Body.
    ctx.fillStyle = w.color;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    if (w.isCop) {
      ctx.fillStyle = '#16295e';
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(2, -2, 6, 4);
    }
    // Head.
    ctx.fillStyle = w.skin;
    ctx.beginPath();
    ctx.arc(2, 0, 6.4, 0, Math.PI * 2);
    ctx.fill();
    if (isPlayer) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 15.5, 0, Math.PI * 2);
      ctx.stroke();
      // Aim tick.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(12, -1.5, 9, 3);
    }
    ctx.restore();
    if (w.hurtT > 0) {
      ctx.fillStyle = `rgba(239,71,111,${w.hurtT * 1.6})`;
      ctx.beginPath();
      ctx.arc(w.x, w.y, 17, 0, Math.PI * 2);
      ctx.fill();
    }
    void t;
  }

  function drawWorld(state, light) {
    const t = state.time;
    drawGround(light, t);
    const x0 = cam.x - VIEW.width / 2 - 80, x1 = cam.x + VIEW.width / 2 + 80;
    const y0 = cam.y - VIEW.height / 2 - 80, y1 = cam.y + VIEW.height / 2 + 80;
    const inView = (x, y, m = 0) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m;
    for (const p of city.props) if (inView(p.x, p.y, 30)) drawProp(p);
    for (const b of city.buildings) {
      if (b.x + b.w < x0 || b.x > x1 || b.y + b.h < y0 || b.y > y1) continue;
      drawBuilding(b, light, t);
    }
    for (const p of city.palms) if (inView(p.x, p.y, 30)) drawPalm(p);
    // Lamp glow pools after dark.
    if (light.dark > 0.1) {
      for (const l of city.lamps) {
        if (!inView(l.x, l.y, 60)) continue;
        const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, 52);
        g.addColorStop(0, `rgba(255,205,110,${0.34 * light.dark})`);
        g.addColorStop(1, 'rgba(255,205,110,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(l.x, l.y, 52, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const l of city.lamps) {
      if (!inView(l.x, l.y)) continue;
      ctx.fillStyle = '#3c3a44';
      ctx.beginPath(); ctx.arc(l.x, l.y, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd9a0';
      ctx.beginPath(); ctx.arc(l.x, l.y, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    // Pickups.
    for (const pk of state.pickups) {
      const bobY = Math.sin(t * 5 + pk.x) * 3;
      if (pk.kind === 'money') {
        ctx.fillStyle = '#2fae5f';
        roundRect(ctx, pk.x - 9, pk.y - 6 + bobY, 18, 12, 2);
        ctx.fill();
        ctx.fillStyle = '#d9f7e3';
        text('$', pk.x, pk.y + 4 + bobY, 11, '#d9f7e3', 'center', FONT, 'bold');
      } else {
        ctx.fillStyle = '#ff5d8f';
        ctx.beginPath(); ctx.arc(pk.x, pk.y + bobY, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        text('+', pk.x, pk.y + 4 + bobY, 12, '#ffffff', 'center', FONT, 'bold');
      }
    }
    for (const car of state.cars) if (inView(car.x, car.y, 120)) drawCar(car, light, t);
    for (const ped of state.peds) if (inView(ped.x, ped.y, 30)) drawWalker(ped, t, false);
    for (const cop of state.cops) if (inView(cop.x, cop.y, 30)) drawWalker({ ...cop, isCop: true }, t, false);
    if (!state.player.inCar) drawWalker({ ...state.player, color: PALETTE.player }, t, true);
    // Tracers.
    for (const b of state.bullets) {
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = Math.max(0, b.life / 0.09);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(b.x0, b.y0);
      ctx.lineTo(b.x1, b.y1);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Particles.
    for (const pt of state.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.life * 2));
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Objective pillar + marker.
    if (state.objective) {
      const o = state.objective;
      if (inView(o.x, o.y, 200)) {
        const grad = ctx.createLinearGradient(0, o.y - 330, 0, o.y);
        grad.addColorStop(0, 'rgba(255,183,3,0)');
        grad.addColorStop(1, 'rgba(255,183,3,0.4)');
        ctx.fillStyle = grad;
        ctx.fillRect(o.x - 13, o.y - 330, 26, 330);
        ctx.strokeStyle = PALETTE.neonGold;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(o.x, o.y, 30 + Math.sin(t * 4) * 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function applyLight(light) {
    if (light.dusk > 0.03) {
      ctx.fillStyle = `rgba(255,106,52,${0.13 * light.dusk})`;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
    if (light.dark > 0.03) {
      ctx.fillStyle = `rgba(10,12,44,${0.40 * light.dark})`;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
  }

  // ---- HUD ----
  function drawMinimap(state) {
    const x = 18, y = VIEW.height - MM.h - 18;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.drawImage(mmBase, x, y);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, MM.w, MM.h);
    const sx = MM.w / WORLD.width, sy = MM.h / WORLD.height;
    for (const car of state.cars) {
      if (car.kind !== 'police') continue;
      ctx.fillStyle = '#4d7cff';
      ctx.fillRect(x + car.x * sx - 2, y + car.y * sy - 2, 4, 4);
    }
    for (const cop of state.cops) {
      ctx.fillStyle = '#4d7cff';
      ctx.fillRect(x + cop.x * sx - 2, y + cop.y * sy - 2, 4, 4);
    }
    if (state.objective) {
      ctx.fillStyle = PALETTE.neonGold;
      ctx.save();
      ctx.translate(x + state.objective.x * sx, y + state.objective.y * sy);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }
    const p = state.player;
    ctx.save();
    ctx.translate(x + p.x * sx, y + p.y * sy);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -4.5);
    ctx.lineTo(-5, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function drawHud(state, ui) {
    const p = state.player;
    // Money + health, top-left.
    text(`$${state.money.toLocaleString('en-US')}`, 22, 40, 30, '#7be495', 'left', FONT, 'bold');
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, 22, 52, 190, 15, 4); ctx.fill();
    ctx.fillStyle = p.health > 30 ? PALETTE.good : PALETTE.danger;
    roundRect(ctx, 24, 54, 186 * Math.max(0, p.health) / 100, 11, 3); ctx.fill();
    text('HEALTH', 22, 84, 11, PALETTE.muted, 'left', FONT, 'bold');
    if (state.bust > 0.02) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, 22, 92, 190, 13, 4); ctx.fill();
      ctx.fillStyle = PALETTE.danger;
      roundRect(ctx, 24, 94, 186 * state.bust, 9, 3); ctx.fill();
      text('BUSTED?', 22, 118, 11, PALETTE.danger, 'left', FONT, 'bold');
    }
    // Clock + weapon, under the money block.
    const hh = Math.floor(state.hour);
    const mm = Math.floor((state.hour - hh) * 60);
    text(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, 22, 140, 17, PALETTE.text, 'left', FONT, 'bold');
    text(p.inCar ? `${Math.abs(Math.round(p.inCar.speed * 0.19))} km/h` : (p.hasGun ? 'PISTOL' : 'FISTS'), 76, 140, 15, PALETTE.muted, 'left', FONT, 'bold');
    // Wanted stars, top-right.
    for (let i = 0; i < 5; i += 1) {
      const sx = VIEW.width - 34 - i * 34;
      const active = i < state.stars;
      const flash = state.seenTimer < 1.2 && active && Math.floor(state.time * 3) % 2 === 0;
      text('★', sx, 42, 30, active ? (flash ? '#ffffff' : PALETTE.neonGold) : 'rgba(255,255,255,0.22)', 'center');
    }
    if (state.stars > 0 && state.seenTimer > 2) {
      text(state.seenTimer > 6 ? 'LOSING THEM…' : 'HIDING…', VIEW.width - 22, 66, 13, PALETTE.muted, 'right', FONT, 'bold');
    }
    // Objective banner, top-center.
    if (state.objectiveText) {
      ctx.fillStyle = PALETTE.panel;
      const w = Math.max(340, ctx.measureText(state.objectiveText).width + 190);
      roundRect(ctx, VIEW.width / 2 - w / 2, 14, w, 52, 9);
      ctx.fill();
      text('OBJECTIVE', VIEW.width / 2 - w / 2 + 16, 36, 11, PALETTE.neonGold, 'left', FONT, 'bold');
      text(state.objectiveText + (state.objectiveSub ? `   ${state.objectiveSub}` : ''), VIEW.width / 2 - w / 2 + 16, 58, 17, PALETTE.text, 'left', FONT, 'bold');
      // Direction arrow toward the objective when it is off-screen.
      if (state.objective) {
        const dx = state.objective.x - p.x, dy = state.objective.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > 420) {
          const a = Math.atan2(dy, dx);
          const ax = VIEW.width / 2 + Math.cos(a) * 120;
          const ay = 118 + Math.sin(a) * 26;
          ctx.save();
          ctx.translate(ax, ay);
          ctx.rotate(a);
          ctx.fillStyle = PALETTE.neonGold;
          ctx.beginPath();
          ctx.moveTo(13, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8); ctx.closePath();
          ctx.fill();
          ctx.restore();
          text(`${Math.round(d / 10)}m`, ax, ay + 24, 12, PALETTE.neonGold, 'center', FONT, 'bold');
        }
      }
    }
    // Toasts under the banner.
    let ty = 96;
    for (const toast of state.toasts) {
      ctx.globalAlpha = Math.min(1, toast.t * 1.4);
      text(toast.text, VIEW.width / 2, ty, 21, '#ffffff', 'center', FONT, 'bold');
      if (toast.sub) text(toast.sub, VIEW.width / 2, ty + 22, 14, PALETTE.muted, 'center');
      ctx.globalAlpha = 1;
      ty += toast.sub ? 52 : 30;
    }
    // Interact prompt.
    if (ui.nearCar && !p.inCar) text('E — get in car', VIEW.width / 2, VIEW.height - 30, 17, '#ffffff', 'center', FONT, 'bold');
    if (p.inCar) text('E — get out · SPACE — handbrake feel: release W to coast', VIEW.width / 2, VIEW.height - 12, 12, 'rgba(255,255,255,0.5)', 'center');
    drawMinimap(state);
  }

  function drawPanel(lines, title, titleColor) {
    ctx.fillStyle = 'rgba(8,6,18,0.62)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    const titleH = title ? 96 : 18;
    const w = 700, h = titleH + lines.length * 30 + 44;
    const x = (VIEW.width - w) / 2, y = (VIEW.height - h) / 2;
    ctx.fillStyle = PALETTE.panel;
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = titleColor;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 14);
    ctx.stroke();
    if (title) text(title, VIEW.width / 2, y + 78, 44, titleColor, 'center', TITLE_FONT, 'bold');
    lines.forEach((line, i) => {
      text(line, VIEW.width / 2, y + titleH + 26 + i * 30, 17, i === lines.length - 1 ? PALETTE.neonGold : PALETTE.text, 'center', FONT, i === lines.length - 1 ? 'bold' : '');
    });
  }

  function drawTitle(state, ui) {
    // Logo over the live city.
    const cx = VIEW.width / 2;
    ctx.save();
    ctx.shadowColor = PALETTE.neonPink;
    ctx.shadowBlur = 34;
    text('NEON', cx - 8, 168, 92, '#ffffff', 'right', TITLE_FONT, 'bold');
    ctx.shadowColor = PALETTE.neonCyan;
    text('BAY', cx + 8, 168, 92, PALETTE.neonCyan, 'left', TITLE_FONT, 'bold');
    ctx.restore();
    text('A tiny open-world crime story on a neon beach', cx, 208, 19, '#ffe9f4', 'center', FONT, 'bold');
    const lines = [
      ui.hasSave ? 'ENTER — New game        C — Continue' : 'ENTER — Start the story',
      'WASD move · MOUSE aim · CLICK punch / shoot · SHIFT run',
      'E get in / out of cars — yes, you can steal them',
      'Do the missions, dodge the law, watch the stars',
      ui.muted ? 'M — sound on' : 'M — mute',
    ];
    if (ui.storyDone) lines.splice(1, 0, '★ Story complete — free roam awaits ★');
    drawPanel(lines, '', PALETTE.neonPink);
    // Hide the panel's empty title row by painting over it: drawPanel put a big gap;
    // instead overlay the logo block position is above the panel — acceptable layout.
    text('an original make.fun entry — all art & sound procedural', cx, VIEW.height - 24, 13, 'rgba(255,255,255,0.65)', 'center');
  }

  function draw(state, screen, ui = {}) {
    const focus = state.player.inCar ?? state.player;
    cam.x = Math.min(WORLD.width - VIEW.width / 2, Math.max(VIEW.width / 2, focus.x));
    cam.y = Math.min(WORLD.height - VIEW.height / 2, Math.max(VIEW.height / 2, focus.y));
    const light = lightAt(state.hour);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0916';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    ctx.save();
    ctx.translate(VIEW.width / 2 - cam.x, VIEW.height / 2 - cam.y);
    drawWorld(state, light);
    ctx.restore();
    applyLight(light);
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSED) drawHud(state, ui);
    if (screen === SCREEN_TITLE) drawTitle(state, ui);
    else if (screen === SCREEN_PAUSED) {
      drawPanel(['Take a breath. The bay waits.', 'ENTER / P — resume', 'S — save game', 'R — restart story', ui.muted ? 'M — sound on' : 'M — mute'], 'PAUSED', PALETTE.neonCyan);
    } else if (screen === SCREEN_OVER) {
      const busted = state.over === 'busted';
      drawPanel([
        busted ? 'The law got its hands on you.' : 'You woke up at Clinica Vida.',
        'Your current mission restarts.',
        'ENTER — back on the street',
      ], busted ? 'BUSTED' : 'WASTED', busted ? '#4d7cff' : PALETTE.danger);
    }
  }

  function screenToWorld(px, py) {
    const lx = (px - view.x) / view.scale;
    const ly = (py - view.y) / view.scale;
    return { x: lx + cam.x - VIEW.width / 2, y: ly + cam.y - VIEW.height / 2 };
  }

  return { draw, screenToWorld };
}
