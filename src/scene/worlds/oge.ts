/**
 * Öge world: "One Desk", a dark control room of coding-agent monitors.
 *
 *   arrive (t 0 → .22)  crane down the aisle between sawtooth desk rows while the monitors wake in a wave
 *                       and the wall display boots
 *   hold   (t .22 → .82) seated at the verification console: the featured real screenshot fills the wall display,
 *                       the receipt printer feeds out the run receipt (.24 → .58), the ACCEPTED stamp drops (.60 → .74)
 *   depart (t .82 → 1)  push into the wall display (portalQuad = its corners)
 *
 * Draws (~17): room shell, floor, strips, desks, monitors, screens, chairs, wall frame, wall screen, pedestal,
 * printer, stamp, paper, dust. Every instanced set also carries its mirror image (y → -y) as extra instances,
 * seen through the semi-transparent polished floor. One custom lighting function (wall display area light,
 * monitor-row line lights, ceiling strips, console accent) + exp² fog + in-scatter toward the wall display + AgX.
 */
import {
  Scene, Color, Mesh, InstancedMesh, PerspectiveCamera, BufferGeometry, BufferAttribute, InstancedBufferAttribute,
  PlaneGeometry, BoxGeometry, MeshBasicNodeMaterial, CanvasTexture, Texture, TextureLoader, SRGBColorSpace, RepeatWrapping,
  ClampToEdgeWrapping, Matrix4, Vector3, Quaternion, Euler, Group, Object3D, DoubleSide, BackSide, AdditiveBlending,
  NormalBlending, type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, attribute, texture, instancedBufferAttribute, positionWorld, normalWorld,
  positionGeometry, cameraPosition, uv, mix, smoothstep, clamp, max, min, pow, exp, length, normalize, dot, sin, cos,
  floor, fract, step, select, abs, agxToneMapping, varying, sign, If, sqrt,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Stage, StageFrame, ProjectWorldContext, SlideImage } from '../journey/types';

type N = any;
/** smoothstep with hi > lo edges (falling); WGSL rejects smoothstep(lo>=hi) */
const rsmooth = (hi: any, lo: any, x: any): any => float(1).sub(smoothstep(lo, hi, x));

// ------------------------------------------------------------------ palette
const ORANGE = new Color('#ff5a1f');
const CREAM = '#f4f1ea';
const BG = new Color(0.006, 0.0055, 0.005);

// ------------------------------------------------------------------ layout (metres)
const SW = 3.6, SH = 2.143;                 // wall display screen
const C = new Vector3(0, 2.18, -12);        // wall display centre
const WALL_Z = -12.45;
const FOV = 50;
const ARRIVE = 0.22, DEPART = 0.82;
// pedestal deck frame (must match tools/blender/worlds/oge/build.py)
const TOP_F = 0.98, THETA = 0.5, DZ = 0.3;
const PED_POS = new Vector3(1.75, 0, -10.1);
const PED_ROT = -0.6;
const PAPER_W = 0.11;
const RECEIPT_L = 0.78;                      // full receipt length (m)
const PRINT_L = 0.7;                         // printed by the end of the feed
const STAMP_Z = -0.17;                       // stamp centre on the deck (deck-local z)
const MON_W = 0.6, MON_H = 0.36;

const sat = (x: number) => Math.min(1, Math.max(0, x));
const sstep = (a: number, b: number, x: number) => { const k = sat((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeIn = (x: number) => x * x * x;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ slides
async function loadSlides(ctx: ProjectWorldContext): Promise<SlideImage[]> {
  if (ctx.slides && ctx.slides.length) return ctx.slides;
  for (const url of [`/projects/${ctx.project.id}/manifest.json`, '/projects/_placeholder/manifest.json']) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j) && j.length) return j;
      }
    } catch { /* try next */ }
  }
  return [];
}

function placeholderCanvas(i: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 1680; cv.height = 1000;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0d0d0d'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#ff5a1f'; g.fillRect(80, 80, 18, 120);
  g.fillStyle = CREAM; g.font = 'bold 110px Helvetica, Arial, sans-serif';
  g.fillText('Öge', 130, 190);
  g.font = '40px Menlo, monospace'; g.fillStyle = '#9a958b';
  g.fillText(`screen ${i + 1}: supervision layer for coding agents`, 130, 280);
  for (let k = 0; k < 9; k++) {
    g.fillStyle = k % 3 === 0 ? '#ff5a1f' : '#2a2826';
    g.fillRect(130, 360 + k * 62, 300 + ((k * 137 + i * 61) % 900), 34);
  }
  return cv;
}

// ------------------------------------------------------------------ terminal atlas (4 streams × 512 px)
const AGENTS = ['claude-code', 'codex', 'antigravity'];
const TASKS = [
  'fix flaky TestReceiptSigner', 'add rate limit to /v1/upload', 'migrate settings to sqlite', 'paginate /runs',
  'retry webhook sender', 'bump go 1.25, fix vet', 'split auth middleware', 'cache run artifacts', 'stream agent logs',
  'dedupe QA findings', 'harden worktree cleanup', 'add budget guard',
];
const FILES = ['internal/receipt/signer.go', 'cmd/oge/run.go', 'internal/qa/review.go', 'internal/store/runs.go',
  'internal/agent/codex.go', 'web/src/RunList.tsx', 'internal/loop/repair.go', 'internal/hook/webhook.go'];

type Line = [string, string];
function runLines(rng: () => number, n: number): Line[] {
  const L: Line[] = [];
  const agent = AGENTS[Math.floor(rng() * 3)];
  const qa = AGENTS[(AGENTS.indexOf(agent) + 1 + Math.floor(rng() * 2)) % 3];
  const task = TASKS[Math.floor(rng() * TASKS.length)];
  const id = Math.floor(rng() * 0xffff).toString(16).padStart(4, '0');
  L.push(['o', `$ oge run --agent ${agent}`]);
  L.push(['c', `  "${task}"`]);
  L.push(['d', `run  r-${id}  wt/${id}  budget 25m`]);
  for (let k = 0; k < 2 + Math.floor(rng() * 3); k++) {
    const f = FILES[Math.floor(rng() * FILES.length)];
    L.push(['c', `edit ${f}`]);
    L.push(['d', `     +${Math.floor(rng() * 90 + 3)} -${Math.floor(rng() * 30)}`]);
  }
  L.push(['d', `qa   independent → ${qa}`]);
  L.push(['c', `qa   go test ./...  ${Math.floor(rng() * 300 + 40)} passed`]);
  const fail = rng() < 0.45;
  if (fail) {
    L.push(['r', `qa   review: ${1 + Math.floor(rng() * 2)} finding(s)`]);
    L.push(['o', `loop repair 1/3`]);
    L.push(['c', `edit ${FILES[Math.floor(rng() * FILES.length)]}`]);
    L.push(['c', `qa   re-check        ok`]);
  } else L.push(['c', `qa   review          ok`]);
  L.push(['o', `✔ ACCEPTED  receipt #${String(n).padStart(4, '0')}`]);
  L.push(['d', ` `]);
  return L;
}

