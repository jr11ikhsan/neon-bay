// NEON BAY v2 — the renderer. Three.js draws the simulation's world as a
// low-poly 3D city: ground painted from the city data, extruded buildings
// with lit windows and neon signs, instanced palms and lamps, an animated
// ocean, and a full dusk-to-night light rig whose nights stay bright and
// readable (strong hemisphere + moonlight + emissive neon everywhere).
// A 2D canvas stacked on top draws the HUD, the minimap and every screen.

import * as THREE from '../vendor/three.module.min.js';
import { WORLD, DAY, WEAPONS, PLAYER } from './config.js';
import { AVENUES, STREETS, BOARDWALK, AVENUE_W, STREET_W, BOARDWALK_W } from './city.js';
import { clamp, lerp, hash2 } from './random.js';

const V3 = (x, y) => new THREE.Vector3(x, 0, y);

export function createRender(glCanvas, hudCanvas, world) {
  const city = world.city, W = world.state, player = world.player;
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
  const gl = renderer.getContext();
  let rendererName = '';
  try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); rendererName = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''; } catch { /* noop */ }
  const software = /swiftshader|llvmpipe|software/i.test(rendererName);
  let full = !software;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a2440, 1500, 4200);
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 1, 9000);
  const hud = hudCanvas.getContext('2d');

  // ------------------------------------------------------------ lights
  const hemi = new THREE.HemisphereLight(0xbdd7ff, 0x54483a, 0.9);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xfff2e0, 0.25);
  scene.add(amb);
  const sun = new THREE.DirectionalLight(0xffd9a8, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -560; sun.shadow.camera.right = 560;
  sun.shadow.camera.top = 560; sun.shadow.camera.bottom = -560;
  sun.shadow.camera.far = 2600;
  scene.add(sun); scene.add(sun.target);

  // ------------------------------------------------------------ sky dome
  const skyUni = {
    top: { value: new THREE.Color(0x2c3e70) }, mid: { value: new THREE.Color(0xb83a6e) },
    bot: { value: new THREE.Color(0xff9a3e) }, sunDir: { value: new THREE.Vector3(-1, 0.12, 0) },
    sunCol: { value: new THREE.Color(0xffc46b) },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(6800, 24, 14),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: skyUni,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunCol;
        void main(){ vec3 d = normalize(vP); float h = clamp(d.y, -0.08, 1.0);
          vec3 c = h > 0.24 ? mix(mid, top, smoothstep(0.24, 0.85, h)) : mix(bot, mid, smoothstep(-0.02, 0.24, h));
          float s = pow(max(dot(d, normalize(sunDir)), 0.0), 18.0);
          gl_FragColor = vec4(c + sunCol * s * 0.85, 1.0); }`,
    }),
  );
  scene.add(sky);
  // stars
  const starGeo = new THREE.BufferGeometry();
  {
    const pts = [];
    for (let i = 0; i < 420; i++) {
      const th = hash2(i, 7) * Math.PI * 2, ph = Math.acos(1 - hash2(i, 13) * 0.85);
      pts.push(Math.sin(ph) * Math.cos(th) * 6400, Math.cos(ph) * 6400, Math.sin(ph) * Math.sin(th) * 6400);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }
  const starMat = new THREE.PointsMaterial({ color: 0xcfe0ff, size: 5.5, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ------------------------------------------------------------ ground texture
  function groundTexture() {
    const S = 0.42, cv = document.createElement('canvas');
    cv.width = Math.round(WORLD.w * S); cv.height = Math.round(WORLD.h * S);
    const g = cv.getContext('2d');
    const X = (v) => v * S, Y = (v) => v * S;
    g.fillStyle = '#494d58'; g.fillRect(0, 0, cv.width, cv.height);            // block pavement
    for (const p of city.parks) { g.fillStyle = '#2e5d3a'; g.fillRect(X(p.x), Y(p.y), X(p.w), Y(p.h)); }
    g.fillStyle = '#c8a86b'; g.fillRect(X(WORLD.beachX), 0, X(WORLD.w - WORLD.beachX), cv.height); // sand
    g.fillStyle = '#8a6f45'; g.fillRect(X(BOARDWALK - 90), 0, X(64), cv.height);                    // boardwalk planks
    g.fillStyle = '#33363e';                                                                             // asphalt
    for (const a of AVENUES) g.fillRect(X(a - AVENUE_W / 2), 0, X(AVENUE_W), cv.height);
    for (const s of STREETS) g.fillRect(0, Y(s - STREET_W / 2), X(BOARDWALK + 60), Y(STREET_W));
    g.fillRect(X(BOARDWALK - BOARDWALK_W / 2), 0, X(BOARDWALK_W), cv.height);
    g.strokeStyle = 'rgba(240,240,230,0.5)'; g.lineWidth = 2; g.setLineDash([16, 14]);                    // lane dashes
    for (const a of AVENUES) { g.beginPath(); g.moveTo(X(a), 0); g.lineTo(X(a), cv.height); g.stroke(); }
    for (const s of STREETS) { g.beginPath(); g.moveTo(0, Y(s)); g.lineTo(X(BOARDWALK + 60), Y(s)); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,0.55)';                                                              // crosswalks
    for (const i of city.intersections) for (let k = -2; k <= 2; k++) {
      g.fillRect(X(i.x - 52), Y(i.y + k * 20 - 5), X(16), Y(10));
      g.fillRect(X(i.x + 36), Y(i.y + k * 20 - 5), X(16), Y(10));
    }
    for (const lot of city.lots) {                                                                       // lots + stalls
      g.fillStyle = '#3d4048'; g.fillRect(X(lot.x), Y(lot.y), X(lot.w), Y(lot.h));
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1.6;
      for (const st of lot.stalls) { g.strokeRect(X(st.x - 24), Y(st.y - 13), X(48), Y(26)); }
    }
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(X(WORLD.waterX - 4), 0, X(5), cv.height);          // foam line
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.w, WORLD.h),
    new THREE.MeshPhongMaterial({ map: groundTexture(), shininess: 22, specular: 0x2c3e50 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(WORLD.w / 2, 0, WORLD.h / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  // ocean: animated canvas, plus three breathing foam strips
  const oceanCv = document.createElement('canvas'); oceanCv.width = 256; oceanCv.height = 256;
  {
    const g = oceanCv.getContext('2d');
    g.fillStyle = '#0d4266'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(140,220,255,0.35)'; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const y = hash2(i, 3) * 256, x = hash2(i, 9) * 200;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 28, y - 6, x + 56, y); g.stroke();
    }
  }
  const oceanTex = new THREE.CanvasTexture(oceanCv);
  oceanTex.wrapS = oceanTex.wrapT = THREE.RepeatWrapping; oceanTex.repeat.set(3, 14);
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.w - WORLD.waterX + 700, WORLD.h),
    new THREE.MeshPhongMaterial({ map: oceanTex, shininess: 120, specular: 0x99ccee, transparent: true, opacity: 0.96 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set((WORLD.w + WORLD.waterX + 700) / 2 - 350 + 240, -1.2, WORLD.h / 2);
  ocean.position.x = (WORLD.waterX + WORLD.w + 700) / 2;
  scene.add(ocean);
  const foams = [];
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(9, WORLD.h),
      new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.4, depthWrite: false }));
    f.rotation.x = -Math.PI / 2;
    f.position.set(WORLD.waterX + 4 + i * 17, 0.4, WORLD.h / 2);
    scene.add(f); foams.push(f);
  }

  // ------------------------------------------------------------ buildings
  function buildingTextures(b) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
    const ev = document.createElement('canvas'); ev.width = 128; ev.height = 256;
    const g = cv.getContext('2d'), e = ev.getContext('2d');
    g.fillStyle = b.color; g.fillRect(0, 0, 128, 256);
    e.fillStyle = '#000'; e.fillRect(0, 0, 128, 256);
    const cols = Math.max(3, Math.round(b.w / 42)), rows = Math.max(4, Math.round(b.height / 17));
    for (let cx = 0; cx < cols; cx++) for (let ry = 0; ry < rows; ry++) {
      const x = 8 + cx * ((128 - 16) / cols), y = 26 + ry * ((256 - 40) / rows);
      const lit = hash2(b.seed + cx * 31, ry * 57) > 0.52;
      g.fillStyle = lit ? '#ffd9a0' : '#141c28';
      g.fillRect(x, y, (128 - 16) / cols - 5, (256 - 40) / rows - 6);
      if (lit) { e.fillStyle = '#ffb85e'; e.fillRect(x, y, (128 - 16) / cols - 5, (256 - 40) / rows - 6); }
    }
    if (b.sign) {
      g.fillStyle = b.signColor; g.fillRect(0, 0, 128, 21);
      g.fillStyle = '#0b0e14'; g.font = 'bold 12px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText(b.sign.slice(0, 15), 64, 15);
      e.fillStyle = b.signColor; e.fillRect(0, 0, 128, 21);
      e.fillStyle = '#fff'; e.font = 'bold 12px system-ui, sans-serif'; e.textAlign = 'center';
      e.fillText(b.sign.slice(0, 15), 64, 15);
    }
    const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
    const emis = new THREE.CanvasTexture(ev); emis.colorSpace = THREE.SRGBColorSpace;
    return { map, emis };
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingMats = [];
  for (const b of city.buildings) {
    const { map, emis } = buildingTextures(b);
    const mat = new THREE.MeshLambertMaterial({ map, emissive: 0xffffff, emissiveMap: emis, emissiveIntensity: 0.4 });
    buildingMats.push(mat);
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(b.w, b.height, b.h);
    m.position.set(b.x + b.w / 2, b.height / 2, b.y + b.h / 2);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    if (hash2(b.seed, 1) > 0.55) { // roof clutter: AC unit or water tower
      const prop = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x8b93a1 }));
      const s = 10 + hash2(b.seed, 2) * 12;
      prop.scale.set(s, 7, s);
      prop.position.set(b.x + b.w * (0.25 + hash2(b.seed, 3) * 0.5), b.height + 3.5, b.y + b.h * (0.25 + hash2(b.seed, 4) * 0.5));
      scene.add(prop);
    }
  }

  // ------------------------------------------------------------ palms & lamps (instanced)
  function mergeGeoms(geoms) {
    let vCount = 0, iCount = 0;
    for (const g of geoms) { vCount += g.attributes.position.count; iCount += g.index.count; }
    const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
    const idx = new (vCount > 65535 ? Uint32Array : Uint16Array)(iCount);
    let vo = 0, io = 0;
    for (const g of geoms) {
      pos.set(g.attributes.position.array, vo * 3);
      nor.set(g.attributes.normal.array, vo * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      vo += g.attributes.position.count; io += g.index.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }
  const dummy = new THREE.Object3D();
  const palmTrunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.6, 2.8, 30, 5), new THREE.MeshLambertMaterial({ color: 0x7a5c38 }), city.palms.length);
  const frondGeoms = [];
  for (let i = 0; i < 6; i++) {
    const p = new THREE.PlaneGeometry(30, 7);
    p.translate(13, 0, 0);
    p.rotateX(-0.5 - (i % 3) * 0.16);
    p.rotateY((i / 6) * Math.PI * 2);
    frondGeoms.push(p);
  }
  const palmFrond = new THREE.InstancedMesh(mergeGeoms(frondGeoms), new THREE.MeshLambertMaterial({ color: 0x2f9e4f, side: THREE.DoubleSide }), city.palms.length);
  palmTrunk.castShadow = true;
  city.palms.forEach((p, i) => {
    dummy.position.set(p.x, 15 * p.s, p.y);
    dummy.rotation.set((hash2(i, 1) - 0.5) * 0.16, hash2(i, 2) * 6.28, (hash2(i, 3) - 0.5) * 0.16);
    dummy.scale.setScalar(p.s);
    dummy.updateMatrix();
    palmTrunk.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 30 * p.s;
    dummy.updateMatrix();
    palmFrond.setMatrixAt(i, dummy.matrix);
  });
  scene.add(palmTrunk); scene.add(palmFrond);

  const lampPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.1, 1.4, 34, 5), new THREE.MeshLambertMaterial({ color: 0x39404c }), city.lamps.length);
  city.lamps.forEach((l, i) => {
    dummy.position.set(l.x, 17, l.y); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
    dummy.updateMatrix(); lampPole.setMatrixAt(i, dummy.matrix);
  });
  scene.add(lampPole);
  const lampGlowGeo = new THREE.BufferGeometry();
  lampGlowGeo.setAttribute('position', new THREE.Float32BufferAttribute(city.lamps.flatMap((l) => [l.x, 35, l.y]), 3));
  const lampGlowMat = new THREE.PointsMaterial({ color: 0xffc98a, size: 30, sizeAttenuation: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  scene.add(new THREE.Points(lampGlowGeo, lampGlowMat));

  // traffic lights: instanced poles + a points cloud for the lamps
  const tlPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.3, 30, 5), new THREE.MeshLambertMaterial({ color: 0x22262e }), city.intersections.length);
  city.intersections.forEach((it, i) => {
    dummy.position.set(it.x + 52, 15, it.y + 42); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
    dummy.updateMatrix(); tlPole.setMatrixAt(i, dummy.matrix);
  });
  scene.add(tlPole);
  const tlGeo = new THREE.BufferGeometry();
  tlGeo.setAttribute('position', new THREE.Float32BufferAttribute(city.intersections.flatMap((it) => [it.x + 52, 33, it.y + 42]), 3));
  const tlCols = new Float32Array(city.intersections.length * 3);
  tlGeo.setAttribute('color', new THREE.BufferAttribute(tlCols, 3));
  const tlPoints = new THREE.Points(tlGeo, new THREE.PointsMaterial({ size: 13, vertexColors: true, sizeAttenuation: true }));
  scene.add(tlPoints);

  // ------------------------------------------------------------ shared dynamic bits
  const matCache = new Map();
  const lam = (color) => {
    if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
    return matCache.get(color);
  };
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const sphGeo = new THREE.SphereGeometry(1, 10, 8);

  function makeCarMesh(car) {
    const g = new THREE.Group();
    const sporty = car.type === 'sport' || car.type === 'coupe' || car.type === 'racer';
    const body = new THREE.Mesh(boxGeo, lam(car.color));
    body.scale.set(54, sporty ? 11 : 13, 27);
    body.position.y = 10;
    body.castShadow = true;
    g.add(body);
    const cabin = new THREE.Mesh(boxGeo, lam(car.type === 'police' ? '#20304a' : '#18222e'));
    if (car.type === 'van') { cabin.scale.set(40, 13, 25); cabin.position.set(-2, 19, 0); }
    else if (car.type === 'pickup') { cabin.scale.set(20, 11, 24); cabin.position.set(8, 19, 0); }
    else { cabin.scale.set(27, 10, 24); cabin.position.set(-3, sporty ? 18 : 19, 0); }
    g.add(cabin);
    if (sporty) { const sp = new THREE.Mesh(boxGeo, lam('#14181f')); sp.scale.set(5, 3, 26); sp.position.set(-27, 17, 0); g.add(sp); }
    if (car.type === 'taxi') { const sign = new THREE.Mesh(boxGeo, lam('#ffe98a')); sign.scale.set(10, 4, 8); sign.position.set(-3, 26, 0); g.add(sign); }
    if (car.type === 'police') {
      const bar = new THREE.Group();
      const r = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xff2244 })); r.scale.set(7, 4, 9); r.position.set(0, 0, -6);
      const b = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x2266ff })); b.scale.set(7, 4, 9); b.position.set(0, 0, 6);
      bar.add(r); bar.add(b); bar.position.set(-3, 27, 0);
      g.add(bar); g.userData.bar = bar;
    }
    const wheelGeo = new THREE.CylinderGeometry(6.4, 6.4, 4.5, 10);
    const wheels = [];
    for (const [wx, wz] of [[17, 14], [17, -14], [-17, 14], [-17, -14]]) {
      const w = new THREE.Mesh(wheelGeo, lam('#0c0e11'));
      w.rotation.x = Math.PI / 2; w.position.set(wx, 6.4, wz);
      g.add(w); wheels.push(w);
    }
    g.userData.wheels = wheels;
    const hl = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
    hl.scale.set(1.6, 3, 20); hl.position.set(27.5, 10, 0); g.add(hl);
    const tl = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xff3344 }));
    tl.scale.set(1.6, 3, 20); tl.position.set(-27.5, 10, 0); g.add(tl);
    scene.add(g);
    return g;
  }
  function makeCharMesh(p) {
    const g = new THREE.Group();
    const colors = { player: 0x14b8a6, police: 0x2b4c9b, dealer: 0xa3273a };
    const pedCols = [0xc9574f, 0x4f79c9, 0x5fbf77, 0xc9a44f, 0x9a6bd8, 0xd87fb0, 0x6bd8c9, 0xd8d8d8, 0x8a6b4f, 0x3a6bd8];
    const body = new THREE.Mesh(cylGeo, lam(colors[p.kind] ?? pedCols[p.hue % pedCols.length]));
    body.scale.set(6.4, 17, 6.4); body.position.y = 12; body.castShadow = true;
    const head = new THREE.Mesh(sphGeo, lam(0xe8b98d));
    head.scale.setScalar(5); head.position.y = 24.5;
    g.add(body); g.add(head);
    scene.add(g);
    return g;
  }

  // ------------------------------------------------------------ pickups, pillar, fx
  const pickupMeshes = new Map();
  const pickupGeo = new THREE.BoxGeometry(15, 15, 15);
  const pickupMats = {
    cash: new THREE.MeshBasicMaterial({ color: 0x2eff7a }),
    snack: new THREE.MeshBasicMaterial({ color: 0xff9a3e }),
    package: new THREE.MeshBasicMaterial({ color: 0xd8a04a }),
  };
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(30, 30, 320, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
  );
  pillar.visible = false;
  scene.add(pillar);

  const MAXP = 512;
  const hotGeo = new THREE.BufferGeometry();
  const hotPos = new Float32Array(MAXP * 3), hotCol = new Float32Array(MAXP * 3);
  hotGeo.setAttribute('position', new THREE.BufferAttribute(hotPos, 3));
  hotGeo.setAttribute('color', new THREE.BufferAttribute(hotCol, 3));
  const hotPts = new THREE.Points(hotGeo, new THREE.PointsMaterial({ size: 8, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  hotPts.frustumCulled = false;
  scene.add(hotPts);
  const smokeGeo = new THREE.BufferGeometry();
  const smokePos = new Float32Array(256 * 3);
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
  const smokePts = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ color: 0x9aa0ab, size: 17, transparent: true, opacity: 0.32, depthWrite: false }));
  smokePts.frustumCulled = false;
  scene.add(smokePts);
  const MAXT = 72;
  const trGeo = new THREE.BufferGeometry();
  const trPos = new Float32Array(MAXT * 6), trCol = new Float32Array(MAXT * 6);
  trGeo.setAttribute('position', new THREE.BufferAttribute(trPos, 3));
  trGeo.setAttribute('color', new THREE.BufferAttribute(trCol, 3));
  const tracers = new THREE.LineSegments(trGeo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  tracers.frustumCulled = false;
  scene.add(tracers);

  // sun sprite + birds
  const sunCv = document.createElement('canvas'); sunCv.width = sunCv.height = 128;
  {
    const g = sunCv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,214,140,1)'); gr.addColorStop(0.35, 'rgba(255,150,70,0.55)'); gr.addColorStop(1, 'rgba(255,120,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sunCv), transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
  sunSpr.scale.setScalar(1500);
  scene.add(sunSpr);
  const birds = [];
  {
    const bg = new THREE.PlaneGeometry(15, 3.4);
    const bm = new THREE.MeshBasicMaterial({ color: 0x1c2230, side: THREE.DoubleSide });
    for (let i = 0; i < 12; i++) {
      const b = new THREE.Group();
      const wl = new THREE.Mesh(bg, bm); wl.position.x = -7;
      const wr = new THREE.Mesh(bg, bm); wr.position.x = 7;
      const pivotL = new THREE.Group(); pivotL.add(wl);
      const pivotR = new THREE.Group(); pivotR.add(wr);
      b.add(pivotL); b.add(pivotR);
      b.userData = { pivotL, pivotR, ph: i * 1.7, r: 230 + i * 17, h: 120 + (i % 4) * 22, sp: 0.14 + (i % 3) * 0.02 };
      scene.add(b); birds.push(b);
    }
  }

  // ------------------------------------------------------------ entity meshes
  const carMeshes = new Map(), pedMeshes = new Map(), offMeshes = new Map();
  const playerMesh = makeCharMesh({ kind: 'player', hue: 0 });
  function syncMap(map, items, make) {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      if (!map.has(it.id)) map.set(it.id, make(it));
    }
    for (const [id, mesh] of map) if (!seen.has(id)) { scene.remove(mesh); map.delete(id); }
  }
  function syncEntities() {
    syncMap(carMeshes, W.cars, makeCarMesh);
    for (const c of W.cars) {
      const m = carMeshes.get(c.id);
      m.position.set(c.x, 0, c.y);
      m.rotation.y = -c.a;
      if (c.wrecked) m.rotation.z = 0.05;
      if (m.userData.bar) {
        const ph = Math.floor(c.light) % 2;
        m.userData.bar.children[0].visible = ph === 0;
        m.userData.bar.children[1].visible = ph === 1;
      }
    }
    syncMap(pedMeshes, W.peds, makeCharMesh);
    for (const p of W.peds) {
      const m = pedMeshes.get(p.id);
      m.position.set(p.x, p.down ? 3 : 0, p.y);
      m.rotation.set(0, -p.a, p.down ? Math.PI / 2 : 0);
    }
    syncMap(offMeshes, W.officers, (o) => makeCharMesh({ kind: 'police', hue: 1 }));
    for (const o of W.officers) {
      const m = offMeshes.get(o.id);
      m.position.set(o.x, 0, o.y);
      m.rotation.y = -o.a;
    }
    playerMesh.visible = !player.car;
    playerMesh.position.set(player.x, 0, player.y);
    playerMesh.rotation.y = -player.a;
    syncMap(pickupMeshes, W.pickups, (pk) => {
      const m = new THREE.Mesh(pickupGeo, pickupMats[pk.kind]);
      scene.add(m); return m;
    });
    for (const pk of W.pickups) {
      const m = pickupMeshes.get(pk.id);
      m.position.set(pk.x, 15 + Math.sin(W.time * 3 + pk.id) * 4, pk.y);
      m.rotation.y = W.time * 2 + pk.id;
    }
  }

  // ------------------------------------------------------------ day / night
  const C = (h) => new THREE.Color(h);
  const SKY = {
    day: [C(0x2f6fd0), C(0x9fc8ee), C(0xd8ecff)], dusk: [C(0x3b2d63), C(0xc23a72), C(0xff9a3e)], night: [C(0x0a1130), C(0x1c2a52), C(0x2a3a66)],
  };
  function darkFactor(m) {
    if (m < 300) return 1;
    if (m < 390) return lerp(1, 0.25, (m - 300) / 90);
    if (m < 1020) return 0;
    if (m < 1110) return lerp(0, 0.55, (m - 1020) / 90);
    if (m < 1170) return lerp(0.55, 1, (m - 1110) / 60);
    return 1;
  }
  function duskFactor(m) {
    if (m < 990 || m > 1185) return 0;
    return m < 1095 ? (m - 990) / 105 : 1 - (m - 1095) / 90;
  }
  const tmpC = new THREE.Color();
  function mix3(dst, key, dark, dusk) {
    dst.copy(SKY.day[key]).lerp(SKY.night[key], dark).lerp(SKY.dusk[key], dusk * 0.75);
  }
  function updateSkyAndLights() {
    const m = W.minutes, dark = darkFactor(m), dusk = duskFactor(m);
    mix3(skyUni.top.value, 0, dark, dusk);
    mix3(skyUni.mid.value, 1, dark, dusk);
    mix3(skyUni.bot.value, 2, dark, dusk);
    tmpC.copy(skyUni.mid.value).lerp(skyUni.bot.value, 0.5);
    scene.fog.color.copy(tmpC);
    scene.fog.near = lerp(1900, 1250, dark); scene.fog.far = lerp(4600, 3700, dark);
    hemi.intensity = lerp(0.95, 0.82, dark);            // v2: nights stay lit
    hemi.color.copy(skyUni.top.value).lerp(C(0xffffff), 0.4);
    amb.intensity = lerp(0.25, 0.36, dark);
    const daySpan = (m - 360) / 795;                    // 06:00 -> 18:45 sun arc
    const el = Math.sin(clamp(daySpan, 0, 1) * Math.PI);
    const az = Math.PI * clamp(daySpan, 0, 1);
    const px = player.x, py = player.y;
    if (m > 350 && m < 1140) {
      sun.color.copy(C(0xfff3d0)).lerp(C(0xff9448), dusk);
      sun.intensity = 0.25 + el * 1.45;
      sun.position.set(px + Math.cos(az) * 900, 140 + el * 950, py + 320);
      skyUni.sunDir.value.set(-Math.cos(az), Math.max(el, 0.03), 0.3).normalize();
    } else {
      sun.color.set(0x9db8ff);                          // moonlight
      sun.intensity = 0.55;
      sun.position.set(px + 480, 900, py - 380);
      skyUni.sunDir.value.set(0.4, 0.6, -0.3).normalize();
    }
    sun.target.position.set(px, 0, py);
    sun.castShadow = full;
    for (const mat of buildingMats) mat.emissiveIntensity = lerp(0.22, 1.8, dark);
    lampGlowMat.opacity = dark * 0.8;
    starMat.opacity = clamp((dark - 0.5) * 2.4, 0, 1);
    sunSpr.material.opacity = dusk * 0.95;
    sunSpr.position.set(camera.position.x - 5600, 420, camera.position.z + 1500);
    oceanTex.offset.x = Math.sin(W.time * 0.11) * 0.03 + W.time * 0.0022;
    oceanTex.offset.y = Math.cos(W.time * 0.07) * 0.02;
    foams.forEach((f, i) => {
      f.material.opacity = 0.22 + 0.2 * (0.5 + 0.5 * Math.sin(W.time * 0.9 + i * 2.1));
      f.position.x = WORLD.waterX + 4 + i * 17 + Math.sin(W.time * 0.5 + i) * 3;
    });
    // traffic lights: two-phase cycle
    const phase = Math.floor(W.time / 7) % 2, amber = (W.time % 7) > 6.1;
    for (let i = 0; i < city.intersections.length; i++) {
      const green = (i % 2 === 0) === (phase === 0);
      const c = amber ? [1, 0.66, 0.08] : green ? [0.15, 1, 0.3] : [1, 0.14, 0.14];
      tlCols[i * 3] = c[0]; tlCols[i * 3 + 1] = c[1]; tlCols[i * 3 + 2] = c[2];
    }
    tlGeo.attributes.color.needsUpdate = true;
    return dark;
  }

  // ------------------------------------------------------------ camera
  let camYaw = -Math.PI / 2, camFov = 55;
  const camPos = new THREE.Vector3(3600, 300, 3600);
  function updateCamera(dt, screen) {
    if (screen === 'title') {
      const t = W.time * 0.045;
      camPos.set(3860 + Math.cos(t) * 720, 300, 1560 + Math.sin(t) * 720);
      camera.position.lerp(camPos, 1 - Math.exp(-2.4 * dt));
      camera.lookAt(3560, 10, 1560);
      if (camFov !== 55) { camFov = 55; camera.fov = 55; camera.updateProjectionMatrix(); }
      return;
    }
    const anchor = player, targetYaw = anchor.a;
    let d = angLerpDelta(camYaw, targetYaw);
    camYaw += d * (1 - Math.exp(-3.4 * dt));
    const inCar = !!player.car;
    const dist = inCar ? 335 : 218, height = inCar ? 188 : 132;
    const lead = inCar ? clamp(player.car.speed * 0.34, -60, 130) : 26;
    camPos.set(
      anchor.x - Math.cos(camYaw) * dist,
      height,
      anchor.y - Math.sin(camYaw) * dist,
    );
    camera.position.lerp(camPos, 1 - Math.exp(-7 * dt));
    if (W.camShake > 0.2) {
      camera.position.x += (Math.random() - 0.5) * W.camShake;
      camera.position.y += (Math.random() - 0.5) * W.camShake * 0.6;
    }
    camera.lookAt(anchor.x + Math.cos(camYaw) * lead, 22, anchor.y + Math.sin(camYaw) * lead);
    const targetFov = 55 + (inCar ? clamp(Math.abs(player.car.speed) / 660, 0, 1) * 14 : 0);
    if (Math.abs(targetFov - camFov) > 0.15) {
      camFov = lerp(camFov, targetFov, 1 - Math.exp(-3 * dt));
      camera.fov = camFov; camera.updateProjectionMatrix();
    }
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
  }
  function angLerpDelta(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // ------------------------------------------------------------ fx sync
  function syncFx() {
    let hp = 0, sp = 0, tp = 0;
    for (const f of W.fx) {
      const fr = clamp(f.ttl / (f.max || 0.6), 0, 1);
      if (f.kind === 'tracer') {
        if (tp < MAXT) {
          trPos.set([f.x1, 22, f.y1, f.x2, 22, f.y2], tp * 6);
          const b = fr * 0.9;
          trCol.set([b, b * 0.8, b * 0.35, b * 0.4, b * 0.3, b * 0.1], tp * 6);
          tp++;
        }
      } else if (f.kind === 'smoke') {
        if (sp < 256) { smokePos.set([f.x, 12 + (f.max - f.ttl) * 46, f.y], sp * 3); sp++; }
      } else if (hp < MAXP) {
        const col = f.kind === 'fire' ? [1, 0.32 + fr * 0.3, 0.06] : f.kind === 'flash' ? [1, 0.95, 0.6] : [1, 0.62, 0.18];
        hotPos.set([f.x, f.kind === 'flash' ? 22 : 15, f.y], hp * 3);
        hotCol.set([col[0] * fr, col[1] * fr, col[2] * fr], hp * 3);
        hp++;
      }
    }
    hotGeo.setDrawRange(0, hp);
    smokeGeo.setDrawRange(0, sp);
    trGeo.setDrawRange(0, tp * 2);
    hotGeo.attributes.position.needsUpdate = true;
    hotGeo.attributes.color.needsUpdate = true;
    smokeGeo.attributes.position.needsUpdate = true;
    trGeo.attributes.position.needsUpdate = true;
    trGeo.attributes.color.needsUpdate = true;
  }
  function syncBirdsAndPalms() {
    for (const b of birds) {
      const u = b.userData, t = W.time * u.sp + u.ph;
      b.position.set(4380 + Math.cos(t) * u.r, u.h + Math.sin(W.time * 0.7 + u.ph) * 9, 1560 + Math.sin(t) * u.r);
      b.rotation.y = -t - Math.PI / 2 + Math.PI;
      const flap = Math.sin(W.time * 9 + u.ph * 3) * 0.65;
      u.pivotL.rotation.z = flap; u.pivotR.rotation.z = -flap;
    }
    // palm sway near the camera
    const cx = camera.position.x, cz = camera.position.z;
    city.palms.forEach((p, i) => {
      const dx = p.x - cx, dz = p.y - cz;
      if (dx * dx + dz * dz > 560 * 560) return;
      dummy.position.set(p.x, 30 * p.s, p.y);
      dummy.rotation.set((hash2(i, 1) - 0.5) * 0.16 + Math.sin(W.time * 1.3 + i * 1.3) * 0.045, hash2(i, 2) * 6.28, (hash2(i, 3) - 0.5) * 0.16);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      palmFrond.setMatrixAt(i, dummy.matrix);
    });
    palmFrond.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ HUD
  function rr(x, y, w, h, r) {
    hud.beginPath();
    hud.roundRect(x, y, w, h, r);
  }
  function panel(x, y, w, h) {
    rr(x, y, w, h, 10);
    hud.fillStyle = 'rgba(8,12,22,0.66)'; hud.fill();
    hud.strokeStyle = 'rgba(0,229,255,0.5)'; hud.lineWidth = 1.4; hud.stroke();
  }
  function bar(x, y, w, h, frac, color) {
    hud.fillStyle = 'rgba(255,255,255,0.14)'; hud.fillRect(x, y, w, h);
    hud.fillStyle = color; hud.fillRect(x, y, w * clamp(frac, 0, 1), h);
  }
  function txt(s, x, y, size, color, align = 'left', weight = 700) {
    hud.font = `${weight} ${size}px system-ui, sans-serif`;
    hud.textAlign = align; hud.fillStyle = color;
    hud.fillText(s, x, y);
  }
  function clockStr() {
    const m = Math.floor(W.minutes);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  function drawMinimap(w, h) {
    const mw = 216, mh = 162, x0 = w - mw - 16, y0 = h - mh - 16, s = mw / WORLD.w;
    panel(x0 - 6, y0 - 6, mw + 12, mh + 12);
    hud.save();
    hud.beginPath(); hud.rect(x0, y0, mw, mh); hud.clip();
    hud.fillStyle = '#131a2a'; hud.fillRect(x0, y0, mw, mh);
    hud.fillStyle = '#0d4266'; hud.fillRect(x0 + WORLD.waterX * s, y0, (WORLD.w - WORLD.waterX) * s, mh);
    hud.fillStyle = '#c8a86b'; hud.fillRect(x0 + WORLD.beachX * s, y0, (WORLD.waterX - WORLD.beachX) * s, mh);
    hud.strokeStyle = '#79808e'; hud.lineWidth = AVENUE_W * s;
    for (const a of AVENUES) { hud.beginPath(); hud.moveTo(x0 + a * s, y0); hud.lineTo(x0 + a * s, y0 + mh); hud.stroke(); }
    hud.lineWidth = STREET_W * s;
    for (const st of STREETS) { hud.beginPath(); hud.moveTo(x0, y0 + st * s); hud.lineTo(x0 + (BOARDWALK + 60) * s, y0 + st * s); hud.stroke(); }
    hud.fillStyle = '#39415a';
    for (const b of city.buildings) hud.fillRect(x0 + b.x * s, y0 + b.y * s, Math.max(1.6, b.w * s), Math.max(1.6, b.h * s));
    hud.font = '700 9px system-ui'; hud.textAlign = 'center';
    for (const p of city.placeList) {
      hud.fillStyle = '#0b0e14'; hud.fillRect(x0 + p.bx * s - 5, y0 + p.by * s - 5, 10, 10);
      hud.fillStyle = '#3effc8'; hud.fillText(p.icon, x0 + p.bx * s, y0 + p.by * s + 3);
    }
    const dot = (x, y, color, r = 3) => { hud.fillStyle = color; hud.beginPath(); hud.arc(x0 + x * s, y0 + y * s, r, 0, 6.29); hud.fill(); };
    for (const c of W.cars) {
      if (c.kind === 'police') dot(c.x, c.y, Math.floor(W.time * 3) % 2 ? '#3e8bff' : '#bcd8ff', 2.6);
      else if (c.kind === 'coupe' || c.kind === 'job') dot(c.x, c.y, '#ffd23e', 3);
      else if (c.kind === 'owned') dot(c.x, c.y, '#3effc8', 2.6);
    }
    const obj = world.objective();
    if (obj && obj.x != null) {
      const pulse = 4.5 + Math.sin(W.time * 5) * 1.6;
      hud.strokeStyle = '#ffd23e'; hud.lineWidth = 1.8;
      hud.beginPath(); hud.arc(x0 + obj.x * s, y0 + obj.y * s, pulse, 0, 6.29); hud.stroke();
      dot(obj.x, obj.y, '#ffd23e', 2.6);
    }
    // player arrow
    hud.save();
    hud.translate(x0 + player.x * s, y0 + player.y * s);
    hud.rotate(player.a);
    hud.fillStyle = '#fff';
    hud.beginPath(); hud.moveTo(6, 0); hud.lineTo(-4, -4); hud.lineTo(-4, 4); hud.closePath(); hud.fill();
    hud.restore();
    hud.restore();
  }
  function drawGameHUD(w, h) {
    // top-left status panel
    panel(14, 14, 218, 86);
    hud.save();
    hud.shadowColor = '#00e5ff'; hud.shadowBlur = 9;
    txt(`$${W.money.toLocaleString()}`, 28, 44, 25, '#7dffce');
    hud.restore();
    bar(28, 54, 150, 9, player.hp / PLAYER.hp, player.hp > 30 ? '#3eff7a' : '#ff4f4f');
    txt('HP', 186, 63, 10, '#cfe3ff');
    if (W.bustedMeter > 0.02) { bar(28, 68, 150, 7, W.bustedMeter, '#ff9a3e'); txt('BUSTED', 186, 75, 9, '#ffb27a'); }
    txt(`${clockStr()} · Day ${W.day}`, 28, 92, 12, '#cfe3ff', 'left', 600);
    // top-right: stars + weapon/speed
    const st = world.stars();
    hud.font = '700 24px system-ui'; hud.textAlign = 'right';
    for (let i = 0; i < 5; i++) {
      const on = i < st;
      const blink = on && W.unseenFor > 4 && Math.floor(W.time * 2.4) % 2 === 0;
      hud.fillStyle = on ? (blink ? 'rgba(255,210,62,0.35)' : '#ffd23e') : 'rgba(255,255,255,0.2)';
      hud.fillText('★', w - 26 - (4 - i) * 27, 42);
    }
    if (player.car) {
      txt(`${Math.round(Math.abs(player.car.speed) * 0.36)} km/h`, w - 26, 70, 15, '#fff', 'right');
      bar(w - 176, 78, 150, 7, player.car.hp / player.car.maxHp, '#7ac9ff');
      txt('CAR', w - 26, 86, 9, '#cfe3ff', 'right');
    } else {
      txt(WEAPONS[player.weapon].name.toUpperCase(), w - 26, 70, 15, '#fff', 'right');
      txt(player.weapons.length > 1 ? '1-4 / Q-ready' : '', w - 26, 88, 10, '#9fb6d8', 'right');
    }
    // objective banner
    const obj = world.objective();
    if (obj) {
      const label = `Mission ${obj.n} · ${obj.mission}`;
      hud.font = '700 13px system-ui';
      const tw = Math.max(hud.measureText(label).width, hud.measureText(obj.label).width) + 42;
      panel(w / 2 - tw / 2, 14, tw, obj.sub ? 62 : 46);
      txt(label, w / 2, 33, 12, '#ffd23e', 'center');
      txt(obj.label, w / 2, 52, 13.5, '#fff', 'center');
      if (obj.sub) txt(obj.sub, w / 2, 68, 11, '#9fe8ff', 'center');
      if (obj.x != null) {
        const d = Math.round(Math.hypot(obj.x - player.x, obj.y - player.y));
        const rel = Math.atan2(obj.y - player.y, obj.x - player.x) - camYaw;
        hud.save();
        hud.translate(w / 2 + tw / 2 - 15, 30); hud.rotate(rel + Math.PI / 2);
        hud.fillStyle = '#ffd23e';
        hud.beginPath(); hud.moveTo(0, -7); hud.lineTo(5, 5); hud.lineTo(-5, 5); hud.closePath(); hud.fill();
        hud.restore();
        txt(`${d}m`, w / 2 + tw / 2 - 15, 58, 10, '#ffd23e', 'center');
      }
    }
    // big centre banner (mission complete etc.)
    if (W.banner) {
      const a = clamp(W.banner.t / 0.6, 0, 1);
      hud.save(); hud.globalAlpha = Math.min(1, a);
      hud.shadowColor = '#ff2e88'; hud.shadowBlur = 22;
      txt(W.banner.title, w / 2, h * 0.3, 34, '#fff', 'center', 800);
      hud.shadowBlur = 0;
      txt(W.banner.sub, w / 2, h * 0.3 + 28, 14.5, '#ffe9a8', 'center', 600);
      hud.restore();
    }
    // channel progress
    const chanFrac = W.stepProg > 0 ? clamp(W.stepProg / 4, 0, 1) : (W.bankProg > 0 ? clamp(W.bankProg / 3, 0, 1) : 0);
    if (chanFrac > 0) {
      panel(w / 2 - 130, h - 150, 260, 34);
      txt('CRACKING THE VAULT…', w / 2, h - 136, 11, '#ffd23e', 'center');
      bar(w / 2 - 110, h - 128, 220, 7, chanFrac, '#ffd23e');
    }
    // toasts
    let ty = h - 190;
    for (let i = W.toasts.length - 1; i >= 0; i--) {
      const t = W.toasts[i];
      hud.font = '600 13px system-ui';
      const twd = hud.measureText(t.text).width + 24;
      rr(16, ty - 17, twd, 25, 7);
      hud.fillStyle = 'rgba(8,12,22,0.72)'; hud.fill();
      txt(t.text, 28, ty, 13, '#ffe9a8');
      ty -= 31;
    }
    // interaction prompt
    const pr = world.prompt();
    if (pr) {
      hud.font = '700 14px system-ui';
      const twd = hud.measureText(pr).width + 34;
      rr(w / 2 - twd / 2, h - 108, twd, 32, 16);
      hud.fillStyle = 'rgba(8,12,22,0.8)'; hud.fill();
      hud.strokeStyle = '#ffd23e'; hud.lineWidth = 1.4; hud.stroke();
      txt(pr, w / 2, h - 86, 14, '#fff', 'center');
    }
    drawMinimap(w, h);
  }
  function drawTitle(w, h, ui) {
    const grad = hud.createLinearGradient(0, h * 0.45, 0, h);
    grad.addColorStop(0, 'rgba(5,6,16,0)'); grad.addColorStop(1, 'rgba(5,6,16,0.88)');
    hud.fillStyle = grad; hud.fillRect(0, 0, w, h);
    // retro striped sun
    const sx = w / 2, sy = h * 0.3, sr = 92;
    hud.save();
    hud.beginPath(); hud.arc(sx, sy, sr, 0, 6.29); hud.clip();
    const sg = hud.createLinearGradient(0, sy - sr, 0, sy + sr);
    sg.addColorStop(0, '#ffd23e'); sg.addColorStop(0.55, '#ff7a3e'); sg.addColorStop(1, '#ff2e88');
    hud.fillStyle = sg; hud.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    hud.fillStyle = 'rgba(10,8,24,0.85)';
    for (let i = 0; i < 5; i++) hud.fillRect(sx - sr, sy + 8 + i * 17, sr * 2, 3 + i * 1.6);
    hud.restore();
    hud.save();
    hud.shadowColor = '#ff2e88'; hud.shadowBlur = 30;
    hud.font = '800 74px system-ui'; hud.textAlign = 'center';
    hud.fillStyle = '#fff';
    hud.fillText('NEON BAY', sx, sy + sr + 78);
    hud.restore();
    hud.save();
    hud.shadowColor = '#00e5ff'; hud.shadowBlur = 12;
    txt('A NEON CRIME STORY ON A TROPICAL SHORE', sx, sy + sr + 106, 15, '#aef3ff', 'center', 700);
    hud.restore();
    txt('ENTER / CLICK — hit the streets', sx, h - 118, 17, '#fff', 'center', 800);
    if (ui.canContinue) txt('C — continue your story', sx, h - 92, 14.5, '#7dffce', 'center', 700);
    txt('WASD drive & walk · mouse aim · click punch / shoot · E enter cars & use places · 1-4 weapons · SHIFT run · P pause', sx, h - 58, 12.5, '#c9d6ee', 'center', 600);
    txt('Six missions. Three guns. One bay. Every place in the city is open for business.', sx, h - 36, 12.5, '#8fa5c9', 'center', 600);
  }
  function drawPause(w, h) {
    hud.fillStyle = 'rgba(4,6,14,0.72)'; hud.fillRect(0, 0, w, h);
    panel(w / 2 - 250, h / 2 - 168, 500, 336);
    txt('PAUSED', w / 2, h / 2 - 122, 30, '#fff', 'center', 800);
    const s = W.stats, mm = String(Math.floor(s.timePlayed / 60)).padStart(2, '0'), ss = String(Math.floor(s.timePlayed % 60)).padStart(2, '0');
    const rows = [
      ['Missions complete', `${s.missions} / 6`],
      ['Money', `$${W.money.toLocaleString()}`],
      ['Best money held', `$${Math.max(W.best, W.money).toLocaleString()}`],
      ['Cars stolen', `${s.stolen}`],
      ['Shots fired', `${s.shots}`],
      ['Time in the bay', `${mm}:${ss}`],
    ];
    rows.forEach((r, i) => {
      txt(r[0], w / 2 - 210, h / 2 - 76 + i * 27, 14.5, '#9fb6d8', 'left', 600);
      txt(r[1], w / 2 + 210, h / 2 - 76 + i * 27, 14.5, '#fff', 'right', 700);
    });
    txt('P — resume · S — save · R — restart story · M — mute', w / 2, h / 2 + 108, 13.5, '#7dffce', 'center', 700);
    txt('Weapons: pistol is earned, SMG & shotgun are sold at Market Sol.', w / 2, h / 2 + 134, 12, '#8fa5c9', 'center', 600);
  }
  function drawCard(w, h, kind) {
    hud.fillStyle = kind === 'busted' ? 'rgba(20,30,80,0.55)' : 'rgba(80,10,16,0.55)';
    hud.fillRect(0, 0, w, h);
    hud.save();
    hud.shadowColor = kind === 'busted' ? '#3e8bff' : '#ff2e4d'; hud.shadowBlur = 26;
    txt(kind === 'busted' ? 'BUSTED' : 'WASTED', w / 2, h / 2 - 8, 56, '#fff', 'center', 800);
    hud.restore();
    const fine = W.eventFine;
    txt(fine ? `Fine: $${fine}` : '', w / 2, h / 2 + 30, 16, '#ffe9a8', 'center', 700);
  }

  // ------------------------------------------------------------ public API
  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    hudCanvas.width = w; hudCanvas.height = h;
  }
  function setQuality(q) {
    full = !!q;
    renderer.setPixelRatio(full ? Math.min(window.devicePixelRatio || 1, 1.75) : 0.55);
    renderer.shadowMap.enabled = full;
    sun.castShadow = full;
  }
  setQuality(full);
  resize(hudCanvas.clientWidth || 1280, hudCanvas.clientHeight || 720);

  const ray = new THREE.Raycaster();
  function aimAngle(mx, my) {
    const r = glCanvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((mx) / r.width) * 2 - 1, -((my) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (Math.abs(d.y) < 1e-5) return null;
    const t = -o.y / d.y;
    if (t < 0) return null;
    const gx = o.x + d.x * t, gz = o.z + d.z * t;
    return Math.atan2(gz - player.y, gx - player.x);
  }

  let lastHp = player.hp;
  function frame(dt, ui) {
    const dark = updateSkyAndLights();
    updateCamera(dt, ui.screen);
    syncEntities();
    syncFx();
    syncBirdsAndPalms();
    // mission pillar
    const obj = ui.screen === 'play' || ui.screen === 'pause' ? world.objective() : null;
    if (obj && obj.x != null && !player.car) {
      pillar.visible = true;
      pillar.position.set(obj.x, 160, obj.y);
      pillar.material.opacity = 0.22 + 0.12 * Math.sin(W.time * 4);
    } else if (obj && obj.x != null) {
      pillar.visible = true;
      pillar.position.set(obj.x, 160, obj.y);
      pillar.material.opacity = 0.22 + 0.12 * Math.sin(W.time * 4);
    } else pillar.visible = false;
    renderer.render(scene, camera);
    // HUD
    const w = hudCanvas.width, h = hudCanvas.height;
    hud.clearRect(0, 0, w, h);
    if (player.hp < lastHp) { // damage flash
      hud.fillStyle = `rgba(255,30,50,${clamp((lastHp - player.hp) / 60, 0.08, 0.4)})`;
      hud.fillRect(0, 0, w, h);
    }
    lastHp = player.hp;
    if (ui.screen === 'title') drawTitle(w, h, ui);
    else {
      drawGameHUD(w, h);
      if (ui.screen === 'pause') drawPause(w, h);
      if (ui.screen === 'busted' || ui.screen === 'wasted') drawCard(w, h, ui.screen);
    }
    return dark;
  }

  return { frame, resize, setQuality, aimAngle, isFullQuality: () => full, camera };
}
