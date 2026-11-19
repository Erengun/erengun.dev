/**
 * /qr/: a link drawn as a small city at night. Every dark module of the link's QR code is a building; seen from
 * straight above, with the lights on, the rooftops are the code and a phone camera reads it.
 *
 * Its own light page: plain three (WebGL), one instanced draw for the buildings, one for the ground. Nothing here
 * touches the journey's renderer. Without WebGL the code is drawn flat on a 2D canvas, so the page always works.
 */
import qrcode from 'qrcode-generator';
import {
  BoxGeometry, Color, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, OrthographicCamera, Scene,
  ShaderMaterial, WebGLRenderer,
} from 'three';

const DEFAULT = 'https://erengun.dev';
/** light modules kept clear around the code, as the QR spec asks */
const QUIET = 4;
const INK = '#101012', PAPER = '#f2f0ea';

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
// non-Latin links: bytes as UTF-8
const funcs = (qrcode as any).stringToBytesFuncs;
if (funcs?.['UTF-8']) (qrcode as any).stringToBytes = funcs['UTF-8'];

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

/** building height for a dark module: the three finder squares become walled plazas with a tower */
function heightAt(g: Grid, r: number, c: number): number {
  const n = g.n;
  for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    const lr = r - fr, lc = c - fc;
    if (lr >= 0 && lr < 7 && lc >= 0 && lc < 7) {
      const inner = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4;
      if (!inner) return 0.55;
      return lr === 3 && lc === 3 ? 5.2 : 3.6;
    }
  }
  if (r === 6 || c === 6) return 0.45; // timing rows: low walls
  const h = hash(r, c);
  // a few tall ones, most low, taller towards the middle
  const mid = 1 - Math.min(1, Math.hypot(r - n / 2, c - n / 2) / (n * 0.6));
  return 0.7 + h * 1.5 + (h > 0.82 ? 2.2 : 0) + mid * 1.1;
}

const VERT = /* glsl */ `
attribute vec3 aInst; // x, z, height
attribute vec2 aRnd;  // seed, rise delay
uniform float uFlat, uGrow;
varying vec3 vN; varying vec2 vUv; varying float vY, vSeed;
void main() {
  float g = clamp(uGrow * 2.0 - aRnd.y, 0.0, 1.0);
  g = 1.0 - pow(1.0 - g, 3.0);
  float h = max(mix(aInst.z, 0.14, uFlat) * g, 0.02);
  vec3 p = position;
  p.xz *= mix(0.8, 1.0, uFlat) * (0.3 + 0.7 * g);
  p.y *= h;
  p.xz += aInst.xy;
  vN = normal; vUv = uv; vY = p.y; vSeed = aRnd.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */ `
