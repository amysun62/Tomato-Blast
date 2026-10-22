// 小游戏版界面：照 index.html 的布局（同一套糖果 UI 图、同样的百分比空位），把假 DOM 的状态画到一张 2D 画布上，
// 再作为贴图叠在 3D 画面最上层。只有状态变了或有动画时才重画、重传贴图。
import * as THREE from 'three';
import { ui, input, platform, resolvePath } from './adapter.js';

const { T, W, H, DPR } = platform;
const E = ui.els;
const INK = '#5a2a12', LABEL = '#b2683a', STROKE = '#8e150c';
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const vw = (p) => (W * p) / 100;

// ---------- 字体 / 图片 ----------
let FONT = 'sans-serif';
try { FONT = T.loadFont((typeof T.resolveShimPath === 'function' ? '/' : '') + 'assets/fonts/LilitaOne-Regular.ttf') || FONT; } catch { /* 用系统字体 */ }
const imgs = {};
function img(path) {
  if (!path) return null;
  const p = resolvePath(path);
  let im = imgs[p];
  if (!im) { im = imgs[p] = T.createImage(); im.ok = false; im.onload = () => { im.ok = true; ui.dirty = true; }; im.src = p; }
  return im.ok ? im : null;
}
const UI = (n) => img(`assets/ui/${n}.png`);

// ---------- 画布 & 贴图 ----------
const cv = T.createCanvas();
cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
const ctx = cv.getContext('2d');
const tex = new THREE.CanvasTexture(cv);
tex.colorSpace = THREE.SRGBColorSpace;
tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })));

// ---------- 画字 ----------
function text(str, x, y, size, { color = '#fff', stroke = false, align = 'center', base = 'middle', spacing = 0 } = {}) {
  ctx.font = `${size}px "${FONT}"`;
  ctx.textAlign = align; ctx.textBaseline = base;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  if (stroke) {   // 网页版 .stroke：白字 + 深红描边 + 投影
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowOffsetY = 3; ctx.shadowBlur = 5;
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size * 0.2); ctx.strokeStyle = STROKE;
    ctx.strokeText(str, x, y);
    ctx.restore();
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}
function textW(str, size) { ctx.font = `${size}px "${FONT}"`; return ctx.measureText(str).width; }
function draw(im, x, y, w, h) { if (im) ctx.drawImage(im, x, y, w, h); }

// ---------- 点击区域 ----------
let hits = [], pressed = null, blocking = false;
const region = (el, x, y, w, h) => hits.push({ el, x, y, w, h });
input.hudHit = (type, x, y) => {
  const hit = [...hits].reverse().find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  if (type === 'down') { pressed = hit ? hit.el : null; ui.dirty = true; return !!hit || blocking; }
  if (type === 'up') { const el = pressed; pressed = null; ui.dirty = true; if (el && hit && hit.el === el) el.dispatch('click'); }
  return true;
};
const hidden = (id) => E[id].classList.contains('hidden');

// ---------- 动画计时（网页版的 CSS 过渡/关键帧） ----------
const anim = { toastOn: false, toastT: 0, comboOn: false, comboT: 0 };
const now = () => performance.now() / 1000;
const backOut = (t) => { t = clamp(0, t, 1) - 1; return 1 + 2.70158 * t * t * t + 1.70158 * t * t; };

// ---------- 各块 ----------
const safeTop = (sys) => (sys.safeArea ? sys.safeArea.top : sys.statusBarHeight || 20);
const SYS = T.getSystemInfoSync();
let MENU = null;
try { MENU = T.getMenuButtonLayout(); } catch { /* TikTok 可能没有胶囊 */ }
const SAFE_BOTTOM = SYS.safeArea ? Math.max(0, H - SYS.safeArea.bottom) : 0;
let bannerBottom = 120;

