// The flooded city: climbable platforms, the rising water, rain, lightning and the skyline.
import * as THREE from 'three';

const FLOOR = -60; // where building columns end, far below the water
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const WALL_COLORS = ['#e9dcc4', '#f1c6a6', '#c9d8e4', '#e8e1a8', '#d7c3e0', '#bfe0cf', '#f0f0ea', '#e6b8a2'];
const ROOF_COLORS = ['#9a5b3c', '#6f7b84', '#8a3b2e', '#5b6b5a', '#7d6a58'];
const ADS = [
  ['MAMA T', 'JOLLOF', '#e84118'],
  ['WE SELL', 'GEN', '#273c75'],
  ['RAIN NO', 'DEY STOP', '#0097e6'],
  ['GO SLOW?', 'TAKE OKADA', '#e1b12c'],
  ['FRESH', 'SUYA', '#c23616'],
  ['CLIMB', 'HIGHER', '#44bd32'],
];

// Half-size of the top you can land on, for a platform of the given type and footprint.
const DANFO_INSET = 0.3;
const TANK_TOP = 0.95;
function standable(type, hx, hz) {
  if (type === 'danfo') return [hx - DANFO_INSET, hz - DANFO_INSET];
  if (type === 'tank') return [TANK_TOP, TANK_TOP];
  return [hx, hz];
}

// ── Shared textures ──
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const windowTexture = canvasTexture(128, 128, (g, w, h) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#c8c8c8';
  g.fillRect(0, 120, w, 8); // floor line
  for (const x of [20, 76]) {
    g.fillStyle = '#3c4a57';
    g.fillRect(x, 30, 34, 56);
    g.fillStyle = '#5e7182';
    g.fillRect(x + 3, 33, 13, 50);
    g.fillStyle = '#9aa7b3';
    g.fillRect(x - 3, 86, 40, 5); // sill
  }
});
windowTexture.wrapS = windowTexture.wrapT = THREE.RepeatWrapping;

// corrugated roof sheets: soft ridges (hard stripes shimmer at a distance)
const roofTexture = canvasTexture(64, 64, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 32, 0);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#dcdcdc');
  grad.addColorStop(1, '#ffffff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, h);
  g.drawImage(g.canvas, 0, 0, 32, h, 32, 0, 32, h); // second ridge
});
roofTexture.wrapS = roofTexture.wrapT = THREE.RepeatWrapping;

function adTexture([line1, line2, color]) {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.fillRect(8, 8, w - 16, h - 16);
    g.fillStyle = color;
    g.textAlign = 'center';
    g.font = 'bold 40px Arial, sans-serif';
    g.fillText(line1, w / 2, 56);
    g.font = 'bold 34px Arial, sans-serif';
    g.fillText(line2, w / 2, 100);
  });
}
const adTextures = ADS.map(adTexture);

const sachetTexture = canvasTexture(64, 64, (g, w, h) => {
  g.fillStyle = '#e8f6ff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#1e90ff';
  g.fillRect(0, 22, w, 20);
  g.fillStyle = '#ffffff';
  g.font = 'bold 13px Arial';
  g.textAlign = 'center';
  g.fillText('PURE', w / 2, 37);
});

// Scales a box's side UVs so the window texture repeats every 2.4 m across and 3 m up.
function tileBoxUVs(geometry, w, h, d) {
  const uv = geometry.attributes.uv;
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = sizes[face];
    const ru = face === 2 || face === 3 ? su / 0.8 : Math.max(1, Math.round(su / 2.4));
    const rv = face === 2 || face === 3 ? sv / 0.8 : sv / 3;
    for (let i = 0; i < 4; i++) {
      const k = face * 4 + i;
      uv.setXY(k, uv.getX(k) * ru, uv.getY(k) * rv);
    }
  }
}

