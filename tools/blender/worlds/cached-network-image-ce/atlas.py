"""Generate 9 original, fully procedural "photos" (abstract landscapes, gradients, shapes; no stock imagery and no
people) and bake them into a 3x3 atlas of square 512px cells with 6px replicated-edge padding (no mip bleed).
Run: python3 -I atlas.py"""
import json, math
import numpy as np
from PIL import Image, ImageFilter

OUT = '/Users/egun/dev/erengun-lab/public/worlds/cached-network-image-ce/'
CELL, PAD = 512, 6
S = CELL - 2 * PAD
rng = np.random.default_rng(7)
Y, X = np.mgrid[0:S, 0:S].astype(np.float32) / (S - 1)  # X right, Y down (0 top)


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def grad(stops, t):
    """multi-stop smooth gradient: stops = [(pos, '#hex'), ...], t array 0..1"""
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,), np.float32) + hexc(stops[0][1])
    for (p0, c0), (p1, c1) in zip(stops[:-1], stops[1:]):
        m = (t >= p0) & (t <= p1)
        k = ((t - p0) / max(p1 - p0, 1e-6))[..., None]
        k = k * k * (3 - 2 * k)
        out = np.where(m[..., None], hexc(c0) * (1 - k) + hexc(c1) * k, out)
    out = np.where((t > stops[-1][0])[..., None], hexc(stops[-1][1]), out)
    return out


def ridge(x, seed, amp, freqs=(2.1, 5.3, 11.7, 23.9)):
    r = np.random.default_rng(seed)
    y = np.zeros_like(x)
    a = amp
    for f in freqs:
        y += a * np.sin(x * f * math.pi + r.uniform(0, 6.28))
        a *= 0.5
    return y


def layer(img, mask, col):
    m = np.clip(np.asarray(mask, np.float32), 0, 1)[..., None]
    return img * (1 - m) + hexc(col) * m


def mountains(img, base_y, amp, seed, col):
    edge = base_y + ridge(X[0], seed, amp)
    m = np.clip((Y - edge[None, :]) / 0.004 * 0.5 + 0.5, 0, 1)
    depth = np.clip((Y - edge[None, :]) * 5, 0, 1)[..., None]
    c = hexc(col) * (1 - 0.25 * depth)
    return img * (1 - m[..., None]) + c * m[..., None]


def disc(img, cx, cy, r, col, glow=0.0, gcol=None):
    d = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
    if glow:
        img = img + hexc(gcol or col) * (np.exp(-d * glow) * 0.6)[..., None]
    m = np.clip((r - d) / 0.004, 0, 1)[..., None]
    return img * (1 - m) + hexc(col) * m


def finish(img, grain=0.025, vig=0.35):
    d = np.sqrt((X - 0.5) ** 2 + (Y - 0.5) ** 2)
    img = img * (1 - vig * np.clip(d - 0.25, 0, 1) ** 1.2 * 2)[..., None]
    img = img + rng.normal(0, grain, img.shape).astype(np.float32)
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))


photos = []

# 0 alpine sunset: layered ridges, warm sun
im = grad([(0, '#0b2b5c'), (.4, '#c9507a'), (.58, '#ffb35c'), (.8, '#ffd98a')], Y)
im = disc(im, .63, .47, .07, '#fff1c4', glow=7, gcol='#ffb300')
for k, (b, a, c) in enumerate([(.52, .07, '#8a4470'), (.64, .06, '#5a2a5c'), (.77, .05, '#2e1842'), (.9, .03, '#140b22')]):
    im = mountains(im, b, a, 1 + k, c)
photos.append(finish(im))

# 1 ocean horizon, blue hour, sun reflection
im = grad([(0, '#062a55'), (.48, '#3a86cc'), (.555, '#bfe2ff')], Y)
sea = grad([(.56, '#0e5a9c'), (1, '#03203f')], Y)
im = np.where((Y > .56)[..., None], sea, im)
im = disc(im, .5, .49, .045, '#fff6d6', glow=12, gcol='#8fd0ff')
w = .025 + np.clip(Y - .56, 0, 1) * .3
refl = np.exp(-((X - .5) / w) ** 2) * (Y > .565) * (0.5 + 0.5 * np.sin(Y * 260 + np.sin(X * 40))) * np.exp(-(Y - .56) * 2.5)
im = im + hexc('#e6f4ff') * refl[..., None] * .8
photos.append(finish(im))

# 2 desert dunes, amber
im = grad([(0, '#f2b45a'), (.45, '#ffe2a8'), (1, '#ffd08a')], Y)
im = disc(im, .25, .26, .06, '#fffaf0', glow=5, gcol='#fff0c0')
for k, (b, a, c) in enumerate([(.52, .05, '#e39a3c'), (.64, .06, '#c8702a'), (.78, .05, '#a5521f'), (.92, .03, '#7a3814')]):
    edge = b + ridge(X[0], 30 + k, a, (1.1, 2.3, 4.1))
    m = np.clip((Y - edge[None, :]) / 0.003, 0, 1)
    shade = np.clip((Y - edge[None, :]) * 4, 0, 1)
    col = hexc(c)[None, None, :] * (1 - .35 * shade[..., None])
    im = im * (1 - m[..., None]) + col * m[..., None]
photos.append(finish(im, grain=.02))

