// NEON BAY v3 — Three.js renderer: low-poly neon city at dusk, third-person camera, bright
// readable nights (strong moonlight + neon emission), plus a 2D overlay canvas for the HUD,
// minimap and screens. World (x,y) maps to ground plane (x,z); facing angle a -> rotation.y=-a.
import * as THREE from '../vendor/three.module.min.js';
import { WORLD, PLAYER, WEAPONS, CAR_TYPES } from './config.js';
import { clamp, lerp, angDiff } from './random.js';
import { AVENUES, STREETS, ROAD_W } from './city.js';

const V3 = (x, y) => new THREE.Vector3(x, 0, y);
function skyAt(hours) {
  // Returns lerped sky/light rig values for a time of day. Night is deliberately bright.
  const K = [
    { h: 0, dark: 1, top: '#05081a', mid: '#101c3f', hor: '#274069', sun: 0.0, sunC: '#9db8ff' },
    { h: 5, dark: 1, top: '#05081a', mid: '#101c3f', hor: '#274069', sun: 0.0, sunC: '#9db8ff' },
    { h: 7, dark: 0.25, top: '#2a4a7f', mid: '#7fa8d8', hor: '#ffd9a0', sun: 0.8, sunC: '#ffe3b0' },
    { h: 12, dark: 0, top: '#2f6fd0', mid: '#79aee0', hor: '#cfe8ff', sun: 1.6, sunC: '#fff3d0' },
    { h: 16.5, dark: 0.05, top: '#2a5fb0', mid: '#7d9fd0', hor: '#f5d9a8', sun: 1.35, sunC: '#ffdf9e' },
    { h: 18.3, dark: 0.38, top: '#33235e', mid: '#b34a7d', hor: '#ff9a3e', sun: 0.75, sunC: '#ffab52' },
    { h: 19.6, dark: 0.85, top: '#0a1030', mid: '#27356b', hor: '#584a7a', sun: 0.25, sunC: '#c8a06a' },
    { h: 20.6, dark: 1, top: '#05081a', mid: '#101c3f', hor: '#274069', sun: 0.0, sunC: '#9db8ff' },
    { h: 24, dark: 1, top: '#05081a', mid: '#101c3f', hor: '#274069', sun: 0.0, sunC: '#9db8ff' },
  ];
  let a = K[0], b = K[K.length - 1];
  for (let i = 0; i + 1 < K.length; i++) if (hours >= K[i].h && hours <= K[i + 1].h) { a = K[i]; b = K[i + 1]; break; }
  const t = b.h === a.h ? 0 : (hours - a.h) / (b.h - a.h);
  const mix = (ca, cb) => { const pa = parseInt(ca.slice(1), 16), pb = parseInt(cb.slice(1), 16);
    const r = Math.round(lerp(pa >> 16, pb >> 16, t)), g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t)), bl = Math.round(lerp(pa & 255, pb & 255, t));
    return `rgb(${r},${g},${bl})`; };
  return { dark: lerp(a.dark, b.dark, t), top: mix(a.top, b.top), mid: mix(a.mid, b.mid), hor: mix(a.hor, b.hor), sun: lerp(a.sun, b.sun, t), sunC: mix(a.sunC, b.sunC) };
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Renderer {
  constructor(glCanvas, hudCanvas) {
    this.gl = glCanvas; this.hud = hudCanvas; this.hx = hudCanvas.getContext('2d');
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    this.lowTier = /SwiftShader|llvmpipe|Software/i.test(name);
    renderer.setPixelRatio(this.lowTier ? 0.55 : Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = !this.lowTier;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 1, 12000);
    this.camPos = new THREE.Vector3(2400, 300, 3400);
    this.shake = 0; this.fov = 55; this.yaw = -Math.PI / 2;
    // Light rig (night values are the v3 bright-night rig: hemi .82, ambient .36, moon .55).
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x33404f, 0.9); this.scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xbfd0ff, 0.3); this.scene.add(this.amb);
    this.sun = new THREE.DirectionalLight(0xffe3b0, 1.2);
    this.sun.castShadow = !this.lowTier;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, far: 2600 });
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.scene.fog = new THREE.Fog(0x274069, 700, 3400);
    this.buildSky(); this.carMeshes = new Map(); this.pedMeshes = new Map();
    this.resize();
  }
  setQuality(full) {
    this.renderer.setPixelRatio(full ? 1 : (this.lowTier ? 0.55 : Math.min(devicePixelRatio, 2)));
    this.sun.castShadow = full && !this.lowTier ? true : this.sun.castShadow;
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h); this.gl.width = w; this.gl.height = h;
    this.hud.width = w; this.hud.height = h;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.W = w; this.H = h;
  }
  buildSky() {
    this.skyCanvas = document.createElement('canvas'); this.skyCanvas.width = 4; this.skyCanvas.height = 512;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas); this.skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(9500, 24, 14), new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10; this.scene.add(sky); this.skyMesh = sky;
    const disc = (inner, outer) => canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 8, 64, 64, 62); gr.addColorStop(0, inner); gr.addColorStop(0.55, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc('#fff2c0', 'rgba(255,150,50,0)'), fog: false, depthWrite: false, transparent: true }));
    this.sunSprite.scale.set(2600, 2600, 1); this.scene.add(this.sunSprite);
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc('#e8f1ff', 'rgba(140,170,255,0)'), fog: false, depthWrite: false, transparent: true }));
    this.moonSprite.scale.set(900, 900, 1); this.scene.add(this.moonSprite);
    const starGeo = new THREE.BufferGeometry(), pts = [];
    for (let i = 0; i < 700; i++) { const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.46 + 0.06, r = 8800; pts.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r); }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 13, sizeAttenuation: false, fog: false, transparent: true, opacity: 0 }));
    this.scene.add(this.stars);
  }
  buildWorld(city) {
    this.city = city;
    const S = 2048 / WORLD.w; // ground texture scale
    const groundTex = canvasTex(2048, 1536, (g) => {
      g.fillStyle = '#5d6157'; g.fillRect(0, 0, 2048, 1536);
      for (const pk of city.parks) { g.fillStyle = pk.plaza ? '#8d8578' : '#4a7a4a'; g.fillRect(pk.x * S, pk.y * S, pk.w * S, pk.h * S); }
      g.fillStyle = '#e8cf9e'; g.fillRect(WORLD.beachX * S, 0, (WORLD.waterX - WORLD.beachX) * S, 1536);
      g.fillStyle = '#14507a'; g.fillRect(WORLD.waterX * S, 0, 2048 - WORLD.waterX * S, 1536);
      g.fillStyle = '#c9b183'; g.fillRect(3936 * S, 0, (WORLD.beachX - 3936) * S, 1536); // promenade
      for (const lot of city.lots) { g.fillStyle = '#3c4048'; g.fillRect(lot.x * S, lot.y * S, lot.w * S, lot.h * S);
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
        for (let x = lot.x + 24; x < lot.x + lot.w - 10; x += 52) { g.beginPath(); g.moveTo(x * S, (lot.y + 12) * S); g.lineTo(x * S, (lot.y + 62) * S); g.stroke(); } }
      const road = (x, y, w, h) => { g.fillStyle = '#9aa0a8'; g.fillRect(x, y, w, h); g.fillStyle = '#33363e'; const m = 10; g.fillRect(x + (w > h ? 0 : m), y + (w > h ? m : 0), w - (w > h ? 0 : m * 2), h - (w > h ? m * 2 : 0)); };
      for (const a of AVENUES) road((a - ROAD_W / 2 - 18) * S, 0, (ROAD_W + 36) * S, 1536);
      for (const s of STREETS) road(0, (s - ROAD_W / 2 - 18) * S, WORLD.beachX * S + 30, (ROAD_W + 36) * S);
      g.fillStyle = 'rgba(255,210,90,0.5)';
      for (const a of AVENUES) for (let y = 8; y < 1536; y += 34) g.fillRect(a * S - 1, y, 2, 17);
      for (const s of STREETS) for (let x = 8; x < WORLD.beachX * S; x += 34) g.fillRect(x, s * S - 1, 17, 2);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (const a of AVENUES) for (const s of STREETS) for (let i = -3; i < 4; i++) { g.fillRect((a + i * 16 - 4) * S, (s - ROAD_W / 2 + 4) * S, 8 * S, 14 * S); g.fillRect((a + i * 16 - 4) * S, (s + ROAD_W / 2 - 18) * S, 8 * S, 14 * S); }
      for (const b of city.buildings) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(b.x * S, b.y * S, b.w * S, b.h * S); }
    });
    groundTex.wrapS = groundTex.wrapT = THREE.ClampToEdgeWrapping;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.w, WORLD.h), new THREE.MeshLambertMaterial({ map: groundTex }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(WORLD.w / 2, 0, WORLD.h / 2); ground.receiveShadow = true; this.scene.add(ground);
    // Animated water sheet beyond the shoreline.
    this.waterTex = canvasTex(256, 256, (g) => { g.fillStyle = '#175d8c'; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(160,230,255,0.35)';
      for (let i = 0; i < 26; i++) { const y = Math.random() * 256; g.beginPath(); g.moveTo(Math.random() * 90, y); g.lineTo(90 + Math.random() * 140, y); g.stroke(); } });
    this.waterTex.wrapS = this.waterTex.wrapT = THREE.RepeatWrapping; this.waterTex.repeat.set(3, 9);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1500, WORLD.h), new THREE.MeshPhongMaterial({ map: this.waterTex, color: 0x9fd8ff, shininess: 140, specular: 0x99ccff, transparent: true, opacity: 0.93 }));
    water.rotation.x = -Math.PI / 2; water.position.set(WORLD.waterX + 730, 1.5, WORLD.h / 2); this.scene.add(water);
    this.buildBuildings(city); this.buildPalmsLamps(city); this.buildLights(city);
    // Mission pillar + objective light.
    this.pillar = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 260, 18, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.pillar.position.y = 130; this.scene.add(this.pillar);
    this.objLight = new THREE.PointLight(0xffd23e, 0, 420); this.objLight.position.y = 60; this.scene.add(this.objLight);
    // Tracers + particles pools.
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(64 * 6);
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    this.tracersMesh = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 }));
    this.tracersMesh.frustumCulled = false; this.scene.add(this.tracersMesh);
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(300 * 3); this.pCol = new Float32Array(300 * 3);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.pMesh = new THREE.Points(this.pGeo, new THREE.PointsMaterial({ size: 7, vertexColors: true, transparent: true, opacity: 0.95 }));
    this.pMesh.frustumCulled = false; this.scene.add(this.pMesh);
    this.buildMinimap(city);
  }
  buildBuildings(city) {
    this.buildingMats = [];
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
    for (const b of city.buildings) {
      const tex = canvasTex(256, 256, (g) => {
        g.fillStyle = '#4a4f5e'; g.fillRect(0, 0, 256, 256);
        g.fillStyle = b.neon; g.fillRect(0, 0, 256, 40);
        g.fillStyle = 'rgba(0,0,0,0.75)'; g.font = 'bold 21px Arial'; g.textAlign = 'center';
        const name = b.name.length > 14 ? b.name.slice(0, 14) : b.name;
        g.fillText(name, 128, 28);
        for (let y = 58; y < 244; y += 23) for (let x = 14; x < 236; x += 25) {
          g.fillStyle = Math.random() < 0.52 ? '#ffd98a' : '#232833'; g.fillRect(x, y, 15, 13);
        }
      });
      const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.1 });
      this.buildingMats.push(mat);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.hgt * 3.2, b.h), [mat, mat, roofMat, roofMat, mat, mat]);
      mesh.position.set(b.cx, b.hgt * 1.6, b.cy); mesh.castShadow = !this.lowTier; mesh.receiveShadow = true;
      this.scene.add(mesh);
      // Rooftop props on taller blocks: AC boxes + a water tower silhouette.
      if (b.hgt > 40) { const ac = new THREE.Mesh(new THREE.BoxGeometry(46, 14, 36), roofMat); ac.position.set(b.cx + b.w * 0.22, b.hgt * 3.2 + 7, b.cy - b.h * 0.2); this.scene.add(ac); }
    }
  }
  buildPalmsLamps(city) {
    const trunkGeo = new THREE.CylinderGeometry(2.2, 3.4, 34, 5); trunkGeo.translate(0, 17, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5c38 });
    const frondGeo = (() => { // six tilted leaf planes merged into one geometry
      const parts = [];
      for (let i = 0; i < 6; i++) { const p = new THREE.PlaneGeometry(46, 9); p.translate(21, 0, 0); p.rotateX(-0.5); p.rotateY((i / 6) * Math.PI * 2); p.translate(0, 35, 0); parts.push(p); }
      let pos = [], norm = [], idx = [], base = 0;
      for (const p of parts) { const pa = p.getAttribute('position'), na = p.getAttribute('normal'), ia = p.getIndex();
        for (let i = 0; i < pa.count; i++) { pos.push(pa.getX(i), pa.getY(i), pa.getZ(i)); norm.push(na.getX(i), na.getY(i), na.getZ(i)); }
        for (let i = 0; i < ia.count; i++) idx.push(ia.getX(i) + base); base += pa.count; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
      g.setIndex(idx); return g;
    })();
    const frondMat = new THREE.MeshLambertMaterial({ color: 0x2e8a4e, side: THREE.DoubleSide });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, city.palms.length);
    const fronds = new THREE.InstancedMesh(frondGeo, frondMat, city.palms.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    city.palms.forEach((pl, i) => { e.set(0, (i * 1.7) % 3.1, 0.06 * Math.sin(i)); q.setFromEuler(e); const s = new THREE.Vector3(pl.s, pl.s, pl.s); m4.compose(new THREE.Vector3(pl.x, 0, pl.y), q, s); trunks.setMatrixAt(i, m4); fronds.setMatrixAt(i, m4); });
    this.scene.add(trunks); this.scene.add(fronds);
    const poleGeo = new THREE.CylinderGeometry(1.4, 1.4, 30, 5); poleGeo.translate(0, 15, 0);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x22262c }), city.lamps.length);
    city.lamps.forEach((l, i) => { m4.compose(new THREE.Vector3(l.x, 0, l.y), new THREE.Quaternion(), one); poles.setMatrixAt(i, m4); });
    this.scene.add(poles);
    const glowGeo = new THREE.BufferGeometry(), gp = [];
    for (const l of city.lamps) gp.push(l.x, 31, l.y);
    glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    this.lampGlow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ color: 0xffc37a, size: 26, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.lampGlow);
  }
  buildLights(city) {
    this.trafficHeads = [];
    const poleGeo = new THREE.CylinderGeometry(1.2, 1.2, 34, 5); poleGeo.translate(0, 17, 0);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x1d2026 });
    const boxGeo = new THREE.BoxGeometry(7, 16, 7);
    const lampGeo = new THREE.SphereGeometry(2.6, 8, 6);
    this.tlMats = { r: new THREE.MeshBasicMaterial({ color: 0xff3b30 }), y: new THREE.MeshBasicMaterial({ color: 0xffcc00 }), g: new THREE.MeshBasicMaterial({ color: 0x2eff7a }), off: new THREE.MeshLambertMaterial({ color: 0x14161a }) };
    for (const n of city.intersections) {
      const grp = new THREE.Group(); grp.position.set(n.x + ROAD_W / 2 + 8, 0, n.y + ROAD_W / 2 + 8);
      const pole = new THREE.Mesh(poleGeo, poleMat); grp.add(pole);
      const box = new THREE.Mesh(boxGeo, this.tlMats.off); box.position.y = 36; grp.add(box);
      const lamp = new THREE.Mesh(lampGeo, this.tlMats.g); lamp.position.y = 36; grp.add(lamp);
      this.scene.add(grp); this.trafficHeads.push(lamp);
    }
  }

  // ---------- entity meshes ----------
  carMesh(car) {
    let g = this.carMeshes.get(car.id);
    if (g) return g;
    const spec = CAR_TYPES[car.type], grp = new THREE.Group();
    const paint = new THREE.MeshLambertMaterial({ color: car.kind === 'police' ? 0xf2f2f2 : car.color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(spec.l, 13, spec.w), paint);
    body.position.y = 11; body.castShadow = !this.lowTier; grp.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(spec.l * 0.48, 10, spec.w * 0.82), new THREE.MeshLambertMaterial({ color: 0x1c2733 }));
    cabin.position.set(-spec.l * 0.04, 22, 0); grp.add(cabin);
    if (car.type === 'taxi') { const sign = new THREE.Mesh(new THREE.BoxGeometry(16, 5, 10), new THREE.MeshBasicMaterial({ color: 0xffd23e })); sign.position.set(-4, 30, 0); grp.add(sign); }
    if (car.type === 'sport') { const sp = new THREE.Mesh(new THREE.BoxGeometry(8, 4, spec.w * 0.9), paint); sp.position.set(-spec.l * 0.46, 20, 0); grp.add(sp); }
    if (car.type === 'van' || car.type === 'pickup') body.scale.y = 1.5;
    const wheelGeo = new THREE.CylinderGeometry(8, 8, 5, 10); wheelGeo.rotateX(Math.PI / 2);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x101114 });
    grp.userData.wheels = [];
    for (const [wx, wz] of [[-spec.l * 0.32, -spec.w / 2], [-spec.l * 0.32, spec.w / 2], [spec.l * 0.32, -spec.w / 2], [spec.l * 0.32, spec.w / 2]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(wx, 8, wz); grp.add(w); grp.userData.wheels.push(w);
    }
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 0 });
    for (const s of [-1, 1]) { const hl = new THREE.Mesh(new THREE.SphereGeometry(3.4, 8, 6), lightMat); hl.position.set(spec.l / 2 + 1, 12, s * spec.w * 0.3); grp.add(hl); }
    grp.userData.headlightMat = lightMat;
    if (car.kind === 'police') {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 12), new THREE.MeshLambertMaterial({ color: 0x222222 }));
      bar.position.set(-4, 29, 0); grp.add(bar);
      const mk = (c) => { const sm = new THREE.SpriteMaterial({ map: null, color: c, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }); const sp = new THREE.Sprite(sm); sp.scale.set(46, 22, 1); sp.position.set(-4, 32, 0); grp.add(sp); return sm; };
      grp.userData.barR = mk(0xff2222); grp.userData.barB = mk(0x2266ff);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(spec.l * 0.99, 5, spec.w + 0.6), new THREE.MeshLambertMaterial({ color: 0x2244aa }));
      stripe.position.y = 12; grp.add(stripe);
    }
    if (car.tag === 'coupe' || car.tag === 'job') { const ring = new THREE.Mesh(new THREE.TorusGeometry(40, 2.4, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.8 })); ring.rotation.x = Math.PI / 2; ring.position.y = 2; grp.add(ring); }
    this.scene.add(grp); this.carMeshes.set(car.id, grp);
    return grp;
  }
  pedMesh(ped) {
    let g = this.pedMeshes.get(ped.id);
    if (g) return g;
    const grp = new THREE.Group();
    const colors = { player: 0x22d3ee, officer: 0x24408f, dealer: 0x8f2432, walker: 0x888888 };
    const coat = ped.kind === 'walker' ? new THREE.Color().setHSL(ped.hue / 360, 0.55, 0.5).getHex() : colors[ped.kind];
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(7.5, 15, 3, 8), new THREE.MeshLambertMaterial({ color: coat }));
    body.position.y = 20; body.castShadow = !this.lowTier; grp.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), new THREE.MeshLambertMaterial({ color: 0xe8b98d }));
    head.position.y = 38; grp.add(head);
    if (ped.kind === 'officer') { const cap = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.8, 3.4, 10), new THREE.MeshLambertMaterial({ color: 0x16264f })); cap.position.y = 43; grp.add(cap); }
    this.scene.add(grp); this.pedMeshes.set(ped.id, grp);
    return grp;
  }
  syncEntities(world, dt) {
    const seen = new Set();
    for (const car of world.cars) {
      seen.add(car.id);
      const g = this.carMesh(car);
      g.position.set(car.x, car.wrecked ? -2 : 0, car.y);
      g.rotation.y = -car.a;
      g.rotation.z = car.wrecked ? 0.06 : 0;
      for (const w of g.userData.wheels) w.rotation.z -= (car.spd * dt) / 8;
      if (g.userData.barR) { const ph = Math.sin(world.elapsed * 11) > 0; g.userData.barR.opacity = ph ? 0.95 : 0.08; g.userData.barB.opacity = ph ? 0.08 : 0.95; }
      if (g.userData.headlightMat) g.userData.headlightMat.opacity = this.dark * 0.95;
    }
    for (const [id, g] of this.carMeshes) if (!seen.has(id)) { this.scene.remove(g); this.carMeshes.delete(id); }
    const seenP = new Set();
    for (const ped of world.peds) {
      seenP.add(ped.id);
      const g = this.pedMesh(ped);
      g.position.set(ped.x, ped.dead ? -12 : 0, ped.y);
      g.rotation.set(ped.dead ? Math.PI / 2 : 0, -ped.a, 0);
    }
    for (const [id, g] of this.pedMeshes) if (!seenP.has(id)) { this.scene.remove(g); this.pedMeshes.delete(id); }
    // Pickups as spinning markers.
    if (!this.pickupMeshes) this.pickupMeshes = new Map();
    const seenK = new Set();
    for (const pk of world.pickups) {
      const key = pk.x + ':' + pk.y + ':' + pk.kind; seenK.add(key);
      let mesh = this.pickupMeshes.get(key);
      if (!mesh) { mesh = new THREE.Mesh(new THREE.BoxGeometry(13, 13, 13), new THREE.MeshBasicMaterial({ color: pk.kind === 'cash' ? 0x51ff7a : 0xff5da2 })); this.scene.add(mesh); this.pickupMeshes.set(key, mesh); }
      mesh.position.set(pk.x, 16 + Math.sin(pk.t * 4) * 3, pk.y); mesh.rotation.y += dt * 2.4;
    }
    for (const [k, mesh] of this.pickupMeshes) if (!seenK.has(k)) { this.scene.remove(mesh); this.pickupMeshes.delete(k); }
    // Tracers + particles.
    let ti = 0;
    for (const tr of world.tracers) { if (ti >= 64) break; this.tracerPos.set([tr.x1, 26, tr.y1, tr.x2, 26, tr.y2], ti * 6); ti++; }
    this.tracerGeo.setDrawRange(0, ti * 2); this.tracerGeo.attributes.position.needsUpdate = true;
    let pi = 0;
    for (const p of world.particles) { if (pi >= 300) break; this.pPos.set([p.x, 20, p.y], pi * 3); const c = new THREE.Color(p.color); this.pCol.set([c.r, c.g, c.b], pi * 3); pi++; }
    this.pGeo.setDrawRange(0, pi); this.pGeo.attributes.position.needsUpdate = true; this.pGeo.attributes.color.needsUpdate = true;
    // Objective pillar.
    const obj = world.objective();
    if (obj && world.step) { this.pillar.visible = true; this.pillar.position.x = obj.x; this.pillar.position.z = obj.y; this.objLight.intensity = 900 * this.dark + 200; this.objLight.position.x = obj.x; this.objLight.position.z = obj.y; }
    else { this.pillar.visible = false; this.objLight.intensity = 0; }
  }
  groundPoint(mx, my) {
    const nx = (mx / this.W) * 2 - 1, ny = -(my / this.H) * 2 + 1;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const t = -rc.ray.origin.y / rc.ray.direction.y;
    if (!isFinite(t) || t < 0) return null;
    const p = rc.ray.origin.clone().add(rc.ray.direction.clone().multiplyScalar(t));
    return { x: p.x, y: p.z };
  }
  handleEvent(ev) { if (ev.k === 'crash') this.shake = Math.min(0.6, this.shake + 0.3); if (ev.k === 'shot' && ev.weapon !== 'cop' && ev.weapon !== 'dealer') this.shake = Math.min(0.3, this.shake + 0.05); }
  updateSkyLights(world, dt) {
    const hours = world.timeMin / 60, sky = skyAt(hours);
    this.dark = sky.dark;
    const g = this.skyCanvas.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, sky.top); grad.addColorStop(0.55, sky.mid); grad.addColorStop(0.8, sky.hor); grad.addColorStop(1, sky.hor);
    g.fillStyle = grad; g.fillRect(0, 0, 4, 512); this.skyTex.needsUpdate = true;
    this.scene.fog.color.set(sky.hor);
    const p = world.player;
    this.skyMesh.position.set(p.x, 0, p.y);
    this.stars.position.set(p.x, 0, p.y); this.stars.material.opacity = sky.dark * 0.95;
    const sunA = ((hours - 6) / 12) * Math.PI; // sunrise east -> sunset west
    const elev = Math.sin(sunA);
    this.sunSprite.position.set(p.x + Math.cos(sunA) * 8200, Math.max(120, elev * 5200), p.y - 2600);
    this.sunSprite.material.opacity = clamp(1 - sky.dark * 1.4, 0, 1);
    this.moonSprite.position.set(p.x - Math.cos(sunA) * 7000, 3800, p.y - 2000);
    this.moonSprite.material.opacity = sky.dark;
    // Rig: day sun -> dusk gold -> bright night moonlight.
    this.hemi.intensity = lerp(1.05, 0.82, sky.dark);
    this.hemi.color.copy(new THREE.Color(0xcfe5ff).lerp(new THREE.Color(0x8fb4ff), sky.dark));
    this.amb.intensity = lerp(0.22, 0.36, sky.dark);
    this.sun.intensity = Math.max(sky.sun, sky.dark * 0.55);
    this.sun.color.set(sky.dark > 0.8 ? '#9db8ff' : sky.sunC);
    const sd = sky.dark > 0.8 ? { x: -0.4, y: 0.85, z: -0.3 } : { x: Math.cos(sunA), y: Math.max(0.25, elev), z: -0.35 };
    this.sun.position.set(p.x + sd.x * 1400, sd.y * 1400, p.y + sd.z * 1400);
    this.sun.target.position.set(p.x, 0, p.y);
    for (const m of this.buildingMats) m.emissiveIntensity = lerp(0.06, 1.8, sky.dark);
    this.lampGlow.material.opacity = sky.dark * 0.8;
    this.waterTex.offset.x = world.elapsed * 0.008; this.waterTex.offset.y = Math.sin(world.elapsed * 0.4) * 0.01;
    const phase = (world.elapsed % 9);
    const nsGreen = phase < 4 || (phase >= 8.2);
    for (const lamp of this.trafficHeads) lamp.material = nsGreen ? this.tlMats.g : (phase < 5 ? this.tlMats.y : this.tlMats.r);
  }
  updateCamera(world, dt) {
    const p = world.player;
    const inCar = !!p.car;
    const facing = inCar ? p.car.a : p.a;
    this.yaw += angDiff(this.yaw, facing) * Math.min(1, dt * 3.2);
    const back = inCar ? 235 : 165, up = inCar ? 128 : 92;
    const speedF = inCar ? clamp(Math.abs(p.car.spd) / CAR_TYPES[p.car.type].top, 0, 1) : 0;
    const tx = p.x - Math.cos(this.yaw) * back + Math.cos(this.yaw) * speedF * 30;
    const tz = p.y - Math.sin(this.yaw) * back + Math.sin(this.yaw) * speedF * 30;
    const k = 1 - Math.exp(-dt * 5.2);
    this.camPos.x += (tx - this.camPos.x) * k; this.camPos.z += (tz - this.camPos.z) * k; this.camPos.y += (up - this.camPos.y) * k;
    this.shake = Math.max(0, this.shake - dt * 1.4);
    const shx = (Math.random() - 0.5) * this.shake * 22, shy = (Math.random() - 0.5) * this.shake * 14;
    this.camera.position.set(this.camPos.x + shx, this.camPos.y + shy, this.camPos.z);
    const lx = p.x + Math.cos(this.yaw) * 130, lz = p.y + Math.sin(this.yaw) * 130;
    this.camera.lookAt(lx, 6, lz);
    const wantFov = 55 + speedF * 15;
    if (Math.abs(wantFov - this.fov) > 0.1) { this.fov = wantFov; this.camera.fov = wantFov; this.camera.updateProjectionMatrix(); }
  }
  render(world, ui, dt) {
    this.updateSkyLights(world, dt);
    this.syncEntities(world, dt);
    this.updateCamera(world, dt);
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(world, ui);
  }

  // ---------- 2D overlay: HUD, minimap, screens ----------
  buildMinimap(city) {
    const c = document.createElement('canvas'); c.width = 264; c.height = 198;
    const g = c.getContext('2d'), sx = 264 / WORLD.w, sy = 198 / WORLD.h;
    g.fillStyle = '#20242c'; g.fillRect(0, 0, 264, 198);
    g.fillStyle = '#175d8c'; g.fillRect(WORLD.waterX * sx, 0, 264 - WORLD.waterX * sx, 198);
    g.fillStyle = '#e8cf9e'; g.fillRect(WORLD.beachX * sx, 0, (WORLD.waterX - WORLD.beachX) * sx, 198);
    g.fillStyle = '#4a7a4a'; for (const pk of city.parks) g.fillRect(pk.x * sx, pk.y * sy, pk.w * sx, pk.h * sy);
    g.strokeStyle = '#aab3bd'; g.lineWidth = 3;
    for (const a of AVENUES) { g.beginPath(); g.moveTo(a * sx, 0); g.lineTo(a * sx, 198); g.stroke(); }
    for (const s of STREETS) { g.beginPath(); g.moveTo(0, s * sy); g.lineTo(WORLD.beachX * sx, s * sy); g.stroke(); }
    g.fillStyle = '#565e6a'; for (const b of city.buildings) g.fillRect(b.x * sx, b.y * sy, b.w * sx, b.h * sy);
    g.font = 'bold 8px Arial'; g.textAlign = 'center';
    for (const pl of city.places) { g.fillStyle = '#ffd23e'; g.beginPath(); g.arc(pl.x * sx, pl.y * sy, 5.5, 0, 7); g.fill(); g.fillStyle = '#10131a'; g.fillText(pl.icon, pl.x * sx, pl.y * sy + 3); }
    this.minimapBase = c; this.mmSx = sx; this.mmSy = sy;
  }
  drawMinimap(world) {
    const g = this.hx, w = 264, h = 198, x0 = 16, y0 = this.H - h - 16;
    g.save();
    g.beginPath(); g.roundRect(x0, y0, w, h, 10); g.clip();
    g.globalAlpha = 0.92; g.drawImage(this.minimapBase, x0, y0); g.globalAlpha = 1;
    const px = world.player.x * this.mmSx, py = world.player.y * this.mmSy;
    const obj = world.objective();
    if (obj && world.step) { g.strokeStyle = '#ffd23e'; g.lineWidth = 2; g.beginPath(); g.arc(x0 + obj.x * this.mmSx, y0 + obj.y * this.mmSy, 6 + Math.sin(world.elapsed * 5) * 1.6, 0, 7); g.stroke(); }
    if (world.stars > 0) { g.fillStyle = '#4d7dff'; for (const c of world.cars) if (c.kind === 'police') { g.beginPath(); g.arc(x0 + c.x * this.mmSx, y0 + c.y * this.mmSy, 3, 0, 7); g.fill(); } }
    g.save(); g.translate(x0 + px, y0 + py); g.rotate(world.player.a);
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(8, 0); g.lineTo(-6, -5); g.lineTo(-6, 5); g.closePath(); g.fill(); g.restore();
    g.restore();
    g.strokeStyle = 'rgba(34,211,238,0.8)'; g.lineWidth = 2; g.beginPath(); g.roundRect(x0, y0, w, h, 10); g.stroke();
  }
  panel(x, y, w, h, accent = '#22d3ee') {
    const g = this.hx;
    g.fillStyle = 'rgba(8,12,20,0.72)'; g.beginPath(); g.roundRect(x, y, w, h, 10); g.fill();
    g.fillStyle = accent; g.fillRect(x, y, 3, h);
  }
  drawOverlay(world, ui) {
    const g = this.hx, W = this.W, H = this.H, p = world.player;
    g.clearRect(0, 0, W, H);
    // Soft permanent vignette.
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.34)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    if (ui.screen === 'title') { this.drawTitle(world, ui); return; }
    // HUD: money + health.
    this.panel(16, 16, 252, 74);
    g.fillStyle = '#51ff7a'; g.font = 'bold 30px Arial'; g.textAlign = 'left';
    g.shadowColor = '#51ff7a'; g.shadowBlur = 10; g.fillText('$' + p.money.toLocaleString('en-US'), 30, 52); g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(30, 62, 220, 9);
    g.fillStyle = p.hp > 30 ? '#ff5d7a' : '#ff2222'; g.fillRect(30, 62, 220 * clamp(p.hp / PLAYER.hp, 0, 1), 9);
    // Stars + clock.
    const hh = String(Math.floor(world.timeMin / 60)).padStart(2, '0'), mm = String(Math.floor(world.timeMin % 60)).padStart(2, '0');
    g.textAlign = 'right'; g.font = 'bold 24px Arial';
    const blink = world.heat > 0 && world.lastSeenT > 1.2 && Math.sin(world.elapsed * 6) > 0;
    for (let i = 0; i < 5; i++) { g.fillStyle = i < world.stars ? '#ffd23e' : 'rgba(255,255,255,0.22)'; if (i < world.stars && blink) g.fillStyle = 'rgba(255,210,62,0.25)'; g.fillText('★', W - 26 - (4 - i) * 30, 46); }
    g.fillStyle = '#dfe9ff'; g.font = '16px Arial'; g.fillText(hh + ':' + mm, W - 26, 72);
    // Objective banner.
    const obj = world.objective();
    if (obj) {
      const label = obj.label + (world.step && obj.dist > 0 ? '  ·  ' + Math.round(obj.dist / 10) * 10 + 'm' : '');
      g.font = 'bold 17px Arial'; const tw = g.measureText(label).width + 44;
      this.panel(W / 2 - tw / 2, 16, tw, 40, '#ffd23e');
      g.fillStyle = '#ffe9a0'; g.textAlign = 'center'; g.fillText(label, W / 2, 43);
    }
    // Toasts.
    g.font = '15px Arial'; g.textAlign = 'center';
    world.toasts.forEach((t, i) => { g.fillStyle = `rgba(230,240,255,${clamp(t.t, 0, 1)})`; g.fillText(t.text, W / 2, 84 + i * 21); });
    // Weapon / speed readout.
    g.textAlign = 'right'; g.font = 'bold 16px Arial'; g.fillStyle = '#dfe9ff';
    if (p.car) { g.fillText(Math.round(Math.abs(p.car.spd) * 0.36) + ' km/h', W - 26, H - 44); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(W - 186, H - 34, 160, 7); g.fillStyle = '#7ac7ff'; g.fillRect(W - 186, H - 34, 160 * clamp(p.car.hp / 100, 0, 1), 7); }
    else g.fillText(WEAPONS[p.weapon].name.toUpperCase(), W - 26, H - 24);
    // Context prompt + channel/busted meters.
    const prompt = world.prompt();
    if (prompt && !world.channel) { g.textAlign = 'center'; g.font = 'bold 16px Arial'; g.fillStyle = '#aef3ff'; g.fillText(prompt, W / 2, H - 26); }
    if (world.channel) {
      const f = clamp(world.channel.t / world.channel.dur, 0, 1);
      g.fillStyle = 'rgba(8,12,20,0.7)'; g.beginPath(); g.roundRect(W / 2 - 130, H / 2 + 60, 260, 16, 8); g.fill();
      g.fillStyle = '#ffd23e'; g.beginPath(); g.roundRect(W / 2 - 130, H / 2 + 60, 260 * f, 16, 8); g.fill();
    }
    if (world.bustedMeter > 0.03) {
      g.textAlign = 'center'; g.font = 'bold 22px Arial'; g.fillStyle = '#ff5d5d';
      g.fillText('BUSTED', W / 2, H / 2 - 58);
      g.fillStyle = 'rgba(8,12,20,0.7)'; g.fillRect(W / 2 - 110, H / 2 - 48, 220, 12);
      g.fillStyle = '#ff3b30'; g.fillRect(W / 2 - 110, H / 2 - 48, 220 * world.bustedMeter, 12);
    }
    this.drawMinimap(world);
    if (world.storyNoticeT > 0) {
      g.fillStyle = 'rgba(255,210,62,0.92)'; g.font = 'bold 30px Arial'; g.textAlign = 'center';
      g.fillText('★ STORY COMPLETE ★', W / 2, 118);
    }
    if (ui.screen === 'pause') this.drawPause(world);
    if (world.notice) this.drawNotice(world);
  }
  drawTitle(world, ui) {
    const g = this.hx, W = this.W, H = this.H;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(10,6,32,0.25)'); grad.addColorStop(0.6, 'rgba(40,8,48,0.35)'); grad.addColorStop(1, 'rgba(4,4,14,0.78)');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    // Retro striped sunset behind the logo.
    const cx = W / 2, cy = H * 0.34, R = Math.min(W, H) * 0.21;
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
    const sg = g.createLinearGradient(0, cy - R, 0, cy + R);
    sg.addColorStop(0, '#ffd23e'); sg.addColorStop(0.55, '#ff8a3e'); sg.addColorStop(1, '#ff3e8a');
    g.fillStyle = sg; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.fillStyle = 'rgba(20,4,32,0.85)';
    for (let i = 0; i < 5; i++) g.fillRect(cx - R, cy + R * 0.08 + i * R * 0.17, R * 2, R * (0.03 + i * 0.016));
    g.restore();
    g.strokeStyle = '#22d3ee'; g.lineWidth = 3; g.beginPath(); g.roundRect(W / 2 - 330, H * 0.1, 660, H * 0.72, 14); g.stroke();
    g.strokeStyle = 'rgba(255,93,162,0.7)'; g.lineWidth = 1.5; g.beginPath(); g.roundRect(W / 2 - 322, H * 0.1 + 8, 644, H * 0.72 - 16, 12); g.stroke();
    g.textAlign = 'center';
    g.font = 'bold 92px Arial'; g.shadowColor = '#ff5da2'; g.shadowBlur = 34;
    g.fillStyle = '#fff3fa'; g.fillText('NEON BAY', cx, cy + R + 88);
    g.shadowColor = '#22d3ee'; g.shadowBlur = 22; g.fillStyle = '#aef3ff'; g.font = 'bold 21px Arial';
    g.fillText('a neon crime story on a tropical shore', cx, cy + R + 124); g.shadowBlur = 0;
    g.font = '17px Arial'; g.fillStyle = '#e8ecff';
    g.fillText('ENTER — start' + (ui.hasSave ? '      C — continue' : ''), cx, H * 0.78);
    g.font = '13.5px Arial'; g.fillStyle = 'rgba(220,228,255,0.75)';
    g.fillText('WASD drive & walk · mouse aim · click shoot · E enter/use · 1-4/Q weapons · Shift run · P pause · M mute', cx, H * 0.78 + 28);
  }
  drawPause(world) {
    const g = this.hx, W = this.W, H = this.H, s = world.stats, p = world.player;
    g.fillStyle = 'rgba(3,5,10,0.62)'; g.fillRect(0, 0, W, H);
    this.panel(W / 2 - 235, H / 2 - 170, 470, 340, '#ff5da2');
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = 'bold 30px Arial'; g.fillText('PAUSED', W / 2, H / 2 - 122);
    g.font = '16.5px Arial'; g.fillStyle = '#dfe9ff'; g.textAlign = 'left';
    const rows = [
      ['Missions done', s.missionsDone + ' / 6'],
      ['Money', '$' + p.money.toLocaleString('en-US')],
      ['Best money', '$' + Math.max(s.bestMoney, p.money).toLocaleString('en-US')],
      ['Cars stolen', String(s.carsStolen)],
      ['Shots fired', String(s.shotsFired)],
      ['Time played', Math.floor(s.timePlayed / 60) + 'm ' + Math.floor(s.timePlayed % 60) + 's'],
      ['Weapons', ['fist', 'pistol', 'smg', 'shotgun'].filter(w => p.owned[w]).map(w => WEAPONS[w].name).join(', ')],
    ];
    rows.forEach((r, i) => { g.fillStyle = 'rgba(200,214,255,0.65)'; g.fillText(r[0], W / 2 - 205, H / 2 - 78 + i * 27); g.fillStyle = '#fff'; g.textAlign = 'right'; g.fillText(r[1], W / 2 + 205, H / 2 - 78 + i * 27); g.textAlign = 'left'; });
    g.textAlign = 'center'; g.font = '15px Arial'; g.fillStyle = '#aef3ff';
    g.fillText('P resume · S save · M mute · Enter resume', W / 2, H / 2 + 142);
  }
  drawNotice(world) {
    const g = this.hx, W = this.W, H = this.H, n = world.notice;
    g.fillStyle = n.kind === 'wasted' ? 'rgba(60,0,0,0.45)' : 'rgba(0,10,50,0.45)'; g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.font = 'bold 74px Arial'; g.shadowBlur = 26;
    if (n.kind === 'wasted') { g.fillStyle = '#ff3b30'; g.shadowColor = '#ff3b30'; g.fillText('WASTED', W / 2, H / 2); }
    else { g.fillStyle = '#7ac7ff'; g.shadowColor = '#4d7dff'; g.fillText('BUSTED', W / 2, H / 2); }
    g.shadowBlur = 0; g.font = '17px Arial'; g.fillStyle = '#e8ecff';
    g.fillText('Fine paid: $' + (n.fine || 0), W / 2, H / 2 + 38);
  }
}
