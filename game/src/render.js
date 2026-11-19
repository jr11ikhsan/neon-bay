// NEON BAY — renderer: a low-poly Three.js city at dusk, plus a 2D canvas
// HUD (minimap, banners, screens) stacked on top. The simulation is pure
// data; everything visual is built from it here, once for the static city
// and per-frame for the moving pieces.
//
// World -> three mapping: three.x = world.x - 2400, three.z = world.y - 1800,
// three.y is up. A world heading `a` becomes group.rotation.y = -a.
//
// The night rig is deliberately bright (this is a readability requirement,
// not an accident): strong hemisphere + ambient fill, a real moonlight
// directional, emissive windows and lamp glow that ramp up after dark.

import * as THREE from '../vendor/three.module.min.js';
import { WORLD, DAY, PALETTE } from './config.js';
import { clamp, lerp, dist } from './random.js';

const CX = WORLD.w / 2, CZ = WORLD.h / 2;
const tx = (x) => x - CX, tz = (y) => y - CZ;

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Six shared building skins: window grids in different tints, used as both
// map and emissive map so windows light up at night.
function buildingSkins() {
  const skins = [];
  const tints = ['#5a6274', '#6b5a74', '#54626e', '#71655a', '#4e5d6e', '#665a68'];
  for (let s = 0; s < tints.length; s++) {
    const tex = canvasTexture(128, 256, (g, w, h) => {
      g.fillStyle = tints[s]; g.fillRect(0, 0, w, h);
      for (let y = 10; y < h - 8; y += 18) for (let x = 9; x < w - 8; x += 16) {
        const lit = ((x * 7 + y * 13 + s * 31) % 10) < 5;
        g.fillStyle = lit ? '#ffd98a' : '#2b3242';
        g.fillRect(x, y, 9, 11);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, w, 6);
    });
    skins.push(new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffca7a, emissiveMap: tex, emissiveIntensity: 0.25 }));
  }
  return skins;
}

function groundTexture(city) {
  const W = 2048, H = 1536, sx = W / WORLD.w, sy = H / WORLD.h;
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#3b404c'; g.fillRect(0, 0, W, H); // block concrete
    for (const pk of city.parks) { g.fillStyle = '#1f4a33'; g.fillRect(pk.x * sx, pk.y * sy, pk.w * sx, pk.h * sy); }
    const plz = { x: 3478, y: 478, w: 394, h: 484 };
    g.fillStyle = '#4d4460'; g.fillRect(plz.x * sx, plz.y * sy, plz.w * sx, plz.h * sy);
    for (const lot of city.lots) {
      g.fillStyle = '#33363f'; g.fillRect(lot.x * sx, lot.y * sy, lot.w * sx, lot.h * sy);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.4;
      for (let i = 0; i < 10; i++) { const x = (lot.x + 60 + (i % 5) * 84) * sx, y = (lot.y + 120 + Math.floor(i / 5) * 150) * sy; g.strokeRect(x - 15 * sx, y - 26 * sy, 30 * sx, 52 * sy); }
    }
    // roads
    g.fillStyle = '#22242c';
    for (const ax of city.avenues) g.fillRect((ax - city.roadHalf) * sx, 0, city.roadHalf * 2 * sx, H);
    for (const sy2 of city.streets) g.fillRect(0, (sy2 - city.roadHalf) * sy, W, city.roadHalf * 2 * sy);
    g.strokeStyle = 'rgba(255,209,102,0.5)'; g.lineWidth = 2; g.setLineDash([16, 14]);
    for (const ax of city.avenues) { g.beginPath(); g.moveTo(ax * sx, 0); g.lineTo(ax * sx, H); g.stroke(); }
    for (const sy2 of city.streets) { g.beginPath(); g.moveTo(0, sy2 * sy); g.lineTo(city.sandX * sx, sy2 * sy); g.stroke(); }
    g.setLineDash([]);
    // boardwalk, sand, sea
    g.fillStyle = '#6e4b2e'; g.fillRect(city.boardwalkX * sx - 16, 0, 34, H);
    const grad = g.createLinearGradient(city.sandX * sx, 0, WORLD.w * sx, 0);
    grad.addColorStop(0, '#dec491'); grad.addColorStop(0.18, '#c9b183'); grad.addColorStop(0.24, '#0d4066'); grad.addColorStop(1, '#062238');
    g.fillStyle = grad; g.fillRect(city.sandX * sx, 0, (WORLD.w - city.sandX) * sx, H);
    g.strokeStyle = 'rgba(160,220,255,0.25)'; g.lineWidth = 2;
    for (let y = 30; y < H; y += 46) { g.beginPath(); for (let x = city.waterX * sx; x < W; x += 26) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 3); g.stroke(); }
  });
}

