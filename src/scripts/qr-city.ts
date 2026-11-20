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
  BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry,
  DataTexture, DoubleSide, Float32BufferAttribute, LinearFilter, Group, Matrix4, Mesh, MeshBasicMaterial, NearestFilter,
  NoBlending, OrthographicCamera, PlaneGeometry, Quaternion, RGBAFormat, Scene, ShaderMaterial,
  SphereGeometry, Vector2, Vector3, Vector4, WebGLRenderTarget, WebGLRenderer,
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
// The map: central Istanbul, north up, baked from real data by tools/qr-istanbul-map.py into /qr/istanbul.png
// (coastline and parks © OpenStreetMap contributors, heights from SRTM). Landmarks sit at their OpenStreetMap
// coordinates, nudged apart a little where two would overlap at this scale.
const LON0 = 28.945, LON1 = 29.045, LAT0 = 40.987, LAT1 = 41.063;
/** metres across the map, and how much taller than life the hills are drawn */
const SPAN = 8400, RELIEF = 3.2;
type LL = [number, number];
type MapData = { px: Uint8Array; size: number };
/** the map under a point of the city: distance to the shore in modules (+ on land), park 0…1, height in metres */
function mapAt(map: MapData, x: number, z: number, n: number): [number, number, number] {
  const S = map.size, u = Math.max(0, Math.min(S - 1.001, ((x + n / 2) / n) * S - 0.5)), v = Math.max(0, Math.min(S - 1.001, ((z + n / 2) / n) * S - 0.5));
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, o = (j * S + i) * 4, d = map.px;
  const lerp = (ch: number) => (d[o + ch] * (1 - fu) + d[o + 4 + ch] * fu) * (1 - fv) + (d[o + S * 4 + ch] * (1 - fu) + d[o + S * 4 + 4 + ch] * fu) * fv;
  return [((lerp(0) - 128) / 2.5) * (n / S), lerp(1) / 255, lerp(2) / 2];
}
async function loadMap(): Promise<MapData> {
  try {
    const img = new Image();
    img.src = '/qr/istanbul.png';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = img.naturalWidth;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    return { px: new Uint8Array(ctx.getImageData(0, 0, c.width, c.height).data.buffer), size: c.width };
  } catch {
    return { px: new Uint8Array(4 * 4 * 4).fill(255).map((v, i) => (i % 4 === 1 || i % 4 === 2 ? 0 : v)), size: 4 }; // no map: all land, flat
  }
}
/** ferry routes, pier to pier (kept off the land when the city is built) */
const FERRIES: [LL[], number][] = [
  [[[28.9765, 41.0185], [28.99, 41.0215], [29.0125, 41.0265]], 0.55],
  [[[28.9785, 41.0212], [28.993, 41.016], [29.006, 41.003], [29.016, 40.9925]], 0.5],
  [[[28.9945, 41.0325], [29.0125, 41.0278]], 0.4],
  [[[28.9712, 41.0195], [28.962, 41.0235], [28.9545, 41.0295]], 0.3],
  [[[29.0, 41.03], [29.02, 41.042], [29.038, 41.056]], 0.6],
];

const ROOFS = ['#c1502e', '#b5482c', '#cf6034', '#a84229', '#c9582f', '#bb4a2a'];
const WALLS = ['#f2e3c6', '#e9b872', '#d98268', '#9cc0c4', '#efd9a7', '#c3d1a4', '#e6c2b0', '#f7efe0', '#d6a5a0', '#b7c7d9'];
/**
 * the brightness of everything over a dark module in the straight-down view, measured as a scanner measures it (on
 * the encoded values, 0…1): one value for every hue, or a paler dark module among darker ones reads as a light one
 */
const DARK = 0.27;
function darkOf(hex: string, out = new Color()): Color {
  out.set(hex).convertLinearToSRGB();
  const s = DARK / Math.max(0.04, 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b);
  out.setRGB(Math.min(1, out.r * s), Math.min(1, out.g * s), Math.min(1, out.b * s));
  return out.convertSRGBToLinear();
}
const SLATE = '#4f5b68', LEAD = '#6c7b88', STONE = '#dccfb4', ROCK = '#6a6156', GOLD = '#d2a646', GREEN = '#4f8a3f', CYPRESS = '#2f5c3a';
const UP = new Vector3(0, 1, 0);

class Parts {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; flat: number[] = []; misc: number[] = [];
  private m = new Matrix4();
  private base = new Matrix4();
  private c = new Color();
  private f = new Color();
  private d = 0;
  private y0 = 0;
  /** where the next pieces go: position, turn about the vertical, scale, and the delay of their rise */
  at(x: number, y: number, z: number, rot = 0, s = 1, d = 0) {
    this.base.compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, rot), new Vector3(s, s, s));
    this.d = d;
    this.y0 = y;
    return this;
  }
  /**
   * one primitive: unit shape scaled to (sx, sy, sz), base at (x, y, z) in the current frame.
   * kind 0 house wall (windows, a door), 1 plain, 2 arcade (round arches), 3 lead (domes, spires), 4 coursed stone,
   * 5 lamp (only at night), 6 round arcaded wall, 7 a hall's tall arched windows; +10 floodlit at night.
   */
  add(geo: BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, kind = 1, tone = 1) {
    const g = geo.clone();
    g.applyMatrix4(this.m.makeScale(sx, sy, sz).setPosition(x, y, z).premultiply(this.base));
    this.c.set(color).multiplyScalar(tone);
    darkOf(color, this.f); // the tint it takes over a dark module in the code: its own hue, at the one lightness
    const p = g.getAttribute('position'), nn = g.getAttribute('normal'), u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      this.uv.push(u.getX(i), u.getY(i));
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.flat.push(this.f.r, this.f.g, this.f.b);
      this.misc.push(kind, this.d, this.y0);
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
    g.setAttribute('aMisc', new Float32BufferAttribute(this.misc, 3));
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
  const oct = flatten(new CylinderGeometry(0.5, 0.5, 1, 8).translate(0, 0.5, 0));
  // a gable roof: base 1 × 1, ridge along x
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], E = [-0.5, 1, 0], F = [0.5, 1, 0];
  const tris = [D, C, F, D, F, E, B, A, E, B, E, F, A, D, E, C, B, F].flat();
  const gableX = new BufferGeometry();
  gableX.setAttribute('position', new Float32BufferAttribute(tris, 3));
  gableX.setAttribute('uv', new Float32BufferAttribute(new Float32Array(tris.length / 3 * 2), 2));
  gableX.computeVertexNormals();
  const gableZ = gableX.clone().rotateY(Math.PI / 2);
  return { box, roof, tube, cone, dome, ball, oct, gableX, gableZ };
}
type Shapes = ReturnType<typeof shapes>;

// ---- landmarks, modelled around their own origin; one unit is about a module of the smallest code.
// Mosques lie along z: the prayer wall at −z, the entrance and the courtyard at +z.
const PALE = '#ece2cb', MARBLE = '#f3ecdc';
/** the gilded finial on every dome and spire */
function alem(P: Parts, S: Shapes, x: number, y: number, z: number, s = 1) {
  P.add(S.tube, x, y, z, 0.022 * s, 0.17 * s, 0.022 * s, GOLD);
  P.add(S.ball, x, y + 0.1 * s, z, 0.065 * s, 0.065 * s, 0.065 * s, GOLD);
}
/** a lead dome d wide and h high, on a windowed drum if one is asked for */
function domed(P: Parts, S: Shapes, x: number, y: number, z: number, d: number, h = d * 0.48, drum = 0, wall = STONE, finial = true) {
  if (drum) P.add(S.tube, x, y, z, d * 1.04, drum, d * 1.04, wall, 16);
  P.add(S.dome, x, y + drum, z, d, h * 2, d, LEAD, 3);
  if (finial) alem(P, S, x, y + drum + h * 0.96, z, Math.min(1, d * 1.2));
}
function minaret(P: Parts, S: Shapes, x: number, z: number, h = 2.5, balconies = 2, shaft = '#f4ecd9') {
  P.add(S.oct, x, 0, z, 0.24, 0.34, 0.24, STONE, 14);
  P.add(S.tube, x, 0.34, z, 0.115, h - 0.34, 0.115, shaft, 14);
  for (let i = 0; i < balconies; i++) {
    const by = h * (balconies === 1 ? 0.7 : 0.5 + (0.34 * i) / (balconies - 1));
    P.add(S.tube, x, by - 0.06, z, 0.16, 0.06, 0.16, STONE, 14); // the corbelling under the gallery
    P.add(S.tube, x, by, z, 0.22, 0.03, 0.22, STONE, 14);
    P.add(S.tube, x, by + 0.03, z, 0.2, 0.045, 0.2, '#cfc3a8', 16);
    P.add(S.tube, x, by + 0.075, z, 0.23, 0.02, 0.23, '#ffd9a0', 5);
  }
  P.add(S.cone, x, h, z, 0.165, 0.52, 0.165, LEAD, 3);
  alem(P, S, x, h + 0.5, z, 0.7);
}
/**
 * an imperial mosque: a hall stepping up in tiers to the great dome, half-domes leaning on it, domed turrets at the
 * corners; in front an arcaded courtyard roofed with small domes, a fountain in the middle
 */
