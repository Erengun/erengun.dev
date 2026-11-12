/**
 * Subara world: liquid-glass subscription cards (made-up services) orbiting a giant phone that floats over a
 * reflective payment calendar. A Dynamic-Island style pill above the phone reads "Renews in 2 days".
 * Violet #5b3df5 → pink #ff8fc7. The featured real screenshot is on the phone screen.
 *
 * Timing (local t):  arrive 0 → .22  phone lies face-up on the calendar, rises upright while the camera swoops down
 *                                    from a top-down view of the month; cards lift off the floor into orbit; pill expands
 *                    hold   .22 → .82 calm framing of the screen (legible), slow drift + pointer parallax, cards orbit
 *                    depart .82 → 1   pill collapses, cards spiral out, camera pushes into the screen (portalQuad)
 *
 * Output convention: linear colour, already tone-mapped (≤ 1), into the stage render target.
 * Draws: sky, floor, phone, screen, pill, cards (instanced), particles + mirrored phone/screen/cards = 10.
 */
import {
  Scene, Color, Mesh, PerspectiveCamera, InstancedMesh, Group, PlaneGeometry, SphereGeometry, Sprite,
  MeshBasicNodeMaterial, SpriteNodeMaterial, CanvasTexture, TextureLoader, SRGBColorSpace, BackSide,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor, AdditiveBlending, Matrix4, Vector3, Vector4, Quaternion, Euler,
  LinearMipmapLinearFilter, type BufferGeometry, type Texture,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, texture, positionWorld, positionGeometry, normalGeometry, normalWorld,
  normalView, cameraPosition, screenUV, mix, smoothstep, clamp, max, min, pow, exp, length, normalize, dot, sin, cos,
  fract, floor, abs, reflect, uv, instanceIndex, hash, fwidth, viewportSharedTexture, select, time as tslTime,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Stage, StageFrame, ProjectWorldContext, SlideImage } from '../journey/types';

type N = any; // TSL nodes, loosely typed on purpose
/** smoothstep that accepts reversed constant edges (WGSL rejects low ≥ high in const expressions) */
const ss = (a: number | N, b: number | N, x: N): N =>
  typeof a === 'number' && typeof b === 'number' && a > b ? float(1).sub(smoothstep(b, a, x)) : smoothstep(a, b, x);

// ------------------------------------------------------------------ constants
const VIOLET = new Color('#5b3df5');
const PINK = new Color('#ff8fc7');
const BG = new Color(0.012, 0.007, 0.03);
const PHONE_C = new Vector3(0, 1.5, 0);
const SCREEN_W = 0.9, SCREEN_H = 1.96, SCREEN_R = 0.118;
const CARD_W = 1.2, CARD_H = 0.76;
const CELL = 0.95; // calendar cell (world units)
const FOV = 30;
const TODAY = 12; // calendar "today" (Nov 12): Streamly renews on the 14th → "in 2 days"
const YEAR = 2026, MONTH = 10; // November

type Service = { name: string; price: string; day: number; color: string; glyph: 'play' | 'bars' | 'cloud' | 'wave' | 'note'; plan: string };
const SERVICES: Service[] = [
  { name: 'Streamly', price: '$12.99', day: 14, color: '#ff5f8f', glyph: 'play', plan: 'Premium · monthly' },
  { name: 'Tunebox', price: '$10.99', day: 21, color: '#ffb547', glyph: 'bars', plan: 'Individual · monthly' },
  { name: 'CloudNest', price: '$2.99', day: 3, color: '#4cc9ff', glyph: 'cloud', plan: '200 GB · monthly' },
  { name: 'Gymflow', price: '$24.99', day: 9, color: '#53e0a1', glyph: 'wave', plan: 'All access · monthly' },
  { name: 'Notely Pro', price: '$4.99', day: 27, color: '#b89cff', glyph: 'note', plan: 'Pro · monthly' },
];

// ------------------------------------------------------------------ small math helpers
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (x: number) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const damp = (a: number, b: number, l: number, dt: number) => lerp(a, b, 1 - Math.exp(-l * dt));