export class Renderer {
  constructor(world, glCanvas, hudCanvas, opts = {}) {
    this.world = world;
    this.hud = hudCanvas.getContext('2d');
    this.hudCanvas = hudCanvas;
    this.shotMode = !!opts.shotMode;
    this.renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: this.shotMode });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x2a1a44, 900, 3000);
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 1, 6000);
    this.yaw = -Math.PI / 2; this.camPos = new THREE.Vector3(0, 200, 400);
    this.flashT = 0; this.qualityFull = true;

    const info = this.renderer.getContext().getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? String(this.renderer.getContext().getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    this.softwareGL = /swiftshader|llvmpipe|software/i.test(gpu);
    if (this.softwareGL && !this.shotMode) this.qualityFull = false;
    this.applySize();

    this.buildLights();
    this.buildSky();
    this.buildCity();
    this.carMeshes = new Map(); this.pedMeshes = new Map(); this.pickupMeshes = new Map();
    this.playerMesh = this.buildPerson(0x22d3ee, 0xff2e88);
    this.scene.add(this.playerMesh);
    this.buildFx();
  }

  // Point the renderer at a fresh world (new game / continue): the static
  // city is seed-identical, so only the dynamic entity meshes are dropped.
  bindWorld(world) {
    this.world = world;
    for (const [, m] of this.carMeshes) this.scene.remove(m);
    for (const [, m] of this.pedMeshes) this.scene.remove(m);
    for (const [, m] of this.pickupMeshes) this.scene.remove(m);
    this.carMeshes.clear(); this.pedMeshes.clear(); this.pickupMeshes.clear();
  }

  setQuality(full) {
    this.qualityFull = full;
    this.dirLight.castShadow = full;
    this.applySize();
  }

  applySize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.qualityFull ? Math.min(window.devicePixelRatio || 1, 1.6) : 0.55;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.hudCanvas.width = w; this.hudCanvas.height = h;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0x8a7bd8, 0x2c2137, 0.8);
    this.scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xbfd0ff, 0.3);
    this.scene.add(this.amb);
    this.dirLight = new THREE.DirectionalLight(0xffb36b, 1.2);
    this.dirLight.castShadow = false;
    this.dirLight.shadow.mapSize.set(1024, 1024);
    const sc = this.dirLight.shadow.camera;
    sc.left = -520; sc.right = 520; sc.top = 520; sc.bottom = -520; sc.far = 2200;
    this.scene.add(this.dirLight); this.scene.add(this.dirLight.target);
  }

  buildSky() {
    this.skyCanvas = document.createElement('canvas'); this.skyCanvas.width = 4; this.skyCanvas.height = 256;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas); this.skyTex.colorSpace = THREE.SRGBColorSpace;
    const skyMat = new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 20, 12), skyMat);
    this.scene.add(this.sky);
    // stars
    const n = 420, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.48 + 0.05, r = 4000;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starsMat = new THREE.PointsMaterial({ color: 0xcfe4ff, size: 7, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.scene.add(new THREE.Points(geo, this.starsMat));
    // sun / moon billboards
    const glowTex = canvasTexture(128, 128, (g) => {
      const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    });
    this.glowTex = glowTex;
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa64d, transparent: true, fog: false, depthWrite: false }));
    this.sunSprite.scale.set(1500, 1500, 1);
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xbdd2ff, transparent: true, fog: false, depthWrite: false }));
    this.moonSprite.scale.set(620, 620, 1);
    this.scene.add(this.sunSprite); this.scene.add(this.moonSprite);
  }

  buildCity() {
    const city = this.world.city;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.w, WORLD.h),
      new THREE.MeshLambertMaterial({ map: groundTexture(city) }),
    );
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    this.scene.add(ground);

    const skins = buildingSkins();
    this.buildingMats = skins;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < city.buildings.length; i++) {
      const b = city.buildings[i];
      const m = new THREE.Mesh(boxGeo, skins[i % skins.length]);
      m.scale.set(b.w, b.height, b.h);
      m.position.set(tx(b.x + b.w / 2), b.height / 2, tz(b.y + b.h / 2));
      m.castShadow = true;
      this.scene.add(m);
      // neon sign: a glowing band near the roof, coloured per building
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(b.w * 0.7, 150), 7, 2),
        new THREE.MeshBasicMaterial({ color: b.color }),
      );
      sign.position.set(tx(b.x + b.w / 2), b.height - 8, tz(b.y) - 2);
      this.scene.add(sign);
      this['signMat' + (i % skins.length)] = sign.material;
    }
    // palms: instanced trunk + crown
    const trunkGeo = new THREE.CylinderGeometry(2.2, 3.4, 26, 5);
    trunkGeo.translate(0, 13, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
    const crownGeo = new THREE.ConeGeometry(17, 10, 7);
    crownGeo.translate(0, 28, 0); crownGeo.scale(1, 0.55, 1);
    const crownMat = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, city.palms.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, city.palms.length);
    const dummy = new THREE.Object3D();
    city.palms.forEach((p, i) => {
      dummy.position.set(tx(p.x), 0, tz(p.y));
      dummy.scale.setScalar(p.s);
      dummy.rotation.set((p.x % 7) * 0.01, p.x % Math.PI, (p.y % 5) * 0.012);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix); crowns.setMatrixAt(i, dummy.matrix);
    });
    this.scene.add(trunks); this.scene.add(crowns);
    // lamp glow points (lit at night)
    const lampPos = new Float32Array(city.lamps.length * 3);
    city.lamps.forEach((l, i) => { lampPos[i * 3] = tx(l.x); lampPos[i * 3 + 1] = 26; lampPos[i * 3 + 2] = tz(l.y); });
    const lampGeo = new THREE.BufferGeometry();
    lampGeo.setAttribute('position', new THREE.BufferAttribute(lampPos, 3));
    this.lampMat = new THREE.PointsMaterial({ map: this.glowTex, color: 0xffd9a0, size: 95, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.scene.add(new THREE.Points(lampGeo, this.lampMat));
    // shoreline foam: three pale lines that breathe
    this.foam = [];
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(7, WORLD.h), new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.25, depthWrite: false }));
      f.rotation.x = -Math.PI / 2;
      f.position.set(tx(city.waterX + 6 + i * 26), 0.4 + i * 0.15, 0);
      this.scene.add(f); this.foam.push(f);
    }
    // mission pillar + ring
    this.pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(30, 30, 340, 18, 1, true),
      new THREE.MeshBasicMaterial({ color: PALETTE.neonGold, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.pillar.position.y = 170;
    this.scene.add(this.pillar);
  }

  buildFx() {
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(160 * 6);
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    this.tracers = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ color: 0xffdf8a, transparent: true, opacity: 0.9 }));
    this.tracers.frustumCulled = false;
    this.scene.add(this.tracers);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.flash.scale.set(46, 46, 1);
    this.scene.add(this.flash);
    // headlight cones pool
    this.cones = [];
    const coneGeo = new THREE.ConeGeometry(52, 150, 14, 1, true);
    for (let i = 0; i < 10; i++) {
      const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xffe9b8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      this.scene.add(cone); this.cones.push(cone);
    }
  }

  buildPerson(torsoColor, legColor) {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const legs = new THREE.Mesh(new THREE.BoxGeometry(11, 13, 8), mat(legColor)); legs.position.y = 6.5;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(14, 17, 9), mat(torsoColor)); torso.position.y = 21;
    const head = new THREE.Mesh(new THREE.SphereGeometry(5.6, 10, 8), mat(0xe8b98d)); head.position.y = 33;
    g.add(legs, torso, head);
    g.userData = { legs, torso, head };
    return g;
  }

  buildCarMesh(car) {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const bodyMat = mat(car.color);
    const dark = mat(0x1c1e26), glass = mat(0x9fd4e8);
    let bodyH = 15, bodyLen = 58, bodyWid = 30, cabinLen = 30;
    if (car.type === 'van') { bodyH = 24; cabinLen = 46; }
    if (car.type === 'pickup') { bodyH = 17; cabinLen = 22; }
    if (car.type === 'sport') { bodyH = 12; bodyLen = 62; }
    const body = new THREE.Mesh(new THREE.BoxGeometry(bodyLen, bodyH, bodyWid), bodyMat);
    body.position.y = 8 + bodyH / 2; body.castShadow = true;
    g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabinLen, 11, bodyWid - 5), car.type === 'van' ? bodyMat : glass);
    cabin.position.set(car.type === 'pickup' ? 8 : -2, 8 + bodyH + 5, 0);
    g.add(cabin);
    if (car.type === 'sport') {
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(5, 3, bodyWid - 2), dark);
      spoiler.position.set(-bodyLen / 2 + 4, 8 + bodyH + 6, 0); g.add(spoiler);
    }
    if (car.type === 'taxi') {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 10), mat(0xfff2b0));
      sign.position.set(-2, 8 + bodyH + 13, 0); g.add(sign);
    }
    const wheelGeo = new THREE.CylinderGeometry(7.5, 7.5, 6, 10);
    const wheels = [];
    for (const [wx, wz] of [[19, 16], [19, -16], [-19, 16], [-19, -16]]) {
      const w = new THREE.Mesh(wheelGeo, dark);
      w.rotation.x = Math.PI / 2; w.position.set(wx, 7.5, wz);
      g.add(w); wheels.push(w);
    }
    let barL = null, barR = null;
    if (car.kind === 'cop') {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(16, 4, 20), dark);
      bar.position.set(-2, 8 + bodyH + 13, 0); g.add(bar);
      barL = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 8), new THREE.MeshBasicMaterial({ color: 0xff2e4d }));
      barL.position.set(-2, 8 + bodyH + 16, 6);
      barR = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 8), new THREE.MeshBasicMaterial({ color: 0x2e7dff }));
      barR.position.set(-2, 8 + bodyH + 16, -6);
      g.add(barL, barR);
    }
    g.userData = { wheels, barL, barR };
    return g;
  }

  // ---------------------------------------------------------------- phases
  // 0 = golden dusk, 1 = full night. Drives the whole lighting rig.
  nightFactor() {
    const t = this.world.timeMinutes;
    if (t >= DAY.nightStart && t < 24 * 60) return clamp((t - DAY.nightStart) / 50, 0, 1);
    if (t < DAY.nightEnd) return 1;
    if (t >= 16 * 60 + 40 && t < DAY.nightStart) return clamp((t - (17 * 60 + 55)) / 75, 0, 0.55);
    return 0;
  }

  paintSky(nf) {
    const g = this.skyCanvas.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    const mix = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
    const top = mix([38, 24, 84], [5, 8, 26], nf), mid = mix([148, 62, 128], [16, 20, 48], nf), low = mix([255, 150, 84], [30, 32, 66], nf);
    grad.addColorStop(0, `rgb(${top})`); grad.addColorStop(0.55, `rgb(${mid})`); grad.addColorStop(0.8, `rgb(${low})`); grad.addColorStop(1, `rgb(${low})`);
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    this.skyTex.needsUpdate = true;
  }

  updateLighting(nf) {
    this.hemi.intensity = lerp(0.75, 0.9, nf);
    this.hemi.color.setHSL(0.72, 0.45, lerp(0.62, 0.5, nf));
    this.amb.intensity = lerp(0.26, 0.4, nf);
    const p = this.world.player;
    if (nf < 0.85) { // the sun, low and golden
      this.dirLight.color.set(0xffa64d);
      this.dirLight.intensity = lerp(1.25, 0.1, nf / 0.85);
      this.dirLight.position.set(tx(p.x) - 900, 420 - nf * 300, tz(p.y) - 500);
    } else {         // moonlight takes over — cool and steady
      this.dirLight.color.set(0x9db8ff);
      this.dirLight.intensity = 0.55;
      this.dirLight.position.set(tx(p.x) + 500, 800, tz(p.y) + 300);
    }
    this.dirLight.target.position.set(tx(p.x), 0, tz(p.y));
    for (const m of this.buildingMats) m.emissiveIntensity = lerp(0.25, 1.7, nf);
    this.lampMat.opacity = nf * 0.85;
    this.starsMat.opacity = nf * 0.95;
    this.scene.fog.color.setRGB(lerp(0.16, 0.03, nf), lerp(0.1, 0.04, nf), lerp(0.27, 0.1, nf));
    this.sunSprite.material.opacity = 1 - nf;
    this.moonSprite.material.opacity = nf;
    const sunA = Math.PI * 0.78;
    this.sunSprite.position.set(tx(p.x) + Math.cos(sunA) * 3400, 420 - nf * 380, tz(p.y) + Math.sin(sunA) * 3400);
    this.moonSprite.position.set(tx(p.x) - 2400, 1500, tz(p.y) - 1800);
    this.sky.position.set(tx(p.x), 0, tz(p.y));
  }

  aimPoint(mx, my, w, h) {
    const ndc = new THREE.Vector2((mx / w) * 2 - 1, -(my / h) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    if (Math.abs(d.y) < 1e-5) return null;
    const t = -o.y / d.y;
    if (t < 0) return null;
    return { x: o.x + d.x * t + CX, y: o.z + d.z * t + CZ };
  }

  // ---------------------------------------------------------------- frame
  draw(dt, ui) {
    const world = this.world, p = world.player;
    const nf = this.nightFactor();
    if ((this._skyTick = (this._skyTick || 0) + 1) % 20 === 0 || this._lastNf === undefined) this.paintSky(nf);
    this._lastNf = nf;
    this.updateLighting(nf);
    for (let i = 0; i < this.foam.length; i++) {
      this.foam[i].material.opacity = 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(world.t * 0.9 + i * 1.7));
      this.foam[i].position.x = tx(world.city.waterX + 6 + i * 26 + Math.sin(world.t * 0.5 + i) * 5);
    }
    // camera: third person behind the player (or their car)
    const focus = p.inCar || p;
    const wantYaw = focus.a;
    let dy = wantYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 4.5);
    const speedN = p.inCar ? clamp(Math.abs(p.inCar.speed) / 520, 0, 1) : 0;
    const back = p.inCar ? 400 : 295, height = p.inCar ? 235 : 185;
    const fx = tx(focus.x), fz = tz(focus.y);
    const goal = new THREE.Vector3(fx - Math.cos(this.yaw) * back, height, fz - Math.sin(this.yaw) * back);
    this.camPos.lerp(goal, Math.min(1, dt * 5.5));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(fx + Math.cos(this.yaw) * 90, 26, fz + Math.sin(this.yaw) * 90);
    this.camera.fov = 58 + speedN * 11;
    this.camera.updateProjectionMatrix();
    this.sky.position.set(this.camPos.x, 0, this.camPos.z);

    this.syncEntities(nf);
    this.renderer.render(this.scene, this.camera);
    this.drawHud(ui, nf);
  }

  syncEntities(nf) {
    const world = this.world, p = world.player;
    // cars
    const seen = new Set();
    for (const car of world.cars) {
      if (dist(car.x, car.y, p.x, p.y) > 2400) continue;
      seen.add(car.id);
      let m = this.carMeshes.get(car.id);
      if (!m) { m = this.buildCarMesh(car); this.carMeshes.set(car.id, m); this.scene.add(m); }
      m.position.set(tx(car.x), car.dead ? -3 : 0, tz(car.y));
      m.rotation.y = -car.a;
      m.rotation.z = car.dead ? 0.06 : 0;
      for (const w of m.userData.wheels) w.rotation.z -= car.speed * 0.0022;
      if (m.userData.barL) {
        const phase = Math.floor(world.t * 2.4) % 2 === 0;
        m.userData.barL.material.color.setHex(phase ? 0xff2e4d : 0x57101d);
        m.userData.barR.material.color.setHex(phase ? 0x101d57 : 0x2e7dff);
      }
    }
    for (const [id, m] of this.carMeshes) if (!seen.has(id) && !world.cars.some(c => c.id === id)) { this.scene.remove(m); this.carMeshes.delete(id); }
    // player
    this.playerMesh.visible = !p.inCar;
    if (!p.inCar) {
      this.playerMesh.position.set(tx(p.x), 0, tz(p.y));
      this.playerMesh.rotation.y = -p.a;
      const bob = Math.abs(Math.sin(p.walkPhase)) * 2.2;
      this.playerMesh.userData.legs.position.y = 6.5 + bob * 0.4;
    }
    // peds
    const seenP = new Set();
    for (const ped of world.peds) {
      if (dist(ped.x, ped.y, p.x, p.y) > 2200) continue;
      seenP.add(ped.id);
      let m = this.pedMeshes.get(ped.id);
      if (!m) {
        const colors = { walker: [0xd96c4f, 0x4f79d9, 0x63b06a, 0xc9b458, 0x9a6ad9][ped.id % 5], dealer: 0x8c1f28, officer: 0x24408c };
        m = this.buildPerson(colors[ped.kind] || 0xcccccc, ped.kind === 'officer' ? 0x1a2440 : 0x3a3f4a);
        this.pedMeshes.set(ped.id, m); this.scene.add(m);
      }
      m.position.set(tx(ped.x), ped.dead ? 3 : 0, tz(ped.y));
      m.rotation.y = -ped.a;
      m.rotation.z = ped.dead ? Math.PI / 2 * 0.92 : 0;
    }
    for (const [id, m] of this.pedMeshes) if (!seenP.has(id) && !world.peds.some(q => q.id === id)) { this.scene.remove(m); this.pedMeshes.delete(id); }
    // pickups
    const seenK = new Set();
    for (const pk of world.pickups) {
      if (!pk.active) continue;
      seenK.add(pk);
      let m = this.pickupMeshes.get(pk);
      if (!m) {
        const col = pk.kind === 'package' ? 0xffc94d : pk.kind === 'money' ? 0x06d6a0 : 0xff2e88;
        m = new THREE.Mesh(new THREE.BoxGeometry(20, 14, 20), new THREE.MeshBasicMaterial({ color: col }));
        this.pickupMeshes.set(pk, m); this.scene.add(m);
      }
      m.position.set(tx(pk.x), 16 + Math.sin(world.t * 3 + pk.x) * 3, tz(pk.y));
      m.rotation.y = world.t * 1.6;
    }
    for (const [pk, m] of this.pickupMeshes) if (!seenK.has(pk)) { this.scene.remove(m); this.pickupMeshes.delete(pk); }
    // mission pillar
    const target = world.missionTarget();
    this.pillar.visible = !!target && !world.storyComplete;
    if (target) { this.pillar.position.x = tx(target.x); this.pillar.position.z = tz(target.y); }
    // tracers
    let n = 0;
    for (const tr of world.fx.tracers) {
      if (n >= 160) break;
      this.tracerPos[n * 6] = tx(tr.x1); this.tracerPos[n * 6 + 1] = 26; this.tracerPos[n * 6 + 2] = tz(tr.y1);
      this.tracerPos[n * 6 + 3] = tx(tr.x2); this.tracerPos[n * 6 + 4] = 22; this.tracerPos[n * 6 + 5] = tz(tr.y2);
      n++;
    }
    this.tracerGeo.setDrawRange(0, n * 2);
    this.tracerGeo.attributes.position.needsUpdate = true;
    // muzzle flash when the player just fired
    if (world.events.includes('shot') && !p.inCar) { this.flashT = 0.05; }
    if (this.flashT > 0) {
      this.flashT -= 1 / 60;
      this.flash.material.opacity = 0.85;
      this.flash.position.set(tx(p.x + Math.cos(p.a) * 26), 26, tz(p.y + Math.sin(p.a) * 26));
    } else this.flash.material.opacity = 0;
    // headlight cones for the nearest cars at night
    let ci = 0;
    const sorted = world.cars.filter(c => !c.dead).sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y));
    for (const car of sorted) {
      if (ci >= this.cones.length) break;
      if (dist(car.x, car.y, p.x, p.y) > 800) break;
      const cone = this.cones[ci++];
      cone.visible = nf > 0.25;
      cone.material.opacity = 0.1 * nf;
      cone.position.set(tx(car.x + Math.cos(car.a) * 95), 12, tz(car.y + Math.sin(car.a) * 95));
      cone.rotation.set(0, -car.a, 0);
      cone.rotateX(-Math.PI / 2 + 0.1);
    }
    for (; ci < this.cones.length; ci++) this.cones[ci].visible = false;
  }

  // ---------------------------------------------------------------- HUD
  drawHud(ui, nf) {
    const g = this.hud, W = this.hudCanvas.width, H = this.hudCanvas.height;
    const world = this.world, p = world.player;
    g.clearRect(0, 0, W, H);
    if (ui.screen === 'title') { this.drawTitle(g, W, H, ui); return; }
    // objective banner
    const mission = world.currentMission(), step = world.currentStep();
    if (mission && step && ui.screen === 'play') {
      const target = world.missionTarget();
      const d = target ? Math.round(dist(p.x, p.y, target.x, target.y) / 10) : 0;
      g.textAlign = 'center';
      g.fillStyle = 'rgba(10,8,24,0.55)';
      const label = mission.title + ' — ' + step.label + (target ? '  ·  ' + d + 'm' : '');
      g.font = '600 19px system-ui, sans-serif';
      const tw = g.measureText(label).width + 44;
      roundRect(g, W / 2 - tw / 2, 14, tw, 40, 9); g.fill();
      g.strokeStyle = 'rgba(34,211,238,0.7)'; g.stroke();
      g.fillStyle = '#ffe9a8'; g.fillText(label, W / 2, 41);
      if (target) { // direction arrow relative to the camera
        let rel = Math.atan2(target.y - p.y, target.x - p.x) - this.yaw;
        g.save(); g.translate(W / 2 + tw / 2 + 26, 34); g.rotate(rel + Math.PI / 2);
        g.fillStyle = '#ffc94d'; g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(-7, 8); g.closePath(); g.fill(); g.restore();
      }
    }
    // toasts
    g.textAlign = 'center'; g.font = '600 17px system-ui, sans-serif';
    world.toasts.slice(-3).forEach((t, i) => {
      const a = clamp((t.until - world.t) / 0.6, 0, 1);
      g.fillStyle = `rgba(255,240,200,${a})`;
      g.fillText(t.text, W / 2, 84 + i * 24);
    });
    // money + health
    g.textAlign = 'left';
    g.font = '800 30px system-ui, sans-serif';
    g.shadowColor = '#06d6a0'; g.shadowBlur = 14;
    g.fillStyle = '#a7f3d0'; g.fillText('$' + world.money.toLocaleString('en-US'), 22, 44);
    g.shadowBlur = 0;
    bar(g, 22, 58, 190, 13, p.hp / p.maxHp, '#e33f5e', '#ff7a92');
    if (p.inCar) bar(g, 22, 78, 190, 9, p.inCar.hp / p.inCar.maxHp, '#5b6b82', '#9fb4cc');
    // stars + clock
    const stars = world.stars;
    g.textAlign = 'right'; g.font = '26px system-ui, sans-serif';
    const blink = world.t - world.lastSeenT > 3 && stars > 0 ? (Math.floor(world.t * 2.4) % 2 === 0) : true;
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i < stars ? (blink ? '#ffc94d' : 'rgba(255,201,77,0.35)') : 'rgba(255,255,255,0.22)';
      g.fillText('★', W - 22 - (4 - i) * 30, 42);
    }
    const hh = String(Math.floor(world.timeMinutes / 60) % 24).padStart(2, '0'), mm = String(Math.floor(world.timeMinutes % 60)).padStart(2, '0');
    g.font = '600 17px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText(hh + ':' + mm, W - 22, 68);
    // weapon + speed
    g.font = '700 19px system-ui, sans-serif'; g.fillStyle = '#e0f2fe';
    const wname = { fists: 'Fists', pistol: 'Pistol', smg: 'SMG', shotgun: 'Shotgun' }[world.weapon];
    g.fillText(wname, W - 22, H - 24);
    if (p.inCar) { g.font = '600 16px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillText(Math.round(Math.abs(p.inCar.speed) * 0.62) + ' km/h', W - 22, H - 48); }
    // prompt
    const pr = ui.screen === 'play' ? world.prompt() : null;
    if (pr) {
      g.textAlign = 'center'; g.font = '600 18px system-ui, sans-serif';
      const tw = g.measureText(pr.text).width + 36;
      g.fillStyle = 'rgba(10,8,24,0.6)'; roundRect(g, W / 2 - tw / 2, H - 108, tw, 34, 8); g.fill();
      g.fillStyle = '#fef9c3'; g.fillText(pr.text, W / 2, H - 85);
    }
    // channel + bust meters
    if (world.channel.progress > 0.05) {
      g.textAlign = 'center'; g.font = '700 16px system-ui, sans-serif'; g.fillStyle = '#ffc94d';
      g.fillText('CRACKING…', W / 2, H / 2 - 44);
      bar(g, W / 2 - 110, H / 2 - 34, 220, 12, clamp(world.channel.progress / 3, 0, 1), '#8a6d1f', '#ffc94d');
    }
    if (world.bustMeter > 0.02) {
      g.textAlign = 'center'; g.font = '800 17px system-ui, sans-serif'; g.fillStyle = '#ff5d73';
      g.fillText('BUSTED?', W / 2, H / 2 + 60);
      bar(g, W / 2 - 110, H / 2 + 70, 220, 12, world.bustMeter, '#6e1423', '#ff5d73');
    }
    if (p.hp < 30 && ui.screen === 'play') {
      const a = 0.16 + 0.1 * Math.sin(world.t * 5);
      const grad = g.createRadialGradient(W / 2, H / 2, H * 0.36, W / 2, H / 2, H * 0.75);
      grad.addColorStop(0, 'rgba(180,0,20,0)'); grad.addColorStop(1, `rgba(180,0,20,${a})`);
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
    }
    this.drawMinimap(g, W, H);
    if (ui.ribbon) {
      g.fillStyle = 'rgba(255,201,77,0.92)'; g.fillRect(0, H * 0.3, W, 54);
      g.textAlign = 'center'; g.font = '900 30px system-ui, sans-serif'; g.fillStyle = '#231a04';
      g.fillText('★ STORY COMPLETE ★', W / 2, H * 0.3 + 38);
    }
    if (ui.screen === 'pause') this.drawPause(g, W, H, ui);
    if (ui.screen === 'busted' || ui.screen === 'wasted') this.drawCard(g, W, H, ui);
  }

  drawMinimap(g, W, H) {
    const world = this.world, p = world.player;
    const mw = 204, mh = 154, x0 = 16, y0 = H - mh - 16;
    const mx = (wx) => x0 + (wx / WORLD.w) * mw, my = (wy) => y0 + (wy / WORLD.h) * mh;
    g.fillStyle = 'rgba(8,10,20,0.72)'; roundRect(g, x0, y0, mw, mh, 8); g.fill();
    g.strokeStyle = 'rgba(34,211,238,0.55)'; g.stroke();
    g.save(); g.beginPath(); roundRect(g, x0, y0, mw, mh, 8); g.clip();
    g.fillStyle = '#0d4066'; g.fillRect(mx(world.city.waterX), y0, mw, mh);
    g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 3;
    for (const ax of world.city.avenues) { g.beginPath(); g.moveTo(mx(ax), y0); g.lineTo(mx(ax), y0 + mh); g.stroke(); }
    for (const sy of world.city.streets) { g.beginPath(); g.moveTo(x0, my(sy)); g.lineTo(mx(world.city.sandX), my(sy)); g.stroke(); }
    g.font = '700 9px system-ui, sans-serif'; g.textAlign = 'center';
    const letters = { hotel: 'H', bank: '$', clinic: '+', police: 'P', safehouse: 'S', market: 'M', carlot: 'C', garage: 'G' };
    for (const id in world.city.places) {
      const pl = world.city.places[id];
      g.fillStyle = '#ffd166'; g.fillText(letters[id] || '?', mx(pl.x), my(pl.y) + 3);
    }
    for (const c of world.cars) {
      if (c.kind !== 'cop' || c.dead) continue;
      g.fillStyle = Math.floor(world.t * 2.4) % 2 ? '#ff5d73' : '#4d7dff';
      g.fillRect(mx(c.x) - 2.5, my(c.y) - 2.5, 5, 5);
    }
    const target = world.missionTarget();
    if (target) {
      g.fillStyle = '#ffc94d';
      g.beginPath(); g.arc(mx(target.x), my(target.y), 4 + Math.sin(world.t * 4) * 1.2, 0, Math.PI * 2); g.fill();
    }
    g.translate(mx(p.x), my(p.y)); g.rotate(p.a + Math.PI / 2);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4.4, 5); g.lineTo(-4.4, 5); g.closePath(); g.fill();
    g.restore();
  }

  drawTitle(g, W, H, ui) {
    const grad = g.createLinearGradient(0, H * 0.42, 0, H);
    grad.addColorStop(0, 'rgba(8,4,20,0)'); grad.addColorStop(1, 'rgba(8,4,20,0.88)');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,46,136,0.65)'; g.lineWidth = 3; g.strokeRect(14, 14, W - 28, H - 28);
    g.strokeStyle = 'rgba(34,211,238,0.5)'; g.lineWidth = 1.5; g.strokeRect(22, 22, W - 44, H - 44);
    g.textAlign = 'center';
    g.font = '900 italic 92px system-ui, sans-serif';
    g.shadowColor = '#22d3ee'; g.shadowBlur = 34;
    g.fillStyle = '#ff2e88';
    g.fillText('NEON BAY', W / 2, H * 0.6);
    g.shadowColor = '#ff2e88'; g.shadowBlur = 22;
    g.fillStyle = '#22d3ee'; g.font = '700 21px system-ui, sans-serif';
    g.fillText('a tropical crime story', W / 2, H * 0.6 + 40);
    g.shadowBlur = 0;
    g.font = '600 19px system-ui, sans-serif'; g.fillStyle = '#fef9c3';
    g.fillText('ENTER — Start' + (ui.hasSave ? '      C — Continue' : ''), W / 2, H * 0.6 + 88);
    g.font = '500 15px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText('WASD drive & walk · mouse aim · click shoot · E interact · Shift sprint · 1-4/Q weapons · P pause · M mute', W / 2, H - 44);
  }

  drawPause(g, W, H, ui) {
    const world = this.world, s = world.stats;
    g.fillStyle = 'rgba(5,4,16,0.78)'; g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.font = '900 44px system-ui, sans-serif'; g.fillStyle = '#22d3ee';
    g.fillText('PAUSED', W / 2, H * 0.3);
    g.font = '600 19px system-ui, sans-serif'; g.fillStyle = '#f8fafc';
    const mins = String(Math.floor(s.timePlayed / 60)).padStart(2, '0'), secs = String(Math.floor(s.timePlayed % 60)).padStart(2, '0');
    const lines = [
      'Missions: ' + s.missions + ' / 6' + (world.storyComplete ? ' — STORY COMPLETE' : ''),
      'Cars stolen: ' + s.stolen + '    Shots: ' + s.shots + '    Hits: ' + s.hits,
      'Busted: ' + s.busted + '    Wasted: ' + s.wasted + '    Time played: ' + mins + ':' + secs,
      'Earned: $' + s.earned.toLocaleString('en-US') + (ui.best ? '    Best: $' + ui.best.toLocaleString('en-US') : ''),
    ];
    lines.forEach((l, i) => g.fillText(l, W / 2, H * 0.42 + i * 30));
    g.font = '500 16px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText('P — Resume      S — Save      M — ' + (ui.muted ? 'Unmute' : 'Mute'), W / 2, H * 0.42 + lines.length * 30 + 22);
  }

  drawCard(g, W, H, ui) {
    const busted = ui.screen === 'busted';
    g.fillStyle = busted ? 'rgba(10,16,60,0.82)' : 'rgba(60,6,14,0.82)';
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.font = '900 74px system-ui, sans-serif';
    g.fillStyle = busted ? '#7aa2ff' : '#ff5d73';
    g.shadowColor = g.fillStyle; g.shadowBlur = 26;
    g.fillText(busted ? 'BUSTED' : 'WASTED', W / 2, H * 0.46);
    g.shadowBlur = 0;
    g.font = '600 19px system-ui, sans-serif'; g.fillStyle = '#f8fafc';
    g.fillText(busted ? 'The sergeant books you. The fine stings, the record is clean.' : 'The clinic patches you up and bills you for it.', W / 2, H * 0.46 + 44);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function bar(g, x, y, w, h, frac, bg, fg) {
  g.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(g, x, y, w, h, h / 2); g.fill();
  if (frac > 0.01) { g.fillStyle = fg; roundRect(g, x + 1.5, y + 1.5, (w - 3) * clamp(frac, 0, 1), h - 3, (h - 3) / 2); g.fill(); }
  void bg;
}
