"""
Photo -> portrait frames (colour + depth) for the intro glitch portrait. LOCAL ONLY: the photo never leaves the
machine (ONNX models run on the CPU via onnxruntime). The photo itself is not stored in the repo; only the derived
low-res atlases written by tools/blender/portrait/pack.py end up in public/portrait/.

  python from_photo.py <photo> <out_dir> --seg u2net_human_seg.onnx --depth depth_anything_v2_small.onnx
         [--crop x0 y0 size] [--exclude x0 y0 x1 y1 ...] [--n 221] [--frames 54]

Pipeline: person mask (u2net human seg, minus --exclude rects, e.g. a raised hand) -> relative depth (Depth Anything
V2 Small) -> square crop -> depth normalised to near = 1 / subject far ≈ .4 / background 0, edge-preserving smoothing
-> a subtle ping-pong loop synthesised by re-projecting colour+depth: a small head turn/nod (the head region only; the
collar stays put) + breathing, forward-splatted with a z-buffer at 3x supersampling (no smearing at the silhouette).
Writes color_XXX.png / depth_XXX.png (16-bit) like the Blender bust script, so pack.py works unchanged.
"""
import argparse, os, sys, math
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from infer import person_mask, rel_depth

ap = argparse.ArgumentParser()
ap.add_argument('photo'); ap.add_argument('out')
ap.add_argument('--seg', required=True); ap.add_argument('--depth', required=True)
ap.add_argument('--crop', nargs=3, type=int)
ap.add_argument('--exclude', nargs='*', type=int, default=[])
ap.add_argument('--n', type=int, default=221)
ap.add_argument('--frames', type=int, default=54)
ap.add_argument('--yaw', type=float, default=3.0)
ap.add_argument('--nod', type=float, default=1.0)
ap.add_argument('--neck', nargs=2, type=float, default=[0.80, 0.92], help='head→body blend band (crop-relative y)')
ap.add_argument('--preview', action='store_true')
ap.add_argument('--hair-flood', dest='hair_flood', type=int, default=0, help='px band for the dark-hair matte growth (0 = off)')
ap.add_argument('--save-mask', dest='save_mask', default='', help='write the final (cropped) matte preview here')
ap.add_argument('--line-px', dest='line_px', type=int, default=9, help='top/black-hat kernel (supersampled px)')
ap.add_argument('--prior', type=float, default=0.0, help='0..1 blend toward dome prior + model detail')
ap.add_argument('--detail', type=float, default=1.4, help='gain of the model\'s high-frequency depth detail')
ap.add_argument('--scale', type=float, default=1.0, help='working downscale of the (EXIF-rotated) photo; crop/exclude are in scaled px')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

from PIL import ImageOps
_im = ImageOps.exif_transpose(Image.open(a.photo)).convert('RGB')     # phone photos carry EXIF rotation
if a.scale != 1:
    _im = _im.resize((round(_im.width * a.scale), round(_im.height * a.scale)), Image.LANCZOS)
