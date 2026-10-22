// Tomato Blast · 主观视角版（照原版：镜头在大炮正后方，番茄往纵深打）
// 物理：cannon-es 3D 刚体；x 向右、y 向上、z 朝向镜头；桌面上表面 y = 0，桌子用桌腿站在地板上
// 画面：物件是 AI 海报级精灵卡片（正对镜头，按刚体真实姿态做"侧倒旋转 + 前后倒透视压缩"）；桌子/地板是 3D
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LEVELS, ARCH, difficultyOf, THEME_NAMES, buildLevel, setDims } from './levels.js';
import * as sfx from './sfx.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

// ---------- 存档：只放每台设备自己的进度/道具，读写都要能失败 ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('tomato3d_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tomato3d_' + k, JSON.stringify(v)); } catch { /* 隐私模式等 */ } },
};

// ---------- 动态难度：参数照搬 Angry Smash 包内默认 RemoteConfig ----------
const DDA = {
  unlockAt: 3, applyTo: [1, 2], clamp: [-30, 20],
  scoring: { cleanWin: 1, loss: -7, continue: 5 },
  harder: [[5, -9], [8, -16], [10, -24], [12, -30], [14, -36], [16, -42]],
  help: [[-4, 2], [-8, 2], [-12, 3], [-20, 10], [-24, 15]],
};
const ddaAdd = (d) => store.set('dda', Math.min(DDA.clamp[1], Math.max(DDA.clamp[0], store.get('dda', 0) + d)));
function ddaShots(n, diff, base) {
  const score = store.get('dda', 0);
  if (n < DDA.unlockAt || !DDA.applyTo.includes(diff)) return base;
  let add = 0, pct = 0;
  for (const [s, c] of DDA.help) if (score <= s) add = c;
  for (const [s, p] of DDA.harder) if (score >= s) pct = p;
  return Math.max(3, Math.round(base * (1 + pct / 100)) + add);
}

// 道具：按关卡解锁（Angry：三连 9 → 火箭 13 → 大球 23，原型按比例提前）
const BOOSTERS = {
  tri: { name: 'Triple Shot', unlock: 2, btn: 'bTri' },
  rocket: { name: 'Piercing Rocket', unlock: 3, btn: 'bRocket' },
  big: { name: 'Melon Bomb', unlock: 5, btn: 'bBig' },
};
const inv = { tri: 3, rocket: 3, big: 3, ...store.get('inv', {}) };

// ---------- 素材（贴图） ----------
const TEX = {};
let MANIFEST = {};
const texLoader = new THREE.TextureLoader();
const loadTex = (key, src) => new Promise((res) => texLoader.load(src, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; TEX[key] = t; res(t); }, undefined, () => res(null)));
async function loadAssets() {
  try { MANIFEST = await (await fetch('assets/sprites/manifest.json', { cache: 'no-store' })).json(); } catch { MANIFEST = {}; }
  const jobs = Object.keys(MANIFEST).map((k) => loadTex(k, `assets/sprites/${k}.png`));
  for (const t of ['kitchen', 'drinks', 'bakery']) {
    jobs.push(loadTex(`bg_${t}_h`, `assets/bg_${t}_h.jpg`));
    jobs.push(loadTex(`bg_${t}_v`, `assets/bg_${t}_v.jpg`));
    jobs.push(loadTex(`floor_${t}`, `assets/floor_${t}.jpg`));
  }
  for (const k of ['launcher_cannon', 'launcher_stage', 'smoke']) jobs.push(loadTex(k, `assets/sprites/${k}.png`));
  for (const k of ['icon_tomato', 'icon_triple', 'icon_melon', 'icon_rocket', 'fg_tomatoes']) jobs.push(loadTex(k, `assets/ui/${k}.png`));
  await Promise.all(jobs);
}

// 某主题某原型对应的精灵键（多变体轮换）
function spriteKey(theme, arch, i) {
  if (arch === 'wall' || arch === 'slider') return MANIFEST.wall ? 'wall' : null;
  const base = `${theme}_${arch}`;
  const vs = [0, 1, 2].filter((v) => MANIFEST[`${base}_${v}`]);
  if (vs.length) return `${base}_${vs[i % vs.length]}`;
  return MANIFEST[base] ? base : null;
}
// 每个主题每种原型的真实尺寸（米）：按精灵图宽高比推出，关卡生成和碰撞都用它
function archDims(theme, arch) {
  const def = ARCH[arch];
  const key = spriteKey(theme, arch, 0), m = key && MANIFEST[key];
  if (!m || def.round) return { w: def.w, h: def.h };
  const a = m.w / m.h;
  if (def.w >= def.h * 1.5) return { w: def.w, h: Math.max(0.16, def.w / a) };
  if (Math.abs(def.w - def.h) < 0.01) return a >= 1 ? { w: def.w, h: def.w / a } : { w: def.h * a, h: def.h };
  return { w: Math.max(0.22, Math.min(def.h * 1.3, def.h * a)), h: def.h };
}
function fitBox(key, w, h) {
  const m = MANIFEST[key];
  if (!m) return { dw: w, dh: h };
  const a = m.w / m.h;
  return a > w / h ? { dw: w, dh: w / a } : { dw: h * a, dh: h };
}

// ---------- 渲染器 / 场景 ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, Math.max(1.5, devicePixelRatio || 1)));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xfff4e6, 0x8a6a50, 1.4));
const sun = new THREE.DirectionalLight(0xffe2c0, 2.2);
sun.position.set(-6, 14, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
scene.add(sun);
// 屏幕空间叠加层（发射器、前景番茄、暗角）：正交相机，单位 = CSS 像素
const ui = new THREE.Scene();
const uiCam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);

const FLOOR_Y = -2.3;    // 地板高度：桌子用桌腿站在上面
const TABLE_D = 3.2;     // 桌面纵深
const levelGroup = new THREE.Group();
scene.add(levelGroup);

