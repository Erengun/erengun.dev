/**
 * /qr/: a link drawn as a small Istanbul. The link's QR code is laid over a map of the city centre (real coastline,
 * hills and landmark positions): on land every dark module is a rooftop, at sea a deeper patch of water. Seen from
 * straight above, every surface takes the lightness of the module under it, so the picture is the code, in the
 * city's own colours, and a phone camera reads it.
 *
 * Its own light page: plain three (WebGL), a handful of draw calls. Nothing here touches the journey's renderer.
 * Without WebGL the code is drawn flat on a 2D canvas, so the page always works.
 */
import qrcode from 'qrcode-generator';
import {
  AddEquation, BoxGeometry, BufferGeometry, Color, ConeGeometry, ConstantAlphaFactor, CustomBlending, CylinderGeometry,
  DataTexture, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, NearestFilter,
  OneMinusConstantAlphaFactor, OrthographicCamera, PlaneGeometry, Quaternion, RGBAFormat, Scene, ShaderMaterial,
  SphereGeometry, Vector3, WebGLRenderTarget, WebGLRenderer,
} from 'three';

const DEFAULT = 'https://erengun.dev';
/** light modules kept clear around the code, as the QR spec asks */
const QUIET = 4;
const INK = '#101012', PAPER = '#f3ead8';

type Grid = { n: number; dark: (r: number, c: number) => boolean };

function encode(text: string): Grid | null {
  try {
    const q = qrcode(0, 'M');
    q.addData(text, 'Byte');
    q.make();
    return { n: q.getModuleCount(), dark: (r, c) => q.isDark(r, c) };
  } catch {
    return null; // too long for a QR code
  }
}
// non-Latin text: bytes as UTF-8 (the library's default keeps only the low byte of each character)
(qrcode as any).stringToBytes = (t: string) => Array.from(new TextEncoder().encode(t));

/** "erengun.dev" → "https://erengun.dev"; anything else is encoded as typed */
function normalize(raw: string): string {
  const t = raw.trim();
  if (!t) return DEFAULT;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t) && /^[^\s/]+\.[^\s/]{2,}/.test(t)) return 'https://' + t;
  return t;
}

const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// ---------------------------------------------------------------------------------------------------------------
// The map: central Istanbul, north up. Coastlines are simplified by hand from the real ones; landmarks sit at their
// real coordinates (nudged apart a little where two would overlap at this scale).
const LON0 = 28.945, LON1 = 29.045, LAT0 = 40.987, LAT1 = 41.063;
type LL = [number, number];
const LAND: LL[][] = [
  // Beyoğlu – Beşiktaş: north bank of the Golden Horn, then the European shore of the Bosphorus
  [[28.93, 41.05], [28.95, 41.0368], [28.959, 41.03], [28.961, 41.0262], [28.9665, 41.025], [28.977, 41.0225], [28.984, 41.0265], [28.99, 41.031],
    [28.9935, 41.0345], [29.001, 41.0385], [29.008, 41.0412], [29.017, 41.044], [29.027, 41.0475], [29.033, 41.056], [29.038, 41.064], [29.042, 41.08], [28.93, 41.08]],
  // the historic peninsula: south bank of the Golden Horn, Sarayburnu, the Marmara shore
  [[28.93, 41.042], [28.9475, 41.0325], [28.957, 41.025], [28.962, 41.021], [28.972, 41.0178], [28.979, 41.0172], [28.987, 41.0165], [28.988, 41.012],
    [28.9845, 41.004], [28.976, 41.002], [28.964, 41.002], [28.953, 41.0035], [28.94, 41.0], [28.93, 40.999]],
  // the Asian side: Beylerbeyi, Üsküdar, Salacak, Harem, Haydarpaşa, Kadıköy, Moda
  [[29.07, 41.08], [29.056, 41.064], [29.05, 41.052], [29.041, 41.044], [29.03, 41.0365], [29.022, 41.032], [29.015, 41.0275], [29.009, 41.0205], [29.01, 41.012], [29.015, 40.999],
    [29.023, 40.993], [29.025, 40.98], [29.03, 40.97], [29.06, 40.97]],
];
/** hills: lon, lat, height (modules at the smallest code), radius in degrees */
const HILLS: [number, number, number, number][] = [
  [28.9639, 41.0162, 1.2, 0.008], [28.9795, 41.0085, 0.85, 0.008], [28.952, 41.014, 1.2, 0.012],
  [28.976, 41.033, 1.5, 0.011], [28.986, 41.038, 1.7, 0.012], [29.01, 41.053, 1.6, 0.013], [28.955, 41.045, 1.3, 0.014],
  [29.036, 41.026, 2.0, 0.016], [29.03, 40.992, 0.7, 0.012],
];
/** parks: lon, lat, radius in degrees */
const PARKS: [number, number, number][] = [[28.9812, 41.0138, 0.0028], [29.012, 41.0495, 0.005], [28.995, 41.0432, 0.0035], [29.026, 41.0312, 0.0035], [28.957, 41.0085, 0.002]];
const FERRIES: [LL, LL, number][] = [
  [[28.9748, 41.0196], [29.0118, 41.0262], 0.55], [[28.9795, 41.0212], [29.0155, 40.9935], 0.5], [[28.9958, 41.0332], [29.0122, 41.0288], 0.4],
  [[28.9705, 41.0203], [28.9585, 41.0272], 0.3], [[29.02, 41.04], [29.0, 41.005], 0.7],
];

const inPoly = (lon: number, lat: number, poly: LL[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const ROOFS = ['#c1502e', '#b5482c', '#cf6034', '#a84229', '#c9582f', '#bb4a2a'];
const WALLS = ['#f2e3c6', '#e9b872', '#d98268', '#9cc0c4', '#efd9a7', '#c3d1a4', '#e6c2b0', '#f7efe0', '#d6a5a0', '#b7c7d9'];
/** linear luminance of everything over a dark module in the straight-down view */
const DARK = 0.055;
const SLATE = '#4f5b68', LEAD = '#6c7b88', STONE = '#dccfb4', ROCK = '#6a6156', GOLD = '#d2a646', GREEN = '#4f8a3f', CYPRESS = '#2f5c3a';
const UP = new Vector3(0, 1, 0);

class Parts {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; flat: number[] = []; misc: number[] = [];
  private m = new Matrix4();
  private base = new Matrix4();
  private c = new Color();
  private f = new Color();
  private d = 0;
  /** where the next pieces go: position, turn about the vertical, scale, and the delay of their rise */
  at(x: number, y: number, z: number, rot = 0, s = 1, d = 0) {
    this.base.compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, rot), new Vector3(s, s, s));
    this.d = d;
    return this;
  }
  /**
   * one primitive: unit shape scaled to (sx, sy, sz), base at (x, y, z) in the current frame.
   * kind 0 wall with windows and a door, 1 plain, 2 long wall (arches), 5 lamp (only at night); +10 floodlit at night.
   */
  add(geo: BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, kind = 1, tone = 1) {
    const g = geo.clone();
    g.applyMatrix4(this.m.makeScale(sx, sy, sz).setPosition(x, y, z).premultiply(this.base));
    this.c.set(color).multiplyScalar(tone);
    // the tint it takes over a dark module in the code: its own hue at one lightness (scanners threshold locally, and
    // a paler roof among darker ones would read as a light module)
    this.f.set(color);
    this.f.multiplyScalar(DARK / Math.max(0.02, 0.2126 * this.f.r + 0.7152 * this.f.g + 0.0722 * this.f.b));
    const p = g.getAttribute('position'), nn = g.getAttribute('normal'), u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      this.uv.push(u.getX(i), u.getY(i));
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.flat.push(this.f.r, this.f.g, this.f.b);
      this.misc.push(kind, this.d);
    }
    g.dispose();
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aCol', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFlat', new Float32BufferAttribute(this.flat, 3));
    g.setAttribute('aMisc', new Float32BufferAttribute(this.misc, 2));
    return g;
  }
}

