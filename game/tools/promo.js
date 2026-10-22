// 宣传片录制：在游戏页面控制台执行 `(await import('./tools/promo.js')).record()`
// 逐帧（30fps）驱动游戏，把画面连同字幕 / Logo 叠加层一起传给本地帧服务器（scratchpad/tools/frame_server.py，端口 8766）
// 之后用 ffmpeg 把帧序列 + 背景音乐 + 音效轨合成视频
// 音效：录制时通过 sfx.setPlayHook 按帧时间记下每个音效事件（window.__promoSfx），再离线合成音效轨（tools/promo_sfx.py）
import * as sfx from '../sfx.js';
const FPS = 30;
const G = window.__game;
const canvas = document.getElementById('c');
const comp = document.createElement('canvas');   // 合成画布：3D 画面 + 字幕叠加层
const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const backOut = (t) => { t = clamp01(t) - 1; return 1 + 2.70158 * t * t * t + 1.70158 * t * t; };

// 剧本：40 秒 / 9 段。caps = [文字, 出现秒, 消失秒, 纵向位置(屏高比例)]；acts = [开炮秒, 目标, 道具]
const SHOTS = [
  { dur: 3.5, level: 1, theme: 'kitchen', setup: (o) => { o.dim = 0.2; o.logo = { t0: 0.3, y: 0.36 }; } },
  { dur: 7, level: 1, theme: 'kitchen', flash: true,
    caps: [['AIM.', 0.2, 1.6, 0.27], ['BLAST!', 1.7, 3.4, 0.27], ['SPLAT!', 3.6, 6.7, 0.27]],
    acts: [[0.7, 'top'], [2.3, 'top'], [4.0, 'top'], [5.2, 'top']] },
  { dur: 6, level: 4, theme: 'drinks', flash: true, caps: [['CHAIN REACTIONS!', 1.0, 5.7, 0.27]], acts: [[0.6, 'boom'], [3.4, 'top']] },
  { dur: 6.5, level: 8, theme: 'bakery', flash: true, caps: [['POWER-UPS!', 0.3, 6.2, 0.27]], acts: [[0.6, 'mid', 'big'], [3.2, 'top', 'tri']] },
  { dur: 5.5, level: 12, theme: 'drinks', flash: true, caps: [['PIERCE IT ALL!', 0.9, 5.2, 0.27]], acts: [[0.6, 'low', 'rocket'], [3.0, 'top']] },
  { dur: 2, level: 5, theme: 'kitchen', flash: true, caps: [['3 KITCHENS', 0.05, 1.95, 0.27]], acts: [[0.45, 'top']] },
  { dur: 2, level: 5, theme: 'drinks', flash: true, caps: [['100 LEVELS', 0.05, 1.95, 0.27]], acts: [[0.45, 'top']] },
  { dur: 2, level: 5, theme: 'bakery', flash: true, caps: [['ENDLESS FLAVORS', 0.05, 1.95, 0.27]], acts: [[0.45, 'top']] },
  { dur: 5.5, level: 9, theme: 'kitchen', flash: true, setup: (o) => { o.dim = 0.5; o.logo = { t0: 0.1, y: 0.33 }; o.cta = { t0: 0.7, y: 0.6 }; o.fadeOutAt = 4.6; } },
];

