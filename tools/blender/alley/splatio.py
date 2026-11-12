"""Write/read the standard 32-byte .splat format (antimatter15 layout).

Per splat: position f32x3, scale f32x3 (linear, not log), rgba u8x4 (sRGB, alpha = opacity),
rotation u8x4 = quaternion (w, x, y, z) normalised, stored as clip(q*128+128).
Coordinates are three.js convention (y up, metres).
"""
import numpy as np

DT = np.dtype([('pos', '<f4', 3), ('scale', '<f4', 3), ('rgba', 'u1', 4), ('rot', 'u1', 4)])
assert DT.itemsize == 32


def quat_to_u8(q):
    q = q / np.linalg.norm(q, axis=1, keepdims=True)
    q = np.where(q[:, :1] < 0, -q, q)  # canonical w >= 0
    return np.clip(np.round(q * 128 + 128), 0, 255).astype(np.uint8)


def write_splat(path, pos, scale, rgba, quat_wxyz):
    n = len(pos)
    a = np.zeros(n, DT)
    a['pos'] = pos
    a['scale'] = scale
    a['rgba'] = rgba
    a['rot'] = quat_to_u8(quat_wxyz)
    a.tofile(path)
    # round trip check
    b = np.fromfile(path, DT)
    assert len(b) == n and np.allclose(b['pos'], pos, atol=1e-5) and np.allclose(b['scale'], scale, rtol=1e-5)
    qb = (b['rot'].astype(np.float32) - 128) / 128
    qb /= np.linalg.norm(qb, axis=1, keepdims=True)
    qa = quat_wxyz / np.linalg.norm(quat_wxyz, axis=1, keepdims=True)
    assert np.percentile(np.abs(np.sum(qa * qb, 1)), 1) > 0.99
    return n


def read_splat(path):
    return np.fromfile(path, DT)