function drawHud() {
  const bw = Math.min(W * 0.94, 420), bh = (bw * 219) / 900, bx = (W - bw) / 2;
  // 顶部避开状态栏和右上角胶囊按钮
  const by = Math.max(safeTop(SYS) + 28, MENU ? MENU.bottom + 8 : 0);
  bannerBottom = by + bh;
  ctx.save();
  ctx.shadowColor = 'rgba(70,30,10,.28)'; ctx.shadowOffsetY = 5; ctx.shadowBlur = 10;
  draw(UI('c_hud'), bx, by, bw, bh);
  ctx.restore();
  const cell = (l, t, w, h) => [bx + (bw * l) / 100, by + (bh * t) / 100, (bw * w) / 100, (bh * h) / 100];
  // 关卡号 + 飘带
  let [x, y, w, h] = cell(3.5, 26, 19.5, 62);
  text(E.lvlNum.textContent, x + w / 2, y + h / 2, clamp(17, vw(6), 26), { color: INK });
  const rw = bw * 0.235, rh = (rw * 288) / 900, rx = bx + bw * 0.015, ry = by - bh * 0.24;
  draw(UI('c_ribbon'), rx, ry, rw, rh);
  text('LEVEL', rx + rw / 2, ry + rh * 0.46, clamp(8, vw(2.5), 11), { stroke: true, spacing: 0.5 });
  // 番茄弹药
  [x, y, w, h] = cell(25.7, 14, 32.8, 72);
  const small = clamp(7, vw(2.2), 10);
  text('TOMATOES', x + w / 2, y + h * 0.22, small, { color: LABEL, spacing: 0.8 });
  const ih = clamp(18, vw(6), 26), n1 = clamp(18, vw(6.2), 27), xs = clamp(11, vw(3.4), 14);
  const shots = E.shots.textContent, rowW = ih + 3 + textW('×', xs) + 3 + textW(shots, n1);
  let cx = x + w / 2 - rowW / 2, cy = y + h * 0.62;
  draw(UI('icon_tomato'), cx, cy - ih / 2, ih, ih); cx += ih + 3;
  text('×', cx, cy, xs, { color: LABEL, align: 'left' }); cx += textW('×', xs) + 3;
  text(shots, cx, cy, n1, { color: INK, align: 'left' });
  // 目标
  [x, y, w, h] = cell(60.3, 14, 25.4, 72);
  text('GOAL', x + w / 2, y + h * 0.22, small, { color: LABEL, spacing: 0.8 });
  const gh = clamp(16, vw(5.4), 23), n2 = clamp(16, vw(5.6), 24), lf = clamp(7, vw(2), 9);
  const left = E.left.textContent, rowW2 = gh + 3 + textW(left, n2) + 3 + textW('LEFT', lf);
  cx = x + w / 2 - rowW2 / 2; cy = y + h * 0.62;
  draw(UI('icon_goal'), cx, cy - gh / 2, gh, gh); cx += gh + 3;
  text(left, cx, cy, n2, { color: INK, align: 'left' }); cx += textW(left, n2) + 3;
  text('LEFT', cx, cy + n2 * 0.25, lf, { color: LABEL, align: 'left', spacing: 0.5 });
  // 齿轮
  const gw = bw * 0.11, gH = (gw * 512) / 487, gx = bx + bw * 0.873, gy = by + bh * 0.22;
  const s = pressed === E.gear ? 0.9 : 1;
  draw(UI('c_gear'), gx + (gw * (1 - s)) / 2, gy + (gH * (1 - s)) / 2, gw * s, gH * s);
  region(E.gear, gx - 6, gy - 6, gw + 12, gH + 12);
  // 难度标签
  if (E.tag.classList.contains('on')) {
    const tw = Math.min(W * 0.3, 124), th = (tw * 98) / 512, tx = (W - tw) / 2, ty = bannerBottom + 4;
    draw(img(E.tagImg.src), tx, ty, tw, th);
    text(E.tagText.textContent, W / 2, ty + th / 2, clamp(10, vw(3), 13), { stroke: true, spacing: 1 });
    bannerBottom = ty + th;
  }
}

function drawToast() {
  const on = E.toast.classList.contains('show');
  if (on !== anim.toastOn) { anim.toastOn = on; anim.toastT = now(); }
  const t = (now() - anim.toastT) / 0.35;
  const k = on ? backOut(t) : 1 - clamp(0, t, 1);
  if (k <= 0.01 && !on) return false;
  ctx.save();
  ctx.globalAlpha = clamp(0, on ? t * 1.5 : k, 1);
  ctx.translate(W / 2, bannerBottom + 44 + 13);
  const sc = on ? 0.6 + 0.4 * k : 0.6 + 0.4 * k;
  ctx.scale(sc, sc);
  const size = Math.min(26, (W * 0.9) / Math.max(1, textW(E.toast.textContent, 26) / 26));   // 太长就缩字号，不出屏
  text(E.toast.textContent, 0, 0, size, { stroke: true });
  ctx.restore();
  return t < 1;
}