let IMG = {};
let o = {};
function drawCaption(ctx, W, H, text, age, dur, y) {
  const a = 1 - clamp01((age - dur + 0.22) / 0.22);
  const s = backOut(age / 0.28);
  const size = Math.min(W * 0.115, 62);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(W / 2, H * y);
  ctx.rotate(-0.035);
  ctx.scale(s, s);
  ctx.font = `${size}px "Lilita One"`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.26; ctx.strokeStyle = '#8e150c';
  ctx.shadowColor = 'rgba(40,10,0,.45)'; ctx.shadowOffsetY = size * 0.1; ctx.shadowBlur = size * 0.15;
  ctx.strokeText(text, 0, 0);
  ctx.shadowColor = 'transparent';
  const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  g.addColorStop(0, '#fff8d8'); g.addColorStop(0.55, '#ffd84a'); g.addColorStop(1, '#ff9a1a');
  ctx.fillStyle = g;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
function overlay(ctx, W, H) {
  if (o.dim) { ctx.fillStyle = `rgba(40,15,5,${o.dim})`; ctx.fillRect(0, 0, W, H); }
  for (const [text, t0, t1, y] of o.caps || []) if (o.t >= t0 && o.t <= t1) drawCaption(ctx, W, H, text, o.t - t0, t1 - t0, y);
  if (o.logo && o.t >= o.logo.t0) {
    const s = backOut((o.t - o.logo.t0) / 0.5), w = Math.min(W * 0.84, 460) * s, h = (w * IMG.logo.height) / IMG.logo.width;
    ctx.drawImage(IMG.logo, W / 2 - w / 2, H * o.logo.y - h / 2 + Math.sin(o.t * 2.2) * 5, w, h);
  }
  if (o.cta && o.t >= o.cta.t0) {
    const pulse = 1 + Math.sin((o.t - o.cta.t0) * 5) * 0.04, s = backOut((o.t - o.cta.t0) / 0.4) * pulse;
    const w = Math.min(W * 0.62, 300) * s, h = (w * IMG.btn.height) / IMG.btn.width;
    const x = W / 2 - w / 2, y = H * o.cta.y - h / 2;
    ctx.drawImage(IMG.btn, x, y, w, h);
    const size = h * 0.48;
    ctx.save();
    ctx.font = `${size}px "Lilita One"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.22; ctx.strokeStyle = '#2f6b12'; ctx.strokeText('PLAY NOW', W / 2, y + h * 0.47);
    ctx.fillStyle = '#fff'; ctx.fillText('PLAY NOW', W / 2, y + h * 0.47);
    ctx.restore();
  }
  if (o.flash && o.t < 0.2) { ctx.fillStyle = `rgba(255,248,230,${0.55 * (1 - o.t / 0.2)})`; ctx.fillRect(0, 0, W, H); }
  if (o.fadeOutAt && o.t > o.fadeOutAt) { ctx.fillStyle = `rgba(20,8,4,${clamp01((o.t - o.fadeOutAt) / 0.9)})`; ctx.fillRect(0, 0, W, H); }
}

// 目标选择：top 最高的物件 / boom 会爆的罐 / mid 中间高度靠中间的 / low 最低一排靠中间的（给穿甲火箭横扫）
function pick(kind) {
  const live = G.items().filter((i) => !i.dead && !i.cleared && i.counted);
  if (!live.length) return null;
  const P = (i) => G.pos(i);
  if (kind === 'boom') { const b = live.find((i) => i.def.explosive); if (b) return P(b); }
  if (kind === 'top') return P(live.reduce((a, b) => (P(b).y > P(a).y ? b : a)));
  const ys = live.map((i) => P(i).y).sort((a, b) => a - b);
  const yRef = kind === 'low' ? ys[0] : ys[Math.floor(ys.length / 2)];
  return P(live.reduce((a, b) => (Math.abs(P(b).y - yRef) + Math.abs(P(b).x) * 0.3 < Math.abs(P(a).y - yRef) + Math.abs(P(a).x) * 0.3 ? b : a)));
}

// 同步上传：后台标签页会把异步回调降到每秒一次，所以用同步 XHR + dataURL，一次调用连续录一段
function upload(i) {
  const x = new XMLHttpRequest();
  x.open('POST', `http://127.0.0.1:8766/frame?i=${i}`, false);
  x.setRequestHeader('Content-Type', 'text/plain');
  // 3D 画布同一任务里刚渲染完，直接 drawImage 能拿到画面；字幕按 CSS 像素画在上面
  comp.width = canvas.width; comp.height = canvas.height;
  const ctx = comp.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const k = canvas.width / innerWidth;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  overlay(ctx, innerWidth, innerHeight);
  x.send(comp.toDataURL('image/jpeg', 0.92));
}

// 分段录制：先 prepare()，再反复调用 recordChunk(帧数) 直到返回 true（全部录完）
const R = { shot: -1, f: 0, n: 0, i: 0, acts: [] };
export async function prepare() {
  await document.fonts.load('40px "Lilita One"');
  IMG = { logo: await load('assets/ui/logo.png'), btn: await load('assets/ui/c_btn_green.png') };
  R.invBefore = { ...G.inv };
  window.__promoSfx = [];
  sfx.setPlayHook((name, vol, rate) => window.__promoSfx.push([+(R.i / FPS).toFixed(3), name, +vol.toFixed(2), +rate.toFixed(2)]));
  Object.assign(R, { shot: -1, f: 0, n: 0, i: 0 });
  return SHOTS.reduce((s, x) => s + Math.round(x.dur * FPS), 0);
}
function startShot(k) {
  const shot = SHOTS[k];
  G.load(shot.level, shot.theme);   // 0 起算
  G.S.shots = 99;
  G.tick(0.4);   // 先让堆叠稳定（不录）
  o = { t: 0, caps: shot.caps, flash: shot.flash };
  shot.setup?.(o);
  R.acts = (shot.acts || []).map((a) => ({ t: a[0], target: a[1], booster: a[2], done: false }));
  R.shot = k; R.f = 0; R.n = Math.round(shot.dur * FPS);
}
export function recordChunk(frames = 120) {
  for (let c = 0; c < frames; c++) {
    if (R.shot < 0 || R.f >= R.n) {
      if (R.shot + 1 >= SHOTS.length) {
        sfx.setPlayHook(null);
        Object.assign(G.inv, R.invBefore);   // 录制时用掉的道具还回去，连存档一起
        try { localStorage.setItem('tomato3d_inv', JSON.stringify(G.inv)); } catch { /* 隐私模式 */ }
        return { done: true, frames: R.i };
      }
      startShot(R.shot + 1);
    }
    o.t = R.f / FPS;
    for (const a of R.acts) {
      if (a.done || o.t < a.t) continue;
      a.done = true;
      const p = pick(a.target);
      if (!p) continue;
      G.S.lastShotAt = -99;
      if (a.booster) G.arm(a.booster);
      G.fireAt(p.x, p.y, p.z);
    }
    G.tick(1 / FPS);
    upload(R.i++);
    R.f++;
  }
  return { done: false, frames: R.i, shot: R.shot };
}
