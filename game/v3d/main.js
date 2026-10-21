import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LEVELS, ARCH, TABLE_TOP, difficultyOf } from './levels.js';
import { THEMES, skinFor, tex, std, setMaxAnisotropy } from './skins.js';
import * as sfx from '../sfx.js';

// ---------- 存档：只放每台设备自己的进度/道具，读写都要能失败 ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('tomato_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tomato_' + k, JSON.stringify(v)); } catch { /* 隐私模式等 */ } },
};

// ---------- 动态难度：参数照搬 Angry Smash 包内默认 RemoteConfig ----------
// 积分越高 = 玩家越强 → 难关扣炮弹；积分越低 = 卡关 → 难关送炮弹
const DDA = {
  unlockAt: 3,              // 原作是 30 关，原型只有 10 关，提前到第 3 关
  applyTo: [1, 2],          // 只作用于困难/超难（原作 apply_difficulty [2,3]）
  clamp: [-30, 20],
  scoring: { cleanWin: 1, loss: -7, continue: 5 },
  harder: [[5, -9], [8, -16], [10, -24], [12, -30], [14, -36], [16, -42]],
  help: [[-4, 2], [-8, 2], [-12, 3], [-20, 10], [-24, 15]],
};
function ddaAdd(delta) {
  const [lo, hi] = DDA.clamp;
  store.set('dda', Math.min(hi, Math.max(lo, store.get('dda', 0) + delta)));
}
function ddaShots(n, diff, base) {
  const score = store.get('dda', 0);
  if (n < DDA.unlockAt || !DDA.applyTo.includes(diff)) return { shots: base, note: '' };
  let add = 0, pct = 0;
  for (const [s, c] of DDA.help) if (score <= s) add = c;
  for (const [s, p] of DDA.harder) if (score >= s) pct = p;
  const shots = Math.max(3, Math.round(base * (1 + pct / 100)) + add);
  const note = add ? `动态难度：卡关帮一把，番茄 +${add}（积分 ${score}）`
    : pct ? `动态难度：你太强了，番茄 ${pct}%（积分 ${score}）` : '';
  return { shots, note };
}

// ---------- 道具：两家都有的三种，按关卡解锁（Angry：三连 9 → 火箭 13 → 大球 23，原型按比例提前） ----------
const BOOSTERS = {
  tri: { name: '三连发', unlock: 2, btn: 'bTri' },
  rocket: { name: '穿甲火箭', unlock: 3, btn: 'bRocket' },
  big: { name: '西瓜弹', unlock: 5, btn: 'bBig' },
};

