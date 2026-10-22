# Tomato Blast（番茄大炮）

学习 Royal Smash 与 Angry Smash 的同玩法物理解谜游戏，Tomato Blast 是在此基础上制作的原创作品（原创美术、原创关卡、原创设定）。

## 目录说明

- `game/`：游戏原型（index.html、game3d.js、levels.js、sfx.js、assets/ 等）；`game/v2d/` 是归档的 2D 侧视版，`game/v3d/` 是更早的 3D 版
- `art/promo/`：40 秒宣传片（自合成音效，未用原作采样）
- `docs/`：拆包学习笔记（`拆包学习笔记.md`）与拆包产物（`teardown/`，已去除广告相关 key 与设备标识 URL）
- `art/directions/`：美术方向探索
- `art/review/`：审核图
- `art/posters/`：海报

## 本地运行

```bash
cd game
python3 -m http.server 8765
```

然后打开 http://127.0.0.1:8765/

- `?debug=1`：显示调试按钮
- `?silent=1`：静音

## 素材来源

- 背景、贴图、UI、精灵均由 Yoroll gpt-image-2 生成。
- 背景音乐位于 `game/assets/music/`。
- 原作音效仅用于本地学习，未包含在仓库中；缺少音效文件时游戏会自动退回合成音效。

## 当前进度

- 第一人称视角（学原作）：镜头在炮后方，胖番茄炮坐在屏幕底边的同心圆环底盘中央（只露向上拱的几道弧，学原作），向纵深射击；three.js 渲染 + cannon-es 物理，物件为 Yoroll 生成的海报级精灵图。
- 射击手感：按住蓄力压低、松手后坐、炮口火光、亮黄弹道火线、命中顿帧、镜头后顶、手机震动。
- UI 为选定的「白色糖果」风格；游戏内文案全英文。
- 共 100 关（前 10 关手工设计，后 90 关程序生成）；按第一人称重新校准炮弹数，机器人用真实炮弹数逐关实测 100/100 清台。详见 `docs/100关实测报告.md`。
- 音效：开炮和番茄爆汁是自己合成的（`game/tools/make_fire_sfx.py` → `game/assets/sfx/`），按原作开炮声的频谱结构设计、针对手机喇叭加了泛音；游戏和宣传片共用。
- 宣传片：`game/tools/promo.js` 逐帧录制并记录音效事件，`game/tools/promo_sfx.py` 离线合成音效轨。
- 仓库不含原作音效，缺失时自动使用合成音效。
