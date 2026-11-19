/**
 * /qr/: a link drawn as a small Istanbul. Every dark module of the link's QR code is a rooftop (terracotta houses,
 * a mosque, Galata Tower, the Maiden's Tower on its water); seen from straight above the rooftops are the code, in
 * the city's own colours, and a phone camera reads it.
 *
 * Its own light page: plain three (WebGL), one instanced draw for the buildings, one for the ground. Nothing here
 * touches the journey's renderer. Without WebGL the code is drawn flat on a 2D canvas, so the page always works.
 */
import qrcode from 'qrcode-generator';
import {
  BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Group, Matrix4, Mesh,
  OrthographicCamera, Scene, ShaderMaterial, SphereGeometry, Vector3, WebGLRenderer,
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

// ---- Istanbul, drawn from the code. Everything that stands on a dark module is dark from above (terracotta, slate,
// lead); everything on a light one is pale stone or water. So the straight-down view is the code, in the city's colours.
const ROOFS = ['#a8432a', '#b44c2d', '#9a3b28', '#bd5632', '#8f3a2a', '#a5492f'];
const WALLS = ['#e6d3b3', '#d9a05b', '#c9705a', '#8fb0b8', '#e2c9a0', '#b8c49a', '#d8b9a8', '#f0e4cc'];
/** linear luminance of every rooftop in the straight-down view */
const DARK = 0.055;
const SLATE = '#4f5b68', LEAD = '#5d6c79', STONE = '#d6c8ae', ROCK = '#5c544a', QUAY = '#6a6156';

/** which finder square a module is in (0 top-left, 1 top-right, 2 bottom-left), and where in it */
function finderAt(n: number, r: number, c: number): { k: number; lr: number; lc: number; ring: number } | null {
  const at: [number, number][] = [[0, 0], [0, n - 7], [n - 7, 0]];
  for (let k = 0; k < 3; k++) {
    const lr = r - at[k][0], lc = c - at[k][1];
    if (lr >= 0 && lr < 7 && lc >= 0 && lc < 7) return { k, lr, lc, ring: 3 - Math.max(Math.abs(lr - 3), Math.abs(lc - 3)) };
  }
  return null;
}

class Parts {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; flat: number[] = []; misc: number[] = [];
  private m = new Matrix4();
  private c = new Color();
  private f = new Color();
  /** one primitive: unit shape scaled to (sx, sy, sz), base at (x, y, z). kind 0 wall with windows, 1 plain, 2 long wall */
  add(geo: BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, flat: string, kind: number, delay: number, tone = 1) {
    const g = geo.clone();
    g.applyMatrix4(this.m.makeScale(sx, sy, sz).setPosition(x, y, z));
    this.c.set(color).multiplyScalar(tone);
    // from above every dark module has the same lightness (hue still varies): scanners threshold locally, and a
    // paler roof among darker ones would read as a light module
    this.f.set(flat);
    this.f.multiplyScalar(DARK / (0.2126 * this.f.r + 0.7152 * this.f.g + 0.0722 * this.f.b) * (0.97 + 0.3 * (tone - 0.9)));
    const p = g.getAttribute('position'), nn = g.getAttribute('normal'), u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      this.uv.push(u.getX(i), u.getY(i));
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.flat.push(this.f.r, this.f.g, this.f.b);
      this.misc.push(kind, delay);
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
  return { box, roof, tube, cone, dome };
}

function buildCity(g: Grid, S: ReturnType<typeof shapes>): { geo: BufferGeometry; tallest: number } {
  const n = g.n, P = new Parts();
  const X = (c: number) => c - n / 2 + 0.5, Z = (r: number) => r - n / 2 + 0.5;
  const delay = (r: number, c: number) => Math.hypot(r - n / 2, c - n / 2) / n * 1.2 + hash(r, c + 11) * 0.25;
  const pick = <T,>(list: T[], h: number) => list[Math.floor(h * list.length) % list.length];

  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!g.dark(r, c)) continue;
    const x = X(c), z = Z(r), d = delay(r, c), h1 = hash(r, c), h2 = hash(c + 3, r + 7), tone = 0.9 + 0.2 * h2;
    const f = finderAt(n, r, c);
    if (f && f.ring >= 2) continue; // the middle of a finder square is one landmark, built below
    if (f && f.k === 0) { // mosque courtyard: a low arcade under lead
      P.add(S.box, x, 0, z, 1, 0.62, 1, STONE, LEAD, 2, d, tone);
      P.add(S.box, x, 0.62, z, 1, 0.1, 1, LEAD, LEAD, 1, d, tone);
      continue;
    }
    if (f && f.k === 2) { // the quay around the water
      P.add(S.box, x, 0, z, 1, 0.22, 1, QUAY, QUAY, 1, d, tone);
      continue;
    }
    const roofC = pick(ROOFS, h1);
    if (h1 > 0.86) { // an apartment block with a flat roof
      const h = 2.2 + h2 * 1.6;
      P.add(S.box, x, 0, z, 0.9, h, 0.9, pick(WALLS, h2), SLATE, 0, d);
      P.add(S.box, x, h, z, 1, 0.12, 1, SLATE, SLATE, 1, d, tone);
      continue;
    }
    const mid = 1 - Math.min(1, Math.hypot(r - n / 2, c - n / 2) / (n * 0.6));
    const h = 0.55 + h2 * 1.0 + mid * 0.6;
    P.add(S.box, x, 0, z, 0.88, h, 0.88, pick(WALLS, hash(r + 5, c + 1)), roofC, 0, d);
    P.add(S.roof, x, h, z, 1, 0.34 + 0.3 * hash(r + 2, c + 9), 1, roofC, roofC, 1, d, tone);
  }

  // mosque: a domed hall with four minarets on the courtyard's corners
  {
    const x = X(3), z = Z(3), d = 0.5;
    P.add(S.box, x, 0, z, 3, 1.7, 3, STONE, LEAD, 2, d);
    P.add(S.box, x, 1.7, z, 3, 0.12, 3, LEAD, LEAD, 1, d);
    P.add(S.dome, x, 1.82, z, 2.5, 2.5, 2.5, LEAD, LEAD, 1, d);
    P.add(S.cone, x, 3.02, z, 0.12, 0.6, 0.12, '#c9a24a', LEAD, 1, d);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      P.add(S.dome, x + dx, 1.82, z + dz, 0.9, 0.9, 0.9, LEAD, LEAD, 1, d);
      const mx = X(3 + dx * 3), mz = Z(3 + dz * 3);
      P.add(S.tube, mx, 0.72, mz, 0.3, 4.1, 0.3, '#eadfc8', LEAD, 1, d + 0.2);
      P.add(S.tube, mx, 3.3, mz, 0.46, 0.14, 0.46, STONE, LEAD, 1, d + 0.2);
      P.add(S.cone, mx, 4.82, mz, 0.42, 1.0, 0.42, LEAD, LEAD, 1, d + 0.2);
    }
  }
  // Galata Tower: a round stone tower under a slate cone
  {
    const x = X(n - 4), z = Z(3), d = 0.6;
    P.add(S.box, x, 0, z, 3, 0.45, 3, ROCK, SLATE, 1, d);
    P.add(S.tube, x, 0.45, z, 2.3, 3.6, 2.3, '#cdbd9f', SLATE, 0, d);
    P.add(S.tube, x, 4.05, z, 2.7, 0.22, 2.7, '#8c7f6a', SLATE, 1, d);
    P.add(S.tube, x, 4.27, z, 2.0, 0.7, 2.0, '#d8c9ab', SLATE, 0, d);
    P.add(S.cone, x, 4.97, z, 2.4, 1.9, 2.4, SLATE, SLATE, 1, d);
    P.add(S.cone, x, 6.8, z, 0.1, 0.5, 0.1, '#c9a24a', SLATE, 1, d);
  }
  // Maiden's Tower on its islet, water all around
  {
    const x = X(3), z = Z(n - 4), d = 0.6, T = '#a8432a';
    P.add(S.box, x, 0, z, 3, 0.3, 3, ROCK, ROCK, 1, d);
    P.add(S.box, x - 0.35, 0.3, z + 0.2, 1.7, 0.85, 1.5, '#efe6d2', T, 0, d);
    P.add(S.roof, x - 0.35, 1.15, z + 0.2, 1.9, 0.5, 1.7, T, T, 1, d);
    P.add(S.box, x + 0.75, 0.3, z - 0.55, 0.85, 2.3, 0.85, '#efe6d2', LEAD, 0, d);
    P.add(S.box, x + 0.75, 2.6, z - 0.55, 1.1, 0.12, 1.1, STONE, LEAD, 1, d);
    P.add(S.tube, x + 0.75, 2.72, z - 0.55, 0.6, 0.5, 0.6, '#efe6d2', LEAD, 1, d);
    P.add(S.dome, x + 0.75, 3.22, z - 0.55, 0.7, 0.9, 0.7, LEAD, LEAD, 1, d);
    P.add(S.cone, x + 0.75, 3.6, z - 0.55, 0.06, 0.9, 0.06, '#c9a24a', LEAD, 1, d);
  }
  return { geo: P.geometry(), tallest: 7.3 };
}

