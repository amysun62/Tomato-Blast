// 关卡数据：格式参照拆包看到的 Royal Smash（MoveCount + Entities[{Id, Position, Custom}]）
// 坐标单位 = 米；桌面上表面高度固定为 TABLE_TOP；物件 Position 是几何中心
//
// 两层分离（学 Angry Smash：关卡里是 box_m_1x1 这类几何积木 + 单独的 skin 字段）：
//   原型层 ARCH：碰撞形状、质量、材质手感 —— 固定，像乐高积木，关卡只用它
//   主题层 skins.js：同一个原型在不同章节画成不同食物 —— 可以无限发散
export const TABLE_TOP = 2;

export const ARCH = {
  box:    { role: '轻方块', shape: 'box', size: [1, 1, 1], mass: 1.0, mat: 'wood' },
  heavy:  { role: '重方块', shape: 'box', size: [1, 1, 1], mass: 3.5, mat: 'stone' },
  slick:  { role: '滑方块', shape: 'box', size: [1, 1, 1], mass: 0.8, mat: 'ice' },
  boom:   { role: '会爆的罐', shape: 'cyl', r: [0.42, 0.42], h: 0.95, mass: 1.0, mat: 'metal', explosive: true },
  plank:  { role: '长板', shape: 'box', size: [2.6, 0.25, 1], mass: 1.2, mat: 'wood' },
  pillar: { role: '高柱', shape: 'cyl', r: [0.26, 0.3], h: 2, mass: 1.6, mat: 'wood' },
  drum:   { role: '中圆柱', shape: 'cyl', r: [0.38, 0.38], h: 0.8, mass: 0.5, mat: 'metal' },
  bottle: { role: '细高瓶', shape: 'cyl', r: [0.17, 0.27], h: 1.1, mass: 0.35, mat: 'plastic' },
  jar:    { role: '矮圆柱', shape: 'cyl', r: [0.32, 0.32], h: 0.7, mass: 0.6, mat: 'metal' },
  disc:   { role: '扁圆片', shape: 'cyl', r: [0.42, 0.42], h: 0.3, mass: 0.3, mat: 'plastic' },
  wall:   { role: '固定挡板', shape: 'box', size: [3, 2, 0.3], mat: 'stone', body: 'static', counted: false },
  slider: { role: '移动挡板', shape: 'box', size: [2.4, 1.6, 0.3], mat: 'stone', body: 'kinematic', counted: false },
};

// 难度节奏：照搬拆包结论——每 10 关一循环，x4/x7 = 困难，x0 = 超难
export function difficultyOf(n) {
  if (n % 10 === 0) return 2;
  if (n % 10 === 4 || n % 10 === 7) return 1;
  return 0;
}

const heightOf = (t) => (ARCH[t].shape === 'box' ? ARCH[t].size[1] : ARCH[t].h);
const widthOf = (t) => (ARCH[t].shape === 'box' ? ARCH[t].size[0] : Math.max(...ARCH[t].r) * 2);
const GAP = 0.002;

// 竖直叠一摞
function stack(type, x, z, n, base = TABLE_TOP) {
  const h = heightOf(type);
  return Array.from({ length: n }, (_, i) => ({ Id: type, Position: { x, y: base + h / 2 + i * (h + GAP), z } }));
}

// 一面墙：以 cx 为中心，cols 列 rows 层
function wall(type, cx, z, cols, rows, base = TABLE_TOP) {
  const w = widthOf(type) + GAP;
  const out = [];
  for (let c = 0; c < cols; c++) out.push(...stack(type, cx + (c - (cols - 1) / 2) * w, z, rows, base));
  return out;
}

// 沿 x 方向的金字塔
function pyramid(type, cx, z, base, baseY = TABLE_TOP) {
  const w = widthOf(type) + 0.02;
  const h = heightOf(type);
  const out = [];
  for (let row = 0; row < base; row++) {
    const n = base - row;
    for (let i = 0; i < n; i++) {
      out.push({ Id: type, Position: { x: cx + (i - (n - 1) / 2) * w, y: baseY + h / 2 + row * (h + GAP), z } });
    }
  }
  return out;
}

// 细高瓶摆成保龄球三角阵（铺在桌面上，尖朝大炮）
function bowling(cx, cz, rows, baseY = TABLE_TOP) {
  const s = 0.58;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i <= r; i++) {
      out.push({ Id: 'bottle', Position: { x: cx + (i - r / 2) * s, y: baseY + heightOf('bottle') / 2, z: cz - r * s } });
    }
  }
  return out;
}

