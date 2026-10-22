// 构建抖音 / TikTok 原生小游戏包：node build.mjs
// 一份源码（网页版 game3d.js + 适配层 + 画布界面）→ dist/douyin、dist/tiktok 两个目录和同名 zip。
// 主包：代码 + UI 图 + 字体 + 音效（≤4MB 门禁）；分包 art/：精灵图、背景、地板、音乐。
// 素材来自 assets_src/（tools/make_minigame_assets.py 生成的 webp / mp3），不含任何原作采样。
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC_ASSETS = path.join(ROOT, 'assets_src');
const MB = 1024 * 1024;
const PLATFORMS = {
  douyin: { appid: 'testappid', subKey: 'subPackages', mainLimit: 4 * MB, totalLimit: 20 * MB },
  tiktok: { appid: 'testappid', subKey: 'subpackages', mainLimit: 4 * MB, totalLimit: 30 * MB },
};

// 网页版 game3d.js 里 import './sfx.js' → 换成小游戏音效
const sfxSwap = {
  name: 'sfx-swap',
  setup(b) {
    b.onResolve({ filter: /(^|\/)sfx\.js$/ }, (args) => (args.importer.endsWith('game3d.js') ? { path: path.join(ROOT, 'src/sfx_tt.js') } : undefined));
  },
};

function copyDir(src, dst, filter = () => true) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d, filter);
    else if (filter(f)) fs.copyFileSync(s, d);
  }
}
function dirSize(p) {
  if (!fs.existsSync(p)) return 0;
  return fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((a, f) => a + dirSize(path.join(p, f)), 0) : fs.statSync(p).size;
}

for (const [name, cfg] of Object.entries(PLATFORMS)) {
  const out = path.join(ROOT, 'dist', name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/main.js')],
    bundle: true, format: 'iife', target: 'es2017', minify: true, legalComments: 'none',
    outfile: path.join(out, 'bundle.js'),
    alias: { three: path.join(ROOT, 'node_modules/three/build/three.module.js'), 'cannon-es': path.join(ROOT, 'node_modules/cannon-es/dist/cannon-es.js') },
    banner: { js: `(function(g){if(typeof globalThis==='undefined')g.globalThis=g;g.__PLATFORM='${name}';})(typeof GameGlobal!=='undefined'?GameGlobal:this);` },
    plugins: [sfxSwap],
    logLevel: 'warning',
  });
  fs.writeFileSync(path.join(out, 'game.js'), "// Tomato Blast 小游戏入口：适配层 + 游戏都在 bundle.js 里\nrequire('./bundle.js');\n");
  fs.writeFileSync(path.join(out, 'game.json'), JSON.stringify({
    deviceOrientation: 'portrait', showStatusBar: false,
    networkTimeout: { request: 10000, downloadFile: 60000 },
    [cfg.subKey]: [{ name: 'art', root: 'art/' }],
  }, null, 2));
  fs.writeFileSync(path.join(out, 'project.config.json'), JSON.stringify({
    appid: cfg.appid, projectname: 'tomato-blast', setting: { es6: false, urlCheck: false },
  }, null, 2));
  // 分包入口文件（平台要求 root 下有 game.js）
  fs.mkdirSync(path.join(out, 'art'), { recursive: true });
  fs.writeFileSync(path.join(out, 'art/game.js'), '// 分包 art：只放图片\n');
  // 主包素材
  copyDir(path.join(SRC_ASSETS, 'ui'), path.join(out, 'assets/ui'), (f) => f.endsWith('.webp'));
  copyDir(path.join(SRC_ASSETS, 'fonts'), path.join(out, 'assets/fonts'), (f) => f.endsWith('.ttf'));
  copyDir(path.join(SRC_ASSETS, 'sfx'), path.join(out, 'assets/sfx'), (f) => f.endsWith('.mp3'));
  if (fs.existsSync(path.join(SRC_ASSETS, 'icon.png'))) fs.copyFileSync(path.join(SRC_ASSETS, 'icon.png'), path.join(out, 'icon.png'));
  // 分包素材
  copyDir(path.join(SRC_ASSETS, 'sprites'), path.join(out, 'art/sprites'), (f) => f.endsWith('.webp') || f === 'manifest.json');
  copyDir(path.join(SRC_ASSETS, 'music'), path.join(out, 'art/music'), (f) => f.endsWith('.mp3'));
  for (const f of fs.readdirSync(SRC_ASSETS)) if (/^(bg|floor)_.*\.jpg$/.test(f)) fs.copyFileSync(path.join(SRC_ASSETS, f), path.join(out, 'art', f));
  // 体积门禁
  const total = dirSize(out), sub = dirSize(path.join(out, 'art')), main = total - sub;
  const line = `${name}: 主包 ${(main / MB).toFixed(2)}MB / 分包 art ${(sub / MB).toFixed(2)}MB / 合计 ${(total / MB).toFixed(2)}MB`;
  console.log(line);
  if (main > cfg.mainLimit || total > cfg.totalLimit) { console.error(`✗ ${name} 超出平台体积上限`); process.exitCode = 1; }
  fs.writeFileSync(path.join(out, 'SIZE.txt'), line + '\n');
  execSync(`cd "${path.join(ROOT, 'dist')}" && rm -f ${name}.zip && zip -qr ${name}.zip ${name} -x "*/SIZE.txt"`);
}
