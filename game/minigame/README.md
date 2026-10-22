# Tomato Blast · 抖音 / TikTok 原生小游戏包（交接给同事，未完成）

制作人 2026-10-22 决定：打包交给同事做，这里是已经做到的部分和剩下的事。

## 路线（已定）

- 抖音和 TikTok 都做**原生小游戏包**（game.js + game.json + project.config.json），一份代码出两份。
  - 依据：抖音小游戏运行环境没有 DOM，只有 tt 接口（制作人必读 B11 第 4 条，及抖音开放平台文档）；TikTok 官方 2026-08-28 起不收 HTML 小游戏，只收原生包，接口和抖音同一套（TTMinis.game 与 tt 前缀互换）。
- 网页版代码 `../game3d.js` 一行不改：适配层补上 three.js 和游戏用到的 window / document / 图片 / 存储 / 触摸 / fetch；界面元素在小游戏里是"假 DOM"（只记状态），由 `src/hud.js` 照 `../index.html` 的布局画到画布上。
- 先用测试号（appid = `testappid`），正式 AppID 由制作人提供后改 `build.mjs` 里的 `PLATFORMS`。

## 文件

| 文件 | 作用 |
|---|---|
| `src/adapter.js` | 运行时适配层。真机上新建 window/document 等；在浏览器预览器（tt-shim）里只打补丁（预览器的全局对象是页面 window） |
| `src/hud.js` | 画布界面：顶部 HUD、道具栏、提示、连击大字、结算弹窗、设置、标题页；抖音包标题页带《健康游戏忠告》和 8+ 适龄角标 |
| `src/sfx_tt.js` | 音效 / 音乐，用 InnerAudioContext（抖音真机上 WebAudio 不稳）。全部是自己做的声音，不含原作采样 |
| `src/main.js` | 入口：先加载分包 art，再启动游戏（10 秒弱网兜底强制进入） |
| `build.mjs` | `npm install && node build.mjs` → `dist/douyin`、`dist/tiktok` 和同名 zip，带体积门禁 |
| `../tools/make_minigame_assets.py` | 生成 `assets_src/`：精灵和 UI 转**无损** WebP（像素与原图一致）；背景/地板 JPG 原样；音乐单声道 64k；音效 mp3；Lilita One 字体（SIL OFL） |

`assets_src/`、`dist/`、`node_modules/` 都是生成物，没有进仓库，按上面两条命令重新生成。

## 体积（2026-10-22 实测构建）

主包 3.75MB（上限 4MB）/ 分包 art 14.62MB / 合计 18.37MB（抖音上限 20MB，TikTok 30MB）。图片按制作人要求不损失画质，所以用无损；有损 WebP 实测最低只有 28 dB（"AWESOME" 字图明显变样），已放弃。

## 现状（说到实际验证到哪一层）

- ✅ 构建通过，两个包都能打出来，体积门禁通过。
- ⚠️ 浏览器预览器（毡毡岛 `.claude/skills/douyin-minigame-skills/.../douyin-minigame-preview`，`python3 scripts/preview.py dist/douyin --port 8771 --no-open`，打开 `/__harness__/index.html`）：
  - 已修：预览器里全局对象是页面 window（尺寸、fetch 要补在 window 上）；预览器里相对路径按预览页解析，图片/音效/字体/清单要补 `/` 包根前缀；预览器 createImage 的 src 不能重定义。
  - **未完成**：最后一次构建后还没在预览器里重新看到 3D 画面跑起来（之前一直黑屏，原因是素材清单 404 导致素材加载没结束，已改，未复验）。另有一条 "NetworkError" 运行时报错，来源未查清（怀疑是预览器里的字体加载）。
- ❌ 官方抖音开发者工具、TikTok `@ttmg/cli`、真机：都没跑过。
- ❌ 未确认：TikTok 画布只有 WebGL 1.0（官方文档写的），three.js r160 在 WebGL1 上能否正常渲染；适配层已经支持传入 WebGL1 上下文，但没在真机上验证。

## 剩下的事

1. 预览器里复验：标题页 → PLAY → 打一关 → 过关弹窗 → 下一关；道具按钮；设置面板；声音。
2. 官方 IDE 和真机各过一遍（抖音、TikTok 各一台）。
3. 提审物料：抖音图标 1254×1254、截图、简介；软著 / ICP / 小游戏备案（各约 1 个月，见必读 B11）；TikTok 需要企业认证、600×600 图标、隐私政策和服务条款 URL。
4. 正式 AppID 填进 `build.mjs`。
