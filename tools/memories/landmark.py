"""print capture-frame 3D points for photo pixels: python landmark.py <public/memories> <analysis_dir> name fx,fy [fx,fy ...]
(fx,fy = fractions of the processed photo; uses the bg-layer depth mapping, so fg points are approximate)"""
import sys, json, numpy as np
out, an, name = sys.argv[1], sys.argv[2], sys.argv[3]
m = json.load(open(f'{out}/meta.json'))[name]
import cv2
d = np.load(f'{an}/{m["src"]}.depth.npy')
for a in sys.argv[4:]:
    fx, fy = map(float, a.split(','))
    H0, W0 = d.shape
    dd = float(d[int(fy * (H0 - 1)), int(fx * (W0 - 1))])
    z = 1 / (dd * (1 / m['zn'] - 1 / m['zf']) + 1 / m['zf'])
    u = m['px'] + fx * (m['W'] - 1); v = m['py'] + fy * (m['H'] - 1)
    cx, cy = m['px'] + (m['W'] - 1) / 2, m['py'] + (m['H'] - 1) / 2
    print(a, 'disp %.3f' % dd, 'P = (%.2f, %.2f, %.2f)' % ((u - cx) / m['f'] * z, -(v - cy) / m['f'] * z, -z))
