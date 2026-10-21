# Tomato Blast（番茄大炮）

学习 Royal Smash 与 Angry Smash 的同玩法物理解谜游戏，Tomato Blast 是在此基础上制作的原创作品（原创美术、原创关卡、原创设定）。

## 目录说明

- `game/`：游戏原型（index.html、game.js、levels.js、sfx.js、v3d/、assets/）
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

- 2D 侧视版重构中
- 目标 100 关
- 机器人校准中
