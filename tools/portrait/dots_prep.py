"""
LOCAL ONLY. Frame (colour/depth/matte from from_photo.py or ski_scene.py) -> dot-matrix data texture.

  python dots_prep.py <frames_dir> <frame_idx> <out.png> --mode face|scene [--cols 128]

out.png (cols x cols, RGBA, lossless):
  R = LED intensity 0..1: subject = floor + local-contrast luma (CLAHE) + edge emphasis (hair, glasses rims,
      moustache/beard edges survive at ~128 columns); scene background dimmed; empty background 0
  G = depth (near = 1, 0 = empty)
  B = edge strength (feature contours: brighter dots / glyph candidates)
  A = subject matte
"""
import argparse, os
import numpy as np
import cv2
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('frames'); ap.add_argument('idx', type=int); ap.add_argument('out')
ap.add_argument('--mode', choices=['face', 'scene'], default='face')
ap.add_argument('--cols', type=int, default=128)
ap.add_argument('--floor', type=float, default=0.12, help='minimum intensity inside the subject (dark hair still lit)')
a = ap.parse_args()

col = np.array(Image.open(os.path.join(a.frames, f'color_{a.idx:03d}.png')).convert('RGB'))
dep = np.array(Image.open(os.path.join(a.frames, f'depth_{a.idx:03d}.png'))).astype(np.float32)
dep = dep / (65535.0 if dep.max() > 255 else 255.0)
S = col.shape[0]
if a.mode == 'scene':
    matte = np.array(Image.open(os.path.join(a.frames, f'edges_{a.idx:03d}.png')).convert('L')).astype(np.float32) / 255
else:
    matte = (dep > 0.05).astype(np.float32)
present = (dep > 0.05).astype(np.float32)

# work at 4x the dot grid for clean area sampling
W = a.cols * 4
up = lambda x, i=cv2.INTER_CUBIC: cv2.resize(x, (W, W), interpolation=i)
g = cv2.cvtColor(col, cv2.COLOR_RGB2GRAY)
g = up(g)
clahe = cv2.createCLAHE(clipLimit=2.6, tileGridSize=(8, 8))
gl = clahe.apply(g).astype(np.float32) / 255
sharp = np.clip(gl + 0.8 * (gl - cv2.GaussianBlur(gl, (0, 0), 3)), 0, 1)
# edges: gradient magnitude of the smoothed luma (features), normalised inside the subject
gx = cv2.Sobel(cv2.GaussianBlur(gl, (0, 0), 1.2), cv2.CV_32F, 1, 0)
gy = cv2.Sobel(cv2.GaussianBlur(gl, (0, 0), 1.2), cv2.CV_32F, 0, 1)
edge = np.sqrt(gx * gx + gy * gy)
m4 = up(matte, cv2.INTER_LINEAR)
p4 = up(present, cv2.INTER_NEAREST)
edge = np.clip(edge / max(np.percentile(edge[m4 > 0.5], 97), 1e-6), 0, 1) if (m4 > 0.5).any() else edge * 0
# silhouette outline of the subject
sil = cv2.morphologyEx((m4 > 0.5).astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((5, 5), np.uint8)).astype(np.float32)

if a.mode == 'face':
    inten = m4 * (a.floor + (1 - a.floor) * sharp ** 1.5)
else:
    inten = p4 * sharp * (0.30 + 0.70 * m4) + m4 * a.floor * 0.5
inten = np.clip(inten + 0.45 * edge * m4 + 0.35 * sil, 0, 1)
d4 = up(dep, cv2.INTER_LINEAR) * p4

down = lambda x: cv2.resize(x, (a.cols, a.cols), interpolation=cv2.INTER_AREA)
# B = 'ink': dark features inside the subject (hair, brows, moustache, beard, eye areas) + feature edges. The runtime
# draws ink cells as dense dot-font glyphs (ASCII-art logic) so dark features read as texture, never as holes.
dark = np.clip((0.42 - sharp) / 0.30, 0, 1) * m4
ink = np.maximum(dark, 0.75 * edge * m4)
out = np.dstack([down(inten), down(d4), down(ink), down(m4)])
Image.fromarray((out.clip(0, 1) * 255).round().astype(np.uint8), 'RGBA').save(a.out)
# preview (scratch): intensity as halftone-ish
pv = (np.kron(down(inten), np.ones((4, 4))) * 255).astype(np.uint8)
Image.fromarray(pv).save(os.path.splitext(a.out)[0] + '_preview.png') if os.environ.get('DOTS_PREVIEW') else None
print('ok', a.out, out.shape)
