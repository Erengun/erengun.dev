/**
 * Project world #2: Cached Network Image CE — "zero-jank" tunnel of the real apps that ship it.
 *
 * An endless tunnel (one instanced draw, ~1.4k quads) of phones and app windows streams towards the camera. Each one
 * shows a README screenshot of a real open-source app that depends on cached_network_image_ce (Kazumi, PiliPlus,
 * Fluxer, plezy, conduit, haka_comic, MusicPod, BoxBox, jd_mall_flutter; captured from their public GitHub pages
 * into public/worlds/cached-network-image-ce/apps/, packed into one atlas at runtime) with its name + GitHub ★ label.
 * Far devices are skeleton placeholders (blue shimmer); each snaps in at its own distance with a pop, a cache-hit
 * flash and a tiny amber "HIT" badge. The project's real screenshot is the hero (Blender bezel, 9-sliced), flanked
 * by four big app devices that cycle through the apps with cache-hit swaps, under a live pub.dev counter
 * (odometer digits from a glyph strip: 175,776 downloads / 30 days, ticking at the real average rate during the
 * hold; "used by apps with 83k+ ★ combined"). pubspec.yaml snippets (`cached_network_image_ce: ^4.13.2`) stream
 * past in the tunnel.
 *
 * Timeline (local t): arrive 0→.22 fast fly-in, the counter rolls up big in the tunnel and docks above the hero;
 * hold .22→.82 hero parked, walls keep streaming slowly, pointer parallax; depart .82→1 the hero is "cached" into
 * the wall and the stream carries it past the camera.
 *
 * Draws: background, tunnel devices, feature devices, snippets, streaks, dust, glow, bezel, hero image, badge,
 * counter sign (~12). Slide change: the hero "reloads" (skeleton shimmer, texture swap, cache-hit flash), ~0.5 s.
 */
import {
  Scene, Color, Mesh, Group, PerspectiveCamera, PlaneGeometry, BufferGeometry, InstancedBufferAttribute,
  MeshBasicNodeMaterial, CanvasTexture, TextureLoader, SRGBColorSpace, DoubleSide, AdditiveBlending, Vector3, Vector4, LinearFilter,
  type Texture,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, uv, texture, varying, instancedBufferAttribute, positionGeometry,
  normalGeometry, screenUV, mix, smoothstep as ssRaw, clamp, max, min, pow, exp, length, normalize, dot, sin, floor, fract,
  step, select, abs, sign, mod, frontFacing, Discard, color, cameraPosition, positionWorld, modelWorldMatrix,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Stage, StageFrame, ProjectWorldContext, SlideImage } from '../journey/types';

type N = any; // TSL node (loosely typed on purpose)

// ------------------------------------------------------------------ constants
const ASSET = '/worlds/cached-network-image-ce/';
const BLUE = '#02569b', AMBER = '#ffb300', PAPER = '#f5f9ff';
const A_END = 0.22, H_END = 0.82;
const ARRIVE_DIST = 68; // stream travel during arrive
const HOLD_DIST = 6;
const DEPART_DIST = 80;
const IDLE_SPEED = 0.55; // units / s of constant stream
const HERO_D = 4.6;
const HERO_DROP = 0.27; // hero sits a little low to leave room for the counter sign
const SLOT_P = 3.6, SLOT_SKEL = 0.22; // feature devices: app cycle period / skeleton time (s) // hero distance from the camera during hold
const HERO_LOAD = 18; // hero snaps in when closer than this
const PITCH = Math.atan(0.22 * Math.tan((25 * Math.PI) / 180)); // puts the tunnel axis / hero at NDC y≈+.22 (headroom for the fish-eye post)
const NEAR = 2.5; // frames wrap once they are this far behind the camera
const R = 3.05;

// real apps shipping cached_network_image_ce (README "Used by", GitHub stars fetched 2026-11-12). Order = atlas order.
const APPS = [
  { id: 'kazumi', name: 'Kazumi', stars: 42266, win: false },
  { id: 'conduit', name: 'conduit', stars: 2442, win: false },
  { id: 'haka_comic', name: 'haka_comic', stars: 1732, win: false },
  { id: 'jd_mall_flutter', name: 'jd_mall_flutter', stars: 164, win: false },
  { id: 'boxbox', name: 'BoxBox', stars: 165, win: false },
  { id: 'piliplus', name: 'PiliPlus', stars: 20733, win: true },
  { id: 'fluxer', name: 'Fluxer', stars: 10850, win: true },
  { id: 'plezy', name: 'plezy', stars: 4156, win: true },
  { id: 'musicpod', name: 'MusicPod', stars: 673, win: true },
];
const N_PHONE = 5, N_WIN = 4;
const DOWNLOADS = 175776; // pub.dev, last 30 days
const DL_RATE = DOWNLOADS / (30 * 86400); // real average downloads per second
// runtime atlas: 5 phone screens (409.6 x 887) on top, 4 window screens (512 x 384) below
const AT_W = 2048, AT_H = 1280, PH_CW = AT_W / N_PHONE, PH_CH = 887, WN_CW = AT_W / N_WIN, WN_CH = 384;
// device geometry (units, before instance scale)
const LBL_W = 1.04, LBL_H = 0.13, LBL_GAP = 0.05;
const DEV = {
  phone: { sw: 0.55, sh: 1.19, b: 0.03, title: 0, rOut: 0.085, rIn: 0.06 },
  win: { sw: 1.24, sh: 0.93, b: 0.02, title: 0.075, rOut: 0.035, rIn: 0.012 },
};
const devSize = (k: typeof DEV.phone) => [k.sw + 2 * k.b, k.sh + 2 * k.b + k.title];
const QUAD = {
  phone: [Math.max(LBL_W, devSize(DEV.phone)[0]), devSize(DEV.phone)[1] + LBL_GAP + LBL_H],
  win: [Math.max(LBL_W, devSize(DEV.win)[0]), devSize(DEV.win)[1] + LBL_GAP + LBL_H],
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** stream travel S(t) (scroll part only) and its derivative dS/dt */
function travel(t: number) {
  let s = 0, v = 0;
  if (t < 0) { v = (ARRIVE_DIST * 3) / A_END; s = t * v; return { s, v, arrive: 0 }; }
  const xa = clamp01(t / A_END);
  const arrive = ARRIVE_DIST * outCubic(xa);
  s += arrive;
  if (t < A_END) v += (ARRIVE_DIST * 3 * Math.pow(1 - xa, 2)) / A_END;
  s += HOLD_DIST * clamp01((t - A_END) / (H_END - A_END));
  if (t > A_END && t < H_END) v += HOLD_DIST / (H_END - A_END);
  const y = (t - H_END) / (1 - H_END);
  if (y > 0) {
    const yc = Math.min(y, 1);
    s += DEPART_DIST * Math.pow(yc, 2.2);
    const vd = (DEPART_DIST * 2.2 * Math.pow(yc, 1.2)) / (1 - H_END);
    v += vd;
    if (y > 1) s += (y - 1) * (1 - H_END) * vd;
  }
  return { s, v, arrive };
}

// ------------------------------------------------------------------ small TSL helpers
/** smoothstep that also accepts falling constant edges (WGSL rejects const smoothstep with low >= high) */
const smoothstep = (a: N, b: N, x: N): N =>
  typeof a === 'number' && typeof b === 'number' && a > b ? float(1).sub(ssRaw(b, a, x)) : ssRaw(a, b, x);
/** falling edge for node-valued edges: 1 at x <= lo, 0 at x >= hi */
const ssDown = (lo: N, hi: N, x: N): N => float(1).sub(ssRaw(lo, hi, x));
const hash1 = (x: N): N => fract(sin(x.mul(91.3458)).mul(47453.5453));
const hex = (h: string): N => color(new Color(h));

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function pill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = h / 2;
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(x + r, y + h); g.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2); g.closePath();
}

