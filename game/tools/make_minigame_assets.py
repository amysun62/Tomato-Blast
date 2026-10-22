"""小游戏资源包：把 assets/ 转成体积更小的格式，输出到 minigame/assets_src/。
用法：python -I tools/make_minigame_assets.py   （需要 numpy、PIL(WebP)、ffmpeg）
- 图片：精灵和 UI -> 无损 WebP（像素与原图完全一致，比 PNG 小约三成）；背景和地板 JPG 原样拷贝（不再二次压缩）；音乐 -> 单声道 64k mp3；音效 -> 自己的合成音/wav -> 单声道 96k mp3（不使用 assets/sfx_ref）
- 字体 Lilita One（SIL OFL）从 Google Fonts 仓库下载
"""
import glob, os, random, runpy, shutil, subprocess, sys, tempfile, urllib.request
import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
A = os.path.join(ROOT, 'assets')
OUT = os.path.join(ROOT, 'minigame', 'assets_src')
SR = 44100


def rel(p):
    return os.path.relpath(p, A)


def to_webp(src, q, psnr_list=None):
    dst = os.path.join(OUT, os.path.splitext(rel(src))[0] + '.webp')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im = Image.open(src)
    im = im.convert('RGBA') if (im.mode in ('RGBA', 'LA', 'P') or 'transparency' in im.info) else im.convert('RGB')
    if q is None:   # 无损：制作人要求打包不损失画质（有损 WebP 实测最低只有 28 dB）
        im.save(dst, 'WEBP', lossless=True, quality=100, method=4, exact=True)
    else:
        im.save(dst, 'WEBP', quality=q, method=6, exact=False)
    return dst


def psnr(src, dst):
    def load(p):
        im = Image.open(p).convert('RGBA')
        a = np.asarray(im).astype(np.float64)
        al = a[..., 3:4] / 255
        return a[..., :3] * al + 128 * (1 - al)
    x, y = load(src), load(dst)
    mse = ((x - y) ** 2).mean()
    return 99.0 if mse == 0 else 10 * np.log10(255 ** 2 / mse)


def images():
    sets = [
        (sorted(glob.glob(f'{A}/sprites/*.png')), None),
        (sorted(glob.glob(f'{A}/ui/*.png')), None),
    ]
    for f in sorted(glob.glob(f'{A}/bg_*_v.jpg') + glob.glob(f'{A}/floor_*.jpg')):   # JPG 原样拷贝
        shutil.copy(f, os.path.join(OUT, os.path.basename(f)))
        stale = os.path.join(OUT, os.path.splitext(os.path.basename(f))[0] + '.webp')
        if os.path.exists(stale): os.remove(stale)
    jobs = [(f, q) for files, q in sets for f in files]
    from multiprocessing import Pool
    with Pool(12) as pool:   # 并行：本机常被其它进程占满 CPU，多进程抢到更多份额
        dsts = pool.starmap(to_webp, jobs)
    pairs = [(f, d, q) for (f, q), d in zip(jobs, dsts)]
    for sub in ('sprites',):
        shutil.copy(f'{A}/{sub}/manifest.json', os.path.join(OUT, sub, 'manifest.json'))
    for sub in ('ui',):   # 非图片的 ui 配置原样带上
        for j in glob.glob(f'{A}/{sub}/*.json'):
            shutil.copy(j, os.path.join(OUT, sub, os.path.basename(j)))
    random.seed(1)
    sample = [p for p in pairs if '/sprites/' in p[0]]
    sample = random.sample(sample, 5)
    res = [(rel(s), psnr(s, d)) for s, d, _ in sample]
    # 全量最小 PSNR 也算一下
    allp = [(rel(s), psnr(s, d)) for s, d, _ in pairs]
    return res, min(allp, key=lambda t: t[1])


def font():
    d = os.path.join(OUT, 'fonts')
    os.makedirs(d, exist_ok=True)
    base = 'https://github.com/google/fonts/raw/main/ofl/lilitaone/'
    for n in ('LilitaOne-Regular.ttf', 'OFL.txt'):
        p = os.path.join(d, n)
        if not os.path.exists(p):
            urllib.request.urlretrieve(base + n, p)