function drawCombo() {
  const on = E.combo.classList.contains('show');
  if (on && !anim.comboOn) anim.comboT = now();
  anim.comboOn = on;
  if (!on) return false;
  const p = clamp(0, (now() - anim.comboT) / 0.95, 1);
  // 网页版 comboPop 关键帧：0 → 18% 放大 1.12 → 30% 回到 1 → 80% 上移 → 100% 淡出
  let sc, rot, dy, a;
  if (p < 0.18) { const q = p / 0.18; sc = 0.4 + 0.72 * q; rot = -6 + 9 * q; dy = 0; a = q; }
  else if (p < 0.3) { const q = (p - 0.18) / 0.12; sc = 1.12 - 0.12 * q; rot = 3 - 4 * q; dy = 0; a = 1; }
  else if (p < 0.8) { const q = (p - 0.3) / 0.5; sc = 1; rot = -1 + q; dy = -0.08 * q; a = 1; }
  else { const q = (p - 0.8) / 0.2; sc = 1 - 0.08 * q; rot = 0; dy = -0.08 - 0.12 * q; a = 1 - q; }
  const cw = Math.min(W * 0.7, 300), word = img(E.comboImg.src);
  const wh = word ? (cw * word.height) / word.width : 0, total = 54 + 2 + wh;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(W / 2, H * 0.36 + dy * total);
  ctx.rotate((rot * Math.PI) / 180); ctx.scale(sc, sc);
  text(E.comboNum.textContent, 0, -total / 2 + 27, 54, { stroke: true });
  if (word && E.comboImg.style.display !== 'none') draw(word, -cw / 2, -total / 2 + 56, cw, wh);
  ctx.restore();
  return p < 1;
}

function drawBar() {
  const lift = parseFloat(ui.cssVars['--bar-lift']) || 0;
  const bottom = H - lift - 12 - SAFE_BOTTOM;
  const bw = 58, bh = (bw * 512) / 488;
  const pos = { bTri: 14, bRocket: 14 + bw + 8, bBig: W - 14 - bw };
  let animating = false;
  for (const id of ['bTri', 'bRocket', 'bBig']) {
    const el = E[id], cl = el.classList;
    const labelY = bottom - 7, btnY = labelY - 7 - 5 - bh;
    let x = pos[id], y = btnY, s = 1;
    if (cl.contains('armed')) { s = 1.1; y -= 4; animating = true; }
    if (pressed === el) s *= 0.92;
    ctx.save();
    if (cl.contains('locked') || cl.contains('empty')) ctx.globalAlpha = 0.6;
    if (cl.contains('armed')) { ctx.shadowColor = '#ffd34d'; ctx.shadowBlur = 14; } else { ctx.shadowColor = 'rgba(70,30,10,.3)'; ctx.shadowOffsetY = 5; ctx.shadowBlur = 8; }
    const dw = bw * s, dh = bh * s, dx = x + (bw - dw) / 2, dy = y + (bh - dh) / 2;
    draw(UI('c_bubble'), dx, dy, dw, dh);
    ctx.shadowColor = 'transparent';
    const icon = { bTri: 'icon_triple', bRocket: 'icon_rocket', bBig: 'icon_melon' }[id];
    draw(UI(icon), dx + dw * 0.17, dy + dh * 0.17, dw * 0.66, dh * 0.66);
    if (cl.contains('locked') || cl.contains('empty')) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(160,160,160,.55)'; ctx.fillRect(dx, dy, dw, dh); ctx.globalCompositeOperation = 'source-over'; }
    ctx.restore();
    // 角标
    const cs = 30 * s, cxp = dx + dw + 4 * s - cs, cyp = dy + dh + 2 * s - cs;
    draw(UI('c_badge'), cxp, cyp, cs, cs);
    const cnt = el.querySelector('.cnt span').textContent;
    if (cnt === '🔒') draw(UI('icon_lock'), cxp + cs * 0.22, cyp + cs * 0.2, cs * 0.56, cs * 0.56) || text('🔒', cxp + cs / 2, cyp + cs / 2, 12);
    else text(cnt, cxp + cs / 2, cyp + cs / 2 + 1, 15, { color: '#fff' });
    text({ bTri: 'Triple', bRocket: 'Rocket', bBig: 'Melon' }[id], x + bw / 2, labelY, 13, { stroke: true, spacing: 0.3 });
    region(el, x - 4, btnY - 6, bw + 8, bh + 30);
  }
  return animating;
}

function button(el, label, cx, y, w, kind, size) {
  const h = kind === 'green' ? (w * 101) / 512 : (w * 112) / 512, s = pressed === el ? 0.95 : 1;
  const dw = w * s, dh = h * s, x = cx - dw / 2, yy = y + (h - dh) / 2;
  draw(UI(kind === 'green' ? 'c_btn_green' : 'c_btn_white'), x, yy, dw, dh);
  if (kind === 'green') text(label, cx, yy + dh * 0.47, size * s, { stroke: true });
  else text(label, cx, yy + dh * 0.49, size * s, { color: INK });
  region(el, cx - w / 2, y, w, h);
  return h;
}

function modal(drawInner, title) {
  ctx.fillStyle = 'rgba(40,18,8,.5)'; ctx.fillRect(0, 0, W, H);
  const cw = Math.min(W * 0.88, 350), ch = (cw * 738) / 900, x = (W - cw) / 2, y = (H - ch) / 2;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowOffsetY = 12; ctx.shadowBlur = 22;
  draw(UI('c_panel'), x, y, cw, ch);
  ctx.restore();
  text(title, x + cw / 2, y + ch * 0.11, clamp(13, vw(4.4), 19), { stroke: true });
  drawInner(x + cw * 0.1, y + ch * 0.28, cw * 0.8, ch * 0.61);
}

