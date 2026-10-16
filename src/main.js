import * as THREE from 'three';
import { World } from './world.js';
import { buildCharacter, styleKey } from './character.js';
import { whoami, saveRun, leaderboard, signIn, onStartNg, cameAsGuest, FALLBACK_GUEST } from './startng.js';
import { unlock, sfx, toggleMute, isMuted } from './sound.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

// ── Tuning ──
const RUN_SPEED = 6.4;
const JUMP_SPEED = 10.5;
const GRAVITY = 26;
const RADIUS = 0.3;
const HEIGHT = 1.7;
const WATER_START = -4;

// ── Renderer, scene, lights ──
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.has('cover') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('stage').append(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#8a98a5', 28, 150);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1200);

const hemi = new THREE.HemisphereLight('#b9c8d6', '#3f4b3c', 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#e6edf3', 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(innerWidth < 800 ? 1024 : 2048, innerWidth < 800 ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const world = new World(scene);
world.useReflections(renderer);

// ── Player ──
const player = {
  pos: new THREE.Vector3(0, 0, 0),
  prev: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  grounded: true,
  groundBox: null,
  facing: Math.PI,
  coyote: 0,
  jumpBuffer: 0,
  jumpHeld: false,
  cut: false,
  maxY: 0,
  sachets: 0,
};
const playerNode = new THREE.Group();
scene.add(playerNode);
let character = null;
let characterKey = '';

// ── Who's playing (start.ng) ──
let identity = { user: null, guest: FALLBACK_GUEST, connected: false };

function styleOverride() {
  // Local testing only: ?style={"hair":"afro",...}. Ignored on start.ng.
  if (onStartNg || !params.get('style')) return null;
  try { return JSON.parse(params.get('style')); } catch { return null; }
}

function applyIdentity(who) {
  identity = who;
  const look = who.user ?? who.guest;
  const style = styleOverride() ?? look.style;
  const key = styleKey(style);
  if (key !== characterKey) {
    if (character) {
      playerNode.remove(character.root);
      character.dispose();
    }
    character = buildCharacter(style);
    character.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    playerNode.add(character.root);
    characterKey = key;
  }
  // profile card
  const face = $('card-face');
  if (look.face) {
    face.src = look.face;
    face.hidden = false;
    $('card-initial').hidden = true;
  } else {
    face.hidden = true;
    $('card-initial').hidden = false;
    $('card-initial').textContent = (look.name || 'G').trim().charAt(0).toUpperCase();
    $('card-initial').style.background = (style?.primaryColor) || '#8a8f98';
  }
  $('card-name').textContent = look.name || 'Guest';
  $('card-account').textContent = who.user ? `@${who.user.account}` : 'Playing as guest';
  $('card-signin').hidden = !!who.user;
  $('menu-signin-note').hidden = !!who.user || cameAsGuest;
  document.body.classList.toggle('signed-in', !!who.user);
}

let refreshing = false;
async function refreshIdentity() {
  if (refreshing) return;
  refreshing = true;
  try { applyIdentity(await whoami()); } finally { refreshing = false; }
}
applyIdentity(identity);
refreshIdentity();
// The player may sign in or out on start.ng in another tab.
addEventListener('focus', refreshIdentity);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshIdentity();
  else if (mode === 'playing') setMode('paused');
});

// ── Input ──
const keys = new Set();
const touch = { x: 0, y: 0 };
let yaw = 0.6;
let pitch = 0.36;
let distance = 7.5;

const isJumpKey = (k) => k === ' ' || k === 'Space';
addEventListener('keydown', (e) => {
  if (e.repeat && isJumpKey(e.key)) return;
  unlock();
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mode === 'menu' && (k === 'Enter' || isJumpKey(k))) { startGame(); e.preventDefault(); return; }
  if (mode === 'over' && (k === 'Enter' || isJumpKey(k)) && overReady) { startGame(); e.preventDefault(); return; }
  if (mode === 'paused' && (k === 'Escape' || k === 'p' || k === 'Enter')) { setMode('playing'); return; }
  if (mode === 'playing' && (k === 'Escape' || k === 'p')) { setMode('paused'); return; }
  if (k === 'm') { $('mute').textContent = toggleMute() ? '🔇' : '🔊'; return; }
  keys.add(k);
  if (isJumpKey(k)) { player.jumpBuffer = 0.14; player.jumpHeld = true; e.preventDefault(); }
  if (k.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys.delete(k);
  if (isJumpKey(k)) player.jumpHeld = false;
});
addEventListener('blur', () => keys.clear());