function mosque(P: Parts, S: Shapes, o: { wall: string; w?: number; dome?: number; semis?: 2 | 4; minarets: [number, number, number, number][]; court?: boolean }) {
  const W = o.wall, w = o.w ?? 1.3, d = (o.dome ?? 1) * 0.74 * w, semis = o.semis ?? 4;
  P.add(S.box, 0, 0, 0, w, 0.55, w, W, 12);
  P.add(S.box, 0, 0.55, 0, w + 0.06, 0.04, w + 0.06, LEAD, 3);
  P.add(S.box, 0, 0.59, 0, w * 0.76, 0.32, w * 0.76, W, 17);
  P.add(S.box, 0, 0.91, 0, w * 0.76 + 0.05, 0.035, w * 0.76 + 0.05, LEAD, 3);
  domed(P, S, 0, 0.945, 0, d, d * 0.5, 0.15, W);
  const sides = semis === 4 ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[0, 1], [0, -1]];
  for (const [dx, dz] of sides) { // half-domes, each with two smaller ones at its feet
    domed(P, S, dx * w * 0.36, 0.59, dz * w * 0.36, d * 0.74, d * 0.36, 0, W, false);
    for (const t of [-1, 1]) domed(P, S, dx * w * 0.43 + dz * t * w * 0.22, 0.59, dz * w * 0.43 + dx * t * w * 0.22, d * 0.3, d * 0.15, 0, W, false);
  }
  if (semis === 2) for (const dx of [-1, 1]) for (let i = -1; i <= 1; i++) domed(P, S, dx * w * 0.42, 0.59, i * w * 0.27, d * 0.26, d * 0.13, 0, W, false); // side galleries
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) { // the weight turrets at the dome's corners
    P.add(S.oct, dx * w * 0.36, 0.59, dz * w * 0.36, 0.17, 0.5, 0.17, W, 14);
    domed(P, S, dx * w * 0.36, 1.09, dz * w * 0.36, 0.19, 0.11);
  }
  if (o.court ?? true) {
    const c0 = w / 2, cl = w * 0.92, cw = w * 0.96, zc = c0 + cl / 2;
    P.add(S.box, 0, 0, zc, cw, 0.02, cl, MARBLE, 11);
    for (const dx of [-1, 1]) {
      P.add(S.box, dx * (cw / 2 - 0.08), 0, zc, 0.17, 0.3, cl, STONE, 12);
      for (let i = 0; i < 5; i++) domed(P, S, dx * (cw / 2 - 0.08), 0.3, c0 + (i + 0.5) * cl / 5, 0.17, 0.08, 0, STONE, false);
    }
    P.add(S.box, 0, 0, c0 + cl - 0.08, cw, 0.3, 0.17, STONE, 12);
    for (let i = 0; i < 6; i++) domed(P, S, -cw / 2 + (i + 0.5) * cw / 6, 0.3, c0 + cl - 0.08, 0.17, 0.08, 0, STONE, false);
    P.add(S.box, 0, 0, c0 + cl - 0.06, 0.32, 0.44, 0.24, W, 12); // the gate
    domed(P, S, 0, 0.44, c0 + cl - 0.06, 0.24, 0.12);
    P.add(S.oct, 0, 0.02, zc, 0.3, 0.16, 0.3, MARBLE, 16); // the fountain
    domed(P, S, 0, 0.18, zc, 0.34, 0.12, 0, STONE, false);
  }
  for (const [mx, mz, h, b] of o.minarets) minaret(P, S, mx, mz, h, b);
}
function ayasofya(P: Parts, S: Shapes) {
  const W = '#dc957c', R = '#c97862';
  P.add(S.box, 0, 0, 0, 1.5, 0.5, 1.35, W, 12);
  P.add(S.box, 0, 0.5, 0, 1.56, 0.04, 1.41, LEAD, 3);
  P.add(S.box, 0, 0, 0.78, 1.3, 0.34, 0.24, W, 12); P.add(S.box, 0, 0.34, 0.78, 1.34, 0.03, 0.28, LEAD, 3); // the narthex
  P.add(S.box, 0, 0.54, 0, 0.98, 0.42, 0.98, W, 17);
  P.add(S.box, 0, 0.96, 0, 1.03, 0.035, 1.03, LEAD, 3);
  domed(P, S, 0, 0.995, 0, 1.0, 0.36, 0.13, '#e2b9a2'); // the great shallow dome on its ring of windows
  for (const dz of [-1, 1]) {
    domed(P, S, 0, 0.54, dz * 0.5, 0.92, 0.4, 0, W, false);
    for (const dx of [-1, 1]) domed(P, S, dx * 0.34, 0.5, dz * 0.62, 0.42, 0.2, 0, W, false);
  }
  for (const dx of [-1, 1]) for (const dz of [-0.3, 0.3]) { // the four great buttresses
    P.add(S.box, dx * 0.66, 0, dz, 0.3, 0.98, 0.26, R, 14);
    P.add(dx > 0 ? S.gableZ : S.gableZ, dx * 0.66, 0.98, dz, 0.34, 0.12, 0.3, LEAD, 3);
  }
  for (const [tx, tz] of [[-1.0, -0.2], [-1.05, 0.25], [-0.95, 0.62]]) { P.add(S.oct, tx, 0, tz, 0.3, 0.22, 0.3, STONE, 14); domed(P, S, tx, 0.22, tz, 0.3, 0.16); } // the sultans' tombs
  minaret(P, S, 0.92, 0.82, 2.5, 1, '#c97862'); minaret(P, S, -0.92, 0.82, 2.5, 1);
  minaret(P, S, 0.92, -0.78, 2.5, 1); minaret(P, S, -0.92, -0.78, 2.5, 1);
}
function galata(P: Parts, S: Shapes) {
  const W = '#d8c8a8';
  P.add(S.oct, 0, 0, 0, 1.14, 0.12, 1.14, ROCK, 4);
  P.add(S.tube, 0, 0.12, 0, 0.9, 0.3, 0.9, '#c9b996', 14);
  P.add(S.tube, 0, 0.42, 0, 0.84, 1.36, 0.84, W, 16);
  P.add(S.tube, 0, 1.78, 0, 0.9, 0.05, 0.9, '#a39678', 14);
  P.add(S.tube, 0, 1.83, 0, 0.84, 0.3, 0.84, W, 16); // the storey of round arches
  P.add(S.cone, 0, 2.06, 0, 1.08, 0.07, 1.08, '#a39678', 14);
  P.add(S.tube, 0, 2.13, 0, 1.08, 0.03, 1.08, '#8c7f6a', 14); // the gallery and its rail
  P.add(S.tube, 0, 2.16, 0, 1.06, 0.06, 1.06, '#6f6657', 16);
  P.add(S.tube, 0, 2.22, 0, 1.1, 0.02, 1.1, '#ffd9a0', 5);
  P.add(S.tube, 0, 2.16, 0, 0.72, 0.36, 0.72, '#e0d2b4', 16);
  P.add(S.tube, 0, 2.52, 0, 0.86, 0.05, 0.86, '#8c7f6a', 14);
  P.add(S.cone, 0, 2.57, 0, 0.88, 0.92, 0.88, SLATE, 3);
  P.add(S.cone, 0, 3.3, 0, 0.16, 0.24, 0.16, SLATE, 3);
  alem(P, S, 0, 3.5, 0, 1.1);
}
function maiden(P: Parts, S: Shapes) {
  const W = '#f6efdf', T = '#b5482c';
  P.add(S.oct, 0, -0.12, 0, 1.16, 0.18, 1.16, ROCK, 4);
  P.add(S.oct, 0, 0.06, 0, 1.0, 0.06, 1.0, '#cfc3a8', 14); // the quay
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; P.add(S.box, Math.cos(a) * 0.46, 0.12, Math.sin(a) * 0.46, 0.04, 0.05, 0.04, '#ffd9a0', 5); }
  P.add(S.box, -0.12, 0.12, 0.1, 0.56, 0.3, 0.44, W, 10); P.add(S.roof, -0.12, 0.42, 0.1, 0.64, 0.2, 0.52, T);
  P.add(S.box, -0.2, 0.12, -0.24, 0.34, 0.22, 0.26, W, 10); P.add(S.gableX, -0.2, 0.34, -0.24, 0.4, 0.13, 0.3, T);
  P.add(S.box, 0.24, 0.12, -0.14, 0.32, 0.8, 0.32, W, 10); // the tower
  P.add(S.box, 0.24, 0.92, -0.14, 0.44, 0.04, 0.44, STONE, 14);
  P.add(S.box, 0.24, 0.96, -0.14, 0.4, 0.05, 0.4, '#6f6657', 12);
  P.add(S.oct, 0.24, 0.96, -0.14, 0.24, 0.22, 0.24, W, 16);
  P.add(S.dome, 0.24, 1.18, -0.14, 0.3, 0.3, 0.3, LEAD, 3);
  P.add(S.tube, 0.24, 1.3, -0.14, 0.09, 0.12, 0.09, W, 14);
  P.add(S.cone, 0.24, 1.42, -0.14, 0.13, 0.2, 0.13, LEAD, 3);
  P.add(S.tube, 0.24, 1.6, -0.14, 0.014, 0.5, 0.014, GOLD);
  P.add(S.box, 0.33, 1.94, -0.14, 0.16, 0.1, 0.012, '#d1202a');
}
function topkapi(P: Parts, S: Shapes) {
  const W = '#f1e7d2';
  P.add(S.box, 0, 0, 0, 1.7, 0.13, 1.3, STONE, 14); // the terrace and its walls
  for (const [x, z, sx, sz] of [[0, -0.62, 1.7, 0.06], [0, 0.62, 1.7, 0.06], [-0.82, 0, 0.06, 1.3], [0.82, 0, 0.06, 1.3]]) P.add(S.box, x, 0.13, z, sx, 0.14, sz, STONE, 14);
  for (const dx of [-1, 1]) { // the Gate of Salutation: two pointed towers
    P.add(S.oct, dx * 0.14 - 0.4, 0.13, 0.62, 0.17, 0.52, 0.17, W, 14);
    P.add(S.cone, dx * 0.14 - 0.4, 0.65, 0.62, 0.2, 0.34, 0.2, LEAD, 3);
  }
  P.add(S.box, -0.4, 0.13, 0.62, 0.16, 0.34, 0.1, W, 12);
  for (let i = 0; i < 8; i++) { // the kitchens: a row of domes, each with its chimney
    P.add(S.box, 0.68, 0.13, -0.5 + i * 0.14, 0.2, 0.2, 0.13, W, 10);
    P.add(S.dome, 0.68, 0.33, -0.5 + i * 0.14, 0.14, 0.12, 0.14, LEAD, 3);
    P.add(S.tube, 0.74, 0.33, -0.5 + i * 0.14, 0.035, 0.2, 0.035, '#cdbf9f');
  }
  P.add(S.box, -0.45, 0.13, -0.28, 0.5, 0.26, 0.4, W, 10); P.add(S.roof, -0.45, 0.39, -0.28, 0.58, 0.16, 0.48, LEAD, 3); // the harem
  for (const [x, z] of [[-0.6, -0.36], [-0.34, -0.36], [-0.6, -0.16], [-0.34, -0.16]]) P.add(S.dome, x, 0.42, z, 0.18, 0.16, 0.18, LEAD, 3);
  P.add(S.box, 0.12, 0.13, 0.2, 0.5, 0.22, 0.26, W, 12); P.add(S.roof, 0.12, 0.35, 0.2, 0.62, 0.14, 0.38, LEAD, 3); // the audience hall, wide eaves
  P.add(S.box, -0.2, 0.13, -0.3, 0.2, 1.0, 0.2, W, 14); // the Tower of Justice
  P.add(S.box, -0.2, 1.13, -0.3, 0.26, 0.04, 0.26, STONE, 14);
  P.add(S.oct, -0.2, 1.17, -0.3, 0.18, 0.22, 0.18, W, 16);
  P.add(S.cone, -0.2, 1.39, -0.3, 0.25, 0.5, 0.25, LEAD, 3);
  alem(P, S, -0.2, 1.87, -0.3, 0.7);
  for (const [x, z, v] of [[0.3, -0.3, 0.2], [0.05, -0.1, 0.8], [0.4, 0.45, 0.6], [-0.1, 0.42, 0.3], [-0.65, 0.3, 0.9], [0.3, -0.05, 0.5]]) {
    if (v < 0.4) P.add(S.cone, x, 0.13, z, 0.14, 0.6, 0.14, CYPRESS);
    else { P.add(S.tube, x, 0.13, z, 0.04, 0.14, 0.04, '#6b4a33'); P.add(S.ball, x, 0.22, z, 0.26, 0.28, 0.26, GREEN); }
  }
}
function dolmabahce(P: Parts, S: Shapes) {
  const W = '#f5eee0';
  P.add(S.box, 0, 0, 0.36, 2.7, 0.07, 0.2, MARBLE, 14); // the quay and its white railing
  P.add(S.box, 0, 0.07, 0.44, 2.7, 0.05, 0.02, '#ffffff', 12);
  P.add(S.box, 0, 0, 0, 2.3, 0.38, 0.42, W, 12); P.add(S.box, 0, 0.38, 0, 2.36, 0.04, 0.48, STONE, 14);
  P.add(S.gableX, 0, 0.42, 0, 2.3, 0.1, 0.42, LEAD, 3);
  P.add(S.box, 0, 0, 0, 0.66, 0.66, 0.56, W, 17); // the ceremonial hall, taller, with its pediment
  P.add(S.box, 0, 0.66, 0, 0.72, 0.04, 0.62, STONE, 14);
  P.add(S.gableX, 0, 0.7, 0, 0.72, 0.16, 0.62, LEAD, 3);
  P.add(S.gableZ, 0, 0.66, 0.26, 0.4, 0.14, 0.14, W, 14);
  for (const dx of [-1, 1]) {
    P.add(S.box, dx * 1.02, 0, 0, 0.34, 0.5, 0.5, W, 17); P.add(S.box, dx * 1.02, 0.5, 0, 0.38, 0.035, 0.54, STONE, 14);
    P.add(S.roof, dx * 1.02, 0.535, 0, 0.36, 0.14, 0.52, LEAD, 3);
    P.add(S.box, dx * 0.52, 0, 0.02, 0.12, 0.44, 0.46, W, 14);
  }
  P.add(S.box, -1.6, 0, -0.1, 0.34, 0.3, 0.1, W, 12); // the ornate gate
  P.add(S.gableX, -1.6, 0.3, -0.1, 0.38, 0.1, 0.12, STONE, 14);
  P.add(S.box, 1.62, 0, 0.1, 0.17, 0.26, 0.17, W, 14); // the clock tower, in four stages
  P.add(S.box, 1.62, 0.26, 0.1, 0.14, 0.26, 0.14, W, 17);
  P.add(S.box, 1.62, 0.52, 0.1, 0.11, 0.24, 0.11, W, 14);
  P.add(S.cone, 1.62, 0.76, 0.1, 0.14, 0.2, 0.14, LEAD, 3);
  for (let i = 0; i < 7; i++) { const x = -1.0 + i * 0.33; P.add(S.tube, x, 0, -0.34, 0.035, 0.12, 0.035, '#6b4a33'); P.add(S.ball, x, 0.08, -0.34, 0.22, 0.24, 0.22, i % 2 ? GREEN : '#6aa04a'); }
}
function haydarpasa(P: Parts, S: Shapes) {
  const W = '#e3d0a6', D = '#c9b488';
  P.add(S.box, 0, 0, 0.42, 1.9, 0.05, 0.3, STONE, 14); // the steps down to the water
  P.add(S.box, 0, 0, 0, 1.5, 0.2, 0.52, D, 12);
  P.add(S.box, 0, 0.2, 0, 1.46, 0.42, 0.5, W, 10);
  P.add(S.box, 0, 0.62, 0, 1.52, 0.035, 0.56, STONE, 14);
  P.add(S.gableX, 0, 0.655, 0, 1.5, 0.3, 0.54, SLATE, 3);
  for (let i = -2; i <= 2; i++) if (i) { P.add(S.box, i * 0.26, 0.7, 0.2, 0.09, 0.1, 0.1, W, 10); P.add(S.gableZ, i * 0.26, 0.8, 0.2, 0.11, 0.07, 0.12, SLATE, 3); } // dormers
  P.add(S.box, 0, 0.2, 0.24, 0.34, 0.6, 0.1, W, 17); P.add(S.gableX, 0, 0.8, 0.24, 0.36, 0.16, 0.12, SLATE, 3); // the clock gable
  P.add(S.tube, 0, 0.6, 0.3, 0.1, 0.012, 0.1, GOLD);
  for (const dx of [-1, 1]) {
    P.add(S.tube, dx * 0.7, 0, 0.24, 0.24, 0.84, 0.24, W, 16); // the two turrets
    P.add(S.tube, dx * 0.7, 0.84, 0.24, 0.28, 0.035, 0.28, STONE, 14);
    P.add(S.cone, dx * 0.7, 0.875, 0.24, 0.27, 0.44, 0.27, SLATE, 3);
    alem(P, S, dx * 0.7, 1.3, 0.24, 0.6);
    P.add(S.box, dx * 0.6, 0, -0.5, 0.3, 0.5, 0.56, W, 10); P.add(S.gableZ, dx * 0.6, 0.5, -0.5, 0.34, 0.22, 0.6, SLATE, 3); // the wings
  }
  for (const x of [-0.24, 0, 0.24]) P.add(S.box, x, 0.02, -0.75, 0.12, 0.18, 0.9, '#8d949c', 1); // the platform roofs behind
}
function tower(P: Parts, S: Shapes) { // Beyazıt fire tower
  P.add(S.oct, 0, 0, 0, 0.4, 0.16, 0.4, STONE, 14);
  P.add(S.tube, 0, 0.16, 0, 0.28, 1.7, 0.28, MARBLE, 16);
  P.add(S.cone, 0, 1.8, 0, 0.5, 0.07, 0.5, STONE, 14);
  P.add(S.tube, 0, 1.87, 0, 0.5, 0.03, 0.5, STONE, 14);
  P.add(S.tube, 0, 1.9, 0, 0.36, 0.3, 0.36, MARBLE, 16);
  P.add(S.tube, 0, 2.2, 0, 0.3, 0.2, 0.3, MARBLE, 16);
  P.add(S.tube, 0, 2.2, 0, 0.42, 0.02, 0.42, '#ffd9a0', 5);
  P.add(S.cone, 0, 2.4, 0, 0.36, 0.5, 0.36, LEAD, 3);
  alem(P, S, 0, 2.88, 0, 0.7);
}
function barracks(P: Parts, S: Shapes) { // Selimiye: a great square around a parade ground, a tower on each corner
  const W = '#efdfb8', T = '#b5482c';
  P.add(S.box, 0, 0, 0, 1.3, 0.02, 1.3, '#86b25c');
  for (const [x, z, sx, sz] of [[0, -0.75, 1.7, 0.26], [0, 0.75, 1.7, 0.26], [-0.75, 0, 0.26, 1.7], [0.75, 0, 0.26, 1.7]]) {
    P.add(S.box, x, 0, z, sx, 0.42, sz, W, 10);
    P.add(S.box, x, 0.42, z, sx + 0.05, 0.03, sz + 0.05, STONE, 14);
    P.add(sx > sz ? S.gableX : S.gableZ, x, 0.45, z, sx + 0.04, 0.14, sz + 0.04, T);
  }
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    P.add(S.box, dx * 0.78, 0, dz * 0.78, 0.34, 0.8, 0.34, W, 10);
    P.add(S.box, dx * 0.78, 0.8, dz * 0.78, 0.4, 0.035, 0.4, STONE, 14);
    P.add(S.box, dx * 0.78, 0.835, dz * 0.78, 0.22, 0.2, 0.22, W, 17);
    P.add(S.roof, dx * 0.78, 1.035, dz * 0.78, 0.3, 0.42, 0.3, LEAD, 3);
    alem(P, S, dx * 0.78, 1.42, dz * 0.78, 0.6);
  }
}
function ortakoy(P: Parts, S: Shapes) { // a single dome on a tall cube of windows, on its own quay
  const W = '#f6f0e3';
  P.add(S.box, 0, -0.1, 0, 1.5, 0.14, 1.3, MARBLE, 14);
  P.add(S.box, 0, 0.04, 0, 0.92, 0.78, 0.92, W, 17);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) { P.add(S.box, dx * 0.46, 0.04, dz * 0.46, 0.16, 0.9, 0.16, W, 14); P.add(S.roof, dx * 0.46, 0.94, dz * 0.46, 0.18, 0.14, 0.18, LEAD, 3); }
  P.add(S.box, 0, 0.82, 0, 0.98, 0.04, 0.98, STONE, 14);
  domed(P, S, 0, 0.86, 0, 0.86, 0.42, 0.08, W);
  P.add(S.box, 0, 0.04, 0.62, 0.9, 0.36, 0.34, W, 12); P.add(S.box, 0, 0.4, 0.62, 0.94, 0.03, 0.38, LEAD, 3); // the sultan's lodge
  minaret(P, S, -0.42, 0.84, 2.0, 2); minaret(P, S, 0.42, 0.84, 2.0, 2);
}
function bridge(P: Parts, S: Shapes, L: number, tall: boolean) {
  if (!tall) { // a low bridge on piers: the roadway above, the row of restaurants below, towers where it opens
    P.add(S.box, 0, 0.22, 0, L, 0.05, 0.3, '#9c978e');
    P.add(S.box, 0, 0.08, 0, L * 0.9, 0.09, 0.26, '#6f6a62', 2);
    for (let x = -L / 2 + 0.3; x < L / 2; x += 0.5) P.add(S.box, x, -0.12, 0, 0.1, 0.2, 0.24, '#7d786f');
    for (const dz of [-0.15, 0.15]) P.add(S.box, 0, 0.27, dz, L, 0.035, 0.015, '#5f5a52');
    for (const sx of [-1, 1]) for (const dz of [-1, 1]) { P.add(S.box, sx * 0.3, 0.27, dz * 0.17, 0.1, 0.24, 0.07, '#b9b2a4', 14); P.add(S.roof, sx * 0.3, 0.51, dz * 0.17, 0.12, 0.07, 0.09, LEAD, 3); }
    for (let x = -L / 2 + 0.2; x < L / 2; x += 0.4) for (const dz of [-0.15, 0.15]) P.add(S.box, x, 0.31, dz, 0.035, 0.035, 0.035, '#ffd9a0', 5);
    return;
  }
  const H = 2.1, D = 0.8, T = 0.3 * L, C = '#c9ced5'; // a suspension bridge: towers, the main cables, hangers
  P.add(S.box, 0, D, 0, L, 0.05, 0.28, '#a6acb4');
  P.add(S.box, 0, D - 0.06, 0, L, 0.06, 0.2, '#868d96');
  for (const dz of [-0.14, 0.14]) P.add(S.box, 0, D + 0.05, dz, L, 0.03, 0.012, C);
  for (const sx of [-1, 1]) {
    for (const dz of [-0.14, 0.14]) { P.add(S.box, sx * T, -0.1, dz, 0.08, H + 0.1, 0.08, C, 11); P.add(S.box, sx * T, -0.1, dz, 0.16, 0.24, 0.16, '#8d949c'); }
    for (const y of [D - 0.14, H - 0.22, H * 0.7]) P.add(S.box, sx * T, y, 0, 0.07, 0.07, 0.3, C, 11);
    P.add(S.box, sx * (L / 2 - 0.12), 0, 0, 0.24, D, 0.3, '#b9b2a4', 14); // the anchorages
  }
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const x = -L / 2 + (i / N) * L, u = Math.abs(x) / T;
    const y = u <= 1 ? D + 0.12 + (H - D - 0.12) * u * u : H - (H - D) * Math.min(1, (u - 1) / (L / 2 / T - 1));
    for (const dz of [-0.14, 0.14]) {
      P.add(S.box, x, y, dz, L / N + 0.02, 0.035, 0.035, C);
      if (y > D + 0.1) P.add(S.box, x, D, dz, 0.01, y - D, 0.01, C);
    }
    if (i % 2 === 0) P.add(S.box, x, y + 0.04, 0.14, 0.05, 0.05, 0.05, '#ffd9a0', 5);
  }
}