function drawPanel() {
  modal((ix, iy, iw, ih) => {
    let y = iy;
    if (!hidden('pTitleImg')) { const t = UI('txt_clear'); const w = iw * 0.72, h = t ? (w * t.height) / t.width : w * 0.25; draw(t, ix + (iw - w) / 2, y, w, h); y += h; }
    // 按钮从底部往上排
    const green = iw * 0.74, white = iw * 0.64;
    const gH = (green * 101) / 512, wH = (white * 112) / 512;
    const altOn = !hidden('pAlt');
    const btnsH = gH + (altOn ? 8 + wH : 0), by = iy + ih - btnsH;
    button(E.pMain, E.pMainText.textContent, ix + iw / 2, by, green, 'green', clamp(15, vw(4.8), 20));
    if (altOn) button(E.pAlt, E.pAltText.textContent, ix + iw / 2, by + gH + 8, white, 'white', clamp(13, vw(4.2), 17));
    // 正文：居中在标题图和按钮之间，按 \n 分行
    const lines = E.pText.textContent.split('\n'), fs = clamp(14, vw(4.4), 18), lh = fs * 1.35;
    const ty = (y + by) / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => text(l, ix + iw / 2, ty + i * lh, fs, { color: INK }));
  }, E.pTitle.textContent);
}

function drawSettings() {
  modal((ix, iy, iw, ih) => {
    const white = iw * 0.64, wH = (white * 112) / 512, fs = clamp(13, vw(4.2), 17);
    let y = iy + ih * 0.04;
    button(E.sSound, E.sSoundText.textContent, ix + iw / 2, y, white, 'white', fs); y += wH + 8;
    button(E.sRestart, 'RESTART LEVEL', ix + iw / 2, y, white, 'white', fs);
    const green = iw * 0.74, gH = (green * 101) / 512;
    button(E.sClose, 'RESUME', ix + iw / 2, iy + ih - gH, green, 'green', clamp(15, vw(4.8), 20));
  }, 'SETTINGS');
}

// 抖音提审合规：启动屏要有《健康游戏忠告》和适龄提示（TikTok 包不画）
const HEALTH = ['抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。', '适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。'];
function drawStart() {
  ctx.fillStyle = 'rgba(40,16,8,.18)'; ctx.fillRect(0, 0, W, H);
  const logo = UI('logo'), lw = Math.min(W * 0.86, 420), lh = logo ? (lw * logo.height) / logo.width : lw * 0.55;
  const bw = Math.min(W * 0.64, 260), bh = (bw * 101) / 512, gap = H * 0.07;
  const total = lh + gap + bh, top = (H - total) / 2;
  const fl = Math.sin((now() / 3) * Math.PI * 2);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowOffsetY = 10; ctx.shadowBlur = 18;
  ctx.translate(W / 2, top + lh / 2 - 4 - fl * 4); ctx.rotate((-0.5 + fl * 0.5) * (Math.PI / 180));
  draw(logo, -lw / 2, -lh / 2, lw, lh);
  ctx.restore();
  button(E.startBtn, 'PLAY', W / 2, top + lh + gap, bw, 'green', clamp(24, vw(7.6), 32));
  if (globalThis.__PLATFORM === 'douyin') {
    const fs = 10.5;
    HEALTH.forEach((l, i) => text(l, W / 2, H - SAFE_BOTTOM - 40 + i * 15, fs, { color: 'rgba(255,255,255,.92)' }));
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(14, safeTop(SYS) + 10, 34, 20);
    text('8+', 31, safeTop(SYS) + 20, 13, { color: '#2a6b1a' });
  }
  return true;   // logo 一直在飘
}

// ---------- 每帧：有变化/有动画才重画 ----------
let animating = true;
globalThis.__overlay = (renderer) => {
  if (ui.dirty || animating) {
    ui.dirty = false;
    hits = [];
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    animating = false;
    const onStart = document.body.classList.contains('on-start');
    blocking = onStart || !hidden('panel') || !hidden('settings');
    if (!onStart) {
      drawHud();
      animating = drawBar() || animating;
      animating = drawToast() || animating;
      animating = drawCombo() || animating;
      animating = animating || E.toast.classList.contains('show') || E.combo.classList.contains('show');
    }
    if (!hidden('panel')) drawPanel();
    if (!hidden('settings')) drawSettings();
    if (onStart && !hidden('start')) animating = drawStart() || animating;
    if (pressed) animating = true;
    tex.needsUpdate = true;
  }
  renderer.autoClear = false;
  renderer.render(scene, cam);
};