// 格子桌布（主题色）
function ginghamTex(color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fffaf2'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = color;
  for (let i = 0; i < 4; i += 2) { g.fillRect(i * 32, 0, 32, 128); g.fillRect(0, i * 32, 128, 32); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
const CLOTH = { kitchen: 'rgba(214,28,18,.75)', drinks: 'rgba(30,110,220,.7)', bakery: 'rgba(240,100,150,.7)' };
const FLOOR_FALLBACK = { kitchen: 0xc8935a, drinks: 0xbfe3f5, bakery: 0xf3d1d6 };

function buildStage(theme, tw) {
  // 背景墙：远处一块竖直面板；地板：从脚下延伸到墙根（有透视、能落地）
  // 竖屏用竖版背景图；墙面按镜头在那个深度的实际视野铺满，墙根埋在地板后面（地板盖住图里自带的地面）
  const bg = TEX[`bg_${theme}_${VH > VW ? 'v' : 'h'}`];
  if (bg) {
    const WALL_Z = -12, dist = camera.position.z - WALL_Z;
    const viewH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), viewW = viewH * camera.aspect;
    const a = bg.image.width / bg.image.height;
    let w = viewW * 1.15, h = w / a;
    if (h < viewH * 0.9) { h = viewH * 0.9; w = h * a; }
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: bg }));
    wall.position.set(0, FLOOR_Y + h * 0.5 - h * 0.18, WALL_Z);
    levelGroup.add(wall);
  }
  const ft = TEX[`floor_${theme}`];
  const floorMat = new THREE.MeshStandardMaterial({ color: ft ? 0xffffff : FLOOR_FALLBACK[theme], map: ft ? ft.clone() : null, roughness: 0.75 });
  if (floorMat.map) { floorMat.map.wrapS = floorMat.map.wrapT = THREE.RepeatWrapping; floorMat.map.repeat.set(10, 10); floorMat.map.needsUpdate = true; }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, FLOOR_Y, -6);
  floor.receiveShadow = true;
  levelGroup.add(floor);
  // 桌子：格子桌布台面 + 垂下的桌布 + 四条木腿（站在地板上）
  const clothTex = ginghamTex(CLOTH[theme]);
  const top = clothTex.clone(); top.repeat.set(tw / 1.2, TABLE_D / 1.2); top.needsUpdate = true;
  const cloth = new THREE.MeshStandardMaterial({ map: top, roughness: 0.8 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.25, TABLE_D), cloth);
  slab.position.set(0, -0.125, 0); slab.receiveShadow = slab.castShadow = true;
  levelGroup.add(slab);
  const DROP = 0.75;
  const skirtTex = clothTex.clone(); skirtTex.repeat.set(tw / 1.2, DROP / 1.2); skirtTex.needsUpdate = true;
  const skirtMat = new THREE.MeshStandardMaterial({ map: skirtTex, roughness: 0.85, side: THREE.DoubleSide });
  const skirt = (len) => {
    const geo = new THREE.PlaneGeometry(len, DROP, Math.ceil(len * 12), 6);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), k = Math.pow((DROP / 2 - y) / DROP, 1.4);
      p.setZ(i, Math.sin(x * 4.2) * 0.06 * k + 0.03 * k);
      p.setY(i, y + Math.sin(x * 8.4) * 0.03 * k);
    }
    geo.computeVertexNormals();
    return geo;
  };
  for (const [len, x, z, ry] of [[tw, 0, TABLE_D / 2 + 0.01, 0], [TABLE_D, tw / 2 + 0.01, 0, Math.PI / 2], [TABLE_D, -tw / 2 - 0.01, 0, -Math.PI / 2]]) {
    const s = new THREE.Mesh(skirt(len + 0.02), skirtMat);
    s.position.set(x, -DROP / 2, z); s.rotation.y = ry; s.castShadow = true;
    levelGroup.add(s);
  }
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a5f2c, roughness: 0.55 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, -FLOOR_Y - 0.25, 16), wood);
    leg.position.set(sx * (tw / 2 - 0.35), (FLOOR_Y - 0.25) / 2, sz * (TABLE_D / 2 - 0.3));
    leg.castShadow = true;
    levelGroup.add(leg);
  }
  return slab;
}

// ---------- 物理 ----------
const MAT = {   // 摩擦 / 弹性 / 命中音效 / 掉落音效
  wood: { f: 0.5, r: 0.05, hit: 'hit_wood', fall: 'fall_wood' },
  stone: { f: 0.6, r: 0.02, hit: 'hit_stone', fall: 'fall_stone' },
  ice: { f: 0.03, r: 0.05, hit: 'hit_ice', fall: 'fall_wood' },
  metal: { f: 0.35, r: 0.08, hit: 'hit_tin', fall: 'fall_tin' },
  glass: { f: 0.35, r: 0.06, hit: 'hit_glass', fall: 'fall_tin' },
  soft: { f: 0.5, r: 0.1, hit: 'hit_soft', fall: 'fall_wood' },
};
let world, PM;
function newWorld() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 20;
  PM = {};
  for (const k of [...Object.keys(MAT), 'ball', 'table']) PM[k] = new CANNON.Material(k);
  const fr = (k) => (MAT[k] ? MAT[k].f : k === 'table' ? 0.45 : 0.35);
  const keys = Object.keys(PM);
  for (let i = 0; i < keys.length; i++) for (let j = i; j < keys.length; j++) {
    world.addContactMaterial(new CANNON.ContactMaterial(PM[keys[i]], PM[keys[j]], {
      friction: Math.sqrt(fr(keys[i]) * fr(keys[j])), restitution: keys[i] === 'ball' || keys[j] === 'ball' ? 0.15 : 0.04,
    }));
  }
  const ground = new CANNON.Body({ type: CANNON.Body.STATIC, material: PM.table, shape: new CANNON.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  ground.position.y = FLOOR_Y;
  world.addBody(ground);
  world.addEventListener('preStep', () => {
    for (const it of S.items) {
      if (it.arch !== 'slider' || it.dead) continue;
      const { amp = 1.4, cycle = 2.6 } = it.custom, w = (2 * Math.PI) / cycle;
      it.body.velocity.set(amp * w * Math.cos(w * S.time), 0, 0);   // 主观视角下左右扫
    }
  });
}

// ---------- 游戏状态 ----------
const S = {
  levelIdx: store.get('level', 0), level: null, items: [], balls: [], explodeQueue: [],
  shots: 0, startShots: 1, total: 0, remaining: 0, state: 'start', time: 0, lastShotAt: -99,
  armed: null, continued: false, shake: 0, hitstop: 0, diff: 0, theme: 'kitchen', themeOverride: null,
  combo: 0, lastClearAt: -9, paused: false, needWake: false,
};
let tableMesh = null;

function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map && o.material.map.isCanvasTexture) o.material.map.dispose(); });
  g.clear();
}
function clearLevel() {
  disposeGroup(levelGroup);
  for (const b of S.balls) { scene.remove(b.sprite); if (b.trail) for (const t of b.trail) scene.remove(t); }
  S.items = []; S.balls = []; S.explodeQueue = [];
  parts.length = 0; splats.length = 0; smokes.length = 0;
  newWorld();
}

const shadowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(50,20,5,.55)'); grd.addColorStop(1, 'rgba(50,20,5,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function spawnItem(e, i) {
  const def = ARCH[e.Id];
  if (!def) { console.warn('未知原型', e.Id); return; }
  const key = spriteKey(S.theme, e.Id, i);
  const box = archDims(S.theme, e.Id);
  let { dw, dh } = key ? fitBox(key, box.w, box.h) : { dw: box.w, dh: box.h };
  const kind = def.body || 'dynamic';
  const blocker = kind !== 'dynamic';
  // 挡板在主观视角下是一块横着挡在桌前的托盘
  let x = e.x, y = e.y, z = 0, dd = Math.min(dw, 1);
  // 挡板抬高到桌面上方 2.3 米起：挡住塔的上半截，矮处留一条能斜着打进去的缝（太低会把后排矮物件封死）
  if (blocker) { [dw, dh] = [2.2, 1.2]; dd = 0.18; x = e.Id === 'slider' ? 0 : e.x + 1.4; y = e.y + 0.6; z = TABLE_D / 2 + 0.5; }
  let shape;
  if (def.round) shape = new CANNON.Sphere(Math.min(dw, dh) / 2 * 0.96);
  else if (['drum', 'jar', 'bottle', 'boom', 'pillar', 'disc'].includes(e.Id)) shape = new CANNON.Cylinder(dw / 2, dw / 2, dh, 14);
  else shape = new CANNON.Box(new CANNON.Vec3(dw / 2, dh / 2, dd / 2));
  const body = new CANNON.Body({
    mass: blocker ? 0 : def.mass,
    type: kind === 'static' ? CANNON.Body.STATIC : kind === 'kinematic' ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC,
    material: PM[def.mat], position: new CANNON.Vec3(x, y, z), shape,
  });
  body.linearDamping = 0.05; body.angularDamping = 0.15; body.sleepSpeedLimit = 0.2; body.sleepTimeLimit = 0.5;
  if (kind === 'kinematic') body.allowSleep = false;
  world.addBody(body);
  if (kind === 'dynamic') body.sleep();   // 开局休眠：不被碰就不会自己塌（原作 ItemSleepWake 同理）
  const mat = new THREE.SpriteMaterial({ map: key ? TEX[key] : null, color: key ? 0xffffff : 0xc98a4b, alphaTest: 0.35 });
  if (blocker) mat.rotation = Math.PI / 2;
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(blocker ? dh : dw, blocker ? dw : dh, 1);
  levelGroup.add(sprite);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  levelGroup.add(shadow);
  const it = { kind: 'item', arch: e.Id, def, body, sprite, shadow, key, dw, dh, mass: def.mass || 0, counted: def.counted !== false, cleared: false, clearedAt: 0, dead: false, exploding: false, custom: e.Custom || {}, blocker };
  body.item = it;
  body.addEventListener('collide', (ev) => {
    const v = Math.abs(ev.contact.getImpactVelocityAlongNormal());
    if (v > 2.5) sfx.play(MAT[def.mat].hit, { vol: Math.min(1, v / 9), gap: 0.05 });
    if (def.explosive && (v > 3 || ev.body.ball)) queueExplode(it);
  });
  S.items.push(it);
}

function loadLevel(idx, keepTheme = false) {
  idx = ((idx % LEVELS.length) + LEVELS.length) % LEVELS.length;
  if (!keepTheme) S.themeOverride = null;
  clearLevel();
  hidePanel();
  S.levelIdx = idx;
  store.set('level', idx);
  const n = idx + 1;
  const lvl = buildLevel(idx, S.themeOverride);
  S.level = lvl;
  S.theme = lvl.Theme;
  S.diff = lvl.Difficulty ?? difficultyOf(n);
  const tw = lvl.Table.w;
  layout();   // 先定镜头，背景墙要按视野铺满
  tableMesh = buildStage(S.theme, tw);
  const table = new CANNON.Body({ type: CANNON.Body.STATIC, material: PM.table, shape: new CANNON.Box(new CANNON.Vec3(tw / 2, 0.125, TABLE_D / 2)) });
  table.position.set(0, -0.125, 0);
  world.addBody(table);
  lvl.Entities.forEach(spawnItem);
  S.total = S.remaining = S.items.filter((it) => it.counted).length;
  S.shots = S.startShots = ddaShots(n, S.diff, lvl.MoveCount);
  Object.assign(S, { state: 'play', lastShotAt: -99, armed: null, continued: false, combo: 0 });
  layout();
  $('tag').classList.toggle('on', S.diff > 0);
  $('tagImg').src = S.diff === 2 ? 'assets/ui/c_tag_super.png' : 'assets/ui/c_tag_hard.png';
  $('tagText').textContent = S.diff === 2 ? 'SUPER HARD' : 'HARD';
  const unlocked = Object.values(BOOSTERS).find((b) => b.unlock === n);
  toast(S.diff === 2 ? 'SUPER HARD!' : S.diff === 1 ? 'HARD LEVEL' : unlocked ? `New booster: ${unlocked.name}!` : `${THEME_NAMES[S.theme]} · ${lvl.name}`);
  updateHud();
}

// ---------- HUD / 弹窗（与 2D 版相同的 DOM） ----------
function updateHud() {
  $('lvlNum').textContent = S.levelIdx + 1;
  $('shots').textContent = S.shots;
  $('left').textContent = S.remaining;
  for (const [k, b] of Object.entries(BOOSTERS)) {
    const el = $(b.btn), locked = S.levelIdx + 1 < b.unlock;
    el.querySelector('.cnt span').textContent = locked ? '🔒' : inv[k] > 99 ? '99+' : inv[k];
    el.classList.toggle('locked', locked);
    el.classList.toggle('armed', S.armed === k);
    el.classList.toggle('empty', !locked && inv[k] <= 0);
  }
}
let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
}
function showPanel({ win, title, text, main, onMain, alt, onAlt }) {
  $('pTitleImg').classList.toggle('hidden', !win);
  $('pTitle').textContent = title || '';
  $('pText').textContent = text;
  $('pMainText').textContent = main;
  $('pMain').onclick = () => { sfx.play('click'); hidePanel(); onMain(); };
  $('pAlt').classList.toggle('hidden', !alt);
  $('pAltText').textContent = alt || '';
  $('pAlt').onclick = () => { sfx.play('click'); hidePanel(); onAlt(); };
  $('panel').classList.remove('hidden');
}
const hidePanel = () => $('panel').classList.add('hidden');
const COMBO_WORDS = [[15, 'txt_amazing'], [10, 'txt_awesome'], [5, 'txt_great']];
let comboTimer;
function showCombo() {
  const word = COMBO_WORDS.find(([n]) => S.combo >= n);
  $('comboNum').textContent = `×${S.combo}`;
  $('comboImg').src = word ? `assets/ui/${word[1]}.png` : '';
  $('comboImg').style.display = word ? 'block' : 'none';
  const el = $('combo');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  if (word && S.combo === word[0]) { sfx.play('combo', { vol: 0.9 }); S.shake = Math.max(S.shake, 0.25); }
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => el.classList.remove('show'), 950);
}
function win() {
  S.state = 'won';
  sfx.play('win');
  setTimeout(() => sfx.play('firework'), 250);
  setTimeout(() => sfx.play('firework', { rate: 1.2 }), 550);
  ddaAdd(S.continued ? 0 : DDA.scoring.cleanWin);
  if (S.diff === 2) { for (const k in BOOSTERS) inv[k]++; store.set('inv', inv); }
  for (let k = 0; k < 8; k++) emit(new THREE.Vector3((Math.random() - 0.5) * 8, 4 + Math.random() * 3, 0), [0xe8261a, 0xfff1d6, 0x3daa5c, 0xf6c33b], 26, 5, 4, 2.4);
  const last = S.levelIdx === LEVELS.length - 1;
  setTimeout(() => showPanel({
    win: true, title: `LEVEL ${S.levelIdx + 1}`,
    text: `${S.level.name} cleared!\n${S.shots} tomato${S.shots === 1 ? '' : 'es'} left${S.diff === 2 ? '\nSuper Hard bonus: +1 every booster' : ''}`,
    main: last ? 'PLAY AGAIN' : 'NEXT', onMain: () => loadLevel(S.levelIdx + 1),
  }), 900);
}
function lose() {
  S.state = 'lost';
  sfx.play('lose');
  showPanel({
    title: 'OUT OF TOMATOES', text: `${S.remaining} item${S.remaining === 1 ? '' : 's'} still on the table`,
    main: '+5 TOMATOES', onMain: () => {
      S.shots += 5; S.continued = true; S.state = 'play'; S.lastShotAt = S.time;
      ddaAdd(DDA.scoring.continue);   // 原作：花金币续关 = 积分 +5（视为更强的玩家）
      updateHud();
    },
    alt: 'RETRY', onAlt: () => { ddaAdd(DDA.scoring.loss); loadLevel(S.levelIdx, true); },
  });
}