def ff(args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y'] + args, check=True)


def music():
    os.makedirs(f'{OUT}/music', exist_ok=True)
    for f in sorted(glob.glob(f'{A}/music/*.mp3')):
        ff(['-i', f, '-ac', '1', '-b:a', '64k', f'{OUT}/music/{os.path.basename(f)}'])


def sfx():
    os.makedirs(f'{OUT}/sfx', exist_ok=True)
    for n in ('fire', 'fire_big', 'splat', 'splat_big'):
        ff(['-i', f'{A}/sfx/{n}.wav', '-ac', '1', '-b:a', '96k', f'{OUT}/sfx/{n}.mp3'])
    # 只取 promo_sfx 里的 s_* 合成函数（不用 sfx_ref 采样路径）
    m = runpy.run_path(os.path.join(ROOT, 'tools', 'promo_sfx.py'), run_name='promo_sfx_import')
    tone, mix, at = m['tone'], m['mix'], m['at']

    def s_lose(r):   # 下行四音三角波旋律（win 的反向）
        return mix(*[at(tone(523 * 2 ** (s / 12), 523 * 2 ** (s / 12), 0.35, 0.3, kind='tri'), k * 0.12) for k, s in enumerate([7, 4, 0, -5])])
    syn = {k: v for k, v in m.items() if k.startswith('s_') and callable(v)}
    syn['s_lose'] = s_lose
    alias = {'fall_wood': 's_fall', 'fall_tin': 's_fall', 'fall_stone': 's_fall', 'break_ice': 's_hit_ice',
             'firework': 's_pop', 'coin': 's_pop', 'big_grow': 's_pop', 'booster_tap': 's_click', 'load': 's_click'}
    names = ['hit_wood', 'fall_wood', 'hit_tin', 'fall_tin', 'hit_glass', 'hit_ice', 'break_ice', 'hit_stone', 'fall_stone',
             'hit_soft', 'boom', 'pop', 'combo', 'win', 'lose', 'click', 'coin', 'firework', 'big_grow', 'booster_tap',
             'fire_tri', 'fire_rocket', 'load']
    for n in names:
        fn = syn.get('s_' + n) or syn[alias[n]]
        x = np.asarray(fn(1.0), dtype=np.float64)
        x = x / max(np.abs(x).max(), 1e-9) * 10 ** (-1 / 20)
        k = min(int(0.05 * SR), len(x))
        x[-k:] *= np.linspace(1, 0, k)
        with tempfile.NamedTemporaryFile(suffix='.f32') as t:
            t.write(x.astype('<f4').tobytes()); t.flush()
            ff(['-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', t.name, '-b:a', '96k', f'{OUT}/sfx/{n}.mp3'])


def sizes():
    tot, files, per = 0, [], {}
    for dp, _, fs in os.walk(OUT):
        for f in fs:
            if f == 'SIZES.txt':
                continue
            p = os.path.join(dp, f); s = os.path.getsize(p)
            tot += s; files.append((s, os.path.relpath(p, OUT)))
            top = os.path.relpath(dp, OUT).split(os.sep)[0]
            per[top] = per.get(top, 0) + s
    lines = ['Per folder:'] + [f'  {k:<10}{v/1024:10.1f} KB' for k, v in sorted(per.items())]
    lines += [f'Grand total: {tot/1024:.1f} KB ({tot/1048576:.2f} MB)', '', '10 largest files:']
    lines += [f'  {s/1024:9.1f} KB  {p}' for s, p in sorted(files, reverse=True)[:10]]
    open(os.path.join(OUT, 'SIZES.txt'), 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    res, worst = images()
    print('PSNR sample:', [(n, round(v, 1)) for n, v in res], 'min', round(min(v for _, v in res), 1))
    print('PSNR worst over all images:', worst[0], round(worst[1], 1))
    font(); music(); sfx(); sizes()
