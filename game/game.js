// Tomato Blast · 2D 侧视版
// 画面：物件、桌子、发射器全部是 AI 生成的海报级精灵图；碰撞形状从图片轮廓（alpha）自动提取凸包
// 物理：planck.js（Box2D），x 向右、y 向上、单位米；桌面上表面 y = 0
import * as planck from 'planck';
import { LEVELS, ARCH, difficultyOf } from './levels.js';
import * as sfx from './sfx.js';

const Vec2 = (x, y) => new planck.Vec2(x, y);
const params = new URLSearchParams(location.search);

// ---------- 存档：只放每台设备自己的进度/道具，读写都要能失败 ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('tomato2d_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tomato2d_' + k, JSON.stringify(v)); } catch { /* 隐私模式等 */ } },
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
  tri: { name: '三连发', unlock: 2, btn: 'bTri' },
  rocket: { name: '穿甲火箭', unlock: 3, btn: 'bRocket' },
  big: { name: '西瓜弹', unlock: 5, btn: 'bBig' },
};
const inv = { tri: 3, rocket: 3, big: 3, ...store.get('inv', {}) };

// ---------- 素材 ----------
const IMG = {};
const loadImg = (key, src) => new Promise((res) => {
  const im = new Image();
  im.onload = () => { IMG[key] = im; res(im); };
  im.onerror = () => res(null);
  im.src = src;
});
let MANIFEST = {};
async function loadAssets() {
  try { MANIFEST = await (await fetch('assets/sprites/manifest.json', { cache: 'no-store' })).json(); } catch { MANIFEST = {}; }
  const jobs = Object.keys(MANIFEST).map((k) => loadImg(k, `assets/sprites/${k}.png`));
  for (const t of ['kitchen', 'drinks', 'bakery']) for (const v of ['v', 'h']) jobs.push(loadImg(`bg_${t}_${v}`, `assets/bg_${t}_${v}.jpg`));
  for (const k of ['icon_tomato', 'icon_triple', 'icon_melon', 'icon_rocket', 'txt_great', 'txt_awesome', 'txt_amazing']) jobs.push(loadImg(k, `assets/ui/${k}.png`));
  await Promise.all(jobs);
}

// 精灵 → 碰撞凸包：读 alpha，取不透明像素的凸包，再删点到 ≤ 10 个顶点（Box2D 多边形上限 12）
const hullCache = {};
function spriteHull(key) {
  if (hullCache[key]) return hullCache[key];
  const im = IMG[key];
  if (!im) return null;
  const S = 64, c = document.createElement('canvas');
  const sc = S / Math.max(im.width, im.height);
  c.width = Math.max(2, Math.round(im.width * sc)); c.height = Math.max(2, Math.round(im.height * sc));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0, c.width, c.height);
  const a = g.getImageData(0, 0, c.width, c.height).data;
  const pts = [];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (a[(y * c.width + x) * 4 + 3] > 110) {
        // 归一化到 [-0.5, 0.5]，y 翻转成向上
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) pts.push([(x + dx) / c.width - 0.5, 0.5 - (y + dy) / c.height]);
      }
    }
  }
  let hull = convexHull(pts);
  while (hull.length > 10) {
    let best = 0, bestA = Infinity;
    for (let i = 0; i < hull.length; i++) {
      const p = hull[(i + hull.length - 1) % hull.length], q = hull[i], r = hull[(i + 1) % hull.length];
      const area = Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]));
      if (area < bestA) { bestA = area; best = i; }
    }
    hull.splice(best, 1);
  }
  return (hullCache[key] = { hull, aspect: im.width / im.height });
}
function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);   // 逆时针
}

// 某主题某原型对应的精灵键（多变体轮换）
function spriteKey(theme, arch, i) {
  if (arch === 'wall' || arch === 'slider') return MANIFEST.wall ? 'wall' : null;
  const base = `${theme}_${arch}`;
  const vs = [0, 1, 2].filter((v) => MANIFEST[`${base}_${v}`]);
  if (vs.length) return `${base}_${vs[i % vs.length]}`;
  return MANIFEST[base] ? base : null;
}
// 精灵在原型框（w×h 米）里等比"contain"放置，返回实际绘制尺寸
function fitBox(key, w, h) {
  const im = IMG[key];
  if (!im) return { dw: w, dh: h };
  const a = im.width / im.height;
  return a > w / h ? { dw: w, dh: w / a } : { dw: h * a, dh: h };
}

