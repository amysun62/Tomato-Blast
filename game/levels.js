// 2D 侧视关卡：桌面上表面 y = 0，x 向右，y 向上，单位米；物件坐标是中心点
// 两层分离（学 Angry Smash：关卡里是几何积木 + 单独的 skin）：
//   原型层 ARCH：碰撞尺寸、质量、材质手感 —— 固定，像乐高积木，关卡只用它
//   主题层：同一个原型在不同章节画成不同食物（assets/sprites/<主题>_<原型>.png），碰撞形状从图片轮廓自动提取

export const ARCH = {
  box:    { role: '轻方块', w: 1, h: 1, mass: 1.0, mat: 'wood' },
  heavy:  { role: '重方块', w: 1, h: 1, mass: 3.5, mat: 'stone' },
  slick:  { role: '滑方块', w: 1, h: 1, mass: 0.8, mat: 'ice' },
  boom:   { role: '会爆的罐', w: 0.86, h: 0.95, mass: 1.0, mat: 'metal', explosive: true },
  plank:  { role: '长板', w: 2.6, h: 0.26, mass: 1.2, mat: 'wood' },
  pillar: { role: '高柱', w: 0.56, h: 2, mass: 1.6, mat: 'wood' },
  drum:   { role: '中圆柱', w: 0.76, h: 0.8, mass: 0.5, mat: 'metal' },
  bottle: { role: '细高瓶', w: 0.55, h: 1.1, mass: 0.35, mat: 'glass' },
  jar:    { role: '矮罐', w: 0.64, h: 0.7, mass: 0.6, mat: 'glass' },
  disc:   { role: '扁块', w: 0.9, h: 0.32, mass: 0.3, mat: 'soft' },
  ball:   { role: '会滚的圆', w: 0.8, h: 0.8, mass: 0.7, mat: 'soft', round: true },
  wall:   { role: '固定挡板', w: 0.3, h: 2, mat: 'stone', body: 'static', counted: false },
  slider: { role: '移动挡板', w: 0.3, h: 1.6, mat: 'stone', body: 'kinematic', counted: false },
};

// 难度节奏：照搬拆包结论——每 10 关一循环，x4/x7 = 困难，x0 = 超难
export function difficultyOf(n) {
  if (n % 10 === 0) return 2;
  if (n % 10 === 4 || n % 10 === 7) return 1;
  return 0;
}

const GAP = 0.004;
const H = (t) => ARCH[t].h;
const W = (t) => ARCH[t].w;
const at = (Id, x, y, Custom) => ({ Id, x, y, ...(Custom ? { Custom } : {}) });

// 竖直叠一摞（base = 底面高度）
function stack(type, x, n, base = 0) {
  return Array.from({ length: n }, (_, i) => at(type, x, base + H(type) / 2 + i * (H(type) + GAP)));
}
// 一面墙：以 cx 为中心，cols 列 rows 层
function wall(type, cx, cols, rows, base = 0) {
  const w = W(type) + 0.02;
  const out = [];
  for (let c = 0; c < cols; c++) out.push(...stack(type, cx + (c - (cols - 1) / 2) * w, rows, base));
  return out;
}
// 金字塔：每层少一个，错半个身位
function pyramid(type, cx, base, baseY = 0) {
  const w = W(type) + 0.03;
  const out = [];
  for (let row = 0; row < base; row++) {
    const n = base - row;
    for (let i = 0; i < n; i++) out.push(at(type, cx + (i - (n - 1) / 2) * w, baseY + H(type) / 2 + row * (H(type) + GAP)));
  }
  return out;
}
// 一排（间隔摆放，留空隙让它们像保龄瓶一样连锁倒）
function row(type, cx, n, spacing, base = 0) {
  return Array.from({ length: n }, (_, i) => at(type, cx + (i - (n - 1) / 2) * spacing, base + H(type) / 2));
}
const top = (type, rows) => rows * (H(type) + GAP);   // 一摞的顶面高度