uniform float uFlat;
uniform vec3 uInk, uRoof, uWallA, uWallB, uLit;
varying vec3 vN; varying vec2 vUv; varying float vY, vSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 col;
  if (vN.y > 0.5) {
    col = uRoof * (0.8 + 0.45 * vSeed);
  } else {
    float face = abs(vN.x) > 0.5 ? (vN.x > 0.0 ? 1.0 : 0.35) : (vN.z > 0.0 ? 0.7 : 0.2);
    col = mix(uWallA, uWallB, face) * (0.75 + 0.25 * smoothstep(0.0, 2.5, vY));
    // windows: a grid on the wall, some lit
    vec2 g = vec2(vUv.x * 2.0, vY * 2.6);
    vec2 f = fract(g);
    float on = step(0.6, hash(floor(g) + vec2(vSeed * 91.0, face * 7.0)));
    float w = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.74);
    col = mix(col, uLit * (0.7 + 0.5 * hash(floor(g) + vSeed)), w * on);
  }
  gl_FragColor = vec4(mix(col, uInk, uFlat), 1.0);
  #include <colorspace_fragment>
}`;
const GROUND_VERT = /* glsl */ `
varying vec3 vN; varying vec2 vP;
void main() { vN = normal; vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GROUND_FRAG = /* glsl */ `
uniform float uFlat, uOdd;
uniform vec3 uPaper, uNight, uStreet, uEdge;
varying vec3 vN; varying vec2 vP;
void main() {
  vec3 col;
  if (vN.y > 0.5) {
    // street grid on the module borders, gone when the lights come on
    vec2 f = abs(fract(vP + uOdd * 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.42, 0.5, max(f.x, f.y));
    col = mix(mix(uStreet, uNight, line), uPaper, uFlat);
  } else {
    col = mix(uEdge, uPaper * 0.72, uFlat) * (abs(vN.x) > 0.5 ? 1.0 : 0.7);
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
  const box = new BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const buildingMat = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uFlat, uGrow,
      uInk: { value: new Color(INK) }, uRoof: { value: new Color('#59627f') },
      uWallA: { value: new Color('#1b1e2b') }, uWallB: { value: new Color('#454c66') },
      uLit: { value: new Color('#ffa257') },
    },
  });
  const groundMat = new ShaderMaterial({
    vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG,
    uniforms: {
      uFlat, uOdd: { value: 0 },
      uPaper: { value: new Color(PAPER) }, uNight: { value: new Color('#12141d') },
      uStreet: { value: new Color('#262a3a') }, uEdge: { value: new Color('#20232f') },
    },
  });
  let buildings: Mesh | null = null, ground: Mesh | null = null;
  let plate = 0, tallest = 0;

  function build() {
    if (buildings) { city.remove(buildings); buildings.geometry.dispose(); }
    if (ground) { city.remove(ground); ground.geometry.dispose(); }
    const n = grid.n;
    const inst: number[] = [], rnd: number[] = [];
    tallest = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!grid.dark(r, c)) continue;
      const h = heightAt(grid, r, c);
      tallest = Math.max(tallest, h);
      inst.push(c - n / 2 + 0.5, r - n / 2 + 0.5, h);
      // rise from the middle outwards
      rnd.push(hash(c + 3, r + 7), Math.hypot(r - n / 2, c - n / 2) / n * 1.2 + hash(r, c + 11) * 0.25);
    }
    const geo = new InstancedBufferGeometry();
    geo.index = box.index;
    geo.setAttribute('position', box.getAttribute('position'));
    geo.setAttribute('normal', box.getAttribute('normal'));
    geo.setAttribute('uv', box.getAttribute('uv'));
    geo.setAttribute('aInst', new InstancedBufferAttribute(new Float32Array(inst), 3));
    geo.setAttribute('aRnd', new InstancedBufferAttribute(new Float32Array(rnd), 2));
    geo.instanceCount = inst.length / 3;
    buildings = new Mesh(geo, buildingMat);
    buildings.frustumCulled = false;
    city.add(buildings);

    plate = n + QUIET * 2;
    const slab = new BoxGeometry(plate, 0.9, plate);
    slab.translate(0, -0.45, 0);
    groundMat.uniforms.uOdd.value = n % 2; // module borders fall on half units when n is odd
    ground = new Mesh(slab, groundMat);
    city.add(ground);
    if (!calm) uGrow.value = 0;
    dirty = true;
  }

  // ---- view
  const ISO = 0.62; // camera elevation over the city, radians
  let az = Math.PI / 4, flatNow = flat, dirty = true, last = 0;
  let dragging = false, moved = 0, lastX = 0, spin = calm ? 0 : 0.1, idle = 0;

  function fit() {
    const w = innerWidth, h = innerHeight;
    renderer!.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer!.setSize(w, h, false);
    dirty = true;
  }
  function pose() {
    const w = innerWidth, h = innerHeight;
    const e = flatNow * flatNow * (3 - 2 * flatNow); // smooth
    // room for the picture: below the header, above the panel
    const top = 68, bottom = Math.min(h - 120, panel.getBoundingClientRect().top - 12);
    const aw = w - 24, ah = Math.max(160, bottom - top);
    // world size to fit: the plate seen square-on, or its diagonal and the towers seen from the side
    const el = ISO + (Math.PI / 2 - ISO) * e;
    const wide = plate * (1.06 + 0.4 * (1 - e));
    const tall = plate * (1.06 * e + (1 - e) * (1.46 * Math.sin(ISO))) + (1 - e) * tallest * Math.cos(ISO) * 1.1;
    const ppu = Math.min(aw / wide, ah / tall);
    const cy = (top + bottom) / 2;
    camera.left = -w / 2 / ppu; camera.right = w / 2 / ppu;
    camera.top = cy / ppu; camera.bottom = -(h - cy) / ppu;
    camera.position.set(0, Math.sin(el) * 120, Math.cos(el) * 120);
    camera.up.set(0, Math.cos(el), -Math.sin(el));
    const lift = (1 - e) * tallest * 0.28;
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
      flatNow = calm ? flat : Math.max(0, Math.min(1, flatNow + Math.sign(flat - flatNow) * dt / 1.15));
      dirty = true;
    }
    if (uGrow.value < 1) { uGrow.value = Math.min(1, uGrow.value + dt / 1.5); dirty = true; }
    if (flat) {
      // square up to the nearest quarter turn: a QR code reads at any of the four
      const q = Math.round(az / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(q - az) > 1e-4) { az += (q - az) * Math.min(1, dt * 5); if (Math.abs(q - az) < 1e-3) az = q; dirty = true; }
    } else if (!dragging && spin) {
      idle += dt;
      if (idle > 1.2) { az += spin * dt; dirty = true; }
    }
    if (!dirty) return;
    dirty = false;
    uFlat.value = flatNow * flatNow * (3 - 2 * flatNow);
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
