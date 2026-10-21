# Tomato Blast（番茄大炮）

学习 Royal Smash 与 Angry Smash 的同玩法物理解谜游戏，Tomato Blast 是在此基础上制作的原创作品（原创美术、原创关卡、原创设定）。

## 目录说明

- `game/`：游戏原型（index.html、game.js、levels.js、sfx.js、assets/ 等）
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

- 2D 侧视版：Box2D（planck.js）物理；物件为 Yoroll 生成的海报级精灵图，碰撞形状从图片轮廓自动提取。
- UI 为选定的「白色糖果」风格。
- 共 100 关（前 10 关手工设计，后 90 关程序生成）；机器人逐关实测 100/100 清台（超难关受移动挡板时机影响，结果有波动）。详见 `docs/100关实测报告.md`。
- 游戏内文案全英文。
- 运行方式不变：在 `game/` 目录起本地服务器，`?debug=1` 显示调试按钮，`?silent=1` 静音。
- 仓库不含原作音效，缺失时自动使用合成音效。