// ---------- 画布 & 布局（三块安全区） ----------
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
let DPR = 1, VW = 0, VH = 0;
const view = { s: 40, ox: 0, oy: 0 };   // 世界 → 屏幕：sx = ox + x*s，sy = oy - y*s
function cssPx(name) { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0; }
function layout() {
  DPR = Math.min(2, Math.max(1.5, devicePixelRatio || 1));
  VW = innerWidth; VH = innerHeight;
  canvas.width = Math.round(VW * DPR); canvas.height = Math.round(VH * DPR);
  if (!S.level) return;
  const top = cssPx('--hud-h') + 12, bottom = VH - cssPx('--bar-h');
  const tw = S.level.Table.w;
  // 世界取景：左边留给发射器，右边留一点；上面按关卡最高物件留空
  const x0 = LAUNCH.x - launcherBox().w / 2 - 0.25, x1 = tw / 2 + 0.45;
  const y0 = LAUNCH.y - 0.35, y1 = Math.max(4.6, S.maxTop + 1.6);
  const s = Math.min(VW / (x1 - x0), (bottom - top) / (y1 - y0));
  view.s = s;
  view.ox = (VW - (x1 - x0) * s) / 2 - x0 * s;
  const extra = (bottom - top) - (y1 - y0) * s;          // 竖屏时高度有富余：整体上移一部分，桌子更居中
  view.oy = bottom - Math.max(0, extra) * 0.3 + y0 * s;
}
const sx = (x) => view.ox + x * view.s;
const sy = (y) => view.oy - y * view.s;
const toWorld = (px, py) => ({ x: (px - view.ox) / view.s, y: (view.oy - py) / view.s });

// ---------- 物理世界 ----------
const MAT = {   // 摩擦 / 弹性 / 命中音效 / 掉落音效
  wood: { f: 0.55, r: 0.05, hit: 'hit_wood', fall: 'fall_wood' },
  stone: { f: 0.6, r: 0.02, hit: 'hit_stone', fall: 'fall_stone' },
  ice: { f: 0.02, r: 0.05, hit: 'hit_ice', fall: 'fall_wood' },
  metal: { f: 0.35, r: 0.08, hit: 'hit_tin', fall: 'fall_tin' },
  glass: { f: 0.35, r: 0.06, hit: 'hit_glass', fall: 'fall_tin' },
  soft: { f: 0.5, r: 0.1, hit: 'hit_soft', fall: 'fall_wood' },
};
let world;
const LAUNCH = { x: -6, y: -2.2 };   // 发射器底座中心（世界坐标），关卡加载时按桌宽重算
const S = {
  levelIdx: store.get('level', 0), level: null, items: [], balls: [], explodeQueue: [], kill: [],
  shots: 0, startShots: 1, total: 0, remaining: 0, state: 'start', time: 0, lastShotAt: -99,
  armed: null, continued: false, shake: 0, hitstop: 0, diff: 0, theme: 'kitchen', themeOverride: null,
  combo: 0, lastClearAt: -9, maxTop: 4,
};

function newWorld() {
  world = new planck.World({ gravity: Vec2(0, -18) });
  world.on('post-solve', (contact, imp) => {
    const a = contact.getFixtureA().getBody().getUserData(), b = contact.getFixtureB().getBody().getUserData();
    const j = imp.normalImpulses[0] || 0;
    for (const [u, o] of [[a, b], [b, a]]) {
      if (!u) continue;
      if (u.kind === 'item') {
        const m = u.mass || 1;
        if (j / m > 2.2) sfx.play(MAT[u.def.mat].hit, { vol: Math.min(1, j / m / 9), gap: 0.05 });
        if (u.def.explosive && (j > 3.5 || (o && o.kind === 'ball'))) queueExplode(u);
      }
      if (u.kind === 'ball' && !u.splatted && j > 4) { u.splatted = true; u.splatNow = true; }
    }
  });
}

// ---------- 关卡 ----------
function clearLevel() {
  S.items = []; S.balls = []; S.explodeQueue = []; S.kill = []; decals.length = 0; parts.length = 0;
  newWorld();
}
function spawnItem(e, i) {
  const def = ARCH[e.Id];
  if (!def) { console.warn('未知原型', e.Id); return; }
  const key = spriteKey(S.theme, e.Id, i);
  const { dw, dh } = key ? fitBox(key, def.w, def.h) : { dw: def.w, dh: def.h };
  const kind = def.body || 'dynamic';
  const body = world.createBody({ type: kind, position: Vec2(e.x, e.y), allowSleep: true, linearDamping: 0.05, angularDamping: 0.15 });
  const m = MAT[def.mat];
  let shape;
  const hull = key && !def.round ? spriteHull(key) : null;
  if (def.round) shape = new planck.Circle(Math.min(dw, dh) / 2 * 0.96);
  else if (hull && hull.hull.length >= 3) shape = new planck.Polygon(hull.hull.map(([x, y]) => Vec2(x * dw, y * dh)));
  else shape = new planck.Box(dw / 2, dh / 2);
  const area = def.round ? Math.PI * (dw / 2) ** 2 : dw * dh * 0.85;
  body.createFixture({ shape, density: kind === 'dynamic' ? def.mass / area : 0, friction: m.f, restitution: m.r });
  const it = { kind: 'item', arch: e.Id, def, body, key, dw, dh, mass: def.mass || 0, counted: def.counted !== false, cleared: false, clearedAt: 0, dead: false, exploding: false, custom: e.Custom || {}, y0: e.y };
  body.setUserData(it);
  S.items.push(it);
}

