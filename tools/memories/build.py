"""Photo -> layered 2.5D gaussian splats ("memory" stages). Fully local.

Pipeline per photo:
  1. depth (Depth Anything V2 Small, analyze.py) + human matte (u2net_human_seg, analyze.py)
  2. foreground = human matte  U  depth "bumps" (disparity above a horizontal grey-opening of itself)
  3. background layer: colour + disparity inpainted behind a dilated foreground, image extended past its
     borders (blurred reflection, alpha fading out) so parallax never shows a hard rectangle
  4. foreground layer: disparity propagated from the eroded interior to the silhouette (no flying pixels),
     relief per person compressed toward its median so faces don't warp, soft matte as opacity
  5. adaptive quadtree (8/4/2/1 px blocks on colour variance + depth range) -> one gaussian per block,
     covariance spanned by the surface tangents dP/du, dP/dv (so floors/snow lie flat), thin along the normal
  6. shuffle, write standard 32-byte .splat

Pinhole: camera at the origin looking down -Z, +Y up, horizontal fov = HFOV for every photo (width-matched),
so a stage camera at the origin with the matching fov reproduces the photo exactly.

usage: python -I build.py <life_dir> <analysis_dir> <out_dir> [name ...]
"""
import sys, os, json, numpy as np, cv2