// ---------- 前 10 关：手工教学关 ----------
const HANDMADE = [
  { name: '开胃菜', Theme: 'kitchen', MoveCount: 7, Table: { w: 6 },
    Entities: [...wall('box', 0, 3, 3)] },

  { name: '罐头塔', Theme: 'kitchen', MoveCount: 8, Table: { w: 6.5 },
    Entities: [...pyramid('drum', 0, 5)] },

  { name: '叠叠乐', Theme: 'kitchen', MoveCount: 9, Table: { w: 7 },
    Entities: [...stack('slick', -2.4, 4), ...wall('box', 0, 2, 3), ...stack('disc', 2.4, 6), at('ball', 0, top('box', 3) + 0.4)] },

  { name: '重量级', Theme: 'drinks', MoveCount: 9, Table: { w: 7 },
    Entities: [...wall('heavy', -1.6, 2, 2), ...wall('box', 1.4, 3, 3), ...row('bottle', 1.4, 3, 0.95, top('box', 3)), ...row('jar', -1.6, 2, 1.0, top('heavy', 2))] },

  { name: '一点就炸', Theme: 'drinks', MoveCount: 6, Table: { w: 6.5 },
    Entities: [...wall('box', -1.53, 2, 2), at('boom', 0, H('boom') / 2), at('box', 0, 1 + H('box') / 2 - 0.02), ...wall('box', 1.53, 2, 2)] },

  { name: '高架桥', Theme: 'drinks', MoveCount: 9, Table: { w: 7.5 },
    Entities: [
      ...stack('pillar', -2.6, 1), ...stack('pillar', 0, 1), ...stack('pillar', 2.6, 1),
      at('plank', -1.3, 2 + 0.13 + GAP), at('plank', 1.3, 2 + 0.13 + GAP),
      ...row('jar', -1.3, 2, 1.0, 2.26 + GAP * 2), ...row('jar', 1.3, 2, 1.0, 2.26 + GAP * 2),
      ...row('bottle', -1.3, 2, 0.9), ...row('bottle', 1.3, 2, 0.9),
    ] },

  { name: '移动挡板', Theme: 'bakery', MoveCount: 8, Table: { w: 6.5 },
    Entities: [...wall('box', 0, 4, 3), at('slider', -3.0, 2.2, { amp: 1.2, cycle: 2.4 })] },

  { name: '下午茶', Theme: 'bakery', MoveCount: 9, Table: { w: 7.5 },
    Entities: [...pyramid('drum', -1.7, 4), ...pyramid('jar', 2.2, 3), at('boom', 0.6, H('boom') / 2), at('ball', 2.2, top('jar', 3) + 0.4)] },

  { name: '甜品城堡', Theme: 'bakery', MoveCount: 10, Table: { w: 8 },
    Entities: [
      ...stack('heavy', -2.5, 3), ...stack('heavy', 2.5, 3),
      ...wall('box', 0, 4, 2), ...pyramid('drum', 0, 3, top('box', 2)),
      at('jar', -2.5, top('heavy', 3) + H('jar') / 2), at('jar', 2.5, top('heavy', 3) + H('jar') / 2),
      ...stack('disc', -3.6, 4), ...stack('disc', 3.6, 4),
    ] },

  { name: '主厨挑战', Theme: 'bakery', MoveCount: 12, Table: { w: 9 },
    Entities: [
      ...wall('heavy', -3.2, 2, 3), ...wall('heavy', 3.2, 2, 3),
      ...wall('slick', 0, 3, 2), ...wall('box', 0, 3, 2, top('slick', 2)),
      at('boom', -3.2, top('heavy', 3) + H('boom') / 2), at('boom', 3.2, top('heavy', 3) + H('boom') / 2),
      ...pyramid('jar', 0, 2, top('slick', 2) + top('box', 2)),
      at('wall', -4.4, 0.4), at('slider', -4.4, 2.9, { amp: 1.3, cycle: 2.8 }),
    ] },
];