function loadLevel(idx, keepTheme = false) {
  idx = ((idx % LEVELS.length) + LEVELS.length) % LEVELS.length;
  if (!keepTheme) S.themeOverride = null;
  clearLevel();
  hidePanel();
  S.levelIdx = idx;
  store.set('level', idx);
  const lvl = LEVELS[idx], n = idx + 1;
  S.level = lvl;
  S.theme = S.themeOverride || lvl.Theme || 'kitchen';
  S.diff = lvl.Difficulty ?? difficultyOf(n);
  // 桌子：静态矩形，上表面 y = 0
  const tw = lvl.Table.w;
  const table = world.createBody({ type: 'static', position: Vec2(0, -0.25) });
  table.createFixture({ shape: new planck.Box(tw / 2, 0.25), friction: 0.6 });
  LAUNCH.x = -tw / 2 - 1.75; LAUNCH.y = -2.3;
  lvl.Entities.forEach(spawnItem);
  S.maxTop = Math.max(...S.items.map((it) => it.body.getPosition().y + it.dh / 2), 3);
  S.total = S.remaining = S.items.filter((it) => it.counted).length;
  S.shots = S.startShots = ddaShots(n, S.diff, lvl.MoveCount);
  Object.assign(S, { state: 'play', lastShotAt: -99, armed: null, continued: false, combo: 0, time: S.time });
  layout();
  $('chapter').textContent = `${{ kitchen: '番茄厨房', drinks: '饮料吧', bakery: '烘焙坊' }[S.theme]} · ${lvl.name}`;
  const tag = $('tag');
  tag.classList.toggle('on', S.diff > 0);
  $('tagImg').src = S.diff === 2 ? 'assets/ui/ui_tag_super.png' : 'assets/ui/ui_tag_hard.png';
  $('tagText').textContent = S.diff === 2 ? '超难' : '困难';
  const unlocked = Object.values(BOOSTERS).find((b) => b.unlock === n);
  toast(S.diff === 2 ? '超难关卡！' : S.diff === 1 ? '困难关卡' : unlocked ? `解锁新道具：${unlocked.name}` : lvl.name);
  updateHud();
}

