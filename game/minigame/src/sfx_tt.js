// 小游戏版音效（替换网页版 sfx.js，接口相同）：全部是自己做的声音（assets/sfx/*.mp3，不含原作采样），
// 用平台的 InnerAudioContext 播放——抖音真机上 WebAudio 不稳（必读 B11）；每个音效一个小池子，允许叠音。
import { platform } from './adapter.js';

const { T } = platform;
// 浏览器预览器（tt-shim）的音频不按包根解析，要补成绝对路径；真机走包根相对路径
const shimPath = (p) => (typeof T.resolveShimPath === 'function' ? '/' + p : p);
let muted = false;
const POOL = 3;
const pools = {};
const lastPlay = {};
let onPlay = null;
export function setPlayHook(fn) { onPlay = fn; }

// 别名：同一个声音文件复用
const FILE = { fire_tri: 'fire', splat_big: 'splat_big', fire_big: 'fire_big' };
function pool(name) {
  if (pools[name]) return pools[name];
  const src = shimPath(`assets/sfx/${FILE[name] || name}.mp3`);
  const list = [];
  for (let i = 0; i < POOL; i++) {
    try { const a = T.createInnerAudioContext(); a.src = src; a.obeyMuteSwitch = false; list.push(a); } catch { /* 无音频 */ }
  }
  return (pools[name] = { list, i: 0 });
}
export function loadSamples() {
  for (const n of ['fire', 'fire_big', 'splat', 'splat_big', 'hit_wood', 'hit_tin', 'hit_glass', 'hit_stone', 'hit_soft', 'pop', 'boom', 'click', 'combo', 'win']) pool(n);
}

export function play(name, { vol = 1, rate = 1, gap = 0.035, delay = 0 } = {}) {
  if (onPlay) onPlay(name, vol, rate, delay);
  if (muted) return;
  const t = Date.now() / 1000 + delay;
  if (lastPlay[name] != null && t - lastPlay[name] < gap) return;
  lastPlay[name] = t;
  const go = () => {
    const p = pool(name);
    if (!p.list.length) return;
    const a = p.list[p.i++ % p.list.length];
    try {
      a.stop();
      a.volume = Math.min(1, vol);
      if ('playbackRate' in a) a.playbackRate = Math.max(0.5, Math.min(2, rate));
      a.play();
    } catch { /* 忽略单次失败 */ }
  };
  if (delay > 0) setTimeout(go, delay * 1000); else go();
}

// ---------- 背景音乐：两首轮流循环 ----------
const TRACKS = ['art/music/sneaky_coconut_chaos.mp3', 'art/music/whose_boat_is_this.mp3'];   // 音乐在分包里
let music = null, trackIdx = 0;
function startMusic() {
  if (music || muted) return;
  try {
    music = T.createInnerAudioContext();
    music.src = shimPath(TRACKS[trackIdx]);
    music.volume = 0.45;
    music.obeyMuteSwitch = false;
    music.onEnded(() => { trackIdx = (trackIdx + 1) % TRACKS.length; music.src = shimPath(TRACKS[trackIdx]); music.play(); });
    music.play();
  } catch { music = null; }
}
export function unlock() { startMusic(); }
export function toggleMute() {
  muted = !muted;
  if (music) { try { if (muted) music.pause(); else music.play(); } catch { /* 无 */ } } else if (!muted) startMusic();
  return muted;
}
// 切到后台暂停音乐、回来继续
try { T.onHide(() => { if (music) music.pause(); }); T.onShow(() => { if (music && !muted) music.play(); }); } catch { /* 无 */ }
