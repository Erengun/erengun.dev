"""
Pack the rendered portrait frames into runtime atlases (run with `python3 -I pack.py <frames_dir> <out_dir>`).

out/color.webp     colour frames (lossy), COLS x ROWS grid of N x N cells
out/data.webp      lossless: R = depth (near = 1), G = min depth of the 8 neighbours + self, B = 0
out/quadtree.webp  lossless: per-frame quadtree leaf level (0..MAXD) * 60 on a QW x QH grid (Q* = ROOTS_* * 2^MAXD)
out/meta.json      layout + quadtree params

Quadtree: ROOTS_X x ROOTS_Y (12 x 7, ~16:9 as if the source were a landscape video: on the square voxel plane the root
cells come out tall, like the reference's) root cells over the frame; a node splits while the depth range or luma range inside it is
above a threshold: the depth test uses the residual from a best-fit plane, so smooth slopes stay coarse and only
silhouettes / creases (nose, brows, lips, hairline, jaw) refine; flat background stays at root level.
"""
import sys, os, json, glob
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
colors = sorted(glob.glob(os.path.join(src, 'color_*.png')))
depths = sorted(glob.glob(os.path.join(src, 'depth_*.png')))
F = len(colors)
N = Image.open(colors[0]).size[0]
COLS = 8
ROWS = (F + COLS - 1) // COLS
ROOTS_X, ROOTS_Y, MAXD = 12, 7, 4
QW, QH = ROOTS_X * 2 ** MAXD, ROOTS_Y * 2 ** MAXD  # 192 x 112
LEVEL_SCALE = 60
D_SPLIT, L_SPLIT = 0.016, 0.25   # plane-fit residual (depth), luma range

col_atlas = Image.new('RGB', (COLS * N, ROWS * N))
dat_atlas = np.zeros((ROWS * N, COLS * N, 3), np.uint8)
qt_atlas = np.zeros((ROWS * QH, COLS * QW), np.uint8)

def plane_residual(d):
    """max |d - best-fit plane|: sloped but smooth regions stay coarse, creases/silhouettes split."""
    h, w = d.shape
    if h < 2 or w < 2:
        return 0.0
    yy, xx = np.mgrid[0:h, 0:w]
    A = np.stack([np.ones(h * w), xx.ravel(), yy.ravel()], 1)
    coef, *_ = np.linalg.lstsq(A, d.ravel(), rcond=None)
    return float(np.abs(d.ravel() - A @ coef).max())

def quadtree(depth, luma):
    lv = np.zeros((QH, QW), np.uint8)
    def rec(x, y, s, level):
        if level >= MAXD:
            lv[y:y + s, x:x + s] = level
            return
        d = depth[y:y + s, x:x + s]
        l = luma[y:y + s, x:x + s]
        if (plane_residual(d) > D_SPLIT) or (l.max() - l.min() > L_SPLIT):
            h = s // 2
            for (ox, oy) in ((0, 0), (1, 0), (0, 1), (1, 1)):
                rec(x + ox * h, y + oy * h, h, level + 1)
        else:
            lv[y:y + s, x:x + s] = level
    S = 2 ** MAXD
    for j in range(ROOTS_Y):
        for i in range(ROOTS_X):
            rec(i * S, j * S, S, 0)
    return lv

for k, (cp, dp) in enumerate(zip(colors, depths)):
    cx, cy = (k % COLS), (k // COLS)
    c = Image.open(cp).convert('RGB')
    col_atlas.paste(c, (cx * N, cy * N))
    d16 = np.array(Image.open(dp)).astype(np.float64)
    if d16.ndim == 3:
        d16 = d16[..., 0]
    d = d16 / (65535.0 if d16.max() > 255 else 255.0)
    pad = np.pad(d, 1, mode='edge')
    nmin = np.min([pad[1 + oy:1 + oy + N, 1 + ox:1 + ox + N] for oy in (-1, 0, 1) for ox in (-1, 0, 1)], axis=0)
    dat_atlas[cy * N:(cy + 1) * N, cx * N:(cx + 1) * N, 0] = np.round(d * 255)
    dat_atlas[cy * N:(cy + 1) * N, cx * N:(cx + 1) * N, 1] = np.round(nmin * 255)
    # quadtree on a QW x QH resample (nearest for depth, bilinear for luma)
    dq = np.array(Image.fromarray((d * 255).astype(np.uint8)).resize((QW, QH), Image.NEAREST)).astype(float) / 255
    lq = np.array(c.convert('L').resize((QW, QH), Image.BILINEAR)).astype(float) / 255
    qt_atlas[cy * QH:(cy + 1) * QH, cx * QW:(cx + 1) * QW] = quadtree(dq, lq) * LEVEL_SCALE

col_atlas.save(os.path.join(out, 'color.webp'), 'WEBP', quality=88, method=6)
Image.fromarray(dat_atlas).save(os.path.join(out, 'data.webp'), 'WEBP', lossless=True, method=6)
Image.fromarray(qt_atlas).convert('RGB').save(os.path.join(out, 'quadtree.webp'), 'WEBP', lossless=True, method=6)
meta = dict(frames=F, size=N, cols=COLS, rows=ROWS, fps=30, quadtree=dict(rootsX=ROOTS_X, rootsY=ROOTS_Y, maxDepth=MAXD, w=QW, h=QH, levelScale=LEVEL_SCALE))
json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'))
print(meta, {f: os.path.getsize(os.path.join(out, f)) for f in os.listdir(out)})
