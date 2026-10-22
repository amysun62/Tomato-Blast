"""开炮和爆汁音效（自己合成，游戏和宣传片共用）：输出 assets/sfx/fire(_big).wav、splat(_big).wav。
设计依据（对照原作开炮声的频谱分析）：原作能量八成在 200Hz 以下，约 40ms 到峰值、270ms 收尾；
但手机喇叭放不出 80Hz 以下，所以低频冲击要加失真泛音，让 100–400Hz 也有"轰"的分量。
四层：脆响开头（啪）+ 下坠冲击（轰，带饱和泛音）+ 低频底子 + 炮膛气浪尾巴（噗）。
用法：python3 make_fire_sfx.py 输出目录
"""
import sys
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(11)


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def adsr(t, a, d):
    """a 秒线性起，之后指数衰减（d 秒衰减 60dB）"""
    return np.where(t < a, t / a, np.exp(-(t - a) / d * 6.9))


def lowpass(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / (1 + (f / fc) ** 4), len(x))


def bandpass(x, lo, hi):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / (1 + (lo / np.maximum(f, 1)) ** 4) / (1 + (f / hi) ** 4), len(x))


def fire(scale=1.0):
    dur = 0.75 * scale
    t = t_axis(dur)
    # 1 脆响：1ms 起、70ms 收的宽带噪声爆点
    crack = bandpass(rng.standard_normal(len(t)), 1200, 7000)
    crack = crack / np.abs(crack).max() * adsr(t, 0.001, 0.07) * 1.6
    # 2 下坠冲击：220Hz→78Hz 的正弦，过 tanh 饱和出泛音（手机喇叭靠它听见"轰"）
    f = 78 / scale + (220 / scale - 78 / scale) * np.exp(-t / 0.05)
    ph = 2 * np.pi * np.cumsum(f) / SR
    punch = np.tanh(np.sin(ph) * 6.0) * adsr(t, 0.006, 0.6 * scale) * 0.85
    # 3 低频底子：48Hz，20ms 起（手机喇叭放不出，耳机/音箱上补厚度）
    sub = np.sin(2 * np.pi * 48 / scale * t) * adsr(t, 0.02, 0.6 * scale) * 0.32
    # 4 气浪：带通噪声从 90–1400Hz 收到 80–450Hz，"噗——"
    n = rng.standard_normal(len(t))
    whump = bandpass(n, 90, 1400) * np.exp(-t / 0.06) + bandpass(n, 80, 450) * (1 - np.exp(-t / 0.06))
    whump = whump / np.abs(whump).max() * adsr(t, 0.012, 0.9 * scale) * 0.7
    x = crack + punch + sub + whump
    # 总线：轻压缩感（tanh）+ 归一到 -1dBFS
    x = np.tanh(x * 1.4)
    x *= 0.89 / np.abs(x).max()
    fade = np.ones_like(x)
    fade[-int(0.05 * SR):] = np.linspace(1, 0, int(0.05 * SR))
    return x * fade


def splat(scale=1.0):
    """番茄爆汁：闷击（咚）+ 湿润的"啪叽"（共振从高扫到低的噪声）+ 几滴汁水飞溅的小水滴"""
    dur = 0.6 * scale
    t = t_axis(dur)
    f = 60 / scale + (170 / scale - 60 / scale) * np.exp(-t / 0.03)
    thump = np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * 3) * adsr(t, 0.003, 0.18 * scale) * 0.8
    # 湿：分 6 段，每段带通中心从 2600Hz 往 380Hz 掉，拼成一个"啪叽"
    n = rng.standard_normal(len(t))
    squelch = np.zeros_like(t)
    for k, fc in enumerate(np.geomspace(2600, 380, 6)):
        w = np.exp(-((t - k * 0.018) / 0.014) ** 2)
        squelch += bandpass(n, fc * 0.6, fc * 1.6) * w
    squelch = squelch / np.abs(squelch).max() * adsr(t, 0.002, 0.25 * scale) * 0.9
    # 水滴：4 个随机高音"嘀"，30–220ms 之间
    drops = np.zeros_like(t)
    for _ in range(4):
        t0 = rng.uniform(0.03, 0.22) * scale
        f0 = rng.uniform(900, 2200)
        tt = np.clip(t - t0, 0, None)
        drops += np.where(t > t0, np.sin(2 * np.pi * (f0 * tt + 1800 * tt * tt)) * np.exp(-tt / 0.018), 0) * rng.uniform(0.15, 0.3)
    x = np.tanh((thump + squelch + drops) * 1.3)
    x *= 0.89 / np.abs(x).max()
    fade = np.ones_like(x)
    fade[-int(0.05 * SR):] = np.linspace(1, 0, int(0.05 * SR))
    return x * fade


def save(path, x):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())


if __name__ == '__main__':
    out = sys.argv[1]
    save(f'{out}/fire.wav', fire(1.0))
    save(f'{out}/fire_big.wav', fire(1.35))
    save(f'{out}/splat.wav', splat(1.0))
    save(f'{out}/splat_big.wav', splat(1.4))