// ---------- 镜头 & 发射器（照原版：镜头在大炮正后方，大炮在画面底部中央） ----------
let VW = 1, VH = 1;
const CAM_T = new THREE.Vector3(0, 1.3, 0);
const camBase = new THREE.Vector3();
const MUZZLE = new THREE.Vector3();
const L = { x: 0, y: 0, w: 0, h: 0 };   // 发射器在屏幕上的位置（CSS 像素，底边中点）
const MOUTH_FY = 0.03;                   // 炮口在发射器精灵里的高度（从上往下 0..1）
function cssPx(name) { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0; }
function layout() {
  VW = innerWidth; VH = innerHeight;
  renderer.setSize(VW, VH, false);
  camera.aspect = VW / VH;
  const tw = S.level ? S.level.Table.w : 7;
  // 桌子整张放进画面宽度；镜头略高、略向下看（原版俯角约 15°）
  const halfW = tw / 2 + 0.7, tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const D = Math.max(11, halfW / (tanV * camera.aspect) * 1.02);
  camBase.copy(CAM_T).add(new THREE.Vector3(0, 0.3, 1).normalize().multiplyScalar(D));
  camera.position.copy(camBase);
  camera.lookAt(CAM_T);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  // 发射器：学原版商店图——炮小、压在屏幕最底边只露上半截，和物件之间隔出一大片地面，才有"打远处"的距离感
  const tex = TEX.launcher_cannon;
  L.w = Math.min(VW * 0.42, VH * 0.2);
  L.h = tex ? L.w * tex.image.height / tex.image.width : L.w;
  L.x = VW / 2; L.y = VH + L.h * 0.15;   // 胖炮身占屏宽四成，底下 15% 出屏；道具按钮分在炮的两侧
  // 旋转底盘（学原版）：同心环带圆台，圆心正对炮的底座，整台炮落在内圈里，屏幕上只露出向上拱的几道弧
  const st = TEX.launcher_stage;
  if (st) {
    const sw = VW * 1.5, sh = sw * st.image.height / st.image.width;
    uiStage.scale.set(sw, sh, 1);
    const cy = VH - L.h * 0.08;   // 圆心（盘面中心）的屏幕位置，就在炮底座上
    uiStage.position.set(VW / 2, -cy, 1);
    // 道具栏抬到圆弧上方：按盘面椭圆算按钮所在 x 处的弧高（盘面半宽≈图宽 0.49，半高≈图高 0.42）
    const a = sw * 0.49, b = sh * 0.42, dx = VW / 2 - 44;
    const arcY = cy - b * Math.sqrt(Math.max(0, 1 - (dx / a) ** 2));
    document.documentElement.style.setProperty('--bar-lift', `${Math.max(0, VH - arcY + 4)}px`);
  }
  // 碗口对应的世界坐标：沿屏幕上碗口那一点的视线，取镜头前 D*0.42 处
  const mouthY = L.y - L.h * (1 - MOUTH_FY);
  const ndc = new THREE.Vector3((L.x / VW) * 2 - 1, -(mouthY / VH) * 2 + 1, 0.5).unproject(camera);
  MUZZLE.copy(camera.position).add(ndc.sub(camera.position).normalize().multiplyScalar(D * 0.26));   // 离镜头近：番茄出膛时很大，飞远变小，才有"打出去"的纵深
  uiCam.left = 0; uiCam.right = VW; uiCam.top = 0; uiCam.bottom = -VH; uiCam.updateProjectionMatrix();
  layoutUi();
}

// 叠加层精灵（屏幕像素坐标，y 向下取负）
const uiStage = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false }));
uiStage.center.set(0.5, 0.56);   // 锚点在盘面中心（图里盘面中心离底边约 56%）
uiStage.renderOrder = 1;
ui.add(uiStage);
const uiLauncher = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false }));
uiLauncher.renderOrder = 2;
uiLauncher.center.set(0.5, 0);   // 底边中点为锚点，压扁/后坐都以底边为基准
ui.add(uiLauncher);
const uiAmmo = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false }));
ui.add(uiAmmo);
const uiFlash = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true, blending: THREE.AdditiveBlending }));
ui.add(uiFlash);
const _fwd = new THREE.Vector3();
const uiFg = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false }));
uiFg.center.set(1, 0);
ui.add(uiFg);
const vignette = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), grd = g.createRadialGradient(128, 120, 70, 128, 128, 190);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(40,10,0,1)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, opacity: 0.35 }));
  s.center.set(0, 1);
  ui.add(s);
  return s;
})();
function layoutUi() {
  uiFlash.material.map = burstTex; uiFlash.material.needsUpdate = true; uiFlash.renderOrder = 4; uiAmmo.renderOrder = 3;
  if (TEX.launcher_cannon) uiLauncher.material.map = TEX.launcher_cannon;
  if (TEX.launcher_stage) { uiStage.material.map = TEX.launcher_stage; uiStage.material.needsUpdate = true; }
  uiLauncher.material.needsUpdate = true;
  uiFg.visible = false;   // 前景番茄堆会和道具按钮打架，原版前景也是干净的
  if (false && TEX.fg_tomatoes) {
    uiFg.material.map = TEX.fg_tomatoes; uiFg.material.needsUpdate = true;
    const w = Math.min(VW * 0.34, 200), h = w * TEX.fg_tomatoes.image.height / TEX.fg_tomatoes.image.width;
    uiFg.scale.set(-w, h, 1);   // 水平翻转，贴右下角
    uiFg.position.set(VW + w * 0.12 - w, -(VH - cssPx('--bar-h') + h * 0.35), 1);
    uiFg.center.set(0, 0);
  }
  vignette.scale.set(VW, VH, 1); vignette.position.set(0, 0, 0);
}

const rig = { lean: 0, leanV: 0, squash: 0, squashV: 0, recoil: 0, ammoPop: 1, flash: 0, punch: 0 };
const aimGoal = { lean: 0 };
function aimAt(p) {
  // 目标偏左右时，炮身跟着往那边歪一点
  const s = p.clone().project(camera);
  aimGoal.lean = THREE.MathUtils.clamp(-s.x * 0.18, -0.12, 0.12);
}

// ---------- 发射 ----------
const G = 18, SHOT_SPEED = 24, SHOT_MAX = 32;
function solveLaunch(from, to, straight = false) {
  const d = to.clone().sub(from), dist = d.length();
  if (straight) return { v: d.clone().normalize().multiplyScalar(22), t: dist / 22 };
  const vel = (t) => new THREE.Vector3(d.x / t, (d.y + 0.5 * G * t * t) / t, d.z / t);
  const speed = (t) => vel(t).length();
  let t = 0.1;
  while (t < 1.4 && speed(t) > SHOT_SPEED) t += 0.01;
  if (!pathBlocked(from, vel(t), t)) return { v: vel(t), t };
  // 挡板瞄准求解（学 Angry 的 AimBlockerBoxSolver）：落点不变，从最平最快试到高吊射，取第一条不撞的
  for (let k = 0.06; k <= 2.4; k += 0.02) {
    if (speed(k) > SHOT_MAX) continue;
    if (!pathBlocked(from, vel(k), k)) return { v: vel(k), t: k };
  }
  return { v: vel(t), t };
}
function pathBlocked(from, v, t) {
  const blockers = S.items.filter((it) => it.blocker && !it.dead);
  for (let s = 1; s < 24; s++) {
    const tau = (s / 24) * t * 0.92;
    const px = from.x + v.x * tau, py = from.y + v.y * tau - 0.5 * G * tau * tau, pz = from.z + v.z * tau;
    for (const b of blockers) {
      const q = b.body.position;
      if (Math.abs(px - q.x) < 1.1 + 0.36 && Math.abs(py - q.y) < 0.6 + 0.36 && Math.abs(pz - q.z) < 0.09 + 0.36) return true;
    }
  }
  return false;
}
function wakeAll() { for (const it of S.items) if (!it.dead && it.body.type === CANNON.Body.DYNAMIC) it.body.wakeUp(); }

