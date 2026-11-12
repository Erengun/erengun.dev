"""
Local-only inference helpers for the photo portrait (no network calls; models are local ONNX files).
  - person mask: rembg's u2net_human_seg.onnx
  - relative depth: Depth Anything V2 Small (onnx-community/depth-anything-v2-small, onnx/model.onnx)
Both return float32 maps at the input image's resolution (mask 0..1, depth: larger = nearer, unnormalised).
"""
import numpy as np
import onnxruntime as ort
import cv2

MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)

def _prep(rgb, size):
    x = cv2.resize(rgb, size, interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255.0
    x = (x - MEAN) / STD
    return x.transpose(2, 0, 1)[None]

def person_mask(rgb, model_path):
    s = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
    out = s.run(None, {s.get_inputs()[0].name: _prep(rgb, (320, 320))})[0][0, 0]
    out = (out - out.min()) / max(out.max() - out.min(), 1e-6)
    return cv2.resize(out, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)

def rel_depth(rgb, model_path, size=518):
    s = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
    h, w = rgb.shape[:2]
    # keep aspect, multiples of 14
    sc = size / max(h, w)
    th, tw = max(14, int(round(h * sc / 14)) * 14), max(14, int(round(w * sc / 14)) * 14)
    out = s.run(None, {s.get_inputs()[0].name: _prep(rgb, (tw, th))})[0]
    out = np.squeeze(out).astype(np.float32)
    return cv2.resize(out, (w, h), interpolation=cv2.INTER_CUBIC)

def person_mask_mp(rgb, model_path):
    """MediaPipe selfie multiclass segmenter (local .tflite): person = 1 − background confidence.
    Much more robust than u2net against busy backgrounds (bare branches, trees); hair is its own class."""
    import mediapipe as mp
    from mediapipe.tasks import python as mpt
    from mediapipe.tasks.python import vision
    seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
        base_options=mpt.BaseOptions(model_asset_path=model_path), output_confidence_masks=True))
    r = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    bg = np.squeeze(r.confidence_masks[0].numpy_view()).astype(np.float32)
    return 1.0 - bg