// ------------------------------------------------------------------ canvas helpers
const SANS = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}
function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); (g as any).roundRect(x, y, w, h, r);
}
function glyph(g: CanvasRenderingContext2D, kind: Service['glyph'], cx: number, cy: number, s: number) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  if (kind === 'play') {
    g.beginPath(); g.moveTo(-s * 0.28, -s * 0.36); g.lineTo(s * 0.4, 0); g.lineTo(-s * 0.28, s * 0.36); g.closePath(); g.fill();
  } else if (kind === 'bars') {
    const hs = [0.4, 0.75, 0.55, 0.9, 0.35];
    hs.forEach((h, i) => { rrect(g, -s * 0.42 + i * s * 0.18, -s * h * 0.5, s * 0.11, s * h, s * 0.05); g.fill(); });
  } else if (kind === 'cloud') {
    g.beginPath();
    g.arc(-s * 0.18, s * 0.06, s * 0.2, Math.PI * 0.5, Math.PI * 1.5);
    g.arc(s * 0.02, -s * 0.1, s * 0.26, Math.PI * 1.05, Math.PI * 1.95);
    g.arc(s * 0.24, s * 0.08, s * 0.18, Math.PI * 1.5, Math.PI * 0.5);
    g.closePath(); g.fill();
  } else if (kind === 'wave') {
    g.lineWidth = s * 0.1;
    g.beginPath(); g.moveTo(-s * 0.42, s * 0.04);
    g.lineTo(-s * 0.2, s * 0.04); g.lineTo(-s * 0.08, -s * 0.3); g.lineTo(s * 0.08, s * 0.3); g.lineTo(s * 0.2, s * 0.04); g.lineTo(s * 0.42, s * 0.04);
    g.stroke();
  } else {
    g.lineWidth = s * 0.08;
    rrect(g, -s * 0.3, -s * 0.38, s * 0.6, s * 0.76, s * 0.08); g.stroke();
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-s * 0.16, -s * 0.16 + i * s * 0.16); g.lineTo(s * 0.16, -s * 0.16 + i * s * 0.16); g.stroke(); }
  }
  g.restore();
}
function appIcon(g: CanvasRenderingContext2D, s: Service, x: number, y: number, size: number) {
  const c = new Color(s.color);
  const gr = g.createLinearGradient(x, y, x + size, y + size);
  gr.addColorStop(0, s.color);
  gr.addColorStop(1, `#${c.clone().lerp(new Color('#5b3df5'), 0.55).getHexString()}`);
  rrect(g, x, y, size, size, size * 0.27);
  g.fillStyle = gr; g.fill();
  glyph(g, s.glyph, x + size / 2, y + size / 2, size * 0.62);
}
function dayLabel(day: number) {
  const d = new Date(YEAR, MONTH, day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** atlas: 5 card faces (1024×648 cells) + the pill content (1024×232) */
const AT = 2048, CW = 1024, CH = 648, PILL_X = CW, PILL_Y = 2 * CH;
function buildAtlas() {
  const [c, g] = canvas(AT, AT);
  g.clearRect(0, 0, AT, AT);
  SERVICES.forEach((s, i) => {
    const x = (i % 2) * CW, y = Math.floor(i / 2) * CH;
    g.save(); g.translate(x, y);
    appIcon(g, s, 64, 60, 132);
    g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
    g.font = `700 70px ${SANS}`; g.fillText(s.name, 224, 128);
    g.font = `500 36px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.72)'; g.fillText(s.plan, 226, 180);
    g.fillStyle = '#fff'; g.font = `800 138px ${SANS}`; g.fillText(s.price, 60, 560);
    const pw = g.measureText(s.price).width;
    g.font = `600 44px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText('/mo', 72 + pw, 560);
    // renewal chip
    const left = s.day - TODAY;
    const chip = left === 0 ? 'Today' : left > 0 && left <= 3 ? `in ${left} days` : dayLabel(s.day);
    g.font = `700 38px ${SANS}`;
    const cw = g.measureText(chip).width + 64;
    rrect(g, CW - 60 - cw, 470, cw, 76, 38);
    g.fillStyle = left > 0 && left <= 3 ? 'rgba(255,143,199,0.92)' : 'rgba(255,255,255,0.18)'; g.fill();
    g.fillStyle = left > 0 && left <= 3 ? '#2a0b3a' : '#fff'; g.fillText(chip, CW - 60 - cw + 32, 522);
    // tiny contactless/brand marks top-right
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 7; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(CW - 150, 120, 22 + k * 20, -0.7, 0.7); g.stroke(); }
    g.restore();
  });
  // pill content: icon · "Streamly" / "Renews in 2 days" · ring
  {
    const s = SERVICES[0];
    g.save(); g.translate(PILL_X, PILL_Y);
    appIcon(g, s, 40, 46, 140);
    g.fillStyle = 'rgba(255,255,255,0.62)'; g.font = `600 44px ${SANS}`; g.fillText(`${s.name} · ${s.price}`, 214, 98);
    g.fillStyle = '#fff'; g.font = `700 70px ${SANS}`; g.fillText('Renews in 2 days', 212, 176);
    // countdown ring
    g.lineWidth = 16; g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.arc(CW - 110, 116, 56, 0, Math.PI * 2); g.stroke();
    const gr = g.createLinearGradient(CW - 170, 60, CW - 50, 170); gr.addColorStop(0, '#ff8fc7'); gr.addColorStop(1, '#8f74ff');
    g.strokeStyle = gr; g.beginPath(); g.arc(CW - 110, 116, 56, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.72); g.stroke();
    g.fillStyle = '#fff'; g.font = `800 50px ${SANS}`; g.textAlign = 'center'; g.fillText('2', CW - 110, 134);
    g.restore();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** calendar month on the floor: 7 cols × 8 rows (title, weekdays, 6 week rows), 256 px cells */
const CAL_COLS = 7, CAL_ROWS = 8, CAL_PX = 256;
function monthGrid() {
  const first = new Date(YEAR, MONTH, 1).getDay(); // 0 = Sun
  const off = (first + 6) % 7; // Monday-first
  const days = new Date(YEAR, MONTH + 1, 0).getDate();
  const cells: { day: number; col: number; row: number }[] = [];
  for (let d = 1; d <= days; d++) { const k = off + d - 1; cells.push({ day: d, col: k % 7, row: Math.floor(k / 7) }); }
  return cells;
}
function buildCalendar() {
  const W = CAL_COLS * CAL_PX, H = CAL_ROWS * CAL_PX;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff'; g.font = `700 150px ${SANS}`; g.fillText('November', 34, 196);
  g.fillStyle = 'rgba(255,255,255,0.45)'; g.font = `500 150px ${SANS}`; g.fillText('2026', 34 + g.measureText('November ').width + 60, 196);
  ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].forEach((w, i) => {
    g.fillStyle = i >= 5 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.62)';
    g.font = `600 54px ${SANS}`; g.fillText(w, i * CAL_PX + 30, CAL_PX + 200);
  });
  for (const cl of monthGrid()) {
    const x = cl.col * CAL_PX, y = (cl.row + 2) * CAL_PX;
    rrect(g, x + 12, y + 12, CAL_PX - 24, CAL_PX - 24, 40);
    g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 4; g.stroke();
    g.fillStyle = cl.day === TODAY ? '#fff' : cl.col >= 5 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.78)';
    g.font = `${cl.day === TODAY ? 800 : 600} 84px ${SANS}`;
    g.fillText(String(cl.day), x + 38, y + 112);
  }
  const t = new CanvasTexture(c);
  t.anisotropy = 8;
  t.minFilter = LinearMipmapLinearFilter;
  return t; // used as a linear mask
}