// ---------- 渲染器与场景（背景是 CSS 图层，画布透明） ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// 低 DPI 屏也至少按 1.5 倍渲染（超采样），否则贴图和边缘发糊
renderer.setPixelRatio(Math.max(1.5, Math.min(devicePixelRatio, 2)));
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
renderer.setClearColor(0x7fd6c8, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// 不用 ACES：它会把番茄红压成粉橙色，品牌红必须保真

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;   // 罐头、瓶子的高光反射靠它

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
const CAM_TARGET = new THREE.Vector3(0, 3, 0);
const CAM_OFFSET = new THREE.Vector3(0, 5.6, 12);
const camBase = new THREE.Vector3();

// ---------- 后期：轻度泛光 + 饱和度 + 暗角（海报那种"亮处发光、四角压暗、颜色浓"） ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.4, 0.95);
composer.addPass(bloom);
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.28 }, vig: { value: 0.7 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat; uniform float vig; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, sat);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vig * dot(d, d);
      c.rgb = (c.rgb - 0.18) * 1.08 + 0.18;   // 加一点对比（线性空间，中灰 0.18 为轴）
      c.rgb *= vec3(1.04, 1.0, 0.95);          // 暖调
      gl_FragColor = c;
    }`,
}));
composer.addPass(new OutputPass());

// 灯光照海报：左上窗户方向的暖色主光（强阴影）+ 右后方暖橙轮廓光（给物件描一圈亮边）+ 很弱的环境光
scene.add(new THREE.HemisphereLight(0xfff4e6, 0x7a4a30, 0.38));
const rim = new THREE.DirectionalLight(0xffa868, 1.6);
rim.position.set(7, 7, -9);
scene.add(rim);
const sun = new THREE.DirectionalLight(0xffdcb0, 3.0);
sun.position.set(-7, 13, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 50 });
sun.shadow.bias = -0.0005;
sun.shadow.radius = 4;
scene.add(sun);

// ---------- 物理世界 ----------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -15, 0) });
world.allowSleep = true;
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 20;

const FRICTION = { wood: 0.5, stone: 0.6, ice: 0.03, metal: 0.35, plastic: 0.4, ball: 0.35, table: 0.5 };
const PM = {};
for (const k in FRICTION) PM[k] = new CANNON.Material(k);
const pmKeys = Object.keys(FRICTION);
for (let i = 0; i < pmKeys.length; i++) {
  for (let j = i; j < pmKeys.length; j++) {
    const a = pmKeys[i], b = pmKeys[j];
    world.addContactMaterial(new CANNON.ContactMaterial(PM[a], PM[b], {
      friction: Math.sqrt(FRICTION[a] * FRICTION[b]),
      restitution: a === 'ball' || b === 'ball' ? 0.15 : 0.04,
    }));
  }
}
// 看不见的地面：掉下桌的东西落在这里，停一下再缩小消失
const ground = new CANNON.Body({ type: CANNON.Body.STATIC, material: PM.table, shape: new CANNON.Plane() });
ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
ground.position.y = -3;
world.addBody(ground);

// ---------- 粒子：番茄汁、爆炸、彩纸、火箭尾焰 ----------
// 圆润汁滴贴图：中心亮、边缘柔、左上一点高光（方块粒子看着廉价）
const dropTex = tex(64, 64, (g, w) => {
  const grd = g.createRadialGradient(w * 0.5, w * 0.5, 0, w * 0.5, w * 0.5, w * 0.5);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.6, 'rgba(255,255,255,.95)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, w);
  g.fillStyle = 'rgba(255,255,255,1)'; g.beginPath(); g.arc(w * 0.38, w * 0.36, w * 0.1, 0, 7); g.fill();
});
const tmpColor = new THREE.Color();
// 两层粒子：细汁滴（多、小）+ 大块果肉（少、大），同一套更新逻辑
function makeParticles(max, size) {
  const pos = new Float32Array(max * 3).fill(-999);
  const col = new Float32Array(max * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: dropTex, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.02 }));
  pts.frustumCulled = false;
  scene.add(pts);
  const parts = new Array(max);
  let next = 0;
  return {
    emit(p, colors, n, speed, up = 2, life = 0.9, grav = 12) {
      for (let k = 0; k < n; k++) {
        const i = next++ % max;
        parts[i] = { x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 2 * speed, vy: Math.random() * speed + up, vz: (Math.random() - 0.5) * 2 * speed, life: life * (0.6 + 0.4 * Math.random()), grav };
        tmpColor.setHex(colors[k % colors.length]);
        col.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
      }
      geo.attributes.color.needsUpdate = true;
    },
    update(dt) {
      for (let i = 0; i < max; i++) {
        const q = parts[i];
        if (!q) continue;
        q.life -= dt;
        if (q.life <= 0) { parts[i] = null; pos[i * 3 + 1] = -999; continue; }
        q.vy -= q.grav * dt;
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        pos.set([q.x, q.y, q.z], i * 3);
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
const fine = makeParticles(1200, 0.3);
const chunks = makeParticles(160, 0.7);
const emit = (...a) => fine.emit(...a);
const updateParticles = (dt) => { fine.update(dt); chunks.update(dt); };

const flashes = [];
function flash(p, color, size) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
  m.position.copy(p);
  scene.add(m);
  flashes.push({ m, t: 0, size });
}

// ---------- 发射器：红色料理机（照海报：流线机身、不锈钢碗口、压力表、黑旋钮） ----------
// 结构：root(落地点) → yawG(左右扭) → body(前后倾 + 压扁拉伸)；番茄从碗口弹射
// 反射压低、底色加深：之前清漆 + 强环境反射把红色冲成了粉橙色
// 深底色 + 粗糙底漆 + 很亮很锐的清漆：大面积保持浓红，只有边缘一道锐利高光（海报的烤漆感）
const red = new THREE.MeshPhysicalMaterial({ color: 0xe8261a, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.28 });
const chrome = std({ color: 0xe8ecf0, metalness: 0.95, roughness: 0.12, envMapIntensity: 1 });
const blackMat = std({ color: 0x1d1d22, roughness: 0.35 });
const launcher = new THREE.Group();
launcher.position.set(0, 0.8, 5.2);
launcher.scale.setScalar(0.92);
scene.add(launcher);
const yawG = new THREE.Group();
launcher.add(yawG);
const body = new THREE.Group();
yawG.add(body);
const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
const lathe = (pts, mat, seg = 48, side) => shade(new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), side ? Object.assign(mat.clone(), { side }) : mat));
body.add(lathe([[0, 0], [1.02, 0], [1.08, 0.1], [1.04, 0.3], [0.95, 0.9], [0.8, 1.45], [0.62, 1.68], [0, 1.7]], red));
for (const y of [0.32, 1.12]) {
  const band = shade(new THREE.Mesh(new THREE.TorusGeometry(y < 1 ? 1.03 : 0.86, 0.055, 12, 64), chrome));
  band.rotation.x = Math.PI / 2; band.position.y = y;
  body.add(band);
}
for (let k = 0; k < 4; k++) {
  const foot = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.14, 16), blackMat));
  const a = Math.PI / 4 + (k * Math.PI) / 2;
  foot.position.set(Math.cos(a) * 0.8, -0.05, Math.sin(a) * 0.8);
  body.add(foot);
}
for (const s of [-1, 1]) {
  const knob = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.24, 20), blackMat));
  knob.rotation.z = Math.PI / 2; knob.position.set(s * 0.98, 0.95, 0);
  body.add(knob);
}
// 压力表：朝向镜头（玩家在料理机背后），指针显示剩余番茄
const dialTex = tex(256, 256, (g, w) => {
  g.fillStyle = '#fffaf0'; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, 7); g.fill();
  g.lineWidth = 6;
  for (let k = 0; k <= 10; k++) {
    const a = Math.PI * (0.75 + k * 0.15);
    g.strokeStyle = k >= 8 ? '#e5372b' : '#3a1d14';
    g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * 92, w / 2 + Math.sin(a) * 92); g.lineTo(w / 2 + Math.cos(a) * 112, w / 2 + Math.sin(a) * 112); g.stroke();
  }
  g.fillStyle = '#e5372b'; g.beginPath(); g.arc(w / 2, w * 0.7, 20, 0, 7); g.fill();
  g.fillStyle = '#3daa5c'; g.fillRect(w / 2 - 4, w * 0.7 - 26, 8, 10);
});
const dial = new THREE.Group();
dial.position.set(0, 0.72, 0.93);
dial.rotation.x = -0.12;
body.add(dial);
const face = new THREE.Mesh(new THREE.CircleGeometry(0.32, 40), std({ map: dialTex, roughness: 0.3 }));
face.position.z = 0.02;
dial.add(face, shade(new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.05, 12, 40), chrome)));
const needle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.26, 0.02), std({ color: 0xe5372b }));
needle.geometry.translate(0, 0.11, 0);
needle.position.z = 0.04;
dial.add(needle);
// 颈部 + 不锈钢碗口
const neck = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.22, 32), chrome));
neck.position.y = 1.78;
body.add(neck);
const bowl = lathe([[0.3, 0], [0.55, 0.12], [0.78, 0.42], [0.86, 0.56], [0.82, 0.58]], chrome, 48, THREE.DoubleSide);
bowl.position.y = 1.86;
body.add(bowl);
const MUZZLE = new THREE.Vector3(0, 2.3, 0);   // 碗口中心（body 局部坐标）
// 碗里预装的下一发：番茄 / 西瓜 / 三颗小番茄 / 火箭
const ammoSlot = new THREE.Group();
ammoSlot.position.y = 2.22;
body.add(ammoSlot);
// 弹簧驱动的动作：扭(yaw)、倾(pitch)、压扁(squash)，有过冲才"扭得起来"
const rig = { yaw: 0, yawV: 0, pitch: -0.12, pitchV: 0, squash: 0, squashV: 0, ammoPop: 1 };
function springStep(x, v, target, k, c, dt) {
  const a = k * (target - x) - c * v;
  v += a * dt;
  return [x + v * dt, v];
}

// ---------- 瞄准显示：落点圈 + 抛物线虚点 ----------
const DOTS = 28;
const dotPos = new Float32Array(DOTS * 3);
const dotGeo = new THREE.BufferGeometry();
dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ size: 0.2, color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
dots.frustumCulled = false; dots.visible = false;
scene.add(dots);
const reticle = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.42, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
reticle.visible = false; reticle.renderOrder = 10;
scene.add(reticle);

// ---------- 游戏状态 ----------
const S = {
  levelIdx: store.get('level', 0), items: [], balls: [], movers: [], explodeQueue: [],
  shots: 0, total: 0, remaining: 0, state: 'play', time: 0, lastShotAt: -99,
  needWake: false, armed: null, continued: false, shake: 0, diff: 0, theme: 'kitchen', themeOverride: null,
  combo: 0, lastClearAt: -9, hitstop: 0, startShots: 1,
};
const inv = { tri: 3, rocket: 3, big: 3, ...store.get('inv', {}) };
const levelGroup = new THREE.Group();
scene.add(levelGroup);
const tableMeshes = [];

function clearLevel() {
  for (const b of S.balls) scene.remove(b.mesh);
  for (const b of world.bodies.slice()) if (b !== ground) world.removeBody(b);
  levelGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  levelGroup.clear();
  tableMeshes.length = 0;
  decals.length = 0;
  Object.assign(S, { items: [], balls: [], movers: [], explodeQueue: [] });
}

function buildTable(t, theme) {
  const cloth = std({ map: THEMES[theme].table(), roughness: 0.8 });
  const under = std({ color: 0xa86c35, roughness: 0.7 });
  const H = 0.5;
  let body, mesh;
  if (t.shape === 'round') {
    cloth.map.repeat.set(t.r * 1.2, t.r * 1.2);
    body = new CANNON.Body({ type: CANNON.Body.STATIC, material: PM.table, shape: new CANNON.Cylinder(t.r, t.r, H, 32) });
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r, H, 64), [cloth, cloth, under]);
  } else {
    cloth.map.repeat.set(t.w / 1.2, t.d / 1.2);
    body = new CANNON.Body({ type: CANNON.Body.STATIC, material: PM.table, shape: new CANNON.Box(new CANNON.Vec3(t.w / 2, H / 2, t.d / 2)) });
    mesh = new THREE.Mesh(new THREE.BoxGeometry(t.w, H, t.d), [cloth, cloth, cloth, under, cloth, cloth]);
  }
  body.position.set(0, TABLE_TOP - H / 2, 0);
  world.addBody(body);
  mesh.position.set(0, TABLE_TOP - H / 2, 0);
  mesh.receiveShadow = true; mesh.castShadow = true;
  levelGroup.add(mesh);
  tableMeshes.push(mesh);

  // 垂下来的桌布裙边：越往下褶皱越明显，下摆波浪（照海报的格子桌布）；纯显示，不参与物理
  const DROP = 0.8;
  const skirtMat = (len) => {
    const m = std({ map: THEMES[theme].table(), roughness: 0.85, side: THREE.DoubleSide });
    m.map.repeat.set(len / 1.2, DROP / 1.2);
    return m;
  };
  const drape = (geo, radial) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = Math.pow(THREE.MathUtils.clamp((DROP / 2 - y) / DROP, 0, 1), 1.4);   // 顶 0 → 底 1
      const a = radial ? Math.atan2(z, x) * 7 : x * 4.2;
      const out = Math.sin(a) * 0.07 * k + 0.03 * k;
      if (radial) { const r = Math.hypot(x, z) + out; const th = Math.atan2(z, x); p.setX(i, Math.cos(th) * r); p.setZ(i, Math.sin(th) * r); }
      else p.setZ(i, z + out);
      p.setY(i, y + Math.sin(a * 2) * 0.035 * k);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const addSkirt = (geo, mat, x, z, ry) => {
    const s = new THREE.Mesh(geo, mat);
    s.position.set(x, TABLE_TOP - DROP / 2 + 0.02, z);
    s.rotation.y = ry;
    s.castShadow = s.receiveShadow = true;
    levelGroup.add(s);
  };
  if (t.shape === 'round') {
    addSkirt(drape(new THREE.CylinderGeometry(t.r + 0.02, t.r + 0.02, DROP, 128, 8, true), true), skirtMat(t.r * 6.28), 0, 0, 0);
  } else {
    const fb = () => drape(new THREE.PlaneGeometry(t.w + 0.04, DROP, Math.ceil(t.w * 14), 8));
    const lr = () => drape(new THREE.PlaneGeometry(t.d + 0.04, DROP, Math.ceil(t.d * 14), 8));
    addSkirt(fb(), skirtMat(t.w), 0, t.d / 2 + 0.02, 0);
    addSkirt(fb(), skirtMat(t.w), 0, -t.d / 2 - 0.02, Math.PI);
    addSkirt(lr(), skirtMat(t.d), t.w / 2 + 0.02, 0, Math.PI / 2);
    addSkirt(lr(), skirtMat(t.d), -t.w / 2 - 0.02, 0, -Math.PI / 2);
  }
}

// 番茄砸中桌面留下的汁渍，几秒后淡出
const splatTex = tex(128, 128, (g, w) => {
  g.fillStyle = 'rgba(200,24,12,.9)';
  g.beginPath(); g.arc(w / 2, w / 2, w * 0.26, 0, 7); g.fill();
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * 6.28 + Math.random() * 0.4, d = w * (0.22 + Math.random() * 0.2), r = w * (0.04 + Math.random() * 0.07);
    g.beginPath(); g.arc(w / 2 + Math.cos(a) * d, w / 2 + Math.sin(a) * d, r, 0, 7); g.fill();
  }
  g.fillStyle = 'rgba(255,140,120,.5)'; g.beginPath(); g.arc(w * 0.44, w * 0.42, w * 0.08, 0, 7); g.fill();
});
const decals = [];
function addSplat(p, size = 0.7) {
  if (Math.abs(p.y - TABLE_TOP) > 0.7) return;
  const m = new THREE.Mesh(new THREE.CircleGeometry(size, 24), new THREE.MeshStandardMaterial({ map: splatTex, transparent: true, roughness: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.set(-Math.PI / 2, 0, Math.random() * 6.28);
  m.position.set(p.x, TABLE_TOP + 0.005, p.z);
  m.receiveShadow = true;
  levelGroup.add(m);
  decals.push({ m, born: S.time });
}

// 显示模型可以比碰撞体精细（两家都是简化碰撞体 + 精细模型）：瓶子有瓶颈瓶盖、罐头有金属边
const plainCache = {};
const tinMat = std({ color: 0xdfe3e8, metalness: 0.92, roughness: 0.16, envMapIntensity: 1 });
function plainOf(side) {
  const c = side.userData?.body;
  if (c == null) return side;
  return (plainCache[c + ':' + side.roughness] ??= std({ color: c, roughness: side.roughness, metalness: side.metalness }));
}
function buildVisual(arch, def, mats) {
  const g = new THREE.Group();
  const add = (geo, mat, y = 0, rotX = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    if (rotX) m.rotation.x = rotX;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  if (def.shape === 'box') {
    const [w, h, d] = def.size;
    add(new RoundedBoxGeometry(w, h, d, 3, Math.min(0.09, Math.min(w, h, d) / 4)), mats);
    return g;
  }
  const [rt, rb] = def.r, H = def.h;
  const [side, top, bottom] = Array.isArray(mats) ? mats : [mats, mats, mats];
  const plain = plainOf(side);
  if (arch === 'bottle') {
    const bodyH = H * 0.58, shH = H * 0.2, nH = H * 0.12, cH = H - bodyH - shH - nH;
    add(new THREE.CylinderGeometry(rb, rb, bodyH, 28), [side, plain, bottom], -H / 2 + bodyH / 2);
    add(new THREE.CylinderGeometry(rt * 0.75, rb, shH, 28, 1, true), plain, -H / 2 + bodyH + shH / 2);
    add(new THREE.CylinderGeometry(rt * 0.7, rt * 0.75, nH, 20), plain, -H / 2 + bodyH + shH + nH / 2);
    add(new THREE.CylinderGeometry(rt * 0.85, rt * 0.85, cH, 20), top, H / 2 - cH / 2);
  } else if (arch === 'jar') {
    const lidH = H * 0.16;
    add(new THREE.CylinderGeometry(rt, rb, H - lidH, 32), [side, plain, bottom], -lidH / 2);
    add(new THREE.CylinderGeometry(rt * 1.07, rt * 1.07, lidH, 32), top, H / 2 - lidH / 2);
  } else {
    // 罐头类（非烘焙主题）：上下盖和卷边换成镜面金属，才有真罐头的质感
    const tin = (arch === 'drum' || arch === 'boom') && S.theme !== 'bakery';
    add(new THREE.CylinderGeometry(rt, rb, H, 32), tin ? [side, tinMat, tinMat] : [side, top, bottom]);
    if (arch === 'drum' || arch === 'boom') {
      for (const y of [-H / 2 + 0.02, H / 2 - 0.02]) add(new THREE.TorusGeometry(rt, 0.04, 10, 40), tin ? tinMat : bottom, y, Math.PI / 2);
    }
    if (arch === 'boom') add(new THREE.TorusGeometry(rt + 0.01, 0.03, 8, 36), tin ? tinMat : bottom, 0, Math.PI / 2);
  }
  return g;
}

function spawnItem(e, i) {
  const arch = e.Id.replace(/_\d+$/, '');
  const def = ARCH[arch];
  if (!def) { console.warn('未知原型', e.Id); return; }
  const c = e.Custom || {};
  const shape = def.shape === 'box'
    ? new CANNON.Box(new CANNON.Vec3(def.size[0] / 2, def.size[1] / 2, def.size[2] / 2))
    : new CANNON.Cylinder(def.r[0], def.r[1], def.h, 14);
  const kind = def.body || 'dynamic';
  const body = new CANNON.Body({
    mass: kind === 'dynamic' ? def.mass : 0,
    type: kind === 'static' ? CANNON.Body.STATIC : kind === 'kinematic' ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC,
    material: PM[def.mat],
    position: new CANNON.Vec3(e.Position.x, e.Position.y, e.Position.z),
    shape,
  });
  if (c.rotY) body.quaternion.setFromEuler(0, (c.rotY * Math.PI) / 180, 0);
  body.linearDamping = 0.05;
  body.angularDamping = 0.12;
  body.sleepSpeedLimit = 0.2;
  body.sleepTimeLimit = 0.5;
  if (kind === 'kinematic') body.allowSleep = false;
  world.addBody(body);

  const skin = skinFor(S.theme, arch, i);
  const mesh = buildVisual(arch, def, skin.mat);
  levelGroup.add(mesh);

  const it = { arch, def, name: skin.name, body, mesh, counted: def.counted !== false, cleared: false, clearedAt: 0, dead: false, exploding: false };
  body.item = it;
  if (kind === 'kinematic') S.movers.push({ it, amp: c.moveX ?? 2, period: c.cycle ?? 3, t0: world.time });
  body.addEventListener('collide', (ev) => {
    const v = Math.abs(ev.contact.getImpactVelocityAlongNormal());
    if (v > 2.5) sfx.play(SOFT_THEME[S.theme]?.[arch] || HIT_SFX[arch], { vol: Math.min(1, v / 9), gap: 0.05 });
  });
  if (def.explosive) {
    body.addEventListener('collide', (ev) => {
      if (Math.abs(ev.contact.getImpactVelocityAlongNormal()) > 3) queueExplode(it);
    });
  }
  if (kind === 'dynamic') body.sleep();   // 开局全部休眠：不被碰就不会自己塌（原作 ItemSleepWake 同理）
  S.items.push(it);
  syncMesh(it);
}

world.addEventListener('preStep', () => {
  for (const m of S.movers) {
    const w = (2 * Math.PI) / m.period;
    m.it.body.velocity.set(m.amp * w * Math.cos(w * (world.time - m.t0)), 0, 0);
  }
});

function syncMesh(it) {
  it.mesh.position.copy(it.body.position);
  it.mesh.quaternion.copy(it.body.quaternion);
}

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
function updateHud() {
  $('lvlNum').textContent = S.levelIdx + 1;
  $('shots').textContent = S.shots;
  const done = S.total - S.remaining;
  $('bar').style.width = `${S.total ? (100 * done) / S.total : 0}%`;
  $('left').textContent = `还剩 ${S.remaining} / ${S.total}`;
  for (const [k, b] of Object.entries(BOOSTERS)) {
    const el = $(b.btn);
    const locked = S.levelIdx + 1 < b.unlock;
    el.querySelector('.cnt').textContent = locked ? '🔒' : inv[k];
    el.classList.toggle('locked', locked);
    el.classList.toggle('armed', S.armed === k);
    el.classList.toggle('empty', !locked && inv[k] <= 0);
  }
}
let toastTimer;
function toast(text, cls) {
  const t = $('toast');
  t.textContent = text;
  t.className = `show ${cls || ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 1500);
}
function showPanel(title, text, main, onMain, alt, onAlt) {
  $('pTitle').textContent = title;
  $('pText').textContent = text;
  $('pMain').textContent = main;
  $('pMain').onclick = () => { hidePanel(); onMain(); };
  $('pAlt').textContent = alt || '';
  $('pAlt').classList.toggle('hidden', !alt);
  $('pAlt').onclick = () => { hidePanel(); onAlt(); };
  $('panel').classList.remove('hidden');
}
const hidePanel = () => $('panel').classList.add('hidden');

