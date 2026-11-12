"""
LOCAL ONLY. Prepare the inputs for the 3D head fit (tools/blender/portrait/head3d.py):
  - 478 face landmarks (MediaPipe Face Landmarker, local .task model) in photo pixel coords (+ relative z)
  - a texture: the photo with the background replaced by the person's own colours (push-pull fill), so the frontal
    projection on the head sides/ears never picks up sky or street
Outputs go to <out_dir> (keep it in scratch: they are derived from the private photo).

  python face_prep.py <photo> <out_dir> --landmarker face_landmarker.task --seg u2net_human_seg.onnx [--scale .25]
"""
import argparse, json, os, sys
import numpy as np
import cv2
from PIL import Image, ImageOps
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from infer import person_mask

ap = argparse.ArgumentParser()
ap.add_argument('photo'); ap.add_argument('out')
ap.add_argument('--landmarker', required=True); ap.add_argument('--seg', required=True)
ap.add_argument('--scale', type=float, default=0.25)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

im = ImageOps.exif_transpose(Image.open(a.photo)).convert('RGB')
im = im.resize((round(im.width * a.scale), round(im.height * a.scale)), Image.LANCZOS)
rgb = np.ascontiguousarray(np.array(im))
H, W = rgb.shape[:2]

det = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
    base_options=mpt.BaseOptions(model_asset_path=a.landmarker), num_faces=1))
res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
lm = res.face_landmarks[0]
pts = [[p.x * W, p.y * H, p.z * W] for p in lm]   # z is in the same scale as x (image-width units)
oval = sorted({i for c in vision.FaceLandmarksConnections.FACE_LANDMARKS_FACE_OVAL for i in (c.start, c.end)})
def idx(conns):
    return sorted({i for c in conns for i in (c.start, c.end)})
C = vision.FaceLandmarksConnections
json.dump(dict(w=W, h=H, points=pts, oval=oval,
               left_eye=idx(C.FACE_LANDMARKS_LEFT_EYE), right_eye=idx(C.FACE_LANDMARKS_RIGHT_EYE),
               left_brow=idx(C.FACE_LANDMARKS_LEFT_EYEBROW), right_brow=idx(C.FACE_LANDMARKS_RIGHT_EYEBROW),
               lips=idx(C.FACE_LANDMARKS_LIPS)),
          open(os.path.join(a.out, 'landmarks.json'), 'w'))

# texture: push-pull fill of the background with the person's colours
m = person_mask(rgb, a.seg) > 0.5
m = cv2.erode(m.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
img = rgb.astype(np.float32) / 255
def pushpull(c, w):
    if min(c.shape[:2]) <= 4:
        s = w.sum()
        return np.broadcast_to((c * w[..., None]).sum((0, 1)) / max(s, 1e-6), c.shape).copy()
    cs = cv2.resize(c * w[..., None], (c.shape[1] // 2, c.shape[0] // 2), interpolation=cv2.INTER_AREA)
    ws = cv2.resize(w, (c.shape[1] // 2, c.shape[0] // 2), interpolation=cv2.INTER_AREA)
    coarse = pushpull(cs / np.maximum(ws, 1e-6)[..., None], np.minimum(ws * 4, 1))
    up = cv2.resize(coarse, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_LINEAR)
    return c * w[..., None] + up * (1 - w[..., None])
tex = pushpull(img, m.astype(np.float32))

# remove the painted glasses frames from the texture (real frame geometry is added in Blender): thin top/black-hat
# lines inside a box around both eyes, inpainted
P = np.array(pts)
eyes = P[C_eyes := idx(C.FACE_LANDMARKS_LEFT_EYE) + idx(C.FACE_LANDMARKS_RIGHT_EYE)]
ex0, ey0 = eyes[:, 0].min(), eyes[:, 1].min()
ex1, ey1 = eyes[:, 0].max(), eyes[:, 1].max()
ew = ex1 - ex0
bx0, bx1 = int(ex0 - 0.40 * ew), int(ex1 + 0.40 * ew)
by0, by1 = int(ey0 - 0.30 * ew), int(ey1 + 0.30 * ew)
g = cv2.cvtColor((tex * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
line = np.maximum(cv2.morphologyEx(g, cv2.MORPH_TOPHAT, k), cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, k)).astype(np.float32)
box = np.zeros_like(g, bool); box[by0:by1, bx0:bx1] = True
thr = np.percentile(line[box], 88)
gm = ((line > thr) & box).astype(np.uint8)
gm = cv2.dilate(gm, np.ones((3, 3), np.uint8))
# keep the eyes themselves (iris/lids) intact: drop mask pixels inside the eye contours
for eye in (idx(C.FACE_LANDMARKS_LEFT_EYE), idx(C.FACE_LANDMARKS_RIGHT_EYE)):
    hull = cv2.convexHull(P[eye][:, :2].astype(np.int32))
    cv2.fillConvexPoly(gm, hull, 0)
tex8 = cv2.inpaint((tex.clip(0, 1) * 255).astype(np.uint8), gm, 4, cv2.INPAINT_TELEA)
tex = tex8.astype(np.float32) / 255
Image.fromarray(gm * 255).save(os.path.join(a.out, 'glasses_mask.png'))
Image.fromarray((tex.clip(0, 1) * 255).astype(np.uint8)).save(os.path.join(a.out, 'texture.png'))
Image.fromarray((m * 255).astype(np.uint8)).save(os.path.join(a.out, 'mask.png'))
print('landmarks', len(pts), 'size', W, H)