function fire(target) {
  if (S.state !== 'play' || S.shots <= 0 || S.time - S.lastShotAt < 0.25) return;
  const kind = S.armed;
  wakeAll();   // 必须开炮时就唤醒：cannon-es 把休眠物体当无限质量求解
  aimAt(target);
  const m = MUZZLE.clone();
  const spawn = (r, mass, vel, img, extra = {}) => {
    const body = new CANNON.Body({ mass, material: PM.ball, shape: new CANNON.Sphere(r), position: new CANNON.Vec3(m.x, m.y, m.z) });
    body.allowSleep = false; body.linearDamping = 0.01;
    body.velocity.set(vel.x, vel.y, vel.z);
    body.ball = true;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX[img], alphaTest: 0.3 }));
    sprite.scale.set(r * 2.4, r * 2.4, 1);
    scene.add(sprite);
    const b = { kind: 'ball', body, sprite, born: S.time, life: 4.5, r, splatted: false, spin: (Math.random() - 0.5) * 12, hist: [], trail: makeTrail(r), ...extra };
    body.addEventListener('collide', (ev) => {
      S.needWake = true;
      if (!b.splatted && Math.abs(ev.contact.getImpactVelocityAlongNormal()) > 4) { b.splatted = true; b.splatNow = true; }
    });
    world.addBody(body);
    S.balls.push(b);
    return b;
  };
  if (kind === 'rocket') {
    // 穿甲火箭：运动学刚体直线匀速飞，质量无限 → 一路推开（Angry：max_travel_distance 40）
    const { v } = solveLaunch(m, target, true);
    const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, shape: new CANNON.Sphere(0.3), position: new CANNON.Vec3(m.x, m.y, m.z) });
    body.allowSleep = false; body.velocity.set(v.x, v.y, v.z); body.ball = true;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.icon_rocket, alphaTest: 0.3 }));
    sprite.scale.set(0.9, 0.9, 1);
    scene.add(sprite);
    world.addBody(body);
    S.balls.push({ kind: 'ball', rocket: true, body, sprite, born: S.time, life: 1.6, r: 0.3, spin: 0 });
  } else {
    const { v } = solveLaunch(m, target);
    const big = kind === 'big', tri = kind === 'tri';
    for (const deg of tri ? [-5, 0, 5] : [0]) {
      const vel = v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180);
      spawn(big ? 0.62 : tri ? 0.26 : 0.34, big ? 18 : tri ? 3.8 : 6.5, vel, big ? 'icon_melon' : 'icon_tomato', { big });
    }
  }
  S.shots--;
  if (kind) { inv[kind]--; store.set('inv', inv); S.armed = null; }
  S.lastShotAt = S.time;
  rig.squashV += kind === 'big' ? 10 : 7;
  rig.recoil = 1;
  rig.ammoPop = 0;
  rig.flash = 1;
  try { navigator.vibrate?.(kind === 'big' ? 30 : 15); } catch { /* 不支持震动 */ }
  rig.punch = kind === 'big' ? 1.6 : 1;   // 镜头被后坐力往后顶一下再回弹（单方向，不乱抖）
  puff(m, 3, 0.3);   // 炮口离镜头近，烟要小，否则糊住目标
  emit(m, [0xfff7e8, 0xffffff, 0xffd34d], 18, 3, 1.5, 0.35);
  // 开炮声：普通/大西瓜用自制炮声；三连发是三声快速连响；火箭在炮声上叠呼啸
  if (kind === 'big') { sfx.play('fire', { vol: 1, rate: 0.78 }); sfx.play('fire_big', { vol: 0.6 }); }   // 炮声压低音高 + 自制低频，更沉
  else if (kind === 'tri') [[0, 1.12], [0.05, 1], [0.1, 1.22]].forEach(([d, r]) => sfx.play('fire', { vol: 0.75, rate: r, delay: d, gap: 0 }));
  else sfx.play('fire', { vol: 1 });
  if (kind === 'rocket') sfx.play('fire_rocket', { vol: 0.8 });
  updateHud();
}

// ---------- 爆炸 ----------
function queueExplode(it) {
  if (it.exploding || it.dead) return;
  it.exploding = true;
  S.explodeQueue.push({ it, at: S.time + 0.06 });
}
const BOOM_COLORS = { kitchen: [0xe8261a, 0xff7a1a, 0xf6c33b, 0x9e1b12], drinks: [0x5a1e14, 0xfff1d6, 0xffffff, 0xe8261a], bakery: [0xffffff, 0xff8fb1, 0xfff1d6, 0xe8261a] };
function explode(it) {
  const p = new THREE.Vector3().copy(it.body.position);
  killItem(it);
  const R = 3.2, F = 26;
  for (const o of S.items) {
    if (o.dead || o.body.type !== CANNON.Body.DYNAMIC) continue;
    const d = new THREE.Vector3().copy(o.body.position).sub(p), dist = d.length();
    if (dist > R) continue;
    if (o.def.explosive) { queueExplode(o); continue; }
    o.body.wakeUp();
    d.normalize();
    const k = F * (1 - dist / R) * Math.pow(o.mass, 0.6);
    o.body.applyImpulse(new CANNON.Vec3(d.x * k, d.y * k + k * 0.5, d.z * k - k * 0.3));
  }
  flashes.push({ p, t: 0 });
  emit(p, BOOM_COLORS[S.theme], 100, 9, 3, 1.1);
  emit(p, BOOM_COLORS[S.theme], 22, 7, 4, 1.3, 14, true);
  puff(p, 10, 1.6);
  S.shake = 0.7;
  S.hitstop = 0.09;
  sfx.play('boom', { vol: 1, gap: 0.08 });
}
function killItem(it) {
  if (it.dead) return;
  it.dead = true;
  world.removeBody(it.body);
  levelGroup.remove(it.sprite); levelGroup.remove(it.shadow);
  if (it.counted && !it.cleared) onCleared(it);
}
function onCleared(it) {
  it.cleared = true;
  it.clearedAt = S.time;
  S.remaining--;
  S.combo = S.time - S.lastClearAt < 1.3 ? S.combo + 1 : 1;
  S.lastClearAt = S.time;
  sfx.play('pop', { rate: Math.min(2.4, 1 + (S.combo - 1) * 0.07), vol: 0.7, jitter: 0, gap: 0.02 });
  sfx.play(MAT[it.def.mat].fall, { vol: 0.35, gap: 0.08 });
  if (S.combo >= 3) showCombo();
  updateHud();
}