/** generated stand-in screenshots (only when no manifest exists at all, or ?fixture on the test page) */
function genSlide(kind: 'phone' | 'desktop', seed: number): HTMLCanvasElement {
  const phone = kind === 'phone';
  const W = phone ? 1179 : 2016, H = phone ? 2556 : 1200;
  const [c, g] = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#f6f3ff'); bg.addColorStop(1, '#ece6ff');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';
  if (phone) {
    g.fillStyle = '#16122a'; g.font = `600 44px ${SANS}`; g.fillText('9:41', 110, 110);
    g.font = `800 96px ${SANS}`; g.fillText(seed % 2 ? 'Calendar' : 'Subscriptions', 72, 330);
    // summary card
    const gr = g.createLinearGradient(72, 400, W - 72, 760); gr.addColorStop(0, '#5b3df5'); gr.addColorStop(1, '#ff8fc7');
    rrect(g, 72, 400, W - 144, 380, 56); g.fillStyle = gr; g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = `600 46px ${SANS}`; g.fillText('This month', 128, 490);
    g.fillStyle = '#fff'; g.font = `800 150px ${SANS}`; g.fillText('$56.95', 124, 660);
    g.font = `600 42px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText('5 active · next: Streamly in 2 days', 128, 735);
    SERVICES.forEach((s, i) => {
      const y = 860 + i * 250;
      rrect(g, 72, y, W - 144, 220, 44); g.fillStyle = '#fff'; g.fill();
      appIcon(g, s, 110, y + 40, 140);
      g.fillStyle = '#16122a'; g.font = `700 56px ${SANS}`; g.fillText(s.name, 290, y + 100);
      g.fillStyle = '#6f6888'; g.font = `500 42px ${SANS}`; g.fillText(`Renews ${dayLabel(s.day)}`, 290, y + 160);
      g.fillStyle = '#16122a'; g.font = `700 58px ${SANS}`; g.textAlign = 'right'; g.fillText(s.price, W - 120, y + 128); g.textAlign = 'left';
    });
    rrect(g, 72, H - 220, W - 144, 150, 75); g.fillStyle = 'rgba(22,18,42,0.92)'; g.fill();
    ['Home', 'Calendar', 'Stats', 'Settings'].forEach((l, i) => {
      g.fillStyle = i === seed % 4 ? '#ff8fc7' : 'rgba(255,255,255,0.7)'; g.font = `600 40px ${SANS}`; g.textAlign = 'center';
      g.fillText(l, 72 + ((W - 144) / 4) * (i + 0.5), H - 132);
    });
    g.textAlign = 'left';
  } else {
    g.fillStyle = '#16122a'; g.font = `800 92px ${SANS}`; g.fillText('Spending', 96, 170);
    g.fillStyle = '#6f6888'; g.font = `500 40px ${SANS}`; g.fillText('Last 12 months · all subscriptions', 100, 236);
    const bars = [38, 41, 40, 52, 49, 55, 54, 57, 61, 58, 57, 64];
    bars.forEach((b, i) => {
      const x = 100 + i * 100, h = b * 9;
      const gr = g.createLinearGradient(0, 1060 - h, 0, 1060); gr.addColorStop(0, '#ff8fc7'); gr.addColorStop(1, '#5b3df5');
      rrect(g, x, 1060 - h, 64, h, 18); g.fillStyle = gr; g.fill();
      g.fillStyle = '#6f6888'; g.font = `500 30px ${SANS}`; g.fillText('JFMAMJJASOND'[i], x + 22, 1110);
    });
    SERVICES.forEach((s, i) => {
      const y = 300 + i * 150;
      rrect(g, 1380, y, 540, 128, 32); g.fillStyle = '#fff'; g.fill();
      appIcon(g, s, 1404, y + 20, 88);
      g.fillStyle = '#16122a'; g.font = `700 40px ${SANS}`; g.fillText(s.name, 1516, y + 62);
      g.fillStyle = '#6f6888'; g.font = `500 30px ${SANS}`; g.fillText(dayLabel(s.day), 1516, y + 102);
      g.fillStyle = '#16122a'; g.font = `700 40px ${SANS}`; g.textAlign = 'right'; g.fillText(s.price, 1890, y + 78); g.textAlign = 'left';
    });
  }
  return c;
}

async function loadManifest(url: string): Promise<SlideImage[] | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) && j.length ? (j as SlideImage[]) : null;
  } catch { return null; }
}

// ------------------------------------------------------------------ shared shading (TSL)
const vc = (c: Color, k = 1) => vec3(c.r * k, c.g * k, c.b * k);
/** studio environment: top softbox, violet key from the left, pink rim from the right, dark violet surround */
const envCol = (d: N): N => {
  const base = mix(vec3(0.008, 0.005, 0.02), vec3(0.05, 0.026, 0.12), ss(-0.3, 0.7, d.y));
  const box = ss(0.72, 0.93, d.y).mul(ss(0.62, 0.2, abs(d.x))).mul(3.2);
  const left = ss(0.35, 0.92, d.x.negate()).mul(ss(-0.45, 0.25, d.y)).mul(ss(-0.6, 0.1, d.z.negate().negate()));
  const right = ss(0.35, 0.92, d.x).mul(ss(-0.45, 0.25, d.y));
  const strip = ss(0.985, 1.0, abs(d.x.mul(0.6).add(d.y.mul(0.8)))).mul(1.2); // thin diagonal streak
  const bounce = ss(0.0, -0.6, d.y).mul(vec3(0.16, 0.05, 0.2));
  return base
    .add(vec3(0.95, 0.9, 1.0).mul(box))
    .add(vc(VIOLET, 2.6).mul(left))
    .add(vc(PINK, 2.0).mul(right))
    .add(vec3(1, 0.92, 1).mul(strip))
    .add(bounce);
};
/** backdrop sky (also the fog colour); mirrored below the horizon so the floor reflection shows sky */
const skyCol = (d: N): N => {
  const y = abs(d.y);
  const top = mix(vec3(0.016, 0.009, 0.042), vec3(0.003, 0.002, 0.008), ss(0.0, 0.45, y));
  const behind = ss(-0.2, -1.0, d.z); // glow behind the phone
  const horizon = exp(y.mul(y).mul(-90)).mul(behind.mul(0.8).add(0.2));
  const hue = mix(vc(VIOLET, 1), vc(PINK, 1), ss(-0.6, 0.6, d.x));
  const halo = exp(length(vec2(d.x, y.sub(0.1))).mul(-4.5)).mul(behind).mul(0.14);
  return top.add(hue.mul(horizon.mul(0.13).add(halo)));
};
/** cheap filmic tonemap (ACES fit), keeps values ≤ 1 */
const tonemap = (c: N): N => {
  const x = max(c, vec3(0));
  return clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0, 1);
};
const applyFog = (c: N, P: N, density = 0.05): N => {
  const d = length(cameraPosition.sub(P));
  const V = normalize(P.sub(cameraPosition));
  const f = float(1).sub(exp(d.mul(density).mul(d.mul(density)).negate()));
  return mix(c, skyCol(V), clamp(f, 0, 1));
};
/** fade for mirrored (reflection) geometry: deeper under the floor = dimmer */
const mirrorFade = (P: N): N => exp(min(P.y, 0).mul(0.75)).mul(0.62);

export function createWorld(ctx: ProjectWorldContext): Stage {
  const scene = new Scene();
  scene.background = BG;
  const camera = new PerspectiveCamera(FOV, 16 / 10, 0.05, 120);
  camera.position.set(0, 2, 6);

  const uTime = uniform(0);
  const uScreenOn = uniform(0); // 0 → wallpaper, 1 → screenshot
  const uImgAspect = uniform(0.46);
  const uOrient = uniform(0); // 0 portrait, 1 landscape (screen content space)
  const uPillW = uniform(0.4), uPillH = uniform(0.34), uPillContent = uniform(0), uPillOpacity = uniform(0);
  const uParallax = uniform(new Vector3());
  const cardPos = SERVICES.map(() => uniform(new Vector3(0, -10, 0)));
  const dotPulse = uniform(0);

  // ================================================================ sky dome
  const skyMat = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  skyMat.colorNode = Fn(() => skyCol(normalize(positionWorld.sub(cameraPosition))))();
  skyMat.fog = false;
  const sky = new Mesh(new SphereGeometry(80, 32, 16), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  // ================================================================ floor (calendar, reflective)
  const calTex = buildCalendar();
  const calW = CAL_COLS * CELL, calD = CAL_ROWS * CELL;
  const calZ0 = -4.5 * CELL; // far edge of the title row; week row 2 is centred on z = 0
  const grid = monthGrid();
  const dots = SERVICES.map((s) => grid.find((c) => c.day === s.day)!);
  const todayCell = grid.find((c) => c.day === TODAY)!;
  const cellCenter = (col: number, row: number) => new Vector3(-calW / 2 + (col + 0.5) * CELL, 0, calZ0 + (row + 2.5) * CELL);
  const floorMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: true });
  floorMat.blending = CustomBlending;
  floorMat.blendSrc = OneFactor;
  floorMat.blendDst = OneMinusSrcAlphaFactor;
  floorMat.fog = false;
  floorMat.outputNode = Fn(() => {
    const P = positionWorld;
    const V = normalize(cameraPosition.sub(P));
    const ndv = clamp(V.y, 0, 1);
    const fres = pow(float(1).sub(ndv), 4);
    // calendar mask
    const cu = P.x.add(calW / 2).div(calW);
    const cv = float(1).sub(P.z.sub(calZ0).div(calD));
    const inCal = ss(0, 0.004, cu).mul(ss(1, 0.996, cu)).mul(ss(0, 0.004, cv)).mul(ss(1, 0.996, cv));
    const cal = texture(calTex, vec2(cu, cv)).r.mul(inCal);
    // faint infinite grid beyond the month
    const gq = abs(fract(P.xz.div(CELL)).sub(0.5));
    const gw = fwidth(P.xz.div(CELL)).mul(1.2);
    const lx = float(1).sub(ss(float(0), gw.x, float(0.5).sub(gq.x)));
    const ly = float(1).sub(ss(float(0), gw.y, float(0.5).sub(gq.y)));
    const gridLine = max(lx, ly).mul(0.07).mul(float(1).sub(inCal));
    // base: dark lacquer with light pools
    const r = length(P.xz.sub(vec2(0, 0.2)));
    let col: N = vec3(0.012, 0.008, 0.026).add(mix(vc(VIOLET, 0.18), vc(PINK, 0.1), ss(-2, 2, P.x)).mul(exp(r.mul(r).mul(-0.16))));
    const ink = mix(vec3(0.62, 0.56, 0.95), vec3(1, 0.85, 0.95), ss(-3, 3, P.x));
    col = col.add(ink.mul(cal).mul(0.3)).add(vec3(0.5, 0.45, 0.8).mul(gridLine));
    // payment dots (glowing, pulsing) + light pools under the cards
    SERVICES.forEach((s, i) => {
      const c = cellCenter(dots[i].col, dots[i].row);
      const dp = P.xz.sub(vec2(c.x + CELL * 0.24, c.z + CELL * 0.2));
      const dd = length(dp);
      const scol = vc(new Color(s.color), 1);
      const isNext = s.day === 14 ? 1 : 0;
      const pulse = sin(uTime.mul(2.2).add(i * 1.7)).mul(0.25).add(0.75).add(dotPulse.mul(isNext));
      const core = ss(0.075, 0.06, dd);
      const glow = exp(dd.mul(dd).mul(-36)).mul(0.5).mul(pulse);
      col = col.add(scol.mul(core.mul(1.6).add(glow)));
      if (isNext) {
        const ring = ss(0.02, 0.0, abs(dd.sub(fract(uTime.mul(0.45)).mul(0.6).add(0.1)))).mul(float(1).sub(fract(uTime.mul(0.45))));
        col = col.add(vc(PINK, 0.9).mul(ring));
      }
      const cp = cardPos[i];
      const dc = length(P.xz.sub(cp.xz));
      col = col.add(scol.mul(exp(dc.mul(dc).mul(-1.4))).mul(0.05).mul(ss(3.2, 0.5, cp.y)));
    });
    // today: ring around the cell
    {
      const c = cellCenter(todayCell.col, todayCell.row);
      const q = abs(P.xz.sub(vec2(c.x, c.z))).sub(CELL * 0.5 - 0.075);
      const sd = length(max(q, vec2(0))).add(min(max(q.x, q.y), 0)).sub(0.05);
      col = col.add(vc(PINK, 0.85).mul(ss(0.016, 0.0, abs(sd))));
    }
    // glossy reflection of the environment, fog
    const R = reflect(V.negate(), vec3(0, 1, 0));
    col = col.add(skyCol(R).mul(fres).mul(0.08));
    const refl = mix(float(0.38), float(0.8), fres); // how much of the mirrored scene (drawn below) shows through
    const dist = length(cameraPosition.sub(P));
    const fog = clamp(float(1).sub(exp(dist.mul(0.055).mul(dist.mul(0.055)).negate())), 0, 1);
    const out = mix(tonemap(col), skyCol(V.negate()), fog);
    const a = mix(float(1).sub(refl), float(1), fog);
    return vec4(out.mul(1), a);
  })();
  const floorMesh = new Mesh(new PlaneGeometry(160, 160), floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.renderOrder = 1;
  scene.add(floorMesh);

  // ================================================================ phone
  const phone = new Group();
  scene.add(phone);
  const phoneMat = (mirror: boolean) => {
    const m = new MeshBasicNodeMaterial();
    m.fog = false;
    m.colorNode = Fn(() => {
      const P = positionWorld;
      const Nw = normalize(normalWorld);
      const V = normalize(cameraPosition.sub(P));
      const ndv = clamp(dot(Nw, V), 0, 1);
      const F = pow(float(1).sub(ndv), 5).mul(0.96).add(0.04);
      const R = reflect(V.negate(), Nw);
      const env = envCol(R);
      const nz = normalGeometry.z;
      // titanium frame (violet-tinted metal), black glass front, frosted violet back
      const metal = env.mul(vec3(0.6, 0.56, 0.74)).add(vec3(0.012, 0.01, 0.02));
      const front = vec3(0.003, 0.002, 0.006).add(env.mul(F).mul(0.9));
      const back = mix(vc(VIOLET, 0.08), vc(PINK, 0.06), positionGeometry.y.add(1).mul(0.5)).add(env.mul(F).mul(0.7));
      const c = select(nz.greaterThan(0.985), front, select(nz.lessThan(-0.985), back, metal));
      let out: N = applyFog(tonemap(c), P);
      if (mirror) out = out.mul(mirrorFade(P));
      return vec4(out, 1);
    })();
    return m;
  };
  let phoneGeo: BufferGeometry | null = null;
  let cardGeo: BufferGeometry | null = null;

  // screen (rounded rect, shows the featured screenshot)
  const shotNode: N = texture(new CanvasTexture(canvas(4, 4)[0]));
  const screenMat = (mirror: boolean) => {
    const m = new MeshBasicNodeMaterial({ transparent: !mirror });
    m.fog = false;
    m.depthWrite = true;
    m.outputNode = Fn(() => {
      const P = positionWorld;
      const lp = positionGeometry.xy; // local, screen centred
      const q = abs(lp).sub(vec2(SCREEN_W / 2 - SCREEN_R, SCREEN_H / 2 - SCREEN_R));
      const sd = length(max(q, vec2(0))).add(min(max(q.x, q.y), 0)).sub(SCREEN_R);
      const aa = fwidth(sd).mul(1.2);
      const mask = float(1).sub(ss(aa.negate(), aa, sd));
      // display space: portrait = local; landscape (phone rotated +90° about z) → right = -local y, up = local x
      const u0 = lp.x.div(SCREEN_W).add(0.5), v0 = lp.y.div(SCREEN_H).add(0.5);
      const du = mix(u0, float(1).sub(v0), uOrient), dv = mix(v0, u0, uOrient);
      const dispA = mix(float(SCREEN_W / SCREEN_H), float(SCREEN_H / SCREEN_W), uOrient);
      // contain fit
      const sx = max(dispA.div(uImgAspect), 1), sy = max(uImgAspect.div(dispA), 1);
      const iu = du.sub(0.5).mul(sx).add(0.5), iv = dv.sub(0.5).mul(sy).add(0.5);
      const inside = ss(0, 0.002, iu).mul(ss(1, 0.998, iu)).mul(ss(0, 0.002, iv)).mul(ss(1, 0.998, iv));
      const img = shotNode.sample(vec2(iu, iv)).rgb;
      const blur = shotNode.sample(vec2(du, dv)).level(6).rgb;
      // wallpaper while switching slides / before the screen wakes
      const wall = mix(vc(VIOLET, 0.55), vc(PINK, 0.6), ss(0.1, 0.95, du.add(dv.mul(0.6)).mul(0.7)))
        .mul(sin(du.mul(9).add(dv.mul(5)).add(uTime.mul(0.6))).mul(0.12).add(0.88));
      const shown = mix(blur.mul(0.32), img, inside);
      let c: N = mix(wall, shown, uScreenOn);
      // glass: faint env reflection + moving sheen (kept low for legibility)
      const Nw = normalize(normalWorld);
      const V = normalize(cameraPosition.sub(P));
      const F = pow(float(1).sub(clamp(dot(Nw, V), 0, 1)), 5).mul(0.9).add(0.02);
      const sheen = ss(0.06, 0.0, abs(du.add(dv.mul(0.55)).sub(uParallax.x.mul(0.25).add(0.95)))).mul(0.014);
      c = c.add(envCol(reflect(V.negate(), Nw)).mul(F).mul(0.08)).add(sheen);
      let out: N = applyFog(c, P, 0.03);
      if (mirror) out = out.mul(mirrorFade(P));
      return vec4(out, mirror ? float(1) : mask);
    })();
    if (mirror) m.alphaTestNode = float(0.5);
    return m;
  };
  const screen = new Mesh(new PlaneGeometry(SCREEN_W, SCREEN_H), screenMat(false));
  screen.position.z = 0.0505;
  screen.renderOrder = 2;
  phone.add(screen);

  // mirrored copies (reflection under the floor): matrices are set every frame
  const MIRROR = new Matrix4().makeScale(1, -1, 1);
  const mScreenGeo = new PlaneGeometry(SCREEN_W - 0.06, SCREEN_H - 0.06);
  const mirrorScreen = new Mesh(mScreenGeo, screenMat(true));
  mirrorScreen.matrixAutoUpdate = false;
  scene.add(mirrorScreen);
  let mirrorPhone: Mesh | null = null;
  let phoneBody: Mesh | null = null;

  // ================================================================ cards (instanced liquid glass)
  const atlas = buildAtlas();
  const atlasNode: N = texture(atlas);
  const cardMat = (mirror: boolean) => {
    const m = new MeshBasicNodeMaterial({ transparent: !mirror });
    m.fog = false;
    m.outputNode = Fn(() => {
      const P = positionWorld;
      const Nw = normalize(normalWorld);
      const V = normalize(cameraPosition.sub(P));
      const ndv = clamp(dot(Nw, V), 0, 1);
      const F = pow(float(1).sub(ndv), 5).mul(0.96).add(0.04);
      const R = reflect(V.negate(), Nw);
      const nz = normalGeometry.z;
      const edge = float(1).sub(ss(0.86, 0.995, abs(nz))); // bevel + rim
      const id = float(instanceIndex);
      const lu = positionGeometry.x.div(CARD_W).add(0.5), lv = positionGeometry.y.div(CARD_H).add(0.5);
      // per-card tint (violet → pink, each card nudged toward its brand colour)
      const hueK = id.div(4);
      const tint = mix(vc(VIOLET, 1), vc(PINK, 1), clamp(lu.mul(0.6).add(hueK.mul(0.5)).sub(0.1), 0, 1));
      let glass: N;
      if (!mirror) {
        // frosted backdrop: 9-tap disc of the framebuffer, refracted harder along the bevels
        const bdNode: N = viewportSharedTexture(screenUV);
        const off = normalView.xy.mul(edge.mul(0.06).add(0.012));
        const base = screenUV.add(vec2(off.x, off.y.negate()));
        const taps = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
        // chromatic split on the centre tap
        let acc2: N = vec3(0);
        for (const [x, y] of taps) acc2 = acc2.add(texture(bdNode.value, base.add(vec2(x * 0.0065, y * 0.0105))).rgb);
        const bd = acc2.div(taps.length);
        const disp = vec3(
          texture(bdNode.value, base.add(off.mul(0.35))).r,
          bd.g,
          texture(bdNode.value, base.sub(off.mul(0.35))).b,
        );
        const back = mix(bd, disp, edge);
        glass = back.mul(mix(vec3(1), tint, 0.32)).mul(0.82).add(tint.mul(0.055)).add(bdNode.rgb.mul(0.0001));
      } else {
        glass = tint.mul(0.16).add(envCol(R).mul(0.1));
      }
      // highlights: environment reflection (fresnel), bright rim on the bevels, soft top sheen
      const env = envCol(R);
      let c: N = glass.add(tonemap(env.mul(F.mul(0.9).add(edge.mul(0.35)))));
      c = c.add(vec3(1, 0.95, 1).mul(ss(0.55, 1.0, lv).mul(0.05)).mul(ss(0.9, 1, nz)));
      // face content (front only)
      const cell = vec2(id.mod(2), floor(id.div(2)));
      const auv = vec2(cell.x.add(lu).mul(CW / AT), float(1).sub(cell.y.add(float(1).sub(lv)).mul(CH / AT)));
      const art = atlasNode.sample(auv);
      const front = ss(0.97, 0.995, nz);
      c = mix(c, art.rgb.mul(1.05), art.a.mul(front).mul(0.96));
      let out: N = applyFog(c, P);
      if (mirror) out = out.mul(mirrorFade(P));
      return vec4(out, 1);
    })();
    return m;
  };
  let cards: InstancedMesh | null = null;
  let mirrorCards: InstancedMesh | null = null;

  // ================================================================ dynamic island pill
  const pillMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  pillMat.fog = false;
  const PAD = 0.28;
  pillMat.positionNode = Fn(() => vec3(positionGeometry.x.mul(uPillW.add(PAD)), positionGeometry.y.mul(uPillH.add(PAD)), 0))();
  pillMat.outputNode = Fn(() => {
    const p = vec2(positionGeometry.x.mul(uPillW.add(PAD)), positionGeometry.y.mul(uPillH.add(PAD)));
    const r = uPillH.mul(0.5);
    const q = abs(p).sub(vec2(uPillW.mul(0.5).sub(r), 0));
    const sd = length(max(q, vec2(0))).sub(r);
    const aa = fwidth(sd).mul(1.2);
    const shape = float(1).sub(ss(aa.negate(), aa, sd));
    // black glass body with a lit top rim
    const ny = p.y.div(r);
    let body: N = vec3(0.004, 0.003, 0.008).add(vc(VIOLET, 0.06).mul(ss(-1, 1, ny)));
    const rim = ss(0.03, 0.0, abs(sd.add(0.012))).mul(ss(-0.2, 0.9, ny));
    body = body.add(vec3(0.8, 0.75, 1).mul(rim).mul(0.55));
    // content (atlas strip, 1024×232 → aspect 4.41) fitted to the expanded pill
    const ch = uPillH.mul(0.96), cw = ch.mul(1024 / 232);
    const cu = p.x.div(cw).add(0.5), cv = p.y.div(ch).add(0.5);
    const inC = ss(0, 0.01, cu).mul(ss(1, 0.99, cu)).mul(ss(0, 0.02, cv)).mul(ss(1, 0.98, cv));
    const art = atlasNode.sample(vec2(cu.mul(CW / AT).add(PILL_X / AT), float(1).sub(float(PILL_Y).add(float(1).sub(cv).mul(232)).div(AT))));
    body = mix(body, art.rgb, art.a.mul(inC).mul(uPillContent));
    // outer glow
    const glow = exp(max(sd, 0).mul(-26)).mul(ss(PAD * 0.5, PAD * 0.2, sd)).mul(0.55).mul(float(1).sub(shape));
    const gcol = mix(vc(VIOLET, 1.2), vc(PINK, 1.1), ss(-0.8, 0.8, p.x));
    const a = shape.add(glow.mul(0.6)).mul(uPillOpacity);
    const col = mix(gcol, body, shape);
    return vec4(col, clamp(a, 0, 1));
  })();
  const pill = new Mesh(new PlaneGeometry(1, 1), pillMat);
  pill.renderOrder = 5;
  pill.frustumCulled = false;
  scene.add(pill);

  // ================================================================ dust / bokeh particles
  const NP = ctx.quality === 'high' ? 260 : 140;
  const dustMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  dustMat.fog = false;
  {
    const i = float(instanceIndex);
    const h1 = hash(i.add(1)), h2 = hash(i.add(17.3)), h3 = hash(i.add(41.7)), h4 = hash(i.add(77.1));
    const yy = fract(h2.add(uTime.mul(0.012).mul(h4.add(0.4)))).mul(6.5).add(0.05);
    const ang = h1.mul(Math.PI * 2).add(uTime.mul(0.03).mul(h3.sub(0.5)));
    const rad = h3.mul(7.5).add(1.2);
    dustMat.positionNode = vec3(cos(ang).mul(rad), yy, sin(ang).mul(rad).mul(0.8).sub(1.2));
    dustMat.scaleNode = h4.mul(h4).mul(0.045).add(0.012);
    dustMat.colorNode = Fn(() => {
      const d = length(uv().sub(0.5)).mul(2);
      const a = ss(1, 0.2, d).mul(h2.mul(0.5).add(0.25)).mul(sin(uTime.mul(h1.mul(2).add(0.5)).add(h3.mul(9))).mul(0.3).add(0.7));
      return vec4(mix(vc(VIOLET, 1.4), vc(PINK, 1.2), h1).mul(a), a);
    })();
  }
  const dust = new Sprite(dustMat);
  (dust as any).count = NP;
  dust.frustumCulled = false;
  dust.renderOrder = 6;
  scene.add(dust);

  // ================================================================ slides
  const slideTex: (Texture | null)[] = [];
  let slides: SlideImage[] = [];
  const loader = new TextureLoader();
  async function texFor(i: number): Promise<Texture> {
    if (slideTex[i]) return slideTex[i]!;
    const s = slides[i];
    let t: Texture;
    if (s.src.startsWith('gen:')) {
      t = new CanvasTexture(genSlide(s.kind === 'phone' ? 'phone' : 'desktop', i));
    } else {
      try { t = await loader.loadAsync(s.src); } catch { t = new CanvasTexture(genSlide(s.kind === 'phone' ? 'phone' : 'desktop', i)); }
    }
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.needsUpdate = true;
    slideTex[i] = t;
    return t;
  }
  const aspectOf = (i: number) => slides[i] ? slides[i].w / slides[i].h : 0.46;

  // ================================================================ loading
  const ready = (async () => {
    slides = ctx.slides && ctx.slides.length ? ctx.slides
      : (await loadManifest(`/projects/${ctx.project?.id ?? 'subara'}/manifest.json`)) ?? (await loadManifest('/projects/_placeholder/manifest.json'))
      ?? [
        { src: 'gen:0', w: 1179, h: 2556, kind: 'phone' },
        { src: 'gen:1', w: 2016, h: 1200, kind: 'desktop' },
        { src: 'gen:2', w: 1179, h: 2556, kind: 'phone' },
      ];
    const [gltf] = await Promise.all([new GLTFLoader().loadAsync('/worlds/subara/subara.glb'), ...slides.map((_, i) => texFor(i))]);
    gltf.scene.traverse((o: any) => {
      if (!o.isMesh) return;
      if (/card/i.test(o.name)) cardGeo = o.geometry;
      else if (!phoneGeo) phoneGeo = o.geometry;
    });
    if (!phoneGeo || !cardGeo) throw new Error('subara.glb: missing Phone/Card');
    phoneBody = new Mesh(phoneGeo, phoneMat(false));
    phone.add(phoneBody);
    mirrorPhone = new Mesh(phoneGeo, phoneMat(true));
    mirrorPhone.matrixAutoUpdate = false;
    scene.add(mirrorPhone);
    cards = new InstancedMesh(cardGeo, cardMat(false), SERVICES.length);
    cards.frustumCulled = false;
    cards.renderOrder = 4;
    scene.add(cards);
    mirrorCards = new InstancedMesh(cardGeo, cardMat(true), SERVICES.length);
    mirrorCards.instanceMatrix = cards.instanceMatrix;
    mirrorCards.frustumCulled = false;
    mirrorCards.scale.y = -1;
    scene.add(mirrorCards);
    showSlide(0, true);
  })();

  // ================================================================ slide switching (≤ 600 ms)
  let shown = -1, target = 0, switchT = 1, pendingSwap = false;
  let orientFrom = 0, orientTo = 0, orient = 0;
  function showSlide(i: number, immediate = false) {
    if (!slides.length) return;
    i = ((i % slides.length) + slides.length) % slides.length;
    target = i;
    if (immediate) {
      shown = i;
      const t = slideTex[i];
      if (t) shotNode.value = t;
      uImgAspect.value = aspectOf(i);
      orient = orientFrom = orientTo = aspectOf(i) > 1 ? 1 : 0;
      uOrient.value = orientTo;
      switchT = 1;
      return;
    }
    if (i === shown) return;
    orientFrom = orient;
    orientTo = aspectOf(i) > 1 ? 1 : 0;
    switchT = 0;
    pendingSwap = true;
  }
  const SWITCH = 0.56;

  // ================================================================ per-frame
  const q = new Quaternion(), e = new Euler(), v = new Vector3(), m4 = new Matrix4(), sc = new Vector3(1, 1, 1);
  const camPos = new Vector3(), camTgt = new Vector3();
  const holdPos = new Vector3(), holdTgt = new Vector3();
  const par = { x: 0, y: 0 };
  let lastT = 0;
  const flatQ = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
  const screenCorners: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  let quadOn = false;

  /** hold framing: the (rotated) screen spans NDC yt…yb vertically (visible band above the DOM panel is +1 … −0.44),
   *  camera level with no pitch so the screenshot is square-on; narrower viewports back off to fit the width */
  function holdPose(aspect: number, o: number, out: Vector3, tgt: Vector3) {
    const th = Math.tan((FOV * Math.PI) / 360);
    const dispH = lerp(SCREEN_H, SCREEN_W, o), dispW = lerp(SCREEN_W, SCREEN_H, o);
    const yt = lerp(0.7, 0.55, o), yb = lerp(-0.72, -0.44, o);
    const dV = dispH / ((yt - yb) * th);
    const dH = dispW / (1.7 * th * aspect);
    const d = Math.max(dV, dH);
    const camY = PHONE_C.y - ((yt + yb) / 2) * d * th;
    tgt.set(PHONE_C.x, camY, 0);
    out.set(PHONE_C.x, camY, d);
  }

  function update(f: StageFrame) {
    const dt = Math.min(f.dt, 0.1);
    const time = f.time;
    uTime.value = time;
    const t = Math.min(1.08, Math.max(-0.05, f.t));
    lastT = t;
    if (camera.aspect !== f.aspect && f.aspect > 0) { camera.aspect = f.aspect; camera.updateProjectionMatrix(); }
    par.x = damp(par.x, f.parallax.x, 4, dt);
    par.y = damp(par.y, f.parallax.y, 4, dt);
    (uParallax.value as Vector3).set(par.x, par.y, 0);

    // ---- slide switching
    if (slides.length && f.slide !== target && ((f.slide % slides.length) + slides.length) % slides.length !== target) showSlide(f.slide);
    if (switchT < 1) {
      switchT = Math.min(1, switchT + dt / SWITCH);
      if (pendingSwap && switchT >= 0.42) {
        pendingSwap = false;
        shown = target;
        const tx = slideTex[shown];
        if (tx) shotNode.value = tx;
        uImgAspect.value = aspectOf(shown);
        uOrient.value = orientTo;
      }
      orient = lerp(orientFrom, orientTo, ease(sstep(0.12, 0.8, switchT)));
    }
    const switchDim = switchT < 1 ? 1 - Math.min(sstep(0.0, 0.3, switchT) * (1 - sstep(0.58, 0.95, switchT)), 1) : 1;

    // ---- phases
    const arrive = sstep(0, 0.22, t);
    const rise = ease(sstep(0.02, 0.19, t));
    const depart = clamp01((t - 0.82) / 0.18);
    const holdK = clamp01((t - 0.22) / 0.6);

    // screen wakes during the rise
    uScreenOn.value = sstep(0.1, 0.2, t) * switchDim;

    // ---- phone
    const bob = Math.sin(time * 0.7) * 0.025 * rise;
    phone.position.set(PHONE_C.x, lerp(0.075, PHONE_C.y, rise) + bob, lerp(0.35, PHONE_C.z, rise));
    e.set(lerp(-Math.PI / 2, 0, rise) + Math.sin(time * 0.5) * 0.012 * rise, Math.sin(time * 0.37) * 0.03 * rise + par.x * 0.05 * rise,
      (orient * Math.PI) / 2 + Math.sin(time * 0.43) * 0.008);
    phone.quaternion.setFromEuler(e);
    phone.updateMatrixWorld(true);
    if (mirrorPhone && phoneBody) {
      mirrorPhone.matrix.multiplyMatrices(MIRROR, phoneBody.matrixWorld);
      mirrorPhone.matrixWorld.copy(mirrorPhone.matrix);
    }
    mirrorScreen.matrix.multiplyMatrices(MIRROR, screen.matrixWorld);
    mirrorScreen.matrixWorld.copy(mirrorScreen.matrix);

    // ---- cards: lift off the floor into a tilted orbit (front arc dips below the phone)
    if (cards) {
      const n = SERVICES.length;
      const spin = time * 0.07 + t * 1.6 + depart * depart * 2.5;
      const ra = lerp(2.05, 2.05, 0) * (1 + depart * depart * 1.6), rb = 1.55 * (1 + depart * depart * 1.6);
      for (let i = 0; i < n; i++) {
        const a = spin + (i / n) * Math.PI * 2 + 0.6;
        const li = ease(sstep(0.03 + i * 0.022, 0.17 + i * 0.012, t));
        const ox = Math.sin(a) * ra, oz = Math.cos(a) * rb;
        const oy = PHONE_C.y - (oz / rb) * 0.95 + Math.sin(time * 0.8 + i * 1.3) * 0.05 + depart * depart * (1.4 + i * 0.3);
        const orbit = v.set(ox, oy, oz);
        // floor fan around the lying phone
        const fa = (i / n) * Math.PI * 2 + 0.6;
        const floorP = new Vector3(Math.sin(fa) * 2.3, 0.03, Math.cos(fa) * 1.7 + 0.35);
        const pos = floorP.lerp(orbit, li);
        // orientation: face the camera side, swaying with the orbit
        const yaw = Math.sin(a) * 0.55 + Math.sin(time * 0.6 + i) * 0.05;
        const pitch = -0.12 + (oz / rb) * 0.18 + Math.sin(time * 0.5 + i * 2.1) * 0.04;
        const roll = Math.sin(a * 0.5 + i) * 0.12;
        const oq = new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ'));
        const fq = flatQ.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), fa * 0.35 - 0.5));
        q.slerpQuaternions(fq, oq, li);
        const s = 0.84 * lerp(0.92, 1, li);
        sc.set(s, s, s);
        m4.compose(pos, q, sc);
        cards.setMatrixAt(i, m4);
        (cardPos[i].value as Vector3).copy(pos);
      }
      cards.instanceMatrix.needsUpdate = true;
    }
    dotPulse.value = 0.4 + 0.4 * Math.sin(time * 3.2);

    // ---- pill: expands at the end of the arrive, collapses on depart
    const pillIn = sstep(0.12, 0.17, t) * (1 - sstep(0.86, 0.93, t));
    const expand = ease(sstep(0.16, 0.24, t)) * (1 - ease(sstep(0.83, 0.88, t)));
    uPillOpacity.value = pillIn;
    uPillW.value = lerp(0.42, lerp(1.62, 1.1, orient), expand);
    uPillH.value = lerp(0.18, lerp(0.3, 0.22, orient), expand);
    uPillContent.value = sstep(0.2, 0.26, t) * (1 - sstep(0.82, 0.85, t));
    // anchored above the phone's top edge (in world up), floating toward the camera
    const topY = phone.position.y + lerp(1.03, 0.5, orient);
    pill.position.set(0, topY + lerp(0.02, 0.07 + uPillH.value * 0.5, orient) + Math.sin(time * 0.9) * 0.015 + depart * 0.6, 0.2);

    // ---- camera
    holdPose(camera.aspect, orient, holdPos, holdTgt);
    // slow hold drift: dolly in 4%, slight orbit
    const drift = Math.sin(holdK * Math.PI);
    const yaw = (holdK - 0.5) * 0.08 + Math.sin(time * 0.13) * 0.012;
    v.copy(holdPos).sub(holdTgt).multiplyScalar(1.03 - 0.05 * holdK).applyAxisAngle(new Vector3(0, 1, 0), yaw);
    holdPos.copy(holdTgt).add(v);
    holdPos.y += drift * 0.04 + Math.sin(time * 0.21) * 0.015;
    // arrive: top-down over the month → swoop to the hold framing (cubic bezier)
    const a0 = new Vector3(-1.6, 9.2, 5.2), a1 = new Vector3(-3.6, 4.2, 8.6), a2 = new Vector3(holdPos.x - 1.2, holdPos.y + 0.9, holdPos.z + 2.0);
    const k = ease(arrive * 0.92 + 0.08 * arrive * arrive);
    const k1 = 1 - k;
    camPos.set(0, 0, 0)
      .addScaledVector(a0, k1 * k1 * k1).addScaledVector(a1, 3 * k1 * k1 * k).addScaledVector(a2, 3 * k1 * k * k).addScaledVector(holdPos, k * k * k);
    camTgt.lerpVectors(new Vector3(0, 0, 0.1), holdTgt, ease(sstep(0.02, 0.22, t)));
    // depart: push into the screen
    if (depart > 0) {
      const dk = ease(depart);
      const sc0 = new Vector3(0, 0, 0.06).applyMatrix4(phone.matrixWorld);
      const into = sc0.clone().add(new Vector3(0, 0, 0.12));
      camPos.lerp(into, dk * (0.55 + 0.45 * dk));
      camTgt.lerp(sc0, sstep(0, 0.6, depart));
    }
    // pointer parallax (fades out as the camera enters the screen)
    const pk = (0.35 + 0.65 * rise) * (1 - depart);
    camPos.x += par.x * 0.32 * pk;
    camPos.y += -par.y * 0.16 * pk;
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(camTgt);
    camera.updateMatrixWorld();

    // portal quad: the phone screen during depart
    quadOn = t > 0.8;
    if (quadOn) {
      const hw = SCREEN_W / 2 - 0.02, hh = SCREEN_H / 2 - 0.02;
      const cs = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]];
      for (let i = 0; i < 4; i++) screenCorners[i].set(cs[i][0], cs[i][1], 0).applyMatrix4(screen.matrixWorld);
    }
  }

  function portalQuad(): [number, number][] | null {
    if (!quadOn) return null;
    camera.updateMatrixWorld();
    const out: [number, number][] = [];
    const p4 = new Vector4();
    for (const c of screenCorners) {
      p4.set(c.x, c.y, c.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      if (p4.w <= 1e-3) return [[-1, 1], [1, 1], [1, -1], [-1, -1]];
      out.push([p4.x / p4.w, p4.y / p4.w]);
    }
    // landscape: rotate the corner order so it stays TL,TR,BR,BL on screen
    if (orient > 0.5) out.push(out.shift()!);
    return out;
  }

  return {
    id: 'subara',
    scene,
    camera,
    background: BG,
    ready,
    update,
    portalQuad,
    dispose() {
      scene.traverse((o: any) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      atlas.dispose(); calTex.dispose();
      slideTex.forEach((t) => t?.dispose());
    },
    // debug hooks for the test page
    ...({ _debug: () => ({ t: lastT, shown, orient }) } as any),
  };
}