// 背景图放进 3D 场景（而不是 CSS 层），这样泛光和暗角会作用到整幅画面；按 cover 方式裁切不变形
const bgCache = {};
function setBackground() {
  const v = innerHeight > innerWidth ? 'v' : 'h';
  const key = `${S.theme}_${v}`;
  const t = (bgCache[key] ??= new THREE.TextureLoader().load(`../assets/bg_${key}.jpg`, fitBackground));
  t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
  fitBackground();
}
function fitBackground() {
  const t = scene.background;
  if (!t?.image?.width) return;
  const imgA = t.image.width / t.image.height, scrA = innerWidth / innerHeight;
  if (scrA > imgA) { t.repeat.set(1, imgA / scrA); t.offset.set(0, (1 - imgA / scrA) / 2); }
  else { t.repeat.set(scrA / imgA, 1); t.offset.set((1 - scrA / imgA) / 2, 0); }
}

// ---------- 关卡流程 ----------
function loadLevel(idx, keepTheme = false) {
  idx = ((idx % LEVELS.length) + LEVELS.length) % LEVELS.length;
  if (!keepTheme) S.themeOverride = null;
  clearLevel();
  hidePanel();
  S.levelIdx = idx;
  store.set('level', idx);
  const lvl = LEVELS[idx];
  const n = idx + 1;
  S.theme = S.themeOverride || lvl.Theme || 'kitchen';
  S.diff = lvl.Difficulty ?? difficultyOf(n);
  buildTable(lvl.Table, S.theme);
  lvl.Entities.forEach(spawnItem);
  S.total = S.remaining = S.items.filter((it) => it.counted).length;
  const d = ddaShots(n, S.diff, lvl.MoveCount);
  S.shots = d.shots;
  $('dda').textContent = d.note;
  Object.assign(S, { state: 'play', lastShotAt: -99, armed: null, continued: false });
  setBackground();
  $('tint').className = ['', 'hard', 'super'][S.diff];
  $('chapter').textContent = `${THEMES[S.theme].name} · ${lvl.name}`;
  const badge = $('badge');
  badge.className = ['', 'hard', 'super'][S.diff];
  badge.textContent = ['', '困难', '超难'][S.diff];
  const unlocked = Object.values(BOOSTERS).find((b) => b.unlock === n);
  if (S.diff) toast(S.diff === 2 ? '超难关卡！' : '困难关卡', ['', 'hard', 'super'][S.diff]);
  else if (unlocked) toast(`解锁新道具：${unlocked.name}`);
  else toast(lvl.name);
  S.startShots = S.shots;
  S.combo = 0;
  ammoKind = null;
  updateHud();
}

