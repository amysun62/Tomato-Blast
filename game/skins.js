import * as THREE from 'three';

// 主题层：同一个碰撞原型（levels.js 的 ARCH）在不同章节画成不同食物
// 贴图全部用 canvas 程序化画，原创、零外部素材；以后换成美术出的贴图只改这一个文件

export function tex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}
// 环境贴图只当高光反射用，强度减半，否则整体发白
export const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.6, envMapIntensity: 0.5, ...o });
const css = (n) => '#' + n.toString(16).padStart(6, '0');

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export function drawTomato(g, x, y, r) {
  g.fillStyle = '#e5372b'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, r * 0.28, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3daa5c';
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.25, y - r * 0.85 + Math.sin(a) * r * 0.12, r * 0.28, r * 0.1, a, 0, Math.PI * 2); g.fill();
  }
}
function label(g, text, x, y, size, color) {
  g.fillStyle = color; g.font = `bold ${size}px "Lilita One", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, x, y);
}
const dots = (g, w, h, colors, n, r) => {
  for (let k = 0; k < n; k++) { g.fillStyle = colors[k % colors.length]; g.beginPath(); g.arc(rand() * w, rand() * h, r * (0.6 + rand() * 0.6), 0, Math.PI * 2); g.fill(); }
};

// 方块：一张图贴六面
const boxSkin = (opts, draw) => std({ ...opts, map: draw ? tex(128, 128, draw) : undefined });

// 圆柱：侧面画一条标签带，顶/底是盖子 → [侧面, 顶, 底]（对应 CylinderGeometry 的 3 个材质组）
function cylSkin({ body, band, from = 0.32, to = 0.68, text, textColor, cap, bottom, top, rough = 0.4, metal = 0, deco }) {
  const side = std({ roughness: rough, metalness: metal, map: tex(256, 128, (g, w, h) => {
    g.fillStyle = css(body); g.fillRect(0, 0, w, h);
    if (band != null) { g.fillStyle = css(band); g.fillRect(0, h * from, w, h * (to - from)); }
    if (deco) deco(g, w, h);
    if (text) for (const cx of [w * 0.25, w * 0.75]) label(g, text, cx, h * (from + to) / 2, 24, css(textColor));
  }) });
  side.userData.body = body;   // 细节模型（瓶颈、罐边）要用纯色版本
  const topMat = top || std({ color: cap ?? body, roughness: 0.4, metalness: metal });
  return [side, topMat, std({ color: bottom ?? cap ?? body, roughness: 0.5 })];
}

// 格子布：正红白格（之前半透明粉格看着发灰）；交叉处自然更深，织物感
export const gingham = (rx, ry, color = 'rgba(214,28,18,.72)') => tex(128, 128, (g, w) => {
  g.fillStyle = '#fffaf2'; g.fillRect(0, 0, w, w);
  g.fillStyle = color;
  for (let i = 0; i < 4; i += 2) { g.fillRect(i * 32, 0, 32, w); g.fillRect(0, i * 32, w, 32); }
}, rx, ry);

const iceMat = () => std({ color: 0xbfe9ff, transparent: true, opacity: 0.72, roughness: 0.05, metalness: 0.1, emissive: 0x2a6c8a, emissiveIntensity: 0.25 });
const trayMat = () => std({ color: 0xc3ccd3, metalness: 0.6, roughness: 0.3 });
const sliderMat = () => std({ roughness: 0.5, map: tex(128, 128, (g, w) => {
  g.fillStyle = '#fff1d6'; g.fillRect(0, 0, w, w);
  g.fillStyle = '#e5372b';
  for (let k = -w; k < w * 2; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 16, 0); g.lineTo(k + 16 - w, w); g.lineTo(k - w, w); g.fill(); }
}) });

// 每个皮肤：name 显示名；make(i) 返回材质（i = 物件序号，用来做口味变体）；variants 变体数
export const THEMES = {
  kitchen: {
    name: '番茄厨房',
    table: () => gingham(1, 1),
    boom: [0xe5372b, 0xff7a1a, 0xf6c33b, 0x9e1b12],
    skins: {
      box: { name: '木箱', make: () => boxSkin({ roughness: 0.8 }, (g, w) => {
        g.fillStyle = '#c98a4b'; g.fillRect(0, 0, w, w);
        g.fillStyle = '#8f5a2b'; for (let k = 1; k < 4; k++) g.fillRect(0, k * 32 - 2, w, 4);
        g.lineWidth = 10; g.strokeStyle = '#a86c35'; g.strokeRect(5, 5, w - 10, w - 10);
        drawTomato(g, w / 2, w / 2 + 4, 18);
      }) },
      heavy: { name: '奶酪块', make: () => boxSkin({ roughness: 0.55 }, (g, w) => {
        g.fillStyle = '#f7c948'; g.fillRect(0, 0, w, w);
        dots(g, w, w, ['#e0a92a'], 9, 9);
      }) },
      slick: { name: '冰块', make: iceMat },
      boom: { name: '辣椒罐', make: () => cylSkin({ body: 0x9e1b12, band: 0xf6c33b, from: 0.3, to: 0.72, text: 'HOT', textColor: 0x9e1b12, cap: 0x4a1410, metal: 0.3,
        deco: (g, w, h) => { g.fillStyle = '#2b0d09'; for (let x = 0; x < w; x += 24) { g.fillRect(x, 0, 12, 8); g.fillRect(x + 12, h - 8, 12, 8); } } }) },
      plank: { name: '砧板', make: () => boxSkin({ roughness: 0.7 }, (g, w) => {
        g.fillStyle = '#e2b980'; g.fillRect(0, 0, w, w);
        g.strokeStyle = 'rgba(160,110,60,.5)'; g.lineWidth = 2;
        for (let k = 0; k < 8; k++) { const y = rand() * w; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y); g.stroke(); }
      }) },
      pillar: { name: '胡椒磨', make: () => cylSkin({ body: 0x6b3f22, cap: 0xc9c9cf, metal: 0.1,
        deco: (g, w, h) => { g.fillStyle = '#8c5a33'; for (const y of [0.15, 0.5, 0.85]) g.fillRect(0, h * y - 6, w, 12); } }) },
      drum: { name: '番茄罐头', make: () => cylSkin({ body: 0xcfd3d8, band: 0xd8352a, from: 0.14, to: 0.86, cap: 0xcfd3d8, metal: 0.3,
        deco: (g, w, h) => { for (const cx of [w * 0.2, w * 0.7]) { g.fillStyle = '#fff1d6'; g.beginPath(); g.arc(cx, h / 2, 26, 0, 7); g.fill(); drawTomato(g, cx, h / 2 + 3, 17); } } }) },
      bottle: { name: '番茄酱', make: () => cylSkin({ body: 0xd0241a, band: 0xfff1d6, from: 0.42, to: 0.68, cap: 0xfff1d6, rough: 0.3,
        deco: (g, w, h) => { drawTomato(g, w * 0.3, h * 0.55, 13); drawTomato(g, w * 0.8, h * 0.55, 13); } }) },
      jar: { name: '果酱罐', variants: 3, make: (i) => {
        const c = [0xc8203a, 0x6e2a8c, 0xf08a24][i % 3];
        return cylSkin({ body: c, band: 0xfff1d6, from: 0.35, to: 0.69, rough: 0.15, top: std({ map: gingham(0.5, 0.5), roughness: 0.7 }),
          deco: (g, w, h) => { g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(w * 0.05, 0, 14, h); } });
      } },
      disc: { name: '番茄片', make: () => cylSkin({ body: 0xd8352a, rough: 0.3, top: std({ roughness: 0.3, map: tex(128, 128, (g, w) => {
        g.fillStyle = '#d8352a'; g.fillRect(0, 0, w, w);
        g.fillStyle = '#ff7a6b'; g.beginPath(); g.arc(w / 2, w / 2, w * 0.4, 0, 7); g.fill();
        g.fillStyle = '#f6c33b'; for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.28; g.beginPath(); g.ellipse(w / 2 + Math.cos(a) * 26, w / 2 + Math.sin(a) * 26, 7, 4, a, 0, 7); g.fill(); }
      }) }) }) },
      wall: { name: '托盘挡板', make: trayMat },
      slider: { name: '移动托盘', make: sliderMat },
    },
  },

  drinks: {
    name: '饮料吧',
    table: () => gingham(1, 1, 'rgba(30,110,220,.68)'),
    boom: [0x5a1e14, 0xfff1d6, 0xffffff, 0xe5372b],
    skins: {
      box: { name: '汽水箱', make: () => boxSkin({ roughness: 0.45 }, (g, w) => {
        g.fillStyle = '#2f7de1'; g.fillRect(0, 0, w, w);
        g.fillStyle = '#1d5bb0'; for (let x = 0; x < 3; x++) g.fillRect(14 + x * 36, 52, 26, 52);
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, 10); g.fillRect(0, w - 10, w, 10);
        label(g, 'SODA', w / 2, 30, 30, '#ffffff');
      }) },
      heavy: { name: '整箱矿泉水', make: () => boxSkin({ roughness: 0.2 }, (g, w) => {
        g.fillStyle = '#d9f1ff'; g.fillRect(0, 0, w, w);
        for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) { g.fillStyle = '#3aa0e8'; g.beginPath(); g.arc(22 + x * 42, 22 + y * 42, 15, 0, 7); g.fill(); }
        g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, 20, w, 8);
      }) },
      slick: { name: '冰块', make: iceMat },
      boom: { name: '摇过的可乐', make: () => cylSkin({ body: 0x5a1e14, band: 0xe5372b, from: 0.3, to: 0.7, text: 'SHAKE!', textColor: 0xffffff, cap: 0xcfd3d8, metal: 0.4 }) },
      plank: { name: '吧台托盘', make: trayMat },
      pillar: { name: '奶昔杯', make: () => cylSkin({ body: 0xff8fb1, cap: 0xffffff, rough: 0.3,
        deco: (g, w, h) => { g.fillStyle = '#ffffff'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 12, h); } }) },
      drum: { name: '易拉罐', variants: 3, make: (i) => {
        const c = [0x8bd346, 0xff9f1c, 0x8e5bd6][i % 3];
        return cylSkin({ body: c, band: 0xffffff, from: 0.4, to: 0.6, text: 'FIZZ', textColor: c, cap: 0xcfd3d8, metal: 0.5, rough: 0.25 });
      } },
      bottle: { name: '汽水瓶', make: () => cylSkin({ body: 0x3fae6a, band: 0xfff1d6, from: 0.45, to: 0.7, text: 'POP', textColor: 0x3fae6a, cap: 0xe5372b, rough: 0.1, metal: 0.1 }) },
      jar: { name: '果汁杯', variants: 3, make: (i) => {
        const c = [0xff9f1c, 0x7b3fa0, 0x8bd346][i % 3];
        return cylSkin({ body: c, cap: 0xffffff, rough: 0.15,
          deco: (g, w, h) => { g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, 0, w, h * 0.12); g.fillRect(w * 0.1, 0, 10, h); } });
      } },
      disc: { name: '柠檬片', make: () => cylSkin({ body: 0xf6d13b, rough: 0.3, top: std({ roughness: 0.3, map: tex(128, 128, (g, w) => {
        g.fillStyle = '#f6d13b'; g.fillRect(0, 0, w, w);
        g.fillStyle = '#fff6b0'; g.beginPath(); g.arc(w / 2, w / 2, w * 0.42, 0, 7); g.fill();
        g.fillStyle = '#ffe14d'; for (let k = 0; k < 8; k++) { g.beginPath(); g.moveTo(w / 2, w / 2); g.arc(w / 2, w / 2, w * 0.38, (k / 8) * 6.28 + 0.06, ((k + 1) / 8) * 6.28 - 0.06); g.fill(); }
      }) }) }) },
      wall: { name: '冰柜门', make: trayMat },
      slider: { name: '移动托盘', make: sliderMat },
    },
  },

  bakery: {
    name: '烘焙坊',
    table: () => gingham(1, 1, 'rgba(240,100,150,.66)'),
    boom: [0xffffff, 0xff8fb1, 0xfff1d6, 0xe5372b],
    skins: {
      box: { name: '吐司', make: () => boxSkin({ roughness: 0.85 }, (g, w) => {
        g.fillStyle = '#b97a35'; g.fillRect(0, 0, w, w);
        g.fillStyle = '#f2d49b'; g.beginPath(); g.roundRect(12, 18, w - 24, w - 30, 18); g.fill();
        dots(g, w, w, ['rgba(185,122,53,.35)'], 14, 3);
      }) },
      heavy: { name: '巧克力砖', make: () => boxSkin({ roughness: 0.35 }, (g, w) => {
        g.fillStyle = '#4a2a18'; g.fillRect(0, 0, w, w);
        g.fillStyle = '#6b3f22'; for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) g.fillRect(8 + x * 60, 8 + y * 60, 52, 52);
      }) },
      slick: { name: '黄油块', make: () => std({ color: 0xffe9a3, roughness: 0.12, emissive: 0x5a4a10, emissiveIntensity: 0.15 }) },
      boom: { name: '奶油喷罐', make: () => cylSkin({ body: 0xfafafa, band: 0xff8fb1, from: 0.3, to: 0.7, text: 'CREAM', textColor: 0xffffff, cap: 0xe5372b, metal: 0.3 }) },
      plank: { name: '法棍', make: () => boxSkin({ roughness: 0.8 }, (g, w) => {
        g.fillStyle = '#d99a4e'; g.fillRect(0, 0, w, w);
        g.strokeStyle = '#f2cf8f'; g.lineWidth = 6;
        for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, w * 0.7); g.lineTo(x + 22, w * 0.3); g.stroke(); }
      }) },
      pillar: { name: '擀面杖', make: () => cylSkin({ body: 0xe2b980, cap: 0xb98a55, rough: 0.6 }) },
      drum: { name: '小蛋糕', variants: 2, make: (i) => cylSkin({ body: 0xf3d29b, rough: 0.6,
        top: std({ color: [0xff9ec0, 0x8b4a2b][i % 2], roughness: 0.4 }),
        deco: (g, w, h) => { g.fillStyle = '#fff1d6'; g.fillRect(0, h * 0.45, w, h * 0.12); g.fillStyle = ['#ff9ec0', '#8b4a2b'][i % 2]; g.fillRect(0, 0, w, h * 0.16); } }) },
      bottle: { name: '牛奶瓶', make: () => cylSkin({ body: 0xffffff, band: 0x3a7bd5, from: 0.45, to: 0.65, text: 'MILK', textColor: 0xffffff, cap: 0x3a7bd5, rough: 0.2 }) },
      jar: { name: '纸杯蛋糕', variants: 3, make: (i) => {
        const cup = [0xff8fb1, 0x7fd6c8, 0xf6c33b][i % 3];
        return cylSkin({ body: cup, rough: 0.6, top: std({ color: 0xfff1d6, roughness: 0.5 }),
          deco: (g, w, h) => { g.fillStyle = 'rgba(0,0,0,.12)'; for (let x = 0; x < w; x += 16) g.fillRect(x, h * 0.3, 6, h); g.fillStyle = '#fff1d6'; g.fillRect(0, 0, w, h * 0.3); } });
      } },
      disc: { name: '蛋挞', make: () => cylSkin({ body: 0xe3a64f, rough: 0.6,
        deco: (g, w) => { g.fillStyle = '#c98a3a'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 6, 128); },
        top: std({ roughness: 0.35, map: tex(128, 128, (g, w) => {
          g.fillStyle = '#e3a64f'; g.fillRect(0, 0, w, w);
          g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(w / 2, w / 2, w * 0.4, 0, 7); g.fill();
          dots(g, w, w, ['rgba(160,80,20,.5)'], 6, 6);
        }) }) }) },
      wall: { name: '烤盘', make: trayMat },
      slider: { name: '移动托盘', make: sliderMat },
    },
  },
};

// ---------- AI 生成的贴图（assets/tex/<主题>_<原型>[_side|_top][_变体].jpg），有就覆盖代码画的 ----------
// 命名规则见 assets/tex 目录；没有对应文件的部位继续用上面的程序化材质
const AI_TEX = new Set([
  'kitchen_box', 'kitchen_heavy', 'kitchen_plank', 'kitchen_boom_side', 'kitchen_pillar_side', 'kitchen_drum_side',
  'kitchen_bottle_side', 'kitchen_jar_side_0', 'kitchen_jar_side_1', 'kitchen_jar_side_2', 'kitchen_disc_top',
  'drinks_box', 'drinks_heavy', 'drinks_boom_side', 'drinks_pillar_side', 'drinks_drum_side_0', 'drinks_drum_side_1',
  'drinks_drum_side_2', 'drinks_bottle_side', 'drinks_jar_side_0', 'drinks_jar_side_1', 'drinks_jar_side_2', 'drinks_disc_top',
  'bakery_box', 'bakery_heavy', 'bakery_plank', 'bakery_boom_side', 'bakery_pillar_side', 'bakery_drum_side', 'bakery_drum_top',
  'bakery_bottle_side', 'bakery_jar_side_0', 'bakery_jar_side_1', 'bakery_jar_side_2', 'bakery_jar_top', 'bakery_disc_top', 'bakery_disc_side',
]);
// 侧面贴图是 16:9，按圆柱"周长/高度"决定绕几圈，避免标签被拉得太宽
const WRAP = { boom: 2, pillar: 1, drum: 2, bottle: 1, jar: 2, disc: 4 };
// 罐头、瓶子、喷罐这类包装要有清漆高光（学海报的光泽感）；面包蛋糕不要
const GLOSSY = { boom: true, drum: true, bottle: true, jar: true };

const loader = new THREE.TextureLoader();
const imgCache = {};
let maxAniso = 8;
export function setMaxAnisotropy(n) { maxAniso = n; }
function imgTex(name, rx = 1) {
  const k = name + ':' + rx;
  if (!imgCache[k]) {
    const t = loader.load(`assets/tex/${name}.jpg`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, 1);
    t.anisotropy = maxAniso;
    imgCache[k] = t;
  }
  return imgCache[k];
}
// 同一原型的多个变体轮着用：有 _0/_1/_2 就按序号取，没有就用不带序号的
function pick(base, i) {
  const variants = [0, 1, 2].filter((v) => AI_TEX.has(`${base}_${v}`));
  if (variants.length) return `${base}_${variants[i % variants.length]}`;
  return AI_TEX.has(base) ? base : null;
}

function withAiTex(theme, id, i, proc) {
  const pre = `${theme}_${id}`;
  if (!Array.isArray(proc)) {
    const name = pick(pre, i);
    if (!name) return proc;
    return std({ map: imgTex(name), roughness: proc.roughness, metalness: proc.metalness });
  }
  let [side, top, bottom] = proc;
  const sideName = pick(`${pre}_side`, i);
  if (sideName) {
    const body = side.userData.body;
    side = GLOSSY[id] && theme !== 'bakery'
      ? new THREE.MeshPhysicalMaterial({ map: imgTex(sideName, WRAP[id] ?? 1), roughness: 0.3, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 0.6 })
      : std({ map: imgTex(sideName, WRAP[id] ?? 1), roughness: 0.55 });
    side.userData.body = body;
  }
  const topName = pick(`${pre}_top`, i);
  if (topName) top = std({ map: imgTex(topName), roughness: 0.35 });
  return [side, top, bottom];
}

const cache = {};
export function skinFor(theme, id, i) {
  const t = THEMES[theme] || THEMES.kitchen;
  const s = t.skins[id];
  if (!s) return { name: id, mat: std({ color: 0xff00ff }) };
  const key = `${theme}:${id}:${i % 3}`;
  cache[key] ??= withAiTex(theme, id, i, s.make(i));
  return { name: s.name, mat: cache[key] };
}
