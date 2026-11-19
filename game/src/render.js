// NEON BAY v5 — the renderer: a Three.js diorama of the sim's flat world.
// Sim (x, y) maps to ground-plane (x, z); height is up. A second, plain 2D
// canvas floats above the WebGL one and carries the HUD, the minimap and
// every full-screen card, so the 3D scene stays a pure view of the world.
//
// The night is deliberately bright: hemisphere + ambient + moonlight keep
// the streets readable while lamps, windows and signs do the glowing.
// On software renderers (SwiftShader and friends) an adaptive tier drops
// pixel ratio and shadows so weak machines still play; screenshot staging
// forces the full tier back on.

import * as THREE from '../vendor/three.module.min.js';
import { ROADS, WORLD, VIEW, PALETTE } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'pause';

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A building facade: dark body, a grid of windows, some lit. Seeded. */
function facadeTexture(seed, base) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return canvasTexture(128, 256, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 256);
    for (let row = 0; row < 12; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const lit = rnd() < 0.42;
        g.fillStyle = lit ? (rnd() < 0.5 ? '#ffd98a' : '#9fe8ff') : '#141824';
        g.fillRect(10 + col * 23, 12 + row * 20, 14, 11);
      }
    }
  });
}

function signTexture(text, color) {
  return canvasTexture(512, 96, (g) => {
    g.clearRect(0, 0, 512, 96);
    g.font = 'bold 54px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 26;
    g.fillStyle = color;
    g.fillText(text, 256, 50);
    g.shadowBlur = 8;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.85;
    g.fillText(text, 256, 50);
  });
}

function glowTexture(inner = 'rgba(255,255,255,1)') {
  return canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.35, 'rgba(255,255,255,0.32)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
}

/** The ground: one big painted map of roads, kerbs, sand and the lot. */
function groundTexture(city) {
  const SX = 2048 / WORLD.width;
  const SY = 1536 / WORLD.height;
  return canvasTexture(2048, 1536, (g) => {
    g.fillStyle = '#5d5790'; // block ground: violet concrete
    g.fillRect(0, 0, 2048, 1536);
    // park band south
    g.fillStyle = '#40704c';
    g.fillRect(0, 2890 * SY, 4180 * SX, (3600 - 2890) * SY);
    // sand + boardwalk
    g.fillStyle = PALETTE.sand;
    g.fillRect(ROADS.sandFrom * SX, 0, (WORLD.width - ROADS.sandFrom) * SX, 1536);
    g.fillStyle = '#9a6b45';
    g.fillRect((ROADS.boardwalkX - 46) * SX, 0, 92 * SX, 1536);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    for (let y = 0; y < 1536; y += 18) g.fillRect((ROADS.boardwalkX - 46) * SX, y, 92 * SX, 3);
    // car lot asphalt
    g.fillStyle = PALETTE.asphalt;
    g.fillRect(3230 * SX, 490 * SY, 560 * SX, 460 * SY);
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 2;
    for (const spot of city.lotSpots) {
      g.strokeRect((spot.x - 34) * SX, (spot.y - 52) * SY, 68 * SX, 104 * SY);
    }
    // roads
    g.fillStyle = PALETTE.asphalt;
    for (const ax of ROADS.avenues) g.fillRect((ax - 70) * SX, 0, 140 * SX, 1536);
    for (const sy of ROADS.streets) g.fillRect(0, (sy - 70) * SY, ROADS.sandFrom * SX, 140 * SY);
    // kerbs
    g.fillStyle = '#565064';
    for (const ax of ROADS.avenues) { g.fillRect((ax - 76) * SX, 0, 6 * SX, 1536); g.fillRect((ax + 70) * SX, 0, 6 * SX, 1536); }
    for (const sy of ROADS.streets) { g.fillRect(0, (sy - 76) * SY, ROADS.sandFrom * SX, 6 * SY); g.fillRect(0, (sy + 70) * SY, ROADS.sandFrom * SX, 6 * SY); }
    // lane dashes
    g.fillStyle = 'rgba(255,220,120,0.75)';
    for (const ax of ROADS.avenues) for (let y = 10; y < WORLD.height; y += 90) g.fillRect((ax - 3) * SX, y * SY, 6 * SX, 44 * SY);
    for (const sy of ROADS.streets) for (let x = 10; x < ROADS.sandFrom; x += 90) g.fillRect(x * SX, (sy - 3) * SY, 44 * SX, 6 * SY);
    // crosswalks at intersections
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (const ax of ROADS.avenues) for (const sy of ROADS.streets) {
      for (let i = -2; i <= 2; i += 1) {
        g.fillRect((ax + i * 26 - 8) * SX, (sy - 66) * SY, 16 * SX, 10 * SY);
        g.fillRect((ax + i * 26 - 8) * SX, (sy + 56) * SY, 16 * SX, 10 * SY);
      }
    }
  });
}

const CAR_PAINT = {
  sport: { bodyH: 15, cabinH: 11, len: 52, wid: 27 },
  sedan: { bodyH: 17, cabinH: 13, len: 50, wid: 27 },
  taxi: { bodyH: 17, cabinH: 13, len: 50, wid: 27 },
  van: { bodyH: 30, cabinH: 6, len: 54, wid: 29 },
  pickup: { bodyH: 18, cabinH: 12, len: 54, wid: 29 },
  police: { bodyH: 17, cabinH: 13, len: 51, wid: 28 },
  owned: { bodyH: 17, cabinH: 13, len: 50, wid: 27 },
};