function win() {
  S.state = 'won';
  sfx.play('win');
  setTimeout(() => sfx.play('firework'), 250);
  setTimeout(() => sfx.play('firework', { rate: 1.2 }), 550);
  ddaAdd(S.continued ? 0 : DDA.scoring.cleanWin);
  if (S.diff === 2) { for (const k in BOOSTERS) inv[k]++; store.set('inv', inv); }
  for (let k = 0; k < 6; k++) emit(new THREE.Vector3((Math.random() - 0.5) * 8, TABLE_TOP + 5, 0), [0xe5372b, 0xfff1d6, 0x3daa5c, 0xf6c33b], 30, 4, 3, 2.2);
  const last = S.levelIdx === LEVELS.length - 1;
  setTimeout(() => showPanel('清台！', `${LEVELS[S.levelIdx].name} 完成，还剩 ${S.shots} 颗番茄。${S.diff === 2 ? '超难奖励：每种道具 +1。' : ''}`,
    last ? '从头再玩' : '下一关', () => loadLevel(S.levelIdx + 1)), 900);
}

function lose() {
  S.state = 'lost';
  sfx.play('lose');
  showPanel('番茄用完了', `还差 ${S.remaining} 个没打下桌。`, '+5 颗番茄继续', () => {
    S.shots += 5; S.continued = true; S.state = 'play'; S.lastShotAt = S.time;
    ddaAdd(DDA.scoring.continue);   // 原作：花金币续关 = 积分 +5（视为更强的玩家）
    updateHud();
  }, '重新开始', () => { ddaAdd(DDA.scoring.loss); loadLevel(S.levelIdx, true); });
}

