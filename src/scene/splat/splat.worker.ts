/**
 * Splat worker: fetch + parse (off the main thread) and per-view culling + depth sorting.
 *
 * Formats:
 *   .splat   standard 32 bytes/splat: pos f32×3, scale f32×3, rgba u8×4, quat u8×4 (w first, q·128+128)
 *   .csplat  compact 16 bytes/splat, see tools/splat/compact.mjs (magic 'CSP1')
 *
 * Messages in:
 *   { type: 'load', url, cap }                    → { type: 'parsed', n, total, rows, centre, covA, covB, colour, bounds }
 *   { type: 'sort', id, viewProj (object→clip), out? } → { type: 'order', order, count, id, ms }
 * Sorting keeps only splats whose centre lies inside a guard band (GUARD_X/Y, in front of the near plane),
 * the same test the vertex shader uses to drop splats, so culling here only saves work and never changes the image.
 */
const TEX_W = 2048; // keep in sync with splat.ts
const BINS = 65536;
// The shader drops splats whose centre is beyond |ndc| 1.4 of the projection it renders with. The compositor's
// fish-eye overscan widens that projection only vertically (fov·s, aspect/s: the horizontal extent is unchanged),
// by s ≤ 2, while sorting uses the stage camera's un-overscanned projection. So: x guard 1.5 (a little slack for
// camera drift between sorts), y guard 1.4·2.
const GUARD_X = 1.5;
const GUARD_Y = 2.8;
const NEAR_W = 0.01;

let pos: Float32Array | null = null;
let n = 0;
let keys: Uint16Array | null = null;
let vis: Uint32Array | null = null;
let depth: Float32Array | null = null;
const counts = new Uint32Array(BINS);

interface Parsed {
  n: number; total: number; rows: number;
  centre: Float32Array; covA: Float32Array; covB: Float32Array; colour: Uint8Array;
  bounds: { min: number[]; max: number[] };
}

function alloc(n: number) {
  const rows = Math.max(1, Math.ceil(n / TEX_W));
  return {
    rows,
    centre: new Float32Array(TEX_W * rows * 4),
    covA: new Float32Array(TEX_W * rows * 4),
    covB: new Float32Array(TEX_W * rows * 4),
    colour: new Uint8Array(TEX_W * rows * 4),
  };
}

/** writes centre / covariance (Σ = R·S·Sᵀ·Rᵀ, upper triangle) for splat i */
function put(o: ReturnType<typeof alloc>, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number,
  qw: number, qx: number, qy: number, qz: number) {
  const ql = Math.hypot(qw, qx, qy, qz) || 1;
  qw /= ql; qx /= ql; qy /= ql; qz /= ql;
  const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
  const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
  const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
  const m00 = r00 * sx, m01 = r01 * sy, m02 = r02 * sz;
  const m10 = r10 * sx, m11 = r11 * sy, m12 = r12 * sz;
  const m20 = r20 * sx, m21 = r21 * sy, m22 = r22 * sz;
  const p = i * 4;
  o.centre[p] = x; o.centre[p + 1] = y; o.centre[p + 2] = z; o.centre[p + 3] = 1;
  o.covA[p] = m00 * m00 + m01 * m01 + m02 * m02;
  o.covA[p + 1] = m00 * m10 + m01 * m11 + m02 * m12;
  o.covA[p + 2] = m00 * m20 + m01 * m21 + m02 * m22;
  o.covA[p + 3] = m10 * m10 + m11 * m11 + m12 * m12;
  o.covB[p] = m10 * m20 + m11 * m21 + m12 * m22;
  o.covB[p + 1] = m20 * m20 + m21 * m21 + m22 * m22;
}

function parseSplat(buf: ArrayBuffer, cap: number): Parsed & { pos: Float32Array } {
  const total = Math.floor(buf.byteLength / 32);
  const n = Math.min(total, cap);
  // producers shuffle the file, so a prefix is a uniform subsample; grow splats to keep the coverage
  const k = Math.sqrt(total / n);
  const f = new Float32Array(buf, 0, total * 8);
  const u = new Uint8Array(buf);
  const o = alloc(n);
  const pos = new Float32Array(n * 3);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const a = i * 8, b = i * 32;
    const x = f[a], y = f[a + 1], z = f[a + 2];
    put(o, i, x, y, z, f[a + 3] * k, f[a + 4] * k, f[a + 5] * k,
      (u[b + 28] - 128) / 128, (u[b + 29] - 128) / 128, (u[b + 30] - 128) / 128, (u[b + 31] - 128) / 128);
    o.colour.set(u.subarray(b + 24, b + 28), i * 4);
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    if (x < mn[0]) mn[0] = x; if (y < mn[1]) mn[1] = y; if (z < mn[2]) mn[2] = z;
    if (x > mx[0]) mx[0] = x; if (y > mx[1]) mx[1] = y; if (z > mx[2]) mx[2] = z;
  }
  return { n, total, ...o, pos, bounds: { min: mn, max: mx } };
}