// Drag to turn the camera (mouse, or a finger on the right side of the screen).
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  unlock();
  if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.45) return; // joystick side
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  yaw -= (e.clientX - drag.x) * 0.006;
  pitch = THREE.MathUtils.clamp(pitch + (e.clientY - drag.y) * 0.004, 0.08, 1.1);
  drag.x = e.clientX;
  drag.y = e.clientY;
});
const endDrag = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);
renderer.domElement.addEventListener('wheel', (e) => {
  distance = THREE.MathUtils.clamp(distance + e.deltaY * 0.005, 4.5, 12);
}, { passive: true });

// Touch: joystick on the left, jump button on the right.
const isTouch = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', isTouch);
{
  const pad = $('joystick');
  const knob = $('joystick-knob');
  let id = null;
  let cx = 0;
  let cy = 0;
  const move = (e) => {
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const len = Math.min(48, Math.hypot(dx, dy));
    const a = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(a) * len}px, ${Math.sin(a) * len}px)`;
    touch.x = (Math.cos(a) * len) / 48;
    touch.y = (-Math.sin(a) * len) / 48;
  };
  pad.addEventListener('pointerdown', (e) => {
    unlock();
    id = e.pointerId;
    const r = pad.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    pad.setPointerCapture(id);
    move(e);
  });
  pad.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    touch.x = touch.y = 0;
    knob.style.transform = '';
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);

  const jump = $('jump-button');
  jump.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlock();
    player.jumpBuffer = 0.14;
    player.jumpHeld = true;
  });
  const release = () => { player.jumpHeld = false; };
  jump.addEventListener('pointerup', release);
  jump.addEventListener('pointercancel', release);
}

// ── Game state ──
let mode = 'menu';
let elapsed = 0;
let overReady = false;
let warnTimer = 0;
let lightning = { next: 4, flash: 0, thunderAt: -1 };
let best = 0;
try { best = Number(localStorage.getItem('flood-rise-best')) || 0; } catch { /* storage blocked */ }

function setMode(next) {
  mode = next;
  document.body.dataset.mode = next;
  $('menu').hidden = next !== 'menu';
  $('paused').hidden = next !== 'paused';
  $('over').hidden = next !== 'over';
  $('hud').hidden = next !== 'playing' && next !== 'paused';
}

function resetPlayer() {
  // stand at the back of the start roof, facing the way the path goes
  const h = world.baseHeading;
  player.pos.set(-Math.cos(h) * 1.6, 0, -Math.sin(h) * 1.6);
  player.facing = Math.atan2(Math.cos(h), Math.sin(h));
  player.vel.set(0, 0, 0);
  player.grounded = true;
  player.groundBox = null;
  player.maxY = 0;
  player.sachets = 0;
  player.jumpBuffer = 0;
}

function startGame() {
  unlock();
  world.reset();
  resetPlayer();
  elapsed = 0;
  yaw = player.facing + Math.PI;
  setMode('playing');
  updateHud();
}

async function gameOver() {
  setMode('over');
  sfx.splash();
  overReady = false;
  setTimeout(() => { overReady = true; }, 700);
  const height = Math.max(0, Math.floor(player.maxY));
  const sachets = player.sachets;
  const newLocalBest = height > best;
  if (newLocalBest) {
    best = height;
    try { localStorage.setItem('flood-rise-best', String(best)); } catch { /* storage blocked */ }
  }
  $('over-height').textContent = `${height} m`;
  $('over-sachets').textContent = String(sachets);
  $('over-title').textContent = height >= 60 ? 'You held on long!' : 'The flood caught you!';

  const status = $('over-status');
  $('over-signin').hidden = true;
  if (identity.user) {
    if (height < 1) {
      status.textContent = 'Climb at least 1 m to get on the leaderboard.';
    } else {
      status.textContent = 'Saving your run to start.ng…';
      const saved = await saveRun({ height, sachets });
      if (saved.ok) {
        const r = saved.result;
        status.textContent = r.improved
          ? `New best! You're #${r.rank} on the leaderboard.`
          : `Your best is still ${r.stats?.height ?? r.best} m (#${r.rank}).`;
      } else {
        status.textContent = saved.error || 'Could not save your run.';
      }
    }
  } else {
    status.textContent = newLocalBest && height > 0 ? 'New best on this device! Sign in to put it on the leaderboard.' : 'Sign in with start.ng to save your runs.';
    $('over-signin').hidden = false;
  }
  renderBoard();
}

