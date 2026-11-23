"""IDOK-159: synthesize the film's three transition sounds (no third-party samples).
riser  — filtered noise + rising tone, ends exactly at the drum entry (length = 8 beats)
impact — sub-bass thump + short low noise burst on the drum entry
whoosh — band-limited noise swell under the closing aerial rise
Usage: python3 scripts/promo/sfx.py <out-dir> [beat_seconds]"""
import sys, wave, numpy as np
out = sys.argv[1]; P = float(sys.argv[2]) if len(sys.argv) > 2 else 60/161.5
SR = 48000; rng = np.random.default_rng(159)

def onepole(x, cutoff):                     # time-varying one-pole low-pass
    y = np.empty_like(x); a = np.exp(-2*np.pi*np.asarray(cutoff)/SR) * np.ones_like(x); z = 0.0
    for i in range(len(x)): z = (1-a[i])*x[i] + a[i]*z; y[i] = z
    return y

def save(name, x):
    x = x / (np.abs(x).max() + 1e-9) * 0.9
    st = np.stack([x, x], 1)
    with wave.open(f'{out}/sfx-{name}.wav', 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((st*32767).astype('<i2').tobytes())

def riser(seconds):
    n = int(seconds*SR); t = np.arange(n)/SR; u = t/seconds
    noise = rng.standard_normal(n)
    lp = onepole(noise, 300 + 7000*u**2.2); hp = lp - onepole(lp, 120 + 900*u)
    tone = np.sin(2*np.pi*np.cumsum(180 + 900*u**2)/SR) * 0.25
    env = u**2.4 * (1 - np.clip((u-0.985)/0.015, 0, 1))          # swell, cut clean on the beat
    return (hp*0.8 + tone) * env

def impact(seconds=1.6):
    n = int(seconds*SR); t = np.arange(n)/SR
    sub = np.sin(2*np.pi*(52*t - 18*t**2)) * np.exp(-t/0.38)
    knock = onepole(rng.standard_normal(n), 900) * np.exp(-t/0.05) * 0.6
    att = np.clip(t/0.004, 0, 1)
    return (sub + knock) * att

def whoosh(seconds=2.2):
    n = int(seconds*SR); t = np.arange(n)/SR; u = t/seconds
    noise = rng.standard_normal(n)
    band = onepole(noise, 600 + 2600*np.sin(np.pi*u)) - onepole(noise, 180 + 500*np.sin(np.pi*u))
    env = np.sin(np.pi*u)**1.6
    return band * env

save('riser', riser(8*P)); save('impact', impact()); save('whoosh', whoosh())
print('ok', 8*P)