const at = (Id, x, y, z, Custom) => ({ Id, Position: { x, y, z }, ...(Custom ? { Custom } : {}) });

// 章节：每章一个食物主题（Theme 对应 skins.js 里的主题 id）
// 步数参考：Royal 中位数约为物件数的 0.28 倍；原型关卡物件更少，所以给得宽一些
const HANDMADE = [
  { name: '开胃菜', Theme: 'kitchen', MoveCount: 8, Table: { w: 6, d: 3 },
    Entities: [...wall('box', 0, 0, 3, 3)] },

  { name: '罐头塔', Theme: 'kitchen', MoveCount: 9, Table: { w: 8, d: 3 },
    Entities: [...pyramid('drum', -2, 0, 4), ...pyramid('drum', 2, 0, 4)] },

  { name: '叠叠乐', Theme: 'kitchen', MoveCount: 9, Table: { w: 7, d: 3 },
    Entities: [...stack('slick', -2, 0, 4), ...stack('slick', 2, 0, 4), ...wall('box', 0, -0.6, 2, 3), ...stack('disc', 0, 0.9, 6)] },

  { name: '重量级', Theme: 'drinks', MoveCount: 9, Table: { w: 7, d: 4 },
    Entities: [...wall('heavy', 0, 1, 4, 2), ...wall('box', 0, -0.6, 4, 3), ...pyramid('bottle', 0, -0.6, 3, TABLE_TOP + 3.004)] },

  { name: '一点就炸', Theme: 'drinks', MoveCount: 6, Table: { w: 6, d: 4 },
    Entities: (() => {
      const e = [];
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
        e.push(x === 0 && z === 0 ? at('boom', 0, TABLE_TOP + 0.476, 0) : at('box', x * 1.002, TABLE_TOP + 0.5, z * 1.002));
        e.push(at('box', x * 1.002, TABLE_TOP + 1.502, z * 1.002));
      }
      return e;
    })() },

  { name: '高架桥', Theme: 'drinks', MoveCount: 10, Table: { w: 8, d: 3.6 },
    Entities: [
      ...stack('pillar', -2.6, 0.5, 1), ...stack('pillar', 0, 0.5, 1), ...stack('pillar', 2.6, 0.5, 1),
      at('plank', -1.3, TABLE_TOP + 2.127, 0.5), at('plank', 1.3, TABLE_TOP + 2.127, 0.5),
      at('jar', -1.9, TABLE_TOP + 2.604, 0.5), at('jar', -0.7, TABLE_TOP + 2.604, 0.5),
      at('jar', 0.7, TABLE_TOP + 2.604, 0.5), at('jar', 1.9, TABLE_TOP + 2.604, 0.5),
      ...bowling(0, -0.3, 3),
    ] },

  { name: '移动挡板', Theme: 'bakery', MoveCount: 9, Table: { w: 7, d: 3 },
    Entities: [
      ...wall('box', 0, 0, 4, 3),
      at('slider', 0, TABLE_TOP + 1.6, 3.2, { moveX: 2.6, cycle: 2.6 }),
    ] },

  { name: '圆桌下午茶', Theme: 'bakery', MoveCount: 10, Table: { shape: 'round', r: 3.2 },
    Entities: [...pyramid('drum', 0, 0.8, 4), ...pyramid('jar', 0, -0.8, 3), at('boom', 0, TABLE_TOP + 0.476, -2.1)] },

  { name: '甜品城堡', Theme: 'bakery', MoveCount: 11, Table: { w: 8, d: 4 },
    Entities: [
      ...wall('heavy', -2.5, 0.5, 1, 3), ...wall('heavy', 2.5, 0.5, 1, 3),
      ...wall('box', 0, 0.5, 4, 2), ...wall('slick', 0, -0.7, 3, 2),
      at('jar', -2.5, TABLE_TOP + 3.356, 0.5), at('jar', 2.5, TABLE_TOP + 3.356, 0.5),
      ...pyramid('drum', 0, 0.5, 3, TABLE_TOP + 2.004),
      ...stack('disc', -1.6, -1.5, 4), ...stack('disc', 1.6, -1.5, 4),
    ] },

  { name: '主厨挑战', Theme: 'bakery', MoveCount: 12, Table: { w: 9, d: 4 },
    Entities: [
      ...wall('heavy', -3, 0, 2, 3), ...wall('heavy', 3, 0, 2, 3),
      ...wall('slick', 0, 0.8, 3, 2), ...wall('box', 0, -0.6, 3, 4),
      at('boom', -3, TABLE_TOP + 3.483, 0), at('boom', 3, TABLE_TOP + 3.483, 0),
      ...pyramid('jar', 0, -0.6, 2, TABLE_TOP + 4.01),
      at('wall', -2.2, TABLE_TOP + 1, 3.0), at('wall', 2.2, TABLE_TOP + 1, 3.0),
      at('slider', 0, TABLE_TOP + 2.6, 3.6, { moveX: 3.2, cycle: 3.2 }),
    ] },
];