/** unit shapes, base on y = 0, flat-shaded */
function shapes() {
  const flatten = (g: BufferGeometry) => { const o = g.toNonIndexed(); o.computeVertexNormals(); g.dispose(); return o; };
  const box = flatten(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const roof = flatten(new ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0)); // square base, side 1
  const tube = flatten(new CylinderGeometry(0.5, 0.5, 1, 14).translate(0, 0.5, 0));
  const cone = flatten(new ConeGeometry(0.5, 1, 14).translate(0, 0.5, 0));
  const dome = new SphereGeometry(0.5, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed(); // smooth
  const ball = new SphereGeometry(0.5, 10, 7).translate(0, 0.5, 0).toNonIndexed();
  // a gable roof: base 1 × 1, ridge along x
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], E = [-0.5, 1, 0], F = [0.5, 1, 0];
  const tris = [D, C, F, D, F, E, B, A, E, B, E, F, A, D, E, C, B, F].flat();
  const gableX = new BufferGeometry();
  gableX.setAttribute('position', new Float32BufferAttribute(tris, 3));
  gableX.setAttribute('uv', new Float32BufferAttribute(new Float32Array(tris.length / 3 * 2), 2));
  gableX.computeVertexNormals();
  const gableZ = gableX.clone().rotateY(Math.PI / 2);
  return { box, roof, tube, cone, dome, ball, gableX, gableZ };
}
type Shapes = ReturnType<typeof shapes>;

// ---- landmarks, modelled around their own origin; one unit is about a module of the smallest code
function minaret(P: Parts, S: Shapes, x: number, z: number, h = 2.5) {
  P.add(S.tube, x, 0, z, 0.12, h, 0.12, '#f1e8d4', 11);
  for (const by of [h * 0.52, h * 0.76]) {
    P.add(S.tube, x, by, z, 0.21, 0.05, 0.21, STONE, 11);
    P.add(S.tube, x, by + 0.05, z, 0.23, 0.025, 0.23, '#ffd9a0', 5);
  }
  P.add(S.cone, x, h, z, 0.17, 0.5, 0.17, LEAD);
  P.add(S.cone, x, h + 0.48, z, 0.03, 0.14, 0.03, GOLD);
}
function mosque(P: Parts, S: Shapes, o: { wall: string; dome: number; minarets: 2 | 4 | 6; court: boolean; buttress?: boolean }) {
  const W = o.wall;
  P.add(S.box, 0, 0, 0, 1.3, 0.72, 1.3, W, 12);
  P.add(S.box, 0, 0.72, 0, 1.36, 0.06, 1.36, LEAD);
  P.add(S.tube, 0, 0.78, 0, 1.0 * o.dome, 0.17, 1.0 * o.dome, W, 12);
  P.add(S.dome, 0, 0.95, 0, 0.98 * o.dome, 0.92 * o.dome, 0.98 * o.dome, LEAD);
  P.add(S.cone, 0, 0.95 + 0.45 * o.dome, 0, 0.045, 0.24, 0.045, GOLD);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) P.add(S.dome, dx * 0.44, 0.78, dz * 0.44, 0.62, 0.52, 0.62, LEAD);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.add(S.dome, dx * 0.5, 0.78, dz * 0.5, 0.3, 0.3, 0.3, LEAD);
  if (o.buttress) for (const dx of [-1, 1]) for (const dz of [-0.35, 0.35]) P.add(S.box, dx * 0.72, 0, dz, 0.2, 0.6, 0.22, W, 11);
  const pts = o.minarets === 2 ? [[-0.8, 0.8], [0.8, 0.8]] : [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]];
  for (const [mx, mz] of pts) minaret(P, S, mx, mz, o.minarets === 2 ? 2.1 : 2.6);
  if (o.court) { // the arcaded courtyard in front, with its fountain
    for (const dx of [-1, 1]) {
      P.add(S.box, dx * 0.74, 0, 1.36, 0.14, 0.3, 1.28, STONE, 12);
      P.add(S.box, dx * 0.74, 0.3, 1.36, 0.18, 0.04, 1.32, LEAD);
    }
    P.add(S.box, 0, 0, 1.96, 1.62, 0.3, 0.14, STONE, 12);
    P.add(S.box, 0, 0.3, 1.96, 1.66, 0.04, 0.18, LEAD);
    for (let i = -3; i <= 3; i++) P.add(S.dome, i * 0.22, 0.34, 1.96, 0.16, 0.12, 0.16, LEAD);
    P.add(S.tube, 0, 0, 1.3, 0.26, 0.2, 0.26, STONE, 11);
    P.add(S.dome, 0, 0.2, 1.3, 0.3, 0.2, 0.3, LEAD);
  }
  if (o.minarets === 6) {
    minaret(P, S, -0.8, 2.0, 2.0); minaret(P, S, 0.8, 2.0, 2.0);
    for (let i = 1; i < 11; i++) { const t = i / 11; P.add(S.box, -0.8 + t * 1.6, 1.85 - Math.sin(t * Math.PI) * 0.32, 0.8, 0.05, 0.05, 0.05, '#ffd9a0', 5); }
  }
}
function galata(P: Parts, S: Shapes) {
  P.add(S.tube, 0, 0, 0, 1.0, 0.14, 1.0, ROCK);
  P.add(S.tube, 0, 0.14, 0, 0.86, 1.75, 0.86, '#d3c3a4', 12);
  P.add(S.tube, 0, 1.89, 0, 1.06, 0.1, 1.06, '#8c7f6a');
  P.add(S.tube, 0, 1.99, 0, 1.1, 0.03, 1.1, '#ffd9a0', 5);
  P.add(S.tube, 0, 1.99, 0, 0.76, 0.38, 0.76, '#ddceb0', 12);
  P.add(S.tube, 0, 2.37, 0, 0.9, 0.06, 0.9, '#8c7f6a');
  P.add(S.cone, 0, 2.43, 0, 0.94, 0.9, 0.94, SLATE);
  P.add(S.cone, 0, 3.3, 0, 0.05, 0.3, 0.05, GOLD);
}
function maiden(P: Parts, S: Shapes) {
  const W = '#f3ebd9', T = '#b5482c';
  P.add(S.tube, 0, -0.1, 0, 1.05, 0.2, 1.05, ROCK);
  P.add(S.box, -0.13, 0.1, 0.08, 0.56, 0.3, 0.5, W, 10);
  P.add(S.roof, -0.13, 0.4, 0.08, 0.64, 0.2, 0.58, T);
  P.add(S.box, 0.24, 0.1, -0.18, 0.3, 0.86, 0.3, W, 10);
  P.add(S.box, 0.24, 0.96, -0.18, 0.4, 0.05, 0.4, STONE);
  P.add(S.tube, 0.24, 1.01, -0.18, 0.22, 0.18, 0.22, W, 11);
  P.add(S.dome, 0.24, 1.19, -0.18, 0.27, 0.32, 0.27, LEAD);
  P.add(S.cone, 0.24, 1.32, -0.18, 0.025, 0.46, 0.025, GOLD);
  P.add(S.box, 0.32, 1.64, -0.18, 0.15, 0.09, 0.012, '#d1202a');
  for (const [dx, dz] of [[-0.4, -0.3], [0.42, 0.2], [-0.2, 0.42], [0, -0.45]]) P.add(S.box, dx, 0.12, dz, 0.06, 0.06, 0.06, '#ffd9a0', 5);
}
function topkapi(P: Parts, S: Shapes) {
  const W = '#efe5d0';
  P.add(S.box, 0, 0, 0, 1.6, 0.16, 1.2, STONE, 12);
  P.add(S.box, -0.42, 0.16, -0.25, 0.55, 0.3, 0.42, W, 10); P.add(S.roof, -0.42, 0.46, -0.25, 0.62, 0.2, 0.5, LEAD);
  P.add(S.box, 0.32, 0.16, 0.28, 0.66, 0.28, 0.36, W, 10); P.add(S.roof, 0.32, 0.44, 0.28, 0.74, 0.18, 0.44, LEAD);
  for (let i = 0; i < 5; i++) { P.add(S.box, -0.62 + i * 0.2, 0.16, 0.44, 0.2, 0.2, 0.2, W, 10); P.add(S.dome, -0.62 + i * 0.2, 0.36, 0.44, 0.2, 0.16, 0.2, LEAD); }
  P.add(S.box, 0.4, 0.16, -0.3, 0.2, 1.15, 0.2, W, 11);
  P.add(S.cone, 0.4, 1.31, -0.3, 0.28, 0.55, 0.28, LEAD);
  for (const [dx, dz] of [[-0.05, -0.05], [0.6, -0.1], [-0.6, 0.1]]) { P.add(S.tube, dx, 0.16, dz, 0.05, 0.2, 0.05, '#6b4a33'); P.add(S.ball, dx, 0.3, dz, 0.3, 0.34, 0.3, GREEN); }
}
function dolmabahce(P: Parts, S: Shapes) {
  const W = '#f1e9da';
  P.add(S.box, 0, 0, 0, 2.3, 0.4, 0.42, W, 12); P.add(S.box, 0, 0.4, 0, 2.36, 0.05, 0.48, LEAD);
  P.add(S.box, 0, 0, 0, 0.62, 0.62, 0.54, W, 12); P.add(S.box, 0, 0.62, 0, 0.68, 0.05, 0.6, LEAD); P.add(S.dome, 0, 0.67, 0, 0.36, 0.26, 0.36, LEAD);
  for (const dx of [-1, 1]) { P.add(S.box, dx * 1.0, 0, 0, 0.34, 0.52, 0.5, W, 12); P.add(S.roof, dx * 1.0, 0.52, 0, 0.4, 0.14, 0.56, LEAD); }
  P.add(S.box, -1.55, 0, 0.1, 0.16, 0.95, 0.16, W, 11); P.add(S.cone, -1.55, 0.95, 0.1, 0.2, 0.26, 0.2, LEAD);
  P.add(S.box, 0, 0, 0.3, 2.4, 0.06, 0.14, STONE); // the quay
}
function haydarpasa(P: Parts, S: Shapes) {
  const W = '#dfcda8';
  P.add(S.box, 0, 0, 0, 1.4, 0.6, 0.5, W, 12); P.add(S.gableX, 0, 0.6, 0, 1.46, 0.3, 0.56, SLATE);
  for (const dx of [-1, 1]) {
    P.add(S.box, dx * 0.58, 0, -0.45, 0.32, 0.5, 0.62, W, 12); P.add(S.gableZ, dx * 0.58, 0.5, -0.45, 0.38, 0.24, 0.66, SLATE);
    P.add(S.tube, dx * 0.64, 0, 0.26, 0.22, 0.86, 0.22, W, 11); P.add(S.cone, dx * 0.64, 0.86, 0.26, 0.27, 0.42, 0.27, SLATE);
  }
}
function bridge(P: Parts, S: Shapes, L: number, tall: boolean) {
  if (!tall) { // a low bridge on piers
    P.add(S.box, 0, 0.2, 0, L, 0.05, 0.28, '#9c978e');
    for (let x = -L / 2 + 0.3; x < L / 2; x += 0.6) P.add(S.box, x, -0.1, 0, 0.1, 0.3, 0.22, '#7d786f');
    for (const dz of [-0.14, 0.14]) P.add(S.box, 0, 0.25, dz, L, 0.04, 0.015, '#6f6a62');
    for (let x = -L / 2 + 0.2; x < L / 2; x += 0.45) P.add(S.box, x, 0.3, 0.14, 0.04, 0.04, 0.04, '#ffd9a0', 5);
    return;
  }
  const H = 2.1, D = 0.8, T = 0.3 * L; // a suspension bridge: towers, the main cables, hangers
  P.add(S.box, 0, D, 0, L, 0.06, 0.26, '#a6acb4');
  for (const sx of [-1, 1]) {
    for (const dz of [-0.13, 0.13]) P.add(S.box, sx * T, -0.1, dz, 0.07, H + 0.1, 0.07, '#c3c8cf', 11);
    for (const y of [D - 0.12, H - 0.25, H * 0.72]) P.add(S.box, sx * T, y, 0, 0.06, 0.06, 0.3, '#c3c8cf', 11);
  }
  const N = 34;
  for (let i = 0; i <= N; i++) {
    const x = -L / 2 + (i / N) * L, u = Math.abs(x) / T;
    const y = u <= 1 ? D + 0.12 + (H - D - 0.12) * u * u : H - (H - D) * Math.min(1, (u - 1) / (L / 2 / T - 1));
    for (const dz of [-0.13, 0.13]) {
      P.add(S.box, x, y, dz, L / N + 0.02, 0.035, 0.035, '#c3c8cf');
      if (i % 2 === 0 && y > D + 0.1) P.add(S.box, x, D, dz, 0.012, y - D, 0.012, '#c3c8cf');
    }
    if (i % 2 === 0) P.add(S.box, x, y + 0.04, 0.13, 0.05, 0.05, 0.05, '#ffd9a0', 5);
  }
}

