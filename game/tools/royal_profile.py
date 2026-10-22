"""从拆包的原版关卡里提取"每关参数"（不提取摆法）：物件数、炮弹数、难度、桌型/尺寸/是否转、挡板、摆锤、材质比例、高度和纵深。
生成器按这些参数自己摆关卡（学原作的节奏，不抄布局）。
用法：python3 royal_profile.py <拆包关卡JSON目录> <输出 json>
"""
import collections
import json
import os
import re
import sys

SRC, OUT = sys.argv[1], sys.argv[2]
# 原作物件族 → 我们的积木原型
FAMILY = {
    'IceSquare': 'slick', 'IceCylinder': 'slick', 'StoneSquare': 'heavy', 'StoneCylinder': 'heavy',
    'BoxSquare': 'box', 'ColorBoxSquare': 'box', 'WoodSquare': 'box', 'PiggyBox': 'box',
    'BoxCylinder': 'drum', 'WoodCylinder': 'drum', 'CanCylinder': 'drum',
    'CanSquare': 'jar', 'JamJar': 'jar', 'CanCone': 'bottle', 'Can2Cone': 'bottle',
    'ColumnSquare': 'pillar', 'ColumnCylinder': 'pillar',
    'TntSquare': 'boom', 'TntCylinder': 'boom', 'Pinata': 'pinata', 'Pumpkin': 'ball', 'BouncerCylinder': 'bouncer',
}


def fam(eid):
    base = re.sub(r'_\d+$', '', eid)
    for k in FAMILY:
        if base.startswith(k):
            return FAMILY[k]
    return base


idx = json.load(open(os.path.join(SRC, '_index.json')))
by_level = collections.defaultdict(list)
for i in idx:
    by_level[int(i['name'])].append(json.load(open(os.path.join(SRC, i['file']))))

prof = {}
for n in sorted(by_level):
    vs = []
    for d in by_level[n]:
        ents = d['Entities']
        tables = [e for e in ents if e['Id'].startswith('Table_')]
        t = tables[0] if tables else {'Id': 'Table_Rect', 'Position': {'y': 2}, 'Custom': {}}
        tc = t.get('Custom', {})
        ty = t['Position']['y']
        items = [e for e in ents if not e['Id'].startswith(('Table_', 'Blocker_', 'Hammer'))]
        mix = collections.Counter(fam(e['Id']) for e in items)
        ys = [e['Position']['y'] - ty for e in items] or [0]
        zs = [e['Position'].get('z', 0) for e in items] or [0]
        blockers = [e for e in ents if e['Id'].startswith('Blocker_')]
        vs.append({
            'n': len(items), 'moves': d.get('MoveCount'), 'diff': d.get('Difficulty') or 0,
            'table': t['Id'].split('_')[1].lower(), 'w': tc.get('w'), 'd': tc.get('d'),
            'rot': bool(tc.get('rotate')), 'rotSpeed': tc.get('rotSpeed', 0),
            'blockers': [{'size': b['Id'].split('_')[1], 'moving': any(k in b.get('Custom', {}) for k in ('moveX', 'moveY', 'moveZ'))} for b in blockers],
            'hammers': sum(e['Id'].startswith('Hammer') for e in ents),
            'mix': {k: round(v / max(1, len(items)), 3) for k, v in mix.most_common()},
            'height': round(max(ys), 1), 'depth': round(max(zs) - min(zs), 1),
        })
    prof[n] = vs
json.dump(prof, open(OUT, 'w'), separators=(',', ':'))

# 分段汇总，人看的
def med(a):
    a = sorted(a); return a[len(a) // 2] if a else None
bands = [(1, 10), (11, 30), (31, 60), (61, 100), (101, 200), (201, 400), (401, 700), (701, 1000)]
for lo, hi in bands:
    V = [v for n in range(lo, hi + 1) for v in prof.get(n, [])]
    tabs = collections.Counter(v['table'] for v in V)
    rot = sum(v['rot'] for v in V) / len(V)
    blk = sum(bool(v['blockers']) for v in V) / len(V)
    ham = sum(v['hammers'] > 0 for v in V) / len(V)
    mix = collections.Counter()
    for v in V:
        for k, x in v['mix'].items(): mix[k] += x / len(V)
    print(f"{lo}-{hi}: n={med([v['n'] for v in V])} moves={med([v['moves'] for v in V])} h={med([v['height'] for v in V])} depth={med([v['depth'] for v in V])} w={med([v['w'] for v in V if v['w']])} d={med([v['d'] for v in V if v['d']])} rot={rot:.0%} blk={blk:.0%} ham={ham:.0%} tables={dict(tabs)}")
    print('   mix', {k: round(x, 2) for k, x in mix.most_common(9)})