const VERT = /* glsl */ `
attribute vec3 aCol, aFlat;
attribute vec2 aMisc; // kind, rise delay
uniform float uGrow;
varying vec3 vN, vCol, vFlat; varying vec2 vUv; varying float vY, vKind;
void main() {
  float g = clamp(uGrow * 2.0 - aMisc.y, 0.0, 1.0);
  g = 1.0 - pow(1.0 - g, 3.0);
  vec3 p = position;
  vY = p.y;
  p.y *= g;
  vN = normal; vUv = uv; vCol = aCol; vFlat = aFlat; vKind = aMisc.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */ `
uniform float uFlat;
uniform vec3 uSun, uGlass;
varying vec3 vN, vCol, vFlat; varying vec2 vUv; varying float vY, vKind;
void main() {
  vec3 n = normalize(vN);
  vec3 col = vCol;
  if (vKind != 1.0 && abs(n.y) < 0.5) {
    // windows (arches on the long walls)
    vec2 g = vec2(vUv.x * (vKind > 1.5 ? 6.0 : 2.0), vY * 2.3);
    vec2 f = fract(g);
    float w = step(0.26, f.x) * step(f.x, 0.74) * step(0.3, f.y) * step(f.y, 0.78) * step(0.25, vY);
    col = mix(col, uGlass, w * 0.85);
  }
  float light = 0.58 + 0.55 * max(dot(n, uSun), 0.0) + 0.1 * n.y;
  gl_FragColor = vec4(mix(col * light, vFlat, uFlat), 1.0);
  #include <colorspace_fragment>
}`;
const GROUND_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vP;
void main() { vN = normal; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GROUND_FRAG = /* glsl */ `
uniform float uFlat, uN;
uniform vec3 uStone, uWater, uSide;
varying vec3 vN; varying vec3 vP;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 col;
  if (vN.y > 0.5) {
    vec2 m = vP.xz + uN * 0.5;          // module coordinates: x column, y row
    vec2 cell = floor(m);
    col = uStone * mix(0.94 + 0.08 * hash(cell), 0.975 + 0.03 * hash(cell), uFlat);
    // the light ring of the bottom-left finder square is water
    vec2 l = cell - vec2(0.0, uN - 7.0);
    if (max(abs(l.x - 3.0), abs(l.y - 3.0)) == 2.0) col = mix(uWater * (0.95 + 0.07 * hash(cell + 3.0)), mix(uWater, uStone, 0.45), uFlat);
    vec2 f = abs(fract(m) - 0.5);
    col *= 1.0 - 0.07 * smoothstep(0.44, 0.5, max(f.x, f.y)) * (1.0 - uFlat);
  } else {
    col = uSide * (abs(vN.x) > 0.5 ? 1.0 : 0.82);
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
  const label = () => {
    toggle.textContent = flat ? 'Back to the city' : 'Tap the city to see the code';
    toggle.setAttribute('aria-pressed', String(!!flat));
    root.dataset.state = flat ? 'code' : 'city';
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

  const uFlat = { value: flat }, uGrow = { value: calm ? 1 : 0 };
  const S = shapes();
  const cityMat = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uFlat, uGrow, uSun: { value: new Vector3(0.45, 0.62, 0.64).normalize() }, uGlass: { value: new Color('#33414f') } },
  });
  const groundMat = new ShaderMaterial({
    vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG,
    uniforms: {
      uFlat, uN: { value: 0 },
      uStone: { value: new Color(PAPER) }, uWater: { value: new Color('#bfe2ea') }, uSide: { value: new Color('#bfae90') },
    },
  });
  let buildings: Mesh | null = null, ground: Mesh | null = null;
  let plate = 0, tallest = 0;

  function build() {
    if (buildings) { city.remove(buildings); buildings.geometry.dispose(); }
    if (ground) { city.remove(ground); ground.geometry.dispose(); }
    const n = grid.n;
    const made = buildCity(grid, S);
    tallest = made.tallest;
    buildings = new Mesh(made.geo, cityMat);
    buildings.frustumCulled = false;
    city.add(buildings);

    plate = n;
    const slab = new BoxGeometry(n + 0.5, 0.7, n + 0.5);
    slab.translate(0, -0.35, 0);
    groundMat.uniforms.uN.value = n;
    ground = new Mesh(slab, groundMat);
    city.add(ground);
    if (!calm) uGrow.value = 0;
    dirty = true;
  }

  // ---- view
  const ISO = 0.62; // camera elevation over the city, radians
  const TURN = 0.62; // seconds for the whip between city and code
  let blurred = '';
  let az = Math.PI / 4, flatNow = flat, dirty = true, last = 0;
  let dragging = false, moved = 0, lastX = 0, spin = calm ? 0 : 0.1, idle = 0;

  function fit() {
    const w = innerWidth, h = innerHeight;
    renderer!.setPixelRatio(Math.min(devicePixelRatio || 1, 3));
    renderer!.setSize(w, h, false);
    dirty = true;
  }
  function pose() {
    const w = innerWidth, h = innerHeight;
    const e = flatNow * flatNow * (3 - 2 * flatNow); // smooth
    // room for the picture: below the header, above the panel
    const top = 68, bottom = Math.min(h - 120, panel.getBoundingClientRect().top - 12);
    const aw = w - 24, ah = Math.max(160, bottom - top);
    // world size to fit: the code square-on with its quiet zone (the page itself, which is as pale as the stone),
    // or the plate's diagonal and the towers seen from the side
    const el = ISO + (Math.PI / 2 - ISO) * e;
    const wide = e * (plate + QUIET * 2) + (1 - e) * plate * 1.5;
    const tall = e * (plate + QUIET * 2) + (1 - e) * (plate * 1.46 * Math.sin(ISO) + tallest * Math.cos(ISO) * 1.05);
    // the turn is a whip: it punches in while it spins
    const punch = 1 + 0.22 * Math.sin(Math.PI * flatNow);
    const ppu = Math.min(aw / wide, ah / tall) * punch;
    const cy = (top + bottom) / 2;
    camera.left = -w / 2 / ppu; camera.right = w / 2 / ppu;
    camera.top = cy / ppu; camera.bottom = -(h - cy) / ppu;
    camera.position.set(0, Math.sin(el) * 120, Math.cos(el) * 120);
    camera.up.set(0, Math.cos(el), -Math.sin(el));
    const lift = (1 - e) * tallest * 0.3;
    camera.position.y += lift;
    camera.lookAt(0, lift, 0);
    camera.updateProjectionMatrix();
    city.rotation.y = az;
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (document.hidden) return;
    if (flatNow !== flat) {
      flatNow = calm ? flat : Math.max(0, Math.min(1, flatNow + Math.sign(flat - flatNow) * dt / TURN));
      dirty = true;
    }
    if (uGrow.value < 1) { uGrow.value = Math.min(1, uGrow.value + dt / 1.5); dirty = true; }
    if (flat) {
      // square up to the nearest quarter turn: a QR code reads at any of the four
      const q = Math.round(az / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(q - az) > 1e-4) { az += (q - az) * Math.min(1, dt * 11); if (Math.abs(q - az) < 1e-3) az = q; dirty = true; }
    } else if (!dragging && spin) {
      idle += dt;
      if (idle > 1.2) { az += spin * dt; dirty = true; }
    }
    if (!dirty) return;
    dirty = false;
    uFlat.value = Math.min(1, Math.max(0, (flatNow - 0.55) / 0.45)); // the city's own light until it is nearly square-on
    // motion blur through the middle of the turn
    const px = calm ? 0 : 7 * Math.sin(Math.PI * flatNow);
    const b = px > 0.4 ? `blur(${px.toFixed(1)}px)` : '';
    if (b !== blurred) { blurred = b; canvas.style.filter = b; }
    pose();
    renderer!.render(scene, camera);
  }

  function setFlat(v: number) { flat = v; idle = 0; label(); dirty = true; }
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
  addEventListener('resize', fit);
  renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
  renderer.domElement.addEventListener('webglcontextrestored', () => { dirty = true; });

  label();
  build();
  fit();
  requestAnimationFrame(frame);
  wire(build);
  (window as any).__qr = { get settled() { return flatNow === flat && uGrow.value >= 1 && !dirty; }, get text() { return text; } };

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

boot();
