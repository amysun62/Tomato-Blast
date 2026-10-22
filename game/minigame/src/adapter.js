// 小游戏运行时适配层（抖音 tt / TikTok TTMinis.game 同一套接口）：
// 小游戏里没有 window / document / DOM，这里补上 three.js 和 game3d.js 用到的那一小部分，
// 让网页版代码一行不改就能跑。界面元素是"假 DOM"（只记状态），由 hud.js 按网页版布局画到画布上。
/* global tt, TTMinis, GameGlobal */
const T = typeof tt !== 'undefined' ? tt : typeof TTMinis !== 'undefined' ? TTMinis.game : null;
// 全局对象：真机上是 GameGlobal；浏览器预览器里游戏代码读的是页面的 window（预览器另有一个 GameGlobal，不能往那上面补）
const G = typeof window !== 'undefined' && window.document ? window : typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
const sys = T.getSystemInfoSync();
const W = sys.windowWidth || sys.screenWidth, H = sys.windowHeight || sys.screenHeight;
const DPR = Math.min(sys.pixelRatio || 2, 2);   // 超过 2 倍的屏按 2 倍画：省一半像素，肉眼看不出

// ---------- 资源路径：网页版的 png → 包里的无损 webp；精灵、背景、地板、音乐在分包 art/ ----------
export function resolvePath(url) {
  if (typeof url !== 'string') return url;
  url = url.replace(/^\.\//, '').replace(/\?.*$/, '');
  if (url.startsWith('assets/sprites/') || url.startsWith('assets/music/') || /^assets\/(bg|floor)_/.test(url)) url = 'art/' + url.slice('assets/'.length);
  return url.replace(/\.png$/i, '.webp');   // 精灵和 UI 是无损 WebP；背景和地板保留原 JPG
}

const PREVIEW = typeof G.document !== 'undefined' && !!G.document && typeof G.document.getElementById === 'function';

// ---------- 上屏画布 + WebGL 上下文 ----------
const screen = T.createCanvas();   // 第一个 createCanvas 就是上屏画布
screen.width = Math.round(W * DPR); screen.height = Math.round(H * DPR);
screen.style = screen.style || {};
const canvasListeners = {};
screen.addEventListener = (type, fn) => { (canvasListeners[type] = canvasListeners[type] || []).push(fn); };
screen.removeEventListener = (type, fn) => { const a = canvasListeners[type]; if (a) a.splice(a.indexOf(fn), 1); };
const glOpts = { antialias: true, alpha: false, stencil: false, preserveDrawingBuffer: false };
G.__glContext = screen.getContext('webgl2', glOpts) || screen.getContext('webgl', glOpts);

// ---------- 假 DOM ----------
function classList(onChange) {
  const set = new Set();
  return {
    add: (...c) => { c.forEach((x) => set.add(x)); onChange(); },
    remove: (...c) => { c.forEach((x) => set.delete(x)); onChange(); },
    toggle: (c, force) => { const on = force === undefined ? !set.has(c) : !!force; if (on) set.add(c); else set.delete(c); onChange(); return on; },
    contains: (c) => set.has(c),
  };
}
export const ui = { dirty: true, els: {}, cssVars: { '--hud-h': '122px', '--bar-h': '122px', '--bar-lift': '0px' } };
const touch = () => { ui.dirty = true; };
function makeEl(id) {
  const listeners = {};
  let text = '', src = '';
  const el = {
    id, style: { setProperty: (k, v) => { ui.cssVars[k] = v; touch(); } }, dataset: {}, offsetWidth: 0, children: {},
    classList: classList(touch),
    get textContent() { return text; }, set textContent(v) { text = String(v); touch(); },
    get src() { return src; }, set src(v) { src = v; touch(); },
    onclick: null,
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: () => {},
    dispatch(type) { if (type === 'click' && el.onclick) el.onclick({}); for (const f of listeners[type] || []) f({}); },
    querySelector(sel) { return (el.children[sel] = el.children[sel] || makeEl(id + ' ' + sel)); },
  };
  return el;
}
// index.html 里的元素：初始状态照网页版
const START_HIDDEN = ['panel', 'settings', 'pAlt'];
for (const id of ['c', 'hud', 'lvlNum', 'shots', 'left', 'gear', 'tag', 'tagImg', 'tagText', 'toast', 'combo', 'comboNum', 'comboImg', 'bar', 'bTri', 'bRocket', 'bBig', 'nav', 'prev', 'next', 'theme', 'mute', 'panel', 'pTitle', 'pTitleImg', 'pText', 'pMain', 'pMainText', 'pAlt', 'pAltText', 'settings', 'sSound', 'sSoundText', 'sRestart', 'sClose', 'start', 'startBtn']) {
  ui.els[id] = makeEl(id);
  if (START_HIDDEN.includes(id)) ui.els[id].classList.add('hidden');
}
ui.els.sSoundText.textContent = 'SOUND: ON';
ui.els.bTri.dataset.k = 'tri'; ui.els.bRocket.dataset.k = 'rocket'; ui.els.bBig.dataset.k = 'big';
const body = { classList: classList(touch), style: {} };
body.classList.add('on-start');
const documentElement = { style: { setProperty: (k, v) => { ui.cssVars[k] = v; touch(); }, getPropertyValue: (k) => ui.cssVars[k] || '' } };

function wrapImage(im) {
  im.addEventListener = (type, fn) => { if (type === 'load') im.onload = () => fn({ target: im }); if (type === 'error') im.onerror = (e) => fn(e); };
  im.removeEventListener = () => {};
  // 路径重写：three 的 ImageLoader 直接设 src
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(im), 'src');
  // 预览器（浏览器）里相对路径会按预览页解析，要补成包根绝对路径；真机直接按包根解析
  const fix = (v) => { const r = resolvePath(v); return PREVIEW && typeof r === 'string' && !/^(https?:|data:|blob:|\/)/.test(r) ? '/' + r : r; };
  if (desc && desc.set) Object.defineProperty(im, 'src', { get: () => desc.get.call(im), set: (v) => desc.set.call(im, fix(v)), configurable: true });
  return im;
}
function newCanvas() {
  const c = T.createCanvas();
  c.style = {}; c.addEventListener = () => {}; c.removeEventListener = () => {};
  return c;
}
// 真机上没有 window/document，这里新建；浏览器预览器（tt-shim）里它们已经存在，只能打补丁，不能整个替换
const HAS_DOM = PREVIEW;
if (HAS_DOM) {
  const doc = G.document, origGet = doc.getElementById.bind(doc), origCreate = doc.createElement.bind(doc);
  doc.getElementById = (id) => (id === 'c' ? screen : ui.els[id] || origGet(id));
  doc.createElement = (name) => (name === 'img' ? wrapImage(origCreate('img')) : origCreate(name));
  doc.createElementNS = (ns, name) => doc.createElement(name);
  doc.body.classList.add('on-start');
  const st = doc.documentElement.style, origSet = st.setProperty.bind(st);
  st.setProperty = (k, v) => { ui.cssVars[k] = v; touch(); origSet(k, v); };
  for (const [k, v] of Object.entries(ui.cssVars)) origSet(k, v);
  // 预览器里 window 尺寸是整个页面，不是模拟的手机屏
  for (const [k, v] of [['innerWidth', W], ['innerHeight', H], ['devicePixelRatio', DPR]]) try { Object.defineProperty(G, k, { get: () => v, configurable: true }); } catch { /* 只读就算了 */ }
  const origFetch = G.fetch.bind(G);
  G.fetch = (url, opt) => origFetch(typeof url === 'string' && !/^(https?:|\/)/.test(url) ? '/' + resolvePath(url) : url, opt);
} else {
  G.document = {
    body, documentElement, readyState: 'complete',
    getElementById: (id) => (id === 'c' ? screen : ui.els[id] || null),
    createElement: (name) => (name === 'canvas' ? newCanvas() : name === 'img' ? wrapImage(T.createImage()) : makeEl(name)),
    createElementNS: (ns, name) => G.document.createElement(name),
    addEventListener: () => {}, removeEventListener: () => {},
    fonts: { load: () => Promise.resolve() },
  };
  G.getComputedStyle = () => ({ getPropertyValue: (k) => ui.cssVars[k] || '' });
  G.window = G;
  G.self = G;
  G.innerWidth = W; G.innerHeight = H; G.devicePixelRatio = DPR;
  G.addEventListener = () => {}; G.removeEventListener = () => {};
  G.location = { search: '', href: 'minigame://tomato-blast/', origin: '' };
  G.navigator = G.navigator || { userAgent: 'minigame' };
  if (!G.performance) G.performance = { now: () => Date.now() };
  if (!G.requestAnimationFrame) G.requestAnimationFrame = (f) => setTimeout(() => f(Date.now()), 16);
  if (!G.URLSearchParams) {
    G.URLSearchParams = class { constructor() { this.m = new Map(); } has(k) { return this.m.has(k); } get(k) { return this.m.has(k) ? this.m.get(k) : null; } };
  }
  G.Image = function Image() { return wrapImage(T.createImage()); };
  G.HTMLCanvasElement = G.HTMLCanvasElement || function HTMLCanvasElement() {};
  G.HTMLImageElement = G.HTMLImageElement || function HTMLImageElement() {};
  G.localStorage = {
    getItem: (k) => { try { const v = T.getStorageSync(k); return v === '' || v == null ? null : v; } catch { return null; } },
    setItem: (k, v) => { try { T.setStorageSync(k, String(v)); } catch { /* 存储满等 */ } },
    removeItem: (k) => { try { T.removeStorageSync(k); } catch { /* 无 */ } },
  };
  // fetch：只用来读包里的本地文件（素材清单 json）
  G.fetch = (url) => new Promise((resolve) => {
    const path = resolvePath(url);
    try {
      T.getFileSystemManager().readFile({
        filePath: path, encoding: 'utf8',
        success: (r) => resolve({ ok: true, json: async () => JSON.parse(r.data), text: async () => r.data }),
        fail: () => resolve({ ok: false, json: async () => ({}), text: async () => '' }),
      });
    } catch { resolve({ ok: false, json: async () => ({}), text: async () => '' }); }
  });
}
if (!G.navigator.vibrate) G.navigator.vibrate = (ms) => { try { (ms >= 25 ? T.vibrateLong : T.vibrateShort)({ type: 'medium' }); } catch { /* 不支持震动 */ } return true; };

