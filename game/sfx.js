// 音效与背景音乐
// 分类照两款原作的音效清单：开炮 / 材质命中（木、罐、玻璃、冰、石）/ 掉落 / 爆炸 / 道具 / 胜负 / UI
// 采样文件在 SAMPLE_URLS 里登记；登记了就播采样，没登记或加载失败就用下面的合成音兜底

const AC = window.AudioContext || window.webkitAudioContext;
const ctx = new AC();
const master = ctx.createGain();
master.gain.value = 0.9;
master.connect(ctx.destination);
const sfxBus = ctx.createGain();
sfxBus.gain.value = 0.85;
sfxBus.connect(master);

let muted = false;
const buffers = {};
const lastPlay = {};

// 逻辑音效名 → 采样文件（相对 index.html）。原作采样只限本地学习，发布前全部换掉
// 路径相对本模块解析：根目录 2D 版和 v3d/ 归档版都能用
const R = new URL('assets/sfx_ref/royal/', import.meta.url).href, A = new URL('assets/sfx_ref/angry/', import.meta.url).href;
export const SAMPLE_URLS = {
  fire: R + 'cannon_blast.mp3',
  fire_tri: A + 'ASM_SFX_Gameplay_Booster_WideShot_Shoot_01.mp3',
  fire_rocket: A + 'ASM_SFX_Gameplay_Booster_PiercingRocket_Shoot_01.mp3',
  big_grow: A + 'ASM_SFX_Gameplay_Booster_BigCannon_Grow_01.mp3',
  booster_tap: A + 'ASM_SFX_Gameplay_Booster_Tap_01.mp3',
  hit_wood: A + 'ASM_SFX_Gameplay_Wood_Hit_01.mp3',
  fall_wood: A + 'ASM_SFX_Gameplay_Wood_Fall_01.mp3',
  hit_tin: R + 'can_hit.mp3',
  fall_tin: A + 'ASM_SFX_Gameplay_Tin_Fall_01.mp3',
  hit_glass: R + 'jar_break.mp3',
  hit_ice: R + 'ice_hit.mp3',
  break_ice: R + 'ice_break.mp3',
  hit_stone: R + 'stone_hit.mp3',
  fall_stone: A + 'ASM_SFX_Gameplay_Metal_Fall_01.mp3',
  hit_soft: R + 'pinata_hit.mp3',
  boom: R + 'tnt_explode.mp3',
  win: A + 'Game_Won.mp3',
  firework: R + 'welldone_firework.mp3',
  lose: A + 'Game_Lost.mp3',
  click: R + 'ui-button-click.mp3',
  combo: R + 'streak_moves_hit_ui.mp3',
  coin: A + 'sfx_ph_CoinCollected.mp3',
};

export async function loadSamples(map = SAMPLE_URLS) {
  await Promise.all(Object.entries(map).map(async ([k, url]) => {
    try {
      const r = await fetch(url);
      if (!r.ok) return;
      buffers[k] = await ctx.decodeAudioData(await r.arrayBuffer());
    } catch { /* 没有就用合成音 */ }
  }));
}