function placeholderSlides(title: string): { slides: SlideImage[]; tex: Texture[] } {
  const slides: SlideImage[] = [];
  const tex: Texture[] = [];
  for (let i = 0; i < 3; i++) {
    const phone = i === 2;
    const w = phone ? 600 : 1600, h = phone ? 1300 : 960;
    tex.push(canvasTex(w, h, (g) => {
      const gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, BLUE); gr.addColorStop(1, '#0a2540');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = PAPER; g.font = `bold ${phone ? 54 : 96}px Helvetica, Arial, sans-serif`;
      g.fillText(title, 50, phone ? 140 : 180);
      g.fillStyle = AMBER;
      for (let k = 0; k < 6; k++) g.fillRect(50 + (k % 3) * (w - 100) / 3, (phone ? 260 : 300) + Math.floor(k / 3) * (h * 0.28), (w - 140) / 3, h * 0.22);
    }));
    slides.push({ src: '', w, h, kind: phone ? 'phone' : 'desktop', caption: 'placeholder' });
  }
  return { slides, tex };
}

async function fetchManifest(url: string): Promise<SlideImage[] | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) && j.length ? (j as SlideImage[]) : null;
  } catch { return null; }
}

// ================================================================== world
export function createWorld(ctx: ProjectWorldContext): Stage {
  const high = ctx.quality === 'high' && !ctx.isPhone;
  const PER_RING = 16;
  const RING_STEP = 1.25;
  const RINGS = high ? 96 : 64;
  const L = RINGS * RING_STEP;

  const scene = new Scene();
  const background = new Color('#020b16');
  scene.background = background;
  const camera = new PerspectiveCamera(50, 1.6, 0.05, 160);

  // ---- uniforms
  const uTime = uniform(0);
  const uS = uniform(0); // stream offset (scroll + idle)
  const uSpeed = uniform(0); // 0..1
  const uHeroZ = uniform(-HERO_D);
  const uHeroLight = uniform(0);
  const uOpen = uniform(0);
  const uVP = uniform(new Vector3(0.5, 0.36, 1.6)); // vanishing point in screenUV (xy) + aspect (z)

  // ---- background: deep navy with a blue bloom at the vanishing point
  scene.backgroundNode = Fn(() => {
    const d: N = length(screenUV.sub(uVP.xy).mul(vec2(uVP.z, 1)));
    const base: N = mix(hex('#03101f'), hex('#010509'), smoothstep(0.2, 1.1, d));
    const glow: N = hex('#0b5fae').mul(exp(d.mul(-3.2)).mul(0.9));
    const hot: N = hex('#ffcf7a').mul(exp(d.mul(-11)).mul(0.22));
    return vec4(base.add(glow).add(hot), 1);
  })();

  // ---- shared shading bits
  const fogCol = (dist: N): N => mix(hex('#041a33'), hex('#0e5aa3'), smoothstep(20, 80, dist));
  const fogAmt = (dist: N): N => float(1).sub(exp(pow(max(dist, 0).div(36), 1.8).negate()));

  // ---- textures
  const loader = new TextureLoader();
  const hitTex = canvasTex(128, 48, (g) => {
    g.fillStyle = AMBER; pill(g, 2, 4, 124, 40); g.fill();
    g.fillStyle = '#1a1200'; g.font = 'bold 28px Helvetica, Arial, sans-serif'; g.textBaseline = 'middle';
    g.beginPath(); g.arc(24, 24, 6, 0, Math.PI * 2); g.fill();
    g.fillText('HIT', 40, 25);
  });
  const badgeTex = canvasTex(640, 112, (g) => {
    g.fillStyle = AMBER; pill(g, 4, 8, 392, 96); g.fill();
    g.fillStyle = '#1a1200'; g.font = 'bold 50px Helvetica, Arial, sans-serif'; g.textBaseline = 'middle';
    g.beginPath(); g.arc(52, 56, 13, 0, Math.PI * 2); g.fill();
    g.fillText('CACHE HIT', 82, 58);
    g.fillStyle = 'rgba(4,22,44,0.85)'; pill(g, 408, 8, 226, 96); g.fill();
    g.strokeStyle = 'rgba(255,179,0,0.7)'; g.lineWidth = 3; pill(g, 410, 10, 222, 92); g.stroke();
    g.fillStyle = PAPER; g.font = '600 44px Menlo, monospace';
    g.fillText('0 ms', 466, 58);
  });

  // =========================================================== real apps: runtime atlases
  const fmt = (v: number) => v.toLocaleString('en-US');
  const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = AT_W; atlasCanvas.height = AT_H;
  { const g = atlasCanvas.getContext('2d')!; g.fillStyle = '#0d3560'; g.fillRect(0, 0, AT_W, AT_H); }
  const appTex = new CanvasTexture(atlasCanvas);
  appTex.colorSpace = SRGBColorSpace;
  appTex.anisotropy = 4;
  const appCell = (i: number) => (APPS[i].win ? [(i - N_PHONE) * WN_CW, PH_CH, WN_CW, WN_CH] : [i * PH_CW, 0, PH_CW, PH_CH]);
  /** draws the nine captures into the atlas; a failed image keeps its skeleton-blue cell instead of rejecting */
  const loadApps = () => Promise.all(APPS.map((a, i) => new Promise<void>((res) => {
    const im = new Image();
    im.onload = () => { const [x, y, w, h] = appCell(i); atlasCanvas.getContext('2d')!.drawImage(im, x, y, w, h); res(); };
    im.onerror = () => res();
    im.src = `${ASSET}apps/${a.id}.webp`;
  }))).then(() => { appTex.needsUpdate = true; });

  /** name + ★ label per app, one 1024x128 row each */
  const labelTex = canvasTex(1024, 128 * APPS.length, (g) => {
    APPS.forEach((a, i) => {
      const y = i * 128;
      g.fillStyle = 'rgba(3,16,34,0.94)'; pill(g, 4, y + 10, 1016, 108); g.fill();
      g.strokeStyle = 'rgba(74,163,255,0.6)'; g.lineWidth = 4; pill(g, 6, y + 12, 1012, 104); g.stroke();
      g.textBaseline = 'middle';
      g.textAlign = 'left'; g.fillStyle = PAPER; g.font = 'bold 60px Helvetica, Arial, sans-serif';
      g.fillText(a.name, 50, y + 66, 560);
      g.textAlign = 'right'; g.fillStyle = AMBER; g.font = 'bold 58px Helvetica, Arial, sans-serif';
      g.fillText('★ ' + fmt(a.stars), 974, y + 66);
      g.textAlign = 'left';
    });
  });

  // =========================================================== device shading (phones + app windows)
  const appNode = texture(appTex);
  const labelNode = texture(labelTex);
  const hitNode = texture(hitTex);
  /** rounded-box distance (negative inside; exact near the edges, which is all the rim needs) */
  const sdRR = (p: N, h: N, r: N): N => length(max(abs(p).sub(h).add(r), 0)).sub(r);
  const box01 = (q: N): N => step(0, q.x).mul(step(q.x, 1)).mul(step(0, q.y)).mul(step(q.y, 1));
  const kmix = (a: number, b: number, w: N): N => mix(float(a), float(b), w);

  /** returns vec4(rgb, coverage) for a device quad: phone (win=0) or app window (win=1) with its label underneath */
  const device = (o: { uvN: N; win: N; app: N; x: N; dist: N; z: N; seed: N; big: boolean }): N => {
    const P = DEV.phone, W = DEV.win;
    const w: N = o.win;
    const qW: N = kmix(QUAD.phone[0], QUAD.win[0], w), qH: N = kmix(QUAD.phone[1], QUAD.win[1], w);
    const sw: N = kmix(P.sw, W.sw, w), sh: N = kmix(P.sh, W.sh, w);
    const b: N = kmix(P.b, W.b, w), tb: N = w.mul(W.title);
    const rO: N = kmix(P.rOut, W.rOut, w), rI: N = kmix(P.rIn, W.rIn, w);
    const dW: N = sw.add(b.mul(2)), dH: N = sh.add(b.mul(2)).add(tb);
    const lp: N = o.uvN.sub(0.5).mul(vec2(qW, qH));
    const dp: N = lp.sub(vec2(0, qH.sub(dH).mul(0.5)));
    const dDev: N = sdRR(dp, vec2(dW, dH).mul(0.5), rO);
    const sp: N = dp.add(vec2(0, tb.mul(0.5)));
    const dScr: N = sdRR(sp, vec2(sw, sh).mul(0.5), rI);
    const pu: N = sp.div(vec2(sw, sh)).add(0.5);
    const loaded: N = step(0, o.x);
    // app screen from the atlas (cells inset 2px against mip bleed)
    const isW: N = step(N_PHONE - 0.5, o.app);
    const ci: N = o.app.sub(isW.mul(N_PHONE));
    const cell: N = mix(vec4(ci.mul(PH_CW), 0, PH_CW, PH_CH), vec4(ci.mul(WN_CW), PH_CH, WN_CW, WN_CH), isW);
    const q: N = clamp(pu, 0, 1);
    const px: N = cell.x.add(2).add(q.x.mul(cell.z.sub(4)));
    const py: N = cell.y.add(2).add(float(1).sub(q.y).mul(cell.w.sub(4)));
    const scr: N = appNode.sample(vec2(px.div(AT_W), float(1).sub(py.div(AT_H)))).rgb;
    const shimmer: N = smoothstep(0.35, 0.0, abs(fract(pu.x.mul(0.6).add(pu.y.mul(0.3)).sub(uTime.mul(0.7)).add(o.seed)).sub(0.5)));
    const skel: N = mix(hex('#0d3560'), hex('#2a72b8'), shimmer.mul(0.55));
    let screen: N = mix(skel, scr, loaded);
    // HIT badge, top-right of the screen, for a while after the snap
    const bwU = o.big ? 0.3 : 0.26, bhU = bwU * (48 / 128);
    const bc: N = vec2(sw.mul(0.5).sub(0.035 + bwU / 2), sh.mul(0.5).sub(kmix(0.11, 0.035, w)).sub(bhU / 2));
    const buv: N = sp.sub(bc).div(vec2(bwU, bhU)).add(0.5);
    const bT: N = hitNode.sample(clamp(buv, 0, 1));
    const life = o.big ? 6 : 7;
    const bA: N = loaded.mul(smoothstep(0, 0.25, o.x)).mul(smoothstep(life, life * 0.6, o.x)).mul(box01(buv)).mul(bT.a);
    screen = mix(screen, bT.rgb, bA);
    // body: phone slab / window frame with title bar + traffic lights
    const rim: N = smoothstep(-0.016, 0.0, dDev);
    let bodyCol: N = mix(hex('#070b13'), hex('#16233a'), w).add(hex('#5fa8ff').mul(rim.mul(0.6)));
    const tp: N = dp.sub(vec2(dW.mul(-0.5).add(0.065), dH.mul(0.5).sub(b).sub(tb.mul(0.5))));
    const lights: [number, string][] = [[0, '#ff5f57'], [0.05, '#febc2e'], [0.1, '#28c840']];
    for (const [dx, c] of lights) bodyCol = mix(bodyCol, hex(c), w.mul(smoothstep(0.017, 0.012, length(tp.sub(vec2(dx, 0))))));
    const inDev: N = step(dDev, 0);
    let col: N = mix(bodyCol, screen, step(dScr, 0));
    // label (name + ★) under the device, revealed by the cache hit
    const luv: N = lp.sub(vec2(0, qH.mul(-0.5).add(LBL_H / 2))).div(vec2(LBL_W, LBL_H)).add(0.5);
    const lT: N = labelNode.sample(vec2(clamp(luv.x, 0, 1), float(1).sub(o.app.add(float(1).sub(clamp(luv.y, 0.02, 0.98))).div(APPS.length))));
    const lA: N = box01(luv).mul(lT.a).mul(smoothstep(0, 0.6, o.x)).mul(float(1).sub(inDev));
    col = mix(col, lT.rgb, step(0.5, lA));
    // lighting: base, hero spill, travelling amber "request" pulses
    const dz: N = o.z.sub(uHeroZ);
    const heroSpill: N = uHeroLight.mul(1.4).div(dz.mul(dz).mul(0.06).add(1));
    const pz: N = mod(uTime.mul(14), 110).negate().sub(4);
    const pq: N = o.z.sub(pz).div(1.6);
    const pulse: N = exp(pq.mul(pq).negate()).mul(0.9);
    const nearDim: N = o.big ? float(1) : smoothstep(0.3, 5, o.dist).mul(0.3).add(0.7);
    col = col.mul(float(o.big ? 1.0 : 0.8).add(heroSpill.mul(0.3)).mul(nearDim)).add(hex(AMBER).mul(pulse.mul(0.3)).mul(col.add(0.12)));
    // cache-hit flash
    const flash: N = loaded.mul(exp(max(o.x, 0).mul(o.big ? -0.9 : -1.6)));
    col = mix(col, mix(hex('#ffffff'), hex(AMBER), 0.35), flash.mul(0.85).mul(inDev));
    // fog + back face
    col = mix(col, fogCol(o.dist), fogAmt(o.dist));
    const back: N = mix(hex('#0a1d33'), fogCol(o.dist), fogAmt(o.dist));
    return vec4(select(frontFacing, col, back), max(inDev, step(0.5, lA)));
  };
  /** opaque cut-out: discard outside the device/label, write alpha 1 */
  const cutout = (c: N): N => Fn(() => { Discard(c.a.lessThan(0.5)); return vec4(c.rgb, 1); })();

  // =========================================================== tunnel devices (one instanced draw)
  const TS = 0.8; // tunnel device scale
  const appW = APPS.map((a) => Math.pow(a.stars, 0.3));
  const appWSum = appW.reduce((x, y) => x + y, 0);
  const pickApp = () => { let r = rnd() * appWSum; for (let i = 0; i < APPS.length; i++) { r -= appW[i]; if (r <= 0) return i; } return 0; };
  const count = PER_RING * RINGS;
  const aPos = new Float32Array(count * 4), aRight = new Float32Array(count * 3), aUp = new Float32Array(count * 3), aApp = new Float32Array(count);
  let n = 0;
  for (let r = 0; r < RINGS; r++) {
    for (let k = 0; k < PER_RING; k++) {
      if (rnd() < 0.12) continue;
      const phi = ((k + 0.5) / PER_RING) * Math.PI * 2 + r * 0.19 + (rnd() - 0.5) * 0.12;
      const rad = R + (rnd() - 0.5) * 0.55;
      const lean = 0.55 + (rnd() - 0.5) * 0.3; // tilt of the device normal towards the axis
      const ox = Math.cos(phi), oy = Math.sin(phi);
      const T = new Vector3(-oy, ox, 0);
      const right = new Vector3(1, 0, 0).applyAxisAngle(T, lean);
      const up = new Vector3(0, 1, 0).applyAxisAngle(T, lean);
      const nrm = new Vector3().crossVectors(right, up).normalize();
      const roll = (rnd() - 0.5) * 0.16;
      right.applyAxisAngle(nrm, roll); up.applyAxisAngle(nrm, roll);
      aPos.set([ox * rad, oy * rad, -r * RING_STEP + (rnd() - 0.5) * 0.5, rnd()], n * 4);
      aRight.set([right.x, right.y, right.z], n * 3);
      aUp.set([up.x, up.y, up.z], n * 3);
      aApp[n] = pickApp();
      n++;
    }
  }
  const iPos: N = instancedBufferAttribute(new InstancedBufferAttribute(aPos, 4), 'vec4');
  const iRight: N = instancedBufferAttribute(new InstancedBufferAttribute(aRight, 3), 'vec3');
  const iUp: N = instancedBufferAttribute(new InstancedBufferAttribute(aUp, 3), 'vec3');
  const iApp: N = instancedBufferAttribute(new InstancedBufferAttribute(aApp, 1), 'float');
  const qSize = (win: N): N => vec2(kmix(QUAD.phone[0], QUAD.win[0], win), kmix(QUAD.phone[1], QUAD.win[1], win));

  const tunnelMat = new MeshBasicNodeMaterial({ side: DoubleSide });
  tunnelMat.toneMapped = false;
  tunnelMat.fog = false;
  {
    const u: N = iPos.z.add(uS).sub(NEAR);
    const cyc: N = floor(u.div(L)).add(1);
    const z: N = iPos.z.add(uS).sub(cyc.mul(L));
    const seed: N = iPos.w.add(cyc.mul(0.6180339));
    const h2 = hash1(seed.add(0.371)), h4 = hash1(seed.add(0.137));
    const dist: N = z.negate();
    const snapD: N = h2.mul(19).add(7);
    const x: N = snapD.sub(dist);
    const pop: N = select(x.lessThan(0), float(0.93), float(1).add(sin(min(x.mul(4.5), Math.PI)).mul(exp(max(x, 0).mul(-1.5))).mul(0.16)));
    const oq: N = z.sub(uHeroZ).div(5);
    const open: N = float(1).add(uOpen.mul(0.16).mul(exp(oq.mul(oq).negate())));
    const win: N = step(N_PHONE - 0.5, iApp);
    const sz: N = qSize(win).mul(TS).mul(pop);
    const center: N = vec3(iPos.x.mul(open), iPos.y.mul(open), z);
    tunnelMat.positionNode = center.add(iRight.mul(positionGeometry.x.mul(sz.x))).add(iUp.mul(positionGeometry.y.mul(sz.y)));
    const vApp: N = varying(iApp, 'vCniApp');
    const vX: N = varying(x, 'vCniX');
    const vDist: N = varying(dist, 'vCniDist');
    const vZ: N = varying(z, 'vCniZ');
    const vSeed: N = varying(h4, 'vCniSeed');
    tunnelMat.colorNode = cutout(device({ uvN: uv(), win: step(N_PHONE - 0.5, vApp), app: vApp, x: vX, dist: vDist, z: vZ, seed: vSeed, big: false }));
  }
  const tunnel = new Mesh(new PlaneGeometry(1, 1), tunnelMat);
  (tunnel as any).count = n;
  tunnel.frustumCulled = false;
  scene.add(tunnel);

  // =========================================================== feature devices: big apps around the hero, cycling
  // [win, x, y, z offset vs hero, rotY, rotZ, scale]
  const FEAT = [
    [1, -2.6, 1.05, -0.9, 0.42, 0.03, 1.0],
    [0, 2.6, 0.3, -0.6, -0.42, -0.03, 1.2],
    [1, 2.95, -1.25, -1.6, -0.48, 0.04, 0.95],
    [0, -2.75, -1.4, -1.5, 0.48, -0.05, 0.9],
  ];
  const fPos = new Float32Array(FEAT.length * 4), fRot = new Float32Array(FEAT.length * 4);
  FEAT.forEach((f, i) => { fPos.set([f[1], f[2], f[3], f[0]], i * 4); fRot.set([f[4], f[5], f[6], i], i * 4); });
  const iFP: N = instancedBufferAttribute(new InstancedBufferAttribute(fPos, 4), 'vec4');
  const iFR: N = instancedBufferAttribute(new InstancedBufferAttribute(fRot, 4), 'vec4');
  const uFeat = uniform(0); // 0 hidden .. 1 placed
  const uSlotApp = uniform(new Vector4(0, 5, 1, 7));
  const uSlotX = uniform(new Vector4(-1, -1, -1, -1));
  const uFeatShift = uniform(new Vector3()); // extra offset (arrive / depart)
  const pick4 = (v: N, i: N): N => select(i.lessThan(0.5), v.x, select(i.lessThan(1.5), v.y, select(i.lessThan(2.5), v.z, v.w)));
  const featMat = new MeshBasicNodeMaterial({ side: DoubleSide });
  featMat.toneMapped = false;
  featMat.fog = false;
  {
    const ry: N = iFR.x, rz: N = iFR.y, sc: N = iFR.z, idx: N = iFR.w;
    const x: N = pick4(uSlotX, idx);
    const pop: N = select(x.lessThan(0), float(0.95), float(1).add(sin(min(x.mul(3), Math.PI)).mul(exp(max(x, 0).mul(-1.2))).mul(0.08)));
    const bob: N = sin(uTime.mul(0.6).add(idx.mul(1.57))).mul(0.04);
    const sz: N = qSize(iFP.w).mul(sc.mul(pop));
    let p: N = vec3(positionGeometry.x.mul(sz.x), positionGeometry.y.mul(sz.y), 0);
    const cz: N = sin(rz.add(Math.PI / 2)), szn: N = sin(rz);
    p = vec3(p.x.mul(cz).sub(p.y.mul(szn)), p.x.mul(szn).add(p.y.mul(cz)), p.z);
    const cy: N = sin(ry.add(Math.PI / 2)), sy: N = sin(ry);
    p = vec3(p.x.mul(cy).add(p.z.mul(sy)), p.y, p.z.mul(cy).sub(p.x.mul(sy)));
    const spread: N = float(1.6).sub(uFeat.mul(0.6));
    const world: N = vec3(iFP.x.mul(spread), iFP.y.add(bob), iFP.z.add(uHeroZ)).add(uFeatShift).add(p);
    featMat.positionNode = world;
    const vX: N = varying(x, 'vCniFX');
    const vZ: N = varying(world.z, 'vCniFZ');
    const vApp: N = varying(pick4(uSlotApp, idx), 'vCniFA');
    const vWin: N = varying(iFP.w, 'vCniFW');
    featMat.colorNode = cutout(device({ uvN: uv(), win: vWin, app: vApp, x: vX, dist: vZ.negate(), z: vZ, seed: idx.mul(0.25), big: true }));
  }
  const feat = new Mesh(new PlaneGeometry(1, 1), featMat);
  (feat as any).count = FEAT.length;
  feat.frustumCulled = false;
  scene.add(feat);

  // =========================================================== pubspec.yaml snippets streaming past
  const KEY = '#7cc4ff', VER = AMBER, DIM = '#7f93ad';
  const SNIPS: [string, string][][][] = [
    [[['dependencies:', PAPER]], [['  cached_network_image_ce', KEY], [': ', PAPER], ['^4.13.2', VER]]],
    [[['$ ', DIM], ['flutter pub add ', PAPER], ['cached_network_image_ce', KEY]]],
    [[['cached_network_image_ce', KEY], [': ', PAPER], ['^4.13.2', VER]]],
    [[['# pubspec.yaml', DIM]], [['cached_network_image_ce', KEY], [': ', PAPER], ['^4.13.2', VER]]],
  ];
  const snipTex = canvasTex(1024, 128 * SNIPS.length, (g) => {
    SNIPS.forEach((lines, i) => {
      const y = i * 128;
      g.fillStyle = 'rgba(3,14,30,0.82)'; g.beginPath(); g.roundRect(4, y + 6, 1016, 116, 18); g.fill();
      g.strokeStyle = 'rgba(74,163,255,0.45)'; g.lineWidth = 3; g.stroke();
      const fs = lines.length > 1 ? 38 : 46;
      g.font = `600 ${fs}px Menlo, Consolas, monospace`; g.textBaseline = 'middle';
      lines.forEach((segs, li) => {
        let x = 34;
        const ly = y + 64 + (lines.length > 1 ? (li - 0.5) * 46 : 0);
        for (const [txt, c] of segs) { g.fillStyle = c; g.fillText(txt, x, ly); x += g.measureText(txt).width; }
      });
    });
  });
  const SNN = high ? 40 : 26, SNL = 60;
  const snAttr = new Float32Array(SNN * 4);
  for (let i = 0; i < SNN; i++) {
    const side = i % 2 ? 1 : -1;
    const phi = (side > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 2.0;
    snAttr.set([phi, 1.75 + rnd() * 0.7, -(i + rnd() * 0.6) * (SNL / SNN), (i % SNIPS.length) + rnd() * 0.5], i * 4);
  }
  const iSn: N = instancedBufferAttribute(new InstancedBufferAttribute(snAttr, 4), 'vec4');
  const snipNode = texture(snipTex);
  const snipMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  snipMat.toneMapped = false;
  snipMat.fog = false;
  {
    const u: N = iSn.z.add(uS).add(uTime.mul(0.6)).sub(1);
    const z: N = u.sub(floor(u.div(SNL)).add(1).mul(SNL)).add(1);
    const c: N = sin(iSn.x.add(Math.PI / 2)), s: N = sin(iSn.x);
    const card: N = floor(iSn.w);
    const sc: N = fract(iSn.w).mul(0.5).add(0.85);
    const sz: N = vec2(2.2, 0.275).mul(sc);
    snipMat.positionNode = vec3(c.mul(iSn.y).mul(1.25), s.mul(iSn.y), z).add(vec3(positionGeometry.xy.mul(sz), 0));
    const vD: N = varying(z.negate(), 'vCniND');
    const vCard: N = varying(card, 'vCniNC');
    const t_: N = snipNode.sample(vec2(uv().x, float(1).sub(vCard.add(float(1).sub(uv().y)).div(SNIPS.length))));
    const heroDist: N = uHeroZ.negate();
    const nearHero: N = uOpen.mul(ssDown(heroDist.add(0.2), heroDist.add(1.4), vD));
    const fade: N = float(1).sub(fogAmt(max(vD, 0))).mul(smoothstep(0.8, 2.6, vD)).mul(float(1).sub(nearHero));
    snipMat.colorNode = vec4(t_.rgb, t_.a.mul(fade).mul(0.95));
  }
  const snips = new Mesh(new PlaneGeometry(1, 1), snipMat);
  (snips as any).count = SNN;
  snips.frustumCulled = false;
  snips.renderOrder = 1;
  scene.add(snips);

  // =========================================================== streaks (speed lines) and dust
  const SN = high ? 180 : 110;
  const sAttr = new Float32Array(SN * 4);
  for (let i = 0; i < SN; i++) sAttr.set([rnd() * Math.PI * 2, 1.4 + rnd() * 2.0, -rnd() * L, rnd()], i * 4);
  const iS: N = instancedBufferAttribute(new InstancedBufferAttribute(sAttr, 4), 'vec4');
  const streakMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
  streakMat.toneMapped = false;
  streakMat.fog = false;
  {
    const u: N = iS.z.add(uS.mul(1.15)).add(uTime.mul(2)).sub(NEAR);
    const z: N = u.sub(floor(u.div(L)).add(1).mul(L)).add(NEAR);
    const len: N = uSpeed.mul(7).add(0.25);
    const c: N = sin(iS.x.add(Math.PI / 2)), s: N = sin(iS.x);
    const center: N = vec3(c.mul(iS.y), s.mul(iS.y), z);
    const tang: N = vec3(s.negate(), c, 0);
    streakMat.positionNode = center.add(tang.mul(positionGeometry.x.mul(0.018))).add(vec3(0, 0, positionGeometry.y.mul(len)));
    const vD: N = varying(z.negate(), 'vCniSD');
    const vA: N = varying(iS.w, 'vCniSA');
    const along: N = uv().y;
    const fade: N = float(1).sub(fogAmt(max(vD, 0))).mul(smoothstep(0.0, 1.5, vD));
    const tint: N = select(vA.lessThan(0.12), hex(AMBER), hex('#4aa3ff'));
    streakMat.colorNode = vec4(tint.mul(along.mul(along)).mul(fade).mul(uSpeed.mul(1.4).add(0.12)), 1);
  }
  const streaks = new Mesh(new PlaneGeometry(1, 1).translate(0, 0.5, 0), streakMat);
  (streaks as any).count = SN;
  streaks.frustumCulled = false;
  scene.add(streaks);

  const DN = high ? 700 : 400;
  const dAttr = new Float32Array(DN * 4);
  for (let i = 0; i < DN; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 2.7;
    dAttr.set([Math.cos(a) * r, Math.sin(a) * r, -rnd() * 60, rnd()], i * 4);
  }
  const iD: N = instancedBufferAttribute(new InstancedBufferAttribute(dAttr, 4), 'vec4');
  const dustMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  dustMat.toneMapped = false;
  dustMat.fog = false;
  {
    const u: N = iD.z.add(uS).add(uTime.mul(0.4)).sub(1);
    const z: N = u.sub(floor(u.div(60)).add(1).mul(60)).add(1);
    const sz: N = iD.w.mul(0.025).add(0.012);
    const wob: N = vec3(sin(uTime.mul(0.5).add(iD.w.mul(40))).mul(0.12), sin(uTime.mul(0.37).add(iD.w.mul(23))).mul(0.12), 0);
    dustMat.positionNode = vec3(iD.x, iD.y, z).add(wob).add(vec3(positionGeometry.xy.mul(sz), 0));
    const vD: N = varying(z.negate(), 'vCniDD');
    const r: N = length(uv().sub(0.5)).mul(2);
    const a: N = smoothstep(1, 0.0, r).mul(float(1).sub(fogAmt(max(vD, 0)))).mul(smoothstep(0.3, 2.0, vD));
    dustMat.colorNode = vec4(hex('#9fd0ff').mul(a.mul(0.55)), 1);
  }
  const dust = new Mesh(new PlaneGeometry(1, 1), dustMat);
  (dust as any).count = DN;
  dust.frustumCulled = false;
  scene.add(dust);

  // =========================================================== hero: bezel + screenshot + badge + glow
  const hero = new Group();
  scene.add(hero);
  const uHalf = uniform(new Vector3(1.9, 1.15, 0)); // image half-size (xy)
  const uHeroX = uniform(-1); // hero snap progress (units)
  const uSlideFlash = uniform(0);
  const uReload = uniform(0); // slide change: 0 image .. 1 skeleton placeholder
  const uFit = uniform(new Vector3(1, 1, 0));
  const blank = canvasTex(4, 4, (g) => { g.fillStyle = '#0d3560'; g.fillRect(0, 0, 4, 4); });
  let texH: N = null; // the hero's sampling node

  // glow behind the hero (light spilling into the tunnel)
  const glowMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  glowMat.toneMapped = false;
  glowMat.fog = false;
  {
    const q: N = uv().sub(0.5).mul(2);
    const g: N = exp(length(q.mul(vec2(1, 1.25))).mul(-3.2));
    glowMat.colorNode = vec4(mix(hex('#0b62c4'), hex('#ffd27a'), exp(length(q).mul(-9)).mul(0.5)).mul(g.mul(uHeroLight).mul(0.9)), 1);
  }
  const glow = new Mesh(new PlaneGeometry(1, 1), glowMat);
  glow.position.z = -0.6;
  glow.renderOrder = -1;
  hero.add(glow);

  // bezel (Blender), 9-sliced to the image size
  const bezelMat = new MeshBasicNodeMaterial();
  bezelMat.toneMapped = false;
  bezelMat.fog = false;
  {
    const pg: N = positionGeometry;
    const shift: N = vec2(uHalf.x.sub(0.88), uHalf.y.sub(0.88));
    bezelMat.positionNode = vec3(pg.xy.add(sign(pg.xy).mul(shift)), pg.z);
    const nW: N = normalize(modelWorldMatrix.mul(vec4(normalGeometry, 0)).xyz);
    const V: N = normalize(cameraPosition.sub(positionWorld));
    const key: N = normalize(vec3(-0.5, 0.8, 0.6));
    const fill: N = normalize(vec3(0.7, -0.3, 0.5));
    const diff: N = max(dot(nW, key), 0).mul(0.55).add(max(dot(nW, fill), 0).mul(0.25)).add(0.12);
    const spec: N = pow(max(dot(nW, normalize(key.add(V))), 0), 48).mul(1.1);
    const rim: N = pow(float(1).sub(max(dot(nW, V), 0)), 3);
    const base: N = hex('#2a4a72');
    let c: N = base.mul(diff).add(hex('#e8f2ff').mul(spec)).add(hex('#2f8ae0').mul(rim.mul(0.9)));
    c = c.add(hex('#ffffff').mul(uSlideFlash.mul(0.25).add(exp(max(uHeroX, 0).mul(-0.9)).mul(step(0, uHeroX)).mul(0.6))));
    bezelMat.colorNode = c;
  }
  const bezel = new Mesh(new BufferGeometry(), bezelMat);
  bezel.frustumCulled = false;
  hero.add(bezel);

  // screenshot
  const imgMat = new MeshBasicNodeMaterial();
  imgMat.toneMapped = false;
  imgMat.fog = false;
  {
    const u0: N = uv();
    const fit = (f: N): N => u0.sub(0.5).mul(f.xy).add(0.5);
    // one texture; a slide change "reloads" the hero: image -> skeleton shimmer (swap) -> cache-hit flash
    texH = texture(blank, fit(uFit));
    let c: N = texH.rgb;
    const loaded: N = step(0, uHeroX).mul(float(1).sub(uReload));
    const shimmer: N = smoothstep(0.3, 0.0, abs(fract(u0.x.mul(0.8).add(u0.y.mul(0.4)).sub(uTime.mul(0.5))).sub(0.5)));
    const skel: N = mix(hex('#0d3560'), hex('#2a72b8'), shimmer.mul(0.5));
    c = mix(skel, c, loaded);
    // glass sheen + inner shadow from the bezel
    const sheen: N = smoothstep(0.06, 0.0, abs(u0.x.add(u0.y.mul(0.55)).sub(fract(uTime.mul(0.05)).mul(3).sub(0.6)))).mul(0.05);
    const e: N = min(min(u0.x, float(1).sub(u0.x)).mul(uHalf.x), min(u0.y, float(1).sub(u0.y)).mul(uHalf.y));
    c = c.mul(smoothstep(0.0, 0.05, e).mul(0.18).add(0.82)).add(sheen).add(hex('#ffffff').mul(u0.y.mul(0.025)));
    const flash: N = loaded.mul(exp(max(uHeroX, 0).mul(-0.9))).add(uSlideFlash.mul(0.55));
    c = mix(c, mix(hex('#ffffff'), hex(AMBER), 0.25), clamp(flash, 0, 1).mul(0.8));
    imgMat.colorNode = c;
  }
  const img = new Mesh(new PlaneGeometry(1, 1), imgMat);
  img.position.z = 0.012;
  hero.add(img);

  // badge above the top-left corner
  const uBadge = uniform(0);
  const badgeMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  badgeMat.toneMapped = false;
  badgeMat.fog = false;
  {
    const t: N = texture(badgeTex, uv());
    badgeMat.colorNode = vec4(t.rgb.add(uSlideFlash.mul(0.3)), t.a.mul(uBadge));
  }
  const badge = new Mesh(new PlaneGeometry(1, 112 / 640), badgeMat);
  badge.renderOrder = 2;
  hero.add(badge);

  // =========================================================== live pub.dev counter sign
  // static canvas (labels) + odometer digits from a glyph strip (per-digit roll uniforms: no canvas re-uploads)
  const SG_W = 2048, SG_H = 256, DIG_W = 112, DIG_Y = 28, DIG_H = 200;
  const DIG_X = [40, 152, 264, 426, 538, 650]; // comma sits in 376..426
  const signTex = canvasTex(SG_W, SG_H, (g) => {
    g.fillStyle = 'rgba(2,12,26,0.82)'; g.beginPath(); g.roundRect(3, 3, SG_W - 6, SG_H - 6, 34); g.fill();
    g.strokeStyle = 'rgba(74,163,255,0.6)'; g.lineWidth = 5; g.stroke();
    g.textBaseline = 'alphabetic';
    g.fillStyle = PAPER; g.font = 'bold 190px Helvetica, Arial, sans-serif'; g.fillText(',', 382, 196);
    g.fillStyle = PAPER; g.font = 'bold 72px Helvetica, Arial, sans-serif'; g.fillText('downloads', 800, 118);
    g.fillStyle = '#9fc8f0'; g.font = '600 50px Helvetica, Arial, sans-serif'; g.fillText('/ 30 days · pub.dev', 800, 190);
    g.fillStyle = AMBER; g.beginPath(); g.arc(1180, 96, 11, 0, Math.PI * 2); g.fill();
    g.font = 'bold 36px Helvetica, Arial, sans-serif'; g.fillText('LIVE', 1200, 109);
    g.fillStyle = 'rgba(74,163,255,0.5)'; g.fillRect(1404, 40, 4, 176);
    g.fillStyle = '#9fc8f0'; g.font = '600 42px Helvetica, Arial, sans-serif'; g.fillText('used by apps with', 1452, 80);
    g.fillStyle = AMBER; g.font = 'bold 100px Helvetica, Arial, sans-serif'; g.fillText('83k+ ★', 1452, 176);
    g.fillStyle = '#9fc8f0'; g.font = '600 42px Helvetica, Arial, sans-serif'; g.fillText('combined', 1452, 226);
  });
  const digitTex = canvasTex(128, 2000, (g) => {
    g.fillStyle = '#ffffff'; g.font = 'bold 190px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    for (let d = 0; d < 10; d++) g.fillText(String(d), 64, d * 200 + 168);
  });
  digitTex.generateMipmaps = false;
  digitTex.minFilter = LinearFilter;
  const uDigA = uniform(new Vector3()), uDigB = uniform(new Vector3()); // roll values d5 d4 d3 | d2 d1 d0
  const uSign = uniform(0), uTick = uniform(0), uDigits = uniform(6);
  const signNode = texture(signTex), digitNode = texture(digitTex);
  const signMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
  signMat.toneMapped = false;
  signMat.fog = false;
  {
    const u0: N = uv();
    const base: N = signNode.sample(u0);
    const X: N = u0.x.mul(SG_W), Y: N = float(1).sub(u0.y).mul(SG_H);
    const ends = [152, 264, 376, 538, 650, 762];
    let k: N = float(-1), start: N = float(0), val: N = float(0);
    const vals = [uDigA.x, uDigA.y, uDigA.z, uDigB.x, uDigB.y, uDigB.z];
    for (let i = 5; i >= 0; i--) {
      const inI: N = step(DIG_X[i], X).mul(step(X, ends[i]));
      k = select(inI.greaterThan(0.5), float(i), k);
      start = select(inI.greaterThan(0.5), float(DIG_X[i]), start);
      val = select(inI.greaterThan(0.5), vals[i], val);
    }
    const cx: N = X.sub(start).div(DIG_W), cy: N = Y.sub(DIG_Y).div(DIG_H);
    const inD: N = step(0, k).mul(box01(vec2(cx, cy))).mul(step(float(6).sub(uDigits), k.add(0.01))); // hide leading zeros
    const p: N = val.add(cy);
    const gl: N = digitNode.sample(vec2(clamp(cx, 0, 1).mul(DIG_W).add(8).div(128), float(1).sub(fract(p.div(10)))));
    const a: N = gl.a.mul(inD);
    const dcol: N = mix(hex(PAPER), hex(AMBER), uTick);
    signMat.colorNode = vec4(mix(base.rgb, dcol, a), max(base.a, a).mul(uSign));
  }
  const sign_ = new Mesh(new PlaneGeometry(1, SG_H / SG_W), signMat);
  sign_.renderOrder = 3;
  scene.add(sign_);

  // =========================================================== slides
  let slides: SlideImage[] = [];
  let slideTex: (Texture | null)[] = [];
  const slideLoads: (Promise<Texture> | null)[] = [];
  const loadSlide = (i: number): Promise<Texture> => {
    if (slideLoads[i]) return slideLoads[i]!;
    const s = slides[i];
    const p = slideTex[i] ? Promise.resolve(slideTex[i]!) : loader.loadAsync(s.src).then((t) => {
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 8;
      slideTex[i] = t;
      return t;
    });
    slideLoads[i] = p;
    return p;
  };
  const aspectOf = (i: number) => (slides[i] ? slides[i].w / slides[i].h : 1.6);
  let shown = -1, target = 0, aspCur = 1.68, aspTo = 1.68, slideFlashAge = 99;
  // slide change: reloadPh 0..1 fades to the skeleton, the texture swaps at 1, then reloadPh 1..2 snaps back in
  let reloadPh = 2, pending: { i: number; t: Texture } | null = null;

  async function initSlides() {
    let list: SlideImage[] | null = ctx.slides && ctx.slides.length ? ctx.slides : null;
    list ??= await fetchManifest(`/projects/${ctx.project.id}/manifest.json`);
    list ??= await fetchManifest('/projects/_placeholder/manifest.json');
    if (list) {
      slides = list;
      slideTex = list.map(() => null);
      try { await loadSlide(0); return; } catch { /* fall through to canvases */ }
    }
    const ph = placeholderSlides(ctx.project.title);
    slides = ph.slides;
    slideTex = ph.tex;
    slideLoads.length = 0;
  }

  // =========================================================== loading
  const ready = (async () => {
    const [gltf] = await Promise.all([
      new GLTFLoader().loadAsync(ASSET + 'bezel.glb'),
      initSlides(),
      loadApps(),
    ]);
    let geo: BufferGeometry | null = null;
    gltf.scene.traverse((o: any) => { if (!geo && o.isMesh) geo = o.geometry; });
    if (geo) bezel.geometry = geo;
    showSlide(0, true);
  })();

  /** "cover" mapping uv' = (uv-.5)*k+.5 for a texture of aspect texAsp on a plane of aspect planeAsp */
  function setFit(f: N, texAsp: number, planeAsp: number) {
    f.value.set(Math.min(1, planeAsp / texAsp), Math.min(1, texAsp / planeAsp), 0);
  }

  function showSlide(i: number, instant = false) {
    if (!slides.length) return;
    i = ((i % slides.length) + slides.length) % slides.length;
    target = i;
    if (i === shown) { // back to the slide on screen before the swap: cancel and fade the skeleton back out
      pending = null;
      if (reloadPh < 1) reloadPh = 2 - reloadPh;
      return;
    }
    pending = null;
    if (!instant && shown >= 0 && reloadPh > 1) reloadPh = reloadPh >= 2 ? 0 : 2 - reloadPh; // fade to the skeleton now
    loadSlide(i).then((t) => {
      if (target !== i || shown === i) return;
      if (instant || shown < 0) { swapTo(i, t); aspCur = aspTo; return; }
      pending = { i, t }; // swapped in once the skeleton fully covers the hero
    }).catch(() => {
      if (target === i && reloadPh <= 1) reloadPh = 2 - reloadPh + 1e-4; // failed: fade back to the current slide
    });
  }

  function swapTo(i: number, t: Texture) {
    texH.value = t;
    aspTo = aspectOf(i);
    shown = i;
    pending = null;
  }
  // =========================================================== per-frame
  const camPos = new Vector3(), look = new Vector3(), signDock = new Vector3(), signArr = new Vector3();
  let holdClock = 0, lastTick = 0, tickAge = 99;
  let smoothPx = 0, smoothPy = 0;

  function update(f: StageFrame) {
    const time = f.time;
    const dt = Math.min(0.05, Math.max(0, f.dt));
    uTime.value = time;
    const t = Math.max(-0.3, Math.min(1.3, f.t));
    const tr = travel(t);
    uS.value = tr.s + time * IDLE_SPEED;
    uSpeed.value = clamp01(tr.v / 900);

    if (slides.length) {
      const want = ((f.slide % slides.length) + slides.length) % slides.length;
      if (want !== target) showSlide(want);
    }
    if (reloadPh < 2) {
      if (reloadPh < 1) reloadPh = Math.min(1, reloadPh + dt / 0.2);
      else if (pending) { swapTo(pending.i, pending.t); slideFlashAge = 0; reloadPh = 1 + 1e-4; }
      else if (reloadPh === 1 && target !== shown) { /* skeleton holds until the texture arrives */ }
      else reloadPh = Math.min(2, reloadPh + dt / 0.32);
    }
    uReload.value = reloadPh < 1 ? sstep(0, 1, reloadPh) : 1 - sstep(1, 2, reloadPh);
    aspCur += (aspTo - aspCur) * damp(14, dt);
    if (Math.abs(aspTo - aspCur) < 1e-3) aspCur = aspTo;
    slideFlashAge += dt; // dt-driven so it also decays with a frozen clock
    uSlideFlash.value = Math.exp(-slideFlashAge * 5);

    // ---- hero pose
    const yDep = clamp01((t - H_END) / (1 - H_END));
    const heroD = t < A_END ? HERO_D + (ARRIVE_DIST - tr.arrive) : HERO_D;
    uHeroX.value = HERO_LOAD - heroD;
    const asp = aspCur;
    // fit the hero into the visible band (top 72% of the screen) at its rest distance
    const visH = 2 * HERO_D * Math.tan((25 * Math.PI) / 180);
    const visW = visH * f.aspect;
    let hh = 0.5 * Math.min(visH * (asp < 1 ? 0.4 : 0.35), (visW * (f.aspect < 1 ? 0.82 : 0.56)) / asp);
    let hw = hh * asp;
    if (hw * 2 > visW * 0.84) { hw = visW * 0.42; hh = hw / asp; }
    uHalf.value.set(hw, hh, 0);
    img.scale.set(hw * 2, hh * 2, 1);
    setFit(uFit, aspTo, asp);
    glow.scale.set(hw * 2 + 7, hh * 2 + 6, 1);
    const bW = Math.min(1.0, Math.max(0.7, hw * 0.6));
    badge.scale.setScalar(bW);
    badge.position.set(-hw - 0.22 + bW * 0.5, -hh - 0.01, 0.22); // straddles the bezel's bottom edge: clear of the DOM panel

    const kk = sstep(0, 0.35, yDep); // tuck into the wall
    const departZ = DEPART_DIST * Math.pow(yDep, 2.2) * sstep(0.05, 0.4, yDep);
    const bob = Math.sin(time * 0.7) * 0.035;
    hero.position.set(lerp(0, -2.4, kk), lerp(bob - HERO_DROP, 0.55, kk), -heroD + departZ * 1.0);
    hero.rotation.set(Math.sin(time * 0.45) * 0.012 - smoothPy * 0.05, lerp(-smoothPx * 0.07, 0.75, kk), Math.sin(time * 0.3) * 0.008);
    hero.scale.setScalar(lerp(1, 0.38, kk));
    uHeroZ.value = hero.position.z;
    const holdIn = sstep(0.1, A_END + 0.02, t);
    uHeroLight.value = (uHeroX.value > 0 ? 1 : 0.35) * lerp(0.45, 1, holdIn) * (1 - kk * 0.8);
    uOpen.value = holdIn * (1 - kk);
    uBadge.value = clamp01(uHeroX.value / 1.5) * (1 - kk);

    // feature frames snap in right after the hero, and are swept along on departure
    uFeat.value = sstep(A_END - 0.08, A_END + 0.03, t);
    for (let s = 0; s < FEAT.length; s++) {
      const win = FEAT[s][0] === 1, nk = win ? N_WIN : N_PHONE;
      const c = time / SLOT_P + s * 0.27 + 0.1, kc = Math.floor(c);
      const off = s >= 2 ? 2 : 0;
      const app = (win ? N_PHONE : 0) + ((((off + kc) % nk) + nk) % nk);
      const xc = ((c - kc) * SLOT_P - SLOT_SKEL) * 4;
      const xa = (t - (A_END - 0.06)) * 40 - s * 0.35;
      uSlotApp.value.setComponent(s, app);
      uSlotX.value.setComponent(s, Math.min(xa, xc));
    }
    uFeatShift.value.set(0, 0, departZ * 1.15 + (t < A_END ? heroD - HERO_D : 0));

    // ---- counter sign: big in the tunnel during the arrive, docked above the hero for the hold
    if (t < A_END - 0.01) holdClock = 0; else holdClock += dt;
    const xc = clamp01((t - 0.01) / 0.2);
    const live = holdClock * DL_RATE;
    const liveInt = Math.floor(live);
    if (liveInt !== lastTick) { lastTick = liveInt; tickAge = 0; }
    tickAge += dt;
    const Nv = t < A_END - 0.01 ? DOWNLOADS * (1 - Math.pow(1 - xc, 4)) : DOWNLOADS + liveInt + sstep(0.93, 1, live - liveInt);
    const dig = [0, 1, 2, 3, 4, 5].map((i) => {
      const pl = Math.pow(10, i);
      const fl = Math.floor(Nv / pl) % 10;
      return i === 0 ? Nv % 10 : fl + clamp01((Nv % pl) - (pl - 1));
    });
    uDigits.value = Math.max(1, Math.floor(Math.log10(Math.max(1, Nv))) + 1);
    uDigA.value.set(dig[5], dig[4], dig[3]);
    uDigB.value.set(dig[2], dig[1], dig[0]);
    uTick.value = holdClock > 0.5 ? Math.exp(-tickAge * 2.5) * 0.8 : 0;
    const sgW = Math.min(visW * 0.44, 3.1);
    hero.updateMatrixWorld();
    signDock.set(0, hh + 0.08 + sgW * (SG_H / SG_W) * 0.5, 0.03);
    hero.localToWorld(signDock);
    const zA = 8.5, vwA = 2 * zA * Math.tan((25 * Math.PI) / 180) * f.aspect, wA = vwA * (f.aspect > 1 ? 0.6 : 0.9);
    signArr.set(f.aspect > 1 ? vwA * 0.12 : 0, -Math.tan(PITCH) * zA + 0.75, -zA); // right of centre: clear of the left nav
    const dk = sstep(0.07, 0.18, t);
    sign_.position.lerpVectors(signArr, signDock, dk);
    sign_.quaternion.identity().slerp(hero.quaternion, dk);
    sign_.scale.setScalar(lerp(wA, sgW * hero.scale.x, dk));
    uSign.value = sstep(-0.03, 0.03, t) * (1 - sstep(0.4, 0.9, yDep));

    // ---- camera
    const k = damp(4, dt);
    smoothPx += (f.parallax.x - smoothPx) * k;
    smoothPy += (f.parallax.y - smoothPy) * k;
    const sp = uSpeed.value;
    const driftX = Math.sin(time * 0.21) * 0.08, driftY = Math.sin(time * 0.17 + 1) * 0.05;
    camPos.set(smoothPx * 0.45 + driftX, smoothPy * 0.25 + driftY, 0);
    camera.position.copy(camPos);
    look.set(smoothPx * 0.12, -Math.tan(PITCH) * HERO_D + smoothPy * 0.06, -HERO_D);
    camera.lookAt(look);
    camera.rotateZ(Math.sin(time * 0.23) * 0.012 + Math.sin(uS.value * 0.05) * sp * 0.06);
    const fov = 50 + sp * 9;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();

    // vanishing point of the tunnel axis in screen uv (top-left origin)
    const vp = new Vector3(camPos.x, 0, -1000).project(camera);
    uVP.value.set(vp.x * 0.5 + 0.5, 0.5 - vp.y * 0.5, f.aspect);
  }

  const damp = (kk: number, d: number) => 1 - Math.exp(-kk * d);

  return {
    id: ctx.project.id,
    scene,
    camera,
    background,
    ready,
    update,
    dispose() {
      scene.traverse((o: any) => { if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose(); } });
      for (const t of slideTex) t?.dispose();
      hitTex.dispose(); badgeTex.dispose(); blank.dispose(); appTex.dispose(); labelTex.dispose(); snipTex.dispose(); signTex.dispose(); digitTex.dispose();
    },
  };
}