// ---------- 发射 ----------
const UP = new THREE.Vector3(0, 1, 0);
const ballGeo = {};
const tomatoMat = new THREE.MeshPhysicalMaterial({ color: 0xe5372b, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.5 });
const melonMat = new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.6, envMapIntensity: 0.5, map: tex(256, 128, (g, w, h) => {
  g.fillStyle = '#4caf50'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1f6b35';
  for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 12, h * 0.3, x - 12, h * 0.7, x, h); g.lineTo(x + 10, h); g.bezierCurveTo(x - 2, h * 0.7, x + 22, h * 0.3, x + 10, 0); g.fill(); }
}) });
const stemMat = std({ color: 0x3daa5c });
const rocketMats = { body: std({ color: 0xfff1d6, roughness: 0.3 }), nose: red, fin: std({ color: 0xf6c33b, roughness: 0.3, metalness: 0.3 }) };

function muzzleWorld() {
  body.updateWorldMatrix(true, false);
  return MUZZLE.clone().applyMatrix4(body.matrixWorld);
}
function solveLaunch(start, target, straight = false) {
  const d = target.clone().sub(start);
  if (straight) return { v: d.clone().normalize().multiplyScalar(22), t: d.length() / 22 };
  // 抛物线要够高：从碗口出来先抬再砸，才能越过前排矮挡板（太平的弹道会一直打在挡板上）
  const g = world.gravity.y;
  const vel = (t) => new THREE.Vector3(d.x / t, (d.y - 0.5 * g * t * t) / t, d.z / t);
  // 挡板瞄准求解（学 Angry 的 AimBlockerBoxSolver）：落点不变，弹道会撞挡板就逐步抬高抛物线
  let t = THREE.MathUtils.clamp(d.length() / 16, 0.4, 1.2);
  for (let k = 0; k < 14 && pathBlocked(start, vel(t), t); k++) t += 0.07;
  return { v: vel(t), t };
}
const _p = new THREE.Vector3();
function pathBlocked(start, v, t) {
  const g = world.gravity.y, R = 0.38;
  const blockers = S.items.filter((it) => !it.counted && !it.dead);
  if (!blockers.length) return false;
  for (let s = 1; s < 24; s++) {
    const tau = (s / 24) * t * 0.92;   // 末段不检查：快到目标了，撞上的就是目标附近的东西
    _p.set(start.x + v.x * tau, start.y + v.y * tau + 0.5 * g * tau * tau, start.z + v.z * tau);
    for (const b of blockers) {
      const [w, h, dd] = b.def.size, bp = b.body.position;
      if (Math.abs(_p.x - bp.x) < w / 2 + R && Math.abs(_p.y - bp.y) < h / 2 + R && Math.abs(_p.z - bp.z) < dd / 2 + R) return true;
    }
  }
  return false;
}
// 瞄准只设目标角度，真正的转动交给弹簧（有过冲 → 扭动感）
const aimGoal = { yaw: 0, pitch: -0.12 };
function aimAt(target) {
  const dx = target.x - launcher.position.x, dz = target.z - launcher.position.z;
  aimGoal.yaw = Math.atan2(-dx, -dz);
  const elev = Math.atan2(target.y - 2.5, Math.hypot(dx, dz));
  aimGoal.pitch = THREE.MathUtils.clamp(-0.16 + elev * 0.5, -0.35, 0.12);   // 打低处往前探，打高处往后仰
}
// 碗里的预装弹药随道具变化
const ammoGeo = { tomato: new THREE.SphereGeometry(0.34, 28, 18), cherry: new THREE.SphereGeometry(0.2, 20, 14), melon: new THREE.SphereGeometry(0.62, 28, 18) };
let ammoKind = null;
function refreshAmmo() {
  const kind = S.shots <= 0 ? 'none' : S.armed || 'tomato';
  if (kind === ammoKind) return;
  ammoKind = kind;
  ammoSlot.clear();
  if (kind === 'none') return;
  const add = (m, x = 0, y = 0) => { m.position.set(x, y, 0); m.castShadow = true; ammoSlot.add(m); return m; };
  if (kind === 'big') add(new THREE.Mesh(ammoGeo.melon, melonMat), 0, 0.25);
  else if (kind === 'rocket') { const r = add(makeRocketMesh(), 0, 0.25); r.rotation.x = -Math.PI / 2; }
  else if (kind === 'tri') { for (const [x, y] of [[-0.2, 0], [0.2, 0], [0, 0.22]]) add(new THREE.Mesh(ammoGeo.cherry, tomatoMat), x, y); }
  else {
    const t = add(new THREE.Mesh(ammoGeo.tomato, tomatoMat));
    const stem = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.14, 5), stemMat);
    stem.position.y = 0.32;
    t.add(stem);
  }
  rig.ammoPop = 0;   // 新弹药从碗里"冒"出来
}

function makeRocketMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.9, 20), rocketMats.body);
  body.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 20), rocketMats.nose);
  nose.rotation.x = Math.PI / 2; nose.position.z = 0.67;
  g.add(body, nose);
  for (let k = 0; k < 3; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.3), rocketMats.fin);
    const a = (k / 3) * Math.PI * 2;
    fin.position.set(Math.cos(a) * 0.25, Math.sin(a) * 0.25, -0.35);
    fin.rotation.z = a + Math.PI / 2;
    g.add(fin);
  }
  return g;
}

function fire(target) {
  if (S.shots <= 0 || S.time - S.lastShotAt < 0.25) return;
  const kind = S.armed;
  // 必须在开炮时就唤醒：cannon-es 把休眠物体当无限质量求解，等撞上再唤醒，第一下撞击就白打了
  wakeAll();
  aimAt(target);
  const start = muzzleWorld();

  if (kind === 'rocket') {
    // 穿甲火箭：运动学刚体沿直线匀速飞，物理上质量无限 → 一路推开所有东西（Angry：max_travel_distance 40）
    const { v } = solveLaunch(start, target, true);
    const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, shape: new CANNON.Sphere(0.28), position: new CANNON.Vec3(start.x, start.y, start.z) });
    body.allowSleep = false;
    body.velocity.set(v.x, v.y, v.z);
    body.addEventListener('collide', (ev) => { S.needWake = true; if (ev.body.item?.def.explosive) queueExplode(ev.body.item); });
    world.addBody(body);
    const mesh = makeRocketMesh();
    mesh.position.copy(start);
    mesh.lookAt(start.clone().add(v));
    scene.add(mesh);
    S.balls.push({ body, mesh, born: S.time, rocket: true, life: 1.8 });
  } else {
    const { v } = solveLaunch(start, target);
    const big = kind === 'big', tri = kind === 'tri';
    const r = big ? 0.75 : tri ? 0.26 : 0.34;
    const mass = big ? 18 : tri ? 3.5 : 6;   // 弹道变慢后加重，保持打击力度
    for (const deg of tri ? [-7, 0, 7] : [0]) {
      const vel = v.clone().applyAxisAngle(UP, (deg * Math.PI) / 180);
      const body = new CANNON.Body({ mass, material: PM.ball, shape: new CANNON.Sphere(r), position: new CANNON.Vec3(start.x, start.y, start.z) });
      body.allowSleep = false;
      body.linearDamping = 0.01;
      body.velocity.set(vel.x, vel.y, vel.z);
      const ball = { body, mesh: null, born: S.time, splatted: false, big, life: 4.5 };
      body.addEventListener('collide', (ev) => {
        S.needWake = true;
        if (ev.body.item?.def.explosive) queueExplode(ev.body.item);
        if (!ball.splatted && Math.abs(ev.contact.getImpactVelocityAlongNormal()) > 5) { ball.splatted = true; ball.splatNow = true; }
      });
      world.addBody(body);
      ballGeo[r] ??= new THREE.SphereGeometry(r, 32, 20);
      const mesh = new THREE.Mesh(ballGeo[r], big ? melonMat : tomatoMat);
      mesh.castShadow = true;
      if (!big) {
        const stem = new THREE.Mesh(new THREE.ConeGeometry(r * 0.35, r * 0.4, 5), stemMat);
        stem.position.y = r * 0.95;
        mesh.add(stem);
      }
      scene.add(mesh);
      ball.mesh = mesh;
      S.balls.push(ball);
    }
  }
  S.shots--;
  if (kind) { inv[kind]--; store.set('inv', inv); S.armed = null; }
  S.lastShotAt = S.time;
  // 开炮的身体动作：压扁 → 回弹，往后仰，左右扭一下
  rig.squashV += kind === 'big' ? 14 : 10;
  rig.pitchV += 5;
  rig.yawV += (Math.random() < 0.5 ? -1 : 1) * 3;
  ammoKind = null;
  ammoSlot.clear();
  emit(start, [0xfff1d6, 0xffffff, 0xe5372b], 16, 2, 1, 0.4);
  sfx.play(kind === 'rocket' ? 'fire_rocket' : kind === 'tri' ? 'fire_tri' : 'fire', { rate: kind === 'big' ? 0.75 : 1, vol: kind === 'big' ? 1 : 0.8 });
  S.shake = Math.max(S.shake, kind === 'big' ? 0.25 : 0.08);
  updateHud();
}

// ---------- 爆炸（辣椒罐 / 摇过的可乐 / 奶油喷罐） ----------
function queueExplode(it) {
  if (it.exploding || it.dead) return;
  it.exploding = true;
  S.explodeQueue.push({ it, at: S.time + 0.06 });
}
function explode(it) {
  const p = new THREE.Vector3().copy(it.body.position);
  killItem(it);
  const R = 3.6, F = 20;
  for (const o of S.items) {
    if (o.dead || o.body.type !== CANNON.Body.DYNAMIC) continue;
    const d = new THREE.Vector3().copy(o.body.position).sub(p);
    const dist = d.length();
    if (dist > R) continue;
    if (o.def.explosive) { queueExplode(o); continue; }
    o.body.wakeUp();
    d.normalize();
    const k = F * (1 - dist / R) * Math.pow(o.body.mass, 0.6);
    o.body.applyImpulse(new CANNON.Vec3(d.x * k, d.y * k + k * 0.6, d.z * k));
  }
  flash(p, 0xffb02e, 3.2);
  emit(p, THEMES[S.theme].boom, 110, 8, 3, 1.2);
  chunks.emit(p, THEMES[S.theme].boom, 24, 7, 4, 1.3);
  S.shake = 0.7;
  S.hitstop = 0.09;   // 打击停顿：爆炸瞬间时间几乎冻住，再放开 → 有"重量"
  sfx.play('boom', { vol: 1, gap: 0.08 });
}

function killItem(it) {
  if (it.dead) return;
  it.dead = true;
  world.removeBody(it.body);
  levelGroup.remove(it.mesh);
  if (it.counted && !it.cleared) onCleared(it);
}

// ---------- 清掉一个物件：连击计数，音调逐级升高（爽感的核心） ----------
const COMBO_WINDOW = 1.3;
const COMBO_WORDS = [[25, 'TOMATO-TASTIC!'], [15, 'AMAZING!'], [10, 'AWESOME!'], [5, 'GREAT!']];
function onCleared(it) {
  it.cleared = true;
  it.clearedAt = S.time;
  S.remaining--;
  S.combo = S.time - S.lastClearAt < COMBO_WINDOW ? S.combo + 1 : 1;
  S.lastClearAt = S.time;
  sfx.play('pop', { rate: Math.min(2.4, 1 + (S.combo - 1) * 0.07), vol: 0.7, jitter: 0, gap: 0.02 });
  sfx.play(FALL_SFX[it.arch] || 'fall_wood', { vol: 0.35, gap: 0.08 });
  if (S.combo >= 3) showCombo();
  updateHud();
}
let comboTimer;
function showCombo() {
  const el = $('combo');
  const word = COMBO_WORDS.find(([n]) => S.combo >= n);
  el.innerHTML = `<b>×${S.combo}</b>${word ? `<span>${word[1]}</span>` : ''}`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  if (word && S.combo === word[0]) { sfx.play('combo', { vol: 0.9 }); S.shake = Math.max(S.shake, 0.2); }
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => el.classList.remove('show'), 900);
}

