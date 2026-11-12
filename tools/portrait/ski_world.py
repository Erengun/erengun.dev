"""
LOCAL ONLY. Ski photo -> layered gaussian splat + scene metadata for the immersive ski intro.

  python -I ski_world.py clean <photo.jpg> <life_dir>/eren-gun.jpg   (stamp + cable inpaint)
  python -I tools/memories/analyze.py <models> <life_dir>/eren-gun.jpg <analysis_dir>
  python -I ski_world.py <life_dir> <analysis_dir> <out_dir>
    life_dir/eren-gun.jpg (the photo, keep in scratch), analysis_dir from tools/memories/analyze.py

Reuses the memories pipeline (tools/memories/build.py: background inpainted behind the foreground, foreground
relief compressed, quadtree-sized gaussians, extended borders) with a ski config:
  - human matte = u2net person ∪ dark gear (skis, poles, boots) connected below the waist (snow shadows excluded)
  - sky flooded from the top and pushed to the far plane
Writes <out>/ski.splat and <out>/ski.json: pinhole (hfov), zn/zf, ground plane fit (y = a·x + b·z + c in splat
space: camera at origin looking −Z, +Y up), skier centre / feet / height, sky colours (zenith, horizon) for the
procedural world around the capture.
"""
import sys, os, json
import numpy as np
import cv2

if len(sys.argv) > 1 and sys.argv[1] == 'clean':
    # pre-step (run before tools/memories/analyze.py): inpaint the burnt-in date stamp and the ski-lift cable that
    # crosses the sky top-left (it would float as a dark streak in 3D).  python ski_world.py clean <in.jpg> <out.jpg>
    im = cv2.imread(sys.argv[2])
    mk = np.zeros(im.shape[:2], np.uint8)
    mk[435:458, 5:75] = 255
    cv2.line(mk, (0, 136), (88, 196), 255, 5)
    cv2.imwrite(sys.argv[3], cv2.inpaint(im, mk, 6, cv2.INPAINT_TELEA), [cv2.IMWRITE_JPEG_QUALITY, 97])
    sys.exit(0)
LIFE, AN, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(here, '..', 'memories'))
sys.argv = [sys.argv[0], LIFE, AN, OUT]
import build as B  # noqa: E402  (memories pipeline; reads LIFE/AN/OUT from argv)