LIFE, AN, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ONLY = set(sys.argv[4:])
HFOV = 64.0  # degrees, photo horizontal fov


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def load(name, crop=None, scale=1.0, stamp=None):
    img = cv2.cvtColor(cv2.imread(f'{LIFE}/{name}.jpg'), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    d = np.load(f'{AN}/{name}.depth.npy')
    m = np.load(f'{AN}/{name}.human.npy')
    if stamp:  # burnt-in date stamp: inpaint it away (x0,y0,x1,y1 in source px)
        x0, y0, x1, y1 = stamp
        mk = np.zeros(img.shape[:2], np.uint8); mk[y0:y1, x0:x1] = 255
        img = cv2.inpaint((img * 255).astype(np.uint8), mk, 5, cv2.INPAINT_TELEA).astype(np.float32) / 255
    if crop:
        y0, y1, x0, x1 = crop
        img, d, m = img[y0:y1, x0:x1], d[y0:y1, x0:x1], m[y0:y1, x0:x1]
        lo, hi = np.percentile(d, .5), np.percentile(d, 99.5)
        d = np.clip((d - lo) / (hi - lo), 0, 1)
    if scale != 1.0:
        H, W = img.shape[:2]
        sz = (int(round(W * scale)), int(round(H * scale)))
        interp = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
        img = np.clip(cv2.resize(img, sz, interpolation=interp), 0, 1)
        if scale > 1:  # gentle detail recovery after upscaling a small jpeg
            den = cv2.bilateralFilter(img, 5, 0.06, 3)
            img = np.clip(den + 0.6 * (den - cv2.GaussianBlur(den, (0, 0), 1.6)), 0, 1)
        d = cv2.resize(d, sz, interpolation=cv2.INTER_CUBIC)
        m = cv2.resize(m, sz, interpolation=cv2.INTER_CUBIC)
    return img, np.clip(d, 0, 1).astype(np.float32), np.clip(m, 0, 1).astype(np.float32)


def fg_alpha(img, d, m, cfg):
    H, W = d.shape
    kw = max(31, int(W * cfg.get('open_w', 0.28)) | 1)
    opened = cv2.morphologyEx(d, cv2.MORPH_OPEN, np.ones((1, kw), np.uint8))
    opened = cv2.GaussianBlur(opened, (0, 0), 3)
    bump = d - opened
    a = np.zeros_like(d)
    if cfg.get('use_bump', True):
        a = np.maximum(a, smoothstep(cfg.get('bump_lo', .05), cfg.get('bump_hi', .11), bump))
    if cfg.get('use_human', True):
        # trust the human matte only where depth agrees the pixel stands out a bit
        a = np.maximum(a, m * smoothstep(-0.02, 0.03, bump))
    if 'fg_box' in cfg:  # restrict to a region (fractions x0,y0,x1,y1)
        x0, y0, x1, y1 = cfg['fg_box']
        box = np.zeros_like(a); box[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)] = 1
        a *= cv2.GaussianBlur(box, (0, 0), 4)
    if 'no_fg_box' in cfg:
        for x0, y0, x1, y1 in cfg['no_fg_box']:
            a[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)] = 0
    hard = (a > .5).astype(np.uint8)
    hard = cv2.morphologyEx(hard, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    ck = cfg.get('close_k', 5)  # group shots: close the gaps between people so nobody falls into the inpainted hole
    hard = cv2.morphologyEx(hard, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ck, ck)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(hard, 8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] > cfg.get('min_area', 0.002) * H * W
    hard = keep[lab].astype(np.uint8)
    # soft edge: guided by the image, limited to a thin band around the hard mask
    soft = cv2.ximgproc.guidedFilter((img * 255).astype(np.uint8), (hard * 255).astype(np.uint8), 3, 120).astype(np.float32) / 255
    band = cv2.dilate(hard, np.ones((5, 5), np.uint8))
    soft = smoothstep(0.25, 0.85, np.clip(soft, 0, 1)) * band
    soft = np.where(cv2.erode(hard, np.ones((5, 5), np.uint8)) > 0, 1.0, soft)
    lab = (keep[lab] * lab).astype(np.int32)
    return soft.astype(np.float32), hard, lab


def extend(arr, px, py, blur=True):
    """pad by px/py on each side with a reflection that gets blurrier towards the outside"""
    if arr.ndim == 2:
        return extend(arr[..., None], px, py, blur)[..., 0]
    out = cv2.copyMakeBorder(arr, py, py, px, px, cv2.BORDER_REFLECT_101)
    if out.ndim == 2:
        out = out[..., None]
    if blur and (px or py):
        H, W = out.shape[:2]
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        dx = np.maximum(np.maximum(px - xx, xx - (W - 1 - px)), 0) / max(px, 1)
        dy = np.maximum(np.maximum(py - yy, yy - (H - 1 - py)), 0) / max(py, 1)
        k = np.clip(np.maximum(dx, dy), 0, 1)[..., None]
        b1 = cv2.GaussianBlur(out, (0, 0), 6).reshape(out.shape)
        b2 = cv2.GaussianBlur(out, (0, 0), 22).reshape(out.shape)
        out = np.where(k < .5, out * (1 - k * 2) + b1 * (k * 2), b1 * (2 - k * 2) + b2 * (k * 2 - 1))
    return out


def quadtree(color, disp, alpha, emit, detail, target, levels=(8, 4, 2, 1), min_block=None):
    """returns list of (u_center, v_center, block) for accepted blocks; binary-searches the colour threshold"""
    H, W = disp.shape
    P = levels[0]
    Hp, Wp = (H + P - 1) // P * P, (W + P - 1) // P * P
    pad = lambda a, v=0: np.pad(a, [(0, Hp - H), (0, Wp - W)] + [(0, 0)] * (a.ndim - 2), constant_values=v)
    C, D, A, E, Dt = pad(color), pad(disp), pad(alpha), pad(emit.astype(np.float32)), pad(detail)
    lum = C @ np.array([.3, .55, .15], np.float32)
    mb = min_block if min_block is not None else np.ones((Hp, Wp), np.int32)
    if min_block is not None:
        mb = pad(min_block, 1)

    def run(th):
        covered = np.zeros((Hp, Wp), bool)
        res = []
        for b in levels:
            sh = (Hp // b, b, Wp // b, b)
            blk = lambda a: a.reshape(sh).transpose(0, 2, 1, 3).reshape(Hp // b, Wp // b, b * b)
            e = blk(E); cv = blk(covered)
            anyE = e.max(-1) > 0
            if b == 1:
                ok = anyE & ~cv[..., 0]
            else:
                l = blk(lum); dd = blk(D); aa = blk(A); dt = blk(Dt).max(-1); mbb = blk(mb).min(-1)
                std = l.std(-1)
                rng = (dd.max(-1) - dd.min(-1))
                thr = th * (1 + 2.5 * (b == 8)) / (1 + 4 * dt)
                ok = (e.min(-1) > 0) & ~cv.any(-1) & (std < thr) & (rng < max(0.02, th * 0.35)) \
                     & ((aa.max(-1) - aa.min(-1)) < .08) & (mbb <= b) & ~((dt > 0.6) & (b >= 4))
            ys, xs = np.nonzero(ok)
            res.append((ys * b + (b - 1) / 2, xs * b + (b - 1) / 2, np.full(len(ys), b)))
            cov_b = np.repeat(np.repeat(ok, b, 0), b, 1)
            covered |= cov_b
        v = np.concatenate([r[0] for r in res]); u = np.concatenate([r[1] for r in res]); bb = np.concatenate([r[2] for r in res])
        keep = (v < H) & (u < W)
        return u[keep], v[keep], bb[keep]

    lo, hi = 0.002, 1.5
    best = None
    for _ in range(14):
        mid = (lo * hi) ** .5
        u, v, b = run(mid)
        if len(u) > target:
            lo = mid
        else:
            hi = mid; best = (u, v, b)
    if best is None:
        best = run(hi)
    return best


def disp_to_z(d, zn, zf):
    return 1.0 / (d * (1 / zn - 1 / zf) + 1 / zf)


def splats_from_layer(color, z, alpha, u, v, b, f, cx, cy, gamma_box=None, thick=0.18, kmax=3.0, sig=0.85):
    """u,v,b: block centres (px) + sizes. z: metric depth map. Returns arrays for .splat"""
    H, W = z.shape
    # depth slopes from a smoothed depth (min of forward/backward so depth jumps don't smear);
    # the lateral part of each tangent is the exact pixel step, so splats always tile the image plane
    zs = cv2.GaussianBlur(z, (0, 0), 2.0)
    fu = np.zeros_like(zs); fu[:, :-1] = zs[:, 1:] - zs[:, :-1]; fu[:, -1] = fu[:, -2]
    bu = np.zeros_like(zs); bu[:, 1:] = zs[:, 1:] - zs[:, :-1]; bu[:, 0] = bu[:, 1]
    fv = np.zeros_like(zs); fv[:-1] = zs[1:] - zs[:-1]; fv[-1] = fv[-2]
    bv = np.zeros_like(zs); bv[1:] = zs[1:] - zs[:-1]; bv[0] = bv[1]
    dzu = np.where(np.abs(fu) < np.abs(bu), fu, bu)
    dzv = np.where(np.abs(fv) < np.abs(bv), fv, bv)
    # block-averaged colour/depth/alpha via box filter at each block size
    n = len(u)
    col = np.zeros((n, 3), np.float32); zz = np.zeros(n, np.float32); aa = np.zeros(n, np.float32)
    TU = np.zeros((n, 3), np.float32); TV = np.zeros((n, 3), np.float32)
    for bs in np.unique(b):
        sel = b == bs
        if bs > 1:
            cb = cv2.blur(color, (int(bs), int(bs)), borderType=cv2.BORDER_REPLICATE)
            # disparity-average then back to z (avoids far bias)
            zb = 1.0 / cv2.blur(1.0 / z, (int(bs), int(bs)), borderType=cv2.BORDER_REPLICATE)
            ab = cv2.blur(alpha, (int(bs), int(bs)), borderType=cv2.BORDER_REPLICATE)
            # block centre is between pixels for even sizes: box filter anchor handles the half-pixel
        else:
            cb, zb, ab = color, z, alpha
        iu = np.clip(np.round(u[sel]).astype(int), 0, W - 1); iv = np.clip(np.round(v[sel]).astype(int), 0, H - 1)
        col[sel] = cb[iv, iu]; zz[sel] = zb[iv, iu]; aa[sel] = ab[iv, iu]
        zc = zz[sel]; fb = zc * bs / f
        # P = ((u-cx)/f z, -(v-cy)/f z, -z): dP/du = (z/f + x_n dz, -y_n dz, -dz) per pixel
        xn = (u[sel] - cx) / f; yn = (v[sel] - cy) / f
        du = np.clip(dzu[iv, iu] * bs, -kmax * fb, kmax * fb); dv = np.clip(dzv[iv, iu] * bs, -kmax * fb, kmax * fb)
        TU[sel] = np.stack([fb + xn * du, -yn * du, -du], 1)
        TV[sel] = np.stack([xn * dv, -fb - yn * dv, -dv], 1)
    foot = zz * b / f  # fronto-parallel footprint
    pos = np.stack([(u - cx) / f * zz, -(v - cy) / f * zz, -zz], 1).astype(np.float32)
    nrm = np.cross(TU, TV); nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
    a1 = TU * sig; a2 = TV * sig; a3 = nrm * (foot * thick)[:, None]
    Sig = a1[:, :, None] * a1[:, None, :] + a2[:, :, None] * a2[:, None, :] + a3[:, :, None] * a3[:, None, :]
    w, V = np.linalg.eigh(Sig.astype(np.float64))
    w = np.maximum(w, 1e-12)
    det = np.linalg.det(V)
    V[:, :, 0] *= np.sign(det)[:, None]
    scales = np.sqrt(w).astype(np.float32)
    quat = rot_to_quat(V)
    return pos, scales, col, aa, quat


def rot_to_quat(R):
    m00, m01, m02 = R[:, 0, 0], R[:, 0, 1], R[:, 0, 2]
    m10, m11, m12 = R[:, 1, 0], R[:, 1, 1], R[:, 1, 2]
    m20, m21, m22 = R[:, 2, 0], R[:, 2, 1], R[:, 2, 2]
    tr = m00 + m11 + m22
    q = np.zeros((len(R), 4))
    c1 = tr > 0
    s = np.sqrt(np.maximum(tr + 1, 1e-12)) * 2
    q[c1] = np.stack([.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s], 1)[c1]
    c2 = ~c1 & (m00 > m11) & (m00 > m22)
    s = np.sqrt(np.maximum(1 + m00 - m11 - m22, 1e-12)) * 2
    q[c2] = np.stack([(m21 - m12) / s, .25 * s, (m01 + m10) / s, (m02 + m20) / s], 1)[c2]
    c3 = ~c1 & ~c2 & (m11 > m22)
    s = np.sqrt(np.maximum(1 + m11 - m00 - m22, 1e-12)) * 2
    q[c3] = np.stack([(m02 - m20) / s, (m01 + m10) / s, .25 * s, (m12 + m21) / s], 1)[c3]
    c4 = ~c1 & ~c2 & ~c3
    s = np.sqrt(np.maximum(1 + m22 - m00 - m11, 1e-12)) * 2
    q[c4] = np.stack([(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, .25 * s], 1)[c4]
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    return q.astype(np.float32)


def write_splat(path, parts, seed=7):
    pos = np.concatenate([p[0] for p in parts]); sc = np.concatenate([p[1] for p in parts])
    col = np.concatenate([p[2] for p in parts]); a = np.concatenate([p[3] for p in parts])
    q = np.concatenate([p[4] for p in parts])
    keep = a > 0.03
    pos, sc, col, a, q = pos[keep], sc[keep], col[keep], a[keep], q[keep]
    n = len(pos)
    perm = np.random.default_rng(seed).permutation(n)
    rec = np.zeros(n, dtype=[('p', '<f4', 3), ('s', '<f4', 3), ('c', 'u1', 4), ('q', 'u1', 4)])
    rec['p'] = pos[perm]; rec['s'] = sc[perm]
    rgba = np.concatenate([np.clip(col[perm], 0, 1) * 255, np.clip(a[perm], 0, 1)[:, None] * 255], 1)
    rec['c'] = np.round(rgba).astype(np.uint8)
    rec['q'] = np.clip(np.round(q[perm] * 128 + 128), 0, 255).astype(np.uint8)
    rec.tofile(path)
    print(f'  wrote {os.path.basename(path)}: {n} splats, {os.path.getsize(path) / 1e6:.2f} MB')
    return n


def build(name, src, cfg):
    img, d, m = load(src, cfg.get('crop'), cfg.get('scale', 1.0), cfg.get('stamp'))
    H, W = d.shape
    soft, hard, lab = fg_alpha(img, d, m, cfg)
    if cfg.get('no_fg'):
        soft[:] = 0; hard[:] = 0; lab[:] = 0
    if cfg.get('far_mask'):  # e.g. sky: push to far plane
        sky = cfg['far_mask'](img, d)
        d = np.where(sky > 0, np.minimum(d, 0.0), d)
    zn, zf = cfg['zn'], cfg['zf']
    # ---- background disparity / colour behind the foreground
    r = cfg.get('hole_dilate', 9)
    hole = cv2.dilate(hard, np.ones((r, r), np.uint8))
    d_bg = cv2.inpaint(d.astype(np.float32), hole, 7, cv2.INPAINT_NS)
    d_bg = np.where(hole > 0, cv2.GaussianBlur(d_bg, (0, 0), 3), d_bg)
    hs = 2 if max(H, W) > 700 else 1
    small = cv2.resize((img * 255).astype(np.uint8), (W // hs, H // hs), interpolation=cv2.INTER_AREA)
    hole_s = cv2.resize(hole, (W // hs, H // hs), interpolation=cv2.INTER_NEAREST)
    fill = cv2.inpaint(small, cv2.dilate(hole_s, np.ones((3, 3), np.uint8)), 9, cv2.INPAINT_TELEA)
    fill = cv2.GaussianBlur(fill, (0, 0), 1.5)
    fill = cv2.resize(fill, (W, H), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255
    # colour is replaced only on/next to the foreground (mixed edge pixels); depth uses the wider hole
    c_bg = np.where(cv2.dilate(hard, np.ones((5, 5), np.uint8))[..., None] > 0, fill, img)
    if cfg.get('keep_bg_color'):  # crowded group shots: an imperfect matte must never leave a smeared face behind
        c_bg = img
    # ---- foreground disparity: interior propagated outward, relief compressed per component
    er = cv2.erode(hard, np.ones((5, 5), np.uint8))
    dfg = np.where(er > 0, d, 0).astype(np.float32)
    for _ in range(4):
        dfg = np.where(er > 0, dfg, cv2.dilate(dfg, np.ones((5, 5), np.uint8)))
    dfg = np.where(dfg > 0, dfg, d)
    rel = cfg.get('relief', 0.45)
    for k in range(1, lab.max() + 1):
        mk = lab == k
        if not mk.any():
            continue
        med = np.median(dfg[mk & (er > 0)]) if (mk & (er > 0)).any() else np.median(dfg[mk])
        dfg[mk] = med + rel * (dfg[mk] - med)
    dfg = np.maximum(dfg, d_bg + cfg.get('fg_gap', 0.03))  # fg always in front of the bg it occludes
    # ---- extension
    ex = cfg.get('ext', (0.14, 0.14))
    px, py = int(W * ex[0]), int(H * ex[1])
    if 'ext_px' in cfg:
        px, py = cfg['ext_px']
    cE = np.clip(extend(c_bg, px, py), 0, 1).astype(np.float32)
    dE = extend(d_bg, px, py, blur=False).astype(np.float32)
    dE = cv2.GaussianBlur(dE, (0, 0), 2)
    dE[py:py + H, px:px + W] = d_bg
    HE, WE = dE.shape
    yy, xx = np.mgrid[0:HE, 0:WE].astype(np.float32)
    ddx = np.maximum(np.maximum(px - xx, xx - (WE - 1 - px)), 0) / max(px, 1)
    ddy = np.maximum(np.maximum(py - yy, yy - (HE - 1 - py)), 0) / max(py, 1)
    edge_k = np.clip(np.maximum(ddx, ddy), 0, 1)
    aE = (1 - smoothstep(0.15, 1.0, edge_k)).astype(np.float32)
    if cfg.get('ext_push', 0):  # extension recedes a little so it reads as "beyond the capture"
        dE = dE * (1 - cfg['ext_push'] * edge_k)
    cut = cfg.get('bg_cut')  # optional function returning a mask of bg pixels to drop (e.g. projector screen)
    emit_bg = aE > 0.03
    if cut is not None:
        cm = np.zeros((HE, WE), np.uint8); cm[py:py + H, px:px + W] = cut(img, d, hard)
        emit_bg &= cm == 0
    f = (W / 2) / np.tan(np.radians(HFOV / 2))
    cx, cy = px + (W - 1) / 2, py + (H - 1) / 2
    detail = np.zeros((HE, WE), np.float32)
    detail[py:py + H, px:px + W] = cfg['detail'](img, d, hard) if 'detail' in cfg else contrast_detail(img)
    # people (even ones the matte only half caught) never get merged into big blocks: faces stay sharp
    detail[py:py + H, px:px + W] = np.maximum(detail[py:py + H, px:px + W], cv2.GaussianBlur(np.clip(m * 1.6, 0, 1), (0, 0), 2))
    # coarse-only in extension; behind fg allow at most 2px blocks
    mb = np.ones((HE, WE), np.int32)
    mb[edge_k > 0] = 4
    hp = np.zeros((HE, WE), np.uint8); hp[py:py + H, px:px + W] = hole
    mb[hp > 0] = 2
    zE = disp_to_z(dE, zn, zf)
    n_bg = cfg['n_bg']
    u, v, b = quadtree(cE, dE, aE, emit_bg, detail, n_bg, min_block=mb)
    parts = [splats_from_layer(cE, zE, aE, u, v, b, f, cx, cy, kmax=cfg.get('kmax', 20.0))]
    nfg = 0
    if hard.any():
        er3 = cv2.erode(hard, np.ones((3, 3), np.uint8))
        known = er3 > 0
        prop = img * known[..., None]
        for _ in range(5):
            Pb = cv2.blur(prop * known[..., None], (5, 5)); Wb = cv2.blur(known.astype(np.float32), (5, 5))
            new = ~known & (Wb > 0.01)
            prop = np.where(new[..., None], Pb / np.maximum(Wb, 1e-6)[..., None], prop)
            known = known | new
        acc_w = known.astype(np.float32)
        edge = (soft > 0) & (er3 == 0) & (acc_w > 0.05) & (cv2.dilate(er3, np.ones((5, 5), np.uint8)) > 0)
        img_fg = np.where(edge[..., None], prop * 0.75 + img * 0.25, img)
        cF = np.zeros_like(cE); cF[py:py + H, px:px + W] = img_fg
        dF = np.zeros_like(dE); dF[py:py + H, px:px + W] = dfg
        aF = np.zeros_like(aE); aF[py:py + H, px:px + W] = soft
        dF = np.where(aF > 0, dF, dE)
        emit_fg = aF > 0.04
        u, v, b = quadtree(cF, dF, aF, emit_fg, np.full_like(aF, cfg.get('fg_detail', 0.5)), cfg['n_fg'], levels=cfg.get('fg_levels', (4, 2, 1)))
        zF = disp_to_z(dF, zn, zf)
        fgp = splats_from_layer(cF, zF, aF, u, v, b, f, cx, cy, kmax=2.5, sig=cfg.get('fg_sig', 0.8))
        # soft-edge splats a touch smaller so silhouettes stay crisp
        parts.append(fgp)
        nfg = len(u)
    extra = cfg.get('extra_layers')
    meta = dict(name=name, src=src, W=W, H=H, px=px, py=py, f=float(f), hfov=HFOV, zn=zn, zf=zf, n_bg=int(len(parts[0][0])), n_fg=nfg)
    if extra:
        for lname, fn in extra.items():
            lp = fn(c_bg, d, dfg, d_bg, soft, hard, px, py, cE.shape, f, cx, cy, zn, zf)
            write_splat(f'{OUT}/{lname}.splat', [lp])
    write_splat(f'{OUT}/{name}.splat', parts)
    # debug previews
    dbg = np.concatenate([cE, np.repeat(((dE - dE.min()) / (np.ptp(dE) + 1e-6))[..., None], 3, 2), np.repeat(aE[..., None], 3, 2)], 1)
    cv2.imwrite(f'{AN}/{name}.layers.jpg', cv2.cvtColor((np.clip(dbg, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
    fgv = np.concatenate([img * soft[..., None], np.repeat(((dfg - dfg.min()) / (np.ptp(dfg) + 1e-6))[..., None], 3, 2)], 1)
    cv2.imwrite(f'{AN}/{name}.fg.jpg', cv2.cvtColor((np.clip(fgv, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
    return meta


# ------------------------------------------------------------------------------------------------- configs
def contrast_detail(img):
    g = cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    lap = np.abs(cv2.Laplacian(cv2.GaussianBlur(g, (0, 0), 0.8), cv2.CV_32F))
    return np.clip(cv2.GaussianBlur(lap, (0, 0), 3) * 8, 0, 1)


def devfest_screen(img, d, hard=None):
    """projector screen: the bright, low-saturation-ish rectangle behind the speaker (source px)"""
    H, W = d.shape
    m = np.zeros((H, W), np.uint8)
    # quad from the photo (fractions of W,H): the visible screen, left edge to the banner on the right
    pts = np.array([[0.474 * W, 0.255 * H], [0.905 * W, 0.255 * H], [0.905 * W, 0.66 * H], [0.474 * W, 0.66 * H]], np.int32)
    cv2.fillPoly(m, [pts], 1)
    bright = (img.mean(-1) > 0.55).astype(np.uint8)
    q = m.copy()
    m = m & cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    if hard is not None:  # the part of the screen hidden behind the speaker belongs to the screen too
        m = m | (q & cv2.dilate(hard, np.ones((25, 25), np.uint8)))
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    return m


CFGS = {
    'stage-devfest': dict(src='gdg-devfest-1', scale=0.8, zn=2.4, zf=16, relief=0.4, n_bg=110_000, n_fg=55_000,
                          open_w=0.3, bump_lo=.05, bump_hi=.10, ext=(0.12, 0.14), hole_dilate=13, bg_cut=devfest_screen,
                          no_fg_box=[(0.88, 0.0, 1.0, 1.0)], min_area=0.004),
    'stage-codelab': dict(src='bau-codelab-2', scale=1.0, zn=2.0, zf=14, relief=0.5, n_bg=130_000, n_fg=50_000,
                          open_w=0.22, bump_lo=.04, bump_hi=.09, ext=(0.16, 0.08), hole_dilate=11, min_area=0.003),
    'teams-frc': dict(src='itobot-frc', crop=(236, 1162, 0, 1400), scale=0.66, zn=3.0, zf=14, relief=0.45,
                      n_bg=42_000, n_fg=42_000, fg_levels=(2, 1), close_k=21, open_w=0.5, ext=(0.08, 0.1), hole_dilate=9, min_area=0.004),
    'teams-teknofest': dict(src='teknofest-vorfex42', scale=1.0, zn=3.0, zf=12, relief=0.45, n_bg=42_000, n_fg=42_000, fg_levels=(2, 1), close_k=21,
                            open_w=0.5, ext=(0.08, 0.1), hole_dilate=9, min_area=0.004),
    'teams-thk': dict(src='thk-aviation', scale=0.9, zn=3.0, zf=16, relief=0.45, n_bg=42_000, n_fg=42_000, fg_levels=(2, 1), close_k=21,
                      open_w=0.5, ext=(0.08, 0.1), hole_dilate=9, min_area=0.004),
    'teams-wtm': dict(src='gdg-devfest-2', scale=0.56, zn=2.0, zf=8, relief=0.5, n_bg=42_000, n_fg=42_000, fg_levels=(2, 1), close_k=21,
                      open_w=0.35, ext=(0.08, 0.1), hole_dilate=9, min_area=0.004),
}


def screen_layer(img, d, dfg, d_bg, soft, hard, px, py, shp, f, cx, cy, zn, zf):
    """the projector slide on its own (fades away to reveal the codelab behind it)"""
    H, W = d.shape
    HE, WE = shp[:2]
    m = devfest_screen(img, d, hard).astype(np.float32)
    m = cv2.GaussianBlur(m, (0, 0), 1.2)  # img here is the inpainted background: the slide continues behind the speaker
    cS = np.zeros((HE, WE, 3), np.float32); cS[py:py + H, px:px + W] = img
    aS = np.zeros((HE, WE), np.float32); aS[py:py + H, px:px + W] = m
    dS = np.zeros((HE, WE), np.float32); dS[py:py + H, px:px + W] = d_bg
    # flatten the screen to a plane: fit disparity = a + b*x + c*y over the mask
    ys, xs = np.nonzero(aS > .5)
    A = np.stack([np.ones_like(xs), xs, ys], 1).astype(np.float64)
    coef, *_ = np.linalg.lstsq(A, dS[ys, xs].astype(np.float64), rcond=None)
    yy, xx = np.mgrid[0:HE, 0:WE]
    dS = (coef[0] + coef[1] * xx + coef[2] * yy).astype(np.float32)
    print('  screen plane disparity coef', coef)
    u, v, b = quadtree(cS, dS, aS, aS > .04, np.full_like(aS, .6), 30_000, levels=(4, 2, 1))
    return splats_from_layer(cS, disp_to_z(dS, zn, zf), aS, u, v, b, f, cx, cy)


CFGS['stage-devfest']['extra_layers'] = {'stage-screen': screen_layer}

if __name__ == '__main__':
    metas = {}
    mpath = f'{OUT}/meta.json'
    if os.path.exists(mpath):
        metas = json.load(open(mpath))
    for name, cfg in CFGS.items():
        if ONLY and name not in ONLY:
            continue
        print(name)
        cfg = dict(cfg)
        src = cfg.pop('src')
        metas[name] = build(name, src, cfg)
        print(' ', metas[name])
    json.dump(metas, open(mpath, 'w'), indent=1)