/** the direction of prayer from Istanbul (151° from north): mosques are built along it */
const QIBLA = -2.636;
type Mark = {
  name: string; ll: LL; r: number; top: number; make: (P: Parts, S: Shapes) => void;
  rot?: number; s?: number; sea?: boolean; shore?: boolean; x?: number; z?: number; y?: number;
};
const MARKS: Mark[] = [
  { name: 'Galata Kulesi', ll: [28.9742, 41.0256], r: 0.65, top: 3.9, make: galata },
  { name: 'Ayasofya', ll: [28.98, 41.0085], r: 1.15, top: 3.1, make: ayasofya, rot: QIBLA + 0.5 },
  { name: 'Sultanahmet', ll: [28.9766, 41.0054], r: 1.25, top: 3.1, make: (P, S) => { // six minarets, and at night the lights strung between two of them
    mosque(P, S, { wall: '#dedad0', minarets: [[-0.72, -0.72, 2.7, 3], [0.72, -0.72, 2.7, 3], [-0.72, 0.72, 2.7, 3], [0.72, 0.72, 2.7, 3], [-0.6, 1.84, 2.1, 2], [0.6, 1.84, 2.1, 2]] });
    for (let i = 1; i < 11; i++) { const t = i / 11; P.add(S.box, -0.72 + t * 1.44, 1.9 - Math.sin(t * Math.PI) * 0.3, 0.72, 0.05, 0.05, 0.05, '#ffd9a0', 5); }
  }, rot: QIBLA },
  { name: 'Kız Kulesi', ll: [29.0041, 41.0211], r: 0.6, top: 2.3, make: maiden, sea: true },
  { name: 'Süleymaniye', ll: [28.9638, 41.0162], r: 1.25, top: 3.1, make: (P, S) => { // two half-domes, taller minarets by the hall, the tombs behind
    mosque(P, S, { wall: '#dbd3c0', dome: 1.06, semis: 2, minarets: [[-0.72, 0.68, 2.8, 3], [0.72, 0.68, 2.8, 3], [-0.6, 1.84, 2.1, 2], [0.6, 1.84, 2.1, 2]] });
    for (const dx of [-0.3, 0.32]) { P.add(S.oct, dx, 0, -0.98, 0.34, 0.26, 0.34, STONE, 16); domed(P, S, dx, 0.26, -0.98, 0.34, 0.18); }
  }, rot: QIBLA },
  { name: 'Topkapı Sarayı', ll: [28.984, 41.0128], r: 1.05, top: 2.1, make: topkapi, rot: 0.5 },
  { name: 'Dolmabahçe', ll: [28.9996, 41.039], r: 1.25, top: 1.3, make: dolmabahce, shore: true },
  { name: 'Haydarpaşa', ll: [29.0193, 40.9965], r: 0.95, top: 1.6, make: haydarpasa, shore: true },
  { name: 'Ortaköy Camii', ll: [29.0268, 41.0473], r: 0.7, top: 2.5, make: ortakoy, shore: true, s: 0.8 },
  { name: 'Yeni Cami', ll: [28.9721, 41.0169], r: 0.95, top: 2.6, make: (P, S) => mosque(P, S, { wall: '#d6d0c2', minarets: [[-0.72, 0.7, 2.4, 3], [0.72, 0.7, 2.4, 3]] }), rot: QIBLA, s: 0.72 },
  { name: 'Selimiye Kışlası', ll: [29.0165, 41.0074], r: 1.0, top: 1.4, make: barracks, rot: 0.35 },
  { name: 'Fatih Camii', ll: [28.9498, 41.0197], r: 1.1, top: 2.6, make: (P, S) => mosque(P, S, { wall: '#dbd3c0', minarets: [[-0.72, 0.7, 2.4, 2], [0.72, 0.7, 2.4, 2]] }), rot: QIBLA, s: 0.8 },
  { name: 'Beylerbeyi Sarayı', ll: [29.04, 41.0427], r: 0.85, top: 1.1, make: dolmabahce, shore: true, s: 0.7 },
  { name: 'Çırağan Sarayı', ll: [29.0153, 41.0435], r: 0.85, top: 1.1, make: dolmabahce, shore: true, s: 0.7 },
  { name: 'Beyazıt Kulesi', ll: [28.9649, 41.0128], r: 0.32, top: 3.0, make: tower },
  { name: 'Mihrimah Sultan', ll: [29.016, 41.0268], r: 0.75, top: 2.4, make: (P, S) => mosque(P, S, { wall: '#dbd3c0', semis: 2, court: false, minarets: [[-0.72, 0.7, 2.2, 1], [0.72, 0.7, 2.2, 1]] }), rot: QIBLA, s: 0.72 },
];
/** bridges, shore to shore (from the OpenStreetMap ways) */
const BRIDGES: { name: string; a: LL; b: LL; tall: boolean }[] = [
  { name: 'Galata Köprüsü', a: [28.972, 41.0177], b: [28.9743, 41.0223], tall: false },
  { name: 'Atatürk Köprüsü', a: [28.9631, 41.0214], b: [28.9671, 41.027], tall: false },
  { name: 'Boğaziçi Köprüsü', a: [29.0273, 41.0478], b: [29.0415, 41.0432], tall: true },
];

