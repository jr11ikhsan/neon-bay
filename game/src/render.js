// render.js — NEON BAY in 3D: a Three.js scene built procedurally from the
// same city layout the simulation uses, plus a 2D overlay canvas that draws
// the HUD, the minimap and the screens. The simulation (world.js) stays a
// top-down model in world units; this module maps world (x, y) onto the
// ground plane (x, z) and gives the game a third-person camera.
//
// Three.js is a third-party MIT library (see game/lib/THREE-LICENSE.txt),
// loaded as a classic script before this module: window.THREE.

import { VIEW, WORLD, ROADS, PALETTE, FONT, TITLE_FONT, DAY } from './config.js';

const THREE = window.THREE;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function cameraFor(world) {
  return {
    x: clamp(world.player.x - VIEW.width / 2, 0, Math.max(0, WORLD.width - VIEW.width)),
    y: clamp(world.player.y - VIEW.height / 2, 0, Math.max(0, WORLD.height - VIEW.height)),
  };
}

function lightModel(hours) {
  // A long tropical golden hour: the sun stays up until about 18:30, so the
  // early game plays in dusk light instead of falling straight into night.
  const sun = clamp(Math.sin(((hours - 5.5) / 13) * Math.PI), 0, 1);
  const dusk = clamp(1 - Math.abs(hours - 18.6) / 1.6, 0, 1);
  const dawn = clamp(1 - Math.abs(hours - 6.4) / 1.4, 0, 1);
  return { sun, dark: 1 - sun, warm: Math.max(dusk, dawn * 0.8) };
}