// ---------- 关卡生成器：第 11 关起按"槽位 + 积木模块"拼装 ----------
// 同一个关号永远生成同一关（种子 = 关号），所以关卡可复现、可被机器人逐关校准
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

// 每个模块：返回 { w: 占用宽度, make(cx, cz) → 物件列表 }；sw = 槽位可用宽度
const MODULES = [
  { id: 'wall', min: 1, fit: (sw, r, hard) => {
    const cols = Math.max(2, Math.min(4, Math.floor(sw)));
    const rows = 2 + Math.floor(r() * 3);
    const type = hard && r() < 0.6 ? 'heavy' : r() < 0.25 ? 'slick' : 'box';
    return { w: cols, make: (cx, cz) => wall(type, cx, cz, cols, rows) };
  } },
  { id: 'towers', min: 1, fit: (sw, r, hard) => {
    const h = 3 + Math.floor(r() * 3);
    const type = hard && r() < 0.5 ? 'slick' : 'box';
    return { w: 2.2, make: (cx, cz) => [...stack(type, cx - 0.6, cz, h), ...stack(type, cx + 0.6, cz, h)] };
  } },
  { id: 'drumPyr', min: 1, fit: (sw, r) => {
    const base = Math.max(2, Math.min(4, Math.floor(sw / 0.8)));
    return { w: base * 0.8, make: (cx, cz) => pyramid('drum', cx, cz, base) };
  } },
  { id: 'jarPyr', min: 12, fit: (sw, r) => {
    const base = Math.max(2, Math.min(4, Math.floor(sw / 0.66)));
    return { w: base * 0.66, make: (cx, cz) => pyramid('jar', cx, cz, base) };
  } },
  { id: 'bowling', min: 15, fit: (sw) => {
    const rows = Math.max(2, Math.min(4, Math.floor(sw / 0.58)));
    return { w: rows * 0.58, make: (cx, cz) => bowling(cx, cz + 0.6, rows) };
  } },
  { id: 'discs', min: 18, fit: (sw, r) => {
    const h = 4 + Math.floor(r() * 4);
    return { w: 1.9, make: (cx, cz) => [...stack('disc', cx - 0.45, cz, h), ...stack('disc', cx + 0.45, cz, h)] };
  } },
  { id: 'bridge', min: 22, fit: () => ({ w: 3.2, make: (cx, cz) => [
    ...stack('pillar', cx - 1.3, cz, 1), ...stack('pillar', cx + 1.3, cz, 1),
    at('plank', cx, TABLE_TOP + 2.127, cz),
    at('jar', cx - 0.6, TABLE_TOP + 2.604, cz), at('jar', cx + 0.6, TABLE_TOP + 2.604, cz),
  ] }) },
  { id: 'castle', min: 26, fit: (sw, r) => ({ w: 3, make: (cx, cz) => [
    ...stack('heavy', cx - 1, cz, 3), ...stack('heavy', cx + 1, cz, 3),
    ...stack('box', cx, cz, 2), at('drum', cx, TABLE_TOP + 2.402, cz),
    at('bottle', cx - 1, TABLE_TOP + 3.556, cz), at('bottle', cx + 1, TABLE_TOP + 3.556, cz),
  ] }) },
  { id: 'boomRing', min: 9, fit: () => ({ w: 3, make: (cx, cz) => {
    const e = [];
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
      e.push(x === 0 && z === 0 ? at('boom', cx, TABLE_TOP + 0.476, cz) : at('box', cx + x * 1.002, TABLE_TOP + 0.5, cz + z * 1.002));
    }
    return e;
  } }) },
];

