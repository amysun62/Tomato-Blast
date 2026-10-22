// 小游戏入口（esbuild 打成 bundle.js）：先装适配层，再跑网页版同一份 game3d.js，最后挂上画布界面。
// 大图在分包 art/ 里，先加载分包再启动游戏。
import { platform } from './adapter.js';

const { T } = platform;
function boot() {
  import('../../game3d.js').then(() => import('./hud.js'));
}
if (typeof T.loadSubpackage === 'function') {
  let started = false;
  const go = () => { if (!started) { started = true; boot(); } };
  T.loadSubpackage({ name: 'art', success: go, fail: go });
  setTimeout(go, 10000);   // 弱网兜底：卡在加载是明确的拒审项（必读 B11），10 秒后强制进入
} else boot();