# 3 aurora over a dark lake
im = grad([(0, '#020815'), (.6, '#0a2a4a')], Y)
for k in range(3):
    band = np.exp(-((Y - (.2 + k * .1) - ridge(X[0], 70 + k, .08, (1.2, 2.5))[None, :]) / .055) ** 2)
    curtain = band * (0.75 + 0.25 * np.sin(X * (9 + 3 * k) + k * 2))
    im = im + curtain[..., None] * hexc(['#2bffb0', '#3d9bff', '#a46bff'][k]) * .6
im = im + (rng.random((S, S)) > .9992)[..., None] * .9 * (Y < .55)[..., None]
im = mountains(im, .56, .025, 9, '#02060d')
low = int(S * .6)
refl = np.flipud(im[2 * low - S:low])
im[low:] = im[low:] * .35 + refl * .5
photos.append(finish(im, grain=.03))

# 4 bauhaus geometry (blue / amber)
im = np.ones((S, S, 3), np.float32) * hexc('#f2ece0')
im = layer(im, (X < .55) & (Y > .42), '#02569b')
im = disc(im, .66, .34, .22, '#ffb300')
im = layer(im, np.clip((.02 - np.abs(X - Y * .8 - .05)) / .004, 0, 1), '#101820')
im = disc(im, .3, .68, .12, '#f2ece0')
im = layer(im, (np.abs(X - .82) < .08) & (Y > .62) & (Y < .92), '#d6452f')
photos.append(finish(im, grain=.018, vig=.2))

# 5 misty pine forest, morning blue
im = grad([(0, '#cfe3f5'), (.6, '#9fc2e4'), (1, '#6f97c2')], Y)
im = disc(im, .72, .28, .08, '#ffffff', glow=6, gcol='#eaf4ff')
for k, (b, h, c) in enumerate([(.6, .18, '#86a6c6'), (.72, .22, '#557a9e'), (.86, .27, '#264563'), (1.0, .32, '#0c1d30')]):
    r = np.random.default_rng(100 + k)
    nt = 26 - k * 4
    m = (Y > b - .03)
    for cx in np.linspace(0, 1, nt) + r.uniform(-.02, .02, nt):
        top = b - h * r.uniform(.6, 1)
        m = m | ((Y > top) & (np.abs(X - cx) < (Y - top) * .28))
    im = layer(im, m, c)
photos.append(finish(im, grain=.02))

# 6 night city, abstract skyline with lit windows
im = grad([(0, '#050a1c'), (.7, '#14306a'), (1, '#2a5aa8')], Y)
im = disc(im, .2, .18, .035, '#e8f0ff', glow=14)
r = np.random.default_rng(5)
x0 = 0
while x0 < 1:
    w = r.uniform(.05, .12); h = r.uniform(.25, .7)
    m = (X >= x0) & (X < x0 + w) & (Y > 1 - h)
    im = layer(im, m, '#060b18')
    wins = m & (np.mod(X * 90, 1) < .45) & (np.mod(Y * 70, 1) < .5) & (r.random((S, S)) > .5)
    im = im + wins[..., None] * hexc('#ffc85a') * .9
    x0 += w + r.uniform(0, .02)
photos.append(finish(im, grain=.03))

# 7 bokeh gradient (abstract lens blur)
im = grad([(0, '#02569b'), (.5, '#3a1550'), (1, '#ff9e3d')], X * .6 + Y * .4)
r = np.random.default_rng(11)
for i in range(36):
    cx, cy, rad = r.uniform(0, 1), r.uniform(0, 1), r.uniform(.03, .11)
    d = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
    a = np.clip((rad - d) / .006, 0, 1) * (0.25 + 0.15 * (d / rad))
    im = im + a[..., None] * hexc(['#ffb300', '#8fd0ff', '#ffd6f0'][i % 3]) * .55
photos.append(finish(im, grain=.02))

# 8 lake with mirrored peaks, teal dawn
im = grad([(0, '#0a3b5c'), (.5, '#9fd8e0')], Y)
im = disc(im, .35, .2, .05, '#fffbe8', glow=8)
im = mountains(im, .3, .12, 21, '#3a6a85')
im = mountains(im, .42, .04, 22, '#173a4f')
half = S // 2
im[half:] = np.flipud(im[:half]) * hexc('#a8d8e8') * .85 + hexc('#06263a') * .1
ripple = (np.sin(Y * 400 + np.sin(X * 30) * 2) > .92) & (Y > .5)
im = im + ripple[..., None] * .08
photos.append(finish(im, grain=.02))

atlas = Image.new('RGB', (CELL * 3, CELL * 3))
for i, ph in enumerate(photos):
    a = np.pad(np.asarray(ph), ((PAD, PAD), (PAD, PAD), (0, 0)), mode='edge')
    atlas.paste(Image.fromarray(a), ((i % 3) * CELL, (i // 3) * CELL))
atlas.save(OUT + 'photos.webp', quality=82, method=6)
json.dump({'cols': 3, 'rows': 3, 'pad': PAD / CELL, 'count': len(photos),
           'names': ['alpine-sunset', 'ocean-horizon', 'dunes', 'aurora', 'bauhaus', 'misty-forest', 'night-city',
                     'bokeh', 'mirror-lake']},
          open(OUT + 'photos.json', 'w'), indent=1)
print('ok', len(photos))