function genLevel(n) {
  const r = seeded(n);
  const diff = difficultyOf(n);
  const hard = diff > 0;
  const theme = THEME_CYCLE[Math.floor((n - 1) / 10) % 3];
  const slots = n < 20 ? 2 : r() < 0.55 ? 3 : 2;
  const width = slots === 3 ? 9 : 7;
  const sw = width / slots - 0.3;
  const pool = MODULES.filter((m) => m.min <= n);
  const ents = [];
  for (let s = 0; s < slots; s++) {
    const cx = (s - (slots - 1) / 2) * (width / slots);
    let m = pool[Math.floor(r() * pool.length)];
    if (m.id === 'boomRing' && ents.some((e) => e.Id === 'boom')) m = pool[0];
    let mod = m.fit(sw, r, hard);
    if (mod.w > sw + 0.4) mod = MODULES[0].fit(sw, r, hard);   // 放不下就退回一面墙
    ents.push(...mod.make(cx, 0));
  }
  // 后排补一组（物件数随关卡缓慢上升）
  if (n >= 30 && r() < 0.6) ents.push(...wall('box', 0, -1.3, Math.min(3, slots + 1), 1 + Math.floor(r() * 2)));
  // 困难关：前排固定挡板；超难关：再加一块移动挡板（学 Royal 的 Blocker / 机关）
  // 挡板只挡最下面一排（顶边在桌面上方 1 米），上面的能直接打，否则整排被挡死、只能靠连带撞击
  if (diff === 1 && n >= 24) ents.push(at('wall', (r() < 0.5 ? -1 : 1) * width * 0.22, TABLE_TOP, 3.0));
  if (diff === 2) ents.push(at('slider', 0, TABLE_TOP + 1.6 + r() * 0.8, 3.3, { moveX: width * 0.35, cycle: 2.4 + r() * 1.2 }));
  if (n >= 13 && !ents.some((e) => e.Id === 'boom') && r() < 0.3) {
    const tops = ents.filter((e) => e.Id === 'box');
    if (tops.length) { const t = tops[Math.floor(r() * tops.length)]; t.Id = 'boom'; t.Position.y -= 0.024; }
  }
  const counted = ents.filter((e) => ARCH[e.Id].counted !== false).length;
  let shots = Math.ceil(counted * 0.28) + 3;          // Royal 中位数 ≈ 物件数 × 0.28
  if (n <= 30) shots += 2;                              // Angry 前 30 关蜜月期多给
  shots -= diff;                                        // 难关收紧
  shots = Math.max(6, Math.min(18, shots));
  return {
    name: NAMES[theme][(n - 1) % 10], Theme: theme, MoveCount: shots,
    Table: { w: width, d: 4 }, Entities: ents, Generated: true,
  };
}

// 机器人校准后的炮弹数覆盖（关号 → 炮弹数），由 calibrate 流程写入
// 2026-10-21 校准：机器人实际清台发数 + 余量（普通 +2，前 30 关 +3；困难 +1；超难 +0），上限 20
// 机器人 25 发内没清完的关（27 57 77 80 84 87 94）用公式值 +2
export const SHOT_OVERRIDES = {
  11: 11, 12: 12, 13: 10, 14: 12, 15: 7, 16: 15, 17: 9, 18: 11, 19: 9, 20: 11, 21: 14, 22: 14, 23: 9, 24: 20, 25: 10,
  26: 13, 27: 14, 28: 8, 29: 20, 30: 20, 31: 15, 32: 18, 33: 12, 34: 12, 35: 6, 36: 8, 37: 20, 38: 12, 39: 12, 40: 13,
  41: 14, 42: 10, 43: 8, 44: 11, 45: 10, 46: 13, 47: 13, 48: 12, 49: 8, 50: 19, 51: 12, 52: 13, 53: 13, 54: 10, 55: 11,
  56: 10, 57: 12, 58: 5, 59: 11, 60: 19, 61: 13, 62: 8, 63: 20, 64: 10, 65: 11, 66: 19, 67: 17, 68: 12, 69: 15, 70: 5,
  71: 13, 72: 14, 73: 15, 74: 7, 75: 9, 76: 16, 77: 12, 78: 12, 79: 17, 80: 11, 81: 13, 82: 8, 83: 8, 84: 10, 85: 15,
  86: 10, 87: 10, 88: 11, 89: 15, 90: 12, 91: 12, 92: 15, 93: 15, 94: 12, 95: 10, 96: 7, 97: 6, 98: 13, 99: 9, 100: 20,
};

export const LEVELS = [...HANDMADE];
for (let n = HANDMADE.length + 1; n <= 100; n++) {
  const lv = genLevel(n);
  if (SHOT_OVERRIDES[n]) lv.MoveCount = SHOT_OVERRIDES[n];
  LEVELS.push(lv);
}
