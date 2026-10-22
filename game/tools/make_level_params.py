"""把 data/royal_profile.json 压成生成器用的精简参数表 data/level_params.js（只有数字，不含任何摆法）。
每关一行：[物件数, 炮弹数, 桌型(0 方/1 圆/2 马车/3 船), 桌宽, 桌深, 转速(度/秒, 0 不转), 挡板(0 无/1 固定/2 移动), 摆锤数, 高度, 材质权重...]
材质权重顺序见 MIX_KEYS。原作每关常有 A/B 两个版本，取第一个。
"""
import json
import sys

MIX_KEYS = ['box', 'jar', 'slick', 'heavy', 'drum', 'pillar', 'bottle', 'boom', 'pinata', 'ball', 'bouncer']
TABLE = {'rect': 0, 'round': 1, 'wagon': 2, 'boat': 3}
prof = json.load(open(sys.argv[1]))
rows = []
for n in range(1, 1271):
    vs = prof.get(str(n))
    if not vs:
        rows.append(None); continue
    v = vs[0]
    blk = 0
    if v['blockers']:
        blk = 2 if any(b['moving'] for b in v['blockers']) else 1
    mix = [round(v['mix'].get(k, 0), 2) for k in MIX_KEYS]
    rows.append([v['n'], v['moves'], TABLE.get(v['table'], 0), v['w'] or 7, v['d'] or 3, round(v['rotSpeed'] if v['rot'] else 0), blk, v['hammers'], v['height'], *mix])
out = ('// 由 tools/make_level_params.py 从拆包统计生成（只有每关的数字参数，不含摆法），勿手改\n'
       f'export const MIX_KEYS = {json.dumps(MIX_KEYS)};\n'
       'export const PARAMS = [\n' + ',\n'.join(json.dumps(r, separators=(',', ':')) for r in rows) + '\n];\n')
open(sys.argv[2], 'w').write(out)
print(len(rows), sum(r is None for r in rows), len(out))