function makeTerminalAtlas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 2048; cv.height = 2048;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0b0a09'; g.fillRect(0, 0, 2048, 2048);
  const LH = 30;
  const cols: Record<string, string> = { o: '#ff6a32', c: '#e9e4d8', d: '#7d776d', r: '#e0614a' };
  g.textBaseline = 'top';
  for (let col = 0; col < 4; col++) {
    const rng = mulberry(97 + col * 31);
    const x0 = col * 512;
    let y = 0, n = 200 + col * 37;
    g.save();
    g.beginPath(); g.rect(x0, 0, 512, 2048); g.clip();
    while (y < 2048) {
      for (const [k, s] of runLines(rng, n++)) {
        if (y >= 2048) break;
        g.fillStyle = cols[k];
        g.font = `${k === 'o' ? 'bold ' : ''}21px Menlo, ui-monospace, monospace`;
        g.fillText(s, x0 + 14, y + 4);
        y += LH;
      }
    }
    g.restore();
    g.fillStyle = '#1a1714'; g.fillRect(x0 + 510, 0, 2, 2048);
  }
  return cv;
}

function containDraw(g: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// ------------------------------------------------------------------ receipt + ink
function makeReceipt(stampV: number): HTMLCanvasElement {
  const W = 352, H = Math.round((W * RECEIPT_L) / PAPER_W);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = CREAM; g.fillRect(0, 0, W, H);
  g.fillStyle = '#2a2724'; g.textBaseline = 'top';
  const mono = (sz: number, b = false) => `${b ? 'bold ' : ''}${sz}px Menlo, ui-monospace, monospace`;
  // receipt coordinate v (0 = first printed) maps to canvas y = (1 - v)·H (canvas top is printed last, nearest the printer)
  const gapTop = (1 - stampV) * H - 120, gapBot = (1 - stampV) * H + 120;
  let y = (1 - PRINT_L / RECEIPT_L) * H + 40;
  const line = (s: string, sz = 20, b = false, dy = 30) => {
    if (y + dy > gapTop && y < gapBot) y = gapBot;
    g.font = mono(sz, b);
    g.fillText(s, 22, y);
    y += dy;
  };
  const rule = () => { line('- - - - - - - - - - - - -', 18, false, 28); };
  line('ÖGE', 44, true, 54);
  line('ONE DESK · RUN RECEIPT', 18, true, 34);
  rule();
  line('#0219   2026-11-12 15:42');
  line('task  fix flaky');
  line('      TestReceiptSigner');
  line('agent claude-code');
  line('qa    codex (independent)');
  rule();
  line('tests  go test ./...');
  line('       212 passed');
  line('vet    ok');
  line('review 1 finding');
  line('repair loop 1/3  fixed');
  line('recheck          ok');
  rule();
  line('diff  +59 -8   2 files');
  line('time  4m12s   cost $0.41');
  line('sha   7f3a91c');
  rule();
  line('human review: not needed');
  line('signed ed25519 · 9c1e…');
  rule();
  line('thank you for shipping', 18, false, 30);
  // perforation / tear marks
  g.fillStyle = '#d6d0c2';
  for (let x = 0; x < W; x += 16) g.fillRect(x, 4, 8, 3);
  return cv;
}

function makeInk(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 320;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, 512, 320);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff';
  g.lineWidth = 14; g.strokeRect(18, 18, 476, 284);
  g.lineWidth = 5; g.strokeRect(40, 40, 432, 240);
  g.font = 'bold 92px Helvetica, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('ACCEPTED', 256, 150);
  g.font = 'bold 30px Menlo, monospace';
  g.fillText('ÖGE · QA VERIFIED', 256, 232);
  // rubber-stamp wear: knock out speckles
  g.globalCompositeOperation = 'destination-out';
  const r = mulberry(7);
  for (let i = 0; i < 900; i++) { g.globalAlpha = 0.3 + r() * 0.7; g.fillRect(r() * 512, r() * 320, 1 + r() * 3, 1 + r() * 3); }
  return cv;
}

