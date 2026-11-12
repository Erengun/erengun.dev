"""
LOCAL ONLY. Ski photo -> scene frames (colour + depth + matte) for the intro voxel portrait.

  python ski_scene.py <photo> <out_dir> --seg u2net_human_seg.onnx --depth depth_anything_v2_small.onnx
         [--n 221] [--up 3] [--stamp x0 y0 x1 y1] [--frames 2]

  1. upscale (Lanczos ×up + unsharp mask) — the source is 460², depth/matte work better on the upscaled image
  2. inpaint the date stamp (--stamp, source px)
  3. skier matte (u2net human seg, largest blob only, small hole close)
  4. scene depth (Depth Anything V2): slope / treeline layered, sky (lowest depth) removed → 0 (empty in the grid);
     the skier is lifted a bit in front of the snow behind him so the silhouette is a clean depth edge
  5. writes color_XXX.png, depth_XXX.png (16-bit) and edges_XXX.png (= skier matte, packed into data.B by pack.py)
Motion is done at runtime (camera drift / orbit), so the frames are identical stills (≥2 for the ping-pong player).
"""
import argparse, os, sys
import numpy as np
import cv2
from PIL import Image, ImageOps, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from infer import person_mask, rel_depth

ap = argparse.ArgumentParser()
ap.add_argument('photo'); ap.add_argument('out')
ap.add_argument('--seg', required=True); ap.add_argument('--depth', required=True)
ap.add_argument('--n', type=int, default=221)
ap.add_argument('--up', type=int, default=3)
ap.add_argument('--stamp', nargs=4, type=int, default=None)
ap.add_argument('--frames', type=int, default=2)
ap.add_argument('--sky-pct', dest='sky_pct', type=float, default=0.0, help='extra depth threshold above the sky level')
ap.add_argument('--lift', type=float, default=0.10, help='depth lift of the skier over the snow behind him')
ap.add_argument('--gear-luma', dest='gear_luma', type=float, default=0.36, help='luma below which skis/poles join the matte')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

im = ImageOps.exif_transpose(Image.open(a.photo)).convert('RGB')
W0, H0 = im.size
big = im.resize((W0 * a.up, H0 * a.up), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=2, percent=80, threshold=2))
rgb = np.array(big)
if a.stamp:
    x0, y0, x1, y1 = [v * a.up for v in a.stamp]
    sm = np.zeros(rgb.shape[:2], np.uint8); sm[y0:y1, x0:x1] = 255
    rgb = cv2.inpaint(rgb, sm, 7, cv2.INPAINT_TELEA)
H, W = rgb.shape[:2]

# skier matte
m = person_mask(rgb, a.seg) > 0.5
nl, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8))
if nl > 1:
    m = lab == (1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])))
m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
body = m.copy()
# skis + poles: u2net leaves them out. Add dark gear (skis, poles, boots) below the waist that connects to the skier
lum = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
ys_ = np.nonzero(m)[0]
waist = int(ys_.min() + (ys_.max() - ys_.min()) * 0.40) if len(ys_) else H
rgbf = rgb.astype(np.float32) / 255
bluish = (rgbf[..., 2] - rgbf[..., 0]) > 0.07          # snow shadows are blue; skis/poles/boots are not
gear = (lum < a.gear_luma) & ~bluish
gear[:waist] = False
seed = cv2.dilate(m.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
cand = (gear | (m > 0)).astype(np.uint8)
nl, lab = cv2.connectedComponents(cand, connectivity=8)
keep = np.unique(lab[seed & (cand > 0)]); keep = keep[keep > 0]
m = np.isin(lab, keep).astype(np.uint8)
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
mf = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.5)

# scene depth
d = rel_depth(rgb, a.depth, size=644)
# sky: blue-ish/bright in the upper part with the lowest depth; flood from the top rows over low-depth pixels
lo = np.percentile(d, 2); hi = np.percentile(d, 99.5)
dn = np.clip((d - lo) / (hi - lo), 0, 1)
sky_thr = np.percentile(dn[: H // 3], 60) + a.sky_pct
skyc = (dn <= sky_thr).astype(np.uint8)
nl, lab = cv2.connectedComponents(skyc)
top_labels = np.unique(lab[0][skyc[0] > 0])
sky = np.isin(lab, top_labels[top_labels > 0]) & (m == 0)
sky = cv2.morphologyEx(sky.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0
# remap the remaining scene to .36..1 (just above the voxel cutoff), skier lifted
ground = ~sky
g = dn[ground]
glo, ghi = np.percentile(g, 1), np.percentile(g, 99.7)
sc = np.clip((dn - glo) / (ghi - glo), 0, 1)
sc = cv2.bilateralFilter(sc.astype(np.float32), 9, 0.08, 6)
depth = 0.37 + 0.63 * sc
bodyf = cv2.GaussianBlur(body.astype(np.float32), (0, 0), 1.5)
depth = np.clip(depth + a.lift * bodyf, 0, 1)   # lift the body only: skis/poles stay on the snow (no floating blobs)
depth[sky] = 0.0

# square crop is the whole (square) photo; resize to N
N = a.n
col = cv2.resize(rgb, (N, N), interpolation=cv2.INTER_AREA)
dep = cv2.resize(depth.astype(np.float32), (N, N), interpolation=cv2.INTER_NEAREST)
skyN = cv2.resize(sky.astype(np.uint8), (N, N), interpolation=cv2.INTER_NEAREST) > 0
dep[skyN] = 0
mat = cv2.resize(mf, (N, N), interpolation=cv2.INTER_AREA)
col[skyN] = 0
for i in range(a.frames):
    Image.fromarray(col).save(os.path.join(a.out, f'color_{i:03d}.png'))
    Image.fromarray((dep.clip(0, 1) * 65535).round().astype(np.uint16)).save(os.path.join(a.out, f'depth_{i:03d}.png'))
    Image.fromarray((mat.clip(0, 1) * 255).round().astype(np.uint8)).save(os.path.join(a.out, f'edges_{i:03d}.png'))
# previews (scratch)
Image.fromarray((np.dstack([rgb * (0.3 + 0.7 * mf[..., None])])).astype(np.uint8)).resize((690, 690)).save(os.path.join(a.out, 'prev_matte.png'))
Image.fromarray((depth * 255).astype(np.uint8)).resize((690, 690)).save(os.path.join(a.out, 'prev_depth.png'))
print('ok', N, 'sky frac', round(float(sky.mean()), 3))
