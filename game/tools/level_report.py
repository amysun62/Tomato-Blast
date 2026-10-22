"""1000 关实测报告：读机器人校准结果（最少发数 / 真实炮弹数验收 / 道具验收），写成 markdown。
用法：python3 level_report.py need_all.json final_real.jsonl final_boost.jsonl 输出.md
关卡元数据（名字、章节、物件数、机关）用 node 从 levels.js 现算。
"""
import json
import subprocess
import sys

need_p, real_p, boost_p, out_p = sys.argv[1:5]
N = {int(k): v for k, v in json.load(open(need_p)).items()}
load = lambda p: {r['n']: r for r in (json.loads(l) for l in open(p))}
REAL, BOOST = load(real_p), load(boost_p)
meta = json.loads(subprocess.run(['node', '--input-type=module', '-e', '''
const m = await import('./levels.js');
const out = [];
for (let i = 0; i < m.LEVEL_COUNT; i++) {
  const l = m.buildLevel(i), E = l.Entities;
  const mech = [];
  if (l.Table.rot) mech.push('转桌'); else if (l.Table.round) mech.push('圆桌');
  for (const [id, name] of [['wall', '挡板'], ['slider', '移动挡板'], ['hammer', '摆锤'], ['bouncer', '弹跳柱'], ['pinata', '皮纳塔'], ['boom', '炸药罐']]) if (E.some((e) => e.Id === id)) mech.push(name);
  out.push([i + 1, l.name, l.Theme, m.difficultyOf(i + 1), E.filter((e) => m.ARCH[e.Id].counted !== false).length, l.MoveCount, mech.join('、')]);
}
console.log(JSON.stringify(out));
'''], capture_output=True, text=True, cwd=__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..')).stdout)
TH = {'kitchen': '番茄厨房', 'drinks': '饮料吧', 'bakery': '甜品烘焙'}
DF = ['普通', '困难', '超难']
real_ok = sum(1 for n in range(1, 1001) if REAL.get(n, {}).get('left', 1) == 0)
boost_ok = sum(1 for n in range(1, 1001) if BOOST.get(n, {}).get('left', 1) == 0)
real_fail = [n for n in range(1, 1001) if REAL.get(n, {}).get('left', 1) != 0]
boost_fail = [n for n in range(1, 1001) if BOOST.get(n, {}).get('left', 1) != 0]
bcount = {'tri': 0, 'rocket': 0, 'big': 0}
for r in BOOST.values():
    for k, v in (r.get('boosts') or {}).items(): bcount[k] = bcount.get(k, 0) + v
import statistics
needs = [N[n]['need'] for n in range(1, 1001)]
bneeds = [BOOST[n]['need'] for n in range(1, 1001) if BOOST.get(n, {}).get('left', 1) == 0]
lines = [
    '# Tomato Blast · 1000 关实测报告',
    '',
    '测试时间：2026-10-22 · 测试方式：自动打关机器人（学 Angry Smash 的 Autoplay：打最高的物件，同一目标两发没进展就换目标），在 8 个无界面浏览器里并行，按真实物理逐关实打。每关开局时钟归零，同一关每次都是同一个开局，结果可复现。',
    '',
    '## 结论',
    '',
    f'- **真实炮弹数验收（不用道具）：{real_ok} / 1000 关清台。**' + ('' if not real_fail else f' 未清台：{real_fail}'),
    f'- **道具验收（每 3 发里 1 发轮流用三连发 / 火箭 / 大西瓜）：{boost_ok} / 1000 关清台**，共用了三连发 {bcount["tri"]} 次、火箭 {bcount["rocket"]} 次、大西瓜 {bcount["big"]} 次，无报错。' + ('' if not boost_fail else f' 未清台：{boost_fail}'),
    f'- 机器人最少用量中位数 {statistics.median(needs):.0f} 发；用道具时中位数 {statistics.median(bneeds):.0f} 发。',
    f'- 炮弹数 = 机器人最少用量 + 余量（普通 +5，前 30 关 +6，困难 +3，超难 +4，且至少多 12%），中位数 {statistics.median([m[5] for m in meta]):.0f} 发（原作同区间中位数 22 发）。',
    '- 机器人代表"瞄得很准、不会用道具"的玩家；真人瞄准更差，但有道具和续关。手感仍需真人试玩确认。',
    '',
    '## 关卡怎么来的',
    '',
    '- 每关的数字参数照拆包里原作同一关：物件数、炮弹数、桌型和尺寸、转桌转速、挡板、摆锤、堆叠高度、材质比例（`data/level_params.js`，只有数字，不含原作摆法）。',
    '- 摆法由我们的生成器用外形模板现生成（金字塔 / 城堡 / 双塔 / 台阶 / 山谷 / 天际线，后排可加高像看台），按镜头限制最多 8 层、3 排、110 个物件。',
    '- 机关：转桌（一律做成圆桌）、圆桌、弹跳柱、皮纳塔、摆锤（挂在物件堆前面，是会动的障碍）、固定挡板。',
    '',
    '## 实测发现并修掉的问题',
    '',
    '1. 圆桌四面都远，物件很难推下去（第一轮失败关 72% 是圆桌）→ 圆桌最多 6 列宽。',
    '2. 固定挡板把后面的物件封死 → 挡板后面那几列最多 2 层高。',
    '3. 摆锤挂得太低，开局自己把物件扫下桌 → 改挂在物件堆前方。',
    '4. 摆锤 / 移动挡板 / 转桌用的是从开机起一直走的时钟，同一关每次开局不一样，测出的发数不可复现 → 每关开局时钟归零。',
    '5. 无界面浏览器缓存了旧代码，校准跑的是旧版 → 每轮清空浏览器缓存。',
    '6. 个别关机器人 45 发打不完 → 换随机种子重新生成（参数不变，只换外形和材质抽样），见 `levels.js` 的 RESEED。',
    '',
    '## 逐关结果',
    '',
    '| 关 | 名字 | 章节 | 难度 | 物件 | 机关 | 炮弹 | 机器人最少 | 真实验收 | 道具验收 |',
    '|---|---|---|---|---|---|---|---|---|---|',
]
for n, name, th, d, cnt, shots, mech in meta:
    rv = REAL.get(n, {}); bv = BOOST.get(n, {})
    rs = f"✓ {rv['need']} 发" if rv.get('left') == 0 else f"✗ 剩 {rv.get('left', '?')}"
    bs = f"✓ {bv['need']} 发" if bv.get('left') == 0 else f"✗ 剩 {bv.get('left', '?')}"
    lines.append(f'| {n} | {name} | {TH[th]} | {DF[d]} | {cnt} | {mech or "—"} | {shots} | {N[n]["need"]} | {rs} | {bs} |')
open(out_p, 'w').write('\n'.join(lines) + '\n')
print(real_ok, boost_ok)
