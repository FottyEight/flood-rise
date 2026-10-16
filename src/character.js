// Builds the player's start.ng character from its `style` (https://start.ng/docs#character-style-fields).
// Every field changes the model: body shape, top, trousers/skirt, skin, hair, hat and accessory.
// Feet are at y = 0 and the character faces +Z.
import * as THREE from 'three';

const HEX = /^#[0-9a-f]{6}$/i;
const HAIRS = ['short', 'afro', 'braids', 'bun', 'ponytail', 'dreads', 'bald'];
const HATS = ['none', 'cap', 'beanie', 'tophat', 'crown'];
const ACCESSORIES = ['none', 'glasses', 'earrings', 'beard', 'scarf', 'backpack'];

// Fills in anything missing or unknown, since start.ng may add options later.
export function normalizeStyle(style) {
  const s = style ?? {};
  const color = (v, fallback) => (typeof v === 'string' && HEX.test(v) ? v : fallback);
  const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
  return {
    body: s.body === 'female' ? 'female' : 'male',
    primaryColor: color(s.primaryColor, '#4b7bec'),
    secondaryColor: color(s.secondaryColor, '#2b2f4a'),
    skinColor: color(s.skinColor, '#8d5524'),
    hairColor: color(s.hairColor, '#17120f'),
    hair: pick(s.hair, HAIRS, 'short'),
    hat: pick(s.hat, HATS, 'none'),
    accessory: pick(s.accessory, ACCESSORIES, 'none'),
  };
}

export function styleKey(style) {
  return JSON.stringify(normalizeStyle(style));
}