// ---------- HUD ----------
function updateHud() {
  $('lvlNum').textContent = S.levelIdx + 1;
  $('shots').textContent = S.shots;
  $('barFill').style.width = `${S.total ? (100 * (S.total - S.remaining)) / S.total : 0}%`;
  $('left').textContent = `${S.total - S.remaining}/${S.total}`;
  for (const [k, b] of Object.entries(BOOSTERS)) {
    const el = $(b.btn), locked = S.levelIdx + 1 < b.unlock;
    el.querySelector('.cnt').textContent = locked ? '🔒' : inv[k];
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
  $('pTitle').classList.toggle('hidden', !!win);
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

// ---------- 胜负 ----------
function win() {
  S.state = 'won';
  sfx.play('win');
  setTimeout(() => sfx.play('firework'), 250);
  setTimeout(() => sfx.play('firework', { rate: 1.2 }), 550);
  ddaAdd(S.continued ? 0 : DDA.scoring.cleanWin);
  if (S.diff === 2) { for (const k in BOOSTERS) inv[k]++; store.set('inv', inv); }
  for (let k = 0; k < 8; k++) emit((Math.random() - 0.5) * 8, 4 + Math.random() * 3, ['#e8261a', '#fff1d6', '#3daa5c', '#f6c33b'], 26, 5, 4, 2.4, 0.13);
  const last = S.levelIdx === LEVELS.length - 1;
  setTimeout(() => showPanel({
    win: true,
    text: `${S.level.name} 完成 · 剩余 ${S.shots} 颗番茄${S.diff === 2 ? '\n超难奖励：每种道具 +1' : ''}`,
    main: last ? '从头再玩' : '下一关', onMain: () => loadLevel(S.levelIdx + 1),
  }), 900);
}
function lose() {
  S.state = 'lost';
  sfx.play('lose');
  showPanel({
    title: '番茄用完了', text: `还差 ${S.remaining} 个没打下桌`,
    main: '+5 颗番茄继续', onMain: () => {
      S.shots += 5; S.continued = true; S.state = 'play'; S.lastShotAt = S.time;
      ddaAdd(DDA.scoring.continue);   // 原作：花金币续关 = 积分 +5（视为更强的玩家）
      updateHud();
    },
    alt: '重新开始', onAlt: () => { ddaAdd(DDA.scoring.loss); loadLevel(S.levelIdx, true); },
  });
}

// ---------- 发射器（料理机精灵）：弹簧驱动的倾斜 + 压扁回弹，动作克制 ----------
const rig = { lean: 0, leanV: 0, squash: 0, squashV: 0, ammoPop: 1 };
const LAUNCH_H = 2.5;                 // 料理机高度（米）
const MUZZLE = { fx: 0.5, fy: 0.13 };  // 碗口在精灵里的位置（左→右 0..1，上→下 0..1）
function launcherBox() {
  const im = IMG.launcher;
  const h = LAUNCH_H, w = im ? h * im.width / im.height : h * 0.8;
  return { w, h };
}
function muzzle() {
  const { w, h } = launcherBox();
  // 绕底座中心旋转（lean），近似把碗口跟着身体转
  const lx = (MUZZLE.fx - 0.5) * w, ly = (1 - MUZZLE.fy) * h;
  const c = Math.cos(-rig.lean), s = Math.sin(-rig.lean);
  return { x: LAUNCH.x + lx * c - ly * s, y: LAUNCH.y + lx * s + ly * c };
}
const aimGoal = { lean: 0.12 };
function aimAt(tx, ty) {
  const m = muzzle();
  const ang = Math.atan2(ty - m.y, tx - m.x);   // 目标方向
  aimGoal.lean = Math.max(-0.05, Math.min(0.3, (Math.PI / 2 - ang) * 0.22));   // 越平射越往右倾
}

// ---------- 发射 ----------
const G = 18;
function solveLaunch(from, tx, ty, straight = false) {
  const dx = tx - from.x, dy = ty - from.y, dist = Math.hypot(dx, dy);
  if (straight) return { vx: (dx / dist) * 20, vy: (dy / dist) * 20, t: dist / 20 };
  const vel = (t) => ({ vx: dx / t, vy: (dy + 0.5 * G * t * t) / t, t });
  // 挡板瞄准求解（学 Angry 的 AimBlockerBoxSolver）：落点不变，会撞挡板就逐步抬高抛物线
  let t = Math.max(0.55, Math.min(1.3, dist / 13));
  for (let k = 0; k < 14 && pathBlocked(from, vel(t)); k++) t += 0.07;
  return vel(t);
}
function pathBlocked(from, v) {
  const blockers = S.items.filter((it) => !it.counted && !it.dead);
  if (!blockers.length) return false;
  for (let k = 1; k < 24; k++) {
    const tau = (k / 24) * v.t * 0.9;
    const px = from.x + v.vx * tau, py = from.y + v.vy * tau - 0.5 * G * tau * tau;
    for (const b of blockers) {
      const p = b.body.getPosition();
      if (Math.abs(px - p.x) < b.dw / 2 + 0.38 && Math.abs(py - p.y) < b.dh / 2 + 0.38) return true;
    }
  }
  return false;
}

function fire(tx, ty) {
  if (S.state !== 'play' || S.shots <= 0 || S.time - S.lastShotAt < 0.25) return;
  const kind = S.armed;
  aimAt(tx, ty);
  const m = muzzle();
  if (kind === 'rocket') {
    // 穿甲火箭：运动学刚体直线匀速飞，质量无限 → 一路推开（Angry：max_travel_distance 40）
    const v = solveLaunch(m, tx, ty, true);
    const body = world.createBody({ type: 'kinematic', position: Vec2(m.x, m.y), bullet: true });
    body.createFixture({ shape: new planck.Box(0.36, 0.14) });
    body.setAngle(Math.atan2(v.vy, v.vx));
    body.setLinearVelocity(Vec2(v.vx, v.vy));
    const b = { kind: 'ball', rocket: true, body, born: S.time, life: 1.4, r: 0.36 };
    body.setUserData(b);
    S.balls.push(b);
  } else {
    const v = solveLaunch(m, tx, ty);
    const big = kind === 'big', tri = kind === 'tri';
    const r = big ? 0.62 : tri ? 0.24 : 0.32;
    const mass = big ? 16 : tri ? 3 : 5;
    for (const deg of tri ? [-6, 0, 6] : [0]) {
      const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      const body = world.createBody({ type: 'dynamic', position: Vec2(m.x, m.y), bullet: true, allowSleep: false });
      body.createFixture({ shape: new planck.Circle(r), density: mass / (Math.PI * r * r), friction: 0.4, restitution: 0.15 });
      body.setLinearVelocity(Vec2(v.vx * c - v.vy * s, v.vx * s + v.vy * c));
      body.setAngularVelocity(-6);
      const b = { kind: 'ball', body, born: S.time, life: 4.5, r, big, img: big ? 'icon_melon' : 'icon_tomato', splatted: false };
      body.setUserData(b);
      S.balls.push(b);
    }
  }
  S.shots--;
  if (kind) { inv[kind]--; store.set('inv', inv); S.armed = null; }
  S.lastShotAt = S.time;
  rig.squashV += kind === 'big' ? 9 : 6;
  rig.leanV -= 2.2;
  rig.ammoPop = 0;
  emit(m.x, m.y + 0.2, ['#fff7e8', '#ffffff', '#e8261a'], 14, 3, 2, 0.4, 0.09);
  sfx.play(kind === 'rocket' ? 'fire_rocket' : kind === 'tri' ? 'fire_tri' : 'fire', { rate: kind === 'big' ? 0.75 : 1, vol: kind === 'big' ? 1 : 0.8 });
  S.shake = Math.max(S.shake, kind === 'big' ? 0.25 : 0.08);
  updateHud();
}

// ---------- 爆炸 ----------
function queueExplode(it) {
  if (it.exploding || it.dead) return;
  it.exploding = true;
  S.explodeQueue.push({ it, at: S.time + 0.06 });
}
const BOOM_COLORS = { kitchen: ['#e8261a', '#ff7a1a', '#f6c33b', '#9e1b12'], drinks: ['#5a1e14', '#fff1d6', '#ffffff', '#e8261a'], bakery: ['#ffffff', '#ff8fb1', '#fff1d6', '#e8261a'] };
function explode(it) {
  const p = it.body.getPosition();
  const px = p.x, py = p.y;
  killItem(it);
  const R = 3.2, F = 26;
  for (const o of S.items) {
    if (o.dead || o.body.getType() !== 'dynamic') continue;
    const q = o.body.getPosition(), dx = q.x - px, dy = q.y - py, d = Math.hypot(dx, dy);
    if (d > R) continue;
    if (o.def.explosive) { queueExplode(o); continue; }
    const k = F * (1 - d / R) * Math.pow(o.mass, 0.6);
    o.body.setAwake(true);
    o.body.applyLinearImpulse(Vec2((dx / (d || 1)) * k, (dy / (d || 1)) * k + k * 0.5), q, true);
    o.body.applyAngularImpulse((Math.random() - 0.5) * k * 0.3, true);
  }
  flashes.push({ x: px, y: py, t: 0 });
  emit(px, py, BOOM_COLORS[S.theme], 90, 9, 3, 1.1, 0.12);
  emit(px, py, BOOM_COLORS[S.theme], 18, 7, 4, 1.3, 0.3);
  S.shake = 0.7;
  S.hitstop = 0.09;
  sfx.play('boom', { vol: 1, gap: 0.08 });
}

function killItem(it) {
  if (it.dead) return;
  it.dead = true;
  S.kill.push(it.body);
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

// ---------- 粒子 / 汁渍 / 闪光（全部画在 canvas 上） ----------
const parts = [];
function emit(x, y, colors, n, speed, up = 2, life = 0.9, size = 0.1, grav = 14) {
  for (let k = 0; k < n; k++) {
    parts.push({ x, y, vx: (Math.random() - 0.5) * 2 * speed, vy: Math.random() * speed + up, life: life * (0.6 + 0.4 * Math.random()), max: life, c: colors[k % colors.length], s: size * (0.6 + Math.random() * 0.8), grav });
  }
}
const decals = [];   // 番茄砸在墙上的汁渍（画在物件后面），几秒后淡出
const flashes = [];
const dropCache = {};
function dropSprite(color) {
  if (dropCache[color]) return dropCache[color];
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  grd.addColorStop(0, color); grd.addColorStop(0.7, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(24, 24, 24, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.arc(17, 16, 6, 0, 7); g.fill();
  return (dropCache[color] = c);
}
const splatImg = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(205,25,12,.92)';
  g.beginPath(); g.arc(80, 80, 40, 0, 7); g.fill();
  for (let k = 0; k < 13; k++) {
    const a = (k / 13) * 6.28 + Math.random() * 0.3, d = 36 + Math.random() * 34, r = 6 + Math.random() * 12;
    g.beginPath(); g.arc(80 + Math.cos(a) * d, 80 + Math.sin(a) * d, r, 0, 7); g.fill();
    g.beginPath(); g.moveTo(80, 80); g.lineTo(80 + Math.cos(a) * d, 80 + Math.sin(a) * d); g.lineWidth = r * 0.9; g.strokeStyle = 'rgba(205,25,12,.92)'; g.stroke();
  }
  g.fillStyle = 'rgba(255,150,130,.55)'; g.beginPath(); g.arc(68, 66, 13, 0, 7); g.fill();
  return c;
})();

// ---------- 输入：按住瞄准、松手发射 ----------
let aiming = false, aimPt = null;
canvas.addEventListener('pointerdown', (ev) => {
  sfx.unlock();
  if (S.state !== 'play' || S.shots <= 0) return;
  canvas.setPointerCapture(ev.pointerId);
  aiming = true;
  aimPt = toWorld(ev.clientX, ev.clientY);
});
canvas.addEventListener('pointermove', (ev) => { if (aiming) aimPt = toWorld(ev.clientX, ev.clientY); });
canvas.addEventListener('pointerup', () => { if (aiming && aimPt) fire(aimPt.x, aimPt.y); aiming = false; });
canvas.addEventListener('pointercancel', () => (aiming = false));
for (const [k, b] of Object.entries(BOOSTERS)) {
  $(b.btn).addEventListener('click', () => {
    sfx.unlock();
    if (S.levelIdx + 1 < b.unlock) { toast(`第 ${b.unlock} 关解锁`); return; }
    if (inv[k] <= 0) { toast('道具用完了'); return; }
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
$('startBtn').onclick = () => { sfx.unlock(); sfx.play('click'); $('start').classList.add('hidden'); loadLevel(S.levelIdx); };
addEventListener('keydown', (e) => { if (e.key === 'r' || e.key === 'R') loadLevel(S.levelIdx, true); });
addEventListener('resize', layout);

// ---------- 模拟 ----------
function settled() {
  return S.items.every((it) => it.dead || it.cleared || it.body.getType() !== 'dynamic' || !it.body.isAwake() || it.body.getLinearVelocity().lengthSquared() < 0.03);
}
function step(dt) {
  S.time += dt;
  // 移动挡板：上下往返
  for (const it of S.items) {
    if (it.arch !== 'slider' || it.dead) continue;
    const { amp = 1.4, cycle = 2.6 } = it.custom, w = (2 * Math.PI) / cycle;
    it.body.setLinearVelocity(Vec2(0, amp * w * Math.cos(w * S.time)));
  }
  world.step(dt, 8, 3);
  for (const b of S.kill) world.destroyBody(b);
  S.kill.length = 0;

  for (let k = S.explodeQueue.length - 1; k >= 0; k--) {
    if (S.time >= S.explodeQueue[k].at) { const q = S.explodeQueue.splice(k, 1)[0]; explode(q.it); }
  }
  for (const it of S.items) {
    if (it.dead || !it.counted) continue;
    const p = it.body.getPosition();
    if (!it.cleared && p.y < -1.0) {
      onCleared(it);
      emit(p.x, p.y, ['#fff1d6', '#f6c33b', '#ffffff'], 10, 2, 2.5, 0.6, 0.08);
    }
    if (it.cleared && (S.time - it.clearedAt > 1.2 || p.y < -9)) { it.dead = true; S.kill.push(it.body); }
  }
  for (let k = S.balls.length - 1; k >= 0; k--) {
    const b = S.balls[k], p = b.body.getPosition();
    if (b.rocket) emit(p.x, p.y, ['#ff7a1a', '#f6c33b', '#fff1d6'], 3, 0.8, 0, 0.35, 0.09, 0);
    if (b.splatNow) {
      b.splatNow = false;
      decals.push({ x: p.x, y: p.y, s: b.big ? 1.8 : 1.0, rot: Math.random() * 6.28, born: S.time });
      emit(p.x, p.y, b.big ? ['#ff4d6d', '#2e8b3a', '#ffd0d0'] : ['#d8200f', '#ff5a3c', '#f6c33b'], b.big ? 16 : 9, 4, 3, 1.0, 0.24);
      emit(p.x, p.y, ['#e8261a', '#ff7a5a', '#ffffff'], b.big ? 60 : 36, 5.5, 3.5, 0.8, 0.09);
      sfx.play('splat', { vol: b.big ? 1 : 0.7, rate: b.big ? 0.7 : 1 });
      S.shake = Math.max(S.shake, b.big ? 0.35 : 0.12);
      if (b.big) S.hitstop = Math.max(S.hitstop, 0.06);
    }
    if (S.time - b.born > b.life || p.y < -8) { S.kill.push(b.body); S.balls.splice(k, 1); }
  }
  for (let k = parts.length - 1; k >= 0; k--) {
    const q = parts[k];
    q.life -= dt;
    if (q.life <= 0) { parts.splice(k, 1); continue; }
    q.vy -= q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt;
  }
  for (let k = decals.length - 1; k >= 0; k--) if (S.time - decals[k].born > 4) decals.splice(k, 1);
  for (let k = flashes.length - 1; k >= 0; k--) { flashes[k].t += dt / 0.35; if (flashes[k].t >= 1) flashes.splice(k, 1); }

  if (S.state === 'play') {
    if (S.remaining <= 0) win();
    else if (S.shots <= 0 && !S.explodeQueue.length) {
      const since = S.time - S.lastShotAt;
      if ((since > 2.2 && settled()) || since > 8) lose();
    }
  }

  // 发射器动作：弹簧追目标倾角；待机时极轻的呼吸感（不夸张）
  if (!aiming && S.time - S.lastShotAt > 0.6) aimGoal.lean = 0.12;
  const springStep = (x, v, target, k, c) => { v += (k * (target - x) - c * v) * dt; return [x + v * dt, v]; };
  [rig.lean, rig.leanV] = springStep(rig.lean, rig.leanV, aimGoal.lean, 80, 10);
  [rig.squash, rig.squashV] = springStep(rig.squash, rig.squashV, 0, 240, 12);
  rig.ammoPop = Math.min(1, rig.ammoPop + dt * 4);
  S.shake = Math.max(0, S.shake - dt * 1.8);
}

// ---------- 绘制 ----------
function drawImageCover(im) {
  const a = im.width / im.height, b = VW / VH;
  let w, h;
  if (b > a) { w = VW; h = VW / a; } else { h = VH; w = VH * a; }
  ctx.drawImage(im, (VW - w) / 2, (VH - h) / 2, w, h);
}
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const bg = IMG[`bg_${S.theme}_${VH > VW ? 'v' : 'h'}`];
  if (bg) drawImageCover(bg); else { ctx.fillStyle = '#7fd6c8'; ctx.fillRect(0, 0, VW, VH); }
  if (S.state === 'start' || !S.level) return;

  ctx.save();
  if (S.shake > 0) ctx.translate((Math.random() - 0.5) * S.shake * 14, (Math.random() - 0.5) * S.shake * 14);
  const s = view.s;

  // 汁渍：贴在背景墙上（物件后面）
  for (const d of decals) {
    const age = S.time - d.born, a = age < 3 ? 1 : 1 - (age - 3);
    ctx.globalAlpha = Math.max(0, a) * 0.9;
    ctx.save(); ctx.translate(sx(d.x), sy(d.y)); ctx.rotate(d.rot);
    const z = d.s * s * (age < 0.08 ? age / 0.08 : 1);
    ctx.drawImage(splatImg, -z / 2, -z / 2, z, z);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // 桌子：精灵顶边对齐桌面 y=0，宽度略大于物理桌面
  const tw = S.level.Table.w, tImg = IMG[`table_${S.theme}`];
  if (tImg) {
    const w = (tw + 0.5) * s, h = Math.min(w / (tImg.width / tImg.height), 3.6 * s);
    ctx.drawImage(tImg, sx(-tw / 2 - 0.25), sy(0) - h * 0.06, w, h);
  } else {
    ctx.fillStyle = '#d9342a'; ctx.fillRect(sx(-tw / 2), sy(0), tw * s, 0.6 * s);
  }

  // 物件接触阴影（在桌面上）
  for (const it of S.items) {
    if (it.dead) continue;
    const p = it.body.getPosition(), bottom = p.y - it.dh / 2;
    if (bottom < -0.3 || bottom > 0.25 || Math.abs(p.x) > tw / 2) continue;
    ctx.fillStyle = 'rgba(60,20,10,.28)';
    ctx.beginPath(); ctx.ellipse(sx(p.x), sy(0) + 2, it.dw * s * 0.55, Math.max(3, s * 0.07), 0, 0, 7); ctx.fill();
  }

  // 物件
  for (const it of S.items) {
    if (it.dead) continue;
    const p = it.body.getPosition(), a = it.body.getAngle();
    let sc = 1;
    if (it.cleared) sc = Math.max(0, 1 - Math.max(0, S.time - it.clearedAt - 0.7) / 0.5);
    ctx.save();
    ctx.translate(sx(p.x), sy(p.y));
    ctx.rotate(-a);
    ctx.scale(sc, sc);
    const im = it.key && IMG[it.key];
    if (im) ctx.drawImage(im, (-it.dw / 2) * s, (-it.dh / 2) * s, it.dw * s, it.dh * s);
    else { ctx.fillStyle = it.counted ? '#c98a4b' : '#9aa3ad'; ctx.fillRect((-it.dw / 2) * s, (-it.dh / 2) * s, it.dw * s, it.dh * s); }
    ctx.restore();
  }

  // 发射器
  drawLauncher();

  // 弹丸
  for (const b of S.balls) {
    const p = b.body.getPosition();
    ctx.save(); ctx.translate(sx(p.x), sy(p.y)); ctx.rotate(-b.body.getAngle());
    if (b.rocket) {
      const im = IMG.icon_rocket;
      ctx.rotate(Math.PI / 4);   // 图标本身是 45° 朝右上，转正到朝右
      if (im) ctx.drawImage(im, -0.55 * s, -0.55 * s, 1.1 * s, 1.1 * s);
    } else {
      const im = IMG[b.img], z = b.r * 2.3 * s;
      if (im) ctx.drawImage(im, -z / 2, -z / 2, z, z);
      else { ctx.fillStyle = '#e8261a'; ctx.beginPath(); ctx.arc(0, 0, b.r * s, 0, 7); ctx.fill(); }
    }
    ctx.restore();
  }

  // 粒子
  for (const q of parts) {
    const z = q.s * s * 2 * Math.min(1, q.life / q.max + 0.3);
    ctx.globalAlpha = Math.min(1, q.life / q.max * 2);
    ctx.drawImage(dropSprite(q.c), sx(q.x) - z / 2, sy(q.y) - z / 2, z, z);
  }
  ctx.globalAlpha = 1;

  // 爆炸闪光
  for (const f of flashes) {
    const r = (0.4 + f.t * 2.6) * s;
    const grd = ctx.createRadialGradient(sx(f.x), sy(f.y), 0, sx(f.x), sy(f.y), r);
    grd.addColorStop(0, `rgba(255,240,180,${0.9 * (1 - f.t)})`);
    grd.addColorStop(0.5, `rgba(255,150,40,${0.6 * (1 - f.t)})`);
    grd.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), r, 0, 7); ctx.fill();
  }

  // 瞄准：抛物线虚点 + 落点圈
  if (aiming && aimPt) {
    aimAt(aimPt.x, aimPt.y);
    const m = muzzle(), straight = S.armed === 'rocket';
    const v = solveLaunch(m, aimPt.x, aimPt.y, straight);
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    for (let k = 1; k < 26; k++) {
      const tau = (k / 26) * v.t;
      const px = m.x + v.vx * tau, py = m.y + v.vy * tau - (straight ? 0 : 0.5 * G * tau * tau);
      ctx.globalAlpha = 0.35 + 0.65 * (k / 26);
      ctx.beginPath(); ctx.arc(sx(px), sy(py), Math.max(2.5, s * 0.055), 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(sx(aimPt.x), sy(aimPt.y), s * 0.32, 0, 7); ctx.stroke();
  }
  ctx.restore();

  // 暗角：四角压暗，画面更聚焦、更"贵"
  const vg = ctx.createRadialGradient(VW / 2, VH * 0.48, Math.min(VW, VH) * 0.35, VW / 2, VH * 0.48, Math.max(VW, VH) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(40,10,0,${S.diff === 2 ? 0.55 : S.diff === 1 ? 0.45 : 0.32})`);
  ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);
}

function drawLauncher() {
  const im = IMG.launcher, s = view.s, { w, h } = launcherBox();
  const sq = Math.max(-0.5, Math.min(0.7, rig.squash));
  ctx.save();
  ctx.translate(sx(LAUNCH.x), sy(LAUNCH.y));
  // 地面阴影
  ctx.fillStyle = 'rgba(40,15,5,.35)';
  ctx.beginPath(); ctx.ellipse(0, 4, w * s * 0.5, s * 0.16, 0, 0, 7); ctx.fill();
  ctx.rotate(rig.lean);
  ctx.scale(1 + sq * 0.12, 1 - sq * 0.18);
  if (im) ctx.drawImage(im, (-w / 2) * s, -h * s, w * s, h * s);
  else { ctx.fillStyle = '#d8200f'; ctx.fillRect((-w / 2) * s, -h * s, w * s, h * s); }
  // 碗里预装的下一发
  if (S.shots > 0 && S.time - S.lastShotAt > 0.2) {
    const key = S.armed === 'big' ? 'icon_melon' : S.armed === 'tri' ? 'icon_triple' : S.armed === 'rocket' ? 'icon_rocket' : 'icon_tomato';
    const ai = IMG[key];
    const pop = rig.ammoPop < 1 ? Math.sin(rig.ammoPop * Math.PI) * 0.25 + rig.ammoPop : 1;
    const z = (S.armed === 'big' ? 1.1 : 0.75) * s * pop;
    if (ai) ctx.drawImage(ai, (MUZZLE.fx - 0.5) * w * s - z / 2, -(1 - MUZZLE.fy) * h * s - z * 0.75, z, z);
  }
  ctx.restore();
}

// ---------- 主循环（固定步长 1/60） ----------
let last = performance.now(), acc = 0;
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.hitstop > 0) { S.hitstop -= dt; dt *= 0.12; }   // 打击停顿
  if (S.level && S.state !== 'start') {
    acc += dt;
    while (acc >= 1 / 60) { step(1 / 60); acc -= 1 / 60; }
  }
  render();
  requestAnimationFrame(frame);
}

if (params.has('debug')) document.body.classList.add('debug');
if (params.has('silent')) { sfx.toggleMute(); $('mute').textContent = '🔇'; }
sfx.loadSamples();
layout();
await loadAssets();
if (params.has('play')) { $('start').classList.add('hidden'); loadLevel(S.levelIdx); }
requestAnimationFrame(frame);

// ---------- 测试接口：自动化试玩 / 机器人校准 ----------
window.__game = {
  S, inv, loadLevel,
  start: () => { $('start').classList.add('hidden'); loadLevel(S.levelIdx); },
  arm: (k) => { S.armed = k; },
  fireAt: (x, y) => fire(x, y),
  setTheme: (t) => { S.themeOverride = t; loadLevel(S.levelIdx, true); },
  tick(sec) { for (let k = 0; k < Math.round(sec * 60); k++) step(1 / 60); render(); },
  // 机器人：打最高的物件；同一目标连续两发没进展就登记为死角换目标（学 Angry 的 AutoplayDeadAimRegistry）
  autoplay(list, ammo = null) {
    $('start').classList.add('hidden');
    const out = {};
    for (const n of list) {
      loadLevel(n - 1);
      S.shots = ammo ?? 40;
      const budget = ammo ?? 25;
      let used = 0;
      const dead = new Map();
      while (S.remaining > 0 && used < budget && S.shots > 0) {
        const live = S.items.filter((i) => !i.dead && !i.cleared && i.counted);
        if (!live.length) break;
        let cand = live.filter((i) => (dead.get(i) || 0) < 2);
        if (!cand.length) { dead.clear(); cand = live; }
        cand.sort((a, b) => b.body.getPosition().y - a.body.getPosition().y);
        const it = cand[0], before = S.remaining, p0 = it.body.getPosition().clone();
        S.lastShotAt = -99;
        fire(p0.x, p0.y);
        used++;
        this.tick(2.0);
        const moved = it.cleared || planck.Vec2.distance(p0, it.body.getPosition()) > 0.3;
        if (S.remaining === before && !moved) dead.set(it, (dead.get(it) || 0) + 1);
      }
      this.tick(2.5);
      out[n] = { need: S.remaining <= 0 ? used : 99, total: S.total, left: S.remaining, diff: S.diff };
    }
    return out;
  },
};