type City = {
  geo: BufferGeometry; terrain: BufferGeometry; skirt: BufferGeometry; tex: DataTexture; tallest: number; k: number;
  chimneys: number[][]; labels: { name: string; x: number; y: number; z: number }[];
  open: (r: number, c: number) => boolean; height: (x: number, z: number) => number; sd: (x: number, z: number) => number;
  world: (ll: LL) => [number, number];
};

function buildCity(g: Grid, S: Shapes, map: MapData): City {
  const n = g.n, P = new Parts();
  const k = 1.14 * Math.min(1.5, Math.sqrt(n / 25)); // landmarks are drawn large, as on a tourist map, and grow a little with the code
  const X = (c: number) => c - n / 2 + 0.5, Z = (r: number) => r - n / 2 + 0.5;
  const world = ([lon, lat]: LL): [number, number] => [((lon - LON0) / (LON1 - LON0)) * n - n / 2, ((LAT1 - lat) / (LAT1 - LAT0)) * n - n / 2];
  const sd = (x: number, z: number) => mapAt(map, x, z, n)[0];
  const ramp = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const height = (x: number, z: number) => { const [d, , el] = mapAt(map, x, z, n); return ramp(0, 0.35, d) * (0.1 + (el * n / SPAN) * RELIEF); };
  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n;

  // ---- landmarks: real positions; those meant to stand on land are moved off the water, and any two that would
  // stand in each other are pushed apart
  const marks = MARKS.map((m) => { const [x, z] = world(m.ll); return { ...m, x, z, s: (m.s ?? 1) * k }; });
  const ashore = (m: { x: number; z: number }, want: number) => {
    for (let i = 0; i < 40 && sd(m.x, m.z) < want; i++) {
      const gx = sd(m.x + 0.1, m.z) - sd(m.x - 0.1, m.z), gz = sd(m.x, m.z + 0.1) - sd(m.x, m.z - 0.1), l = Math.hypot(gx, gz) || 1;
      m.x += (gx / l) * 0.08; m.z += (gz / l) * 0.08;
    }
  };
  for (let it = 0; it < 12; it++) for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) {
    const a = marks[i], b = marks[j], dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1e-3, want = (a.r * a.s + b.r * b.s) * 0.9;
    if (d < want) { const push = (want - d) / 2 / d; a.x -= dx * push; a.z -= dz * push; b.x += dx * push; b.z += dz * push; }
  }
  for (const m of marks) {
    // inside the map, with room for its own footprint
    const lim = n / 2 - m.r * m.s - 0.2;
    m.x = Math.max(-lim, Math.min(lim, m.x)); m.z = Math.max(-lim, Math.min(lim, m.z));
    if (!m.sea) ashore(m, m.shore ? 0.3 : 0.45);
    m.y = m.sea ? 0.02 : height(m.x, m.z);
    if (m.shore) { // palaces and stations face the water
      const gx = sd(m.x + 0.3, m.z) - sd(m.x - 0.3, m.z), gz = sd(m.x, m.z + 0.3) - sd(m.x, m.z - 0.3);
      m.rot = Math.atan2(-gx, -gz);
    }
  }
  const taken = (x: number, z: number) => marks.some((m) => Math.hypot(x - m.x, z - m.z) < m.r * m.s + 0.15);

  const pick = <T,>(list: T[], v: number) => list[Math.floor(v * list.length) % list.length];
  const tree = (x: number, z: number, v: number, s = 1) => {
    if (v < 0.4) P.add(S.cone, x, 0, z, 0.24 * s, (0.8 + v) * s, 0.24 * s, CYPRESS, 1, 0.9 + v * 0.4);
    else { P.add(S.tube, x, 0, z, 0.06 * s, 0.22 * s, 0.06 * s, '#6b4a33'); P.add(S.ball, x, 0.16 * s, z, 0.42 * s, 0.46 * s, 0.42 * s, v > 0.75 ? '#6aa04a' : GREEN, 1, 0.85 + v * 0.3); }
  };
  const chimneys: number[][] = [];
  // per module, for the shaders and the traffic: 1 a street, 2 a building
  const use = new Uint8Array(n * n);

  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = X(c), z = Z(r), [d0, park] = mapAt(map, x, z, n);
    if (d0 < 0.3 || taken(x, z)) continue; // sea, the shore itself, or a landmark's ground
    const y = height(x, z);
    const h1 = hash(r, c), h2 = hash(c + 3, r + 7), h3 = hash(r + 13, c + 4), tone = 0.92 + 0.16 * h2;
    const d = Math.hypot(r - n / 2, c - n / 2) / n * 1.2 + hash(r, c + 11) * 0.25;
    P.at(x, y, z, 0, 1, d);
    if (park > 0.5) { // a real park: a grove, denser on the dark modules
      for (let i = 0; i < (g.dark(r, c) ? 5 : 3); i++) tree(hash(r + i, c + 2) * 0.76 - 0.38, hash(r + 2, c + i) * 0.76 - 0.38, hash(r + i * 5, c + 1), 1.05);
      continue;
    }
    if (!g.dark(r, c)) { // a street or a square, some of them lined with trees
      use[r * n + c] = 1;
      if (h1 < 0.22) { tree(0.3, 0.3, h2, 0.8); if (h3 < 0.5) tree(-0.3, 0.32, h3 * 2, 0.75); }
      continue;
    }
    use[r * n + c] = 2;
    P.add(S.box, 0, -0.6, 0, 0.9, 0.6, 0.9, '#cdbf9f'); // footing, down into the slope
    if (h1 > 0.955) { // a neighbourhood mosque: one dome, one minaret
      P.add(S.box, 0, 0, 0, 0.8, 0.42, 0.8, '#e9e1cf', 12);
      P.add(S.box, 0, 0.42, 0, 1, 0.05, 1, LEAD, 1, tone);
      P.add(S.dome, 0, 0.47, 0, 0.7, 0.5, 0.7, LEAD, 3);
      P.add(S.tube, 0.38, 0, 0.38, 0.09, 1.5, 0.09, '#f1e8d4', 14);
      P.add(S.tube, 0.38, 1.05, 0.38, 0.17, 0.04, 0.17, '#ffd9a0', 5);
      P.add(S.cone, 0.38, 1.5, 0.38, 0.13, 0.36, 0.13, LEAD, 3);
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
    P.at(m.x, m.y!, m.z, m.rot ?? 0, m.s, 0.55);
    if (!m.sea && !m.shore) P.add(S.oct, 0, -0.9, 0, m.r * 1.75, 0.9, m.r * 1.75, '#e6dcc5', 4); // a low terrace, level on the slope
    m.make(P, S);
    labels.push({ name: m.name, x: m.x, y: m.y! + m.top * m.s, z: m.z });
  }
  for (const b of BRIDGES) {
    const [ax, az] = world(b.a), [bx, bz] = world(b.b), L = Math.hypot(bx - ax, bz - az);
    P.at((ax + bx) / 2, 0.02, (az + bz) / 2, Math.atan2(-(bz - az), bx - ax), 1, 0.7);
    bridge(P, S, L + 0.4, b.tall);
    if (b.tall) labels.push({ name: b.name, x: (ax + bx) / 2, y: 2.4, z: (az + bz) / 2 });
  }

  // ---- the ground: one sheet following the real terrain, and a skirt around its edge
  const SEG = Math.min(180, n * 5);
  const terrain = new PlaneGeometry(n, n, SEG, SEG).rotateX(-Math.PI / 2);
  const tp = terrain.getAttribute('position');
  for (let i = 0; i < tp.count; i++) tp.setY(i, height(tp.getX(i), tp.getZ(i)));
  terrain.computeVertexNormals();
  const sp: number[] = [], sn: number[] = [];
  for (const [ox, oz, dx, dz, nx, nz] of [[-1, -1, 1, 0, 0, -1], [-1, 1, 1, 0, 0, 1], [-1, -1, 0, 1, -1, 0], [1, -1, 0, 1, 1, 0]]) for (let i = 0; i < SEG; i++) {
    const p = (j: number) => [ox * n / 2 + dx * n * j / SEG, oz * n / 2 + dz * n * j / SEG];
    const [x0, z0] = p(i), [x1, z1] = p(i + 1), y0 = height(x0, z0), y1 = height(x1, z1), B = -0.7;
    sp.push(x0, y0, z0, x1, y1, z1, x1, B, z1, x0, y0, z0, x1, B, z1, x0, B, z0);
    for (let q = 0; q < 6; q++) sn.push(nx, 0, nz);
  }
  const skirt = new BufferGeometry();
  skirt.setAttribute('position', new Float32BufferAttribute(sp, 3));
  skirt.setAttribute('normal', new Float32BufferAttribute(sn, 3));

  // ---- what the shaders need to know about each module: dark?, built on?
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = g.dark((i / n) | 0, i % n) ? 255 : 0;
    data[i * 4 + 1] = use[i] === 2 ? 255 : 0;
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, n, n, RGBAFormat);
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  const open = (r: number, c: number) => inside(r, c) && use[r * n + c] === 1;
  return { geo: P.geometry(), terrain, skirt, tex, tallest: 3.9 * k + 0.6, k, chimneys, labels, open, height, sd, world };
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

