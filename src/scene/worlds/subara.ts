/**
 * Subara world (in-app name "SubZilla"): liquid-glass subscription cards for real services (Netflix, Spotify, …)
 * orbiting a giant phone that floats over a reflective payment calendar. The phone wakes from a lock screen
 * (clock + SubZilla lock-screen widget + a renewal notification), then shows the featured real screenshot.
 * Floating liquid-glass panels show the real App Store screenshots, a Dynamic-Island live activity reads
 * "Renews in 2 days", and iOS-style notification banners drop in one after another during the hold.
 * Violet #5b3df5 → pink #ff8fc7. Brand marks are drawn procedurally (no logo files).
 *
 * Timing (local t):  arrive 0 → .22  phone lies face-up on the calendar showing its lock screen, rises upright while
 *                                    the camera swoops down from a top-down view; cards lift into orbit; island expands
 *                    hold   .22 → .82 calm framing of the screen (legible), glass panels + widget float around it,
 *                                    banners drop in at .25 / .40 / .55 and stack iOS-style
 *                    depart .82 → 1   banners lift away, island collapses, cards spiral out, camera pushes into the screen
 *
 * Output convention: linear colour, already tone-mapped (≤ 1), into the stage render target.
 * Draws: sky, floor, phone, screen, island, cards (instanced), dust, mirrored phone/screen/cards,
 *        3 screenshot panels, widget, 3 banners = 17.
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
  fract, floor, abs, reflect, uv, instanceIndex, hash, fwidth, viewportSharedTexture, select,
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
const CARD_S = 0.6; // card scale in orbit
const CELL = 0.95; // calendar cell (world units)
const FOV = 30;
const TH = Math.tan((FOV * Math.PI) / 360);
const TODAY = 12; // calendar "today": Thursday, Nov 12 2026 → Netflix renews tomorrow, Spotify in 2 days
const YEAR = 2026, MONTH = 10; // November

type Badge = 'netflix' | 'spotify' | 'youtube' | 'icloud' | 'chatgpt' | 'disney' | 'applemusic' | 'xbox' | 'adobe' | 'duolingo';
type Service = { name: string; price: string; day: number; color: string; badge: Badge; plan: string };
const SERVICES: Service[] = [
  { name: 'Netflix', price: '$15.49', day: 13, color: '#e50914', badge: 'netflix', plan: 'Standard · monthly' },
  { name: 'Spotify', price: '$11.99', day: 14, color: '#1ed760', badge: 'spotify', plan: 'Premium · trial' },
  { name: 'YouTube Premium', price: '$13.99', day: 18, color: '#ff0033', badge: 'youtube', plan: 'Individual · monthly' },
  { name: 'iCloud+', price: '$2.99', day: 3, color: '#3e9bff', badge: 'icloud', plan: '200 GB · monthly' },
  { name: 'ChatGPT Plus', price: '$20.00', day: 21, color: '#10a37f', badge: 'chatgpt', plan: 'Plus · monthly' },
  { name: 'Disney+', price: '$9.99', day: 9, color: '#1f4fe0', badge: 'disney', plan: 'Standard · monthly' },
  { name: 'Apple Music', price: '$10.99', day: 25, color: '#fa2d48', badge: 'applemusic', plan: 'Individual · monthly' },
  { name: 'Xbox Game Pass', price: '$19.99', day: 6, color: '#107c10', badge: 'xbox', plan: 'Ultimate · monthly' },
  { name: 'Adobe Creative Cloud', price: '$59.99', day: 27, color: '#da1f26', badge: 'adobe', plan: 'All Apps · monthly' },
  { name: 'Duolingo', price: '$12.99', day: 17, color: '#58cc02', badge: 'duolingo', plan: 'Super · monthly' },
];
const NEXT = 0; // Netflix renews tomorrow (pulsing ring on the floor)
const ISLAND = 1; // Spotify: the Dynamic Island live activity

// ------------------------------------------------------------------ small math helpers
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (x: number) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const easeOutBack = (x: number) => { x = clamp01(x); const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
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
/** text that shrinks to fit maxW */
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, weight: number, size: number) {
  let s = size;
  g.font = `${weight} ${s}px ${SANS}`;
  while (g.measureText(text).width > maxW && s > 10) { s -= 1; g.font = `${weight} ${s}px ${SANS}`; }
  g.fillText(text, x, y);
}