// 材质 → 命中/掉落音效（分类照原作：木 / 罐 / 玻璃 / 冰 / 石）
const HIT_SFX = { box: 'hit_wood', plank: 'hit_wood', pillar: 'hit_wood', heavy: 'hit_stone', slick: 'hit_ice', boom: 'hit_tin', drum: 'hit_tin', bottle: 'hit_glass', jar: 'hit_glass', disc: 'hit_soft', wall: 'hit_tin', slider: 'hit_tin' };
const FALL_SFX = { box: 'fall_wood', plank: 'fall_wood', pillar: 'fall_wood', heavy: 'fall_stone', slick: 'fall_wood', boom: 'fall_tin', drum: 'fall_tin', bottle: 'fall_tin', jar: 'fall_tin', disc: 'fall_wood' };
const SOFT_THEME = { bakery: { box: 'hit_soft', heavy: 'hit_soft', plank: 'hit_soft', drum: 'hit_soft', jar: 'hit_soft' } };

function wakeAll() {
  for (const it of S.items) if (!it.dead && it.body.type === CANNON.Body.DYNAMIC) it.body.wakeUp();
}

// ---------- 输入：按住瞄准、松手发射 ----------
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2();
let aiming = false, aimTarget = null;

function pick(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const meshes = S.items.filter((it) => !it.dead && !it.cleared).map((it) => it.mesh).concat(tableMeshes);
  const hit = raycaster.intersectObjects(meshes, true)[0];
  if (hit) return hit.point.clone();
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(aimPlane, p) ? p : null;
}
function updateAimVisual() {
  if (!aiming || !aimTarget) { dots.visible = reticle.visible = false; return; }
  aimAt(aimTarget);
  const start = muzzleWorld();
  const straight = S.armed === 'rocket';
  const { v, t } = solveLaunch(start, aimTarget, straight);
  const g = straight ? 0 : world.gravity.y;
  for (let k = 0; k < DOTS; k++) {
    const tau = (k / (DOTS - 1)) * t;
    dotPos.set([start.x + v.x * tau, start.y + v.y * tau + 0.5 * g * tau * tau, start.z + v.z * tau], k * 3);
  }
  dotGeo.attributes.position.needsUpdate = true;
  reticle.position.copy(aimTarget);
  reticle.lookAt(camera.position);
  dots.visible = reticle.visible = true;
}
canvas.addEventListener('pointerdown', (ev) => {
  if (S.state !== 'play' || S.shots <= 0) return;
  canvas.setPointerCapture(ev.pointerId);
  aiming = true;
  aimTarget = pick(ev);
  sfx.unlock();
});
canvas.addEventListener('pointermove', (ev) => { if (aiming) aimTarget = pick(ev) || aimTarget; });
canvas.addEventListener('pointerup', () => {
  if (aiming && aimTarget && S.state === 'play') fire(aimTarget);
  aiming = false;
});
canvas.addEventListener('pointercancel', () => (aiming = false));

for (const [k, b] of Object.entries(BOOSTERS)) {
  $(b.btn).addEventListener('click', () => {
    if (S.levelIdx + 1 < b.unlock) { toast(`第 ${b.unlock} 关解锁`); return; }
    if (inv[k] <= 0) { toast('道具用完了'); return; }
    S.armed = S.armed === k ? null : k;
    sfx.unlock();
    sfx.play(S.armed === 'big' ? 'big_grow' : 'booster_tap');
    rig.squashV -= 6;   // 装道具时料理机"吸"一下
    updateHud();
  });
}
$('prev').onclick = () => loadLevel(S.levelIdx - 1);
$('next').onclick = () => loadLevel(S.levelIdx + 1);
$('theme').onclick = () => {
  // 演示"积木固定、皮肤发散"：同一个关卡布局，换一套食物
  const ids = Object.keys(THEMES);
  S.themeOverride = ids[(ids.indexOf(S.theme) + 1) % ids.length];
  loadLevel(S.levelIdx, true);
};
addEventListener('keydown', (e) => { if (e.key === 'r' || e.key === 'R') loadLevel(S.levelIdx, true); });

// ---------- 主循环 ----------
function settled() {
  return S.items.every((it) => it.dead || it.cleared || it.body.type !== CANNON.Body.DYNAMIC
    || it.body.sleepState === CANNON.Body.SLEEPING || it.body.velocity.lengthSquared() < 0.03);
}