// ---------- 粒子（汁滴 / 果肉 / 彩纸）、烟雾、汁渍、闪光 ----------
const dropTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.65, 'rgba(255,255,255,.95)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(24, 23, 6, 0, 7); g.fill();
  return new THREE.CanvasTexture(c);
})();
const MAXP = 1400;
const pPos = new Float32Array(MAXP * 3).fill(-999), pCol = new Float32Array(MAXP * 3);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pFine = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.22, map: dropTex, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.05 }));
pFine.frustumCulled = false;
scene.add(pFine);
const cPos = new Float32Array(240 * 3).fill(-999), cCol = new Float32Array(240 * 3);
const cGeo = new THREE.BufferGeometry();
cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
cGeo.setAttribute('color', new THREE.BufferAttribute(cCol, 3));
const pChunk = new THREE.Points(cGeo, new THREE.PointsMaterial({ size: 0.55, map: dropTex, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.05 }));
pChunk.frustumCulled = false;
scene.add(pChunk);
const parts = [];
let nFine = 0, nChunk = 0;
const tmpC = new THREE.Color();
function emit(p, colors, n, speed, up = 2, life = 0.9, grav = 14, chunk = false) {
  for (let k = 0; k < n; k++) {
    const slot = chunk ? nChunk++ % 240 : nFine++ % MAXP;
    parts.push({ slot, chunk, x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 2 * speed, vy: Math.random() * speed + up, vz: (Math.random() - 0.5) * 2 * speed, life: life * (0.6 + 0.4 * Math.random()), grav });
    tmpC.setHex(colors[k % colors.length]);
    (chunk ? cCol : pCol).set([tmpC.r, tmpC.g, tmpC.b], slot * 3);
  }
  pGeo.attributes.color.needsUpdate = cGeo.attributes.color.needsUpdate = true;
}
const smokes = [];
function puff(p, n, scale = 1) {
  if (!TEX.smoke) return;
  for (let k = 0; k < n; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.smoke, transparent: true, depthWrite: false, opacity: 0.9 }));
    s.position.copy(p);
    levelGroup.add(s);
    smokes.push({ s, vx: (Math.random() - 0.5) * 2.5 * scale, vy: Math.random() * 1.5 * scale, vz: (Math.random() - 0.5) * 2 * scale - 1, t: 0, life: 0.6 + Math.random() * 0.4, size: (0.5 + Math.random() * 0.6) * scale });
  }
}
const splatTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(205,25,12,.92)';
  g.beginPath(); g.arc(80, 80, 40, 0, 7); g.fill();
  for (let k = 0; k < 13; k++) {
    const a = (k / 13) * 6.28 + Math.random() * 0.3, d = 36 + Math.random() * 34, r = 6 + Math.random() * 12;
    g.beginPath(); g.arc(80 + Math.cos(a) * d, 80 + Math.sin(a) * d, r, 0, 7); g.fill();
  }
  g.fillStyle = 'rgba(255,150,130,.55)'; g.beginPath(); g.arc(68, 66, 13, 0, 7); g.fill();
  return new THREE.CanvasTexture(c);
})();
const splats = [];
const flashes = [];
const flashTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,245,200,1)'); grd.addColorStop(0.45, 'rgba(255,160,40,.85)'); grd.addColorStop(1, 'rgba(255,80,20,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

// 炮口火光：中心白热 + 一圈尖刺
const burstTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  for (let k = 0; k < 10; k++) {
    g.rotate(Math.PI / 5 + (k % 2) * 0.12);
    const len = k % 2 ? 80 : 124;
    const grd = g.createLinearGradient(0, 0, len, 0);
    grd.addColorStop(0, 'rgba(255,240,170,1)'); grd.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(0, -14); g.lineTo(len, 0); g.lineTo(0, 14); g.fill();
  }
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 70);
  grd.addColorStop(0, 'rgba(255,255,235,1)'); grd.addColorStop(0.5, 'rgba(255,200,80,.8)'); grd.addColorStop(1, 'rgba(255,100,20,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 70, 0, 7); g.fill();
  return new THREE.CanvasTexture(c);
})();

// 弹道火线（学原版）：沿最近几帧的位置排一串加色光点，头亮尾细，砸中后迅速收掉
const TRAIL_N = 14;
function makeTrail(r) {
  const out = [];
  for (let k = 0; k < TRAIL_N; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.visible = false;
    scene.add(s);
    out.push(s);
  }
  out.r = r;
  return out;
}
function updateTrail(b) {
  const h = b.hist, fade = b.splatted ? Math.max(0, 1 - (S.time - (b.splatAt ?? S.time)) / 0.15) : 1;
  for (let k = 0; k < TRAIL_N; k++) {
    const s = b.trail[k], i = k * 2 * 3;   // 每隔一步取一个点，拉长火线
    if (i + 2 >= h.length || fade <= 0) { s.visible = false; continue; }
    s.visible = true;
    s.position.set(h[i], h[i + 1], h[i + 2]);
    const a = 1 - k / TRAIL_N;
    s.scale.setScalar(b.trail.r * (b.big ? 2.6 : 3.2) * (0.35 + 0.65 * a));
    s.material.opacity = 0.55 * a * fade;
  }
}

// ---------- 瞄准显示 ----------
const DOTS = 26;
const dotPos = new Float32Array(DOTS * 3);
const dotGeo = new THREE.BufferGeometry();
dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ size: 0.16, map: dropTex, color: 0xffffff, transparent: true, depthTest: false }));
dots.frustumCulled = false; dots.visible = false; dots.renderOrder = 10;
scene.add(dots);
const reticle = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.38, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false }));
reticle.visible = false; reticle.renderOrder = 11;
scene.add(reticle);