export function createRenderer(glCanvas, hudCanvas) {
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, VIEW.width / VIEW.height, 0.5, 5200);
  camera.position.set(0, 300, 600);

  const hemi = new THREE.HemisphereLight(0x8fb8ff, 0x33284d, 0.9);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xbfd0ff, 0.4);
  scene.add(amb);
  const sun = new THREE.DirectionalLight(0xffa050, 1.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -620; sun.shadow.camera.right = 620;
  sun.shadow.camera.top = 620; sun.shadow.camera.bottom = -620;
  sun.shadow.camera.far = 2600;
  scene.add(sun);
  scene.add(sun.target);

  const glowTex = glowTexture();
  let cityGroup = null;
  let built = false;
  const carGroups = new Map();
  const pedGroups = new Map();
  const copGroups = new Map();
  let pillar = null;
  let pickupGroup = null;
  let tracerLines = [];
  let stars = null; let sunSprite = null; let moonSprite = null;
  const lampGlows = [];
  const lightbars = [];
  const trafficDots = [];
  let qualityFull = true;
  let darknessNow = 0;

  function buildCity(city) {
    cityGroup = new THREE.Group();
    scene.add(cityGroup);
    // ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.width, WORLD.height),
      new THREE.MeshPhongMaterial({ map: groundTexture(city), shininess: 18 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(WORLD.width / 2, 0, WORLD.height / 2);
    ground.receiveShadow = true;
    cityGroup.add(ground);
    // the bay: animated-ish water plane + foam strips
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.width - ROADS.waterFrom, WORLD.height),
      new THREE.MeshPhongMaterial({ color: 0x14586e, shininess: 90, specular: 0x99ddff }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set((WORLD.width + ROADS.waterFrom) / 2, 1.5, WORLD.height / 2);
    sea.name = 'sea';
    cityGroup.add(sea);
    for (let i = 0; i < 3; i += 1) {
      const foam = new THREE.Mesh(
        new THREE.PlaneGeometry(10, WORLD.height),
        new THREE.MeshBasicMaterial({ color: 0xeafcff, transparent: true, opacity: 0.35 }),
      );
      foam.rotation.x = -Math.PI / 2;
      foam.position.set(ROADS.waterFrom + 8 + i * 26, 2 + i * 0.4, WORLD.height / 2);
      foam.name = 'foam' + i;
      cityGroup.add(foam);
    }
    // buildings
    const facadeCache = new Map();
    for (const b of city.buildings) {
      const key = b.seed % 6;
      if (!facadeCache.has(key)) facadeCache.set(key, facadeTexture(b.seed, ['#3b2d5c', '#2d3a5c', '#4a2d4f', '#2d4a52', '#54426a', '#37415e'][key]));
      const tex = b.place ? facadeTexture(b.seed, '#4a4038') : facadeCache.get(key);
      const mat = new THREE.MeshPhongMaterial({ map: tex, emissive: 0xffbe78, emissiveMap: tex, emissiveIntensity: 0 });
      mat.name = 'facade';
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.height, b.h), mat);
      mesh.position.set(b.x + b.w / 2, b.height / 2, b.y + b.h / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      cityGroup.add(mesh);
      // rooftop clutter on the tall ones
      if (b.height > 120) {
        const ac = new THREE.Mesh(new THREE.BoxGeometry(26, 12, 26), new THREE.MeshLambertMaterial({ color: 0x8a8f9a }));
        ac.position.set(b.x + b.w * 0.3, b.height + 6, b.y + b.h * 0.3);
        cityGroup.add(ac);
      }
      if (b.sign) {
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(Math.min(b.w * 0.94, 300), 52),
          new THREE.MeshBasicMaterial({ map: signTexture(b.sign, b.place ? b.color : '#ff3d8a'), transparent: true, side: THREE.DoubleSide }),
        );
        sign.position.set(b.x + b.w / 2, b.height + 30, b.y + b.h / 2);
        sign.name = 'sign';
        cityGroup.add(sign);
      }
    }
    // palms: trunk + three crossed frond planes
    const trunkGeo = new THREE.CylinderGeometry(2.2, 3.4, 34, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
    const frondTex = canvasTexture(128, 128, (g) => {
      g.clearRect(0, 0, 128, 128);
      g.strokeStyle = '#2e8b57';
      g.lineWidth = 7;
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2;
        g.beginPath();
        g.moveTo(64, 64);
        g.quadraticCurveTo(64 + Math.cos(a) * 34, 64 + Math.sin(a) * 30 - 12, 64 + Math.cos(a) * 58, 64 + Math.sin(a) * 52 + 14);
        g.stroke();
      }
    });
    const frondMat = new THREE.MeshLambertMaterial({ map: frondTex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.3 });
    const frondGeo = new THREE.PlaneGeometry(64, 64);
    for (const palm of city.palms) {
      const grp = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 17;
      trunk.rotation.z = 0.07;
      grp.add(trunk);
      for (let i = 0; i < 3; i += 1) {
        const frond = new THREE.Mesh(frondGeo, frondMat);
        frond.position.y = 35;
        frond.rotation.y = (i / 3) * Math.PI;
        frond.rotation.x = -0.5;
        grp.add(frond);
      }
      grp.position.set(palm.x, 0, palm.y);
      grp.scale.setScalar(palm.s);
      grp.name = 'palm';
      cityGroup.add(grp);
    }
    // lamps: pole + head; the glow sprite joins at night
    const poleGeo = new THREE.CylinderGeometry(1.1, 1.4, 30, 5);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4a });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
    for (const lamp of city.lamps) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(lamp.x, 15, lamp.y);
      cityGroup.add(pole);
      const head = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 6), headMat);
      head.position.set(lamp.x, 30, lamp.y);
      cityGroup.add(head);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffca7a, transparent: true, opacity: 0, depthWrite: false }));
      glow.scale.setScalar(92);
      glow.position.set(lamp.x, 30, lamp.y);
      cityGroup.add(glow);
      lampGlows.push(glow);
    }
    // traffic lights at intersections
    const dotMats = {
      green: new THREE.MeshBasicMaterial({ color: 0x2eff7a }),
      amber: new THREE.MeshBasicMaterial({ color: 0xffb02e }),
      red: new THREE.MeshBasicMaterial({ color: 0xff3b30 }),
      off: new THREE.MeshLambertMaterial({ color: 0x22242c }),
    };
    for (const ax of ROADS.avenues) {
      for (const sy of ROADS.streets) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 26, 5), poleMat);
        pole.position.set(ax + 78, 13, sy + 78);
        cityGroup.add(pole);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), dotMats.green);
        dot.position.set(ax + 78, 27, sy + 78);
        dot.name = 'tdot';
        cityGroup.add(dot);
        trafficDots.push({ mesh: dot, mats: dotMats, phase: (ax + sy) % 2 });
      }
    }
    // sky dressing: stars, sun disc, moon
    const starGeo = new THREE.BufferGeometry();
    const starPos = [];
    let ss = 1234567;
    const srnd = () => { ss = (ss * 1664525 + 1013904223) >>> 0; return ss / 4294967296; };
    for (let i = 0; i < 420; i += 1) {
      const a = srnd() * Math.PI * 2; const e = srnd() * 0.9 + 0.12; const r = 4200;
      starPos.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe4ff, size: 5, sizeAttenuation: false, transparent: true, opacity: 0 }));
    stars.name = 'stars';
    scene.add(stars);
    sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff9a3c, transparent: true, depthWrite: false }));
    sunSprite.scale.setScalar(900);
    scene.add(sunSprite);
    moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xdfe9ff, transparent: true, depthWrite: false }));
    moonSprite.scale.setScalar(340);
    scene.add(moonSprite);
    // mission pillar
    pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(15, 15, 320, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc44d, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    scene.add(pillar);
    pickupGroup = new THREE.Group();
    scene.add(pickupGroup);
    built = true;
  }

  // --- dynamic object factories ------------------------------------------
  const wheelGeo = new THREE.CylinderGeometry(6.5, 6.5, 4.5, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14151a });
  function makeCarGroup(car) {
    const spec = CAR_PAINT[car.variant] || CAR_PAINT.sedan;
    const grp = new THREE.Group();
    const paint = new THREE.MeshPhongMaterial({ color: new THREE.Color(car.kind === 'police' ? '#e8e4da' : car.color), shininess: 60 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(spec.len, spec.bodyH, spec.wid), paint);
    body.position.y = 10 + spec.bodyH / 2;
    body.castShadow = true;
    grp.add(body);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(spec.len * 0.5, spec.cabinH, spec.wid * 0.86),
      new THREE.MeshPhongMaterial({ color: 0x1a2436, shininess: 90 }),
    );
    cabin.position.set(-2, 10 + spec.bodyH + spec.cabinH / 2, 0);
    cabin.castShadow = true;
    grp.add(cabin);
    if (car.variant === 'sport') {
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(8, 3, spec.wid * 0.9), paint);
      spoiler.position.set(-spec.len * 0.44, 10 + spec.bodyH + 8, 0);
      grp.add(spoiler);
    }
    if (car.variant === 'taxi') {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 8), new THREE.MeshBasicMaterial({ color: 0xffd23c }));
      sign.position.set(-2, 10 + spec.bodyH + spec.cabinH + 3, 0);
      grp.add(sign);
    }
    if (car.kind === 'police') {
      const bar = new THREE.Group();
      const red = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 12), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
      red.position.z = -6;
      const blue = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 12), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
      blue.position.z = 6;
      bar.add(red); bar.add(blue);
      bar.position.set(-2, 10 + spec.bodyH + spec.cabinH + 2, 0);
      grp.add(bar);
      lightbars.push({ red, blue });
    }
    const wheelPos = [[spec.len * 0.32, spec.wid / 2], [spec.len * 0.32, -spec.wid / 2], [-spec.len * 0.32, spec.wid / 2], [-spec.len * 0.32, -spec.wid / 2]];
    grp.userData.wheels = [];
    for (const [wx, wz] of wheelPos) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 6.5, wz);
      grp.add(wheel);
      grp.userData.wheels.push(wheel);
    }
    // headlight glows
    grp.userData.lights = [];
    for (const side of [-1, 1]) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2c0, transparent: true, opacity: 0, depthWrite: false }));
      glow.scale.setScalar(30);
      glow.position.set(spec.len / 2 + 4, 12, side * spec.wid * 0.32);
      grp.add(glow);
      grp.userData.lights.push(glow);
    }
    scene.add(grp);
    return grp;
  }

  function makePersonGroup(kind) {
    const grp = new THREE.Group();
    const colors = {
      player: 0xffc44d, cop: 0x2a4d9b, dealer: 0x7a1f2b, ped: 0xb8c4ce,
    };
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(11, 17, 7),
      new THREE.MeshLambertMaterial({ color: colors[kind] || colors.ped }),
    );
    torso.position.y = 17;
    torso.castShadow = true;
    grp.add(torso);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(9, 9, 6), new THREE.MeshLambertMaterial({ color: 0x23242c }));
    legs.position.y = 4.5;
    grp.add(legs);
    const head = new THREE.Mesh(new THREE.SphereGeometry(5.2, 10, 8), new THREE.MeshLambertMaterial({ color: 0xd9a37e }));
    head.position.y = 30;
    grp.add(head);
    scene.add(grp);
    return grp;
  }

  // --- day / night rig -----------------------------------------------------
  // darkness 0 at noon, ~0.55 at dusk, ~0.92 deep night. The night rig is
  // strong on purpose: hemi 1.05 + ambient 0.5 + moon 0.55 keeps streets
  // readable while the emissives take over the mood.
  function darknessAt(minutes) {
    const stops = [
      [0, 0.92], [300, 0.92], [390, 0.3], [480, 0.08], [1020, 0.1],
      [1140, 0.55], [1230, 0.85], [1320, 0.92], [1440, 0.92],
    ];
    for (let i = 1; i < stops.length; i += 1) {
      if (minutes <= stops[i][0]) {
        const [t0, d0] = stops[i - 1];
        const [t1, d1] = stops[i];
        return d0 + (d1 - d0) * ((minutes - t0) / (t1 - t0));
      }
    }
    return 0.92;
  }
  const SKY_DAY = new THREE.Color(0x79b8e0);
  const SKY_DUSK = new THREE.Color(0x51386e);
  const SKY_NIGHT = new THREE.Color(0x35477a);
  const FOG_DAY = new THREE.Color(0x9fc4de);
  const FOG_NIGHT = new THREE.Color(0x36466a);

  const camPos = new THREE.Vector3(430, 260, 3400);
  let camYaw = -Math.PI / 2;
  let snapCam = false;

  function syncWorld(state, dt) {
    // cars
    const seenCars = new Set();
    for (const car of state.cars) {
      if (car.dead) continue;
      seenCars.add(car.id);
      let grp = carGroups.get(car.id);
      if (!grp) { grp = makeCarGroup(car); carGroups.set(car.id, grp); }
      grp.position.set(car.x, 0, car.y);
      grp.rotation.y = -car.angle;
      const dmg = 1 - car.hp / 100;
      grp.position.y = dmg > 0.6 ? -2 : 0;
      for (const wheel of grp.userData.wheels) wheel.rotation.z -= (car.speed * dt) / 6.5;
      const dark = darknessNow;
      for (const glow of grp.userData.lights) glow.material.opacity = dark * 0.75;
    }
    for (const [id, grp] of carGroups) {
      if (!seenCars.has(id)) { scene.remove(grp); carGroups.delete(id); }
    }
    // people
    const syncPeople = (list, map, kindOf) => {
      const seen = new Set();
      for (const person of list) {
        if (person.dead) continue;
        seen.add(person);
        let grp = map.get(person);
        if (!grp) { grp = makePersonGroup(kindOf(person)); map.set(person, grp); }
        grp.position.set(person.x, 0, person.y);
        grp.rotation.y = -person.angle + Math.PI;
        const moving = person.fleeT > 0 || Math.hypot(person.tx - person.x, person.ty - person.y) > 16;
        grp.position.y = moving ? Math.abs(Math.sin(state.t * 11 + person.sway)) * 1.6 : 0;
      }
      for (const [person, grp] of map) {
        if (!seen.has(person)) { scene.remove(grp); map.delete(person); }
      }
    };
    syncPeople(state.peds, pedGroups, (p) => (p.dealer ? 'dealer' : 'ped'));
    syncPeople(state.cops, copGroups, () => 'cop');
    // the player, when on foot
    let playerGrp = pedGroups.get(state.player);
    if (!state.player.car) {
      if (!playerGrp) { playerGrp = makePersonGroup('player'); pedGroups.set(state.player, playerGrp); }
      playerGrp.position.set(state.player.x, 0, state.player.y);
      playerGrp.rotation.y = -state.player.angle + Math.PI;
      playerGrp.visible = true;
    } else if (playerGrp) playerGrp.visible = false;
    // dead fall over: handled by removal above (they vanish into the night)
    // pickups
    pickupGroup.clear();
    for (const pk of state.pickups) {
      const cross = new THREE.Mesh(
        new THREE.BoxGeometry(12, 12, 4),
        new THREE.MeshBasicMaterial({ color: 0x3eff7a }),
      );
      cross.position.set(pk.x, 16 + Math.sin(state.t * 3) * 3, pk.y);
      cross.rotation.y = state.t * 2;
      pickupGroup.add(cross);
    }
    // tracers
    for (const line of tracerLines) scene.remove(line);
    tracerLines = [];
    for (const tr of state.tracers) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(tr.x1, 22, tr.y1),
        new THREE.Vector3(tr.x2, 22, tr.y2),
      ]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: tr.hostile ? 0xff5544 : 0xffe9a0, transparent: true, opacity: 0.9 }));
      scene.add(line);
      tracerLines.push(line);
    }
    // lightbars flash
    const phase = Math.floor(state.t * 2.4) % 2 === 0;
    for (const bar of lightbars) {
      bar.red.material.color.setHex(phase ? 0xff2222 : 0x661111);
      bar.blue.material.color.setHex(phase ? 0x113366 : 0x2266ff);
    }
    // traffic light phase (12 s cycle, two directions)
    const tlPhase = Math.floor(state.t / 4) % 3; // 0 green, 1 amber, 2 red
    for (const dot of trafficDots) {
      const mine = (tlPhase + dot.phase) % 3;
      dot.mesh.material = mine === 0 ? dot.mats.green : mine === 1 ? dot.mats.amber : dot.mats.red;
    }
    // sea shimmer + foam drift
    const sea = cityGroup.getObjectByName('sea');
    if (sea) sea.position.y = 1.5 + Math.sin(state.t * 0.8) * 0.5;
    for (let i = 0; i < 3; i += 1) {
      const foam = cityGroup.getObjectByName('foam' + i);
      if (foam) foam.material.opacity = 0.22 + 0.16 * Math.sin(state.t * 0.9 + i * 1.7);
    }
  }

  function applyLight(state) {
    const dark = darknessAt(state.minutes);
    darknessNow = dark;
    renderer.toneMappingExposure = 1 + dark * 0.45;
    const sky = new THREE.Color();
    if (dark < 0.55) sky.copy(SKY_DAY).lerp(SKY_DUSK, dark / 0.55);
    else sky.copy(SKY_DUSK).lerp(SKY_NIGHT, (dark - 0.55) / 0.45);
    scene.background = sky;
    scene.fog = new THREE.Fog(FOG_DAY.clone().lerp(FOG_NIGHT, dark), 1500, 4600);
    hemi.intensity = 0.9 + dark * 0.85;
    hemi.color.setHex(dark > 0.6 ? 0x8fb0ff : 0xbdd8ff);
    amb.intensity = 0.34 + dark * 0.42;
    const dayFrac = ((state.minutes - 360) % 1440) / 1440; // 06:00 -> 0
    const sunAngle = dayFrac * Math.PI;
    const focus = state.player;
    if (dark < 0.75) {
      sun.color.setHex(dark > 0.3 ? 0xff9a4d : 0xfff2d8);
      sun.intensity = 1.25 - dark * 0.9;
      sun.position.set(focus.x + Math.cos(sunAngle) * 900, 500 + Math.sin(sunAngle) * 700, focus.y - 500);
    } else {
      sun.color.setHex(0x9db8ff);
      sun.intensity = 1.0;
      sun.position.set(focus.x - 500, 950, focus.y - 300);
    }
    sun.target.position.set(focus.x, 0, focus.y);
    for (const glow of lampGlows) glow.material.opacity = Math.min(0.95, dark * 1.05);
    if (stars) {
      stars.material.opacity = Math.max(0, dark - 0.45) * 1.4;
      stars.position.set(focus.x, 0, focus.y);
    }
    if (sunSprite) {
      sunSprite.position.set(focus.x + Math.cos(sunAngle) * 3600, 240 + Math.sin(sunAngle) * 1500, focus.y - 2600);
      sunSprite.material.opacity = dark < 0.7 ? 0.95 : 0;
    }
    if (moonSprite) {
      moonSprite.position.set(focus.x - 1800, 1500, focus.y - 2400);
      moonSprite.material.opacity = Math.max(0, dark - 0.5);
    }
    if (cityGroup) {
      cityGroup.traverse((obj) => {
        if (obj.material && obj.material.name === 'facade') obj.material.emissiveIntensity = dark * 1.5;
      });
    }
  }

  function updateCamera(state, screen, dt) {
    const p = state.player;
    if (screen === SCREEN_TITLE) {
      const cx = 3160; const cz = 1620;
      const a = state.t * 0.05;
      camPos.set(cx + Math.cos(a) * 560, 230, cz + Math.sin(a) * 560);
      if (snapCam) camera.position.copy(camPos);
      else camera.position.lerp(camPos, 1 - Math.exp(-dt * 2));
      camera.lookAt(cx, 30, cz);
      camera.fov = 55;
      camera.updateProjectionMatrix();
      snapCam = false;
      return;
    }
    const focusAngle = p.car ? p.car.angle : p.angle;
    const speed = p.car ? Math.abs(p.car.speed) : 0;
    const back = p.car ? 185 + speed * 0.22 : 128;
    const height = p.car ? 92 : 74;
    if (snapCam) camYaw = focusAngle;
    else camYaw += (((focusAngle - camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 3.2);
    const tx = p.x - Math.cos(camYaw) * back;
    const ty = p.y - Math.sin(camYaw) * back;
    camPos.set(tx, height, ty);
    if (snapCam) camera.position.copy(camPos);
    else camera.position.lerp(camPos, 1 - Math.exp(-dt * (p.car ? 5 : 7)));
    snapCam = false;
    camera.lookAt(p.x + Math.cos(camYaw) * 90, 16, p.y + Math.sin(camYaw) * 90);
    const targetFov = 58 + (p.car ? Math.min(12, speed * 0.028) : 0);
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }

  // --- HUD (2D overlay) ------------------------------------------------------
  const hud = hudCanvas.getContext('2d');
  function fmtClock(minutes) {
    const h = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  function drawMinimap(world) {
    const state = world.state;
    const W2 = 216; const H2 = 162;
    const x0 = VIEW.width - W2 - 16; const y0 = VIEW.height - H2 - 16;
    const sx = W2 / WORLD.width; const sy = H2 / WORLD.height;
    hud.save();
    hud.fillStyle = 'rgba(10,12,26,0.72)';
    hud.fillRect(x0, y0, W2, H2);
    hud.strokeStyle = 'rgba(46,230,255,0.5)';
    hud.strokeRect(x0, y0, W2, H2);
    hud.fillStyle = '#14586e';
    hud.fillRect(x0 + ROADS.waterFrom * sx, y0, (WORLD.width - ROADS.waterFrom) * sx, H2);
    hud.fillStyle = '#e8c98f';
    hud.fillRect(x0 + ROADS.sandFrom * sx, y0, (ROADS.waterFrom - ROADS.sandFrom) * sx, H2);
    hud.strokeStyle = 'rgba(200,205,230,0.55)';
    hud.lineWidth = 2;
    for (const ax of ROADS.avenues) { hud.beginPath(); hud.moveTo(x0 + ax * sx, y0); hud.lineTo(x0 + ax * sx, y0 + H2); hud.stroke(); }
    for (const sy2 of ROADS.streets) { hud.beginPath(); hud.moveTo(x0, y0 + sy2 * sy); hud.lineTo(x0 + ROADS.sandFrom * sx, y0 + sy2 * sy); hud.stroke(); }
    hud.font = 'bold 9px Arial';
    hud.textAlign = 'center';
    for (const pl of Object.values(state.city.places)) {
      hud.fillStyle = pl.color;
      hud.fillText(pl.letter, x0 + pl.door.x * sx, y0 + pl.door.y * sy + 3);
    }
    const obj = world.objective();
    if (!state.storyComplete) {
      hud.fillStyle = PALETTE.gold;
      hud.beginPath();
      hud.arc(x0 + obj.x * sx, y0 + obj.y * sy, 3.4 + Math.sin(state.t * 5) * 0.8, 0, Math.PI * 2);
      hud.fill();
    }
    for (const car of state.cars) {
      if (car.kind !== 'police' || car.dead) continue;
      hud.fillStyle = Math.floor(state.t * 2.4) % 2 ? '#ff4444' : '#4488ff';
      hud.fillRect(x0 + car.x * sx - 2, y0 + car.y * sy - 2, 4, 4);
    }
    const p = state.player;
    hud.fillStyle = '#ffffff';
    hud.beginPath();
    const px = x0 + p.x * sx; const py = y0 + p.y * sy;
    hud.moveTo(px + Math.cos(p.angle) * 6, py + Math.sin(p.angle) * 6);
    hud.lineTo(px + Math.cos(p.angle + 2.5) * 5, py + Math.sin(p.angle + 2.5) * 5);
    hud.lineTo(px + Math.cos(p.angle - 2.5) * 5, py + Math.sin(p.angle - 2.5) * 5);
    hud.closePath();
    hud.fill();
    hud.restore();
  }

  function contextPrompt(world) {
    const state = world.state;
    const p = state.player;
    if (p.car) return 'E — Exit vehicle';
    let doorPlace = null; let doorDist = Infinity;
    for (const pl of Object.values(state.city.places)) {
      const d = Math.hypot(pl.door.x - p.x, pl.door.y - p.y);
      if (d < doorDist) { doorDist = d; doorPlace = pl; }
    }
    let carDist = Infinity;
    for (const car of state.cars) {
      if (car.dead) continue;
      carDist = Math.min(carDist, Math.hypot(car.x - p.x, car.y - p.y));
    }
    if (doorDist < 88 && doorDist <= carDist + 20) {
      const verbs = {
        clinic: 'Heal — $40', policeStation: 'Bribe — $150', hotel: 'Rest & save — $60',
        market: 'Shop', carLot: 'Buy car — $800', garage: 'Repair — $50',
        hideout: 'Lie low & save', bank: 'The vault',
      };
      return `E — ${doorPlace.name}: ${verbs[doorPlace.id] || 'Enter'}`;
    }
    if (carDist < 54) return 'E — Enter vehicle';
    return '';
  }

  function drawHUD(world, screen, best) {
    const state = world.state;
    const p = state.player;
    hud.clearRect(0, 0, VIEW.width, VIEW.height);
    if (screen === SCREEN_PLAY) {
      // money + health, top left
      hud.textAlign = 'left';
      hud.font = 'bold 30px Arial';
      hud.fillStyle = PALETTE.gold;
      hud.shadowColor = PALETTE.gold;
      hud.shadowBlur = 12;
      hud.fillText(`$${p.money.toLocaleString('en-US')}`, 20, 40);
      hud.shadowBlur = 0;
      hud.fillStyle = 'rgba(10,12,26,0.6)';
      hud.fillRect(20, 52, 190, 13);
      hud.fillStyle = p.hp > 35 ? '#3eff7a' : '#ff4444';
      hud.fillRect(20, 52, 190 * Math.max(0, p.hp / 100), 13);
      hud.strokeStyle = 'rgba(255,255,255,0.4)';
      hud.strokeRect(20, 52, 190, 13);
      // wanted stars + clock, top right
      const starCount = world.stars();
      hud.textAlign = 'right';
      hud.font = '26px Arial';
      for (let i = 0; i < 5; i += 1) {
        const active = i < starCount;
        hud.fillStyle = active ? (Math.floor(state.t * 3) % 2 || state.seenT > 2 ? '#ffd23c' : '#8a6d1f') : 'rgba(255,255,255,0.22)';
        hud.fillText('★', VIEW.width - 20 - (4 - i) * 30, 38);
      }
      hud.font = 'bold 17px Arial';
      hud.fillStyle = '#e8ecff';
      hud.fillText(fmtClock(state.minutes), VIEW.width - 20, 64);
      // objective banner, top centre
      const obj = world.objective();
      hud.textAlign = 'center';
      hud.font = 'bold 19px Arial';
      const label = state.storyComplete ? 'STORY COMPLETE — the bay is yours' : obj.text;
      const wText = hud.measureText(label).width + 44;
      hud.fillStyle = 'rgba(10,12,26,0.66)';
      hud.fillRect((VIEW.width - wText) / 2, 14, wText, 40);
      hud.strokeStyle = 'rgba(255,196,77,0.65)';
      hud.strokeRect((VIEW.width - wText) / 2, 14, wText, 40);
      hud.fillStyle = PALETTE.gold;
      hud.fillText(label, VIEW.width / 2, 41);
      if (!state.storyComplete && obj.dist > 4) {
        hud.font = '13px Arial';
        hud.fillStyle = '#c8d2ff';
        hud.fillText(`${Math.round(obj.dist)} m`, VIEW.width / 2, 70);
      }
      // channel / vault progress
      const step = world.currentStep();
      const channeling = (step && step.kind === 'channel' && state.channelT > 0) || state.vaultT > 0;
      if (channeling) {
        const total = step && step.kind === 'channel' && state.channelT > 0 ? step.seconds : 3;
        const done = state.channelT > 0 ? state.channelT : state.vaultT;
        hud.fillStyle = 'rgba(10,12,26,0.7)';
        hud.fillRect(VIEW.width / 2 - 130, 84, 260, 14);
        hud.fillStyle = PALETTE.cyan;
        hud.fillRect(VIEW.width / 2 - 130, 84, 260 * Math.min(1, done / total), 14);
      }
      // busted meter
      if (state.bustedMeter > 0.02) {
        hud.font = 'bold 16px Arial';
        hud.fillStyle = '#ff5544';
        hud.fillText('BUSTED?', VIEW.width / 2, 128);
        hud.fillStyle = 'rgba(10,12,26,0.7)';
        hud.fillRect(VIEW.width / 2 - 110, 136, 220, 11);
        hud.fillStyle = '#ff5544';
        hud.fillRect(VIEW.width / 2 - 110, 136, 220 * state.bustedMeter, 11);
      }
      // toast
      if (state.toast && state.toastT > 0) {
        hud.font = 'bold 17px Arial';
        hud.fillStyle = '#ffffff';
        hud.fillText(state.toast, VIEW.width / 2, VIEW.height - 118);
      }
      // context prompt + weapon/speed, bottom centre/left
      const prompt = contextPrompt(world);
      if (prompt) {
        hud.font = 'bold 16px Arial';
        hud.fillStyle = PALETTE.cyan;
        hud.fillText(prompt, VIEW.width / 2, VIEW.height - 26);
      }
      hud.textAlign = 'left';
      hud.font = 'bold 16px Arial';
      hud.fillStyle = '#e8ecff';
      const weaponName = { fist: 'Fists', pistol: 'Pistol', smg: 'SMG', shotgun: 'Shotgun' }[p.weapon];
      hud.fillText(weaponName, 20, VIEW.height - 48);
      if (p.car) {
        hud.fillText(`${Math.round(Math.abs(p.car.speed) * 0.36)} km/h`, 20, VIEW.height - 24);
        hud.fillStyle = p.car.hp > 40 ? '#3eff7a' : '#ff4444';
        hud.fillText(`Car ${Math.round(p.car.hp)}%`, 130, VIEW.height - 24);
      }
      drawMinimap(world);
    }
    // vignette
    const grad = hud.createRadialGradient(VIEW.width / 2, VIEW.height / 2, VIEW.height * 0.42, VIEW.width / 2, VIEW.height / 2, VIEW.height * 0.85);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(4,2,14,0.42)');
    hud.fillStyle = grad;
    hud.fillRect(0, 0, VIEW.width, VIEW.height);
  }

  function drawCard(world, screen, best) {
    const state = world.state;
    hud.fillStyle = 'rgba(6,4,18,0.55)';
    hud.fillRect(0, 0, VIEW.width, VIEW.height);
    hud.textAlign = 'center';
    if (screen === SCREEN_TITLE) {
      // retro sunset stripes behind the logo
      const cols = ['#ff3d8a', '#ff7a3c', '#ffc44d', '#ff3d8a'];
      for (let i = 0; i < 4; i += 1) {
        hud.fillStyle = cols[i];
        hud.globalAlpha = 0.85 - i * 0.16;
        hud.fillRect(VIEW.width / 2 - 260 + i * 8, 128 + i * 34, 520 - i * 16, 13);
      }
      hud.globalAlpha = 1;
      hud.font = 'bold 118px Arial';
      hud.fillStyle = PALETTE.cyan;
      hud.shadowColor = PALETTE.cyan;
      hud.shadowBlur = 42;
      hud.fillText('NEON BAY', VIEW.width / 2, 300);
      hud.shadowColor = PALETTE.pink;
      hud.shadowBlur = 26;
      hud.fillStyle = '#ffffff';
      hud.font = 'bold 30px Arial';
      hud.fillText('a tropical crime story', VIEW.width / 2, 348);
      hud.shadowBlur = 0;
      hud.font = '20px Arial';
      hud.fillStyle = '#e8ecff';
      hud.fillText('ENTER — start tonight      C — continue      M — sound on/off', VIEW.width / 2, 470);
      hud.font = '16px Arial';
      hud.fillStyle = '#9fb2d8';
      hud.fillText('WASD drive & walk · mouse aim · click shoot · E interact · 1–4 weapons · P pause', VIEW.width / 2, 502);
      if (best > 0) hud.fillText(`Best night: $${best.toLocaleString('en-US')}`, VIEW.width / 2, 540);
    } else if (screen === SCREEN_PAUSED) {      hud.font = 'bold 54px Arial';
      hud.fillStyle = '#ffffff';
      hud.fillText('PAUSED', VIEW.width / 2, 190);
      hud.font = '19px Arial';
      hud.fillStyle = '#c8d2ff';
      const s = state.stats;
      hud.fillText(`Missions: ${state.missionIndex}/6   Cars stolen: ${s.carsStolen}   Shots: ${s.shotsFired}`, VIEW.width / 2, 260);
      hud.fillText(`Time in the bay: ${Math.floor(s.timePlayed / 60)} min   Best: $${Math.max(best, s.bestMoney).toLocaleString('en-US')}`, VIEW.width / 2, 292);
      hud.fillText('P — resume      S — save      R — restart night      M — sound', VIEW.width / 2, 360);
      hud.font = '16px Arial';
      hud.fillStyle = '#9fb2d8';
      hud.fillText('Weapons: 1 fists · 2 pistol · 3 SMG · 4 shotgun (buy iron at Mercado Sol)', VIEW.width / 2, 396);
    } else if (screen === 'busted' || screen === 'wasted') {
      hud.font = 'bold 92px Arial';
      hud.fillStyle = screen === 'busted' ? '#4488ff' : '#ff4444';
      hud.shadowColor = hud.fillStyle;
      hud.shadowBlur = 34;
      hud.fillText(screen === 'busted' ? 'BUSTED' : 'WASTED', VIEW.width / 2, 320);
      hud.shadowBlur = 0;
      hud.font = '20px Arial';
      hud.fillStyle = '#e8ecff';
      hud.fillText(screen === 'busted' ? 'The Comisaria keeps $120 and your pride.' : 'Clinica Brisa keeps $100 and most of the bullets.', VIEW.width / 2, 372);
    }
  }

  function draw(world, screen, best, dt) {
    const state = world.state;
    if (!built) buildCity(state.city);
    applyLight(state);
    syncWorld(state, dt || 0.016);
    // mission pillar at the objective
    const obj = world.objective();
    if (pillar) {
      pillar.visible = screen === SCREEN_PLAY && !state.storyComplete;
      pillar.position.set(obj.x, 160, obj.y);
    }
    updateCamera(state, screen, dt || 0.016);
    renderer.render(scene, camera);
    drawHUD(world, screen, best);
    if (screen !== SCREEN_PLAY) drawCard(world, screen, best);
    if (state.lastEvent === 'busted' || state.lastEvent === 'wasted') {
      // the card flashes once via toast in-world; the shell clears lastEvent
    }
  }

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function pickGround(clientX, clientY) {
    const rect = glCanvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const out = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, out);
    if (!out) return null;
    return { x: out.x, y: out.z };
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    glCanvas.style.width = w + 'px';
    glCanvas.style.height = h + 'px';
    hudCanvas.width = VIEW.width;
    hudCanvas.height = VIEW.height;
    hudCanvas.style.width = w + 'px';
    hudCanvas.style.height = h + 'px';
  }

  function setQuality(full) {
    qualityFull = full;
    renderer.setPixelRatio(full ? Math.min(window.devicePixelRatio || 1, 1.6) : 0.55);
    renderer.shadowMap.enabled = full;
    sun.castShadow = full;
  }
  // auto-detect a software rasteriser and start gentle
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software/i.test(name)) setQuality(false);
    else setQuality(true);
  } catch { setQuality(true); }

  return { draw, pickGround, resize, setQuality, snapCamera: () => { snapCam = true; }, get qualityFull() { return qualityFull; } };
}