async function renderBoard() {
  const list = $('board');
  list.replaceChildren();
  $('board-note').textContent = 'Loading leaderboard…';
  const entries = await leaderboard(10);
  if (!entries) {
    $('board-note').textContent = onStartNg ? 'Could not load the leaderboard.' : 'The leaderboard shows up when you play on flood-rise.start.ng.';
    return;
  }
  $('board-note').textContent = entries.length ? '' : 'No runs yet. Be the first!';
  for (const e of entries) {
    const li = document.createElement('li');
    if (identity.user && e.player_id === identity.user.id) li.classList.add('me');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = e.color || '#888';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${e.rank}. ${e.name}`;
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = `${e.stats?.height ?? e.score} m · ${e.stats?.sachets ?? 0} 💧`;
    li.append(dot, name, score);
    list.append(li);
  }
}

$('play').onclick = startGame;
$('again').onclick = startGame;
$('resume').onclick = () => setMode('playing');
// start.ng only signs players in for games on *.start.ng; anywhere else, say so instead of
// sending them to a homepage that won't come back.
const trySignIn = () => {
  if (onStartNg) signIn();
  else popText('Sign-in works on flood-rise.start.ng');
};
$('card-signin').onclick = trySignIn;
$('menu-signin').onclick = trySignIn;
$('over-signin').onclick = trySignIn;
$('mute').textContent = isMuted() ? '🔇' : '🔊';
$('mute').onclick = () => { unlock(); $('mute').textContent = toggleMute() ? '🔇' : '🔊'; };
setMode('menu');

// ── Physics ──
const boxes = [];
const wish = new THREE.Vector2();

function readInput() {
  let x = touch.x;
  let y = touch.y;
  if (keys.has('w') || keys.has('ArrowUp')) y += 1;
  if (keys.has('s') || keys.has('ArrowDown')) y -= 1;
  if (keys.has('d') || keys.has('ArrowRight')) x += 1;
  if (keys.has('a') || keys.has('ArrowLeft')) x -= 1;
  // camera-relative: forward points from the camera to the player
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  wish.set(fx * y + rx * x, fz * y + rz * x);
  if (wish.length() > 1) wish.normalize();
  return wish;
}

function collide() {
  const { pos, vel, prev } = player;
  player.grounded = false;
  player.groundBox = null;
  world.nearbyBoxes(pos, boxes);
  for (const b of boxes) {
    if (pos.x <= b.min.x - RADIUS || pos.x >= b.max.x + RADIUS || pos.z <= b.min.z - RADIUS || pos.z >= b.max.z + RADIUS) continue;
    const top = b.max.y;
    const inner = RADIUS * 0.6;
    const over = pos.x > b.min.x - inner && pos.x < b.max.x + inner && pos.z > b.min.z - inner && pos.z < b.max.z + inner;
    if (vel.y <= 0 && prev.y >= top - 0.06 && pos.y <= top + 0.02 && over) {
      if (vel.y < -7) sfx.land();
      pos.y = top;
      vel.y = 0;
      player.grounded = true;
      player.groundBox = b;
      continue;
    }
    if (pos.y < top - 0.02 && pos.y + HEIGHT > b.min.y) {
      if (vel.y > 0 && prev.y + HEIGHT <= b.min.y + 0.06) {
        pos.y = b.min.y - HEIGHT;
        vel.y = 0;
        continue;
      }
      const left = pos.x - (b.min.x - RADIUS);
      const right = b.max.x + RADIUS - pos.x;
      const back = pos.z - (b.min.z - RADIUS);
      const front = b.max.z + RADIUS - pos.z;
      const m = Math.min(left, right, back, front);
      if (m === left) { pos.x = b.min.x - RADIUS; vel.x = Math.min(vel.x, 0); }
      else if (m === right) { pos.x = b.max.x + RADIUS; vel.x = Math.max(vel.x, 0); }
      else if (m === back) { pos.z = b.min.z - RADIUS; vel.z = Math.min(vel.z, 0); }
      else { pos.z = b.max.z + RADIUS; vel.z = Math.max(vel.z, 0); }
    }
  }
}

function stepPlayer(dt) {
  const input = readInput();
  // ride moving platforms
  if (player.groundBox) player.pos.add(player.groundBox.platform.delta);

  const steps = Math.ceil(dt / (1 / 120));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const { vel } = player;
    const rate = player.grounded ? 16 : 9; // strong air control so small targets can be steered onto
    const k = 1 - Math.exp(-rate * h);
    vel.x += (input.x * RUN_SPEED - vel.x) * k;
    vel.z += (input.y * RUN_SPEED - vel.z) * k;

    player.coyote = player.grounded ? 0.1 : player.coyote - h;
    player.jumpBuffer -= h;
    if (player.jumpBuffer > 0 && player.coyote > 0) {
      vel.y = JUMP_SPEED;
      player.grounded = false;
      player.groundBox = null;
      player.coyote = 0;
      player.jumpBuffer = 0;
      player.cut = false;
      sfx.jump();
    }
    // let go of jump early for a shorter hop
    if (!player.jumpHeld && vel.y > 3 && !player.cut) {
      vel.y *= 0.55;
      player.cut = true;
    }
    vel.y = Math.max(vel.y - GRAVITY * h, -30);

    player.prev.copy(player.pos);
    player.pos.addScaledVector(vel, h);
    collide();
  }

  if (input.lengthSq() > 0.01) {
    const target = Math.atan2(input.x, input.y);
    let diff = target - player.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.facing += diff * Math.min(1, dt * 14);
  }
  if (player.grounded) player.maxY = Math.max(player.maxY, player.pos.y);

  // sachets
  for (const p of world.platforms) {
    if (!p.sachet) continue;
    const s = p.sachet.position;
    if (Math.abs(s.x - player.pos.x) < 0.7 && Math.abs(s.z - player.pos.z) < 0.7 && s.y > player.pos.y - 0.2 && s.y < player.pos.y + HEIGHT + 0.3) {
      p.group.remove(p.sachet);
      p.sachet = null;
      player.sachets++;
      sfx.sachet();
      popText('+1 💧');
    }
  }
}

function popText(text) {
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = text;
  $('pops').append(el);
  setTimeout(() => el.remove(), 900);
}

// ── Water ──
function stepWater(dt) {
  elapsed += dt;
  if (elapsed < 2.5) return;
  const gap = player.pos.y - world.waterLevel;
  const speed = Math.min(1.05, 0.32 + elapsed * 0.006) + Math.max(0, gap - 11) * 0.07;
  world.waterLevel += speed * dt;
}

function updateHud() {
  const height = Math.max(0, Math.floor(player.maxY));
  $('hud-height').textContent = `${height} m`;
  $('hud-best').textContent = `${Math.max(best, height)} m`;
  $('hud-sachets').textContent = String(player.sachets);
  const gap = player.pos.y - world.waterLevel;
  const gauge = $('water-gauge');
  gauge.textContent = gap > 0 ? `Water ${gap.toFixed(1)} m below` : 'Water!';
  gauge.classList.toggle('danger', gap < 2);
  $('water-fill').style.width = `${THREE.MathUtils.clamp(1 - gap / 10, 0, 1) * 100}%`;
}

// ── Camera ──
const camTarget = new THREE.Vector3(0, 1.2, 0);
function updateCamera(dt, menu) {
  if (keys.has('q')) yaw += dt * 2.2;
  if (keys.has('e')) yaw -= dt * 2.2;
  const want = new THREE.Vector3(player.pos.x, player.pos.y + (menu ? 1.0 : 1.3), player.pos.z);
  want.y = Math.max(want.y, world.waterLevel + 1.5); // never follow the player under the water
  camTarget.lerp(want, 1 - Math.exp(-dt * (menu ? 3 : 10)));
  if (cover) {
    // low, close and to the side, looking up at the jump
    const f = player.facing;
    camera.position.set(
      player.pos.x + Math.sin(f + 1.35) * 5.2,
      player.pos.y + 2.2,
      player.pos.z + Math.cos(f + 1.35) * 5.2,
    );
    camera.lookAt(player.pos.x + Math.sin(f) * 1.2, player.pos.y + 0.1, player.pos.z + Math.cos(f) * 1.2);
    return;
  }
  const d = menu ? 6 : distance;
  const p = menu ? 0.28 : pitch;
  camera.position.set(
    camTarget.x + Math.sin(yaw) * Math.cos(p) * d,
    camTarget.y + Math.sin(p) * d,
    camTarget.z + Math.cos(yaw) * Math.cos(p) * d,
  );
  camera.lookAt(camTarget);
}

// ── Lightning ──
function stepLightning(dt) {
  lightning.next -= dt;
  if (lightning.next <= 0) {
    lightning.flash = 1;
    lightning.next = 7 + Math.random() * 9;
    lightning.thunderAt = 0.4 + Math.random() * 1.2;
    setTimeout(() => { lightning.flash = Math.max(lightning.flash, 0.7); }, 140);
  }
  if (lightning.thunderAt > 0) {
    lightning.thunderAt -= dt;
    if (lightning.thunderAt <= 0) sfx.thunder();
  }
  lightning.flash = Math.max(0, lightning.flash - dt * 4);
  hemi.intensity = 1.35 + lightning.flash * 1.6;
  world.sky.material.uniforms.flash.value = lightning.flash;
}

// ── Loop ──
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const menu = mode === 'menu';

  if (mode === 'playing') {
    stepPlayer(dt);
    stepWater(dt);
    world.stream(player.pos.y);
    const gap = player.pos.y - world.waterLevel;
    if (gap < 2) {
      warnTimer -= dt;
      if (warnTimer <= 0) { sfx.warn(); warnTimer = 0.9; }
    }
    if (world.waterLevel > player.pos.y + 0.35) gameOver();
    updateHud();
  }
  if (mode !== 'paused') {
    world.update(dt, player.pos);
    stepLightning(dt);
    if (menu && !cover) yaw += dt * 0.25;
  }

  playerNode.position.copy(player.pos);
  playerNode.rotation.y = player.facing;
  if (character) {
    const speed = mode === 'playing' ? Math.hypot(player.vel.x, player.vel.z) / RUN_SPEED : 0;
    character.animate(mode === 'paused' ? 0 : dt, { speed, grounded: cover ? false : player.grounded || mode !== 'playing', time: world.time });
  }
  playerNode.visible = mode !== 'over';

  sun.position.set(player.pos.x + 9, player.pos.y + 16, player.pos.z + 6);
  sun.target.position.copy(player.pos);
  updateCamera(dt, menu || mode === 'over');
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

resetPlayer();

// Cover-picture mode (?cover): the character mid-jump between rooftops, title on the left.
const cover = params.has('cover');
if (cover) {
  document.body.classList.add('cover');
  const title = document.createElement('div');
  title.className = 'cover-title';
  title.innerHTML = '<h1>Flood <span>Rise</span></h1><p>Lagos don flood. Climb!</p>';
  document.body.append(title);
  const from = world.platforms[5];
  const to = world.platforms[6];
  player.pos.set((from.x + to.x) / 2, Math.max(from.top, to.top) + 0.9, (from.z + to.z) / 2);
  player.facing = Math.atan2(to.x - from.x, to.z - from.z);
  player.grounded = false;
  world.waterLevel = from.top - 5;
  yaw = player.facing + Math.PI * 0.62;
  camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.16, 0, innerWidth, innerHeight);
}

requestAnimationFrame(frame);

// Dev hooks for automated checks: ?debug
if (params.has('debug')) {
  window.__flood = {
    player, world, keys,
    get mode() { return mode; },
    start: startGame,
    set yaw(v) { yaw = v; },
    get yaw() { return yaw; },
  };
}