const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
function pick(cx, cy) {
  const ndc = new THREE.Vector2((cx / VW) * 2 - 1, -(cy / VH) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(S.items.filter((it) => !it.dead && !it.cleared).map((it) => it.sprite).concat(tableMesh ? [tableMesh] : []), false);
  if (hits.length) return hits[0].point.clone();
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(aimPlane, p) ? p : null;
}
let aiming = false, aimPt = null;
canvas.addEventListener('pointerdown', (ev) => {
  sfx.unlock();
  if (S.state !== 'play' || S.shots <= 0 || S.paused) return;
  canvas.setPointerCapture(ev.pointerId);
  aiming = true;
  aimPt = pick(ev.clientX, ev.clientY);
});
canvas.addEventListener('pointermove', (ev) => { if (aiming) aimPt = pick(ev.clientX, ev.clientY) || aimPt; });
canvas.addEventListener('pointerup', () => { if (aiming && aimPt) fire(aimPt); aiming = false; });
canvas.addEventListener('pointercancel', () => (aiming = false));
for (const [k, b] of Object.entries(BOOSTERS)) {
  $(b.btn).addEventListener('click', () => {
    sfx.unlock();
    if (S.levelIdx + 1 < b.unlock) { toast(`Unlocks at Level ${b.unlock}`); return; }
    if (inv[k] <= 0) { toast('No boosters left'); return; }
    S.armed = S.armed === k ? null : k;
    sfx.play(S.armed === 'big' ? 'big_grow' : 'booster_tap');
    rig.squashV -= 4;
    rig.ammoPop = 0;
    updateHud();
  });
}
$('prev').onclick = () => loadLevel(S.levelIdx - 1);
$('next').onclick = () => loadLevel(S.levelIdx + 1);
$('theme').onclick = () => { const ids = ['kitchen', 'drinks', 'bakery']; S.themeOverride = ids[(ids.indexOf(S.theme) + 1) % 3]; loadLevel(S.levelIdx, true); };
$('mute').onclick = () => { $('mute').textContent = sfx.toggleMute() ? '🔇' : '🔊'; };
$('gear').onclick = () => { sfx.play('click'); S.paused = true; $('settings').classList.remove('hidden'); };
$('sClose').onclick = () => { sfx.play('click'); S.paused = false; $('settings').classList.add('hidden'); };
$('sRestart').onclick = () => { sfx.play('click'); S.paused = false; $('settings').classList.add('hidden'); loadLevel(S.levelIdx, true); };
$('sSound').onclick = () => { const m = sfx.toggleMute(); $('sSoundText').textContent = m ? 'SOUND: OFF' : 'SOUND: ON'; if (!m) sfx.play('click'); };
$('startBtn').onclick = () => { sfx.unlock(); sfx.play('click'); leaveStart(); };
addEventListener('keydown', (e) => { if (e.key === 'r' || e.key === 'R') loadLevel(S.levelIdx, true); });
addEventListener('resize', layout);
function leaveStart() {
  $('start').classList.add('hidden');
  document.body.classList.remove('on-start');
  loadLevel(S.levelIdx);
}

// ---------- 模拟 ----------
function settled() {
  return S.items.every((it) => it.dead || it.cleared || it.body.type !== CANNON.Body.DYNAMIC || it.body.sleepState === CANNON.Body.SLEEPING || it.body.velocity.lengthSquared() < 0.03);
}
const _up = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();
function step(dt) {
  S.time += dt;
  if (S.balls.length) wakeAll();   // 有番茄在飞就不许物件睡着，否则撞上的那一下按无限质量算
  world.step(1 / 120, dt, 4);
  if (S.needWake) { wakeAll(); S.needWake = false; }
  for (let k = S.explodeQueue.length - 1; k >= 0; k--) {
    if (S.time >= S.explodeQueue[k].at) { const q = S.explodeQueue.splice(k, 1)[0]; explode(q.it); }
  }
  for (const it of S.items) {
    if (it.dead || !it.counted) continue;
    const p = it.body.position;
    if (!it.cleared && p.y < -1.0) {
      onCleared(it);
      emit(new THREE.Vector3(p.x, p.y, p.z), [0xfff1d6, 0xf6c33b, 0xffffff], 10, 2, 2.5, 0.6);
    }
    if (it.cleared && S.time - it.clearedAt > 1.4) killItem(it);
  }
  for (let k = S.balls.length - 1; k >= 0; k--) {
    const b = S.balls[k], p = b.body.position;
    if (b.rocket) emit(new THREE.Vector3(p.x, p.y, p.z), [0xff7a1a, 0xf6c33b, 0xfff1d6], 3, 0.6, 0, 0.35, 0);
    else if (!b.splatted) emit(new THREE.Vector3(p.x, p.y, p.z), [0xffffff, 0xfff4c2, 0xffd34d, 0xff9a1a], b.big ? 7 : 5, 0.15, 0, 0.32, 0);   // 拖尾：学原版的一道亮黄火线
    if (b.splatNow) {
      b.splatNow = false;
      b.splatAt = S.time;
      const at = new THREE.Vector3(p.x, p.y, p.z);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: splatTex, transparent: true, depthWrite: false, rotation: Math.random() * 6.28 }));
      s.position.copy(at).add(new THREE.Vector3(0, 0, 0.3));
      levelGroup.add(s);
      splats.push({ s, born: S.time, size: b.big ? 1.9 : 1.1 });
      emit(at, b.big ? [0xff4d6d, 0x2e8b3a, 0xffd0d0] : [0xd8200f, 0xff5a3c, 0xf6c33b], b.big ? 16 : 9, 4, 3, 1.0, 14, true);
      emit(at, [0xe8261a, 0xff7a5a, 0xffffff], b.big ? 60 : 36, 5.5, 3.5, 0.8);
      sfx.play(b.big ? 'splat_big' : 'splat', { vol: b.big ? 1 : 0.8 });
      sfx.play('hit_soft', { vol: 0.55, rate: b.big ? 0.8 : 1 });   // 叠一层软物命中，汁水感更实
      S.shake = Math.max(S.shake, b.big ? 0.35 : 0.12);
      S.hitstop = Math.max(S.hitstop, b.big ? 0.07 : 0.035);   // 每一下命中都顿一帧，打击感
    }
    if (b.hist && !b.splatted) { b.hist.unshift(p.x, p.y, p.z); if (b.hist.length > TRAIL_N * 3 * 2) b.hist.length = TRAIL_N * 3 * 2; }
    if (S.time - b.born > b.life || p.y < FLOOR_Y - 1) { world.removeBody(b.body); scene.remove(b.sprite); if (b.trail) for (const t of b.trail) scene.remove(t); S.balls.splice(k, 1); }
  }
  for (let k = parts.length - 1; k >= 0; k--) {
    const q = parts[k], arr = q.chunk ? cPos : pPos;
    q.life -= dt;
    if (q.life <= 0) { arr[q.slot * 3 + 1] = -999; parts.splice(k, 1); continue; }
    q.vy -= q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    arr.set([q.x, q.y, q.z], q.slot * 3);
  }
  pGeo.attributes.position.needsUpdate = cGeo.attributes.position.needsUpdate = true;
  for (let k = smokes.length - 1; k >= 0; k--) {
    const m = smokes[k];
    m.t += dt;
    const a = m.t / m.life;
    if (a >= 1) { levelGroup.remove(m.s); m.s.material.dispose(); smokes.splice(k, 1); continue; }
    m.s.position.x += m.vx * dt; m.s.position.y += m.vy * dt; m.s.position.z += m.vz * dt;
    m.s.scale.setScalar(m.size * (0.6 + a * 0.9));
    m.s.material.opacity = 0.9 * (1 - a);
  }
  for (let k = splats.length - 1; k >= 0; k--) {
    const sp = splats[k], age = S.time - sp.born;
    sp.s.scale.setScalar(sp.size * Math.min(1, age / 0.08));
    sp.s.material.opacity = age < 2.5 ? 0.95 : Math.max(0, 0.95 - (age - 2.5));
    if (age > 3.5) { levelGroup.remove(sp.s); sp.s.material.dispose(); splats.splice(k, 1); }
  }
  for (let k = flashes.length - 1; k >= 0; k--) {
    const f = flashes[k];
    if (!f.s) { f.s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); f.s.position.copy(f.p); scene.add(f.s); }
    f.t += dt / 0.35;
    f.s.scale.setScalar(0.8 + f.t * 5);
    f.s.material.opacity = 1 - f.t;
    if (f.t >= 1) { scene.remove(f.s); f.s.material.dispose(); flashes.splice(k, 1); }
  }
  if (S.state === 'play') {
    if (S.remaining <= 0) win();
    else if (S.shots <= 0 && !S.explodeQueue.length) {
      const since = S.time - S.lastShotAt;
      if ((since > 2.2 && settled()) || since > 8) lose();
    }
  }
  // 发射器动作：弹簧（歪向目标、压扁回弹、后坐）
  if (!aiming && S.time - S.lastShotAt > 0.6) aimGoal.lean = 0;
  const spring = (x, v, target, k, c) => { v += (k * (target - x) - c * v) * dt; return [x + v * dt, v]; };
  [rig.lean, rig.leanV] = spring(rig.lean, rig.leanV, aimGoal.lean, 60, 15.5);   // 临界阻尼：歪过去就停，不来回晃
  [rig.squash, rig.squashV] = spring(rig.squash, rig.squashV, aiming ? 0.2 : 0, 300, 26);   // 按住瞄准时炮身微微压低蓄力，松手弹起开炮
  rig.recoil = Math.max(0, rig.recoil - dt * 4);
  rig.flash = Math.max(0, rig.flash - dt * 9);
  rig.punch = Math.max(0, rig.punch - dt * 5);
  rig.ammoPop = Math.min(1, rig.ammoPop + dt * 4);
  S.shake = Math.max(0, S.shake - dt * 1.8);
}

// 把物件精灵对齐到刚体：侧倒 = 精灵旋转；往前/往后倒 = 精灵沿竖向透视压缩
function syncItem(it) {
  const p = it.body.position;
  it.sprite.position.set(p.x, p.y, p.z);
  if (!it.blocker) {
    _q.set(it.body.quaternion.x, it.body.quaternion.y, it.body.quaternion.z, it.body.quaternion.w);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _r.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
    const ux = _up.dot(_r), uy = _up.dot(_u);
    it.sprite.material.rotation = Math.atan2(-ux, uy);
    const fore = Math.max(0.3, Math.hypot(ux, uy));
    const fade = it.cleared ? Math.max(0.001, 1 - Math.max(0, S.time - it.clearedAt - 0.8) / 0.5) : 1;
    it.sprite.scale.set(it.dw * fade, it.dh * fore * fade, 1);
  }
  // 接触阴影：在桌面或地板上，离得越高越淡
  const surf = Math.abs(p.x) < S.level.Table.w / 2 && Math.abs(p.z) < TABLE_D / 2 && p.y > -0.3 ? 0.005 : FLOOR_Y + 0.005;
  const hgt = p.y - it.dh / 2 - surf;
  it.shadow.position.set(p.x, surf, p.z);
  it.shadow.scale.set(it.dw * 1.3, 1, Math.max(0.4, it.dw * 0.7));
  it.shadow.visible = hgt < 2.5 && !it.blocker;
  it.shadow.material.opacity = 1;
}