type Mark = { name: string; ll: LL; r: number; top: number; make: (P: Parts, S: Shapes) => void; rot?: number; x?: number; z?: number; y?: number };
const MARKS: Mark[] = [
  { name: 'Galata Kulesi', ll: [28.9741, 41.0256], r: 0.7, top: 3.7, make: galata },
  { name: 'Ayasofya', ll: [28.98, 41.0086], r: 1.05, top: 2.9, make: (P, S) => mosque(P, S, { wall: '#d58e75', dome: 1.12, minarets: 4, court: false, buttress: true }), rot: 0.6 },
  { name: 'Sultanahmet', ll: [28.9768, 41.0054], r: 1.25, top: 2.9, make: (P, S) => mosque(P, S, { wall: '#d9d4c8', dome: 1.0, minarets: 6, court: true }), rot: -2.2 },
  { name: 'Süleymaniye', ll: [28.9639, 41.0162], r: 1.2, top: 2.9, make: (P, S) => mosque(P, S, { wall: '#d8d0bd', dome: 1.08, minarets: 4, court: true }), rot: 2.4 },
  { name: 'Topkapı Sarayı', ll: [28.984, 41.0128], r: 1.0, top: 1.9, make: topkapi, rot: 0.5 },
  { name: 'Kız Kulesi', ll: [29.0041, 41.0211], r: 0.6, top: 2.0, make: maiden },
  { name: 'Dolmabahçe', ll: [28.9992, 41.04], r: 1.2, top: 1.3, make: dolmabahce, rot: 0.55 + Math.PI },
  { name: 'Haydarpaşa', ll: [29.0205, 40.9978], r: 0.95, top: 1.5, make: haydarpasa, rot: -0.9 },
  { name: 'Ortaköy Camii', ll: [29.0262, 41.0462], r: 0.7, top: 2.3, make: (P, S) => mosque(P, S, { wall: '#f1e9da', dome: 0.9, minarets: 2, court: false }), rot: 2.2 },
];
const BRIDGES: { name: string; a: LL; b: LL; tall: boolean }[] = [
  { name: 'Galata Köprüsü', a: [28.9722, 41.0176], b: [28.9748, 41.0228], tall: false },
  { name: 'Atatürk Köprüsü', a: [28.9628, 41.0206], b: [28.9652, 41.0256], tall: false },
  { name: 'Boğaziçi Köprüsü', a: [29.0262, 41.0478], b: [29.0418, 41.0428], tall: true },
];

type City = {
  geo: BufferGeometry; land: BufferGeometry; tex: DataTexture; tallest: number; k: number;
  chimneys: number[][]; labels: { name: string; x: number; y: number; z: number }[];
  isLand: (r: number, c: number) => boolean; height: (r: number, c: number) => number;
  world: (ll: LL) => [number, number];
};

