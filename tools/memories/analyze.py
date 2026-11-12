"""Stage 1: monocular depth (Depth Anything V2 Small, ONNX) + human matte (u2net_human_seg, ONNX).
Runs fully locally. Usage: python analyze.py <models_dir> <photo> <out_dir>
Writes <out>/<stem>.depth.npy (relative disparity, larger = nearer, 0..1) and <stem>.human.npy (0..1 matte).
"""
import sys, os, numpy as np, cv2, onnxruntime as ort

models, photo, out = sys.argv[1], sys.argv[2], sys.argv[3]
stem = os.path.splitext(os.path.basename(photo))[0]
img = cv2.cvtColor(cv2.imread(photo), cv2.COLOR_BGR2RGB)
H, W = img.shape[:2]
MEAN, STD = np.array([0.485, 0.456, 0.406]), np.array([0.229, 0.224, 0.225])

def depth_at(im, long_side):
    h, w = im.shape[:2]
    s = long_side / max(h, w)
    nh, nw = int(round(h * s / 14)) * 14, int(round(w * s / 14)) * 14
    x = cv2.resize(im, (nw, nh), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
    x = ((x - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
    d = sess.run(None, {'pixel_values': x})[0][0]
    return cv2.resize(d, (W, H), interpolation=cv2.INTER_CUBIC)

sess = ort.InferenceSession(os.path.join(models, 'onnx/model.onnx'))
# two scales: global layout from 518, finer edges from 770; blend in the gradient domain cheaply
d1 = depth_at(img, 518)
d2 = depth_at(img, 770)
lo, hi = np.percentile(d1, 0.5), np.percentile(d1, 99.5)
d2 = (d2 - np.percentile(d2, .5)) / (np.percentile(d2, 99.5) - np.percentile(d2, .5)) * (hi - lo) + lo
low = cv2.GaussianBlur(d1, (0, 0), 12)
d = low + (d2 - cv2.GaussianBlur(d2, (0, 0), 12))
d = np.clip((d - lo) / (hi - lo), 0, 1)
np.save(f'{out}/{stem}.depth.npy', d.astype(np.float32))

seg = ort.InferenceSession(os.path.join(models, 'u2net_human_seg.onnx'))
def matte(im):
    x = cv2.resize(im, (320, 320), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    x = ((x - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
    m = seg.run(None, {'input.1': x})[0][0, 0]
    m = (m - m.min()) / (m.max() - m.min() + 1e-6)
    return cv2.resize(m, (im.shape[1], im.shape[0]), interpolation=cv2.INTER_CUBIC)
# whole image + 2x2 overlapping tiles (max) so group shots get finer mattes
m = matte(img)
th, tw = int(H * .6), int(W * .6)
acc = np.zeros((H, W), np.float32)
for y0 in (0, H - th):
    for x0 in (0, W - tw):
        acc[y0:y0 + th, x0:x0 + tw] = np.maximum(acc[y0:y0 + th, x0:x0 + tw], matte(img[y0:y0 + th, x0:x0 + tw]))
m = np.clip(np.maximum(m, acc * (m > .05)), 0, 1)
try:
    m = cv2.ximgproc.guidedFilter(img, (m * 255).astype(np.uint8), 4, 200).astype(np.float32) / 255
except Exception as e:
    print('no guided filter', e)
np.save(f'{out}/{stem}.human.npy', np.clip(m, 0, 1).astype(np.float32))
viz = np.concatenate([img, np.repeat((d[..., None] * 255).astype(np.uint8), 3, 2), np.repeat((m[..., None] * 255).clip(0, 255).astype(np.uint8), 3, 2)], 1)
cv2.imwrite(f'{out}/{stem}.viz.jpg', cv2.cvtColor(cv2.resize(viz, (900 * 3 * W // max(W,H) // 1, 900 * H // max(W,H))), cv2.COLOR_RGB2BGR))
print(stem, W, H, 'ok')