function render() {
  if (S.level) {
    for (const it of S.items) if (!it.dead) syncItem(it);
    for (const b of S.balls) {
      const p = b.body.position;
      b.sprite.position.set(p.x, p.y, p.z);
      b.sprite.material.rotation += b.spin * 0.016;
      if (b.trail) updateTrail(b);
    }
  }
  // 瞄准虚线
  if (aiming && aimPt) {
    aimAt(aimPt);
    const straight = S.armed === 'rocket';
    const { v, t } = solveLaunch(MUZZLE, aimPt, straight);
    for (let k = 0; k < DOTS; k++) {
      const tau = ((k + 1) / DOTS) * t;
      dotPos.set([MUZZLE.x + v.x * tau, MUZZLE.y + v.y * tau - (straight ? 0 : 0.5 * G * tau * tau), MUZZLE.z + v.z * tau], k * 3);
    }
    dotGeo.attributes.position.needsUpdate = true;
    reticle.position.copy(aimPt).add(new THREE.Vector3(0, 0, 0.05));
    reticle.lookAt(camera.position);
    dots.visible = reticle.visible = true;
  } else dots.visible = reticle.visible = false;
  // 镜头抖动
  camera.position.copy(camBase);
  // 抖动用平滑的正弦而不是每帧随机跳（随机跳看久了会晕）；开炮只往后顶一下
  if (S.shake > 0) camera.position.add(new THREE.Vector3(Math.sin(S.time * 41), Math.sin(S.time * 33 + 1.7), 0).multiplyScalar(S.shake * 0.12));
  if (rig.punch > 0) camera.position.addScaledVector(_fwd.copy(CAM_T).sub(camBase).normalize(), -Math.sin(Math.min(1, rig.punch) * Math.PI) * 0.18 * rig.punch);
  camera.updateMatrixWorld();
  // 发射器（屏幕空间）：底边锚点，压扁 + 后坐下沉 + 歪向目标
  const sq = Math.max(-0.5, Math.min(0.7, rig.squash));
  uiLauncher.scale.set(L.w * (1 + sq * 0.1), L.h * (1 - sq * 0.14), 1);
  const kick = rig.recoil ** 2.2;   // 一下子坐下去，慢慢回位
  uiLauncher.position.set(L.x, -(L.y + kick * L.h * 0.12), 2);
  // 炮口火光
  uiFlash.visible = rig.flash > 0 && !!uiFlash.material.map;
  if (uiFlash.visible) {
    const fz = L.h * (0.55 + (1 - rig.flash) * 0.5);
    uiFlash.scale.set(fz, fz, 1);
    uiFlash.position.set(L.x + Math.sin(rig.lean) * L.h * (1 - MOUTH_FY), -(L.y - Math.cos(rig.lean) * L.h * (1 - MOUTH_FY) + kick * L.h * 0.12), 4);
    uiFlash.material.opacity = rig.flash;
  }
  uiLauncher.material.rotation = rig.lean;
  // 碗口里预装的下一发
  const ammoKey = S.armed === 'big' ? 'icon_melon' : S.armed === 'tri' ? 'icon_triple' : S.armed === 'rocket' ? 'icon_rocket' : 'icon_tomato';
  uiAmmo.visible = !!S.armed && S.state === 'play' && S.shots > 0 && S.time - S.lastShotAt > 0.2 && !!TEX[ammoKey];   // 只在装了道具弹时显示在炮口
  if (uiAmmo.visible) {
    if (uiAmmo.material.map !== TEX[ammoKey]) { uiAmmo.material.map = TEX[ammoKey]; uiAmmo.material.needsUpdate = true; }
    const pop = rig.ammoPop < 1 ? Math.sin(rig.ammoPop * Math.PI) * 0.25 + rig.ammoPop : 1;
    const z = L.h * (S.armed === 'big' ? 0.34 : 0.25) * pop;
    const mx = L.x + Math.sin(rig.lean) * L.h * (1 - MOUTH_FY), my = L.y - Math.cos(rig.lean) * L.h * (1 - MOUTH_FY);
    uiAmmo.scale.set(z, z, 1);
    uiAmmo.position.set(mx, -(my - z * 0.15), 3);
  }
  vignette.material.opacity = S.diff === 2 ? 0.55 : S.diff === 1 ? 0.45 : 0.35;
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  if (S.state !== 'start') renderer.render(ui, uiCam);
  if (window.__overlay) window.__overlay(renderer, VW, VH);   // 宣传片录制：字幕 / Logo 叠加层
}

// ---------- 主循环 ----------
let last = performance.now(), acc = 0;
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.hitstop > 0) { S.hitstop -= dt; dt *= 0.12; }   // 打击停顿
  if (S.level && S.state !== 'start' && !S.paused) {
    acc += dt;
    while (acc >= 1 / 60) { step(1 / 60); acc -= 1 / 60; }
  }
  render();
  requestAnimationFrame(frame);
}

if (params.has('debug')) document.body.classList.add('debug');
if (params.has('silent')) { sfx.toggleMute(); $('mute').textContent = '🔇'; }
sfx.loadSamples();
await loadAssets();
setDims(archDims);
layout();
if (params.has('play')) leaveStart();
requestAnimationFrame(frame);

// ---------- 测试接口：自动化试玩 / 机器人校准 / 宣传片录制 ----------
window.__game = {
  S, inv, loadLevel, renderer, camera,
  start: () => leaveStart(),
  arm: (k) => { S.armed = k; },
  fireAt: (x, y, z = 0) => fire(new THREE.Vector3(x, y, z)),
  load: (idx, theme) => { S.themeOverride = theme || null; loadLevel(idx, !!theme); },
  items: () => S.items,
  pos: (it) => it.body.position,
  tick(sec) { for (let k = 0; k < Math.round(sec * 60); k++) step(1 / 60); render(); },
  // 机器人：打最高的物件；同一目标连续两发没进展就登记为死角换目标（学 Angry 的 AutoplayDeadAimRegistry）
  // ammo：null = 给足弹药测"需要几发"；'real' = 用关卡真实炮弹数测"能不能过"
  autoplay(list, ammo = null) {
    if (document.body.classList.contains('on-start')) leaveStart();
    const invBefore = { ...inv };
    const out = {};
    for (const n of list) {
      if (ammo === 'real') store.set('dda', 0);
      loadLevel(n - 1);
      if (ammo !== 'real') S.shots = ammo ?? 40;
      const budget = ammo === 'real' ? S.shots : ammo ?? 25;
      let used = 0;
      const dead = new Map();
      while (S.remaining > 0 && used < budget && S.shots > 0) {
        const live = S.items.filter((i) => !i.dead && !i.cleared && i.counted);
        if (!live.length) break;
        let cand = live.filter((i) => (dead.get(i) || 0) < 2);
        if (!cand.length) { dead.clear(); cand = live; }
        cand.sort((a, b) => b.body.position.y - a.body.position.y);
        const it = cand[0], before = S.remaining, p0 = new THREE.Vector3().copy(it.body.position);
        S.lastShotAt = -99;
        fire(p0.clone());
        used++;
        this.tick(2.0);
        const moved = it.cleared || p0.distanceTo(new THREE.Vector3().copy(it.body.position)) > 0.3;
        if (S.remaining === before && !moved) dead.set(it, (dead.get(it) || 0) + 1);
      }
      this.tick(2.5);
      out[n] = { need: S.remaining <= 0 ? used : 99, total: S.total, left: S.remaining, diff: S.diff };
    }
    Object.assign(inv, invBefore);
    store.set('inv', inv);
    updateHud();
    return out;
  },
};