// ==================================================================================================
export function createWorld(ctx: ProjectWorldContext): Stage {
  const high = ctx.quality === 'high';
  const scene = new Scene();
  scene.background = BG;
  const camera = new PerspectiveCamera(FOV, 16 / 10, 0.05, 60);

  // ---------------------------------------------------------------- uniforms
  const uTime = uniform(0);
  const uT = uniform(0);
  const uScr = uniform(new Color(0.5, 0.48, 0.45));   // wall display light colour (slide average)
  const uScrI = uniform(0);                            // wall display power 0..1
  const uFlash = uniform(0);                           // stamp impact flash
  const uInk = uniform(0);
  const uMix = uniform(0);
  const uAspA = uniform(1.68), uAspB = uniform(1.68);
  const uPedLight = uniform(new Vector3());
  const uInkV = uniform(0.5);
  const uDepart = uniform(0);

  // ---------------------------------------------------------------- lighting
  const ORANGE_V = vec3(ORANGE.r, ORANGE.g, ORANGE.b);
  const MON_COL = vec3(0.85, 0.72, 0.58);
  const fogCol = vec3(0.012, 0.0105, 0.0095);

  /** P/N may be mirrored (P.y < 0): shading uses the reflected point/normal (that's what the floor mirror shows) */
  function shade(Pin: N, Nin: N, alb: N, cls: N): N {
    const mir = step(Pin.y, -0.001);
    const P = vec3(Pin.x, abs(Pin.y), Pin.z);
    const Nr = normalize(Nin);
    const Nn: N = normalize(mix(Nr, vec3(Nr.x, Nr.y.negate(), Nr.z), mir));
    const V: N = normalize(cameraPosition.sub(Pin)).mul(vec3(1, float(1).sub(mir.mul(2)), 1));
    const glossy = step(0.6, cls).mul(step(cls, 0.9));
    const metal = step(0.4, cls).mul(step(cls, 0.6));
    const shin: N = mix(mix(float(8), float(28), metal), float(70), glossy);
    const ks: N = mix(mix(float(0.06), float(0.35), metal), float(0.55), glossy).mul(step(cls, 0.95));
    let diff: N = vec3(0), spec: N = vec3(0);
    // wall display: 3 samples across the width
    const scr = uScr.mul(uScrI);
    for (const sx of [-1.25, 0, 1.25]) {
      const D = vec3(float(sx).add(C.x), C.y, C.z + 0.15).sub(P);
      const d2 = dot(D, D);
      const L = D.div(sqrt(d2));
      const face = max(L.z.negate(), 0);
      const ndl = max(dot(Nn, L), 0);
      const att = face.div(d2.add(0.8)).mul(1.4);
      diff = diff.add(scr.mul(ndl.mul(att)));
      const H = normalize(L.add(V));
      spec = spec.add(scr.mul(pow(max(dot(Nn, H), 0), shin).mul(shin.add(8).div(25)).mul(ndl).mul(att)));
    }
    // monitor rows: line lights along z facing the aisle (inner |x| 2.0) and the raised outer rows (|x| 4.1)
    for (const [lx, ly, k] of [[-2.15, 1.2, 0.3], [2.15, 1.2, 0.3], [-4.2, 1.55, 0.2], [4.2, 1.55, 0.2]] as const) {
      const s = Math.sign(lx);
      const Q = vec3(lx, ly, clamp(P.z, -10.6, 9));
      const D = Q.sub(P);
      const d = max(length(D), 0.08);
      const L = D.div(d);
      const face = max(L.x.mul(s), 0).mul(0.75).add(0.25);
      const ndl = max(dot(Nn, L), 0);
      const att = face.div(d.add(0.35)).mul(k);
      diff = diff.add(MON_COL.mul(ndl.mul(att)));
      const H = normalize(L.add(V));
      spec = spec.add(MON_COL.mul(pow(max(dot(Nn, H), 0), shin).mul(shin.add(8).div(40)).mul(ndl).mul(att)));
    }
    // ceiling strips (cool, dim)
    for (const lx of [-1.2, 1.2]) {
      const Q = vec3(lx, 4.3, clamp(P.z, -11.5, 12));
      const D = Q.sub(P);
      const d = max(length(D), 0.1);
      const L = D.div(d);
      const ndl = max(dot(Nn, L), 0);
      const att = max(L.y, 0).div(d.add(0.5)).mul(0.22);
      diff = diff.add(vec3(0.55, 0.62, 0.75).mul(ndl.mul(att)));
      const H = normalize(L.add(V));
      spec = spec.add(vec3(0.55, 0.62, 0.75).mul(pow(max(dot(Nn, H), 0), shin).mul(shin.add(8).div(40)).mul(ndl).mul(att)));
    }
    // console accent (orange, flashes on the stamp)
    {
      const D = uPedLight.sub(P);
      const d2 = dot(D, D);
      const L = D.div(sqrt(d2));
      const ndl = max(dot(Nn, L), 0);
      const I = float(0.05).add(uFlash.mul(0.9));
      diff = diff.add(ORANGE_V.mul(ndl.mul(I).div(d2.add(0.05))));
    }
    const amb = mix(vec3(0.003, 0.0025, 0.0022), vec3(0.006, 0.0065, 0.008), Nn.y.mul(0.5).add(0.5));
    let c: N = alb.mul(diff.add(amb)).add(spec.mul(ks));
    // emissive class
    c = mix(c, alb.mul(2.2), step(cls, 0.1));
    return c;
  }

  /** fog + in-scatter toward the wall display, then AgX */
  function finish(c: N, Pw: N, extraFog: N = float(0)): N {
    const toP = Pw.sub(cameraPosition);
    const dist = length(toP);
    const fd = dist.mul(0.052);
    const fog = min(float(1).sub(exp(fd.mul(fd).negate())).add(extraFog), 1);
    const vd = toP.div(dist);
    const toC = normalize(vec3(C.x, C.y, C.z).sub(cameraPosition));
    const scat = pow(max(dot(vd, toC), 0), 18).mul(0.11).add(pow(max(dot(vd, toC), 0), 3).mul(0.025));
    const inscatter = uScr.mul(uScrI).mul(scat).mul(float(1).sub(exp(dist.mul(-0.12))));
    const hc = mix(c, fogCol, fog).add(inscatter);
    return agxToneMapping(hc.mul(1.25), float(1));
  }

  const vcol = () => attribute('color', 'vec4') as N;
  function litMaterial(double = true) {
    const m = new MeshBasicNodeMaterial();
    m.toneMapped = false;
    m.fog = false;
    if (double) m.side = DoubleSide;
    m.colorNode = Fn(() => {
      const vc = vcol();
      const c = shade(positionWorld, normalWorld, vc.rgb, vc.a);
      return vec4(finish(c, positionWorld), 1);
    })();
    return m;
  }

  // ---------------------------------------------------------------- textures
  const termCanvas = makeTerminalAtlas();
  const termTex = new CanvasTexture(termCanvas);
  termTex.colorSpace = SRGBColorSpace;
  termTex.wrapT = RepeatWrapping;
  termTex.anisotropy = 4;
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 2048; thumbCanvas.height = 1024;
  const thumbTex = new CanvasTexture(thumbCanvas);
  thumbTex.colorSpace = SRGBColorSpace;
  const blank = new CanvasTexture(placeholderCanvas(0));
  blank.colorSpace = SRGBColorSpace;
  let slideTex: Texture[] = [];
  let slideAvg: Color[] = [];
  // wall display texture nodes: uv/level are attached inside the material Fn; only .value changes afterwards
  const texA: N = texture(blank), texB: N = texture(blank);
  const inkTex = new CanvasTexture(makeInk());
  inkTex.colorSpace = SRGBColorSpace;
  let receiptTex: CanvasTexture | null = null;

  // ---------------------------------------------------------------- room shell (walls + ceiling; mirrored below the floor)
  {
    const geo = new BoxGeometry(15, 9.6, 27.2);
    geo.translate(0, 0, WALL_Z + 13.6); // back face at WALL_Z
    const m = new MeshBasicNodeMaterial();
    m.side = BackSide; m.toneMapped = false; m.fog = false;
    m.colorNode = Fn(() => {
      const P: N = positionWorld;
      const Nn: N = normalWorld.negate();
      const Pa = vec3(P.x, abs(P.y), P.z);
      // panel grid on walls, coffers on the ceiling
      const isCeil = step(0.5, Nn.y.negate().mul(sign(P.y)));
      const u = mix(select(abs(Nn.x).greaterThan(0.5), Pa.z, Pa.x), Pa.x, isCeil);
      const v = mix(Pa.y, Pa.z, isCeil);
      const pu = fract(u.div(1.2)), pv = fract(v.div(mix(float(0.9), float(1.2), isCeil)));
      const seam = max(smoothstep(0.985, 1, pu).add(rsmooth(0.015, 0, pu)), smoothstep(0.98, 1, pv).add(rsmooth(0.02, 0, pv)));
      const tone = fract(sin(dot(floor(vec2(u.div(1.2), v.div(0.9))), vec2(12.9898, 78.233))).mul(43758.5453));
      let alb: N = vec3(0.028, 0.026, 0.025).mul(tone.mul(0.35).add(0.8)).mul(float(1).sub(seam.mul(0.7)));
      // back wall: subtle vertical acoustic ribs behind the display
      const back = step(0.5, Nn.z);
      const rib = smoothstep(0.35, 0.5, abs(fract(P.x.mul(6)).sub(0.5)));
      alb = mix(alb, vec3(0.022, 0.02, 0.019).mul(rib.mul(0.5).add(0.6)), back);
      const c = shade(P, Nn, alb, float(0.25));
      return vec4(finish(c, P), 1);
    })();
    const mesh = new Mesh(geo, m);
    mesh.position.y = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- floor (polished, semi-transparent over the mirror world)
  {
    const geo = new PlaneGeometry(15, 27.2);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, WALL_Z + 13.6);
    const m = new MeshBasicNodeMaterial();
    m.transparent = true; m.depthWrite = true; m.toneMapped = false; m.fog = false;
    m.colorNode = Fn(() => {
      const P: N = positionWorld;
      const tile = vec2(fract(P.x.div(1.2).add(0.5)), fract(P.z.div(1.2)));
      const seam = max(rsmooth(0.012, 0, tile.x).add(smoothstep(0.988, 1, tile.x)), rsmooth(0.012, 0, tile.y).add(smoothstep(0.988, 1, tile.y)));
      const n = fract(sin(dot(floor(P.xz.mul(vec2(7.0, 7.0))), vec2(12.9898, 78.233))).mul(43758.5453));
      const alb = vec3(0.02, 0.019, 0.018).mul(n.mul(0.25).add(0.85)).mul(float(1).sub(seam.mul(0.6)));
      const c = shade(P, vec3(0, 1, 0), alb, float(0.7));
      const V = normalize(cameraPosition.sub(P));
      const fres = pow(float(1).sub(max(V.y, 0)), 4);
      const a = clamp(float(0.84).sub(fres.mul(0.3)).add(n.mul(0.06)).add(seam.mul(0.12)), 0.45, 1);
      return vec4(finish(c, P), a);
    })();
    const mesh = new Mesh(geo, m);
    mesh.renderOrder = 1;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- layout: desks, monitors, chairs, strips
  type Xf = Matrix4;
  const deskXf: Xf[] = [];
  const monXf: { m: Matrix4; z: number; outer: boolean }[] = [];
  const chairXf: Xf[] = [];
  const rng = mulberry(4242);
  const q = new Quaternion(), s1 = new Vector3(1, 1, 1);
  const ROT = 1.0;
  const rowsInner = high ? 10 : 8, rowsOuter = high ? 9 : 7;
  for (const side of [-1, 1]) {
    for (let k = 0; k < rowsInner + rowsOuter; k++) {
      const outer = k >= rowsInner;
      // medium quality drops the far rows (largest z, behind the camera during hold), never the ones near the display
      const j = outer ? k - rowsInner + (9 - rowsOuter) : k + (10 - rowsInner);
      const z = outer ? 7.9 - j * 2.1 - 1.05 : 8.2 - j * 2.1;
      if (z < -10.9) continue;
      const x = side * (outer ? 4.2 : 2.05);
      const y = outer ? 0.35 : 0;
      const m = new Matrix4().compose(new Vector3(x, y, z), q.setFromEuler(new Euler(0, -side * ROT, 0)), s1);
      deskXf.push(m);
      for (let r = 0; r < 2; r++) for (let c = -1; c <= 1; c++) {
        const tilt = r === 1 ? 0.14 : 0.02;
        const loc = new Matrix4().compose(new Vector3(c * 0.635, r ? 1.42 : 1.0, -0.19), new Quaternion().setFromEuler(new Euler(tilt, c * -0.08, 0)), s1);
        monXf.push({ m: m.clone().multiply(loc), z, outer });
      }
      if (!outer) for (const cx of [-0.5, 0.5]) {
        if (rng() < 0.25) continue;
        const loc = new Matrix4().compose(new Vector3(cx + (rng() - 0.5) * 0.1, 0, 0.8 + rng() * 0.2), new Quaternion().setFromEuler(new Euler(0, Math.PI + (rng() - 0.5) * 0.7, 0)), s1);
        chairXf.push(m.clone().multiply(loc));
      }
    }
  }
  const MIRROR = new Matrix4().makeScale(1, -1, 1);
  function fillInstances(mesh: InstancedMesh, xfs: Matrix4[]) {
    const n = xfs.length;
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, xfs[i]);
      mesh.setMatrixAt(i + n, MIRROR.clone().multiply(xfs[i]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
  }

  // light strips (ceiling: cool; platform edges + aisle: orange) — one instanced draw incl. mirrors
  {
    const xfs: Matrix4[] = [];
    const cols: number[] = [];
    for (const x of [-1.2, 1.2]) for (let k = 0; k < 9; k++) {
      xfs.push(new Matrix4().compose(new Vector3(x, 4.5, 10.5 - k * 2.6), new Quaternion(), new Vector3(0.07, 0.03, 2.1)));
      cols.push(0.8, 0.85, 0.95);
    }
    for (const x of [-3.17, 3.17]) {
      xfs.push(new Matrix4().compose(new Vector3(x, 0.33, -1.2), new Quaternion(), new Vector3(0.02, 0.012, 20)));
      cols.push(ORANGE.r * 0.9, ORANGE.g * 0.9, ORANGE.b * 0.9);
    }
    // floor guide dashes down the aisle
    for (let k = 0; k < 16; k++) {
      for (const x of [-0.9, 0.9]) {
        xfs.push(new Matrix4().compose(new Vector3(x, 0.003, 9 - k * 1.15), new Quaternion(), new Vector3(0.025, 0.004, 0.45)));
        cols.push(ORANGE.r * 0.35, ORANGE.g * 0.35, ORANGE.b * 0.35);
      }
    }
    // platforms (raised outer rows): dark boxes — colour < 0 marks "lit" geometry
    for (const x of [-4.47, 4.47]) {
      xfs.push(new Matrix4().compose(new Vector3(x, 0.17, -1.2), new Quaternion(), new Vector3(2.6, 0.34, 20)));
      cols.push(-1, -1, -1);
    }
    const n = xfs.length;
    const colAttr = new InstancedBufferAttribute(new Float32Array(n * 2 * 3), 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { colAttr.array[i * 3 + k] = cols[i * 3 + k]; colAttr.array[(i + n) * 3 + k] = cols[i * 3 + k]; }
    const m = new MeshBasicNodeMaterial();
    m.toneMapped = false; m.fog = false; m.side = DoubleSide;
    const ic: N = instancedBufferAttribute(colAttr, 'vec3');
    const vic: N = varying(ic, 'vStripCol');
    m.colorNode = Fn(() => {
      const P: N = positionWorld;
      const lit = shade(P, normalWorld, vec3(0.03, 0.028, 0.027), float(0.5));
      const em = vic.mul(2.4).mul(float(1).sub(step(P.y, 0).mul(0.6)));
      const c = select(vic.x.lessThan(0), lit, em);
      return vec4(finish(c, P), 1);
    })();
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), m, n * 2);
    fillInstances(mesh, xfs);
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- screens (instanced; terminal / thumbnail / graph)
  const nMon = monXf.length;
  const scrA = new InstancedBufferAttribute(new Float32Array(nMon * 2 * 4), 4); // mode, chan, seed, onT
  {
    const r2 = mulberry(77);
    for (let i = 0; i < nMon; i++) {
      const u = r2();
      const mode = u < 0.62 ? 0 : u < 0.82 ? 1 : 2;
      const chan = Math.floor(r2() * (mode === 1 ? 12 : 4));
      const onT = 0.012 + sat((9 - monXf[i].z) / 20) * 0.14 + r2() * 0.012;
      for (const o of [i, i + nMon]) scrA.array.set([mode, chan, r2(), onT], o * 4);
    }
  }
  {
    const geo = new PlaneGeometry(MON_W, MON_H);
    geo.translate(0, 0, 0.0015);
    const m = new MeshBasicNodeMaterial();
    m.toneMapped = false; m.fog = false; m.side = DoubleSide;
    const A: N = instancedBufferAttribute(scrA, 'vec4');
    const vA: N = varying(A, 'vScrA');
    m.colorNode = Fn(() => {
      const P: N = positionWorld;
      const mir = step(P.y, 0);
      const p = uv();
      const mode = vA.x, chan = vA.y, seed = vA.z, onT = vA.w;
      // terminal: 4 streams, stepped line scroll
      const rate = seed.mul(1.4).add(0.6);
      const scroll = floor(uTime.mul(rate).add(seed.mul(60))).mul(30 / 2048);
      const tuv = vec2(chan.add(p.x).div(4), float(1).sub(scroll.add(float(1).sub(p.y).mul(0.15))));
      const lod = mir.mul(2.5);
      const term = texture(termTex, tuv).level(lod).rgb;
      // thumbnails: 4 × 3 cells of 512 × 307 in a 2048 × 1024 atlas
      const cx = chan.mod(4), cy = floor(chan.div(4));
      const thuv = vec2(cx.add(p.x).div(4), float(1).sub(cy.add(float(1).sub(p.y)).mul(307 / 1024)));
      const thumb = texture(thumbTex, thuv).level(lod).rgb;
      // graph: bars + sparkline
      const bx = floor(p.x.mul(22));
      const bh = fract(sin(bx.mul(12.9).add(floor(uTime.mul(1.5).add(seed.mul(9)))).add(seed.mul(77))).mul(4375.5)).mul(0.55).add(0.1);
      const bar = step(p.y, bh).mul(step(0.15, fract(p.x.mul(22)))).mul(step(p.y, 0.8));
      const grid = step(0.97, fract(p.y.mul(6))).mul(0.25);
      const graph = mix(vec3(0.02, 0.018, 0.016), ORANGE_V.mul(0.75), bar).add(grid).add(step(0.86, p.y).mul(vec3(0.12, 0.11, 0.1)));
      let col: N = select(mode.lessThan(0.5), term, select(mode.lessThan(1.5), thumb, graph));
      // CRT-ish: scanlines + edge falloff
      const scan = sin(p.y.mul(MON_H * 1500)).mul(0.06).add(0.94);
      const edge = smoothstep(0, 0.04, p.x).mul(rsmooth(1, 0.96, p.x)).mul(smoothstep(0, 0.05, p.y)).mul(rsmooth(1, 0.95, p.y));
      // boot wave: dark → white line → content
      const on = smoothstep(onT, onT.add(0.012), uT);
      const flashLine = exp(abs(p.y.sub(0.5)).mul(-40)).mul(smoothstep(onT.sub(0.004), onT, uT)).mul(float(1).sub(on)).mul(3);
      const flicker = sin(uTime.mul(37).add(seed.mul(100))).mul(0.03).add(0.97);
      const bright = seed.mul(0.4).add(0.75).mul(flicker).mul(float(1).add(uDepart.mul(0.6)));
      col = col.mul(scan).mul(edge.mul(0.75).add(0.25)).mul(on).mul(bright).add(vec3(1, 0.85, 0.7).mul(flashLine));
      // glass reflection of the room when off
      col = col.add(vec3(0.012, 0.012, 0.014).mul(float(1).sub(on)));
      col = col.mul(float(1).sub(mir.mul(0.45)));
      // fog only (screens are emissive)
      const dist = length(P.sub(cameraPosition));
      const fd = dist.mul(0.052);
      const fog = float(1).sub(exp(fd.mul(fd).negate()));
      return vec4(agxToneMapping(mix(col.mul(1.25), fogCol, fog), float(1)), 1);
    })();
    const mesh = new InstancedMesh(geo, m, nMon * 2);
    fillInstances(mesh, monXf.map((o) => o.m));
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- wall display (+mirror) — real screenshots
  let wallMesh: InstancedMesh | null = null;
  {
    const geo = new PlaneGeometry(SW, SH);
    geo.translate(0, 0, 0.002);
    const m = new MeshBasicNodeMaterial();
    m.toneMapped = false; m.fog = false; m.side = DoubleSide;
    const fit = (p: N, asp: N) => {
      // contain-fit in a SW/SH frame
      const fr = float(SW / SH);
      const sx = max(fr.div(asp), 1), sy = max(asp.div(fr), 1);
      return vec2(p.x.sub(0.5).mul(sx).add(0.5), p.y.sub(0.5).mul(sy).add(0.5));
    };
    m.colorNode = Fn(() => {
      const P: N = positionWorld;
      const mir = step(P.y, 0);
      const p0 = uv();
      // transition glitch: horizontal slices shear while crossfading
      const tr = sin(uMix.mul(Math.PI));
      const band = floor(p0.y.mul(28));
      const jit = fract(sin(band.mul(91.7).add(floor(uTime.mul(24)))).mul(43758.5)).sub(0.5);
      const p = vec2(p0.x.add(jit.mul(tr).mul(0.05)), p0.y);
      const lod = mir.mul(4.5);
      const ua = fit(p, uAspA), ub = fit(p, uAspB);
      const inA = step(0, ua.x).mul(step(ua.x, 1)).mul(step(0, ua.y)).mul(step(ua.y, 1));
      const inB = step(0, ub.x).mul(step(ub.x, 1)).mul(step(0, ub.y)).mul(step(ub.y, 1));
      const letter = vec3(0.035, 0.032, 0.03);
      texA.uvNode = ua; texA.levelNode = lod;
      texB.uvNode = ub; texB.levelNode = lod;
      const a = mix(letter, texA.rgb, inA);
      const b = mix(letter, texB.rgb, inB);
      let col: N = mix(a, b, smoothstep(0.25, 0.75, uMix));
      col = col.add(vec3(tr.mul(0.05)).mul(step(0.5, fract(band.mul(0.37).add(uTime)))));
      // boot: horizontal line opens vertically (t .12 → .17)
      const open = smoothstep(0.12, 0.17, uT);
      const lineW = open.mul(0.5).add(0.003);
      const inside = rsmooth(lineW.add(0.004), lineW, abs(p0.y.sub(0.5)));
      const bootGlow = exp(abs(p0.y.sub(0.5)).mul(-60)).mul(smoothstep(0.1, 0.125, uT)).mul(float(1).sub(open)).mul(4);
      const scan = sin(p0.y.mul(SH * 520)).mul(0.025).add(0.975);
      const vig = smoothstep(0, 0.02, p0.x).mul(rsmooth(1, 0.98, p0.x)).mul(smoothstep(0, 0.03, p0.y)).mul(rsmooth(1, 0.97, p0.y));
      col = col.mul(inside).mul(scan).mul(vig.mul(0.3).add(0.7)).add(vec3(1, 0.9, 0.8).mul(bootGlow));
      col = col.mul(float(1).sub(mir.mul(0.55)));
      // no tone mapping on the real screenshot: it stays faithful and legible; light fog only
      const dist = length(P.sub(cameraPosition));
      const fd = dist.mul(0.03);
      const fog = float(1).sub(exp(fd.mul(fd).negate()));
      return vec4(mix(col.mul(0.92), fogCol, fog), 1);
    })();
    const mesh = new InstancedMesh(geo, m, 2);
    fillInstances(mesh, [new Matrix4().makeTranslation(C.x, C.y, C.z)]);
    scene.add(mesh);
    wallMesh = mesh;
  }

  // ---------------------------------------------------------------- pedestal group: printer, paper, stamp
  const ped = new Group();
  ped.position.copy(PED_POS);
  ped.rotation.y = PED_ROT;
  scene.add(ped);
  const deck = new Group();
  deck.position.set(0, TOP_F, DZ);
  deck.rotation.x = THETA;
  ped.add(deck);
  ped.updateMatrixWorld(true);
  const stampHolder = new Group();
  stampHolder.position.set(0, 0.32, STAMP_Z);
  deck.add(stampHolder);

  // paper path (pedestal-local), sampled by arc length
  const deckM = new Matrix4().compose(new Vector3(0, TOP_F, DZ), new Quaternion().setFromEuler(new Euler(THETA, 0, 0)), s1);
  const pathPts: Vector3[] = [];
  const pathNrm: Vector3[] = [];
  {
    const slot = new Vector3(0, 0.118, -0.5 + 0.085);
    const land = new Vector3(0, 0.0015, -0.27);
    // out of the slot: quadratic bezier slot → (forward, slightly up) → land
    const ctrl = new Vector3(0, 0.135, -0.33);
    for (let i = 0; i <= 24; i++) {
      const k = i / 24;
      const a = slot.clone().multiplyScalar((1 - k) * (1 - k)).add(ctrl.clone().multiplyScalar(2 * k * (1 - k))).add(land.clone().multiplyScalar(k * k));
      pathPts.push(a.applyMatrix4(deckM));
    }
    for (let i = 1; i <= 20; i++) pathPts.push(new Vector3(0, 0.0015, -0.27 + (0.27 * i) / 20).applyMatrix4(deckM));
    // over the front edge: arc from the deck direction to straight down
    const edge = new Vector3(0, 0.0015, 0).applyMatrix4(deckM);
    const R = 0.018;
    const dirDeck = new Vector3(0, -Math.sin(THETA), Math.cos(THETA));
    const centre = edge.clone().add(new Vector3(0, -Math.cos(THETA), -Math.sin(THETA)).multiplyScalar(R));
    const a0 = Math.atan2(edge.y - centre.y, edge.z - centre.z);
    for (let i = 1; i <= 10; i++) {
      const a = a0 - ((a0 - 0) * i) / 10;
      pathPts.push(new Vector3(0, centre.y + Math.sin(a) * R, centre.z + Math.cos(a) * R));
    }
    void dirDeck;
    const hang = pathPts[pathPts.length - 1].clone();
    for (let i = 1; i <= 40; i++) {
      const k = i / 40;
      pathPts.push(new Vector3(0, hang.y - k * 0.75, hang.z + 0.004 + Math.pow(k, 2.2) * 0.05));
    }
  }
  const pathLen: number[] = [0];
  for (let i = 1; i < pathPts.length; i++) pathLen.push(pathLen[i - 1] + pathPts[i].distanceTo(pathPts[i - 1]));
  const pathAt = (d: number, out: Vector3) => {
    const L = pathLen[pathLen.length - 1];
    if (d >= L) return out.copy(pathPts[pathPts.length - 1]);
    let i = 1;
    while (pathLen[i] < d) i++;
    const k = (d - pathLen[i - 1]) / Math.max(1e-6, pathLen[i] - pathLen[i - 1]);
    return out.copy(pathPts[i - 1]).lerp(pathPts[i], k);
  };
  // arc length from the slot to the stamp centre on the deck
  const stampWorldLocal = new Vector3(0, 0.0015, STAMP_Z).applyMatrix4(deckM);
  let dStamp = 0;
  { let best = 1e9; for (let i = 0; i < pathPts.length; i++) { const d = pathPts[i].distanceTo(stampWorldLocal); if (d < best) { best = d; dStamp = pathLen[i]; } } }
  const inkV = (PRINT_L - dStamp) / RECEIPT_L; // receipt coordinate (0 = top/first printed) under the stamp
  uInkV.value = inkV;
  receiptTex = new CanvasTexture(makeReceipt(inkV));
  receiptTex.colorSpace = SRGBColorSpace;
  receiptTex.anisotropy = 8;

  const SEG = 90;
  const paperGeo = new BufferGeometry();
  const paperPos = new Float32Array((SEG + 1) * 2 * 3);
  const paperUv = new Float32Array((SEG + 1) * 2 * 2);
  const paperNrm = new Float32Array((SEG + 1) * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  paperGeo.setIndex(idx);
  paperGeo.setAttribute('position', new BufferAttribute(paperPos, 3));
  paperGeo.setAttribute('uv', new BufferAttribute(paperUv, 2));
  paperGeo.setAttribute('normal', new BufferAttribute(paperNrm, 3));
  {
    const m = new MeshBasicNodeMaterial();
    m.toneMapped = false; m.fog = false; m.side = DoubleSide;
    m.colorNode = Fn(() => {
      const P: N = positionWorld;
      const p = uv(); // x across, y = receipt coordinate (0 top)
      const rec = texture(receiptTex, vec2(p.x, p.y)).rgb;
      // ink: stamp face 0.108 × 0.068 m, slightly rotated
      const lx = p.x.sub(0.5).mul(PAPER_W), ly = p.y.sub(uInkV).mul(RECEIPT_L);
      const ca = Math.cos(-0.09), sa = Math.sin(-0.09);
      const rx = lx.mul(ca).sub(ly.mul(sa)), ry = lx.mul(sa).add(ly.mul(ca));
      const iuv = vec2(rx.div(0.108).add(0.5), ry.div(0.068).add(0.5));
      const inside = step(0, iuv.x).mul(step(iuv.x, 1)).mul(step(0, iuv.y)).mul(step(iuv.y, 1));
      const ink = texture(inkTex, iuv).a.mul(inside).mul(uInk);
      const alb = mix(rec, vec3(0.85, 0.2, 0.05), ink.mul(0.9));
      let c: N = shade(P, normalWorld, alb, float(0.25));
      // paper is bright under the console lamp: small self-illumination keeps it readable
      c = c.add(alb.mul(0.06));
      return vec4(finish(c, P), 1);
    })();
    const mesh = new Mesh(paperGeo, m);
    mesh.frustumCulled = false;
    ped.add(mesh);
  }
  const tmpA = new Vector3(), tmpB = new Vector3(), tmpN = new Vector3();
  function updatePaper(printed: number, time: number) {
    // vertex i sits at arc distance d_i = printed · i/SEG from the slot; its receipt coordinate is (printed - d)/RECEIPT_L
    const half = PAPER_W / 2;
    for (let i = 0; i <= SEG; i++) {
      const d = (printed * i) / SEG;
      pathAt(d, tmpA);
      pathAt(Math.min(d + 0.01, pathLen[pathLen.length - 1] + 1), tmpB);
      // hanging part sways a little
      const hangK = Math.max(0, d - pathLen[54]);
      tmpA.z += Math.sin(time * 1.3 + d * 6) * 0.012 * hangK;
      tmpA.x += Math.sin(time * 0.9 + d * 4) * 0.008 * hangK;
      const t = tmpB.sub(tmpA).normalize();
      tmpN.set(0, t.z, -t.y).normalize();
      const v = (printed - d) / RECEIPT_L;
      for (let s = 0; s < 2; s++) {
        const o = i * 2 + s;
        paperPos[o * 3] = tmpA.x + (s ? half : -half);
        paperPos[o * 3 + 1] = tmpA.y;
        paperPos[o * 3 + 2] = tmpA.z;
        paperNrm[o * 3] = 0; paperNrm[o * 3 + 1] = tmpN.y; paperNrm[o * 3 + 2] = tmpN.z;
        paperUv[o * 2] = s; paperUv[o * 2 + 1] = v;
      }
    }
    paperGeo.attributes.position.needsUpdate = true;
    paperGeo.attributes.uv.needsUpdate = true;
    paperGeo.attributes.normal.needsUpdate = true;
  }
  updatePaper(0.001, 0);

  // ---------------------------------------------------------------- dust (additive billboards)
  const nDust = high ? 420 : 240;
  const uRight = uniform(new Vector3(1, 0, 0)), uUp = uniform(new Vector3(0, 1, 0));
  {
    const dA = new InstancedBufferAttribute(new Float32Array(nDust * 4), 4);
    const r3 = mulberry(9);
    for (let i = 0; i < nDust; i++) dA.array.set([(r3() - 0.5) * 6, 0.2 + r3() * 3.6, -11.6 + r3() * 9, r3()], i * 4);
    const D: N = instancedBufferAttribute(dA, 'vec4');
    const m = new MeshBasicNodeMaterial();
    m.transparent = true; m.depthWrite = false; m.blending = AdditiveBlending; m.toneMapped = false; m.fog = false;
    const seed = D.w;
    const drift = vec3(sin(uTime.mul(0.13).add(seed.mul(40))).mul(0.25), fract(uTime.mul(0.012).mul(seed.add(0.4)).add(seed)).mul(3.6).sub(D.y).add(D.y), cos(uTime.mul(0.11).add(seed.mul(23))).mul(0.25));
    const center = vec3(D.x, D.y.add(fract(uTime.mul(0.01).mul(seed.add(0.3)).add(seed.mul(7))).mul(0.8)), D.z).add(vec3(drift.x, 0, drift.z));
    const size = seed.mul(0.012).add(0.006);
    m.positionNode = center.add(uRight.mul(positionGeometry.x.mul(size))).add(uUp.mul(positionGeometry.y.mul(size)));
    const vSeed: N = varying(seed, 'vDustSeed');
    const vC: N = varying(center, 'vDustC');
    m.colorNode = Fn(() => {
      const p = uv().sub(0.5);
      const a = rsmooth(0.5, 0.0, length(p));
      const toC = normalize(vec3(C.x, C.y, C.z).sub(cameraPosition));
      const vd = normalize(vC.sub(cameraPosition));
      const fwd = pow(max(dot(vd, toC), 0), 6).mul(1.4).add(0.12);
      const near = float(1).div(length(vec3(C.x, C.y, C.z).sub(vC)).mul(0.35).add(1));
      const tw = sin(uTime.mul(vSeed.mul(3).add(1)).add(vSeed.mul(50))).mul(0.4).add(0.6);
      const c = uScr.mul(uScrI).mul(a).mul(fwd).mul(near).mul(tw).mul(0.55);
      return vec4(c, 1);
    })();
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), m, nDust);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- async: models + slides
  let stampObj: Object3D | null = null;
  const ready = (async () => {
    const [gltf, slides] = await Promise.all([new GLTFLoader().loadAsync('/worlds/oge/props.glb'), loadSlides(ctx)]);
    const geos: Record<string, BufferGeometry> = {};
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o: any) => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); geos[o.name] = g; } });
    const mat = litMaterial(true);
    const inst = (name: string, xfs: Matrix4[]) => {
      const g = geos[name];
      if (!g) return;
      const mesh = new InstancedMesh(g, mat, xfs.length * 2);
      fillInstances(mesh, xfs);
      scene.add(mesh);
    };
    inst('Desk', deskXf);
    inst('Monitor', monXf.map((o) => o.m));
    inst('Chair', chairXf);
    inst('BigFrame', [new Matrix4().makeTranslation(C.x, C.y, C.z)]);
    const single = (name: string, parent: Object3D) => {
      const g = geos[name];
      if (!g) return null;
      const mesh = new Mesh(g, mat);
      parent.add(mesh);
      return mesh;
    };
    single('Pedestal', ped);
    const pr = single('Printer', deck);
    pr?.position.set(0, 0, -0.5);
    stampObj = single('Stamp', stampHolder);

    // slides → textures, thumbnails atlas, average colours
    const imgs: (HTMLImageElement | HTMLCanvasElement)[] = [];
    await Promise.all(slides.map(async (s, i) => {
      try {
        const im = new Image();
        im.decoding = 'async';
        im.src = s.src;
        await im.decode();
        imgs[i] = im;
      } catch { imgs[i] = placeholderCanvas(i); }
    }));
    if (!imgs.length) for (let i = 0; i < 4; i++) imgs.push(placeholderCanvas(i));
    const avgCv = document.createElement('canvas');
    avgCv.width = avgCv.height = 4;
    const ag = avgCv.getContext('2d', { willReadFrequently: true })!;
    slideTex = imgs.map((im) => {
      const t = im instanceof HTMLCanvasElement ? new CanvasTexture(im) : new Texture(im);
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 8;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    });
    slideAvg = imgs.map((im) => {
      ag.clearRect(0, 0, 4, 4);
      ag.drawImage(im, 0, 0, 4, 4);
      const d = ag.getImageData(0, 0, 4, 4).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < 64; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const c = new Color().setRGB(r / 4080, g / 4080, b / 4080, SRGBColorSpace);
      // keep it a light: normalise brightness, warm it slightly toward cream
      const l = Math.max(0.15, (c.r + c.g + c.b) / 3);
      c.multiplyScalar(0.55 / l).lerp(new Color(0.62, 0.56, 0.48), 0.45);
      return c;
    });
    const aspects = imgs.map((im) => im.width / im.height);
    (slideTex as any).aspects = aspects;
    // thumbnails
    const tg = thumbCanvas.getContext('2d')!;
    tg.fillStyle = '#0b0a09'; tg.fillRect(0, 0, 2048, 1024);
    for (let c = 0; c < 12; c++) {
      const im = imgs[c % imgs.length];
      const x = (c % 4) * 512, y = Math.floor(c / 4) * 307;
      tg.fillStyle = '#121110'; tg.fillRect(x, y, 512, 307);
      containDraw(tg, im as any, x + 6, y + 6, 500, 295);
    }
    thumbTex.needsUpdate = true;
    current = -1;
    setSlide(wantSlide, true);
  })();

  // ---------------------------------------------------------------- slide switching
  let current = -1, pending = -1, mixT = 0, wantSlide = 0;
  function setSlide(i: number, instant = false) {
    if (!slideTex.length) return;
    const n = slideTex.length;
    const k = ((Math.round(i) % n) + n) % n;
    if (k === current && pending < 0) return;
    const aspects: number[] = (slideTex as any).aspects;
    if (instant || current < 0) {
      texA.value = slideTex[k]; uAspA.value = aspects[k];
      texB.value = slideTex[k]; uAspB.value = aspects[k];
      current = k; pending = -1; uMix.value = 0; mixT = 0;
      scrTarget.copy(slideAvg[k]);
      return;
    }
    if (k === pending) return;
    if (pending >= 0) { texA.value = slideTex[pending]; uAspA.value = aspects[pending]; current = pending; }
    pending = k;
    texB.value = slideTex[k]; uAspB.value = aspects[k];
    mixT = 0;
    scrTarget.copy(slideAvg[k]);
  }
  const scrTarget = new Color(0.5, 0.48, 0.45);

  // ---------------------------------------------------------------- camera
  const eye = new Vector3(), look = new Vector3(), up = new Vector3(0, 1, 0);
  const vA = new Vector3(), vB = new Vector3(), vC = new Vector3();
  function holdFrame(aspect: number) {
    const tanV = Math.tan((FOV * Math.PI) / 360);
    const tanH = tanV * aspect;
    const land = aspect > 1.1;
    const widthFrac = land ? 0.6 : 0.94;
    let d = SW / (widthFrac * 2 * tanH);
    d = Math.max(d, SH / (2 * 0.6 * tanV));
    return { d, ndcX: land ? -0.17 : 0, ndcY: land ? 0.3 : 0.32, tanV, tanH };
  }
  function holdEye(h: number, d: number, out: Vector3) {
    return out.set(0.42 - 0.38 * h, 1.27 + 0.05 * Math.sin(h * Math.PI), C.z + d + 0.3 - 0.42 * h);
  }
  const _q = new Quaternion(), _e = new Euler();
  function poseCamera(t: number, f: StageFrame) {
    const aspect = f.aspect || camera.aspect;
    const H = holdFrame(aspect);
    const h = sat((t - ARRIVE) / (DEPART - ARRIVE));
    let w = 1; // weight of the hold framing offsets
    let roll = 0;
    if (t < ARRIVE) {
      const a = easeInOut(sat(t / ARRIVE));
      const pre = Math.max(0, -t); // before the stage starts: keep sliding backwards
      vA.set(-0.35, 3.7 + pre * 1.2, 9.5 + pre * 9);
      vB.set(0.55, 1.5, -2.2);
      holdEye(0, H.d, vC);
      // quadratic bezier
      eye.copy(vA).multiplyScalar((1 - a) * (1 - a)).addScaledVector(vB, 2 * a * (1 - a)).addScaledVector(vC, a * a);
      look.set(0, lerp(0.9, C.y, a), C.z);
      w = sstep(0.35, 1, a);
      roll = (1 - a) * 0.07;
    } else if (t <= DEPART) {
      holdEye(h, H.d, eye);
      look.copy(C);
    } else {
      const q = sat((t - DEPART) / (1 - DEPART));
      const k = easeIn(q);
      holdEye(1, H.d, vA);
      const dEnd = (SH / (2 * H.tanV)) * 0.62;
      vB.set(C.x, C.y, C.z + dEnd);
      eye.copy(vA).lerp(vB, k);
      if (t > 1) eye.z = C.z + dEnd * Math.max(0.2, 1 - (t - 1) * 1.5);
      look.copy(C);
      w = 1 - sstep(0, 0.85, q);
    }
    // parallax + idle breathing
    const par = f.parallax ?? { x: 0, y: 0 };
    const pw = 0.4 + 0.6 * w;
    const time = f.time;
    camera.position.copy(eye);
    camera.up.copy(up);
    camera.lookAt(look);
    camera.translateX(par.x * 0.16 * pw + Math.sin(time * 0.31) * 0.012);
    camera.translateY(par.y * 0.09 * pw + Math.sin(time * 0.47) * 0.008);
    camera.lookAt(look);
    // place the display at the framed NDC position: yaw/pitch away from it
    const yaw = -Math.atan(H.ndcX * H.tanH) * w;
    const pitch = -Math.atan(H.ndcY * H.tanV) * w;
    // positive rotation about y turns left; the display sits left of centre (ndcX<0) → turn right (negative)
    _q.setFromEuler(_e.set(pitch + par.y * 0.012, -yaw + par.x * -0.015, roll, 'YXZ'));
    camera.quaternion.multiply(_q);
    // stamp impact shake
    const fl = uFlash.value;
    if (fl > 0.01) {
      camera.rotateZ(Math.sin(t * 2400) * 0.003 * fl);
      camera.rotateX(Math.sin(t * 1900 + 1) * 0.002 * fl);
    }
    camera.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- update
  const pedLight = new Vector3();
  const stage: Stage = {
    id: ctx.project.id,
    scene,
    camera,
    background: BG,
    ready,
    update(f: StageFrame) {
      const t = f.t;
      uTime.value = f.time;
      uT.value = t;
      // wall display power: boots in arrive, brighter on depart
      uScrI.value = sstep(0.11, 0.18, t) * (1 + sstep(DEPART, 1, t) * 0.5);
      uDepart.value = sstep(DEPART, 1, t);
      // slides
      wantSlide = f.slide ?? 0;
      setSlide(wantSlide);
      if (pending >= 0) {
        mixT += Math.max(0, f.dt) / 0.5;
        uMix.value = Math.min(1, mixT);
        if (mixT >= 1) {
          texA.value = texB.value; uAspA.value = uAspB.value;
          current = pending; pending = -1; uMix.value = 0;
        }
      }
      (uScr.value as Color).lerp(scrTarget, 1 - Math.exp(-Math.max(0, f.dt) * 4));
      // receipt feed (.24 → .58), stepped like a thermal printer
      const pf = sat((t - 0.24) / 0.34);
      const steps = 46;
      const st = pf * steps;
      const printed = Math.max(0.001, PRINT_L * Math.min(1, (Math.floor(st) + sstep(0, 0.6, st % 1)) / steps));
      updatePaper(printed, f.time);
      // stamp: down .60 → .635, press, up .66 → .74
      const down = easeIn(sat((t - 0.6) / 0.035));
      const upK = easeOut(sat((t - 0.66) / 0.08));
      const yRest = 0.32, yDown = 0.0035;
      const sy = lerp(yRest, yDown, down * (1 - upK)) + Math.sin(f.time * 1.7) * 0.003 * (1 - down);
      stampHolder.position.y = sy;
      const contact = t >= 0.635;
      uInk.value = contact ? 1 : 0;
      const since = t - 0.635;
      uFlash.value = since >= 0 ? Math.exp(-since * 45) : 0;
      pedLight.set(0, TOP_F + 0.5, DZ + 0.25);
      ped.localToWorld(uPedLight.value.copy(pedLight));
      poseCamera(t, f);
      // dust billboards face the camera
      uRight.value.set(1, 0, 0).applyQuaternion(camera.quaternion);
      uUp.value.set(0, 1, 0).applyQuaternion(camera.quaternion);
      void stampObj;
    },
    portalQuad() {
      const pts: [number, number][] = [];
      for (const [sx, sy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
        const p = new Vector3(C.x + (sx * SW) / 2, C.y + (sy * SH) / 2, C.z).project(camera);
        if (p.z > 1 || p.z < -1) return null;
        pts.push([p.x, p.y]);
      }
      return pts;
    },
    dispose() {
      scene.traverse((o: any) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      [termTex, thumbTex, blank, inkTex, receiptTex, ...slideTex].forEach((t) => t?.dispose());
    },
  };
  void wallMesh; void If; void NormalBlending; void min;
  return stage;
}