export function buildCharacter(rawStyle) {
  const style = normalizeStyle(rawStyle);
  const female = style.body === 'female';
  const geometries = [];
  const materials = new Map();

  const mat = (hex, opts = {}) => {
    const key = hex + JSON.stringify(opts);
    if (!materials.has(key)) {
      materials.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.75, ...opts }));
    }
    return materials.get(key);
  };
  const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
  const mesh = (geometry, material, parent, x = 0, y = 0, z = 0) => {
    geometries.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const top = mat(style.primaryColor);
  const bottom = mat(style.secondaryColor);
  const skin = mat(style.skinColor);
  const hair = mat(style.hairColor, { roughness: 0.95 });
  const dark = mat('#1c1b1f');
  const shoe = mat('#26232a');
  const gold = mat('#f2c14e', { metalness: 0.6, roughness: 0.3 });

  const root = new THREE.Group();
  const body = new THREE.Group(); // bobs and leans; root only moves and turns
  root.add(body);

  // ── Legs (trousers for male, skirt over bare legs for female) ──
  const hipY = female ? 0.8 : 0.84;
  const legs = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (female ? 0.1 : 0.12), hipY, 0);
    body.add(pivot);
    const len = hipY - 0.07;
    mesh(new THREE.CylinderGeometry(female ? 0.075 : 0.105, female ? 0.065 : 0.09, len, 10), female ? skin : bottom, pivot, 0, -len / 2, 0);
    mesh(new THREE.BoxGeometry(0.15, 0.09, 0.27), shoe, pivot, 0, -len - 0.02, 0.05);
    return pivot;
  });
  if (female) {
    mesh(new THREE.CylinderGeometry(0.19, 0.34, 0.44, 16), bottom, body, 0, hipY - 0.12, 0);
  } else {
    mesh(new THREE.CylinderGeometry(0.205, 0.215, 0.1, 14), bottom, body, 0, hipY - 0.05, 0).scale.z = 0.75;
  }

  // ── Torso and arms (the top) ──
  const torsoH = 0.58;
  const shoulderR = female ? 0.21 : 0.26;
  const torsoTop = hipY + torsoH;
  const torso = mesh(new THREE.CylinderGeometry(shoulderR, female ? 0.18 : 0.21, torsoH, 16), top, body, 0, hipY + torsoH / 2, 0);
  torso.scale.z = 0.72;
  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (shoulderR + 0.05), torsoTop - 0.07, 0);
    body.add(pivot);
    mesh(new THREE.SphereGeometry(0.095, 12, 10), top, pivot);
    mesh(new THREE.CylinderGeometry(0.078, 0.07, 0.3, 10), top, pivot, 0, -0.16, 0);
    mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.28, 10), skin, pivot, 0, -0.44, 0);
    mesh(new THREE.SphereGeometry(0.068, 10, 8), skin, pivot, 0, -0.6, 0);
    return pivot;
  });

  // ── Head ──
  const headY = torsoTop + 0.29;
  const headR = 0.21;
  mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 10), skin, body, 0, torsoTop + 0.04, 0);
  const headMesh = mesh(new THREE.SphereGeometry(headR, 24, 18), skin, body, 0, headY, 0);
  headMesh.scale.y = 1.08;
  for (const side of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.028, 8, 6), dark, body, side * 0.075, headY + 0.03, 0.19);
    mesh(new THREE.SphereGeometry(0.045, 8, 6), skin, body, side * 0.205, headY, 0);
  }
  mesh(new THREE.BoxGeometry(0.08, 0.014, 0.01), mat(shade(style.skinColor, 0.55)), body, 0, headY - 0.09, 0.2);

  // ── Hair ──
  const cap = () => {
    const m = mesh(new THREE.SphereGeometry(headR + 0.018, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, body, 0, headY + 0.005, -0.005);
    m.rotation.x = -0.42;
    m.scale.y = 1.08;
    return m;
  };
  const strands = (count, from, to, radius, len, y) => {
    for (let i = 0; i < count; i++) {
      const a = from + ((to - from) * i) / (count - 1);
      const s = mesh(new THREE.CylinderGeometry(radius, radius * 0.8, len, 6), hair, body, Math.sin(a) * 0.2, y - len / 2, Math.cos(a) * 0.2);
      s.rotation.x = Math.cos(a) * -0.18;
      s.rotation.z = Math.sin(a) * 0.18;
    }
  };
  let hatBase = headY + headR * 1.08; // where a hat sits
  switch (style.hair) {
    case 'short':
      cap();
      break;
    case 'afro':
      mesh(new THREE.SphereGeometry(0.31, 20, 16), hair, body, 0, headY + 0.11, -0.1);
      hatBase = headY + 0.4;
      break;
    case 'braids':
      cap();
      strands(9, Math.PI * 0.55, Math.PI * 1.45, 0.026, 0.46, headY + 0.02);
      break;
    case 'bun':
      cap();
      mesh(new THREE.SphereGeometry(0.11, 14, 12), hair, body, 0, headY + 0.2, -0.12);
      break;
    case 'ponytail': {
      cap();
      mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(style.primaryColor), body, 0, headY + 0.08, -0.22);
      const tail = mesh(new THREE.CylinderGeometry(0.075, 0.025, 0.4, 10), hair, body, 0, headY - 0.08, -0.29);
      tail.rotation.x = 0.35;
      break;
    }
    case 'dreads':
      cap();
      strands(12, Math.PI * 0.35, Math.PI * 1.65, 0.042, 0.32, headY + 0.03);
      break;
    case 'bald':
      break;
  }

  // ── Hat ──
  const hatScale = style.hair === 'afro' ? 1.25 : 1;
  const hat = new THREE.Group();
  hat.position.y = hatBase;
  hat.scale.setScalar(hatScale);
  body.add(hat);
  switch (style.hat) {
    case 'cap': {
      const c = mesh(new THREE.SphereGeometry(0.235, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(style.secondaryColor), hat, 0, -0.07, 0);
      c.scale.y = 0.9;
      mesh(new THREE.BoxGeometry(0.3, 0.02, 0.2), mat(style.secondaryColor), hat, 0, -0.065, 0.27);
      mesh(new THREE.SphereGeometry(0.025, 8, 6), mat(style.primaryColor), hat, 0, 0.14, 0);
      break;
    }
    case 'beanie': {
      const b = mesh(new THREE.SphereGeometry(0.24, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(style.primaryColor, { roughness: 1 }), hat, 0, -0.07, 0);
      b.scale.y = 1.15;
      const fold = mesh(new THREE.TorusGeometry(0.235, 0.04, 8, 24), mat(shade(style.primaryColor, 0.75), { roughness: 1 }), hat, 0, -0.06, 0);
      fold.rotation.x = Math.PI / 2;
      mesh(new THREE.SphereGeometry(0.06, 10, 8), mat('#f4f1ea', { roughness: 1 }), hat, 0, 0.22, 0);
      break;
    }
    case 'tophat': {
      const black = mat('#1d1d22', { roughness: 0.5 });
      mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 24), black, hat, 0, -0.03, 0);
      mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.34, 24), black, hat, 0, 0.14, 0);
      mesh(new THREE.CylinderGeometry(0.182, 0.182, 0.05, 24), mat(style.primaryColor), hat, 0, 0.02, 0);
      break;
    }
    case 'crown': {
      mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.1, 20, 1, true), gold, hat, 0, 0, 0).material.side = THREE.DoubleSide;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        mesh(new THREE.ConeGeometry(0.035, 0.11, 6), gold, hat, Math.sin(a) * 0.165, 0.1, Math.cos(a) * 0.165);
        mesh(new THREE.SphereGeometry(0.02, 6, 6), mat('#e0245e', { roughness: 0.2 }), hat, Math.sin(a) * 0.172, 0.0, Math.cos(a) * 0.172);
      }
      break;
    }
  }

  // ── Accessory ──
  switch (style.accessory) {
    case 'glasses':
      for (const side of [-1, 1]) {
        mesh(new THREE.TorusGeometry(0.052, 0.012, 6, 16), dark, body, side * 0.077, headY + 0.03, 0.205);
        const arm = mesh(new THREE.BoxGeometry(0.012, 0.012, 0.2), dark, body, side * 0.13, headY + 0.04, 0.1);
        arm.rotation.y = side * 0.25;
      }
      mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), dark, body, 0, headY + 0.035, 0.21);
      break;
    case 'earrings':
      for (const side of [-1, 1]) {
        const hoop = mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 14), gold, body, side * 0.215, headY - 0.07, 0.01);
        hoop.rotation.y = Math.PI / 2;
      }
      break;
    case 'beard':
      mesh(new THREE.SphereGeometry(headR + 0.012, 20, 10, 0, Math.PI, Math.PI * 0.56, Math.PI * 0.34), hair, body, 0, headY, 0).material.side = THREE.DoubleSide;
      break;
    case 'scarf': {
      const scarf = mat(style.secondaryColor, { roughness: 1 });
      const ring = mesh(new THREE.TorusGeometry(0.12, 0.06, 10, 20), scarf, body, 0, torsoTop + 0.02, 0);
      ring.rotation.x = Math.PI / 2;
      const tail = mesh(new THREE.BoxGeometry(0.1, 0.32, 0.04), scarf, body, 0.09, torsoTop - 0.16, 0.17);
      tail.rotation.z = 0.12;
      break;
    }
    case 'backpack': {
      const pack = mat(shade(style.secondaryColor, 0.8));
      mesh(new THREE.BoxGeometry(0.36, 0.42, 0.17), pack, body, 0, hipY + 0.33, -0.24);
      mesh(new THREE.BoxGeometry(0.28, 0.16, 0.05), mat(shade(style.secondaryColor, 0.6)), body, 0, hipY + 0.22, -0.34);
      for (const side of [-1, 1]) {
        mesh(new THREE.BoxGeometry(0.05, 0.5, 0.03), pack, body, side * 0.12, hipY + 0.32, 0.16);
      }
      break;
    }
  }

  // ── Animation ──
  let phase = 0;
  let airBlend = 0;
  function animate(dt, { speed = 0, grounded = true, time = 0 } = {}) {
    const walk = Math.min(1, speed);
    phase += dt * (4 + 7 * walk) * (walk > 0.05 ? 1 : 0);
    airBlend += ((grounded ? 0 : 1) - airBlend) * Math.min(1, dt * 12);
    const swing = Math.sin(phase) * 0.75 * walk * (1 - airBlend);
    legs[0].rotation.x = swing + airBlend * -0.5;
    legs[1].rotation.x = -swing + airBlend * 0.35;
    arms[0].rotation.x = -swing * 0.9 - airBlend * 2.4;
    arms[1].rotation.x = swing * 0.9 - airBlend * 2.4;
    arms[0].rotation.z = -0.08 - airBlend * 0.35;
    arms[1].rotation.z = 0.08 + airBlend * 0.35;
    body.position.y = Math.abs(Math.sin(phase)) * 0.06 * walk * (1 - airBlend) + Math.sin(time * 2) * 0.008 * (1 - walk);
    body.rotation.x = walk * 0.12 * (1 - airBlend);
  }

  function dispose() {
    for (const g of geometries) g.dispose();
    for (const m of materials.values()) m.dispose();
  }

  animate(0);
  return { root, animate, dispose, style };
}