NAME, SRC = 'ski', 'eren-gun'
img = cv2.cvtColor(cv2.imread(f'{LIFE}/{SRC}.jpg'), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
H, W = img.shape[:2]
d = np.load(f'{AN}/{SRC}.depth.npy')
m = np.load(f'{AN}/{SRC}.human.npy')
STAMP = (5, 435, 75, 458)

# ---- matte: person ∪ gear (skis/poles/boots) below the waist, connected, not bluish snow shadow
core = (m > 0.5).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(core)
if n > 1:
    core = (lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
lum = img @ np.array([0.299, 0.587, 0.114], np.float32)
bluish = (img[..., 2] - img[..., 0]) > 0.07
ys = np.nonzero(core)[0]
waist = int(ys.min() + 0.4 * (ys.max() - ys.min()))
d_person = np.median(d[core > 0])
gear = (lum < 0.36) & ~bluish & (d > d_person - 0.06)   # depth-gated: trees behind him are far, skis/poles are near
gear[:waist] = False
gear[STAMP[1]:STAMP[3], STAMP[0]:STAMP[2]] = False
cand = (gear | (core > 0)).astype(np.uint8)
n, lab = cv2.connectedComponents(cand, connectivity=8)
seed = cv2.dilate(core, np.ones((5, 5), np.uint8)) > 0
keep = np.unique(lab[seed & (cand > 0)]); keep = keep[keep > 0]
full = np.isin(lab, keep).astype(np.float32)
full = cv2.morphologyEx(full, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
np.save(f'{AN}/{SRC}.human.npy', np.maximum(full, m * core).astype(np.float32))

# ---- sky: flood the low-disparity region from the top row (not through the person)
def sky_mask(im, dd):
    hh = dd.shape[0]
    thr = np.percentile(dd[: hh // 3], 60)
    low = (dd <= thr).astype(np.uint8)
    nl, lb = cv2.connectedComponents(low)
    tops = np.unique(lb[0][low[0] > 0]); tops = tops[tops > 0]
    sk = np.isin(lb, tops)
    return cv2.morphologyEx(sk.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

SCALE = 2.0
cfg = dict(src=SRC, scale=SCALE, stamp=STAMP, zn=1.3, zf=70, relief=0.45, n_bg=150_000, n_fg=60_000,
           open_w=0.3, bump_lo=.05, bump_hi=.10, ext=(0.30, 0.18), ext_push=0.35, hole_dilate=13, min_area=0.003,
           far_mask=sky_mask, fg_levels=(2, 1), close_k=7, kmax=4.0)   # low stretch: no treeline smear
# ---- polish: feather the photo's background layer into the procedural world (applied to parts[0] = bg only;
# the skier/skis foreground layer is untouched)
#   - sky splats (far plane) fade radially toward the photo border → no hard band / mirrored extension in the sky
#   - near-snow band at the bottom fades out over a wide band → the procedural snow takes over without a seam
_orig_write = B.write_splat
def _feathered_write(path, parts, seed=7):
    if len(parts) >= 1:
        pos, sc, col, a, q = parts[0]
        z = np.maximum(-pos[:, 2], 1e-3)
        Wp, Hp = SCALE * W, SCALE * H
        fpx = (Wp / 2) / np.tan(np.radians(B.HFOV / 2))
        un = (pos[:, 0] / z * fpx) / (Wp / 2)            # −1..1 across the photo (beyond = extension)
        vn = (-pos[:, 1] / z * fpx) / (Hp / 2)           # −1 top .. +1 bottom
        far = z > cfg['zf'] * 0.8
        r = np.maximum(np.abs(un), np.abs(vn) * 1.1)
        sky_f = 1 - B.smoothstep(0.35, 0.92, r)
        bot_f = 1 - B.smoothstep(0.28, 0.95, vn)        # wide band from below the skis to the bottom edge
        a = a * np.where(far, sky_f, bot_f)
        parts = [(pos, sc, col, a, q)] + list(parts[1:])
    return _orig_write(path, parts, seed)
B.write_splat = _feathered_write

import inspect, textwrap
_src = inspect.getsource(B.build)
_old = _src[_src.index("    hs = 2 if max(H, W) > 700 else 1"):_src.index("    if cfg.get('keep_bg_color')")]
_new = '''    fill = _row_fill((img * 255).astype(np.uint8), hole).astype(np.float32) / 255
    wgt = cv2.GaussianBlur(cv2.dilate(hard, np.ones((9, 9), np.uint8)).astype(np.float32), (0, 0), 4)
    wgt = np.maximum(wgt, cv2.dilate(hard, np.ones((5, 5), np.uint8)).astype(np.float32))
    c_bg = img * (1 - wgt[..., None]) + fill * wgt[..., None]
'''
assert _old in _src
B.__dict__['_row_fill'] = None  # placeholder, set below once defined

# ---- polish: fill the hole behind the skier row by row (clouds, treeline and slope are horizontal structures), with
# texture borrowed from the rows above/below, instead of TELEA's pale vertical smear (it showed as a ghost column
# beside him when the camera orbits), and blend it in with a soft wide ramp instead of the pipeline's hard 5 px ring
# (that ring left a thin crease up through the clouds). Done on a runtime-patched copy of build() — the memories tool
# file itself is not modified.
def _row_fill(src, mask, radius=None, flags=None):
    out = src.astype(np.float32).copy()
    hole = mask > 0
    Hh, Ww = hole.shape
    for y in range(Hh):
        row = hole[y]
        if not row.any():
            continue
        x = 0
        while x < Ww:
            if not row[x]:
                x += 1; continue
            x0 = x
            while x < Ww and row[x]:
                x += 1
            x1 = x   # hole run [x0, x1)
            L = out[y, max(0, x0 - 4):x0].mean(0) if x0 > 0 else None
            R = out[y, x1:min(Ww, x1 + 4)].mean(0) if x1 < Ww else None
            if L is None: L = R
            if R is None: R = L
            if L is None:
                continue
            t = (np.arange(x0, x1) - x0 + 0.5) / max(x1 - x0, 1)
            out[y, x0:x1] = L[None] * (1 - t[:, None]) + R[None] * t[:, None]
    # texture: add high-frequency detail sampled from just outside the hole (vertical neighbours)
    base = cv2.GaussianBlur(src.astype(np.float32), (0, 0), 2)
    detail = (src.astype(np.float32) - base) * (~cv2.dilate(hole.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool))[..., None]   # never borrow the skier's own edges
    shifted = np.roll(detail, 9, axis=0) * 0.5 + np.roll(detail, -9, axis=0) * 0.5
    out = np.where(hole[..., None], out + shifted * 0.6, out)
    out = np.where(hole[..., None], cv2.GaussianBlur(out, (0, 0), 0.8), out)
    return np.clip(out, 0, 255).astype(np.uint8)
B.__dict__['_row_fill'] = _row_fill
exec(compile(_src.replace(_old, _new), B.__file__, 'exec'), B.__dict__)   # B.build now uses the soft row fill
meta = B.build(NAME, SRC, cfg)

# ---- scene metadata for the runtime world (same pinhole as build.py)
img2, d2, m2 = B.load(SRC, None, SCALE, STAMP)
H2, W2 = d2.shape
sky2 = sky_mask(img2, d2) > 0
z2 = B.disp_to_z(np.where(sky2, 0, d2), cfg['zn'], cfg['zf'])
f = (W2 / 2) / np.tan(np.radians(B.HFOV / 2))
cx, cy = (W2 - 1) / 2, (H2 - 1) / 2
vv, uu = np.mgrid[0:H2, 0:W2].astype(np.float32)
X = (uu - cx) / f * z2; Y = -(vv - cy) / f * z2; Z = -z2
person = m2 > 0.5
# ground: snow pixels in the lower 55% of the frame, not person, not sky, near-ish
gsel = (~person) & (~sky2) & (vv > H2 * 0.45) & (z2 < cfg['zf'] * 0.5)
A = np.stack([X[gsel], Z[gsel], np.ones(gsel.sum())], 1)
coef, *_ = np.linalg.lstsq(A, Y[gsel], rcond=None)
# skier: matte centroid / feet / head
pv, pu = np.nonzero(person)
zc = float(np.median(z2[person]))
feet_v = np.percentile(pv, 97); head_v = pv.min()
skier = dict(
    centre=[float((np.median(pu) - cx) / f * zc), float(-(np.median(pv) - cy) / f * zc), -zc],
    feet=[float((np.median(pu[pv > feet_v - 5]) - cx) / f * zc), float(-(feet_v - cy) / f * zc), -zc],
    head=[float((np.median(pu[pv < head_v + 8]) - cx) / f * zc), float(-(head_v - cy) / f * zc), -zc],
)
skyc = img2[sky2]
zen = img2[: max(4, H2 // 12)][sky2[: max(4, H2 // 12)]]
out = dict(meta, ground=[float(c) for c in coef], skier=skier,
           sky_zenith=[float(x) for x in (zen.mean(0) if len(zen) else skyc.mean(0))],
           sky_horizon=[float(x) for x in np.percentile(skyc, 75, axis=0)] if len(skyc) else [0.8, 0.85, 0.9],
           snow=[float(x) for x in np.median(img2[gsel & (img2.mean(-1) > 0.6)], 0)],
           snow_near=[float(x) for x in np.median(img2[gsel & (vv > H2 * 0.75)], 0)],
           snow_shadow=[float(x) for x in np.percentile(img2[gsel & (vv > H2 * 0.6)], 15, axis=0)])
json.dump(out, open(f'{OUT}/{NAME}.json', 'w'), indent=1)
print(json.dumps({k: out[k] for k in ('ground', 'skier', 'sky_zenith', 'sky_horizon', 'snow', 'n_bg', 'n_fg')}, indent=1))