function buildCity(g: Grid, S: Shapes): City {
  const n = g.n, P = new Parts(), G = new Parts();
  const k = 1.08 * Math.min(1.5, Math.sqrt(n / 25)); // landmarks are drawn large, as on a tourist map, and grow a little with the code
  const X = (c: number) => c - n / 2 + 0.5, Z = (r: number) => r - n / 2 + 0.5;
  const world = ([lon, lat]: LL): [number, number] => [((lon - LON0) / (LON1 - LON0)) * n - n / 2, ((LAT1 - lat) / (LAT1 - LAT0)) * n - n / 2];
  const lonlat = (x: number, z: number): LL => [LON0 + ((x + n / 2) / n) * (LON1 - LON0), LAT1 - ((z + n / 2) / n) * (LAT1 - LAT0)];
  const cellOf = (x: number, z: number): [number, number] => [Math.max(0, Math.min(n - 1, Math.floor(z + n / 2))), Math.max(0, Math.min(n - 1, Math.floor(x + n / 2)))];

  // ---- land and sea, and how far each module is from the shore
  const land = new Uint8Array(n * n), dist = new Float32Array(n * n).fill(99);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const [lon, lat] = lonlat(X(c), Z(r));
    land[r * n + c] = LAND.some((p) => inPoly(lon, lat, p)) ? 1 : 0;
  }
  const isLand = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && land[r * n + c] === 1;
  for (let pass = 0; pass < 2; pass++) { // two sweeps of a chamfer distance to the other kind of cell
    const order = pass ? [...Array(n * n).keys()].reverse() : [...Array(n * n).keys()];
    for (const i of order) {
      const r = (i / n) | 0, c = i % n;
      let d = 99;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if ((!dr && !dc) || rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const step = dr && dc ? 1.4 : 1;
        d = Math.min(d, land[rr * n + cc] !== land[i] ? step : dist[rr * n + cc] + step);
      }
      dist[i] = Math.min(dist[i], d);
    }
  }

  // ---- landmarks: real positions, pushed apart where two would stand in each other
  const marks = MARKS.map((m) => { const [x, z] = world(m.ll); return { ...m, x, z }; });
  for (let it = 0; it < 12; it++) for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) {
    const a = marks[i], b = marks[j], dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1e-3, want = (a.r + b.r) * k * 0.92;
    if (d < want) { const push = (want - d) / 2 / d; a.x -= dx * push; a.z -= dz * push; b.x += dx * push; b.z += dz * push; }
  }

  // ---- hills, in terraces a module wide; flat under each landmark
  const STEP = 0.16, BASE = 0.14;
  const h = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!land[r * n + c]) continue;
    const [lon, lat] = lonlat(X(c), Z(r));
    let e = 0;
    for (const [hl, ha, hh, hr] of HILLS) e += hh * Math.exp(-(((lon - hl) * 0.76) ** 2 + (lat - ha) ** 2) / (hr * hr));
    e = Math.min(e * k, (dist[r * n + c] - 1) * 0.5);
    h[r * n + c] = BASE + Math.max(0, Math.round(e / STEP)) * STEP;
  }
  for (const m of marks) {
    const [r0, c0] = cellOf(m.x, m.z);
    m.y = land[r0 * n + c0] ? h[r0 * n + c0] : 0;
    const R = Math.ceil(m.r * k);
    for (let r = r0 - R; r <= r0 + R; r++) for (let c = c0 - R; c <= c0 + R; c++) {
      if (isLand(r, c) && land[r0 * n + c0] && Math.hypot(X(c) - m.x, Z(r) - m.z) < m.r * k + 0.4) h[r * n + c] = m.y;
    }
  }
  const height = (r: number, c: number) => (isLand(r, c) ? h[r * n + c] : 0);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (land[r * n + c]) { G.at(X(c), 0, Z(r)); G.add(S.box, 0, -0.3, 0, 1, h[r * n + c] + 0.3, 1, STONE); }

  const taken = (x: number, z: number) => marks.some((m) => Math.hypot(x - m.x, z - m.z) < m.r * k);
  const inPark = (x: number, z: number) => { const [lon, lat] = lonlat(x, z); return PARKS.some(([pl, pa, pr]) => Math.hypot((lon - pl) * 0.76, lat - pa) < pr); };
  const pick = <T,>(list: T[], v: number) => list[Math.floor(v * list.length) % list.length];
  const tree = (x: number, z: number, v: number, s = 1) => {
    if (v < 0.4) P.add(S.cone, x, 0, z, 0.24 * s, (0.8 + v) * s, 0.24 * s, CYPRESS, 1, 0.9 + v * 0.4);
    else { P.add(S.tube, x, 0, z, 0.06 * s, 0.22 * s, 0.06 * s, '#6b4a33'); P.add(S.ball, x, 0.16 * s, z, 0.42 * s, 0.46 * s, 0.42 * s, v > 0.75 ? '#6aa04a' : GREEN, 1, 0.85 + v * 0.3); }
  };
  const chimneys: number[][] = [];

  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!land[r * n + c]) continue;
    const x = X(c), z = Z(r), y = h[r * n + c];
    if (taken(x, z)) continue;
    const h1 = hash(r, c), h2 = hash(c + 3, r + 7), h3 = hash(r + 13, c + 4), tone = 0.92 + 0.16 * h2;
    const d = Math.hypot(r - n / 2, c - n / 2) / n * 1.2 + hash(r, c + 11) * 0.25;
    const park = inPark(x, z);
    P.at(x, y, z, 0, 1, d);
    if (!g.dark(r, c)) { // a street or a square: trees along some of them, groves in the parks
      if (park) { P.add(S.box, 0, 0, 0, 1, 0.03, 1, '#86b25c'); for (let i = 0; i < 3; i++) tree(hash(r + i, c) * 0.7 - 0.35, hash(r, c + i) * 0.7 - 0.35, hash(r + i * 3, c + 5)); }
      else if (h1 < 0.22) { tree(0.3, 0.3, h2, 0.8); if (h3 < 0.5) tree(-0.3, 0.32, h3 * 2, 0.75); }
      continue;
    }
    if (park || h1 < 0.07) { // a park
      P.add(S.box, 0, 0, 0, 1, 0.06, 1, '#6f9a4c', 1, tone);
      for (let i = 0; i < 4; i++) tree(hash(r + i, c + 2) * 0.66 - 0.33, hash(r + 2, c + i) * 0.66 - 0.33, hash(r + i * 5, c + 1), 1.1);
      continue;
    }
    if (h1 > 0.955) { // a neighbourhood mosque: one dome, one minaret
      P.add(S.box, 0, 0, 0, 0.8, 0.42, 0.8, '#e9e1cf', 12);
      P.add(S.box, 0, 0.42, 0, 1, 0.05, 1, LEAD, 1, tone);
      P.add(S.dome, 0, 0.47, 0, 0.7, 0.5, 0.7, LEAD);
      P.add(S.tube, 0.38, 0, 0.38, 0.09, 1.5, 0.09, '#f1e8d4', 11);
      P.add(S.tube, 0.38, 1.05, 0.38, 0.17, 0.04, 0.17, '#ffd9a0', 5);
      P.add(S.cone, 0.38, 1.5, 0.38, 0.13, 0.36, 0.13, LEAD);
      continue;
    }
    const roofC = pick(ROOFS, h1 * 7.3);
    if (h1 > 0.9) { // an apartment block with a flat roof, a stair head and a water tank
      const hh = 0.95 + h2 * 0.6;
      P.add(S.box, 0, 0, 0, 0.9, hh, 0.9, pick(WALLS, h2 * 3.1), 0);
      P.add(S.box, 0, hh, 0, 1, 0.09, 1, SLATE, 1, tone);
      P.add(S.box, -0.2, hh + 0.09, -0.18, 0.32, 0.24, 0.32, '#8f8676');
      P.add(S.tube, 0.22, hh + 0.09, 0.2, 0.2, 0.22, 0.2, '#c9c2b4');
      continue;
    }
    const hh = 0.42 + h2 * 0.62, rh = 0.3 + 0.26 * hash(r + 2, c + 9), wall = pick(WALLS, hash(r + 5, c + 1));
    P.add(S.box, 0, 0, 0, 0.88, hh, 0.88, wall, 0);
    P.add(h3 < 0.3 ? S.gableX : h3 < 0.6 ? S.gableZ : S.roof, 0, hh, 0, 1, rh, 1, roofC, 1, tone);
    if (hash(r + 21, c + 2) < 0.55) {
      const cx = (h3 - 0.5) * 0.3, cz = (h2 - 0.5) * 0.3;
      P.add(S.box, cx, hh + rh * 0.3, cz, 0.12, 0.32, 0.12, '#7a4a3a');
      chimneys.push([x + cx, y + hh + rh * 0.3 + 0.36, z + cz]);
    }
    if (hh > 0.7 && hash(r + 8, c + 17) < 0.4) { // a bay window over the street
      if (h3 < 0.5) P.add(S.box, 0, hh * 0.46, 0.465, 0.46, hh * 0.38, 0.07, wall, 0, 1.08);
      else P.add(S.box, 0.465, hh * 0.46, 0, 0.07, hh * 0.38, 0.46, wall, 0, 1.08);
    }
  }

  const labels: City['labels'] = [];
  for (const m of marks) {
    P.at(m.x, m.y!, m.z, m.rot ?? 0, k, 0.55);
    m.make(P, S);
    labels.push({ name: m.name, x: m.x, y: m.y! + m.top * k, z: m.z });
  }
  for (const b of BRIDGES) {
    const [ax, az] = world(b.a), [bx, bz] = world(b.b), L = Math.hypot(bx - ax, bz - az);
    P.at((ax + bx) / 2, 0.02, (az + bz) / 2, Math.atan2(-(bz - az), bx - ax), 1, 0.7);
    bridge(P, S, L + 0.5, b.tall);
    if (b.tall) labels.push({ name: b.name, x: (ax + bx) / 2, y: 2.4, z: (az + bz) / 2 });
  }

  // ---- what the shaders need to know about each module: dark?, sea?, distance to the shore
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = g.dark((i / n) | 0, i % n) ? 255 : 0;
    data[i * 4 + 1] = land[i] ? 0 : 255;
    data[i * 4 + 2] = Math.min(255, dist[i] * 32);
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, n, n, RGBAFormat);
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return { geo: P.geometry(), land: G.geometry(), tex, tallest: 3.9 * k, k, chimneys, labels, isLand, height, world };
}