rgb = np.array(_im)
mask = person_mask(rgb, a.seg)
if a.hair_flood > 0:
    # hair matte: the segmenter trims curl tips against a bright sky. Add dark pixels (hair-coloured) that connect to
    # the person within a band around the upper silhouette, then close the matte.
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    core = (mask > 0.5).astype(np.uint8)
    band = cv2.dilate(core, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (a.hair_flood, a.hair_flood))) > 0
    upper = np.zeros_like(band); ys_ = np.nonzero(core)[0]
    if len(ys_):
        top = ys_.min(); upper[: int(top + (ys_.max() - top) * 0.45)] = True
    dark = (g < 0.32) & band & upper
    cand = (dark | (core > 0)).astype(np.uint8)
    nl, lab = cv2.connectedComponents(cand)
    keep = np.unique(lab[core > 0]); keep = keep[keep > 0]
    grown = np.isin(lab, keep)
    grown = cv2.morphologyEx(grown.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    mask = np.maximum(mask, grown.astype(np.float32))
x0, y0, sz = a.crop if a.crop else (0, 0, min(rgb.shape[:2]))
# depth on the (padded) crop: much more facial detail than running on the whole photo
H, Wd = rgb.shape[:2]
p0x, p0y = max(0, x0 - 40), max(0, y0 - 40)
p1x, p1y = min(Wd, x0 + sz + 40), min(H, y0 + sz + 40)
depth = np.zeros(rgb.shape[:2], np.float32)
depth[p0y:p1y, p0x:p1x] = rel_depth(np.ascontiguousarray(rgb[p0y:p1y, p0x:p1x]), a.depth, size=644)
ex = a.exclude
for i in range(0, len(ex), 4):
    ex0, ey0, ex1, ey1 = ex[i:i + 4]
    mask[ey0:ey1, ex0:ex1] = 0

S = a.n * 3  # supersampled working resolution
crop = lambda img, interp: cv2.resize(img[y0:y0 + sz, x0:x0 + sz], (S, S), interpolation=interp)
col = crop(rgb, cv2.INTER_AREA).astype(np.float32) / 255
m = crop(mask, cv2.INTER_LINEAR)
d = crop(depth, cv2.INTER_CUBIC)

# keep the largest connected person blob (drops leftovers of the excluded hand)
mb = (m > 0.5).astype(np.uint8)
nlab, lab, stats, _ = cv2.connectedComponentsWithStats(mb)
if nlab > 1:
    keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mb = (lab == keep).astype(np.uint8)
mb = cv2.erode(mb, np.ones((3, 3), np.uint8))  # pull in 1 px: no background halo on the silhouette
if a.save_mask:
    pv = (col * (0.25 + 0.75 * mb[..., None]) * 255).astype(np.uint8)
    Image.fromarray(pv).save(a.save_mask)

# depth: normalise inside the subject, smooth (edge-preserving), near = 1, subject far ≈ .4
rows = np.arange(S)[:, None] / S
bodyw = np.clip((rows - a.neck[0]) / (a.neck[1] - a.neck[0]), 0, 1)
bodyw = bodyw * bodyw * (3 - 2 * bodyw)
head = (mb > 0) & (rows < a.neck[0])
lo, hi = np.percentile(d[head], 1.0), np.percentile(d[head], 99.8)   # normalise on the head (face = nearest)
dn = np.clip((d - lo) / (hi - lo), -0.2, 1.2)
dn = cv2.bilateralFilter(dn.astype(np.float32), 9, 0.08, 5)
dn = cv2.GaussianBlur(dn, (0, 0), 1.0)
if a.prior > 0:
    # low frequencies from a rounded dome (distance transform of the subject mask, peaks mid-face),
    # high frequencies (nose, brows, glasses, lips) from the depth model: calm relief, nose nearest, no big chin
    dt = cv2.distanceTransform(mb, cv2.DIST_L2, 5)
    dt = cv2.GaussianBlur(dt, (0, 0), S * 0.02)
    dome = np.sqrt(np.clip(dt / max(dt[rows[:, 0] < a.neck[0]].max(), 1e-6), 0, 1))
    hf = dn - cv2.GaussianBlur(dn, (0, 0), S * 0.05)
    dn = (1 - a.prior) * dn + a.prior * (dome * 0.9 + hf * a.detail)
dn = dn - 0.35 * bodyw                     # the collar/chest sits behind the face, like a bust
dn = 0.40 + 0.60 * np.clip(dn, 0, 1)
dn[mb == 0] = 0

# thin-line map (glasses frames, brows, lids, moustache edge): morphological top-hat + black-hat on luma at the
# supersampled resolution, normalised; pack.py uses it as an extra quadtree split criterion (edges_XXX.png)
lum = cv2.cvtColor((col * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (a.line_px, a.line_px))
line = np.maximum(cv2.morphologyEx(lum, cv2.MORPH_TOPHAT, kern), cv2.morphologyEx(lum, cv2.MORPH_BLACKHAT, kern))
line = cv2.GaussianBlur(line, (0, 0), 0.8)
line = np.clip(line / max(np.percentile(line[mb > 0], 99.5), 1e-6), 0, 1) * (mb > 0)
col4 = np.dstack([col, line]).astype(np.float32)

ys, xs = np.nonzero(mb)
cx = float(np.median(xs[ys < S * 0.6]))  # head centre (upper part of the crop)
cy = S * 0.42
ZR = 0.45 * S                             # depth span in pixel units (believable head relief)
z = (1 - dn) * ZR
zc = (1 - 0.55) * ZR                      # rotation axis behind the face

def frame(t):
    e = 0.5 - 0.5 * math.cos(math.pi * t)  # ping-pong friendly (zero velocity at the ends)
    yaw = math.radians(-a.yaw + 2 * a.yaw * e)
    nod = math.radians(a.nod * math.sin(math.pi * t))
    breathe = 1 + 0.006 * math.sin(math.pi * t)
    yy, xx = np.nonzero(mb)
    zz = z[yy, xx]
    w = 1 - np.clip((yy / S - a.neck[0]) / (a.neck[1] - a.neck[0]), 0, 1)  # head turns, collar stays
    w = w * w * (3 - 2 * w)
    ya, na = yaw * w, nod * w
    X = xx - cx; Y = yy - cy; Zp = zz - zc
    X2 = X * np.cos(ya) - Zp * np.sin(ya)
    Z2 = X * np.sin(ya) + Zp * np.cos(ya)
    Y2 = Y * np.cos(na) + Z2 * np.sin(na)
    Z3 = -Y * np.sin(na) + Z2 * np.cos(na)
    ox = (cx + X2 * breathe) / S * (2 * a.n)
    oy = (cy + Y2 * breathe) / S * (2 * a.n)
    oz = Z3 + zc
    ix, iy = np.round(ox).astype(int), np.round(oy).astype(int)
    ok = (ix >= 0) & (iy >= 0) & (ix < 2 * a.n) & (iy < 2 * a.n)
    ix, iy, oz = ix[ok], iy[ok], oz[ok]
    c = col4[yy[ok], xx[ok]]
    order = np.argsort(-oz)  # far first, near last (near wins)
    G = 2 * a.n
    cbuf = np.zeros((G, G, 4), np.float32)
    zbuf = np.full((G, G), np.inf, np.float32)
    cbuf[iy[order], ix[order]] = c[order]
    zbuf[iy[order], ix[order]] = oz[order]
    hit = np.isfinite(zbuf).astype(np.uint8)
    # close pinholes inside the subject (not the background)
    closed = cv2.morphologyEx(hit, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    holes = (closed > 0) & (hit == 0)
    if holes.any():
        zf = np.where(hit > 0, zbuf, 0).astype(np.float32)
        nb = cv2.blur(hit.astype(np.float32), (3, 3)) + 1e-6
        zf = cv2.blur(zf, (3, 3)) / nb
        cf = cv2.blur(cbuf, (3, 3)) / nb[..., None]
        zbuf[holes] = zf[holes]
        cbuf[holes] = cf[holes]
        hit = closed
    # drop isolated splats at the trailing silhouette (far-edge hair spray during the turn)
    hit = cv2.morphologyEx(hit.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    nl, lab = cv2.connectedComponents(hit)
    if nl > 2:
        sizes = np.bincount(lab.ravel()); sizes[0] = 0
        hit = (lab == sizes.argmax()).astype(np.uint8)
    dz = np.where(hit > 0, 1 - zbuf / ZR, 0).clip(0, 1)
    # 2x2 down: colour = mask-aware mean; depth = subject depth where >= 2 of 4 samples are subject
    h4 = hit.reshape(a.n, 2, a.n, 2).sum((1, 3)).astype(np.float32)
    csum = (cbuf * hit[..., None]).reshape(a.n, 2, a.n, 2, 4).sum((1, 3))
    cout = csum / np.maximum(h4, 1)[..., None]
    dsum = (dz * hit).reshape(a.n, 2, a.n, 2).sum((1, 3))
    dout = np.where(h4 >= 2, dsum / np.maximum(h4, 1), 0)
    return cout, dout

F = 1 if a.preview else a.frames
for i in range(F):
    t = i / max(F - 1, 1)
    c4, dd = frame(t)
    c = c4[..., :3]
    Image.fromarray((c.clip(0, 1) * 255).round().astype(np.uint8)).save(os.path.join(a.out, f'color_{i:03d}.png'))
    Image.fromarray((c4[..., 3].clip(0, 1) * 255).round().astype(np.uint8)).save(os.path.join(a.out, f'edges_{i:03d}.png'))
    Image.fromarray((dd.clip(0, 1) * 65535).round().astype(np.uint16)).save(os.path.join(a.out, f'depth_{i:03d}.png'))
print('frames', F, 'n', a.n, 'crop', (x0, y0, sz))
