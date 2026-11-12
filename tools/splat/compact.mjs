#!/usr/bin/env node
/**
 * Convert a standard 32-byte `.splat` into the compact 16-byte `.csplat` format read by src/scene/splat/splat.ts.
 *
 *   node tools/splat/compact.mjs <in.splat> [out.csplat] [--order keep|importance] [--check]
 *
 * Layout (little-endian). 64-byte header, then four tightly packed sections (struct-of-arrays, compresses well):
 *   0  'CSP1'                  magic
 *   4  u32  count
 *   8  f32×3 bounds min        positions are quantised relative to these bounds
 *  20  f32×3 bounds max
 *  32  f32  ln(scale) min      scales are quantised in log space
 *  36  f32  ln(scale) max
 *  40  u32  flags              bit 0: splats are sorted by importance (a prefix = the most important subset);
 *                              otherwise the file keeps the source order (our producers shuffle it, so a
 *                              prefix is a uniform subsample)
 *  44..63 reserved (0)
 *  positions  count × u16×3    x = min + q/65535·(max − min)
 *  scales     count × u8×3     s = exp(lmin + q/255·(lmax − lmin))
 *  colours    count × u8×4     sRGB rgb + opacity (verbatim from .splat)
 *  rotations  count × u8×3     smallest-three quaternion, 24 bits: [2-bit index of the dropped (largest) component]
 *                              [3 × 7-bit components in −1/√2..1/√2]; the dropped component is reconstructed ≥ 0
 * = 16 bytes per splat (vs 32).
 *
 * --order keep (default) preserves the source order; our producers shuffle, so a runtime cap = uniform subsample.
 * --order importance sorts by opacity × face-area proxy (descending) so a cap drops the smallest / faintest
 * splats first — fine for photo captures with many tiny floaters, but it opens holes in surface-sampled scenes
 * like the alley (walls are many small flat splats), so the alley uses keep. --check prints the round-trip error.
 *
 * Current outputs (re-run after regenerating a source):
 *   node tools/splat/compact.mjs public/splats/alley.splat public/splats/alley.csplat --check
 *   node tools/splat/compact.mjs public/intro/ski.splat --check
 *   for f in public/memories/*.splat; do node tools/splat/compact.mjs $f; done
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--order'));
const [inPath, outArg] = pos;
if (!inPath) {
  console.error('usage: node tools/splat/compact.mjs <in.splat> [out.csplat] [--order keep|importance] [--check]');
  process.exit(1);
}
const outPath = outArg ?? inPath.replace(/\.splat$/, '') + '.csplat';
const order = opt('--order', 'keep');

const src = fs.readFileSync(inPath);
const buf = src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
const n = Math.floor(buf.byteLength / 32);
const f = new Float32Array(buf, 0, n * 8);
const u = new Uint8Array(buf);

// ---------------------------------------------------------------- order
let idx = new Uint32Array(n).map((_, i) => i);
if (order === 'importance') {
  const imp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const sx = Math.abs(f[o + 3]), sy = Math.abs(f[o + 4]), sz = Math.abs(f[o + 5]);
    // area proxy: product of the two largest axes (what a splat covers when seen face-on)
    const a = Math.max(sx, sy, sz), c = Math.min(sx, sy, sz), b = sx + sy + sz - a - c;
    imp[i] = (u[i * 32 + 27] / 255) * a * b;
  }
  idx = idx.sort((p, q) => imp[q] - imp[p]);
}

// ---------------------------------------------------------------- bounds
const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
let lmin = Infinity, lmax = -Infinity;
const LFLOOR = Math.log(1e-7);
for (let i = 0; i < n; i++) {
  const o = i * 8;
  for (let k = 0; k < 3; k++) {
    const v = f[o + k];
    if (v < bmin[k]) bmin[k] = v;
    if (v > bmax[k]) bmax[k] = v;
    const l = Math.max(Math.log(Math.max(Math.abs(f[o + 3 + k]), 1e-30)), LFLOOR);
    if (l < lmin) lmin = l;
    if (l > lmax) lmax = l;
  }
}
for (let k = 0; k < 3; k++) if (bmax[k] - bmin[k] < 1e-6) bmax[k] = bmin[k] + 1e-6;
if (lmax - lmin < 1e-6) lmax = lmin + 1e-6;

// ---------------------------------------------------------------- encode
const HDR = 64;
const out = new ArrayBuffer(HDR + n * 16);
const dv = new DataView(out);
'CSP1'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)));
dv.setUint32(4, n, true);
for (let k = 0; k < 3; k++) { dv.setFloat32(8 + k * 4, bmin[k], true); dv.setFloat32(20 + k * 4, bmax[k], true); }
dv.setFloat32(32, lmin, true);
dv.setFloat32(36, lmax, true);
dv.setUint32(40, order === 'importance' ? 1 : 0, true);
const P = new Uint16Array(out, HDR, n * 3);
const S = new Uint8Array(out, HDR + n * 6, n * 3);
const C = new Uint8Array(out, HDR + n * 9, n * 4);
const R = new Uint8Array(out, HDR + n * 13, n * 3);
const SQ = Math.SQRT1_2;
const q7 = (v) => Math.max(0, Math.min(127, Math.round(((v + SQ) / (2 * SQ)) * 127)));
for (let j = 0; j < n; j++) {
  const i = idx[j], o = i * 8, b = i * 32;
  for (let k = 0; k < 3; k++) {
    P[j * 3 + k] = Math.round(((f[o + k] - bmin[k]) / (bmax[k] - bmin[k])) * 65535);
    const l = Math.max(Math.log(Math.max(Math.abs(f[o + 3 + k]), 1e-30)), LFLOOR);
    S[j * 3 + k] = Math.round(((l - lmin) / (lmax - lmin)) * 255);
  }
  C[j * 4] = u[b + 24]; C[j * 4 + 1] = u[b + 25]; C[j * 4 + 2] = u[b + 26]; C[j * 4 + 3] = u[b + 27];
  // quaternion (w, x, y, z) from the .splat bytes, normalised; drop the largest component, flip so it is ≥ 0
  const q = [0, 1, 2, 3].map((k) => (u[b + 28 + k] - 128) / 128);
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  let big = 0;
  for (let k = 0; k < 4; k++) { q[k] /= len; if (Math.abs(q[k]) > Math.abs(q[big])) big = k; }
  const sgn = q[big] < 0 ? -1 : 1;
  const rest = [0, 1, 2, 3].filter((k) => k !== big).map((k) => q7(q[k] * sgn));
  const v = (big << 21) | (rest[0] << 14) | (rest[1] << 7) | rest[2];
  R[j * 3] = v & 255; R[j * 3 + 1] = (v >> 8) & 255; R[j * 3 + 2] = (v >> 16) & 255;
}
fs.writeFileSync(outPath, Buffer.from(out));
console.log(`${inPath}: ${n} splats, ${(src.byteLength / 1048576).toFixed(2)} MB → ${outPath} ${(out.byteLength / 1048576).toFixed(2)} MB (${((1 - out.byteLength / src.byteLength) * 100).toFixed(1)}% smaller), order ${order}`);
console.log(`  bounds [${bmin.map((v) => v.toFixed(3))}] → [${bmax.map((v) => v.toFixed(3))}], ln scale ${lmin.toFixed(2)}..${lmax.toFixed(2)}`);

if (flag('--check')) {
  let ep = 0, es = 0, eq = 0;
  for (let j = 0; j < n; j += 17) {
    const i = idx[j], o = i * 8, b = i * 32;
    for (let k = 0; k < 3; k++) {
      const x = bmin[k] + (P[j * 3 + k] / 65535) * (bmax[k] - bmin[k]);
      ep = Math.max(ep, Math.abs(x - f[o + k]));
      const s = Math.exp(lmin + (S[j * 3 + k] / 255) * (lmax - lmin));
      es = Math.max(es, Math.abs(s / Math.abs(f[o + 3 + k]) - 1));
    }
    const v = R[j * 3] | (R[j * 3 + 1] << 8) | (R[j * 3 + 2] << 16);
    const big = v >> 21;
    const r = [(v >> 14) & 127, (v >> 7) & 127, v & 127].map((c) => (c / 127) * 2 * SQ - SQ);
    const qq = [0, 0, 0, 0];
    let m = 0;
    for (let k = 0; k < 4; k++) if (k !== big) qq[k] = r[m++];
    qq[big] = Math.sqrt(Math.max(0, 1 - r[0] * r[0] - r[1] * r[1] - r[2] * r[2]));
    const q = [0, 1, 2, 3].map((k) => (u[b + 28 + k] - 128) / 128);
    const len = Math.hypot(...q) || 1;
    const dot = Math.abs(q.reduce((s, c, k) => s + (c / len) * qq[k], 0));
    eq = Math.max(eq, (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI);
  }
  console.log(`  max error: position ${(ep * 1000).toFixed(2)} mm, scale ${(es * 100).toFixed(2)} %, rotation ${eq.toFixed(2)}°`);
}