/** straight stretches of street, longest first */
function streets(n: number, open: (r: number, c: number) => boolean): { r: number; c: number; len: number; across: boolean }[] {
  const out: { r: number; c: number; len: number; across: boolean }[] = [];
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
uniform sampler2D uGrid, uMap;
uniform float uFlat, uNight, uTime, uN;
uniform vec3 uSun, uStone, uSeaPale;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
/** the module under a point of the city (module coordinates): r dark, g built on */
vec4 cellAt(vec2 m) { return texture2D(uGrid, (floor(m) + 0.5) / uN); }
/** the real map there: x distance to the shore in modules (+ on land), y park */
vec2 mapAt(vec2 m) { vec3 t = texture2D(uMap, m / uN).rgb; return vec2((t.r * 255.0 - 128.0) / 2.5 * uN / 256.0, t.g); }
`;
const VERT = /* glsl */ `
attribute vec3 aCol, aFlat;
attribute vec3 aMisc; // kind, rise delay, the height it stands at
uniform float uGrow, uFlat, uNight;
uniform mat4 uInv; // world → city
varying vec3 vN, vCol, vFlat; varying vec2 vUv, vM; varying float vY, vKind;
void main() {
  float g = clamp(uGrow * 2.0 - aMisc.y, 0.0, 1.0);
  g = 1.0 - pow(1.0 - g, 3.0);
  vec3 p = position;
  vY = p.y - aMisc.z;
  p.y = aMisc.z + (p.y - aMisc.z) * g;
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
  bool house = k < 0.5, arcade = abs(k - 2.0) < 0.1, lead = abs(k - 3.0) < 0.1, stone = abs(k - 4.0) < 0.1, round_ = abs(k - 6.0) < 0.1, hall = abs(k - 7.0) < 0.1;
  bool upright = abs(n.y) < 0.5;
  // stone: the courses of the masonry, and the joints breaking from one course to the next
  if (upright && (stone || round_ || arcade || hall)) {
    float course = floor(vY * 7.0);
    col *= 1.0 - 0.055 * mod(course, 2.0) - 0.04 * step(0.9, fract(vUv.x * (round_ ? 18.0 : 9.0) + course * 0.5));
  }
  if (upright && (house || arcade || round_ || hall)) {
    float cols = house ? 2.0 : arcade ? 6.0 : round_ ? 14.0 : 5.0;
    vec2 g = vec2(vUv.x * cols, vY * (hall ? 1.9 : 3.4));
    vec2 f = fract(g), id = floor(g);
    float dx = f.x - 0.5;
    if (house) {
      win = step(0.26, f.x) * step(f.x, 0.74) * step(0.3, f.y) * step(f.y, 0.78) * step(0.5, id.y) * step(0.0, vY);
      col = mix(col, vec3(0.11, 0.06, 0.035), step(vY, 0.25) * step(0.0, vY) * step(abs(vUv.x - 0.5), 0.1)); // the door
    } else {
      // round-headed openings; a hall's are tall, with a pale surround
      float hw = hall ? 0.22 : 0.27, spring = hall ? 0.62 : 0.46;
      float head = spring + sqrt(max(0.0, hw * hw - dx * dx));
      win = step(abs(dx), hw) * step(0.12, f.y) * step(f.y, head) * step(0.0, vY);
      float hw2 = hw + 0.07, head2 = spring + sqrt(max(0.0, hw2 * hw2 - dx * dx));
      col = mix(col, col * 1.12 + 0.03, step(abs(dx), hw2) * step(0.08, f.y) * step(f.y, head2 + 0.0) * (1.0 - win) * 0.7);
    }
    vec2 seed = id + vec2(vCol.r * 37.0 + n.x * 3.0, vCol.g * 91.0 + n.z * 5.0);
    // lights go on and off through the evening, each window in its own time
    lit = step(house ? 0.5 : 0.25, hash(seed + floor(uTime * 0.12 + hash(seed + 3.0) * 9.0)));
    tw = 0.75 + 0.5 * hash(seed + 7.0);
    col = mix(col, uGlass, win * (house ? 0.8 : 0.72));
  }
  // day: a warm low sun, cool sky in the shade, a little darker towards the street
  float lam = max(dot(n, uSun), 0.0);
  vec3 day = col * (vec3(0.5, 0.56, 0.68) * (0.92 + 0.3 * n.y) + vec3(1.08, 0.98, 0.82) * lam * 0.78);
  if (abs(k - 5.0) > 0.1 && upright) day *= 0.86 + 0.14 * smoothstep(0.0, 0.3, vY);
  if (lead) {
    // lead: the seams of the sheets running down the dome, a soft shine where the sun sits on it
    float seam = 1.0 - 0.07 * smoothstep(0.75, 1.0, sin(atan(n.z, n.x) * 14.0)) * (1.0 - n.y * n.y);
    day = day * seam + vec3(1.0, 0.97, 0.9) * pow(max(dot(n, normalize(uSun + vec3(0.0, 0.55, 0.0))), 0.0), 26.0) * 0.3;
  }
  // night: moonlight, lit windows, floodlit landmarks, lamps
  vec3 dark = col * vec3(0.13, 0.17, 0.31) * (0.75 + 0.55 * lam + 0.15 * n.y);
  dark = mix(dark, vCol * vec3(1.0, 0.78, 0.5) * (1.0 - 0.4 * clamp(vY / 4.0, 0.0, 1.0)), glow * 0.82);
  dark = mix(dark, uLit * tw, win * lit);
  if (lead) dark += vec3(0.1, 0.13, 0.2) * pow(max(n.y, 0.0), 3.0) * 0.5; // moonlight on the domes
  if (abs(k - 5.0) < 0.1) dark = uLit * 1.25;
  // the code: whatever is here takes the lightness of the module under it
  vec2 m = vM + uN * 0.5;
  vec3 code = cellAt(m).r > 0.5 ? vFlat : mix(uSeaPale, uStone, smoothstep(-0.04, 0.04, mapAt(m).x));
  if (m.x < 0.0 || m.y < 0.0 || m.x > uN || m.y > uN) code = uStone; // nothing may darken the quiet zone around the code
  gl_FragColor = vec4(mix(mix(day, dark, nf), code, uFlat), 1.0);
  #include <colorspace_fragment>
}`;
const GROUND_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vP;
void main() { vN = normal; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GROUND_FRAG = COMMON + /* glsl */ `
uniform vec3 uSide, uSea, uSeaDark, uRoofDark, uGrassDark;
varying vec3 vN; varying vec3 vP;
void main() {
  float nf = uNight * (1.0 - uFlat);
  vec2 m = vP.xz + uN * 0.5;          // module coordinates: x column, y row
  vec2 cell = floor(m), f = fract(m) - 0.5;
  vec4 here = cellAt(m);
  vec2 mp = mapAt(m);
  float sd = mp.x, land = smoothstep(-0.04, 0.04, sd), park = smoothstep(0.35, 0.65, mp.y);
  vec3 col;
  if (vN.y > 0.2) {
    // ---- land: paving (sand by the water, grass in the parks), the lie of the hills, house shadows, lamps at night
    vec3 pave = uStone * (0.95 + 0.07 * hash(cell));
    vec2 a = abs(f), a4 = abs(fract(m * 4.0 + hash(cell) * 0.5) - 0.5);
    pave *= 1.0 - 0.07 * smoothstep(0.44, 0.5, max(a.x, a.y)) - 0.03 * smoothstep(0.4, 0.5, max(a4.x, a4.y));
    pave = mix(pave, vec3(0.9, 0.82, 0.62), smoothstep(0.13, 0.0, sd) * 0.8);
    vec3 grass = vec3(0.4, 0.6, 0.27) * (0.88 + 0.24 * hash(floor(m * 5.0)));
    vec3 ground = mix(pave, grass, park);
    float lam = max(dot(normalize(vN), uSun), 0.0);
    vec2 s = normalize(uSun.xz);
    float shade = max(cellAt(m + s * 0.42).g, 0.6 * cellAt(m + s * 0.84).g) * (1.0 - here.g);
    vec3 landDay = ground * (0.74 + 0.42 * lam) * mix(vec3(1.0), vec3(0.66, 0.7, 0.84), shade);
    vec3 landDusk = ground * vec3(0.13, 0.16, 0.29) * (0.8 + 0.3 * lam);
    vec2 q = fract(m * 0.5 + 0.25) - 0.5;
    landDusk += vec3(1.0, 0.7, 0.36) * exp(-dot(q, q) * 30.0) * step(0.4, hash(floor(m * 0.5 + 0.25))) * 0.42 * (1.0 - park);
    // ---- sea: turquoise by the shore, deeper further out, moving light, foam and ripples along the real coast
    float out_ = max(0.0, -sd), depth = smoothstep(0.0, 4.5, out_);
    float wave = sin(m.x * 7.0 + uTime * 1.3 + sin(m.y * 5.0 - uTime * 0.8) * 1.6) * 0.5 + 0.5;
    float glint = pow(sin(m.x * 23.0 - uTime * 2.1 + sin(m.y * 17.0 + uTime) * 2.0) * 0.5 + 0.5, 12.0);
    float foam = 1.0 - smoothstep(0.0, 0.2 + 0.05 * sin(uTime * 1.6 + m.x * 2.3 + m.y * 3.1), out_);
    float ripple = smoothstep(0.55, 1.0, sin(out_ * 15.0 - uTime * 1.3)) * exp(-out_ * 2.2) * 0.35;
    vec3 seaDay = mix(vec3(0.34, 0.76, 0.8), uSea, depth) * (0.95 + 0.09 * wave) * (here.r > 0.5 ? 0.95 : 1.03) + glint * 0.16;
    seaDay = mix(seaDay, vec3(0.93, 0.98, 0.98), max(foam * 0.75, ripple));
    vec3 seaDusk = vec3(0.03, 0.07, 0.15) * (here.r > 0.5 ? 0.88 : 1.08) + vec3(0.9, 0.75, 0.5) * glint * 0.07 + vec3(0.2, 0.26, 0.4) * max(foam, ripple) * 0.4;
    // ---- the code: the lightness of the module, the hue of what is really there
    vec3 code = here.r > 0.5 ? mix(uSeaDark, mix(uRoofDark, uGrassDark, park), land) : mix(uSeaPale, uStone, land) * (0.985 + 0.02 * hash(cell));
    col = mix(mix(mix(seaDay, landDay, land), mix(seaDusk, landDusk, land), nf), code, uFlat);
  } else {
    // ---- the cut edge of the map: earth under the land, water under the sea
    vec3 wall = mix(uSea * (abs(vN.x) > 0.5 ? 0.78 : 0.62), uSide * (abs(vN.x) > 0.5 ? 1.0 : 0.82) * (0.75 + 0.25 * smoothstep(-0.7, 0.3, vP.y)), land);
    col = mix(wall, wall * vec3(0.16, 0.2, 0.34), nf);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
/** the whip's motion blur: one drawing of the frame, smeared back along the way each point of the ground came */
const BLUR_FRAG = /* glsl */ `
uniform sampler2D t;
uniform vec4 uM; uniform vec2 uT; // where a point of this frame was in the last one: prev = M · ndc + T
varying vec2 v;
void main() {
  vec2 ndc = v * 2.0 - 1.0, prev = vec2(dot(uM.xy, ndc), dot(uM.zw, ndc)) + uT;
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 12; i++) sum += texture2D(t, (mix(ndc, prev, float(i) / 11.0) * 0.5 + 0.5));
  gl_FragColor = sum / 12.0;
  #include <colorspace_fragment>
}`;

/** the sun's height over Istanbul right now, in degrees (below about −0.83 it has set) */
function sunOverIstanbul(at = Date.now()): number {
  const R = Math.PI / 180, d = at / 864e5 - 10957.5; // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * R, L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * R;
  const e = (23.439 - 0.00000036 * d) * R;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const ha = ((18.697374558 + 24.06570982441908 * d) * 15 + 28.98) * R - ra, lat = 41.01 * R;
  return Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha)) / R;
}

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

async function boot() {
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
  // arrived from a chapter of this site: the name in the corner leads back to that chapter
  try {
    const from = new URL(text), logo = root.querySelector<HTMLAnchorElement>('.qr__logo');
    if (logo && from.origin === location.origin && from.pathname === '/') logo.href = from.pathname + from.hash;
  } catch { /* not a link */ }
  let grid = encode(text) ?? encode(DEFAULT)!;
  input.value = text === DEFAULT && !params.has('u') ? '' : text;

  let flat = params.has('code') ? 1 : 0; // target: 0 city, 1 code
  // day or night
  const skies = [...root.querySelectorAll<HTMLButtonElement>('[data-qr-sky]')];
  // it is night here when it is night in Istanbul: the sun's real height over the city, from the clock
  // (a button press holds for this visit; `?t=day|night` in a link fixes it)
  let chosen = params.get('t');
  let night = (chosen ?? (sunOverIstanbul() < -0.83 ? 'night' : 'day')) === 'night';
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

  const map = await loadMap();
  const mapTex = new DataTexture(map.px, map.size, map.size, RGBAFormat);
  mapTex.magFilter = mapTex.minFilter = LinearFilter;
  mapTex.needsUpdate = true;
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const city = new Group();
  scene.add(city);

  const S = shapes(), M = movers(S);
  const uFlat = { value: flat }, uGrow = { value: calm ? 1 : 0 }, uNight = { value: night ? 1 : 0 }, uTime = { value: 0 };
  const dark = (hex: string) => darkOf(hex);
  const shared = {
    uFlat, uNight, uTime, uN: { value: 1 }, uGrid: { value: null as DataTexture | null }, uMap: { value: mapTex },
    uSun: { value: new Vector3(-0.5, 0.62, 0.6).normalize() }, // a low sun in the south-west
    uStone: { value: new Color(PAPER) }, uSeaPale: { value: new Color('#dcebe8') },
  };
  const cityMat = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { ...shared, uGrow, uInv: { value: new Matrix4() }, uGlass: { value: new Color('#33414f') }, uLit: { value: new Color('#ffc66e') } },
  });
  const groundMat = new ShaderMaterial({
    vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG,
    uniforms: { ...shared, uSide: { value: new Color('#c4b392') }, uSea: { value: new Color('#2f86ad') }, uSeaDark: { value: dark('#1f4f7c') }, uRoofDark: { value: dark('#b5482c') }, uGrassDark: { value: dark('#3f7a36') } },
    side: DoubleSide,
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
    made = buildCity(grid, S, map);
    tallest = made.tallest;
    plate = n;
    shared.uN.value = n;
    shared.uGrid.value = made.tex;
    for (const [geo, mat] of [[made.geo, cityMat], [made.terrain, groundMat], [made.skirt, groundMat]] as const) {
      const m = new Mesh(geo, mat);
      m.frustumCulled = false;
      statics.add(m);
    }
    if (!calm) uGrow.value = 0;

    // traffic: a tram on the longest street, taxis on the next ones
    traffic.clear();
    streets(n, made.open).slice(0, 16).forEach((st, i) => {
      const m = new Mesh(i === 0 ? M.tram : M.taxi, cityMat);
      m.frustumCulled = false;
      m.userData = { ...st, speed: i === 0 ? 0.55 : 0.8 + hash(i, 3) * 0.6, phase: hash(i, 9) * 10 };
      traffic.add(m);
    });
    // ferries on their real routes
    sea.clear();
    FERRIES.forEach(([route, speed], i) => {
      // the route as a string of points, each eased off the land onto open water
      const pts: number[][] = [];
      for (let j = 0; j + 1 < route.length; j++) {
        const a = made!.world(route[j]), b = made!.world(route[j + 1]);
        for (let q = j ? 1 : 0; q <= 8; q++) pts.push([a[0] + (b[0] - a[0]) * q / 8, a[1] + (b[1] - a[1]) * q / 8]);
      }
      for (const pt of pts) for (let it = 0; it < 40 && made!.sd(pt[0], pt[1]) > -0.3; it++) {
        const gx = made!.sd(pt[0] + 0.1, pt[1]) - made!.sd(pt[0] - 0.1, pt[1]), gz = made!.sd(pt[0], pt[1] + 0.1) - made!.sd(pt[0], pt[1] - 0.1), l = Math.hypot(gx, gz) || 1;
        pt[0] -= (gx / l) * 0.06; pt[1] -= (gz / l) * 0.06;
      }
      const at = [0];
      for (let j = 1; j < pts.length; j++) at.push(at[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
      const m = new Mesh(i < 3 ? M.ferry : M.boat, cityMat);
      m.frustumCulled = false;
      m.userData = { pts, at, speed, phase: hash(i, 4) };
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
  // north up, as on a map; left alone, the city sways a little around where it was put
  let az = flat ? 0 : -0.18, azBase = az, swayT = 0, azFrom = az, azTo = az, flatNow = flat, dirty = true, last = 0;
  let dragging = false, moved = 0, lastX = 0, idle = 0;
  const smooth = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);

  // motion blur for the whip: the frame is drawn once, then smeared back along the way the ground moved since the
  // last frame (one extra pass, instead of drawing the city several times over)
  const rt = new WebGLRenderTarget(2, 2, { samples: 4 });
  const blur = new ShaderMaterial({
    uniforms: { t: { value: rt.texture }, uM: { value: new Vector4(1, 0, 0, 1) }, uT: { value: new Vector2() } },
    vertexShader: 'varying vec2 v; void main() { v = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false, blending: NoBlending,
  });
  const blit = new Mesh(new PlaneGeometry(2, 2), blur);
  blit.frustumCulled = false;
  const blitScene = new Scene().add(blit), blitCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const view = new Matrix4(), ground = [new Vector3(0, 0, 0), new Vector3(8, 0, 0), new Vector3(0, 0, 8)];
  /** where three points of the ground are on screen, for the pose just set */
  const shot = () => {
    view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(city.matrixWorld);
    return ground.map((g) => { const q = g.clone().applyMatrix4(view); return [q.x, q.y]; });
  };

  let sharp = false, warm = false;
  function fit() {
    // the city moves all the time: two device pixels per pixel is plenty. The code stands still and must be crisp.
    const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, sharp ? 3 : 2);
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
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
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
      const lane = back ? -0.17 : 0.17;
      // up and down the hills with the street
      if (d.across) { m.position.set(d.c + k - n / 2 + 0.5, 0, d.r - n / 2 + 0.5 + lane); m.rotation.y = back ? Math.PI : 0; }
      else { m.position.set(d.c - n / 2 + 0.5 - lane, 0, d.r + k - n / 2 + 0.5); m.rotation.y = back ? Math.PI / 2 : -Math.PI / 2; }
      m.position.y = made.height(m.position.x, m.position.z) + 0.01;
    }
    // ferries shuttle between their piers, easing in and out of each
    for (const f of sea.children) {
      const d = f.userData, len = d.at[d.at.length - 1];
      const u = (t * d.speed / len * 0.5 + d.phase) % 2, back = u > 1, k = smooth(back ? 2 - u : u) * len;
      let j = 1;
      while (j < d.at.length - 1 && d.at[j] < k) j++;
      const a = d.pts[j - 1], b = d.pts[j], q = (k - d.at[j - 1]) / Math.max(1e-4, d.at[j] - d.at[j - 1]);
      f.position.set(a[0] + (b[0] - a[0]) * q, 0.02 + Math.sin(t * 1.4 + d.phase * 9) * 0.012, a[1] + (b[1] - a[1]) * q);
      const want = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) + (back ? Math.PI : 0);
      f.rotation.y += Math.atan2(Math.sin(want - f.rotation.y), Math.cos(want - f.rotation.y)) * 0.08;
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
      const x = Math.max(t.w / 2 + 6, Math.min(w - t.w / 2 - 6, (v.x + 1) / 2 * w)), y = (1 - v.y) / 2 * h - 8;
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
    if ((flatNow === 1) !== sharp) { sharp = flatNow === 1; fit(); dirty = false; }
    if (!turning) {
      pose(flatNow, az);
      place(flatNow === 0 && uGrow.value >= 1);
      if (!warm) { // compile the blur's programs now, not in the middle of the first whip
        warm = true;
        renderer!.setRenderTarget(rt);
        renderer!.render(scene, camera);
        renderer!.setRenderTarget(null);
        renderer!.render(blitScene, blitCam);
      }
      renderer!.setRenderTarget(null);
      renderer!.render(scene, camera);
      return;
    }
    place(false);
    pose(f0, a0);
    const was = shot();
    pose(flatNow, az);
    const now_ = shot();
    // the affine map taking this frame's screen to the last one's, from the three ground points
    const [c0, c1, c2] = now_, [p0, p1, p2] = was;
    const ax = c1[0] - c0[0], ay = c1[1] - c0[1], bx = c2[0] - c0[0], by = c2[1] - c0[1], det = ax * by - ay * bx || 1e-6;
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], vx = p2[0] - p0[0], vy = p2[1] - p0[1];
    const m00 = (ux * by - vx * ay) / det, m01 = (vx * ax - ux * bx) / det, m10 = (uy * by - vy * ay) / det, m11 = (vy * ax - uy * bx) / det;
    (blur.uniforms.uM.value as Vector4).set(m00, m01, m10, m11);
    (blur.uniforms.uT.value as Vector2).set(p0[0] - (m00 * c0[0] + m01 * c0[1]), p0[1] - (m10 * c0[0] + m11 * c0[1]));
    renderer!.setRenderTarget(rt);
    renderer!.clear();
    renderer!.render(scene, camera);
    renderer!.setRenderTarget(null);
    renderer!.render(blitScene, blitCam);
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
    chosen = night ? 'night' : 'day';
    label();
    dirty = true;
  });
  // dusk and dawn arrive by themselves
  setInterval(() => {
    if (chosen) return;
    const n = sunOverIstanbul() < -0.83;
    if (n !== night) { night = n; label(); dirty = true; }
  }, 60_000);
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
      try {
        if (navigator.share) await navigator.share({ title: document.title, url: u.href });
        else { await navigator.clipboard.writeText(u.href); say('Link to this city copied.'); }
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') say(u.href, 8000);
      }
    });
  }
}

void boot();