function hashOf(n) {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// A radial-gradient sprite texture, shared by every glow in the scene.
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Procedural building facade: window grid (some lit) over the wall colour,
// with the neon sign painted as a band near the top when the building has one.
function makeFacadeTexture(building, index) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = building.color;
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, 128, 10);
  const rnd = (n) => hashOf(index * 977 + n * 131);
  const cols = 6, rows = 12;
  for (let r = 0; r < rows; r += 1) {
    for (let col = 0; col < cols; col += 1) {
      const lit = rnd(r * cols + col) < 0.42;
      g.fillStyle = lit ? 'rgba(255,214,130,0.95)' : 'rgba(16,18,30,0.85)';
      g.fillRect(10 + col * 19, 22 + r * 17, 12, 10);
    }
  }
  if (building.sign) {
    g.fillStyle = 'rgba(8,8,16,0.88)';
    g.fillRect(0, 196, 128, 44);
    g.fillStyle = building.sign.color;
    g.font = 'bold 17px system-ui, sans-serif';
    g.textAlign = 'center';
    const name = building.sign.text.length > 12 ? building.sign.text.slice(0, 12) : building.sign.text;
    g.fillText(name, 64, 224);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRenderer(glCanvas, hudCanvas) {
  // Adaptive quality: if the browser is rasterising in software (SwiftShader
  // and friends — common in VMs and headless browsers), start in a lighter
  // tier so the game stays fluid there too. Real GPUs get the full pass:
  // soft shadows, lamp glows and full resolution. Screenshot staging asks
  // for the full pass explicitly via setQuality(true) — a still frame does
  // not care how long one frame takes.
  const probe = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
  const dbgInfo = probe ? probe.getExtension('WEBGL_debug_renderer_info') : null;
  const glName = dbgInfo ? String(probe.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL)) : '';
  const softwareGL = /swiftshader|llvmpipe|software rasterizer/i.test(glName);
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: !softwareGL });
  renderer.setSize(VIEW.width, VIEW.height);
  renderer.setPixelRatio(softwareGL ? 0.55 : 0.85);
  renderer.shadowMap.enabled = !softwareGL;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // The sun barely moves within a second of play: refresh the shadow map
  // every third frame instead of every frame (a large, invisible saving).
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5d9);
  scene.fog = new THREE.Fog(0x87b5d9, 420, 2100);

  const camera = new THREE.PerspectiveCamera(57, VIEW.width / VIEW.height, 0.5, 2600);

  const hemi = new THREE.HemisphereLight(0xbcd7ff, 0x3a5f35, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b3, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -330; sun.shadow.camera.right = 330;
  sun.shadow.camera.top = 330; sun.shadow.camera.bottom = -330;
  sun.shadow.camera.far = 1600;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  const amb = new THREE.AmbientLight(0x404060, 0.5);
  scene.add(amb);

  const glowTex = makeGlowTexture();

  // Stars for the night sky.
  const starGeo = new THREE.BufferGeometry();
  {
    const pts = [];
    for (let i = 0; i < 420; i += 1) {
      const a = hashOf(i * 3 + 1) * Math.PI * 2;
      const e = 0.12 + hashOf(i * 7 + 2) * 1.2;
      const r = 2600;
      pts.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }
  const starMat = new THREE.PointsMaterial({ color: 0xcdd8ff, size: 5, sizeAttenuation: false, transparent: true, opacity: 0, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // The setting sun: a big warm sprite parked at the west horizon.
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffb35c, transparent: true, opacity: 0.9, fog: false, depthWrite: false,
  }));
  sunSprite.scale.set(560, 560, 1);
  scene.add(sunSprite);

  let builtCity = null;
  let lampGlows = [];
  let waterMat = null;
  let foamMesh = null;

  const lambert = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
  function box(w, h, d, mat, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function plane(w, d, mat, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  function buildCity(world) {
    const city = world.city;
    builtCity = city;
    lampGlows = [];
    const root = new THREE.Group();
    scene.add(root);

    const ground = plane(WORLD.width, WORLD.height, lambert(0x3e7a38), WORLD.width / 2, 0, WORLD.height / 2, root);
    ground.receiveShadow = true;

    // Sidewalk slabs under the roads, then the asphalt itself.
    for (const r of city.roadsV) {
      plane(ROADS.width + 30, WORLD.height, lambert(0x8d8d96), r.x, 0.02, WORLD.height / 2, root).receiveShadow = true;
    }
    for (const r of city.roadsH) {
      plane(WORLD.width, ROADS.width + 30, lambert(0x8d8d96), WORLD.width / 2, 0.02, r.y, root).receiveShadow = true;
    }
    // Asphalt with the centre dashes painted into a repeating texture —
    // hundreds of separate dash meshes would drown the draw-call budget.
    const asphaltCanvas = document.createElement('canvas');
    asphaltCanvas.width = 128; asphaltCanvas.height = 128;
    {
      const g = asphaltCanvas.getContext('2d');
      g.fillStyle = '#33333d';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(0,0,0,0.13)';
      for (let i = 0; i < 26; i += 1) {
        g.fillRect(hashOf(i * 7) * 120, hashOf(i * 13) * 120, 7, 5);
      }
      g.fillStyle = '#d8c95a';
      g.fillRect(61, 14, 6, 44);
    }
    const asphaltTexV = new THREE.CanvasTexture(asphaltCanvas);
    asphaltTexV.wrapS = asphaltTexV.wrapT = THREE.RepeatWrapping;
    asphaltTexV.repeat.set(1, 30);
    const asphaltCanvasH = document.createElement('canvas');
    asphaltCanvasH.width = 128; asphaltCanvasH.height = 128;
    {
      const g = asphaltCanvasH.getContext('2d');
      g.fillStyle = '#33333d';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(0,0,0,0.13)';
      for (let i = 0; i < 26; i += 1) {
        g.fillRect(hashOf(i * 13) * 120, hashOf(i * 7) * 120, 7, 5);
      }
      g.fillStyle = '#d8c95a';
      g.fillRect(14, 61, 44, 6);
    }
    const asphaltTexH = new THREE.CanvasTexture(asphaltCanvasH);
    asphaltTexH.wrapS = asphaltTexH.wrapT = THREE.RepeatWrapping;
    asphaltTexH.repeat.set(38, 1);
    for (const r of city.roadsV) {
      plane(ROADS.width, WORLD.height, new THREE.MeshLambertMaterial({ map: asphaltTexV }), r.x, 0.045, WORLD.height / 2, root).receiveShadow = true;
    }
    for (const r of city.roadsH) {
      const p = plane(WORLD.width, ROADS.width, new THREE.MeshLambertMaterial({ map: asphaltTexH }), WORLD.width / 2, 0.045, r.y, root);
      p.receiveShadow = true;
    }

    for (const p of city.parks) plane(p.w, p.h, lambert(0x4c9448), p.x + p.w / 2, 0.03, p.y + p.h / 2, root);
    for (const p of city.plazas) plane(p.w, p.h, lambert(0x9a8f7d), p.x + p.w / 2, 0.03, p.y + p.h / 2, root);
    for (const lot of city.lots) {
      plane(lot.w, lot.h, lambert(0x3b3b44), lot.x + lot.w / 2, 0.035, lot.y + lot.h / 2, root).receiveShadow = true;
    }

    // Beach, boardwalk and sea.
    plane(WORLD.waterX - WORLD.beachX, WORLD.height, lambert(0xd9be8c), (WORLD.beachX + WORLD.waterX) / 2, 0.03, WORLD.height / 2, root);
    plane(26, WORLD.height, lambert(0x8a6f4d), WORLD.beachX + 13, 0.04, WORLD.height / 2, root);
    {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#14506e';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(255,255,255,0.16)';
      g.lineWidth = 3;
      for (let i = 0; i < 5; i += 1) {
        g.beginPath();
        g.arc(20 + i * 26, 30 + (i % 3) * 34, 13, 0.25, Math.PI - 0.6);
        g.stroke();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(6, 40);
      waterMat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0.96 });
      const sea = plane(WORLD.width - WORLD.waterX + 700, WORLD.height, waterMat, (WORLD.waterX + WORLD.width + 700) / 2, 0.09, WORLD.height / 2, root);
      sea.position.x = WORLD.waterX + (WORLD.width - WORLD.waterX + 700) / 2;
    }
    foamMesh = plane(7, WORLD.height, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }), WORLD.waterX + 3, 0.12, WORLD.height / 2, root);

    // Buildings: textured boxes with roofs.
    const roofMat = lambert(0x23232e);
    city.buildings.forEach((b, i) => {
      const height = 30 + hashOf(i * 31 + 7) * 95;
      const tex = makeFacadeTexture(b, i);
      const side = new THREE.MeshLambertMaterial({ map: tex });
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(b.w, height, b.h),
        [side, side, roofMat, roofMat, side, side],
      );
      mesh.position.set(b.x + b.w / 2, height / 2, b.y + b.h / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    });

    // Palms, lamps and props are instanced: hundreds of near-identical
    // objects must cost a handful of draw calls, not hundreds.
    const dummy = new THREE.Object3D();
    const trunkInst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1.6, 2.6, 26, 5), lambert(0x7a5c38), city.palms.length,
    );
    const frondInst = new THREE.InstancedMesh(
      new THREE.ConeGeometry(3.2, 22, 4), lambert(0x2e8b4f), city.palms.length * 6,
    );
    city.palms.forEach((palm, i) => {
      dummy.position.set(palm.x, 13, palm.y);
      dummy.rotation.set(0, 0, 0.1);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);
      for (let k = 0; k < 6; k += 1) {
        const a = (k / 6) * Math.PI * 2;
        dummy.position.set(palm.x + Math.cos(a) * 8, 27, palm.y + Math.sin(a) * 8);
        dummy.rotation.set(Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15);
        dummy.updateMatrix();
        frondInst.setMatrixAt(i * 6 + k, dummy.matrix);
      }
    });
    dummy.rotation.set(0, 0, 0);
    trunkInst.castShadow = true;
    root.add(trunkInst);
    root.add(frondInst);

    const poleInst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.9, 1.2, 24, 5), lambert(0x2c2c34), city.lamps.length,
    );
    const headInst = new THREE.InstancedMesh(
      new THREE.SphereGeometry(2.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc46e }), city.lamps.length,
    );
    city.lamps.forEach((lamp, i) => {
      dummy.position.set(lamp.x, 12, lamp.y);
      dummy.updateMatrix();
      poleInst.setMatrixAt(i, dummy.matrix);
      dummy.position.set(lamp.x, 25, lamp.y);
      dummy.updateMatrix();
      headInst.setMatrixAt(i, dummy.matrix);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xffc46e, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.scale.set(46, 46, 1);
      glow.position.set(lamp.x, 25, lamp.y);
      glow.visible = !softwareGL;
      root.add(glow);
      lampGlows.push(glow);
    });
    root.add(poleInst);
    root.add(headInst);

    const crates = city.props.filter((p) => p.kind === 'crate');
    const barrels = city.props.filter((p) => p.kind !== 'crate');
    const crateInst = new THREE.InstancedMesh(new THREE.BoxGeometry(13, 13, 13), lambert(0x9a7434), Math.max(1, crates.length));
    crates.forEach((prop, i) => {
      dummy.position.set(prop.x, 6.5, prop.y);
      dummy.updateMatrix();
      crateInst.setMatrixAt(i, dummy.matrix);
    });
    crateInst.count = crates.length;
    crateInst.castShadow = true;
    root.add(crateInst);
    const barrelInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(6, 6, 15, 9), lambert(0x707a88), Math.max(1, barrels.length));
    barrels.forEach((prop, i) => {
      dummy.position.set(prop.x, 7.5, prop.y);
      dummy.updateMatrix();
      barrelInst.setMatrixAt(i, dummy.matrix);
    });
    barrelInst.count = barrels.length;
    barrelInst.castShadow = true;
    root.add(barrelInst);
    return root;
  }

  // ---------- dynamic meshes ----------

  const carMeshes = new Map();
  const pedMeshes = new Map();
  const copMeshes = new Map();
  const pickupMeshes = new Map();

  function makeCarMesh(car) {
    const g = new THREE.Group();
    const bodyMat = lambert(new THREE.Color(car.color).getHex());
    const body = box(84, 15, 42, bodyMat, 0, 12, 0, g);
    body.castShadow = true;
    const cabin = box(44, 12, 38, lambert(0x14161f), -3, 24, 0, g);
    cabin.castShadow = true;
    if (car.mission) box(84, 3, 10, lambert(0x14161f), 0, 20.5, 0, g); // coupe stripe
    const wheelGeo = new THREE.CylinderGeometry(9, 9, 6, 10);
    const wheelMat = lambert(0x0c0c10);
    for (const [wx, wz] of [[29, 22], [29, -22], [-29, 22], [-29, -22]]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 9, wz);
      g.add(wheel);
    }
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    box(3, 5, 9, headMat, 43, 12, 12, g);
    box(3, 5, 9, headMat, 43, 12, -12, g);
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3355 });
    box(3, 5, 9, tailMat, -43, 12, 12, g);
    box(3, 5, 9, tailMat, -43, 12, -12, g);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xfff0bb, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.scale.set(90, 40, 1);
    glow.position.set(52, 12, 0);
    g.add(glow);
    let barRed = null, barBlue = null;
    if (car.kind === 'police') {
      box(84, 13, 42, lambert(0xf2f2f2), 0, 12.5, 0, g).castShadow = true;
      barRed = new THREE.MeshBasicMaterial({ color: 0xff3355 });
      barBlue = new THREE.MeshBasicMaterial({ color: 0x3355ff });
      box(14, 5, 20, barRed, 0, 32, 6, g);
      box(14, 5, 20, barBlue, 0, 32, -6, g);
    }
    g.userData = { glow, barRed, barBlue };
    scene.add(g);
    return g;
  }

  function makePersonMesh(kind, colorHex) {
    const g = new THREE.Group();
    const tilt = new THREE.Group();
    g.add(tilt);
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(5.5, 6.8, 16, 8),
      lambert(new THREE.Color(colorHex).getHex()),
    );
    body.position.y = 15;
    body.castShadow = true;
    tilt.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(5.6, 10, 8), lambert(0xe0aa7e));
    head.position.y = 27;
    tilt.add(head);
    if (kind === 'cop') {
      const cap = box(11, 3, 11, lambert(0x1c2f57), 0, 31.5, 0, tilt);
      cap.castShadow = false;
    }
    if (kind === 'player') {
      const pack = box(6, 10, 10, lambert(0x8a4b2a), -7, 16, 0, tilt);
      pack.castShadow = false;
    }
    g.userData = { tilt };
    scene.add(g);
    return g;
  }

  function syncGroup(map, obj, mesh, heightBob) {
    mesh.position.set(obj.x, heightBob || 0, obj.y);
    mesh.rotation.y = -obj.angle;
  }

  function pruneMap(map, liveSet) {
    for (const [obj, mesh] of map) {
      if (!liveSet.has(obj)) {
        scene.remove(mesh);
        map.delete(obj);
      }
    }
  }

  // Mission marker: a pillar of gold light plus a ground ring.
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(24, 24, 260, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  pillar.position.y = 130;
  scene.add(pillar);
  const pillarRing = new THREE.Mesh(
    new THREE.RingGeometry(20, 27, 28),
    new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  );
  pillarRing.rotation.x = -Math.PI / 2;
  scene.add(pillarRing);

  // Tracers as one LineSegments pool.
  const TRACER_MAX = 40;
  const tracerPos = new Float32Array(TRACER_MAX * 6);
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  const tracers = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({
    color: 0xffd166, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  tracers.frustumCulled = false;
  scene.add(tracers);

  // Particles as one Points pool.
  const PARTICLE_MAX = 260;
  const particlePos = new Float32Array(PARTICLE_MAX * 3);
  const particleCol = new Float32Array(PARTICLE_MAX * 3);
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(particleCol, 3));
  const particlePoints = new THREE.Points(particleGeo, new THREE.PointsMaterial({
    size: 9, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false,
    map: glowTex, alphaTest: 0.02,
  }));
  particlePoints.frustumCulled = false;
  scene.add(particlePoints);
  const tmpColor = new THREE.Color();

  // Muzzle flash sprite.
  const muzzleSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffd166, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  muzzleSprite.scale.set(46, 46, 1);
  scene.add(muzzleSprite);

  // ---------- camera rig ----------

  let camPos = null;
  let camYaw = 0;
  let camFocus = new THREE.Vector3(2400, 0, 1800);

  function updateCamera(world, dt) {
    const p = world.player;
    const focus = p.car || p;
    const heading = p.car ? p.car.angle : p.angle;
    camYaw = camPos === null ? heading : angleLerp(camYaw, heading, 1 - Math.exp(-dt * 3.2));
    const fx = Math.cos(camYaw), fz = Math.sin(camYaw);
    const inCar = !!p.car;
    const speed = inCar ? Math.abs(p.car.speed) : 0;
    const dist = inCar ? 148 + speed * 0.07 : 98;
    const height = inCar ? 66 : 56;
    const desired = new THREE.Vector3(
      clamp(focus.x - fx * dist, 40, WORLD.width - 40),
      height,
      clamp(focus.y - fz * dist, 40, WORLD.height - 40),
    );
    if (!camPos) camPos = desired.clone();
    else camPos.lerp(desired, 1 - Math.exp(-dt * 5.5));
    const shake = world.shake || 0;
    camera.position.set(
      camPos.x + (shake ? (Math.random() * 2 - 1) * shake : 0),
      camPos.y + (shake ? (Math.random() * 2 - 1) * shake * 0.5 : 0),
      camPos.z + (shake ? (Math.random() * 2 - 1) * shake : 0),
    );
    camFocus.set(focus.x + fx * 34, 20, focus.y + fz * 34);
    camera.lookAt(camFocus);
    const targetFov = inCar ? 57 + clamp(speed / 545, 0, 1) * 7 : 57;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
    // The shadow frustum and the sun travel with the player.
    sun.position.set(focus.x + sun.userData.dx * 700, sun.userData.dy * 700 + 120, focus.y + 260);
    sun.target.position.set(focus.x, 0, focus.y);
    stars.position.set(camera.position.x, 0, camera.position.z);
    sunSprite.position.set(
      camera.position.x + sun.userData.dx * 2300,
      Math.max(90, sun.userData.dy * 1500),
      camera.position.z + 500,
    );
  }
  sun.userData = { dx: -0.7, dy: 0.5 };

  function updateLighting(world) {
    const light = lightModel(world.timeHours);
    const phi = ((world.timeHours - 5.5) / 13) * Math.PI;
    sun.userData.dx = -Math.cos(phi);
    sun.userData.dy = Math.max(0.06, Math.sin(phi));
    sun.intensity = 0.3 + light.sun * 1.5 + light.warm * 0.55; // warm = afterglow
    sun.color.setHSL(0.07 + light.sun * 0.05, 0.8, 0.52 + light.sun * 0.2);
    hemi.intensity = 0.36 + light.sun * 0.6 + light.warm * 0.14;
    amb.intensity = 0.32 + light.dark * 0.25 + light.warm * 0.1;
    const day = new THREE.Color(0x87b5d9);
    const dusk = new THREE.Color(0x51306b);
    const night = new THREE.Color(0x0a0e24);
    const bg = day.clone().lerp(dusk, light.warm * 0.85).lerp(night, clamp(light.dark - light.warm * 0.9, 0, 1));
    scene.background.copy(bg);
    scene.fog.color.copy(bg);
    starMat.opacity = clamp(light.dark - 0.35, 0, 0.9);
    sunSprite.material.opacity = clamp(1 - light.dark * 1.4, 0, 0.95);
    for (const glow of lampGlows) glow.material.opacity = light.dark * 0.8;
    if (waterMat) waterMat.map.offset.set(world.elapsed * 0.008, world.elapsed * 0.003);
    if (foamMesh) foamMesh.position.x = WORLD.waterX + 3 + Math.sin(world.elapsed * 1.3) * 4;
    return light;
  }

  function syncDynamics(world) {
    const p = world.player;
    const liveCars = new Set(world.cars);
    for (const car of world.cars) {
      if (!carMeshes.has(car)) carMeshes.set(car, makeCarMesh(car));
      const mesh = carMeshes.get(car);
      syncGroup(carMeshes, car, mesh, 0);
      mesh.userData.glow.material.opacity = lightCache.dark * (car.driver ? 0.55 : 0.25);
      if (mesh.userData.barRed) {
        const phase = Math.floor(world.elapsed * 6) % 2 === 0;
        mesh.userData.barRed.color.setHex(phase ? 0xff3355 : 0x57111f);
        mesh.userData.barBlue.color.setHex(phase ? 0x1c2f6e : 0x3355ff);
      }
    }
    pruneMap(carMeshes, liveCars);

    const livePeds = new Set(world.peds);
    for (const ped of world.peds) {
      if (!pedMeshes.has(ped)) pedMeshes.set(ped, makePersonMesh(ped.dealer ? 'dealer' : 'ped', ped.color));
      const mesh = pedMeshes.get(ped);
      const bob = ped.dead ? 0 : Math.abs(Math.sin(world.elapsed * 7 + ped.x * 0.05)) * 1.1;
      syncGroup(pedMeshes, ped, mesh, bob);
      mesh.userData.tilt.rotation.x = ped.dead ? -Math.PI / 2 : 0;
      mesh.userData.tilt.position.y = ped.dead ? 6 : 0;
    }
    pruneMap(pedMeshes, livePeds);

    const liveCops = new Set(world.cops);
    for (const cop of world.cops) {
      if (!copMeshes.has(cop)) copMeshes.set(cop, makePersonMesh('cop', '#274690'));
      const mesh = copMeshes.get(cop);
      syncGroup(copMeshes, cop, mesh, Math.abs(Math.sin(world.elapsed * 8 + cop.x * 0.05)) * 1.1);
    }
    pruneMap(copMeshes, liveCops);

    // The player.
    if (!syncDynamics.playerMesh) {
      syncDynamics.playerMesh = makePersonMesh('player', '#ffd23f');
    }
    const pm = syncDynamics.playerMesh;
    pm.visible = !p.car;
    if (!p.car) {
      const prev = syncDynamics.prevPlayer || { x: p.x, y: p.y };
      const moved = Math.hypot(p.x - prev.x, p.y - prev.y);
      syncDynamics.prevPlayer = { x: p.x, y: p.y };
      const bob = moved > 0.05 ? Math.abs(Math.sin(world.elapsed * 9)) * 1.4 : 0;
      syncGroup(null, p, pm, bob);
    }

    const livePickups = new Set(world.pickups);
    for (const pk of world.pickups) {
      if (!pickupMeshes.has(pk)) {
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(9, 9, 3.5, 14),
          new THREE.MeshBasicMaterial({ color: pk.kind === 'money' ? 0xffd23f : 0x06d6a0 }),
        );
        mesh.rotation.x = Math.PI / 2.4;
        scene.add(mesh);
        pickupMeshes.set(pk, mesh);
      }
      const mesh = pickupMeshes.get(pk);
      mesh.position.set(pk.x, 14 + Math.sin(world.elapsed * 3 + pk.x) * 2.5, pk.y);
      mesh.rotation.z = world.elapsed * 2.4;
    }
    pruneMap(pickupMeshes, livePickups);

    // Objective pillar.
    const target = world.objectiveTarget();
    pillar.visible = !!target;
    pillarRing.visible = !!target;
    if (target) {
      pillar.position.set(target.x, 130, target.y);
      pillar.material.opacity = 0.2 + 0.1 * Math.sin(world.elapsed * 4);
      pillarRing.position.set(target.x, 1.2, target.y);
      const s = 1 + 0.12 * Math.sin(world.elapsed * 4);
      pillarRing.scale.set(s, s, 1);
    }

    // Tracers.
    let ti = 0;
    for (const tr of world.tracers) {
      if (ti >= TRACER_MAX) break;
      tracerPos[ti * 6] = tr.x0; tracerPos[ti * 6 + 1] = 26; tracerPos[ti * 6 + 2] = tr.y0;
      tracerPos[ti * 6 + 3] = tr.x1; tracerPos[ti * 6 + 4] = 26; tracerPos[ti * 6 + 5] = tr.y1;
      ti += 1;
    }
    tracerGeo.setDrawRange(0, ti * 2);
    tracerGeo.attributes.position.needsUpdate = true;

    // Particles.
    let pi = 0;
    for (const pt of world.particles) {
      if (pi >= PARTICLE_MAX) break;
      particlePos[pi * 3] = pt.x;
      particlePos[pi * 3 + 1] = 16 + (1 - pt.ttl / pt.maxT) * 22;
      particlePos[pi * 3 + 2] = pt.y;
      tmpColor.set(pt.color.replace(/rgba?\(([^)]+)\)/, (m, inner) => {
        const parts = inner.split(',').map((s) => parseFloat(s));
        return `rgb(${parts[0]},${parts[1]},${parts[2]})`;
      }));
      particleCol[pi * 3] = tmpColor.r; particleCol[pi * 3 + 1] = tmpColor.g; particleCol[pi * 3 + 2] = tmpColor.b;
      pi += 1;
    }
    for (let i = pi; i < PARTICLE_MAX; i += 1) particlePos[i * 3 + 1] = -100;
    particleGeo.attributes.position.needsUpdate = true;
    particleGeo.attributes.color.needsUpdate = true;

    // Muzzle flash at the player's barrel.
    if (world.muzzle) {
      muzzleSprite.material.opacity = clamp(world.muzzle.ttl / world.muzzle.maxT, 0, 1);
      muzzleSprite.position.set(world.muzzle.x, 27, world.muzzle.y);
    } else {
      muzzleSprite.material.opacity = 0;
    }
  }

  let lightCache = { sun: 1, dark: 0, warm: 0 };
  let lastNow = null;

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();

  function screenToGround(px, py) {
    ndc.set((px / VIEW.width) * 2 - 1, -((py / VIEW.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.ray.intersectPlane(groundPlane, hitPoint);
    if (!hit) return null;
    return { x: hitPoint.x, y: hitPoint.z };
  }

  function worldToScreen(wx, wy) {
    const v = new THREE.Vector3(wx, 22, wy).project(camera);
    return { x: (v.x * 0.5 + 0.5) * VIEW.width, y: (-v.y * 0.5 + 0.5) * VIEW.height, behind: v.z > 1 };
  }

  // ---------- 2D overlay: HUD, minimap, screens ----------

  hudCanvas.width = VIEW.width;
  hudCanvas.height = VIEW.height;
  const h = hudCanvas.getContext('2d');
  let minimapBase = null;
  let minimapCity = null;

  function roundRect(x, y, w, hh, r) {
    h.beginPath();
    h.moveTo(x + r, y);
    h.arcTo(x + w, y, x + w, y + hh, r);
    h.arcTo(x + w, y + hh, x, y + hh, r);
    h.arcTo(x, y + hh, x, y, r);
    h.arcTo(x, y, x + w, y, r);
    h.closePath();
  }

  function panel(x, y, w, hh) {
    h.fillStyle = PALETTE.panel;
    roundRect(x, y, w, hh, 10);
    h.fill();
    h.strokeStyle = 'rgba(245,242,234,0.18)';
    h.stroke();
    h.fillStyle = 'rgba(34,211,238,0.35)';
    h.fillRect(x + 12, y + 1, w - 24, 2);
  }

  function buildMinimapBase(city) {
    const c = document.createElement('canvas');
    c.width = 264; c.height = 198;
    const g = c.getContext('2d');
    const sx = 264 / WORLD.width, sy = 198 / WORLD.height;
    g.fillStyle = '#2c5b2a';
    g.fillRect(0, 0, 264, 198);
    g.fillStyle = '#27506e';
    g.fillRect(WORLD.waterX * sx, 0, 264 - WORLD.waterX * sx, 198);
    g.fillStyle = '#c9ae76';
    g.fillRect(WORLD.beachX * sx, 0, (WORLD.waterX - WORLD.beachX) * sx, 198);
    g.fillStyle = '#3a3a44';
    for (const r of city.roadsV) g.fillRect(r.x * sx - 2, 0, 4, 198);
    for (const r of city.roadsH) g.fillRect(0, r.y * sy - 2, 264, 4);
    g.fillStyle = 'rgba(20,20,28,0.55)';
    for (const b of city.buildings) g.fillRect(b.x * sx, b.y * sy, Math.max(2, b.w * sx), Math.max(2, b.h * sy));
    return c;
  }

  function drawMinimap(world) {
    const city = world.city;
    if (minimapCity !== city) {
      minimapBase = buildMinimapBase(city);
      minimapCity = city;
    }
    const x = 16, y = VIEW.height - 214, w = 264, hh = 198;
    h.save();
    roundRect(x, y, w, hh, 10);
    h.clip();
    h.globalAlpha = 0.92;
    h.drawImage(minimapBase, x, y);
    h.globalAlpha = 1;
    const sx = w / WORLD.width, sy = hh / WORLD.height;
    const dot = (wx, wy, color, r) => {
      h.fillStyle = color;
      h.beginPath(); h.arc(x + wx * sx, y + wy * sy, r, 0, Math.PI * 2); h.fill();
    };
    for (const car of world.cars) if (car.kind === 'police') dot(car.x, car.y, '#5b8cff', 3);
    const target = world.objectiveTarget();
    if (target) {
      dot(target.x, target.y, PALETTE.neonGold, 4.5);
      h.strokeStyle = PALETTE.neonGold;
      h.beginPath(); h.arc(x + target.x * sx, y + target.y * sy, 7 + Math.sin(world.elapsed * 5) * 1.5, 0, Math.PI * 2); h.stroke();
    }
    const p = world.player;
    h.save();
    h.translate(x + p.x * sx, y + p.y * sy);
    h.rotate(p.car ? p.car.angle : p.angle);
    h.fillStyle = '#ffffff';
    h.beginPath();
    h.moveTo(7, 0); h.lineTo(-5, -4.5); h.lineTo(-5, 4.5);
    h.closePath(); h.fill();
    h.restore();
    h.restore();
    h.strokeStyle = 'rgba(245,242,234,0.25)';
    roundRect(x, y, w, hh, 10);
    h.stroke();
  }

  function drawHUD(world, opts) {
    const p = world.player;
    panel(16, 14, 252, 74);
    h.save();
    h.shadowColor = 'rgba(6,214,160,0.55)';
    h.shadowBlur = 9;
    h.fillStyle = PALETTE.good;
    h.font = `bold 30px ${FONT}`;
    h.textAlign = 'left';
    h.fillText(`$${world.money.toLocaleString('en-US')}`, 30, 50);
    h.restore();
    h.fillStyle = 'rgba(10,10,16,0.55)';
    h.fillRect(30, 62, 224, 12);
    h.fillStyle = p.health > 30 ? PALETTE.good : PALETTE.bad;
    h.fillRect(30, 62, 224 * clamp(p.health / 100, 0, 1), 12);
    if (world.bust > 0.02) {
      h.fillStyle = 'rgba(255,51,85,0.25)';
      h.fillRect(30, 62, 224, 12);
      h.fillStyle = PALETTE.bad;
      h.fillRect(30, 62, 224 * clamp(world.bust, 0, 1), 12);
    }

    panel(VIEW.width - 268, 14, 252, 74);
    h.fillStyle = PALETTE.text;
    h.font = `bold 26px ${FONT}`;
    h.textAlign = 'right';
    const hh2 = Math.floor(world.timeHours);
    const mm = Math.floor((world.timeHours - hh2) * 60);
    h.fillText(`${String(hh2).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, VIEW.width - 30, 48);
    const stars = world.stars();
    const blink = world.playerSeen || Math.floor(world.elapsed * 3) % 2 === 0;
    h.font = '24px system-ui';
    h.textAlign = 'right';
    for (let i = 0; i < 5; i += 1) {
      h.fillStyle = i < stars ? PALETTE.neonGold : 'rgba(245,242,234,0.22)';
      if (i < stars && !blink) h.fillStyle = 'rgba(255,201,60,0.35)';
      h.fillText('★', VIEW.width - 34 - (4 - i) * 30, 78);
    }

    if (p.car) {
      panel(VIEW.width - 268, VIEW.height - 92, 252, 76);
      h.fillStyle = PALETTE.text;
      h.font = `bold 24px ${FONT}`;
      h.textAlign = 'right';
      h.fillText(`${Math.round(Math.abs(p.car.speed) * 0.36)} km/h`, VIEW.width - 30, VIEW.height - 56);
      h.fillStyle = 'rgba(10,10,16,0.55)';
      h.fillRect(VIEW.width - 254, VIEW.height - 44, 224, 9);
      h.fillStyle = p.car.health > 30 ? PALETTE.neonCyan : PALETTE.bad;
      h.fillRect(VIEW.width - 254, VIEW.height - 44, 224 * clamp(p.car.health / 100, 0, 1), 9);
    } else {
      panel(VIEW.width - 268, VIEW.height - 64, 252, 48);
      h.fillStyle = PALETTE.text;
      h.font = `bold 19px ${FONT}`;
      h.textAlign = 'right';
      h.fillText(p.hasGun ? 'WEAPON: PISTOL' : 'WEAPON: FISTS', VIEW.width - 30, VIEW.height - 33);
    }
    if (opts.muted) {
      h.fillStyle = 'rgba(245,242,234,0.6)';
      h.font = `14px ${FONT}`;
      h.textAlign = 'right';
      h.fillText('MUTED (M)', VIEW.width - 18, VIEW.height - 104);
    }

    drawMinimap(world);

    // Direction arrow around the player's screen position.
    const target = world.objectiveTarget();
    if (target && !p.car) {
      const d = Math.hypot(target.x - p.x, target.y - p.y);
      if (d > 300) {
        const ps = worldToScreen(p.x, p.y);
        const ts = worldToScreen(target.x, target.y);
        const a = Math.atan2(ts.y - ps.y, ts.x - ps.x);
        const cx = ps.x + Math.cos(a) * 56, cy = ps.y + Math.sin(a) * 56;
        h.save();
        h.translate(cx, cy);
        h.rotate(a);
        h.fillStyle = PALETTE.neonGold;
        h.beginPath();
        h.moveTo(13, 0); h.lineTo(-8, -8); h.lineTo(-8, 8);
        h.closePath(); h.fill();
        h.restore();
      }
    }

    // Objective line.
    const obj = world.objectiveText();
    if (obj) {
      h.font = `bold 19px ${FONT}`;
      const w = Math.min(620, h.measureText(obj).width + 44);
      panel(VIEW.width / 2 - w / 2, VIEW.height - 58, w, 42);
      h.fillStyle = PALETTE.text;
      h.textAlign = 'center';
      h.fillText(obj, VIEW.width / 2, VIEW.height - 30);
    }

    // Mission banner.
    if (world.banner && world.banner.ttl > 0) {
      const b = world.banner;
      const alpha = clamp(b.ttl / 0.6, 0, 1);
      h.save();
      h.globalAlpha = alpha;
      const w = 660;
      panel(VIEW.width / 2 - w / 2, 104, w, 86);
      h.fillStyle = PALETTE.neonGold;
      h.font = `bold 25px ${FONT}`;
      h.textAlign = 'center';
      h.fillText(b.title, VIEW.width / 2, 140);
      h.fillStyle = PALETTE.text;
      h.font = `17px ${FONT}`;
      h.fillText(b.sub, VIEW.width / 2, 168);
      h.restore();
    }

    // Toasts.
    h.textAlign = 'center';
    h.font = `bold 17px ${FONT}`;
    world.toasts.forEach((t, i) => {
      h.save();
      h.globalAlpha = clamp(t.ttl / 0.5, 0, 1);
      h.fillStyle = 'rgba(10,10,18,0.72)';
      const w = h.measureText(t.text).width + 30;
      roundRect(VIEW.width / 2 - w / 2, 206 + i * 30, w, 26, 8);
      h.fill();
      h.fillStyle = PALETTE.neonCyan;
      h.fillText(t.text, VIEW.width / 2, 224 + i * 30);
      h.restore();
    });

    if (world.storyDone && world.storyDoneTimer > 0) {
      h.save();
      h.globalAlpha = clamp(world.storyDoneTimer / 1.2, 0, 1);
      h.shadowColor = PALETTE.neonGold;
      h.shadowBlur = 26;
      h.fillStyle = PALETTE.neonGold;
      h.font = `54px ${TITLE_FONT}`;
      h.textAlign = 'center';
      h.fillText('STORY COMPLETE', VIEW.width / 2, 300);
      h.restore();
    }
  }

  function drawTitle(world, opts) {
    const grad = h.createLinearGradient(0, 0, 0, VIEW.height);
    grad.addColorStop(0, 'rgba(24,8,44,0.55)');
    grad.addColorStop(0.5, 'rgba(64,20,60,0.18)');
    grad.addColorStop(1, 'rgba(10,6,26,0.66)');
    h.fillStyle = grad;
    h.fillRect(0, 0, VIEW.width, VIEW.height);
    h.save();
    const sunX = VIEW.width / 2, sunY = 252, sunR = 148;
    const sunGrad = h.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
    sunGrad.addColorStop(0, 'rgba(255,183,3,0.5)');
    sunGrad.addColorStop(0.6, 'rgba(255,46,136,0.42)');
    sunGrad.addColorStop(1, 'rgba(199,125,255,0.32)');
    h.fillStyle = sunGrad;
    h.beginPath(); h.arc(sunX, sunY, sunR, 0, Math.PI * 2); h.fill();
    h.clip();
    h.fillStyle = 'rgba(18,8,32,0.55)';
    for (let i = 0; i < 5; i += 1) {
      h.fillRect(sunX - sunR, sunY + 18 + i * 26, sunR * 2, 5 + i * 2);
    }
    h.restore();
    h.strokeStyle = 'rgba(255,46,136,0.5)';
    h.lineWidth = 2;
    h.strokeRect(14, 14, VIEW.width - 28, VIEW.height - 28);
    h.strokeStyle = 'rgba(34,211,238,0.4)';
    h.strokeRect(20, 20, VIEW.width - 40, VIEW.height - 40);
    h.textAlign = 'center';
    h.save();
    h.font = `96px ${TITLE_FONT}`;
    h.shadowColor = PALETTE.neonPink;
    h.shadowBlur = 26;
    h.fillStyle = PALETTE.neonPink;
    h.fillText('NEON', VIEW.width / 2, 208);
    h.shadowColor = PALETTE.neonCyan;
    h.fillStyle = PALETTE.neonCyan;
    h.fillText('BAY', VIEW.width / 2, 304);
    h.restore();
    const bar = h.createLinearGradient(VIEW.width / 2 - 210, 0, VIEW.width / 2 + 210, 0);
    bar.addColorStop(0, PALETTE.neonPink);
    bar.addColorStop(0.5, PALETTE.neonGold);
    bar.addColorStop(1, PALETTE.neonCyan);
    h.fillStyle = bar;
    h.fillRect(VIEW.width / 2 - 210, 322, 420, 4);
    h.fillStyle = PALETTE.text;
    h.font = `21px ${FONT}`;
    h.fillText('A neon beach crime story in 3D — steal the coupe, run the package, take the bank.', VIEW.width / 2, 356);
    panel(VIEW.width / 2 - 330, 392, 660, 158);
    h.font = `19px ${FONT}`;
    h.fillStyle = PALETTE.text;
    const lines = [
      ['WASD / Arrows — move & drive', 'Mouse — aim'],
      ['Click — punch / shoot', 'E — enter / exit car'],
      ['Shift — run', 'P / Esc — pause'],
      ['M — mute', 'Follow the gold pillar'],
    ];
    lines.forEach((pair, i) => {
      h.textAlign = 'left';
      h.fillText(pair[0], VIEW.width / 2 - 300, 434 + i * 30);
      h.textAlign = 'center';
      h.fillText(pair[1], VIEW.width / 2 + 170, 434 + i * 30);
    });
    if (opts.hasSave) {
      h.fillStyle = PALETTE.neonCyan;
      h.font = `bold 19px ${FONT}`;
      h.textAlign = 'center';
      h.fillText('Press C to continue your story', VIEW.width / 2, 580);
    }
    const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 280);
    h.save();
    h.globalAlpha = pulse;
    h.shadowColor = PALETTE.neonGold;
    h.shadowBlur = 18;
    h.fillStyle = PALETTE.neonGold;
    h.font = `bold 27px ${FONT}`;
    h.textAlign = 'center';
    h.fillText('CLICK OR PRESS ENTER — START', VIEW.width / 2, 624);
    h.restore();
  }

  function drawPause() {
    h.fillStyle = 'rgba(8,6,18,0.62)';
    h.fillRect(0, 0, VIEW.width, VIEW.height);
    h.textAlign = 'center';
    h.save();
    h.shadowColor = PALETTE.neonCyan;
    h.shadowBlur = 24;
    h.fillStyle = PALETTE.neonCyan;
    h.font = `58px ${TITLE_FONT}`;
    h.fillText('PAUSED', VIEW.width / 2, 268);
    h.restore();
    h.fillStyle = PALETTE.text;
    h.font = `20px ${FONT}`;
    h.fillText('P / Esc — resume      S — save now      R — restart the story', VIEW.width / 2, 330);
    h.fillText('Your progress also saves itself after every mission.', VIEW.width / 2, 362);
  }

  function drawFate(world) {
    const busted = world.fate === 'busted';
    h.fillStyle = busted ? 'rgba(20,30,90,0.45)' : 'rgba(90,10,20,0.45)';
    h.fillRect(0, 0, VIEW.width, VIEW.height);
    h.textAlign = 'center';
    h.save();
    h.shadowColor = busted ? '#5b8cff' : PALETTE.bad;
    h.shadowBlur = 30;
    h.fillStyle = busted ? '#8fb2ff' : '#ff8fa3';
    h.font = `72px ${TITLE_FONT}`;
    h.fillText(busted ? 'BUSTED' : 'WASTED', VIEW.width / 2, 320);
    h.restore();
    h.fillStyle = PALETTE.text;
    h.font = `20px ${FONT}`;
    h.fillText(
      busted ? 'The police take a cut of your cash and let you walk.' : 'The clinic patches you up — for a fee.',
      VIEW.width / 2, 366,
    );
  }

  // ---------- frame ----------

  let lastWorld = null;

  let frameNo = 0;
  function render(world, screen, opts = {}) {
    lastWorld = world;
    if (world.city !== builtCity) buildCity(world);
    frameNo += 1;
    if (frameNo % 3 === 0) renderer.shadowMap.needsUpdate = true;
    const now = performance.now() / 1000;
    const dt = lastNow === null ? 0.016 : clamp(now - lastNow, 0.001, 0.05);
    lastNow = now;
    lightCache = updateLighting(world);
    updateCamera(world, dt);
    syncDynamics(world);
    renderer.render(scene, camera);
    h.clearRect(0, 0, VIEW.width, VIEW.height);
    if (screen === 'title') {
      drawTitle(world, opts);
      return;
    }
    drawHUD(world, opts);
    if (world.fate) drawFate(world);
    if (screen === 'paused') drawPause();
  }

  function setQuality(high) {
    renderer.setPixelRatio(high ? 0.85 : (softwareGL ? 0.55 : 0.85));
    const shadows = high || !softwareGL;
    if (renderer.shadowMap.enabled !== shadows) {
      renderer.shadowMap.enabled = shadows;
      scene.traverse((o) => {
        if (o.material) o.material.needsUpdate = true;
      });
    }
    for (const glow of lampGlows) glow.visible = shadows;
  }

  return {
    render,
    screenToGround,
    worldToScreen,
    setQuality,
    getCamera: () => (lastWorld ? cameraFor(lastWorld) : { x: 0, y: 0 }),
    getYaw: () => camYaw,
  };
}