/** the things that move: lengthwise along x, origin at the middle of the keel / wheels */
function movers(S: Shapes) {
  const make = (fn: (P: Parts) => void) => { const P = new Parts(); fn(P); return P.geometry(); };
  const ferry = make((P) => {
    P.add(S.box, 0, 0.0, 0, 0.9, 0.13, 0.32, '#f6f1e6');
    P.add(S.box, -0.03, 0.13, 0, 0.62, 0.15, 0.25, '#ffffff', 0);
    P.add(S.box, -0.03, 0.28, 0, 0.46, 0.04, 0.2, '#f0e9da');
    P.add(S.tube, 0.06, 0.32, 0, 0.1, 0.17, 0.1, '#e2603a');
  });
  const boat = make((P) => {
    P.add(S.box, 0, 0.0, 0, 0.5, 0.08, 0.2, '#f6f1e6');
    P.add(S.box, -0.06, 0.08, 0, 0.2, 0.1, 0.14, '#ffffff', 0);
  });
  const taxi = make((P) => {
    P.add(S.box, 0, 0.03, 0, 0.4, 0.1, 0.2, '#f2c230');
    P.add(S.box, -0.03, 0.13, 0, 0.2, 0.08, 0.17, '#3a4654');
    P.add(S.box, -0.03, 0.21, 0, 0.2, 0.015, 0.17, '#f2c230');
    P.add(S.box, 0.205, 0.06, 0, 0.02, 0.05, 0.16, '#fff1c4', 5);
  });
  const tram = make((P) => {
    P.add(S.box, 0, 0.04, 0, 0.86, 0.1, 0.22, '#b3202a');
    P.add(S.box, 0, 0.14, 0, 0.84, 0.12, 0.21, '#efe6d2', 2);
    P.add(S.box, 0, 0.26, 0, 0.86, 0.03, 0.22, '#b3202a');
    P.add(S.box, 0, 0.29, 0, 0.03, 0.2, 0.03, '#3d3a36');
    P.add(S.box, 0.435, 0.07, 0, 0.02, 0.05, 0.16, '#fff1c4', 5);
  });
  return { ferry, boat, taxi, tram };
}

/** straight stretches of street (light modules on land), longest first */
function streets(g: Grid, isLand: (r: number, c: number) => boolean): { r: number; c: number; len: number; across: boolean }[] {
  const n = g.n, out: { r: number; c: number; len: number; across: boolean }[] = [];
  const open = (r: number, c: number) => isLand(r, c) && !g.dark(r, c);
  for (const across of [true, false]) for (let i = 0; i < n; i++) {
    let start = -1;
    for (let j = 0; j <= n; j++) {
      const ok = j < n && (across ? open(i, j) : open(j, i));
      if (ok && start < 0) start = j;
      if (!ok && start >= 0) {
        if (j - start >= 3) out.push(across ? { r: i, c: start, len: j - start, across } : { r: start, c: i, len: j - start, across });
        start = -1;
      }
    }
  }
  return out.sort((a, b) => b.len - a.len);
}

const COMMON = /* glsl */ `
uniform sampler2D uGrid;
uniform float uFlat, uNight, uTime, uN;
uniform vec3 uSun, uStone, uSeaPale;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
/** the module under a point of the city (module coordinates): r dark, g sea, b distance to the shore */
vec4 cellAt(vec2 m) { return texture2D(uGrid, (floor(m) + 0.5) / uN); }
`;
const VERT = /* glsl */ `
attribute vec3 aCol, aFlat;
attribute vec2 aMisc; // kind, rise delay
uniform float uGrow, uFlat, uNight;
uniform mat4 uInv; // world → city
varying vec3 vN, vCol, vFlat; varying vec2 vUv, vM; varying float vY, vKind;
void main() {
  float g = clamp(uGrow * 2.0 - aMisc.y, 0.0, 1.0);
  g = 1.0 - pow(1.0 - g, 3.0);
  vec3 p = position;
  vY = p.y;
  p.y *= g;
  vN = normal; vUv = uv; vCol = aCol; vFlat = aFlat; vKind = aMisc.x;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vM = (uInv * w).xz;
  gl_Position = projectionMatrix * viewMatrix * w;
  if (abs(aMisc.x - 5.0) < 0.1 && uNight * (1.0 - uFlat) < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // lamps: only at night
}`;
const FRAG = COMMON + /* glsl */ `
uniform vec3 uGlass, uLit;
varying vec3 vN, vCol, vFlat; varying vec2 vUv, vM; varying float vY, vKind;
void main() {
  vec3 n = normalize(vN);
  float glow = step(9.5, vKind);
  float k = vKind - 10.0 * glow;
  float nf = uNight * (1.0 - uFlat);
  vec3 col = vCol;
  float win = 0.0, lit = 0.0, tw = 1.0;
  if (k != 1.0 && k < 4.5 && abs(n.y) < 0.5) {
    // windows (arches on the long walls), and a door on a house's ground floor
    float cols = k > 1.5 ? 6.0 : 2.0;
    vec2 g = vec2(vUv.x * cols, vY * 3.4);
    vec2 f = fract(g), id = floor(g);
    win = step(0.26, f.x) * step(f.x, 0.74) * step(0.3, f.y) * step(f.y, 0.78) * step(0.5, id.y + step(1.5, k));
    float door = step(k, 0.5) * step(vY, 0.25) * step(abs(vUv.x - 0.5), 0.1);
    vec2 seed = id + vec2(vCol.r * 37.0 + n.x * 3.0, vCol.g * 91.0 + n.z * 5.0);
    // lights go on and off through the evening, each window in its own time
    lit = step(0.5, hash(seed + floor(uTime * 0.12 + hash(seed + 3.0) * 9.0)));
    tw = 0.75 + 0.5 * hash(seed + 7.0);
    col = mix(col, uGlass, win * 0.8);
    col = mix(col, vec3(0.11, 0.06, 0.035), door);
  }
  // day: a warm low sun, cool sky in the shade, a little darker towards the street
  float lam = max(dot(n, uSun), 0.0);
  vec3 day = col * (vec3(0.5, 0.56, 0.68) * (0.92 + 0.3 * n.y) + vec3(1.08, 0.98, 0.82) * lam * 0.78);
  if (k != 5.0 && abs(n.y) < 0.5) day *= 0.86 + 0.14 * smoothstep(0.0, 0.3, vY);
  // night: moonlight, lit windows, floodlit landmarks, lamps
  vec3 dark = col * vec3(0.13, 0.17, 0.31) * (0.75 + 0.55 * lam + 0.15 * n.y);
  dark = mix(dark, vCol * vec3(1.0, 0.78, 0.5) * (1.0 - 0.4 * clamp(vY / 4.0, 0.0, 1.0)), glow * 0.82);
  dark = mix(dark, uLit * tw, win * lit);
  if (abs(k - 5.0) < 0.1) dark = uLit * 1.25;
  // the code: whatever is here takes the lightness of the module under it
  vec4 cell = cellAt(vM + uN * 0.5);
  vec3 code = cell.r > 0.5 ? vFlat : (cell.g > 0.5 ? uSeaPale : uStone);
  gl_FragColor = vec4(mix(mix(day, dark, nf), code, uFlat), 1.0);
  #include <colorspace_fragment>
}`;
const GROUND_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vP;
void main() { vN = normal; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GROUND_FRAG = COMMON + /* glsl */ `
uniform vec3 uSide, uSea, uSeaDark, uRoofDark;
varying vec3 vN; varying vec3 vP;
void main() {
  float nf = uNight * (1.0 - uFlat);
  vec2 m = vP.xz + uN * 0.5;          // module coordinates: x column, y row
  vec2 cell = floor(m), f = fract(m) - 0.5;
  vec4 here = cellAt(m);
  vec3 col;
  if (vN.y > 0.5 && vP.y > 0.05) {
    // ---- land: paving, the shadows of the houses, street lamps at night
    col = uStone * (0.95 + 0.07 * hash(cell));
    vec2 a = abs(f), a4 = abs(fract(m * 4.0 + hash(cell) * 0.5) - 0.5);
    col *= 1.0 - 0.07 * smoothstep(0.44, 0.5, max(a.x, a.y)) - 0.03 * smoothstep(0.4, 0.5, max(a4.x, a4.y));
    vec2 s = normalize(uSun.xz);
    vec4 c1 = cellAt(m + s * 0.42), c2 = cellAt(m + s * 0.84);
    float shade = max(c1.r * (1.0 - c1.g), 0.6 * c2.r * (1.0 - c2.g));
    vec3 day = col * mix(vec3(1.0), vec3(0.66, 0.7, 0.84), shade);
    vec3 dusk = col * vec3(0.13, 0.16, 0.29);
    vec2 q = fract(m * 0.5 + 0.25) - 0.5;
    dusk += vec3(1.0, 0.7, 0.36) * exp(-dot(q, q) * 30.0) * step(0.4, hash(floor(m * 0.5 + 0.25))) * 0.42;
    vec3 code = here.r > 0.5 ? uRoofDark : uStone * (0.975 + 0.03 * hash(cell));
    col = mix(mix(day, dusk, nf), code, uFlat);
  } else if (vN.y > 0.5) {
    // ---- sea: turquoise by the shore, deeper further out, moving light, foam along the land
    vec2 mb = m - 0.5, fb = fract(mb);
    float d00 = cellAt(mb).b, d10 = cellAt(mb + vec2(1.0, 0.0)).b, d01 = cellAt(mb + vec2(0.0, 1.0)).b, d11 = cellAt(mb + vec2(1.0, 1.0)).b;
    float depth = clamp(mix(mix(d00, d10, fb.x), mix(d01, d11, fb.x), fb.y) * 8.0 / 5.0, 0.0, 1.0);
    depth = smoothstep(0.1, 1.0, depth);
    float wave = sin(m.x * 7.0 + uTime * 1.3 + sin(m.y * 5.0 - uTime * 0.8) * 1.6) * 0.5 + 0.5;
    float glint = pow(sin(m.x * 23.0 - uTime * 2.1 + sin(m.y * 17.0 + uTime) * 2.0) * 0.5 + 0.5, 12.0);
    vec3 day = mix(vec3(0.33, 0.74, 0.8), uSea, depth) * (0.94 + 0.1 * wave) * (here.r > 0.5 ? 0.93 : 1.04) + glint * 0.18;
    float foam = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 d = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(-1.0, 0.0) : i == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
      vec2 mm = m + d;
      float inside = step(0.0, mm.x) * step(mm.x, uN) * step(0.0, mm.y) * step(mm.y, uN);
      float edge = smoothstep(0.3 + 0.06 * sin(uTime * 1.7 + dot(cell, vec2(3.0, 5.0))), 0.5, dot(f, d));
      foam = max(foam, edge * (1.0 - cellAt(mm).g) * inside);
    }
    day = mix(day, vec3(0.92, 0.98, 0.98), foam * 0.6);
    vec3 dusk = vec3(0.03, 0.07, 0.15) * (here.r > 0.5 ? 0.85 : 1.1) + vec3(0.9, 0.75, 0.5) * glint * 0.25 + vec3(0.2, 0.26, 0.4) * foam * 0.4;
    vec3 code = here.r > 0.5 ? uSeaDark : uSeaPale * (0.985 + 0.02 * hash(cell));
    col = mix(mix(day, dusk, nf), code, uFlat);
  } else {
    // ---- the sides: retaining walls on land, the cut edge of the sea below
    vec3 wall = vP.y > 0.0 ? uSide * (abs(vN.x) > 0.5 ? 1.0 : 0.82) * (0.8 + 0.2 * smoothstep(-0.1, 0.5, vP.y)) : uSea * (abs(vN.x) > 0.5 ? 0.75 : 0.6);
    col = mix(wall, wall * vec3(0.16, 0.2, 0.34), nf);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

function draw2d(canvas: HTMLCanvasElement, g: Grid) {
  const size = g.n + QUIET * 2;
  const px = Math.max(4, Math.floor(Math.min(innerWidth - 32, innerHeight * 0.55) / size));
  canvas.width = canvas.height = size * px;
  canvas.style.width = canvas.style.height = `${size * px}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = INK;
  for (let r = 0; r < g.n; r++) for (let c = 0; c < g.n; c++) if (g.dark(r, c)) ctx.fillRect((c + QUIET) * px, (r + QUIET) * px, px, px);
}