function parseCompact(buf: ArrayBuffer, cap: number): Parsed & { pos: Float32Array } {
  const dv = new DataView(buf);
  const total = dv.getUint32(4, true);
  const bmin = [0, 1, 2].map((i) => dv.getFloat32(8 + i * 4, true));
  const bmax = [0, 1, 2].map((i) => dv.getFloat32(20 + i * 4, true));
  const lmin = dv.getFloat32(32, true), lmax = dv.getFloat32(36, true);
  const importance = (dv.getUint32(40, true) & 1) === 1;
  const n = Math.min(total, cap);
  // importance-sorted files drop the smallest/faintest splats first (no growth); shuffled ones are subsampled
  const k = importance ? 1 : Math.sqrt(total / n);
  const H = 64;
  const P = new Uint16Array(buf, H, total * 3);
  const S = new Uint8Array(buf, H + total * 6, total * 3);
  const C = new Uint8Array(buf, H + total * 9, total * 4);
  const R = new Uint8Array(buf, H + total * 13, total * 3);
  const sc = [0, 1, 2].map((i) => (bmax[i] - bmin[i]) / 65535);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.exp(lmin + (i / 255) * (lmax - lmin)) * k;
  const SQ = Math.SQRT1_2, QS = (2 * SQ) / 127;
  const o = alloc(n);
  const pos = new Float32Array(n * 3);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const q = [0, 0, 0, 0], abc = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    const x = bmin[0] + P[j] * sc[0], y = bmin[1] + P[j + 1] * sc[1], z = bmin[2] + P[j + 2] * sc[2];
    const v = R[j] | (R[j + 1] << 8) | (R[j + 2] << 16);
    const big = v >> 21;
    const a = ((v >> 14) & 127) * QS - SQ, b = ((v >> 7) & 127) * QS - SQ, c = (v & 127) * QS - SQ;
    abc[0] = a; abc[1] = b; abc[2] = c;
    for (let t = 0, m = 0; t < 4; t++) if (t !== big) q[t] = abc[m++];
    q[big] = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));
    put(o, i, x, y, z, lut[S[j]], lut[S[j + 1]], lut[S[j + 2]], q[0], q[1], q[2], q[3]);
    o.colour.set(C.subarray(i * 4, i * 4 + 4), i * 4);
    pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
    if (x < mn[0]) mn[0] = x; if (y < mn[1]) mn[1] = y; if (z < mn[2]) mn[2] = z;
    if (x > mx[0]) mx[0] = x; if (y > mx[1]) mx[1] = y; if (z > mx[2]) mx[2] = z;
  }
  return { n, total, ...o, pos, bounds: { min: mn, max: mx } };
}

function sort(m: number[] | Float32Array, out: Float32Array | null) {
  const p = pos!;
  // object → clip rows (column-major): x = m0 m4 m8 m12, y = m1 m5 m9 m13, w = m3 m7 m11 m15
  const m0 = m[0], m4 = m[4], m8 = m[8], m12 = m[12];
  const m1 = m[1], m5 = m[5], m9 = m[9], m13 = m[13];
  const m3 = m[3], m7 = m[7], m11 = m[11], m15 = m[15];
  let cnt = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const x = p[j], y = p[j + 1], z = p[j + 2];
    const w = m3 * x + m7 * y + m11 * z + m15;
    if (w <= NEAR_W) continue;
    const gx = w * GUARD_X;
    const cx = m0 * x + m4 * y + m8 * z + m12;
    if (cx > gx || cx < -gx) continue;
    const gy = w * GUARD_Y;
    const cy = m1 * x + m5 * y + m9 * z + m13;
    if (cy > gy || cy < -gy) continue;
    vis![cnt] = i;
    depth![cnt++] = w;
    if (w < lo) lo = w;
    if (w > hi) hi = w;
  }
  const s = (BINS - 1e-3) / Math.max(hi - lo, 1e-6);
  counts.fill(0);
  for (let i = 0; i < cnt; i++) {
    const k = BINS - 1 - (((depth![i] - lo) * s) | 0); // far first
    keys![i] = k;
    counts[k]++;
  }
  let acc = 0;
  for (let b = 0; b < BINS; b++) { const c = counts[b]; counts[b] = acc; acc += c; }
  const order = out && out.length === n ? out : new Float32Array(n);
  for (let i = 0; i < cnt; i++) order[counts[keys![i]]++] = vis![i];
  return { order, count: cnt };
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'load') {
    try {
      const res = await fetch(msg.url);
      if (!res.ok) throw new Error(`${msg.url} ${res.status}`);
      const buf = await res.arrayBuffer();
      const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
      const compact = head[0] === 67 && head[1] === 83 && head[2] === 80 && head[3] === 49; // 'CSP1'
      const d = compact ? parseCompact(buf, msg.cap) : parseSplat(buf, msg.cap);
      pos = d.pos;
      n = d.n;
      keys = new Uint16Array(n);
      vis = new Uint32Array(n);
      depth = new Float32Array(n);
      const { pos: _p, ...rest } = d;
      (self as any).postMessage({ type: 'parsed', ...rest }, [d.centre.buffer, d.covA.buffer, d.covB.buffer, d.colour.buffer]);
    } catch (err) {
      (self as any).postMessage({ type: 'error', message: String((err as Error)?.message ?? err) });
    }
    return;
  }
  if (msg.type === 'sort' && pos) {
    const t0 = performance.now();
    const { order, count } = sort(msg.viewProj, msg.out ?? null);
    (self as any).postMessage({ type: 'order', order, count, id: msg.id, ms: performance.now() - t0 }, [order.buffer]);
  }
};