// ── Platforms ──
// A platform has one or more solid boxes (min/max in world space), a footprint for spacing,
// and a visual group. Moving platforms shift their boxes each frame and report `delta`.
class Platform {
  constructor({ type, x, z, top, hx, hz }) {
    Object.assign(this, { type, x, z, top, hx, hz });
    this.boxes = [];
    this.group = new THREE.Group();
    this.delta = new THREE.Vector3();
    this.motion = null;
    this.sachet = null;
    this.disposables = [];
  }
  addBox(cx, cz, hx, hz, minY, maxY) {
    const box = {
      min: new THREE.Vector3(cx - hx, minY, cz - hz),
      max: new THREE.Vector3(cx + hx, maxY, cz + hz),
      platform: this,
    };
    this.boxes.push(box);
    return box;
  }
  mesh(geometry, material, x, y, z, { shadow = true } = {}) {
    this.disposables.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.platforms = [];
    this.time = 0;
    this.waterLevel = -4;

    this.mats = {
      roofs: ROOF_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, map: roofTexture, roughness: 0.8 })),
      walls: WALL_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, map: windowTexture, roughness: 0.9 })),
      trims: WALL_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c).multiplyScalar(0.8), roughness: 0.9 })),
      danfo: new THREE.MeshStandardMaterial({ color: '#f5c518', roughness: 0.5 }),
      black: new THREE.MeshStandardMaterial({ color: '#1e1e22', roughness: 0.7 }),
      glass: new THREE.MeshStandardMaterial({ color: '#2a3946', roughness: 0.2, metalness: 0.4 }),
      steel: new THREE.MeshStandardMaterial({ color: '#7f8890', roughness: 0.5, metalness: 0.5 }),
      tank: new THREE.MeshStandardMaterial({ color: '#202124', roughness: 0.55 }),
      concrete: new THREE.MeshStandardMaterial({ color: '#9aa0a4', roughness: 0.95 }),
      ads: adTextures.map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.6 })),
      sachet: new THREE.MeshStandardMaterial({ map: sachetTexture, roughness: 0.3, emissive: '#2d7fd0', emissiveIntensity: 0.35 }),
    };

    this.buildSky();
    this.buildSkyline();
    this.buildWater();
    this.buildRain();
    this.buildDebris();
    this.reset();
  }

  // ── Generation ──
  reset() {
    for (const p of this.platforms) this.removePlatform(p);
    this.platforms = [];
    this.waterLevel = -4;
    this.baseHeading = rand(0, Math.PI * 2);
    this.heading = this.baseHeading;
    const start = this.makeRoof(0, 0, 0, 3.6, 3.6, { start: true });
    this.platforms.push(start);
    this.ensureAhead(start.top + 30);
  }

  ensureAhead(height) {
    let last = this.platforms[this.platforms.length - 1];
    while (last.top < height) {
      last = this.nextPlatform(last);
      this.platforms.push(last);
    }
  }

  // Picks a spot for the next platform: reachable with one jump, not overlapping recent
  // platforms, and with a clear path between the two.
  nextPlatform(prev) {
    const level = this.platforms.length;
    const d = Math.min(1, prev.top / 140); // difficulty 0 → 1 over the first 140 m
    const recent = this.platforms.slice(-14);

    for (let attempt = 0; attempt < 40; attempt++) {
      const type = level < 4 ? 'roof' : pick(['roof', 'roof', 'roof', 'danfo', 'danfo', 'tank', 'tank', 'billboard']);
      const [hx, hz] = this.sizeFor(type);
      const rise = Math.min(1.55, rand(0.55, 1.15) + d * rand(0, 0.45));
      // Billboards slide higher up; shrink the gap by how far either end can slide away.
      const slide = type === 'billboard' && d > 0.18 ? 0.5 + d * 0.5 : 0;
      // Never longer than a full-speed jump to this rise can carry, minus a margin for imperfect take-offs.
      const reach = 6.4 * (10.5 + Math.sqrt(10.5 * 10.5 - 52 * rise)) / 26;
      const gap = Math.max(0.5, Math.min(reach - 1.1, rand(0.7, 1.5 + d * 1.5)) - slide - (prev.motion?.amp ?? 0));

      // The path winds forward across the city instead of circling, so the climb
      // always has open water behind it and new rooftops ahead.
      let heading = this.heading + rand(-0.9, 0.9);
      const drift = Math.atan2(Math.sin(heading - this.baseHeading), Math.cos(heading - this.baseHeading));
      heading = this.baseHeading + THREE.MathUtils.clamp(drift, -1.15, 1.15);
      const dx = Math.cos(heading);
      const dz = Math.sin(heading);
      // Gaps are measured between the parts you can stand on, which for danfos and
      // tanks are smaller than the building or stand under them.
      const support = ([ax, az]) => ax * Math.abs(dx) + az * Math.abs(dz);
      const centerDist = support(standable(prev.type, prev.hx, prev.hz)) + support(standable(type, hx, hz)) + gap;
      const x = prev.x + dx * centerDist;
      const z = prev.z + dz * centerDist;

      const overlaps = recent.some((p) => p !== prev &&
        Math.abs(p.x - x) < p.hx + hx + 1.2 && Math.abs(p.z - z) < p.hz + hz + 1.2);
      if (overlaps) continue;

      let blocked = false;
      for (let t = 0.15; t <= 0.85 && !blocked; t += 0.1) {
        const px = prev.x + (x - prev.x) * t;
        const pz = prev.z + (z - prev.z) * t;
        blocked = recent.some((p) => p !== prev && Math.abs(p.x - px) < p.hx + 0.5 && Math.abs(p.z - pz) < p.hz + 0.5);
      }
      if (blocked) continue;

      this.heading = heading;
      return this.make(type, x, z, prev.top + rise, hx, hz, slide);
    }
    // Fallback: a small rise in the current direction, close enough to always reach.
    const x = prev.x + Math.cos(this.heading) * (prev.hx + 2.4);
    const z = prev.z + Math.sin(this.heading) * (prev.hz + 2.4);
    return this.makeRoof(x, z, prev.top + 0.8, 1.4, 1.4);
  }

  sizeFor(type) {
    switch (type) {
      case 'danfo': return Math.random() < 0.5 ? [1.3, 2.5] : [2.5, 1.3];
      case 'tank': return [1.15, 1.15];
      case 'billboard': return Math.random() < 0.5 ? [2.0, 0.7] : [0.7, 2.0];
      default: return [rand(1.3, 2.4), rand(1.3, 2.4)];
    }
  }

  make(type, x, z, top, hx, hz, slide) {
    let p;
    if (type === 'danfo') p = this.makeDanfo(x, z, top, hx, hz);
    else if (type === 'tank') p = this.makeTank(x, z, top);
    else if (type === 'billboard') p = this.makeBillboard(x, z, top, hx, hz, slide);
    else p = this.makeRoof(x, z, top, hx, hz);
    if (Math.random() < 0.45) this.addSachet(p);
    return p;
  }

  register(p) {
    this.scene.add(p.group);
    return p;
  }

  building(p, x, z, hx, hz, top) {
    const w = hx * 2;
    const dpt = hz * 2;
    const h = top - FLOOR;
    const g = new THREE.BoxGeometry(w, h, dpt);
    tileBoxUVs(g, w, h, dpt);
    const i = Math.floor(Math.random() * WALL_COLORS.length);
    const wall = this.mats.walls[i];
    const roof = pick(this.mats.roofs);
    p.mesh(g, [wall, wall, roof, wall, wall, wall], x, FLOOR + h / 2, z);
    // parapet lip so roofs read as roofs
    const lip = new THREE.BoxGeometry(w + 0.12, 0.12, dpt + 0.12);
    p.mesh(lip, this.mats.trims[i], x, top - 0.06, z, { shadow: false });
    p.addBox(x, z, hx, hz, FLOOR, top);
  }

  makeRoof(x, z, top, hx, hz, { start = false } = {}) {
    const p = new Platform({ type: 'roof', x, z, top, hx, hz });
    this.building(p, x, z, hx, hz, top);
    if (!start && Math.random() < 0.35) {
      // satellite dish / antenna decoration (not solid, kept to an edge)
      const mast = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6);
      p.mesh(mast, this.mats.steel, x + hx - 0.25, top + 0.55, z - hz + 0.25);
    }
    if (start) {
      const sign = new THREE.BoxGeometry(2.4, 0.9, 0.12);
      const m = p.mesh(sign, this.mats.ads[5], x, top + 1.4, z - hz + 0.1);
      const pole = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6);
      p.mesh(pole, this.mats.steel, x - 0.9, top + 0.5, z - hz + 0.1);
      p.mesh(pole.clone(), this.mats.steel, x + 0.9, top + 0.5, z - hz + 0.1);
      m.castShadow = true;
      p.boxes[0].isStart = true;
    }
    return this.register(p);
  }

  // A yellow Lagos danfo stuck on a flyover pillar. The bus roof is the platform top, and the
  // bus overhangs the pillar so there's no ledge beside it to get trapped on.
  makeDanfo(x, z, top, hx, hz) {
    const p = new Platform({ type: 'danfo', x, z, top, hx, hz });
    const roofTop = top - 1.5;
    const alongX = hx > hz;
    const [bx, bz] = standable('danfo', hx, hz);
    const L = Math.max(bx, bz) * 2;
    const [px, pz] = [Math.max(0.4, bx - 0.7), Math.max(0.4, bz - 0.35)];
    const pillarH = roofTop - FLOOR;
    p.mesh(new THREE.BoxGeometry(px * 2, pillarH, pz * 2), this.mats.concrete, x, FLOOR + pillarH / 2, z);
    p.mesh(new THREE.BoxGeometry(bx * 2 + 0.2, 0.25, bz * 2 + 0.2), this.mats.concrete, x, roofTop - 0.125, z);
    p.addBox(x, z, px, pz, FLOOR, roofTop - 0.25);
    p.addBox(x, z, bx + 0.1, bz + 0.1, roofTop - 0.25, roofTop);
    p.mesh(new THREE.BoxGeometry(bx * 2, 1.4, bz * 2), this.mats.danfo, x, roofTop + 0.8, z);
    // black stripes + windows on both long sides
    for (const s of [-1, 1]) {
      const stripe = alongX ? new THREE.BoxGeometry(L + 0.02, 0.12, 0.02) : new THREE.BoxGeometry(0.02, 0.12, L + 0.02);
      const win = alongX ? new THREE.BoxGeometry(L - 0.6, 0.45, 0.03) : new THREE.BoxGeometry(0.03, 0.45, L - 0.6);
      const ox = alongX ? 0 : s * (bx + 0.01);
      const oz = alongX ? s * (bz + 0.01) : 0;
      p.mesh(stripe, this.mats.black, x + ox, roofTop + 0.55, z + oz, { shadow: false });
      p.mesh(stripe.clone(), this.mats.black, x + ox, roofTop + 0.72, z + oz, { shadow: false });
      p.mesh(win, this.mats.glass, x + ox, roofTop + 1.12, z + oz, { shadow: false });
      for (const e of [-1, 1]) {
        const wheel = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12);
        const wx = alongX ? e * (L / 2 - 0.8) : s * (bx - 0.05);
        const wz = alongX ? s * (bz - 0.05) : e * (L / 2 - 0.8);
        const m = p.mesh(wheel, this.mats.black, x + wx, roofTop + 0.3, z + wz, { shadow: false });
        if (alongX) m.rotation.x = Math.PI / 2;
        else m.rotation.z = Math.PI / 2;
      }
    }
    p.addBox(x, z, bx, bz, roofTop, top);
    p.top = top;
    return this.register(p);
  }

  // A black water tank on a tall steel stand.
  makeTank(x, z, top) {
    const p = new Platform({ type: 'tank', x, z, top, hx: 1.15, hz: 1.15 });
    p.mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.4, 20), this.mats.tank, x, top - 0.7, z);
    p.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12), this.mats.tank, x, top + 0.02, z, { shadow: false });
    p.mesh(new THREE.BoxGeometry(2.3, 0.14, 2.3), this.mats.steel, x, top - 1.47, z);
    const legH = top - 1.54 - FLOOR;
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      p.mesh(new THREE.BoxGeometry(0.14, legH, 0.14), this.mats.steel, x + lx * 1.0, FLOOR + legH / 2, z + lz * 1.0);
    }
    p.addBox(x, z, TANK_TOP, TANK_TOP, top - 1.4, top);
    p.addBox(x, z, 1.15, 1.15, top - 1.54, top - 1.4);
    return this.register(p);
  }

  // A billboard you stand on top of. Higher up, billboards slide side to side.
  makeBillboard(x, z, top, hx, hz, slide) {
    const p = new Platform({ type: 'billboard', x, z, top, hx, hz });
    const alongX = hx > hz;
    const boardW = Math.max(hx, hz) * 2;
    const board = new THREE.Group();
    const ad = pick(this.mats.ads);
    const front = new THREE.BoxGeometry(alongX ? boardW : 0.3, 2.0, alongX ? 0.3 : boardW);
    p.disposables.push(front);
    const sides = [this.mats.steel, this.mats.steel, this.mats.steel, this.mats.steel, this.mats.steel, this.mats.steel];
    if (alongX) { sides[4] = ad; sides[5] = ad; } else { sides[0] = ad; sides[1] = ad; }
    const m = new THREE.Mesh(front, sides);
    m.position.set(0, top - 1.0, 0);
    m.castShadow = m.receiveShadow = true;
    board.add(m);
    const walk = new THREE.BoxGeometry(hx * 2, 0.1, hz * 2);
    p.disposables.push(walk);
    const wm = new THREE.Mesh(walk, this.mats.steel);
    wm.position.y = top - 0.05;
    wm.receiveShadow = true;
    board.add(wm);
    board.position.set(x, 0, z);
    p.group.add(board);
    const poleH = top - 2.0 - FLOOR;
    for (const s of [-0.6, 0.6]) {
      const off = s * (boardW / 2);
      p.mesh(new THREE.CylinderGeometry(0.12, 0.12, poleH, 8), this.mats.steel,
        x + (alongX ? off : 0), FLOOR + poleH / 2, z + (alongX ? 0 : off));
    }
    p.addBox(x, z, hx, hz, top - 2.0, top);
    if (slide > 0) {
      p.motion = { node: board, axis: alongX ? 'x' : 'z', amp: slide, speed: 0.5 + slide * 0.6, phase: rand(0, 6), offset: 0 };
    }
    return this.register(p);
  }

  addSachet(p) {
    const g = new THREE.BoxGeometry(0.34, 0.07, 0.46);
    p.disposables.push(g);
    const m = new THREE.Mesh(g, this.mats.sachet);
    m.castShadow = true;
    m.position.set(p.x + rand(-0.4, 0.4) * p.hx, p.top + 0.9, p.z + rand(-0.4, 0.4) * p.hz);
    p.group.add(m);
    p.sachet = m;
  }

  removePlatform(p) {
    this.scene.remove(p.group);
    for (const g of p.disposables) g.dispose();
  }

  // ── Scenery ──
  buildSky() {
    const geo = new THREE.SphereGeometry(500, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { flash: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; uniform float flash;
        void main(){ float h = clamp(vP.y*0.5+0.5,0.0,1.0);
          vec3 low = vec3(0.56,0.62,0.67); vec3 high = vec3(0.24,0.28,0.34);
          vec3 c = mix(low, high, smoothstep(0.45,1.0,h)) + flash*vec3(0.55,0.6,0.7);
          gl_FragColor = vec4(c,1.0); }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);
  }

  buildSkyline() {
    const count = 90;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: '#7a8794', roughness: 1 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.03, 0.03);
      const r = rand(45, 110);
      const h = Math.random() < 0.15 ? rand(120, 260) : rand(20, 90);
      const w = rand(5, 14);
      m.compose(
        new THREE.Vector3(Math.cos(a) * r, FLOOR + h / 2, Math.sin(a) * r),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, Math.PI)),
        new THREE.Vector3(w, h, rand(5, 14)),
      );
      inst.setMatrixAt(i, m);
    }
    this.skyline = inst;
    this.scene.add(inst);
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(240, 240, 96, 96);
    geo.rotateX(-Math.PI / 2);
    this.waterBase = Float32Array.from(geo.attributes.position.array);
    // light ripple streaks over muddy water, scrolled each frame
    this.rippleTexture = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#9a9a9a';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 140; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const len = 10 + Math.random() * 34;
        g.strokeStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.35})`;
        g.lineWidth = 1 + Math.random() * 2;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + len / 2, y - 3 - Math.random() * 3, x + len, y);
        g.stroke();
      }
    });
    this.rippleTexture.wrapS = this.rippleTexture.wrapT = THREE.RepeatWrapping;
    this.rippleTexture.repeat.set(40, 40);
    const mat = new THREE.MeshStandardMaterial({
      color: '#8a7656', map: this.rippleTexture, roughness: 0.18, metalness: 0.35, transparent: true, opacity: 0.94,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  // Lets the water reflect the stormy sky.
  useReflections(renderer) {
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(this.sky.geometry, this.sky.material));
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.water.material.envMap = pmrem.fromScene(envScene, 0.02).texture;
    this.water.material.envMapIntensity = 1.2;
    this.water.material.needsUpdate = true;
    pmrem.dispose();
  }

  buildRain() {
    const count = 2200;
    const pos = new Float32Array(count * 6);
    this.rainSpeed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = rand(-30, 30);
      const y = rand(-15, 25);
      const z = rand(-30, 30);
      pos.set([x, y, z, x + 0.05, y - 0.7, z + 0.02], i * 6);
      this.rainSpeed[i] = rand(24, 34);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#c3d0dc', transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  buildDebris() {
    this.debris = [];
    const crate = new THREE.BoxGeometry(0.8, 0.5, 0.8);
    const tyre = new THREE.TorusGeometry(0.4, 0.16, 8, 16);
    const can = new THREE.BoxGeometry(0.35, 0.5, 0.22);
    const mats = [
      new THREE.MeshStandardMaterial({ color: '#8b6a43', roughness: 0.9 }),
      this.mats.black,
      new THREE.MeshStandardMaterial({ color: '#f1c40f', roughness: 0.6 }),
    ];
    const kinds = [crate, tyre, can];
    for (let i = 0; i < 26; i++) {
      const k = i % 3;
      const m = new THREE.Mesh(kinds[k], mats[k]);
      if (k === 1) m.rotation.x = Math.PI / 2;
      m.userData = { x: rand(-25, 25), z: rand(-25, 25), vx: rand(-0.4, 0.4), vz: rand(-0.4, 0.4), spin: rand(-0.5, 0.5), phase: rand(0, 6) };
      this.debris.push(m);
      this.scene.add(m);
    }
  }

  waveHeight(x, z, t) {
    return Math.sin(x * 0.35 + t * 1.3) * 0.12 + Math.sin(z * 0.27 - t * 1.1) * 0.1 + Math.sin((x + z) * 0.8 + t * 2.2) * 0.04;
  }

  // ── Per frame ──
  update(dt, focus) {
    this.time += dt;
    const t = this.time;

    for (const p of this.platforms) {
      p.delta.set(0, 0, 0);
      if (!p.motion) continue;
      const mo = p.motion;
      const next = Math.sin(t * mo.speed + mo.phase) * mo.amp;
      const step = next - mo.offset;
      mo.offset = next;
      mo.node.position[mo.axis] = (mo.axis === 'x' ? p.x : p.z) + next;
      p.delta[mo.axis] = step;
      for (const b of p.boxes) {
        b.min[mo.axis] += step;
        b.max[mo.axis] += step;
      }
    }
    for (const p of this.platforms) {
      if (p.sachet) {
        p.sachet.rotation.y += dt * 2;
        p.sachet.position.y = p.top + 0.9 + Math.sin(t * 3 + p.x) * 0.12;
        if (p.motion) p.sachet.position[p.motion.axis] += p.delta[p.motion.axis];
      }
    }

    // Water follows the focus point on a grid so it looks endless; waves are in world space.
    const gx = Math.round(focus.x / 2.5) * 2.5;
    const gz = Math.round(focus.z / 2.5) * 2.5;
    this.water.position.set(gx, this.waterLevel, gz);
    const pos = this.water.geometry.attributes.position;
    const base = this.waterBase;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3] + gx;
      const z = base[i * 3 + 2] + gz;
      pos.array[i * 3 + 1] = this.waveHeight(x, z, t);
    }
    pos.needsUpdate = true;
    this.water.geometry.computeVertexNormals();
    // ripples drift with the current; offset by the grid snap so they stay put in the world
    this.rippleTexture.offset.set((gx / 240) * 40 + t * 0.02, (-gz / 240) * 40 + t * 0.012);

    for (const m of this.debris) {
      const u = m.userData;
      u.x += u.vx * dt;
      u.z += u.vz * dt;
      if (Math.abs(u.x - focus.x) > 30) u.x = focus.x - Math.sign(u.x - focus.x) * 29;
      if (Math.abs(u.z - focus.z) > 30) u.z = focus.z - Math.sign(u.z - focus.z) * 29;
      m.position.set(u.x, this.waterLevel + this.waveHeight(u.x, u.z, t) + 0.05, u.z);
      m.rotation.y += u.spin * dt;
      m.rotation.z = Math.sin(t * 1.5 + u.phase) * 0.15;
    }

    // Rain falls in a box around the focus point.
    const rp = this.rain.geometry.attributes.position.array;
    for (let i = 0; i < this.rainSpeed.length; i++) {
      const o = i * 6;
      const fall = this.rainSpeed[i] * dt;
      rp[o + 1] -= fall;
      rp[o + 4] -= fall;
      if (rp[o + 1] < -15) {
        const x = rand(-30, 30);
        const y = rand(15, 25);
        const z = rand(-30, 30);
        rp[o] = x; rp[o + 1] = y; rp[o + 2] = z;
        rp[o + 3] = x + 0.05; rp[o + 4] = y - 0.7; rp[o + 5] = z + 0.02;
      }
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.rain.position.set(focus.x, focus.y, focus.z);
    this.sky.position.copy(focus);
    this.skyline.position.set(focus.x * 0.9, 0, focus.z * 0.9); // distant city drifts slowly as you travel
  }

  // Drops platforms far below the water and builds more above the player.
  stream(playerY) {
    this.ensureAhead(playerY + 30);
    const keep = [];
    for (const p of this.platforms) {
      if (p.top < this.waterLevel - 12 && p !== this.platforms[this.platforms.length - 1]) this.removePlatform(p);
      else keep.push(p);
    }
    this.platforms = keep;
  }

  nearbyBoxes(pos, out = []) {
    out.length = 0;
    for (const p of this.platforms) {
      if (Math.abs(p.x - pos.x) > p.hx + 4 || Math.abs(p.z - pos.z) > p.hz + 4) continue;
      for (const b of p.boxes) out.push(b);
    }
    return out;
  }
}