/** brand badges, drawn from simple shapes (no logo files) */
function badge(g: CanvasRenderingContext2D, kind: Badge, x: number, y: number, size: number) {
  const s = size;
  g.save();
  g.translate(x, y);
  rrect(g, 0, 0, s, s, s * 0.24);
  g.clip();
  const fill = (c: string | CanvasGradient) => { g.fillStyle = c; g.fillRect(0, 0, s, s); };
  const lin = (a: string, b: string) => { const gr = g.createLinearGradient(0, 0, s, s); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
  const cx = s / 2, cy = s / 2;
  g.lineCap = 'round'; g.lineJoin = 'round';
  switch (kind) {
    case 'netflix': {
      fill('#0b0b0b');
      const w = s * 0.14, h = s * 0.62, x0 = cx - s * 0.2, y0 = cy - h / 2;
      g.fillStyle = '#b1060f'; g.fillRect(x0, y0, w, h); g.fillRect(x0 + s * 0.4 - w, y0, w, h);
      g.fillStyle = '#e50914';
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + w, y0); g.lineTo(x0 + s * 0.4, y0 + h); g.lineTo(x0 + s * 0.4 - w, y0 + h); g.closePath(); g.fill();
      break;
    }
    case 'spotify': {
      fill('#121212');
      g.fillStyle = '#1ed760'; g.beginPath(); g.arc(cx, cy, s * 0.36, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#121212';
      [[0.1, 0.085, 0.24], [0.0, 0.07, 0.2], [-0.09, 0.055, 0.16]].forEach(([dy, lw, rw]) => {
        g.lineWidth = s * lw;
        g.beginPath(); g.moveTo(cx - s * rw, cy - s * dy - s * 0.02); g.quadraticCurveTo(cx, cy - s * dy - s * 0.09, cx + s * rw, cy - s * dy + s * 0.03); g.stroke();
      });
      break;
    }
    case 'youtube': {
      fill('#ffffff');
      g.fillStyle = '#ff0033'; rrect(g, s * 0.14, s * 0.28, s * 0.72, s * 0.44, s * 0.13); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cx - s * 0.08, cy - s * 0.11); g.lineTo(cx + s * 0.13, cy); g.lineTo(cx - s * 0.08, cy + s * 0.11); g.closePath(); g.fill();
      break;
    }
    case 'icloud': {
      fill(lin('#5ab8ff', '#1f6fe6'));
      g.fillStyle = '#fff'; g.beginPath();
      g.arc(cx - s * 0.17, cy + s * 0.06, s * 0.15, Math.PI * 0.5, Math.PI * 1.5);
      g.arc(cx + s * 0.0, cy - s * 0.06, s * 0.2, Math.PI * 1.05, Math.PI * 1.95);
      g.arc(cx + s * 0.19, cy + s * 0.07, s * 0.14, Math.PI * 1.5, Math.PI * 0.5);
      g.closePath(); g.fill();
      break;
    }
    case 'chatgpt': {
      fill('#0d0d0d');
      g.strokeStyle = '#fff'; g.lineWidth = s * 0.055;
      for (let k = 0; k < 6; k++) {
        g.save(); g.translate(cx, cy); g.rotate((k * Math.PI) / 3);
        rrect(g, -s * 0.09, -s * 0.3, s * 0.18, s * 0.3, s * 0.09); g.stroke();
        g.restore();
      }
      break;
    }
    case 'disney': {
      fill(lin('#0b1d6b', '#1f4fe0'));
      g.fillStyle = '#fff'; g.font = `italic 800 ${s * 0.46}px Georgia, "Times New Roman", serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('D', cx - s * 0.08, cy + s * 0.03);
      g.font = `700 ${s * 0.34}px ${SANS}`; g.fillText('+', cx + s * 0.2, cy - s * 0.02);
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = s * 0.025; g.beginPath(); g.arc(cx, cy + s * 0.12, s * 0.33, Math.PI * 1.12, Math.PI * 1.9); g.stroke();
      break;
    }
    case 'applemusic': {
      fill(lin('#fc5c7d', '#fa233b'));
      g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = s * 0.06;
      g.beginPath(); g.moveTo(cx - s * 0.1, cy + s * 0.16); g.lineTo(cx - s * 0.1, cy - s * 0.2); g.lineTo(cx + s * 0.18, cy - s * 0.26); g.lineTo(cx + s * 0.18, cy + s * 0.1); g.stroke();
      g.beginPath(); g.ellipse(cx - s * 0.16, cy + s * 0.17, s * 0.09, s * 0.07, -0.3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(cx + s * 0.12, cy + s * 0.11, s * 0.09, s * 0.07, -0.3, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'xbox': {
      fill(lin('#1a9e1a', '#0b5c0b'));
      g.strokeStyle = '#fff'; g.lineWidth = s * 0.07;
      g.beginPath(); g.arc(cx, cy, s * 0.3, 0, Math.PI * 2); g.stroke();
      g.lineWidth = s * 0.08;
      g.beginPath(); g.moveTo(cx - s * 0.16, cy - s * 0.16); g.quadraticCurveTo(cx, cy, cx + s * 0.16, cy + s * 0.2); g.stroke();
      g.beginPath(); g.moveTo(cx + s * 0.16, cy - s * 0.16); g.quadraticCurveTo(cx, cy, cx - s * 0.16, cy + s * 0.2); g.stroke();
      break;
    }
    case 'adobe': {
      fill(lin('#ff3b3b', '#b0101a'));
      g.fillStyle = '#fff'; g.font = `800 ${s * 0.44}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('Cc', cx, cy + s * 0.02);
      break;
    }
    case 'duolingo': {
      fill('#58cc02');
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(cx - s * 0.13, cy - s * 0.04, s * 0.13, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(cx + s * 0.13, cy - s * 0.04, s * 0.13, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1b1b1b';
      g.beginPath(); g.arc(cx - s * 0.1, cy - s * 0.03, s * 0.06, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(cx + s * 0.1, cy - s * 0.03, s * 0.06, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ff9600'; g.beginPath(); g.moveTo(cx - s * 0.07, cy + s * 0.1); g.lineTo(cx + s * 0.07, cy + s * 0.1); g.lineTo(cx, cy + s * 0.2); g.closePath(); g.fill();
      break;
    }
  }
  g.restore();
}
/** SubZilla app icon (violet card with a check), after the App Store listing */
function appIconSZ(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save(); g.translate(x, y);
  const gr = g.createLinearGradient(0, 0, s, s); gr.addColorStop(0, '#7b6cff'); gr.addColorStop(1, '#4a2fd8');
  rrect(g, 0, 0, s, s, s * 0.24); g.fillStyle = gr; g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = s * 0.065; g.lineCap = 'round'; g.lineJoin = 'round';
  rrect(g, s * 0.2, s * 0.24, s * 0.6, s * 0.46, s * 0.07); g.stroke();
  g.beginPath(); g.moveTo(s * 0.2, s * 0.38); g.lineTo(s * 0.8, s * 0.38); g.stroke();
  g.lineWidth = s * 0.08;
  g.beginPath(); g.moveTo(s * 0.48, s * 0.66); g.lineTo(s * 0.6, s * 0.77); g.lineTo(s * 0.84, s * 0.52); g.stroke();
  g.restore();
}
function dayLabel(day: number) {
  const d = new Date(YEAR, MONTH, day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function whenLabel(day: number) {
  const left = day - TODAY;
  if (left === 0) return 'Today';
  if (left === 1) return 'Tomorrow';
  if (left > 1 && left <= 3) return `in ${left} days`;
  return dayLabel(day);
}
function ring(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, lw: number, k: number) {
  g.lineWidth = lw; g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  const gr = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r); gr.addColorStop(0, '#ff8fc7'); gr.addColorStop(1, '#8f74ff');
  g.strokeStyle = gr; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); g.stroke();
}

/** card atlas: 10 card faces in a 4×3 grid of 512×324 cells */
const CAT_W = 2048, CAT_H = 1024, CW = 512, CH = 324;
function buildCardAtlas() {
  const [c, g] = canvas(CAT_W, CAT_H);
  g.clearRect(0, 0, CAT_W, CAT_H);
  SERVICES.forEach((s, i) => {
    const x = (i % 4) * CW, y = Math.floor(i / 4) * CH;
    g.save(); g.translate(x, y);
    const bc = new Color(s.color);
    const rgb = `${(bc.r * 255) | 0},${(bc.g * 255) | 0},${(bc.b * 255) | 0}`;
    const wash = g.createRadialGradient(40, 30, 10, 60, 60, 420);
    wash.addColorStop(0, `rgba(${rgb},0.5)`);
    wash.addColorStop(1, `rgba(${rgb},0)`);
    rrect(g, 0, 0, CW, CH, 40); g.fillStyle = wash; g.fill();
    badge(g, s.badge, 26, 24, 86);
    g.fillStyle = '#fff'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    fitText(g, s.name, 128, 62, CW - 128 - 24, 700, 38);
    g.fillStyle = 'rgba(255,255,255,0.72)'; g.font = `500 22px ${SANS}`; g.fillText(s.plan, 129, 96);
    g.fillStyle = '#fff'; g.font = `800 72px ${SANS}`; g.fillText(s.price, 24, 290);
    const pw = g.measureText(s.price).width;
    g.font = `600 24px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText('/mo', 30 + pw, 290);
    const left = s.day - TODAY;
    const soon = left > 0 && left <= 3;
    const chip = whenLabel(s.day);
    g.font = `700 22px ${SANS}`;
    const cw = g.measureText(chip).width + 32;
    rrect(g, CW - 24 - cw, 172, cw, 40, 20);
    g.fillStyle = soon ? 'rgba(255,143,199,0.95)' : 'rgba(255,255,255,0.18)'; g.fill();
    g.fillStyle = soon ? '#2a0b3a' : '#fff'; g.fillText(chip, CW - 24 - cw + 16, 199);
    g.restore();
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** UI atlas (2048²): island content, 3 notification banners, the floating widget and the lock-screen overlay */
const UI = 2048;
type Rect = [number, number, number, number];
const R_PILL: Rect = [0, 0, 1024, 232];
const R_BAN = (i: number): Rect => [1024, i * 248, 1024, 232];
const R_WIDGET: Rect = [0, 256, 1024, 480];
const R_LOCK: Rect = [0, 768, 576, 1254];
type Banner = { icon: Badge | null; title: string; body: string };
const BANNERS: Banner[] = [
  { icon: 'netflix', title: 'Netflix renews tomorrow', body: '$15.49 · Standard plan, Nov 13' },
  { icon: 'spotify', title: 'Spotify trial ends in 2 days', body: 'Then $11.99/mo · cancel anytime' },
  { icon: null, title: 'You spent $142 this month', body: '10 active · 3 renew this week' },
];
function buildUIAtlas() {
  const [c, g] = canvas(UI, UI);
  g.clearRect(0, 0, UI, UI);
  g.textBaseline = 'alphabetic';
  // ---- island live activity: Spotify · Renews in 2 days · ring
  {
    const s = SERVICES[ISLAND];
    g.save(); g.translate(R_PILL[0], R_PILL[1]);
    badge(g, s.badge, 40, 46, 140);
    g.fillStyle = 'rgba(255,255,255,0.62)'; g.font = `600 44px ${SANS}`; g.fillText(`${s.name} · ${s.price}`, 214, 98);
    g.fillStyle = '#fff'; g.font = `700 70px ${SANS}`; g.fillText('Renews in 2 days', 212, 176);
    ring(g, 1024 - 110, 116, 56, 16, 0.72);
    g.fillStyle = '#fff'; g.font = `800 50px ${SANS}`; g.textAlign = 'center'; g.fillText('2', 1024 - 110, 134);
    g.restore();
  }
  // ---- notification banners (content only; the glass is drawn in the shader)
  BANNERS.forEach((b, i) => {
    const [x, y] = R_BAN(i);
    g.save(); g.translate(x, y); g.textAlign = 'left';
    if (b.icon) {
      badge(g, b.icon, 38, 40, 150);
      g.save(); g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 10;
      appIconSZ(g, 128, 130, 70); g.restore();
    } else appIconSZ(g, 38, 40, 150);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = `600 30px ${SANS}`; g.fillText('SUBZILLA', 236, 82);
    g.textAlign = 'right'; g.fillText(i === 2 ? '1m ago' : 'now', 1024 - 44, 82); g.textAlign = 'left';
    g.fillStyle = '#fff'; fitText(g, b.title, 234, 140, 1024 - 234 - 40, 700, 52);
    g.fillStyle = 'rgba(255,255,255,0.78)'; fitText(g, b.body, 235, 192, 1024 - 235 - 40, 500, 40);
    g.restore();
  });
  // ---- floating widget: this month ring + next up list
  {
    const [x, y] = R_WIDGET;
    g.save(); g.translate(x, y); g.textAlign = 'left';
    appIconSZ(g, 44, 38, 54);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = `700 32px ${SANS}`; g.fillText('SubZilla', 112, 76);
    ring(g, 200, 290, 118, 26, 0.78);
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `800 66px ${SANS}`; g.fillText('$142', 200, 300);
    g.fillStyle = 'rgba(255,255,255,0.65)'; g.font = `600 26px ${SANS}`; g.fillText('this month', 200, 342);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = `700 26px ${SANS}`; g.fillText('NEXT UP', 392, 76);
    const rows: [number, string][] = [[0, 'Tomorrow'], [1, 'Sat, Nov 14'], [9, 'Tue, Nov 17']];
    rows.forEach(([si, when], k) => {
      const s = SERVICES[si], ry = 112 + k * 116;
      badge(g, s.badge, 392, ry, 84);
      g.fillStyle = '#fff'; g.font = `700 36px ${SANS}`; g.fillText(s.name, 494, ry + 40);
      g.fillStyle = k === 0 ? '#ff8fc7' : 'rgba(255,255,255,0.62)'; g.font = `600 26px ${SANS}`; g.fillText(when, 495, ry + 76);
      g.fillStyle = '#fff'; g.font = `700 36px ${SANS}`; g.textAlign = 'right'; g.fillText(s.price, 990, ry + 56); g.textAlign = 'left';
    });
    g.restore();
  }
  // ---- lock screen overlay (portrait phone screen, 576×1254)
  {
    const [x, y, w] = R_LOCK;
    g.save(); g.translate(x, y);
    g.fillStyle = '#fff'; g.font = `600 22px ${SANS}`; g.textAlign = 'left'; g.fillText('SubZilla', 40, 56);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = `600 30px ${SANS}`; g.fillText('Thursday, November 12', w / 2, 150);
    g.fillStyle = '#fff'; g.font = `700 190px ${SANS}`; g.fillText('9:41', w / 2, 330);
    // lock-screen widgets: circular gauge + rectangular next renewal
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.arc(122, 440, 62, 0, Math.PI * 2); g.fill();
    g.lineCap = 'round'; g.lineWidth = 9; g.strokeStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.arc(122, 440, 48, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
    g.strokeStyle = '#fff'; g.beginPath(); g.arc(122, 440, 48, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * 0.78)); g.stroke();
    g.fillStyle = '#fff'; g.font = `800 30px ${SANS}`; g.fillText('$142', 122, 452);
    rrect(g, 202, 378, 334, 124, 30); g.fillStyle = 'rgba(255,255,255,0.16)'; g.fill();
    g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `700 20px ${SANS}`; g.fillText('NEXT RENEWAL', 226, 418);
    g.fillStyle = '#fff'; g.font = `800 32px ${SANS}`; g.fillText('Netflix', 226, 456);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = `600 24px ${SANS}`; g.fillText('Tomorrow · $15.49', 226, 488);
    // notification on the lock screen
    rrect(g, 28, 860, w - 56, 132, 32); g.fillStyle = 'rgba(30,18,60,0.55)'; g.fill();
    badge(g, 'netflix', 50, 884, 84);
    appIconSZ(g, 104, 938, 38);
    g.fillStyle = '#fff'; g.font = `700 28px ${SANS}`; g.fillText('Netflix renews tomorrow', 154, 918);
    g.fillStyle = 'rgba(255,255,255,0.78)'; g.font = `500 24px ${SANS}`; g.fillText('$15.49 · Standard plan', 154, 954);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = `500 20px ${SANS}`; g.textAlign = 'right'; g.fillText('now', w - 50, 902);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath(); g.arc(96, 1140, 46, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(w - 96, 1140, 46, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; rrect(g, w / 2 - 90, 1222, 180, 9, 5); g.fill();
    g.restore();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  return t;
}
/** uv into an atlas region; lu/lv are 0..1 with lv = 1 at the top of the region (canvas textures are flipY) */
const regionUV = (r: Rect, aw: number, ah: number, lu: N, lv: N): N =>
  vec2(lu.mul(r[2] / aw).add(r[0] / aw), float(1).sub(float(1).sub(lv).mul(r[3] / ah).add(r[1] / ah)));

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
  const list = SERVICES.slice(0, phone ? 6 : 5);
  if (phone) {
    g.fillStyle = '#16122a'; g.font = `600 44px ${SANS}`; g.fillText('9:41', 110, 110);
    g.font = `800 96px ${SANS}`; g.fillText(seed % 2 ? 'Calendar' : 'SubZilla', 72, 330);
    const gr = g.createLinearGradient(72, 400, W - 72, 760); gr.addColorStop(0, '#5b3df5'); gr.addColorStop(1, '#ff8fc7');
    rrect(g, 72, 400, W - 144, 380, 56); g.fillStyle = gr; g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = `600 46px ${SANS}`; g.fillText('This month', 128, 490);
    g.fillStyle = '#fff'; g.font = `800 150px ${SANS}`; g.fillText('$142.36', 124, 660);
    g.font = `600 42px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText('10 active · next: Netflix tomorrow', 128, 735);
    list.forEach((s, i) => {
      const y = 860 + i * 230;
      rrect(g, 72, y, W - 144, 200, 44); g.fillStyle = '#fff'; g.fill();
      badge(g, s.badge, 110, y + 36, 128);
      g.fillStyle = '#16122a'; g.font = `700 56px ${SANS}`; g.fillText(s.name, 280, y + 92);
      g.fillStyle = '#6f6888'; g.font = `500 42px ${SANS}`; g.fillText(`Renews ${dayLabel(s.day)}`, 280, y + 150);
      g.fillStyle = '#16122a'; g.font = `700 58px ${SANS}`; g.textAlign = 'right'; g.fillText(s.price, W - 120, y + 120); g.textAlign = 'left';
    });
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
    list.forEach((s, i) => {
      const y = 300 + i * 150;
      rrect(g, 1380, y, 540, 128, 32); g.fillStyle = '#fff'; g.fill();
      badge(g, s.badge, 1404, y + 20, 88);
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
  const left = ss(0.35, 0.92, d.x.negate()).mul(ss(-0.45, 0.25, d.y)).mul(ss(-0.6, 0.1, d.z));
  const right = ss(0.35, 0.92, d.x).mul(ss(-0.45, 0.25, d.y));
  const strip = ss(0.985, 1.0, abs(d.x.mul(0.6).add(d.y.mul(0.8)))).mul(1.2);
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
  const behind = ss(-0.2, -1.0, d.z);
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
/** frosted backdrop: 9-tap disc of the framebuffer behind a transparent surface */
const frost = (base: N, rx: number, ry: number): { bd: N; node: N } => {
  const node: N = viewportSharedTexture(screenUV);
  const taps = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
  let acc: N = vec3(0);
  for (const [x, y] of taps) acc = acc.add(texture(node.value, base.add(vec2(x * rx, y * ry))).rgb);
  return { bd: acc.div(taps.length), node };
};
/** signed distance to a rounded rect centred at 0 with half extents (hx, hy) and radius r */
const sdRound = (p: N, hx: N, hy: N, r: N): N => {
  const q = abs(p).sub(vec2(hx, hy)).add(r);
  return length(max(q, vec2(0))).add(min(max(q.x, q.y), 0)).sub(r);
};

export function createWorld(ctx: ProjectWorldContext): Stage {
  const scene = new Scene();
  scene.background = BG;
  const camera = new PerspectiveCamera(FOV, 16 / 10, 0.05, 120);
  camera.position.set(0, 2, 6);

  const uTime = uniform(0);
  const uScreenOn = uniform(0); // 0 → wallpaper / lock screen, 1 → screenshot
  const uLock = uniform(1); // lock-screen overlay on the wallpaper
  const uImgAspect = uniform(0.46);
  const uOrient = uniform(0); // 0 portrait, 1 landscape (screen content space)
  const uPillW = uniform(0.4), uPillH = uniform(0.34), uPillContent = uniform(0), uPillOpacity = uniform(0);
  const uParallax = uniform(new Vector3());
  const cardPos = SERVICES.map(() => uniform(new Vector3(0, -10, 0)));
  const dotPulse = uniform(0);

  const cardAtlas = buildCardAtlas();
  const cardNode: N = texture(cardAtlas);
  const uiTex = buildUIAtlas();
  const uiNode: N = texture(uiTex);

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
  const calZ0 = -4.5 * CELL;
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
    const cu = P.x.add(calW / 2).div(calW);
    const cv = float(1).sub(P.z.sub(calZ0).div(calD));
    const inCal = ss(0, 0.004, cu).mul(ss(1, 0.996, cu)).mul(ss(0, 0.004, cv)).mul(ss(1, 0.996, cv));
    const cal = texture(calTex, vec2(cu, cv)).r.mul(inCal);
    const gq = abs(fract(P.xz.div(CELL)).sub(0.5));
    const gw = fwidth(P.xz.div(CELL)).mul(1.2);
    const lx = float(1).sub(ss(float(0), gw.x, float(0.5).sub(gq.x)));
    const ly = float(1).sub(ss(float(0), gw.y, float(0.5).sub(gq.y)));
    const gridLine = max(lx, ly).mul(0.07).mul(float(1).sub(inCal));
    const r = length(P.xz.sub(vec2(0, 0.2)));
    let col: N = vec3(0.012, 0.008, 0.026).add(mix(vc(VIOLET, 0.18), vc(PINK, 0.1), ss(-2, 2, P.x)).mul(exp(r.mul(r).mul(-0.16))));
    const ink = mix(vec3(0.62, 0.56, 0.95), vec3(1, 0.85, 0.95), ss(-3, 3, P.x));
    col = col.add(ink.mul(cal).mul(0.3)).add(vec3(0.5, 0.45, 0.8).mul(gridLine));
    // payment dots (brand colours, pulsing) + light pools under the cards
    SERVICES.forEach((s, i) => {
      const c = cellCenter(dots[i].col, dots[i].row);
      const dp = P.xz.sub(vec2(c.x + CELL * 0.24, c.z + CELL * 0.2));
      const dd = length(dp);
      const scol = vc(new Color(s.color), 1);
      const isNext = i === NEXT ? 1 : 0;
      const pulse = sin(uTime.mul(2.2).add(i * 1.7)).mul(0.25).add(0.75).add(dotPulse.mul(isNext));
      const core = ss(0.075, 0.06, dd);
      const glow = exp(dd.mul(dd).mul(-36)).mul(0.5).mul(pulse);
      col = col.add(scol.mul(core.mul(1.6).add(glow)));
      if (isNext) {
        const rg = ss(0.02, 0.0, abs(dd.sub(fract(uTime.mul(0.45)).mul(0.6).add(0.1)))).mul(float(1).sub(fract(uTime.mul(0.45))));
        col = col.add(vc(PINK, 0.9).mul(rg));
      }
      const cp = cardPos[i];
      const dc = length(P.xz.sub(cp.xz));
      col = col.add(scol.mul(exp(dc.mul(dc).mul(-1.4))).mul(0.04).mul(ss(3.2, 0.5, cp.y)));
    });
    {
      const c = cellCenter(todayCell.col, todayCell.row);
      const q = abs(P.xz.sub(vec2(c.x, c.z))).sub(CELL * 0.5 - 0.075);
      const sd = length(max(q, vec2(0))).add(min(max(q.x, q.y), 0)).sub(0.05);
      col = col.add(vc(PINK, 0.85).mul(ss(0.016, 0.0, abs(sd))));
    }
    const R = reflect(V.negate(), vec3(0, 1, 0));
    col = col.add(skyCol(R).mul(fres).mul(0.08));
    const refl = mix(float(0.38), float(0.8), fres);
    const dist = length(cameraPosition.sub(P));
    const fog = clamp(float(1).sub(exp(dist.mul(0.055).mul(dist.mul(0.055)).negate())), 0, 1);
    const out = mix(tonemap(col), skyCol(V.negate()), fog);
    const a = mix(float(1).sub(refl), float(1), fog);
    return vec4(out, a);
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

  // screen (rounded rect, shows the featured screenshot; lock screen before it wakes)
  const shotNode: N = texture(new CanvasTexture(canvas(4, 4)[0]));
  const screenMat = (mirror: boolean) => {
    const m = new MeshBasicNodeMaterial({ transparent: !mirror });
    m.fog = false;
    m.depthWrite = true;
    m.outputNode = Fn(() => {
      const P = positionWorld;
      const lp = positionGeometry.xy;
      const sd = sdRound(lp, SCREEN_W / 2, SCREEN_H / 2, SCREEN_R);
      const aa = fwidth(sd).mul(1.2);
      const mask = float(1).sub(ss(aa.negate(), aa, sd));
      const u0 = lp.x.div(SCREEN_W).add(0.5), v0 = lp.y.div(SCREEN_H).add(0.5);
      const du = mix(u0, float(1).sub(v0), uOrient), dv = mix(v0, u0, uOrient);
      const dispA = mix(float(SCREEN_W / SCREEN_H), float(SCREEN_H / SCREEN_W), uOrient);
      const sx = max(dispA.div(uImgAspect), 1), sy = max(uImgAspect.div(dispA), 1);
      const iu = du.sub(0.5).mul(sx).add(0.5), iv = dv.sub(0.5).mul(sy).add(0.5);
      const inside = ss(0, 0.002, iu).mul(ss(1, 0.998, iu)).mul(ss(0, 0.002, iv)).mul(ss(1, 0.998, iv));
      const img = shotNode.sample(vec2(iu, iv)).rgb;
      const blur = shotNode.sample(vec2(du, dv)).level(6).rgb;
      // wallpaper (violet → pink liquid) with the lock screen drawn over it in portrait space
      let wall: N = mix(vc(VIOLET, 0.55), vc(PINK, 0.6), ss(0.1, 0.95, u0.add(v0.mul(0.6)).mul(0.7)))
        .mul(sin(u0.mul(9).add(v0.mul(5)).add(uTime.mul(0.6))).mul(0.12).add(0.88));
      if (!mirror) {
        const lock = uiNode.sample(regionUV(R_LOCK, UI, UI, clamp(u0, 0, 1), clamp(v0, 0, 1)));
        wall = mix(wall.mul(mix(float(1), float(0.62), uLock)), lock.rgb, lock.a.mul(uLock));
      }
      const shown = mix(blur.mul(0.32), img, inside);
      let c: N = mix(wall, shown, uScreenOn);
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

  const MIRROR = new Matrix4().makeScale(1, -1, 1);
  const mScreenGeo = new PlaneGeometry(SCREEN_W - 0.06, SCREEN_H - 0.06);
  const mirrorScreen = new Mesh(mScreenGeo, screenMat(true));
  mirrorScreen.matrixAutoUpdate = false;
  // start mirrored: on WebGPU the front-face winding is part of the pipeline, so the warm-up must see these
  // with the negative determinant they always draw with (update() sets the real matrix every frame)
  mirrorScreen.matrix.copy(MIRROR);
  scene.add(mirrorScreen);
  let mirrorPhone: Mesh | null = null;
  let phoneBody: Mesh | null = null;

  // ================================================================ cards (instanced liquid glass, real services)
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
      const edge = float(1).sub(ss(0.86, 0.995, abs(nz)));
      const id = float(instanceIndex);
      const lu = positionGeometry.x.div(CARD_W).add(0.5), lv = positionGeometry.y.div(CARD_H).add(0.5);
      const hueK = id.div(SERVICES.length - 1);
      const tint = mix(vc(VIOLET, 1), vc(PINK, 1), clamp(lu.mul(0.6).add(hueK.mul(0.5)).sub(0.1), 0, 1));
      let glass: N;
      if (!mirror) {
        const off = normalView.xy.mul(edge.mul(0.06).add(0.012));
        const base = screenUV.add(vec2(off.x, off.y.negate()));
        const fr = frost(base, 0.0065, 0.0105);
        const disp = vec3(texture(fr.node.value, base.add(off.mul(0.35))).r, fr.bd.g, texture(fr.node.value, base.sub(off.mul(0.35))).b);
        const back = mix(fr.bd, disp, edge);
        glass = back.mul(mix(vec3(1), tint, 0.32)).mul(0.78).add(tint.mul(0.05)).add(fr.node.rgb.mul(0.0001));
      } else {
        glass = tint.mul(0.16).add(envCol(R).mul(0.1));
      }
      const env = envCol(R);
      let c: N = glass.add(tonemap(env.mul(F.mul(0.9).add(edge.mul(0.35)))));
      c = c.add(vec3(1, 0.95, 1).mul(ss(0.55, 1.0, lv).mul(0.05)).mul(ss(0.9, 1, nz)));
      const cell = vec2(id.mod(4), floor(id.div(4)));
      const auv = vec2(cell.x.add(lu).mul(CW / CAT_W), float(1).sub(cell.y.add(float(1).sub(lv)).mul(CH / CAT_H)));
      const art = cardNode.sample(auv);
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

  // ================================================================ dynamic island (live activity)
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
    const ny = p.y.div(r);
    let body: N = vec3(0.004, 0.003, 0.008).add(vc(VIOLET, 0.06).mul(ss(-1, 1, ny)));
    const rim = ss(0.03, 0.0, abs(sd.add(0.012))).mul(ss(-0.2, 0.9, ny));
    body = body.add(vec3(0.8, 0.75, 1).mul(rim).mul(0.55));
    const ch = uPillH.mul(0.96), cw = ch.mul(1024 / 232);
    const cu = p.x.div(cw).add(0.5), cv = p.y.div(ch).add(0.5);
    const inC = ss(0, 0.01, cu).mul(ss(1, 0.99, cu)).mul(ss(0, 0.02, cv)).mul(ss(1, 0.98, cv));
    const art = uiNode.sample(regionUV(R_PILL, UI, UI, clamp(cu, 0, 1), clamp(cv, 0, 1)));
    body = mix(body, art.rgb, art.a.mul(inC).mul(uPillContent));
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

  // ================================================================ floating liquid-glass screenshot panels
  // the real App Store screenshots (phone kind) framed in violet glass; the inner area matches the image aspect
  const PANEL_IH = 1.7, PANEL_B = 0.05, PANEL_R = 0.11;
  type Panel = { mesh: Mesh; node: N; opacity: N; aspect: N; slide: number; w: number; hidden: boolean };
  const panels: Panel[] = [];
  for (let k = 0; k < 3; k++) {
    const node: N = texture(new CanvasTexture(canvas(4, 4)[0]));
    const opacity = uniform(0);
    const aspect = uniform(0.4624);
    const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    m.fog = false;
    m.outputNode = Fn(() => {
      const P = positionWorld;
      const lp = positionGeometry.xy; // 1×1 plane, scaled per frame
      const ow = aspect.mul(PANEL_IH).add(PANEL_B * 2), oh = float(PANEL_IH + PANEL_B * 2);
      const p = vec2(lp.x.mul(ow), lp.y.mul(oh));
      const sd = sdRound(p, ow.mul(0.5), oh.mul(0.5), float(PANEL_R));
      const aa = fwidth(sd).mul(1.2);
      const shape = float(1).sub(ss(aa.negate(), aa, sd));
      const sdi = sdRound(p, ow.mul(0.5).sub(PANEL_B), oh.mul(0.5).sub(PANEL_B), float(PANEL_R - PANEL_B * 0.6));
      const aai = fwidth(sdi).mul(1.2);
      const inImg = float(1).sub(ss(aai.negate(), aai, sdi));
      const iu = p.x.div(ow.sub(PANEL_B * 2)).add(0.5), iv = p.y.div(PANEL_IH).add(0.5);
      const img = node.sample(vec2(clamp(iu, 0, 1), clamp(iv, 0, 1))).rgb;
      const fr = frost(screenUV, 0.006, 0.0095);
      const tint = mix(vc(VIOLET, 1), vc(PINK, 1), ss(-0.6, 0.6, p.y.add(p.x)));
      const rim = ss(0.018, 0.0, abs(sd.add(0.01))).mul(0.9).add(ss(0.012, 0.0, abs(sdi)).mul(0.35));
      let glass: N = fr.bd.mul(mix(vec3(1), tint, 0.45)).mul(0.85).add(tint.mul(0.14)).add(fr.node.rgb.mul(0.0001));
      glass = glass.add(vec3(1, 0.93, 1).mul(rim));
      const sheen = ss(0.08, 0.0, abs(iu.add(iv.mul(0.5)).sub(uParallax.x.mul(0.2).add(0.9)))).mul(0.05);
      let c: N = mix(glass, img.add(sheen), inImg);
      c = applyFog(c, P, 0.035);
      return vec4(c, shape.mul(opacity));
    })();
    const mesh = new Mesh(new PlaneGeometry(1, 1), m);
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    panels.push({ mesh, node, opacity, aspect, slide: -1, w: 0.4624 * PANEL_IH + PANEL_B * 2, hidden: true });
  }

  // ================================================================ glass UI: widget (world) + banners (screen-anchored)
  const glassUI = (r: Rect, opacity: N, radiusK: number, darkK: number, content: N = float(1)) => {
    const ar = r[2] / r[3];
    const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    m.fog = false;
    m.outputNode = Fn(() => {
      const lp = positionGeometry.xy; // 1×1 plane
      const p = vec2(lp.x.mul(ar), lp.y);
      const sd = sdRound(p, float(ar * 0.5), float(0.5), float(radiusK));
      const aa = fwidth(sd).mul(1.2);
      const shape = float(1).sub(ss(aa.negate(), aa, sd));
      const fr = frost(screenUV, 0.009, 0.014);
      const tint = mix(vc(VIOLET, 1), vc(PINK, 1), ss(-ar * 0.5, ar * 0.5, p.x));
      let c: N = mix(fr.bd.mul(mix(vec3(1), tint, 0.4)), vec3(0.035, 0.022, 0.075), darkK).add(tint.mul(0.06)).add(fr.node.rgb.mul(0.0001));
      // liquid-glass rim: bright on the top edge, coloured on the sides
      const rim = ss(0.03, 0.0, abs(sd.add(0.012)));
      c = c.add(mix(tint, vec3(1, 0.96, 1), ss(-0.2, 0.9, p.y.mul(2))).mul(rim).mul(0.75));
      c = c.add(vec3(1, 0.95, 1).mul(ss(0.1, 0.5, p.y)).mul(0.035));
      const art = uiNode.sample(regionUV(r, UI, UI, lp.x.add(0.5), lp.y.add(0.5)));
      c = mix(c, art.rgb, art.a.mul(content));
      return vec4(c, shape.mul(opacity));
    })();
    return m;
  };
  const uWidgetA = uniform(0);
  const widget = new Mesh(new PlaneGeometry(1, 1), glassUI(R_WIDGET, uWidgetA, 0.16, 0.5));
  widget.renderOrder = 7;
  widget.frustumCulled = false;
  widget.visible = false;
  scene.add(widget);
  const banners = BANNERS.map((_, i) => {
    const a = uniform(0), content = uniform(1);
    const mat = glassUI(R_BAN(i), a, 0.24, 0.62, content);
    mat.depthTest = false;
    const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
    mesh.renderOrder = 20 + i; // newest on top
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, a, content, p: 0 };
  });

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

  /** panels show the portrait (phone) screenshots other than the featured one */
  function assignPanels(featured: number) {
    const pool = slides.map((_, i) => i).filter((i) => slides[i].kind === 'phone' && i !== featured);
    panels.forEach((pn, k) => {
      pn.hidden = k >= pool.length;
      if (pn.hidden) return;
      const si = pool[k];
      if (si === pn.slide) return;
      pn.slide = si;
      const tx = slideTex[si];
      if (tx) pn.node.value = tx;
      const a = aspectOf(si);
      pn.aspect.value = a;
      pn.w = a * PANEL_IH + PANEL_B * 2;
    });
  }

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
    mirrorPhone.matrix.copy(MIRROR); // mirrored from the start, see mirrorScreen
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
      assignPanels(i);
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
  const basePos = new Vector3();
  const par = { x: 0, y: 0 };
  let lastT = 0;
  const flatQ = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
  const screenCorners: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  let quadOn = false;
  const tmpQ = new Quaternion(), tmpQ2 = new Quaternion(), tmpE = new Euler(), zAxis = new Vector3(0, 0, 1), yAxis = new Vector3(0, 1, 0);
  const tmpV = new Vector3(), floorP = new Vector3();
  const a0 = new Vector3(-1.6, 9.2, 5.2), a1 = new Vector3(-3.6, 4.2, 8.6), a2 = new Vector3();

  /** hold framing: the (rotated) screen spans NDC yt…yb vertically (visible band above the DOM panel is +1 … −0.44),
   *  camera level with no pitch so the screenshot is square-on; narrower viewports back off to fit the width */
  function holdPose(aspect: number, o: number, out: Vector3, tgt: Vector3) {
    const dispH = lerp(SCREEN_H, SCREEN_W, o), dispW = lerp(SCREEN_W, SCREEN_H, o);
    const yt = lerp(0.7, 0.48, o), yb = lerp(-0.36, -0.38, o);
    const dV = dispH / ((yt - yb) * TH);
    const dH = dispW / (1.7 * TH * aspect);
    const d = Math.max(dV, dH);
    const camY = PHONE_C.y - ((yt + yb) / 2) * d * TH;
    tgt.set(PHONE_C.x, camY, 0);
    out.set(PHONE_C.x, camY, d);
  }
  /** world point at NDC (x, y) on the plane z = zw, as seen from the level base hold camera */
  function atNDC(x: number, y: number, zw: number, out: Vector3) {
    const dist = basePos.z - zw;
    return out.set(basePos.x + x * dist * TH * camera.aspect, basePos.y + y * dist * TH, zw);
  }

  // panel layouts in NDC of the hold framing: [x, y, z, ndc height, yaw]
  const PANEL_PORTRAIT: [number, number, number, number, number][] = [
    [-0.47, 0.02, -2.6, 0.7, 0.26],
    [0.46, 0.06, -2.6, 0.7, -0.26],
    [0.76, -0.04, -3.8, 0.56, -0.36],
  ];
  const PANEL_LANDSCAPE: [number, number, number, number, number][] = [
    [-0.76, 0.0, -2.8, 0.66, 0.36],
    [0.76, 0.02, -2.8, 0.66, -0.36],
    [0.9, -0.06, -4.0, 0.5, -0.44],
  ];

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
        assignPanels(shown);
      }
      orient = lerp(orientFrom, orientTo, ease(sstep(0.12, 0.8, switchT)));
    }
    const switchDim = switchT < 1 ? 1 - Math.min(sstep(0.0, 0.3, switchT) * (1 - sstep(0.58, 0.95, switchT)), 1) : 1;

    // ---- phases
    const arrive = sstep(0, 0.22, t);
    const rise = ease(sstep(0.02, 0.19, t));
    const depart = clamp01((t - 0.82) / 0.18);
    const holdK = clamp01((t - 0.22) / 0.6);

    // lock screen while lying on the calendar; the screen wakes into the screenshot as the phone stands up
    uLock.value = 1 - sstep(0.15, 0.2, t);
    uScreenOn.value = sstep(0.15, 0.21, t) * switchDim;

    // ---- phone (rolls to landscape only once upright, so the lock screen reads portrait)
    const roll = ease(sstep(0.12, 0.2, t));
    const bob = Math.sin(time * 0.7) * 0.025 * rise;
    phone.position.set(PHONE_C.x, lerp(0.075, PHONE_C.y, rise) + bob, lerp(0.35, PHONE_C.z, rise));
    e.set(lerp(-Math.PI / 2, 0, rise) + Math.sin(time * 0.5) * 0.012 * rise, Math.sin(time * 0.37) * 0.03 * rise + par.x * 0.05 * rise,
      (orient * roll * Math.PI) / 2 + Math.sin(time * 0.43) * 0.008);
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
      const spin = time * 0.05 + t * 1.2 + depart * depart * 2.5;
      const grow = 1 + depart * depart * 1.6;
      const ra = lerp(2.15, 2.5, orient) * grow, rb = 1.55 * grow;
      for (let i = 0; i < n; i++) {
        const a = spin + (i / n) * Math.PI * 2 + 0.6;
        const li = ease(sstep(0.03 + i * 0.012, 0.16 + i * 0.006, t));
        const ox = Math.sin(a) * ra, oz = Math.cos(a) * rb;
        // non-planar ring: the front arc dips low (under the DOM panel), the back arc rises only a little
        const oy = PHONE_C.y + 0.05 - (oz / rb) * (oz > 0 ? lerp(1.3, 0.95, orient) : lerp(0.65, 0.55, orient)) + Math.sin(time * 0.8 + i * 1.3) * 0.05 + depart * depart * (1.4 + i * 0.15);
        const orbit = v.set(ox, oy, oz);
        const fa = (i / n) * Math.PI * 2 + 0.6;
        floorP.set(Math.sin(fa) * 2.5, 0.03, Math.cos(fa) * 1.9 + 0.35);
        const pos = floorP.lerp(orbit, li);
        const yaw = Math.sin(a) * 0.55 + Math.sin(time * 0.6 + i) * 0.05;
        const pitch = -0.12 + (oz / rb) * 0.18 + Math.sin(time * 0.5 + i * 2.1) * 0.04;
        const rl = Math.sin(a * 0.5 + i) * 0.12;
        const oq = tmpQ.setFromEuler(tmpE.set(pitch, yaw, rl, 'YXZ'));
        const fq = tmpQ2.copy(flatQ).multiply(q.setFromAxisAngle(zAxis, fa * 0.35 - 0.5));
        q.slerpQuaternions(fq, oq, li);
        const s = CARD_S * lerp(0.92, 1, li);
        sc.set(s, s, s);
        m4.compose(pos, q, sc);
        cards.setMatrixAt(i, m4);
        (cardPos[i].value as Vector3).copy(pos);
      }
      cards.instanceMatrix.needsUpdate = true;
    }
    dotPulse.value = 0.4 + 0.4 * Math.sin(time * 3.2);

    // ---- island: expands at the end of the arrive, collapses on depart
    const pillIn = sstep(0.12, 0.17, t) * (1 - sstep(0.86, 0.93, t));
    const expand = ease(sstep(0.16, 0.24, t)) * (1 - ease(sstep(0.83, 0.88, t)));
    uPillOpacity.value = pillIn;
    uPillW.value = lerp(0.42, lerp(1.3, 1.1, orient), expand);
    uPillH.value = lerp(0.18, lerp(0.28, 0.22, orient), expand);
    uPillContent.value = sstep(0.2, 0.26, t) * (1 - sstep(0.82, 0.85, t));
    const topY = phone.position.y + lerp(1.03, 0.5, orient);
    pill.position.set(0, topY + lerp(-0.04, 0.03 + uPillH.value * 0.5, orient) + Math.sin(time * 0.9) * 0.015 + depart * 0.6, 0.2);

    // ---- camera
    holdPose(camera.aspect, orient, holdPos, holdTgt);
    basePos.copy(holdPos);
    const drift = Math.sin(holdK * Math.PI);
    const yaw = (holdK - 0.5) * 0.08 + Math.sin(time * 0.13) * 0.012;
    v.copy(holdPos).sub(holdTgt).multiplyScalar(1.03 - 0.05 * holdK).applyAxisAngle(yAxis, yaw);
    holdPos.copy(holdTgt).add(v);
    holdPos.y += drift * 0.04 + Math.sin(time * 0.21) * 0.015;
    a2.set(holdPos.x - 1.2, holdPos.y + 0.9, holdPos.z + 2.0);
    const k = ease(arrive * 0.92 + 0.08 * arrive * arrive);
    const k1 = 1 - k;
    camPos.set(0, 0, 0)
      .addScaledVector(a0, k1 * k1 * k1).addScaledVector(a1, 3 * k1 * k1 * k).addScaledVector(a2, 3 * k1 * k * k).addScaledVector(holdPos, k * k * k);
    camTgt.lerpVectors(tmpV.set(0, 0, 0.1), holdTgt, ease(sstep(0.02, 0.22, t)));
    if (depart > 0) {
      const dk = ease(depart);
      const sc0 = new Vector3(0, 0, 0.06).applyMatrix4(phone.matrixWorld);
      const into = sc0.clone().add(new Vector3(0, 0, 0.12));
      camPos.lerp(into, dk * (0.55 + 0.45 * dk));
      camTgt.lerp(sc0, sstep(0, 0.6, depart));
    }
    const pk = (0.35 + 0.65 * rise) * (1 - depart);
    camPos.x += par.x * 0.32 * pk;
    camPos.y += -par.y * 0.16 * pk;
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(camTgt);
    camera.updateMatrixWorld();

    // ---- floating screenshot panels: rise in behind the phone after the arrive, fly apart on depart
    panels.forEach((pn, i) => {
      const L = PANEL_PORTRAIT[i], R = PANEL_LANDSCAPE[i];
      const x = lerp(L[0], R[0], orient), y = lerp(L[1], R[1], orient), z = lerp(L[2], R[2], orient);
      const nh = lerp(L[3], R[3], orient), yw = lerp(L[4], R[4], orient);
      atNDC(x, y, z, tmpV);
      const dist = basePos.z - z;
      const s = (nh * dist * TH) / (PANEL_IH + PANEL_B * 2);
      const pi = ease(sstep(0.13 + i * 0.03, 0.25 + i * 0.03, t));
      const fl = Math.sin(time * 0.6 + i * 2.1) * 0.04;
      const side = Math.sign(x) || 1;
      pn.mesh.position.set(tmpV.x + side * depart * depart * 3.0, tmpV.y + fl - (1 - pi) * 1.6 + depart * depart * 1.2, tmpV.z);
      pn.mesh.rotation.set(Math.sin(time * 0.4 + i) * 0.03 - (1 - pi) * 0.5, yw + Math.sin(time * 0.33 + i * 1.7) * 0.04, Math.sin(time * 0.5 + i) * 0.015);
      pn.mesh.scale.set(pn.w * s, (PANEL_IH + PANEL_B * 2) * s, 1);
      const op = pi * (1 - sstep(0.85, 0.97, t));
      pn.opacity.value = op;
      pn.mesh.visible = op > 0.001 && !pn.hidden;
    });

    // ---- floating widget (lock-screen style), upper left of the phone
    {
      const wi = ease(sstep(0.2, 0.3, t)) * (1 - sstep(0.84, 0.92, t));
      const x = lerp(-0.5, -0.56, orient), y = lerp(0.56, 0.64, orient), z = 0.4;
      atNDC(x, y, z, tmpV);
      const dist = basePos.z - z;
      const hW = lerp(0.27, 0.25, orient) * dist * TH;
      widget.position.set(tmpV.x, tmpV.y + Math.sin(time * 0.7 + 1) * 0.03 + (1 - wi) * 0.4, tmpV.z);
      widget.rotation.set(Math.sin(time * 0.45) * 0.03, 0.22 + Math.sin(time * 0.37) * 0.04, 0);
      widget.scale.set(hW * (R_WIDGET[2] / R_WIDGET[3]), hW, 1);
      uWidgetA.value = wi;
      widget.visible = wi > 0.001;
    }

    // ---- notification banners: drop in one after another (newest on top, older ones stacked behind)
    {
      const D = 0.6; // anchored 0.6 in front of the camera
      const hh = D * TH, hw = hh * camera.aspect;
      const bw = 0.44 * hw, bh = bw / (R_BAN(0)[2] / R_BAN(0)[3]);
      const bhN = bh / hh;
      const starts = [0.25, 0.4, 0.55];
      banners.forEach((b, i) => {
        const on = t >= starts[i] && t < 0.81 ? 1 : 0;
        b.p = damp(b.p, on, on ? 5 : 7, dt);
      });
      banners.forEach((b, i) => {
        let slot = 0;
        for (let j = i + 1; j < banners.length; j++) slot += banners[j].p;
        const drop = easeOutBack(b.p);
        const sK = 1 - 0.07 * slot;
        const yN = 0.75 - bhN / 2 - slot * 0.035 + (1 - drop) * (bhN + 0.12) - (1 - sK) * bhN * 0.5;
        tmpV.set(0.5 * hw, yN * hh, -D);
        b.mesh.position.copy(tmpV).applyMatrix4(camera.matrixWorld);
        b.mesh.quaternion.copy(camera.quaternion);
        b.mesh.scale.set(bw * sK, bh * sK, 1);
        const a = clamp01(b.p * 1.4) * (1 - 0.35 * Math.min(slot, 2) / 2) * (slot > 1.6 ? clamp01(1 - (slot - 1.6) * 2) : 1);
        b.a.value = a;
        b.content.value = 1 - clamp01(slot * 1.6);
        b.mesh.visible = a > 0.002;
      });
    }

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
      cardAtlas.dispose(); uiTex.dispose(); calTex.dispose();
      slideTex.forEach((t) => t?.dispose());
    },
    ...({ _debug: () => ({ t: lastT, shown, orient }) } as any),
  };
}
