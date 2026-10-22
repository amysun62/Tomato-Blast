"""宣传片音效轨：读录制时记下的音效事件（[秒, 名字, 音量, 音高]），离线合成成 WAV。
全部是自己合成的声音，不用竞品采样（宣传片要公开）。
用法：python3 promo_sfx.py events.json out.wav 总秒数
"""
import json
import os
import sys
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(7)


def env(n, a, dec):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), np.exp(-(t - a) / max(dec, 1e-4) * 4.6))
    return e


def sweep(f0, f1, dur, kind='sine'):
    n = int(dur * SR)
    f = f0 * (f1 / f0) ** (np.arange(n) / n)
    ph = 2 * np.pi * np.cumsum(f) / SR
    if kind == 'tri':
        return 2 / np.pi * np.arcsin(np.sin(ph))
    if kind == 'saw':
        return 2 * ((ph / (2 * np.pi)) % 1) - 1
    return np.sin(ph)


def noise(dur, lo=None, hi=None, f_end=None):
    """带通噪声；给 f_end 时中心频率从 hi 滑到 f_end（逐块近似）"""
    n = int(dur * SR)
    x = rng.standard_normal(n)
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1 / SR)
    m = np.ones_like(fr)
    if lo:
        m *= 1 / (1 + (lo / np.maximum(fr, 1)) ** 4)
    if hi:
        m *= 1 / (1 + (fr / hi) ** 4)
    y = np.fft.irfft(X * m, n)
    if f_end and hi:
        # 越往后越闷：再叠一个逐渐收窄的低通
        lp = np.fft.irfft(X * (1 / (1 + (fr / f_end) ** 4)), n)
        w = np.linspace(0, 1, n)
        y = y * (1 - w) + lp * w
    return y / (np.abs(y).max() + 1e-9)


def tone(f0, f1, dur, vol, a=0.003, kind='sine'):
    n = int(dur * SR)
    return sweep(f0, f1, dur, kind) * env(n, a, dur) * vol


def nz(dur, vol, lo=None, hi=None, f_end=None, a=0.002):
    n = int(dur * SR)
    return noise(dur, lo, hi, f_end) * env(n, a, dur) * vol


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[:len(p)] += p
    return out


def at(x, delay):
    return np.concatenate([np.zeros(int(delay * SR)), x])


# 开炮声直接用游戏里的同一个文件（tools/make_fire_sfx.py 合成），保证宣传片和游戏听起来一样
SFX_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'sfx')


def load_wav(name):
    with wave.open(os.path.join(SFX_DIR, name)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float64) / 32767


FIRE, FIRE_BIG = load_wav('fire.wav'), load_wav('fire_big.wav')
SPLAT, SPLAT_BIG = load_wav('splat.wav'), load_wav('splat_big.wav')


def resample(x, r):
    # 播放速率 r：r>1 音高变高、变短（和 WebAudio 的 playbackRate 一样）
    idx = np.arange(0, len(x) - 1, r)
    return np.interp(idx, np.arange(len(x)), x)


def s_fire(r):
    return resample(FIRE, r)


def s_fire_big(r):
    return resample(FIRE_BIG, r)


def s_fire_tri(r):
    return mix(*[at(s_fire(r * k) * 0.75, d) for d, k in [(0, 1.12), (0.05, 1.0), (0.1, 1.22)]])


def s_fire_rocket(r):
    return mix(nz(0.7, 0.6, lo=500, hi=4000, a=0.05), tone(120, 420, 0.6, 0.15, a=0.05, kind='saw'), tone(130 * r, 40, 0.25, 0.8))


def s_splat(r):
    return resample(SPLAT, r)


def s_splat_big(r):
    return resample(SPLAT_BIG, r)


def s_hit_wood(r):
    return mix(nz(0.08, 0.6, lo=500 * r, hi=1500 * r), tone(230 * r, 150, 0.09, 0.35, kind='tri'))


def s_hit_tin(r):
    return mix(nz(0.06, 0.4, lo=2000 * r, hi=5000 * r), tone(950 * r, 940 * r, 0.25, 0.22, kind='tri'), tone(1430 * r, 1420 * r, 0.2, 0.12))


def s_hit_glass(r):
    return mix(tone(2300 * r, 2290 * r, 0.32, 0.2), tone(3450 * r, 3440 * r, 0.26, 0.12), nz(0.06, 0.25, lo=5000))


def s_hit_ice(r):
    return mix(nz(0.13, 0.4, lo=2500 * r), tone(1800 * r, 1790 * r, 0.16, 0.14))


def s_hit_stone(r):
    return mix(nz(0.13, 0.75, hi=500 * r), tone(90 * r, 58, 0.13, 0.4))


def s_hit_soft(r):
    return nz(0.09, 0.5, hi=700 * r)


def s_boom(r):
    return mix(nz(0.8, 1.0, hi=1400, f_end=90), tone(75 * r, 28, 0.7, 1.0), nz(0.28, 0.4, lo=1500, hi=5000), at(nz(0.5, 0.25, lo=200, hi=900), 0.08))


def s_pop(r):
    return mix(tone(520 * r, 1050 * r, 0.1, 0.4), at(tone(1300 * r, 1300 * r, 0.08, 0.14, kind='tri'), 0.02))


def s_fall(r):
    return nz(0.16, 0.4, hi=400 * r)


def s_combo(r):
    return mix(*[at(tone(660 * r * 2 ** (s / 12), 660 * r * 2 ** (s / 12), 0.18, 0.22, kind='tri'), k * 0.05) for k, s in enumerate([0, 4, 7, 12])])


def s_win(r):
    return mix(*[at(tone(523 * 2 ** (s / 12), 523 * 2 ** (s / 12), 0.35, 0.3, kind='tri'), k * 0.09) for k, s in enumerate([0, 4, 7, 12, 16])])


def s_click(r):
    return tone(900, 600, 0.04, 0.1, kind='saw')


SYNTH = {k[2:]: v for k, v in globals().items() if k.startswith('s_')}
ALIAS = {'fall_wood': 'fall', 'fall_tin': 'fall', 'fall_stone': 'fall', 'break_ice': 'hit_ice', 'big_grow': 'pop', 'booster_tap': 'click', 'firework': 'pop', 'coin': 'pop', 'load': 'click'}
GAP = 0.035   # 同名音效最短间隔，和游戏里一致


def main():
    events = json.load(open(sys.argv[1]))
    total = float(sys.argv[3])
    out = np.zeros((int(total * SR) + SR, 2))
    last = {}
    for t, name, vol, rate in events:
        name = ALIAS.get(name, name)
        fn = SYNTH.get(name, s_hit_soft)
        if name in last and t - last[name] < GAP:
            continue
        last[name] = t
        r = rate * (1 + rng.uniform(-0.05, 0.05))
        x = fn(r) * min(1.0, vol)
        if name.startswith('fire'):
            x *= 1.1   # 开炮声放在最前面
        elif name.startswith(('hit_', 'fall')):
            x *= 0.55   # 碰撞声几百个，压低一点，让开炮和爆汁更清楚
        pan = rng.uniform(-0.25, 0.25)
        i = int(t * SR)
        x = x[: max(0, len(out) - i)]
        out[i:i + len(x), 0] += x * (1 - pan)
        out[i:i + len(x), 1] += x * (1 + pan)
    out = np.tanh(out * 0.8)   # 软限幅：叠多了也不爆音
    out = out[: int(total * SR)]
    with wave.open(sys.argv[2], 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((out * 32000).astype('<i2').tobytes())


if __name__ == '__main__':
    main()