// ---------- 触摸 → 画布指针事件（先给界面按钮，按钮没接住才给瞄准） ----------
export const input = { hudHit: null };
function dispatch(type, t) {
  const ev = { clientX: t.clientX ?? t.x, clientY: t.clientY ?? t.y, pointerId: t.identifier ?? 0, preventDefault() {} };
  for (const f of canvasListeners[type] || []) f(ev);
}
let captured = false;   // 这次按下被界面按钮接住了：后续 move/up 也不传给瞄准
T.onTouchStart((e) => { const t = e.changedTouches[0]; captured = !!(input.hudHit && input.hudHit('down', t.clientX ?? t.x, t.clientY ?? t.y)); if (!captured) dispatch('pointerdown', t); });
T.onTouchMove((e) => { const t = e.changedTouches[0]; if (captured) input.hudHit('move', t.clientX ?? t.x, t.clientY ?? t.y); else dispatch('pointermove', t); });
T.onTouchEnd((e) => { const t = e.changedTouches[0]; if (captured) input.hudHit('up', t.clientX ?? t.x, t.clientY ?? t.y); else dispatch('pointerup', t); captured = false; });
T.onTouchCancel(() => { if (!captured) dispatch('pointercancel', {}); captured = false; });

export const platform = { T, W, H, DPR, screen };