// ---------- 合成音（零素材兜底） ----------
let noiseBuf;
function noise() {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
function env(g, t, a, peak, dec) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
}
function nz(t, { type = 'bandpass', f = 1000, f2, q = 1, vol = 0.5, a = 0.003, dec = 0.1 }) {
  const s = ctx.createBufferSource(); s.buffer = noise();
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + dec);
  const g = ctx.createGain(); env(g, t, a, vol, dec);
  s.connect(fl).connect(g).connect(sfxBus);
  s.start(t, Math.random() * 0.5); s.stop(t + a + dec + 0.05);
}
function tone(t, { type = 'sine', f = 440, f2, vol = 0.3, a = 0.003, dec = 0.15 }) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + dec);
  const g = ctx.createGain(); env(g, t, a, vol, dec);
  o.connect(g).connect(sfxBus);
  o.start(t); o.stop(t + a + dec + 0.05);
}
const SYNTH = {
  fire: (v, r, t) => { tone(t, { f: 140 * r, f2: 45, vol: 0.7 * v, dec: 0.18 }); nz(t, { f: 1800, f2: 400, q: 0.8, vol: 0.35 * v, dec: 0.22 }); },
  fire_big: (v, r, t) => { tone(t, { f: 90 * r, f2: 30, vol: 0.9 * v, dec: 0.3 }); nz(t, { type: 'lowpass', f: 900, f2: 200, vol: 0.5 * v, dec: 0.3 }); },
  fire_tri: (v, r, t) => { for (let k = 0; k < 3; k++) SYNTH.fire(v * 0.6, r * (1 + k * 0.12), t + k * 0.04); },
  fire_rocket: (v, r, t) => { nz(t, { f: 600, f2: 3000, q: 1.5, vol: 0.5 * v, a: 0.05, dec: 0.6 }); tone(t, { type: 'sawtooth', f: 120, f2: 400, vol: 0.12 * v, a: 0.05, dec: 0.5 }); },
  splat: (v, r, t) => { nz(t, { type: 'lowpass', f: 2500 * r, f2: 250, vol: 0.6 * v, dec: 0.18 }); tone(t, { f: 180 * r, f2: 70, vol: 0.3 * v, dec: 0.1 }); },
  hit_wood: (v, r, t) => { nz(t, { f: 900 * r, q: 3, vol: 0.5 * v, dec: 0.07 }); tone(t, { type: 'triangle', f: 230 * r, f2: 160, vol: 0.25 * v, dec: 0.08 }); },
  hit_tin: (v, r, t) => { nz(t, { f: 3000 * r, q: 4, vol: 0.3 * v, dec: 0.06 }); tone(t, { type: 'triangle', f: 950 * r, vol: 0.18 * v, dec: 0.22 }); tone(t, { f: 1430 * r, vol: 0.1 * v, dec: 0.18 }); },
  hit_glass: (v, r, t) => { tone(t, { f: 2300 * r, vol: 0.18 * v, dec: 0.3 }); tone(t, { f: 3450 * r, vol: 0.1 * v, dec: 0.25 }); nz(t, { type: 'highpass', f: 5000, vol: 0.15 * v, dec: 0.05 }); },
  hit_ice: (v, r, t) => { nz(t, { type: 'highpass', f: 2500 * r, vol: 0.35 * v, dec: 0.12 }); tone(t, { f: 1800 * r, vol: 0.12 * v, dec: 0.15 }); },
  hit_stone: (v, r, t) => { nz(t, { type: 'lowpass', f: 500 * r, vol: 0.7 * v, dec: 0.12 }); tone(t, { f: 90 * r, f2: 60, vol: 0.3 * v, dec: 0.12 }); },
  hit_soft: (v, r, t) => { nz(t, { type: 'lowpass', f: 700 * r, vol: 0.4 * v, dec: 0.08 }); },
  boom: (v, r, t) => { nz(t, { type: 'lowpass', f: 1200, f2: 80, vol: 1.0 * v, dec: 0.7 }); tone(t, { f: 75 * r, f2: 30, vol: 0.9 * v, dec: 0.6 }); nz(t, { f: 2500, f2: 600, vol: 0.3 * v, dec: 0.25 }); },
  pop: (v, r, t) => { tone(t, { f: 520 * r, f2: 1050 * r, vol: 0.35 * v, dec: 0.1 }); tone(t + 0.02, { type: 'triangle', f: 1300 * r, vol: 0.12 * v, dec: 0.08 }); },
  fall: (v, r, t) => { nz(t, { type: 'lowpass', f: 400 * r, vol: 0.35 * v, dec: 0.15 }); },
  combo: (v, r, t) => { [0, 4, 7, 12].forEach((s, k) => tone(t + k * 0.05, { type: 'triangle', f: 660 * r * 2 ** (s / 12), vol: 0.2 * v, dec: 0.18 })); },
  win: (v, r, t) => { [0, 4, 7, 12, 16].forEach((s, k) => tone(t + k * 0.09, { type: 'triangle', f: 523 * 2 ** (s / 12), vol: 0.3 * v, dec: 0.35 })); },
  lose: (v, r, t) => { [7, 4, 0, -5].forEach((s, k) => tone(t + k * 0.14, { type: 'triangle', f: 392 * 2 ** (s / 12), vol: 0.25 * v, dec: 0.3 })); },
  click: (v, r, t) => { tone(t, { type: 'square', f: 900, f2: 600, vol: 0.08 * v, dec: 0.04 }); },
  load: (v, r, t) => { tone(t, { f: 300 * r, f2: 700 * r, vol: 0.15 * v, dec: 0.08 }); },
};

// gap：同一个音效的最短间隔，避免一堆物件同时碰撞时爆音
// 宣传片录制用：每个音效事件回调一次（静音时也回调），由录制脚本按游戏时间记下来再离线合成音效轨
let onPlay = null;
export function setPlayHook(fn) { onPlay = fn; }

export function play(name, { vol = 1, rate = 1, jitter = 0.06, gap = 0.035 } = {}) {
  if (onPlay) onPlay(name, vol, rate);
  if (muted || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  if (lastPlay[name] != null && t - lastPlay[name] < gap) return;
  lastPlay[name] = t;
  const r = rate * (1 + (Math.random() * 2 - 1) * jitter);
  const buf = buffers[name];
  if (buf) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = r;
    const g = ctx.createGain();
    g.gain.value = vol;
    s.connect(g).connect(sfxBus);
    s.start();
    return;
  }
  (SYNTH[name] || SYNTH.hit_soft)(Math.min(1, vol), r, t);
}

// ---------- 背景音乐：两首轮流循环 ----------
const TRACKS = ['assets/music/sneaky_coconut_chaos.mp3', 'assets/music/whose_boat_is_this.mp3'].map((p) => new URL(p, import.meta.url).href);
let music, trackIdx = 0;
function startMusic() {
  if (music) return;
  music = new Audio(TRACKS[trackIdx]);
  music.volume = 0.45;
  music.addEventListener('ended', () => {
    trackIdx = (trackIdx + 1) % TRACKS.length;
    music.src = TRACKS[trackIdx];
    music.play().catch(() => {});
  });
  music.play().catch(() => {});
}

// 浏览器要求用户先有一次操作才能出声
export function unlock() {
  if (ctx.state === 'suspended') ctx.resume();
  if (!muted) startMusic();
}
export function toggleMute() {
  muted = !muted;
  master.gain.value = muted ? 0 : 0.9;
  if (music) { if (muted) music.pause(); else music.play().catch(() => {}); }
  else if (!muted) startMusic();
  return muted;
}