// ---------- 关卡生成器：第 11 关起按"槽位 + 积木模块"拼装 ----------
// 同一个关号永远生成同一关（种子 = 关号），可复现、可被机器人逐关校准
export const THEME_CYCLE = ['kitchen', 'drinks', 'bakery'];
const NAMES = {
  kitchen: ['番茄派对', '酱料阵', '厨房乱炖', '罐头山', '砧板风云', '辣味大挑战', '主厨的桌子', '番茄雨', '调料架', '晚餐时间'],
  drinks: ['气泡时间', '冰镇一夏', '汽水阵', '果汁吧台', '摇一摇', '冰块城', '柠檬派对', '饮料柜', '吸管高塔', '夏日畅饮'],
  bakery: ['下午茶', '面包山', '蛋挞塔', '奶油风暴', '甜点柜', '巧克力堡', '烤箱时间', '杯子蛋糕', '法棍桥', '甜品盛宴'],
};
function seeded(n) {
  let s = (n * 2654435761) % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
// 每个模块：fit(sw, r, hard) → { w: 占用宽度, make(cx) → 物件列表 }
const MODULES = [
  { id: 'wall', min: 1, fit: (sw, r, hard) => {
    const cols = Math.max(2, Math.min(4, Math.floor(sw)));
    const rows = 2 + Math.floor(r() * 3);
    const type = hard && r() < 0.6 ? 'heavy' : r() < 0.25 ? 'slick' : 'box';
    const crown = r() < 0.5 ? 'jar' : 'bottle';
    return { w: cols, make: (cx) => [...wall(type, cx, cols, rows), ...row(crown, cx, cols, 1.02, top(type, rows))] };
  } },
  { id: 'towers', min: 1, fit: (sw, r, hard) => {
    const h = 3 + Math.floor(r() * 3), type = hard && r() < 0.5 ? 'slick' : 'box';
    return { w: 2.4, make: (cx) => [...stack(type, cx - 0.7, h), ...stack(type, cx + 0.7, h), at('ball', cx - 0.7, top(type, h) + 0.4)] };
  } },
  { id: 'drumPyr', min: 1, fit: (sw) => {
    const base = Math.max(2, Math.min(5, Math.floor(sw / 0.79)));
    return { w: base * 0.79, make: (cx) => pyramid('drum', cx, base) };
  } },
  { id: 'jarPyr', min: 12, fit: (sw) => {
    const base = Math.max(2, Math.min(5, Math.floor(sw / 0.67)));
    return { w: base * 0.67, make: (cx) => pyramid('jar', cx, base) };
  } },
  { id: 'bottles', min: 15, fit: (sw) => {
    const n = Math.max(2, Math.min(5, Math.floor(sw / 0.8)));
    return { w: n * 0.8, make: (cx) => [...row('bottle', cx, n, 0.8), ...row('plank', cx, 1, 0, H('bottle') + GAP), ...row('bottle', cx, Math.max(1, n - 2), 0.8, H('bottle') + 0.26 + GAP * 2)] };
  } },
  { id: 'discs', min: 18, fit: (sw, r) => {
    const h = 4 + Math.floor(r() * 4);
    return { w: 2.0, make: (cx) => [...stack('disc', cx - 0.5, h), ...stack('disc', cx + 0.5, h)] };
  } },
  { id: 'bridge', min: 22, fit: () => ({ w: 3.2, make: (cx) => [
    ...stack('pillar', cx - 1.2, 1), ...stack('pillar', cx + 1.2, 1),
    at('plank', cx, 2 + 0.13 + GAP), ...row('jar', cx, 2, 1.1, 2.26 + GAP * 2), at('drum', cx, H('drum') / 2),
  ] }) },
  { id: 'castle', min: 26, fit: () => ({ w: 3.2, make: (cx) => [
    ...stack('heavy', cx - 1.1, 3), ...stack('heavy', cx + 1.1, 3), ...stack('box', cx, 2),
    at('drum', cx, top('box', 2) + H('drum') / 2),
    at('bottle', cx - 1.1, top('heavy', 3) + H('bottle') / 2), at('bottle', cx + 1.1, top('heavy', 3) + H('bottle') / 2),
  ] }) },
  { id: 'boomCore', min: 9, fit: () => ({ w: 3.2, make: (cx) => [
    ...wall('box', cx - 1.04, 1, 2), at('boom', cx, H('boom') / 2), at('box', cx, 1 + H('box') / 2 - 0.02), ...wall('box', cx + 1.04, 1, 2),
  ] }) },
  { id: 'fruit', min: 14, fit: (sw) => {
    const n = Math.max(2, Math.min(4, Math.floor(sw / 1.05)));
    return { w: n * 1.05, make: (cx) => [...wall('box', cx, n, 1), ...row('ball', cx, n, 1.02, 1 + GAP), ...row('ball', cx, Math.max(1, n - 1), 1.02, 1.8 + GAP)] };
  } },
];

function genLevel(n) {
  const r = seeded(n);
  const diff = difficultyOf(n);
  const hard = diff > 0;
  const theme = THEME_CYCLE[Math.floor((n - 1) / 10) % 3];
  const slots = n < 20 ? 2 : r() < 0.5 ? 3 : 2;
  const width = slots === 3 ? 9 : 7;
  const sw = width / slots - 0.4;
  const pool = MODULES.filter((m) => m.min <= n);
  const ents = [];
  for (let s = 0; s < slots; s++) {
    const cx = (s - (slots - 1) / 2) * (width / slots);
    let m = pool[Math.floor(r() * pool.length)];
    if (m.id === 'boomCore' && ents.some((e) => e.Id === 'boom')) m = pool[0];
    let mod = m.fit(sw, r, hard);
    if (mod.w > sw + 0.5) mod = MODULES[0].fit(sw, r, hard);   // 放不下就退回一面墙
    ents.push(...mod.make(cx));
  }
  // 困难关：桌面左缘一块挡板（只挡下半截，学 Royal 的 Blocker）；超难关：桌子左上方一块上下移动的挡板
  if (diff === 1 && n >= 24) ents.push(at('wall', -width / 2 + 0.2, 0.4));   // 立在桌面左缘，挡住下半截
  if (diff === 2) ents.push(at('slider', -width / 2 + 0.25, 2.4 + r() * 0.6, { amp: 1.1 + r() * 0.4, cycle: 2.2 + r() * 1.2 }));
  // 挡板那一列清空，避免开局物件和挡板重叠被弹飞
  for (const b of ents.filter((e) => ARCH[e.Id].counted === false)) {
    for (let k = ents.length - 1; k >= 0; k--) {
      const e = ents[k];
      if (e !== b && ARCH[e.Id].counted !== false && Math.abs(e.x - b.x) < W(e.Id) / 2 + W(b.Id) / 2 + 0.15) ents.splice(k, 1);
    }
  }
  const counted = ents.filter((e) => ARCH[e.Id].counted !== false).length;
  let shots = Math.ceil(counted * 0.28) + 3;            // Royal 中位数 ≈ 物件数 × 0.28
  if (n <= 30) shots += 2;                               // Angry 前 30 关蜜月期多给
  shots = Math.max(6, Math.min(18, shots - diff));
  return { name: NAMES[theme][(n - 1) % 10], Theme: theme, MoveCount: shots, Table: { w: width }, Entities: ents, Generated: true };
}

// 机器人校准后的炮弹数覆盖（关号 → 炮弹数）；2D 物理改版后需要重新校准，先清空
export const SHOT_OVERRIDES = {};

export const LEVELS = [...HANDMADE];
for (let n = HANDMADE.length + 1; n <= 100; n++) {
  const lv = genLevel(n);
  if (SHOT_OVERRIDES[n]) lv.MoveCount = SHOT_OVERRIDES[n];
  LEVELS.push(lv);
}