function boot() {
  const root = document.querySelector<HTMLElement>('[data-qr]');
  if (!root) return;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const input = root.querySelector<HTMLInputElement>('[data-qr-input]')!;
  const toggle = root.querySelector<HTMLButtonElement>('[data-qr-toggle]')!;
  const share = root.querySelector<HTMLButtonElement>('[data-qr-share]')!;
  const note = root.querySelector<HTMLElement>('[data-qr-note]')!;
  const panel = root.querySelector<HTMLElement>('[data-qr-panel]')!;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);

  let text = normalize(params.get('u') ?? '');
  let grid = encode(text) ?? encode(DEFAULT)!;
  input.value = text === DEFAULT && !params.has('u') ? '' : text;

  let flat = params.has('code') ? 1 : 0; // target: 0 city, 1 code
  // day or night: the link says, else the last choice, else the visitor's own clock
  const skies = [...root.querySelectorAll<HTMLButtonElement>('[data-qr-sky]')];
  let stored: string | null = null;
  try { stored = localStorage.getItem('qr-sky'); } catch { /* no storage */ }
  const hour = new Date().getHours();
  let night = (params.get('t') ?? stored ?? (hour >= 19 || hour < 6 ? 'night' : 'day')) === 'night';
  const label = () => {
    toggle.textContent = flat ? 'Back to the city' : 'Tap the city to see the code';
    toggle.setAttribute('aria-pressed', String(!!flat));
    root.dataset.state = flat ? 'code' : 'city';
    for (const b of skies) b.setAttribute('aria-pressed', String((b.dataset.qrSky === 'night') === night));
    // the code is always read on a pale page: the night sky is only behind the city
    document.documentElement.dataset.sky = night && !flat ? 'night' : 'day';
  };
  let toast = 0;
  const say = (msg: string, ms = 2200) => {
    note.textContent = msg;
    clearTimeout(toast);
    if (ms) toast = window.setTimeout(() => { note.textContent = ''; }, ms);
  };

  // ---- renderer (or the flat code when there is no WebGL)
  let renderer: WebGLRenderer | null = null;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch { /* flat code below */ }
  if (!renderer) {
    root.dataset.state = 'flat';
    toggle.hidden = true;
    for (const b of skies) b.parentElement!.hidden = true;
    const redraw = () => draw2d(canvas, grid);
    redraw();
    addEventListener('resize', redraw);
    wire(redraw);
    return;
  }

  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const city = new Group();
  scene.add(city);

  const S = shapes(), M = movers(S);
  const uFlat = { value: flat }, uGrow = { value: calm ? 1 : 0 }, uNight = { value: night ? 1 : 0 }, uTime = { value: 0 };
  const dark = (hex: string) => { const c = new Color(hex); return c.multiplyScalar(DARK / (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b)); };
  const shared = {
    uFlat, uNight, uTime, uN: { value: 1 }, uGrid: { value: null as DataTexture | null },
    uSun: { value: new Vector3(-0.5, 0.62, 0.6).normalize() }, // a low sun in the south-west
    uStone: { value: new Color(PAPER) }, uSeaPale: { value: new Color('#dcebe8') },
  };
  const cityMat = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { ...shared, uGrow, uInv: { value: new Matrix4() }, uGlass: { value: new Color('#33414f') }, uLit: { value: new Color('#ffc66e') } },
  });
  const groundMat = new ShaderMaterial({
    vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG,
    uniforms: { ...shared, uSide: { value: new Color('#c4b392') }, uSea: { value: new Color('#2f86ad') }, uSeaDark: { value: dark('#1f4f7c') }, uRoofDark: { value: dark('#b5482c') } },
  });

  let made: City | null = null;
  let plate = 0, tallest = 0;
  const statics = new Group(), traffic = new Group(), smoke = new Group(), sea = new Group(), gulls = new Group(), clouds = new Group();
  city.add(statics, traffic, smoke, sea, gulls, clouds);
  const puff = new SphereGeometry(0.5, 8, 6);
  {
    const wings = new BufferGeometry();
    wings.setAttribute('position', new Float32BufferAttribute([0, 0, 0.1, -0.5, 0.1, 0.16, -0.12, 0, -0.14, 0, 0, 0.1, 0.12, 0, -0.14, 0.5, 0.1, 0.16], 3));
    const white = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
    for (let i = 0; i < 9; i++) gulls.add(new Mesh(wings, white));
    const vapour = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false });
    for (let i = 0; i < 3; i++) {
      const c = new Group();
      for (let j = 0; j < 4; j++) { const m = new Mesh(puff, vapour); m.position.set(j * 0.9 - 1.3 + hash(i, j) * 0.4, hash(j, i) * 0.3, hash(i + 2, j) * 0.8); m.scale.set(1.2 + hash(i, j + 5) * 0.8, 0.5 + hash(j, i + 3) * 0.3, 1.0 + hash(i + 7, j) * 0.5); c.add(m); }
      clouds.add(c);
    }
  }
  // names over the landmarks, as on a map (in the city view only)
  const names = document.createElement('div');
  names.className = 'qr__names';
  names.setAttribute('aria-hidden', 'true');
  root.insertBefore(names, panel);
  let tags: { el: HTMLElement; at: Vector3; w: number }[] = [];

  function build() {
    for (const m of [...statics.children] as Mesh[]) { statics.remove(m); m.geometry.dispose(); }
    made?.tex.dispose();
    const n = grid.n;
    made = buildCity(grid, S);
    tallest = made.tallest;
    plate = n;
    shared.uN.value = n;
    shared.uGrid.value = made.tex;
    const slab = new BoxGeometry(n, 0.6, n);
    slab.translate(0, -0.3, 0);
    for (const [geo, mat] of [[made.geo, cityMat], [made.land, groundMat], [slab, groundMat]] as const) {
      const m = new Mesh(geo, mat);
      m.frustumCulled = false;
      statics.add(m);
    }
    if (!calm) uGrow.value = 0;

    // traffic: a tram on the longest street, taxis on the next ones
    traffic.clear();
    streets(grid, made.isLand).slice(0, 16).forEach((st, i) => {
      const m = new Mesh(i === 0 ? M.tram : M.taxi, cityMat);
      m.frustumCulled = false;
      m.userData = { ...st, speed: i === 0 ? 0.55 : 0.8 + hash(i, 3) * 0.6, phase: hash(i, 9) * 10 };
      traffic.add(m);
    });
    // ferries on their real routes
    sea.clear();
    FERRIES.forEach(([a, b, speed], i) => {
      const m = new Mesh(i < 3 ? M.ferry : M.boat, cityMat);
      m.frustumCulled = false;
      m.userData = { a: made!.world(a), b: made!.world(b), speed, phase: hash(i, 4) };
      sea.add(m);
    });
    // smoke from a few chimneys
    for (const m of smoke.children as Mesh[]) (m.material as MeshBasicMaterial).dispose();
    smoke.clear();
    const picks = made.chimneys.filter((_, i) => hash(i, 5) < 0.25).slice(0, 10);
    for (const c of picks) for (let k = 0; k < 3; k++) {
      const m = new Mesh(puff, new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
      m.userData = { at: c, phase: k / 3 + hash(c[0], c[2]) };
      smoke.add(m);
    }
    names.replaceChildren();
    tags = made.labels.map((l) => {
      const el = document.createElement('span');
      el.textContent = l.name;
      names.appendChild(el);
      return { el, at: new Vector3(l.x, l.y, l.z), w: el.offsetWidth || l.name.length * 7 + 12 };
    });
    dirty = true;
  }

  // ---- view
  const ISO = 0.62; // camera elevation over the city, radians
  const TURN = 0.72; // seconds for the whip between city and code
  let blurred = '';
  // north up, as on a map; left alone, the city sways a little around where it was put
  let az = flat ? 0 : -0.18, azBase = az, swayT = 0, azFrom = az, azTo = az, flatNow = flat, dirty = true, last = 0;
  let dragging = false, moved = 0, lastX = 0, idle = 0;
  const smooth = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);

  // motion blur for the whip: each frame is the average of several moments between the last frame and this one
  const SHUTTER = 7;
  const rt = new WebGLRenderTarget(2, 2);
  const blit = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
    uniforms: { t: { value: rt.texture } },
    vertexShader: 'varying vec2 v; void main() { v = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D t; varying vec2 v; void main() { gl_FragColor = texture2D(t, v);\n#include <colorspace_fragment>\n}',
    depthTest: false, depthWrite: false,
    blending: CustomBlending, blendEquation: AddEquation, blendSrc: ConstantAlphaFactor, blendDst: OneMinusConstantAlphaFactor,
  }));
  blit.frustumCulled = false;
  const blitScene = new Scene().add(blit), blitCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function fit() {
    const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 3);
    renderer!.setPixelRatio(dpr);
    renderer!.setSize(w, h, false);
    const s = Math.min(dpr, 1.5); // the blurred frames don't need every pixel
    rt.setSize(Math.round(w * s), Math.round(h * s));
    dirty = true;
  }
  /** camera and city for a moment of the turn: f 0 city … 1 code, a the city's rotation */
  function pose(f: number, a: number) {
    const w = innerWidth, h = innerHeight;
    const e = smooth(f);
    // room for the picture: below the header, above the panel
    const top = 68, bottom = Math.min(h - 120, panelTop - 12);
    const aw = w - 24, ah = Math.max(160, bottom - top);
    // world size to fit: the code square-on with its quiet zone (the page itself, which is as pale as the stone),
    // or the plate's diagonal and the towers seen from the side
    const el = ISO + (Math.PI / 2 - ISO) * e;
    const across = Math.max(1.12, Math.abs(Math.cos(a)) + Math.abs(Math.sin(a))) + 0.04;
    const wide = e * (plate + QUIET * 2) + (1 - e) * plate * across;
    const tall = e * (plate + QUIET * 2) + (1 - e) * (plate * across * Math.sin(ISO) + tallest * Math.cos(ISO) * 0.8);
    // the turn is a whip: it punches in while it spins
    const punch = 1 + 0.2 * Math.sin(Math.PI * e);
    const ppu = Math.min(aw / wide, ah / tall) * punch;
    const cy = (top + bottom) / 2;
    camera.left = -w / 2 / ppu; camera.right = w / 2 / ppu;
    camera.top = cy / ppu; camera.bottom = -(h - cy) / ppu;
    camera.position.set(0, Math.sin(el) * 120, Math.cos(el) * 120);
    camera.up.set(0, Math.cos(el), -Math.sin(el));
    const lift = (1 - e) * tallest * 0.22;
    camera.position.y += lift;
    camera.lookAt(0, lift, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    city.rotation.y = a;
    city.updateMatrixWorld(true);
    (cityMat.uniforms.uInv.value as Matrix4).copy(city.matrixWorld).invert();
    uFlat.value = Math.min(1, Math.max(0, (e - 0.6) / 0.4)); // the city's own light until it is nearly square-on
  }
  let panelTop = 0;
  const measure = () => { panelTop = panel.getBoundingClientRect().top; dirty = true; };
  addEventListener('resize', measure);
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(panel);

  /** everything that lives in the city: traffic, ferries, smoke, gulls, clouds */
  function live(t: number) {
    if (!made) return;
    const grown = uGrow.value >= 1, inCity = flatNow < 0.25 && grown;
    const n = grid.n;
    traffic.visible = inCity;
    if (inCity) for (const m of traffic.children) {
      const d = m.userData, span = d.len - 1;
      const u = (t * d.speed * 0.5 + d.phase) % (span * 2), back = u > span, k = back ? span * 2 - u : u;
      const lane = back ? -0.17 : 0.17, i0 = Math.floor(k), fr = k - i0;
      // up and down the terraces with the street
      const hAt = (i: number) => (d.across ? made!.height(d.r, d.c + Math.min(span, i)) : made!.height(d.r + Math.min(span, i), d.c));
      const y = hAt(i0) + (hAt(i0 + 1) - hAt(i0)) * smooth(fr);
      if (d.across) { m.position.set(d.c + k - n / 2 + 0.5, y, d.r - n / 2 + 0.5 + lane); m.rotation.y = back ? Math.PI : 0; }
      else { m.position.set(d.c - n / 2 + 0.5 - lane, y, d.r + k - n / 2 + 0.5); m.rotation.y = back ? Math.PI / 2 : -Math.PI / 2; }
    }
    // ferries shuttle between their piers, easing in and out of each
    for (const f of sea.children) {
      const d = f.userData, len = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
      const u = (t * d.speed / len * 0.5 + d.phase) % 2, back = u > 1, k = smooth(back ? 2 - u : u);
      f.position.set(d.a[0] + (d.b[0] - d.a[0]) * k, 0.02 + Math.sin(t * 1.4 + d.phase * 9) * 0.012, d.a[1] + (d.b[1] - d.a[1]) * k);
      f.rotation.y = Math.atan2(-(d.b[1] - d.a[1]), d.b[0] - d.a[0]) + (back ? Math.PI : 0);
      f.visible = grown;
    }
    smoke.visible = inCity;
    if (inCity) for (const m of smoke.children as Mesh[]) {
      const u = (t * 0.22 + m.userData.phase) % 1, c = m.userData.at;
      m.position.set(c[0] + u * 0.5, c[1] + u * 1.4, c[2] + u * 0.15);
      m.scale.setScalar(0.1 + u * 0.32);
      (m.material as MeshBasicMaterial).opacity = (1 - u) * (0.6 - 0.3 * uNight.value);
      (m.material as MeshBasicMaterial).color.setScalar(1 - 0.5 * uNight.value);
    }
    gulls.visible = inCity && uNight.value < 0.5;
    if (gulls.visible) {
      const R = plate * 0.3;
      gulls.children.forEach((g, i) => {
        const a = t * (0.32 + 0.05 * (i % 3)) * (i % 2 ? 1 : -1) + i * 1.7, rr = R * (0.55 + 0.2 * (i % 4));
        g.position.set(Math.cos(a) * rr + Math.sin(i * 2.3) * R * 0.6, tallest * 0.9 + (i % 3) * 0.7 + Math.sin(t * 0.6 + i) * 0.4, Math.sin(a) * rr + Math.cos(i * 1.9) * R * 0.6);
        g.rotation.y = -a + (i % 2 ? Math.PI : 0);
        g.scale.set(0.7, Math.sin(t * 7 + i * 2.1) * 2.2, 0.7);
      });
    }
    clouds.visible = inCity && uNight.value < 0.5;
    if (clouds.visible) clouds.children.forEach((c, i) => {
      const span = plate * 1.5, x = ((t * (0.25 + i * 0.04) + i * span * 0.23) % span) - span / 2;
      c.position.set(x, tallest * 1.5 + i * 0.6, (hash(i, 1) - 0.5) * plate * 0.9);
      c.scale.setScalar(plate / 25 * (0.6 + hash(i, 2) * 0.35));
    });
  }
  /** the names follow their landmarks */
  function place(show: boolean) {
    names.style.opacity = show ? '1' : '0';
    if (!show) return;
    const w = innerWidth, h = innerHeight, v = new Vector3();
    const put: number[][] = [];
    for (const t of tags) { // in order of importance: a name that would cover an earlier one is left out
      v.copy(t.at).applyMatrix4(city.matrixWorld).project(camera);
      const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h - 8;
      const clash = put.some(([px, py, pw]) => Math.abs(px - x) < (pw + t.w) / 2 + 4 && Math.abs(py - y) < 20);
      t.el.style.opacity = clash ? '0' : '1';
      if (clash) continue;
      put.push([x, y, t.w]);
      t.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (document.hidden) return;
    const f0 = flatNow, a0 = az;
    if (flatNow !== flat) {
      flatNow = calm ? flat : Math.max(0, Math.min(1, flatNow + Math.sign(flat - flatNow) * dt / TURN));
      // square up to the nearest quarter turn (a QR code reads at any of the four), in the same sweep as the camera
      if (flat) az = azFrom + (azTo - azFrom) * smooth(flatNow);
      dirty = true;
    }
    if (uGrow.value < 1) { uGrow.value = Math.min(1, uGrow.value + dt / 1.6); dirty = true; }
    const sky = night ? 1 : 0;
    if (uNight.value !== sky) { uNight.value = calm ? sky : Math.max(0, Math.min(1, uNight.value + Math.sign(sky - uNight.value) * dt / 0.5)); dirty = true; }
    if (!flat && flatNow === 0 && !dragging && !calm) {
      idle += dt;
      if (idle > 1.2) { swayT += dt; az = azBase + 0.16 * Math.sin(swayT * 0.28); }
    } else if (flatNow > 0 || dragging) { azBase = az; swayT = 0; }
    // the city never holds still; the code does (and then nothing is drawn)
    if (!calm && flatNow < 1) { uTime.value = now / 1000; dirty = true; }
    if (!dirty) return;
    dirty = false;
    live(uTime.value);
    const turning = !calm && flatNow !== f0;
    const soft = turning ? 1.6 * Math.sin(Math.PI * flatNow) : 0;
    const b = soft > 0.3 ? `blur(${soft.toFixed(1)}px)` : '';
    if (b !== blurred) { blurred = b; canvas.style.filter = b; }
    if (!turning) {
      pose(flatNow, az);
      place(flatNow === 0 && uGrow.value >= 1);
      renderer!.setRenderTarget(null);
      renderer!.render(scene, camera);
      return;
    }
    place(false);
    renderer!.autoClear = false;
    renderer!.setRenderTarget(null);
    renderer!.clear();
    for (let i = 0; i < SHUTTER; i++) {
      const k = (i + 1) / SHUTTER;
      pose(f0 + (flatNow - f0) * k, a0 + (az - a0) * k);
      renderer!.setRenderTarget(rt);
      renderer!.clear();
      renderer!.render(scene, camera);
      renderer!.setRenderTarget(null);
      (blit.material as ShaderMaterial).blendAlpha = 1 / (i + 1);
      renderer!.render(blitScene, blitCam);
    }
    renderer!.autoClear = true;
  }

  function setFlat(v: number) {
    flat = v; idle = 0;
    if (v) { azFrom = az; azTo = Math.round(az / (Math.PI / 2)) * (Math.PI / 2); }
    label();
    measure();
  }
  canvas.addEventListener('pointerdown', (e) => { dragging = true; moved = 0; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved += Math.abs(dx);
    if (!flat && moved > 6) { az += dx * 0.008; idle = 0; dirty = true; }
  });
  const up = (tap: boolean) => { if (dragging && tap && moved <= 6) setFlat(flat ? 0 : 1); dragging = false; };
  canvas.addEventListener('pointerup', () => up(true));
  canvas.addEventListener('pointercancel', () => up(false));
  toggle.addEventListener('click', () => setFlat(flat ? 0 : 1));
  for (const b of skies) b.addEventListener('click', () => {
    night = b.dataset.qrSky === 'night';
    try { localStorage.setItem('qr-sky', night ? 'night' : 'day'); } catch { /* no storage */ }
    const u = new URL(location.href);
    u.searchParams.set('t', night ? 'night' : 'day');
    history.replaceState(null, '', u);
    label();
    dirty = true;
  });
  addEventListener('resize', fit);
  renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
  renderer.domElement.addEventListener('webglcontextrestored', () => { dirty = true; });

  label();
  build();
  fit();
  measure();
  requestAnimationFrame(frame);
  wire(build);
  (window as any).__qr = { get settled() { return flatNow === flat && uGrow.value >= 1 && uNight.value === (night ? 1 : 0) && (!dirty || flatNow < 1); }, get text() { return text; } };

  /** the link field and the share button (shared by the 3D and the flat version) */
  function wire(rebuild: () => void) {
    let timer = 0;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = normalize(input.value);
        const g = encode(next);
        if (!g) { say('That is too long for a QR code.', 4000); return; }
        say('', 0);
        if (next === text) return;
        text = next; grid = g;
        const u = new URL(location.href);
        if (text === DEFAULT) u.searchParams.delete('u'); else u.searchParams.set('u', text);
        history.replaceState(null, '', u);
        rebuild();
      }, 350);
    });
    share.addEventListener('click', async () => {
      const u = new URL(location.origin + location.pathname);
      if (text !== DEFAULT) u.searchParams.set('u', text);
      const t = new URLSearchParams(location.search).get('t');
      if (t) u.searchParams.set('t', t);
      try {
        if (navigator.share) await navigator.share({ title: document.title, url: u.href });
        else { await navigator.clipboard.writeText(u.href); say('Link to this city copied.'); }
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') say(u.href, 8000);
      }
    });
  }
}

boot();