function update(dt) {
  S.time += dt;
  if (S.balls.length) wakeAll();   // 有番茄在飞就不许物件睡着，否则撞上的那一下按无限质量算
  world.step(1 / 120, dt, 8);
  if (S.needWake) { wakeAll(); S.needWake = false; }

  for (let k = S.explodeQueue.length - 1; k >= 0; k--) {
    const q = S.explodeQueue[k];
    if (S.time >= q.at) { S.explodeQueue.splice(k, 1); explode(q.it); }
  }

  for (const it of S.items) {
    if (it.dead) continue;
    syncMesh(it);
    if (it.counted && !it.cleared && it.body.position.y < TABLE_TOP - 1.2) {
      onCleared(it);
      emit(it.body.position, [0xfff1d6, 0xf6c33b, 0xffffff], 12, 2, 2.5, 0.6);
    }
    if (it.cleared) {
      const a = (S.time - it.clearedAt - 0.8) / 0.35;    // 落下后停留一会再缩小消失
      if (a > 0) it.mesh.scale.setScalar(Math.max(0.001, 1 - a));
      if (a >= 1) killItem(it);
    }
  }

  for (let k = S.balls.length - 1; k >= 0; k--) {
    const b = S.balls[k];
    b.mesh.position.copy(b.body.position);
    if (b.rocket) {
      emit(b.body.position, [0xff7a1a, 0xf6c33b, 0xfff1d6], 3, 0.6, 0, 0.35, 0);
    } else {
      b.mesh.quaternion.copy(b.body.quaternion);
    }
    if (b.splatNow) {
      b.splatNow = false;
      addSplat(b.body.position, b.big ? 1.1 : 0.6);
      // 番茄炸开：几块大果肉 + 一圈细汁（海报那种"爆浆"）
      chunks.emit(b.body.position, b.big ? [0xff4d6d, 0x2e8b3a, 0xffd0d0] : [0xd8200f, 0xff5a3c, 0xf6c33b], b.big ? 16 : 9, 4, 3, 1.0);
      fine.emit(b.body.position, [0xe8261a, 0xff7a5a, 0xffffff], b.big ? 60 : 36, 5.5, 3.5, 0.8);
      sfx.play('splat', { vol: b.big ? 1 : 0.7, rate: b.big ? 0.7 : 1 });
      if (b.big) S.hitstop = Math.max(S.hitstop, 0.06);
      emit(b.body.position, b.big ? [0xff4d6d, 0x4caf50, 0x1f1f1f] : [0xe5372b, 0xff6a55, 0xc41e12], b.big ? 40 : 22, 3.5, 2, 0.8);
      S.shake = Math.max(S.shake, b.big ? 0.35 : 0.12);
    }
    if (S.time - b.born > b.life || b.body.position.y < -2.5) {
      world.removeBody(b.body);
      scene.remove(b.mesh);
      S.balls.splice(k, 1);
    }
  }

  if (S.state === 'play') {
    if (S.remaining <= 0) win();
    else if (S.shots <= 0 && !S.explodeQueue.length) {
      const since = S.time - S.lastShotAt;
      if ((since > 2.2 && settled()) || since > 8) lose();
    }
  }

  for (let k = flashes.length - 1; k >= 0; k--) {
    const f = flashes[k];
    f.t += dt / 0.4;
    f.m.scale.setScalar(0.3 + f.size * f.t);
    f.m.material.opacity = 0.85 * (1 - f.t);
    if (f.t >= 1) { scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); flashes.splice(k, 1); }
  }
  updateParticles(dt);
  for (let k = decals.length - 1; k >= 0; k--) {
    const age = S.time - decals[k].born;
    if (age > 4) decals[k].m.material.opacity = Math.max(0, 1 - (age - 4));
    if (age > 5) { levelGroup.remove(decals[k].m); decals[k].m.geometry.dispose(); decals[k].m.material.dispose(); decals.splice(k, 1); }
  }

  // 发射器动作：弹簧追目标角度（过冲 = 扭），待机时轻轻摇摆
  if (!aiming) aimAt(new THREE.Vector3(Math.sin(S.time * 0.9) * 0.8, TABLE_TOP + 1.5, 0));
  const idle = aiming ? 0 : 1;
  [rig.yaw, rig.yawV] = springStep(rig.yaw, rig.yawV, aimGoal.yaw + idle * Math.sin(S.time * 1.7) * 0.05, 90, 7, dt);
  [rig.pitch, rig.pitchV] = springStep(rig.pitch, rig.pitchV, aimGoal.pitch + idle * Math.sin(S.time * 2.3) * 0.025, 120, 9, dt);
  [rig.squash, rig.squashV] = springStep(rig.squash, rig.squashV, 0, 260, 9, dt);
  yawG.rotation.y = rig.yaw;
  body.rotation.x = rig.pitch;
  body.rotation.z = rig.yawV * -0.015;                       // 扭得快时身子跟着歪一下
  const sq = THREE.MathUtils.clamp(rig.squash, -0.6, 0.8);
  body.scale.set(1 + sq * 0.16, 1 - sq * 0.24 + Math.sin(S.time * 3) * 0.008 * idle, 1 + sq * 0.16);
  if (S.time - S.lastShotAt > 0.22) refreshAmmo();
  rig.ammoPop = Math.min(1, rig.ammoPop + dt * 5);
  const pop = rig.ammoPop < 1 ? Math.sin(rig.ammoPop * Math.PI) * 0.25 + rig.ammoPop : 1;
  ammoSlot.scale.setScalar(Math.max(0.001, pop));
  needle.rotation.z = THREE.MathUtils.lerp(needle.rotation.z, (1 - S.shots / Math.max(1, S.startShots)) * -2.6 + 1.3, dt * 6);
  updateAimVisual();

  S.shake = Math.max(0, S.shake - dt * 1.8);
  camera.position.copy(camBase);
  if (S.shake > 0) camera.position.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, 0).multiplyScalar(S.shake * 0.5));
  camera.lookAt(CAM_TARGET);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h;
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
  const k = Math.max(1, 4.5 / (CAM_OFFSET.length() * tanH));   // 竖屏时拉远，桌子刚好撑满屏宽（物件尽量大）
  CAM_TARGET.y = 3 + (k - 1) * 1.6;                              // 拉远后焦点上移：桌子落到画面中部，大炮压到底部
  camBase.copy(CAM_TARGET).addScaledVector(CAM_OFFSET, k);
  camera.updateProjectionMatrix();
  // 料理机放在画面左下角、斜对桌子（照海报构图）：按屏幕位置反推世界坐标，横竖屏都落在同一个角
  camera.position.copy(camBase);
  camera.lookAt(CAM_TARGET);
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(h > w ? -0.38 : -0.55, -0.55), camera);
  const spot = new THREE.Vector3();
  if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -4.8), spot)) {
    launcher.scale.setScalar(h > w ? 1.15 : 1.0);
    launcher.position.set(spot.x, spot.y - 1.1 * launcher.scale.x, 4.8);
  }
  setBackground();
}
addEventListener('resize', resize);

let last = performance.now();
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.hitstop > 0) { S.hitstop -= dt; dt *= 0.12; }   // 打击停顿
  update(dt);
  composer.render();
  requestAnimationFrame(frame);
}
sfx.loadSamples();
if (new URLSearchParams(location.search).has('debug')) document.body.classList.add('debug');
// ?silent=1：自动化测试时彻底静音（不外放）
if (new URLSearchParams(location.search).has('silent')) { sfx.toggleMute(); $('mute').textContent = '🔇'; }
$('mute').onclick = () => { $('mute').textContent = sfx.toggleMute() ? '🔇' : '🔊'; };
addEventListener('pointerdown', () => sfx.unlock(), { once: true });
loadLevel(S.levelIdx);
resize();
requestAnimationFrame(frame);

// 给自动化试玩用：在控制台里 __game.fireAt(x, y, z)
window.__game = {
  S, inv, loadLevel,
  arm: (k) => { S.armed = k; },
  fireAt: (x, y, z) => fire(new THREE.Vector3(x, y, z)),
  setTheme: (t) => { S.themeOverride = t; loadLevel(S.levelIdx, true); },
  // 按 60fps 同步推进 sec 秒，不受后台标签页降帧影响
  tick: (sec) => { for (let k = 0; k < Math.round(sec * 60); k++) update(1 / 60); composer.render(); },
  // 自动打关机器人（学 Angry 的 Autoplay）：打最高的物件；同一目标连续两发没进展就登记为死角换目标
  // ammo = null 时给足弹药测"需要几发"；给数字时按真实弹药测"能不能过"
  autoplay(list, ammo = null) {
    const out = {};
    for (const n of list) {
      loadLevel(n - 1);
      if (ammo != null) S.shots = ammo;
      const budget = ammo ?? 25;
      if (ammo == null) S.shots = 40;
      let used = 0;
      const dead = new Map();
      while (S.remaining > 0 && used < budget && S.shots > 0) {
        const live = S.items.filter((i) => !i.dead && !i.cleared && i.counted);
        if (!live.length) break;
        let cand = live.filter((i) => (dead.get(i) || 0) < 2);
        if (!cand.length) { dead.clear(); cand = live; }
        cand.sort((a, b) => b.body.position.y - a.body.position.y);
        const it = cand[0], before = S.remaining;
        const t = new THREE.Vector3().copy(it.body.position);
        fire(t);
        used++;
        this.tick(2.0);
        const moved = it.cleared || t.distanceTo(it.body.position) > 0.3;
        if (S.remaining === before && !moved) dead.set(it, (dead.get(it) || 0) + 1);
      }
      this.tick(2.5);
      out[n] = { need: S.remaining <= 0 ? used : 99, total: S.total, left: S.remaining, diff: S.diff };
    }
    return out;
  },
};
