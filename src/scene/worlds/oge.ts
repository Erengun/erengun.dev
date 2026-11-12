/**
 * Öge world: "One Desk", a dark control room of coding-agent monitors, with the Öge pipeline told in-world.
 *
 *   arrive (t 0 → .22)  crane down the aisle between sawtooth desk rows while the monitors wake in a wave
 *                       and the wall display boots; the pipeline hologram materialises at the end
 *   hold   (t .22 → .82) the real screenshot on the wall display (upper right, clear of the nav) and, around it,
 *                       the Run as a pipeline (all stations always visible, t picks the active one):
 *                       task chip `oge "fix the payment retry bug"` → 1 agent implements (Codex / Antigravity /
 *                       Claude Code orbs streaming tokens into their terminals) → 2 independent QA (cool orb, beam
 *                       scans the diff) → 3 held-out tests fly into the check board → Check #1 fails (AC-2) →
 *                       4 repair loop arc back to Claude Code → Check #2 passes → 5 the Receipt prints (real
 *                       accepted-repaired format) → ACCEPTED stamp → 6 "you decide" lights up with /diff /apply /receipt
 *   depart (t .82 → 1)  the hologram fades, push into the wall display (portalQuad = its corners)
 *
 * Draws (~17): room shell, floor, strips, desks, monitors, screens, chairs, wall frame, wall screen, dust, and the
 * pipeline: links/beam ribbons, panels (one canvas atlas, incl. smoked glass), token glyphs, orbs. Instanced room
 * sets carry their floor-mirror instances. The pipeline floats ~1.3 m in front of the camera (nothing can cut
 * through it) and is laid out on a 1440 × 900 sheet squeezed into the post-safe area (see SAFE).
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
  floor, fract, step, select, abs, agxToneMapping, varying, sign, If, sqrt, atan,
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
const EYE_Y = 1.95;                          // hold eye height: near desk monitors sink under the DOM panel
const ARRIVE = 0.22, DEPART = 0.82;
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
const AG_CMD = ['claude', 'codex', 'agy'];
function runLines(rng: () => number, n: number): Line[] {
  const L: Line[] = [];
  const ai = Math.floor(rng() * 3);
  const task = TASKS[Math.floor(rng() * TASKS.length)];
  const id = Math.floor(rng() * 0xffffff).toString(16).padStart(6, '0');
  L.push(['o', `$ oge "${task}"`]);
  L.push(['c', `    --agent ${AG_CMD[ai]}`]);
  L.push(['d', `Run 2026111${n % 10}T15${String(n % 60).padStart(2, '0')}-${id}`]);
  L.push(['d', `implement · ${AGENTS[ai]} · private copy`]);
  for (let k = 0; k < 2 + Math.floor(rng() * 3); k++) {
    const f = FILES[Math.floor(rng() * FILES.length)];
    L.push(['c', `edit ${f}`]);
    L.push(['d', `     +${Math.floor(rng() * 90 + 3)} -${Math.floor(rng() * 30)}`]);
  }
  L.push(['d', `QA   fresh agent · +${1 + Math.floor(rng() * 2)} held-out`]);
  const fail = rng() < 0.45;
  if (fail) {
    L.push(['r', `Check #1 failed: 1 held-out test`]);
    L.push(['o', `→ sent back · repair 1 of 3`]);
    L.push(['c', `Check #2 passed`]);
  } else L.push(['c', `Check #1 passed · ${Math.floor(rng() * 300 + 40)} tests`]);
  L.push(['o', `✓ Accepted · Receipt written`]);
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

// ------------------------------------------------------------------ stamp ink
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
  const uMix = uniform(0);
  const uAspA = uniform(1.68), uAspB = uniform(1.68);
  const uPedLight = uniform(new Vector3());
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

  // ================================================================ the Öge pipeline (hold-phase story)
  // task → agent implements → independent QA → held-out tests + checks → repair loop → receipt → ACCEPTED → you
  // Every element is placed relative to a reference hold camera (NDC anchor + depth), so the composition stays
  // screen-stable around the wall display; pointer parallax still separates the layers in depth.
  // 4 draws: links/beam (additive ribbons), panels (one atlas), tokens (additive glyphs), orbs (additive).
  const AT = 2048;
  const atlasCv = document.createElement('canvas');
  atlasCv.width = AT; atlasCv.height = AT;
  const ag2 = atlasCv.getContext('2d')!;
  ag2.clearRect(0, 0, AT, AT);
  type Rect = { x: number; y: number; w: number; h: number };
  const rects: Record<string, Rect> = {};
  // shelf packer for the upper area (y < 1180); terminals + receipt get fixed slots below
  let shX = 0, shY = 0, shH = 0, xMin = 0;
  const PAD = 12;
  const alloc = (id: string, w: number, h: number): Rect => {
    if (shX + w + PAD > AT) { shX = xMin; shY += shH + PAD; shH = 0; }
    const r = { x: shX + PAD / 2, y: shY + PAD / 2, w, h };
    shX += w + PAD; shH = Math.max(shH, h);
    if (shY + h > 1130) console.error('oge atlas overflow', id);
    rects[id] = r;
    return r;
  };
  const SANS = (sz: number, wt = 700) => `${wt} ${sz}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  const MONO = (sz: number, b = false) => `${b ? 'bold ' : ''}${sz}px Menlo, ui-monospace, monospace`;
  const OR = '#ff5a1f', CR = '#f4f1ea', GR = '#8d877c', GREEN = '#52d68a', RED = '#ff4d3a', AMB = '#ffb547';
  /** label: optional orange number, then cream text, on transparent */
  function label(id: string, num: string, text: string, sz = 44, col = CR, font = SANS) {
    ag2.font = font(sz);
    const wn = num ? ag2.measureText(num + '  ').width : 0;
    const w = Math.ceil(wn + ag2.measureText(text).width + 8);
    const r = alloc(id, w, Math.round(sz * 1.3));
    ag2.textBaseline = 'middle';
    if (num) { ag2.fillStyle = OR; ag2.fillText(num, r.x + 2, r.y + r.h / 2); }
    ag2.fillStyle = col; ag2.fillText(text, r.x + 2 + wn, r.y + r.h / 2);
  }
  const rr = (x: number, y: number, w: number, h: number, rad: number) => {
    ag2.beginPath(); ag2.roundRect(x, y, w, h, rad);
  };
  function panelBg(r: Rect, border = OR, fill = '#0e0c0b', rad = 14, bw = 3) {
    rr(r.x + bw, r.y + bw, r.w - bw * 2, r.h - bw * 2, rad); ag2.fillStyle = fill; ag2.fill();
    ag2.lineWidth = bw; ag2.strokeStyle = border; ag2.stroke();
  }
  xMin = 620; shX = xMin; // x 0..600 is the check board column (5 versions)
  // ---- labels
  label('n1', '1', 'agent implements');
  label('s1', '', 'on a private copy of your repo', 30, GR);
  label('nm0', '', 'Codex', 34);
  label('nm1', '', 'Antigravity', 34);
  label('nm2', '', 'Claude Code', 34);
  label('n2', '2', 'independent QA');
  label('s2', '', 'sees task + diff, not the reasoning', 30, GR);
  label('n3', '3', 'held-out tests');
  label('n4', '4', 'repair loop · 1 of 3');
  label('n5', '5', 'receipt');
  label('n6', '6', 'you decide');
  label('s6a', '', 'you · not interrupted', 30, GR);
  label('s6b', '', 'only at the breakpoint', 30, OR);
  label('tag', '', 'AI multiplied execution; your attention is the bottleneck now.', 34, GR);
  // ---- task chip
  {
    const r = alloc('chip', 1000, 76);
    panelBg(r, OR, '#120e0c', 16, 3);
    ag2.font = MONO(34, true); ag2.textBaseline = 'middle';
    let x = r.x + 26; const y = r.y + r.h / 2 + 1;
    for (const [c, s] of [[OR, '$ '], [CR, 'oge '], ['#ffb08a', '"fix the payment retry bug"']]) {
      ag2.fillStyle = c; ag2.fillText(s, x, y); x += ag2.measureText(s).width;
    }
  }
  // ---- diff card (the Candidate the implementer hands over)
  {
    const r = alloc('diff', 600, 300);
    panelBg(r, '#5a4a40', '#0d0c0b', 14, 3);
    ag2.textBaseline = 'top';
    ag2.font = MONO(24, true); ag2.fillStyle = CR; ag2.fillText('internal/payment/retry.go', r.x + 22, r.y + 18);
    ag2.font = MONO(22); ag2.fillStyle = GR; ag2.fillText('+12 −3', r.x + 480, r.y + 20);
    const L: [string, string][] = [
      [GR, '@@ func (c *Client) Charge('],
      ['#ff7a66', '-  for i := 0; i < 5; i++ {'],
      ['#7be0a2', '+  for i := 0; i < maxRetries; i++ {'],
      ['#7be0a2', '+    if !isTransient(err) {'],
      ['#7be0a2', '+      break'],
      ['#7be0a2', '+    }'],
      ['#7be0a2', '+    time.Sleep(backoff(i))'],
    ];
    L.forEach(([c, s], i) => { ag2.fillStyle = c; ag2.fillText(s, r.x + 22, r.y + 64 + i * 32); });
  }
  // ---- check board: 5 versions stacked (idle, run #1, failed #1, run #2, passed #2)
  {
    const BW = 600, BH = 156;
    const base = { x: 6, y: 6, w: BW, h: BH };
    rects.board = { x: base.x, y: base.y, w: BW, h: BH };
    const versions: { title: string; tc: string; rows: [string, string, string][] }[] = [
      { title: 'CHECKS · waiting for QA', tc: GR, rows: [['#3a3632', 'go test ./...', '–'], ['#3a3632', 'held-out (2, hidden)', '–'], ['#3a3632', 'go vet ./...', '–']] },
      { title: 'CHECK #1 · running', tc: AMB, rows: [[AMB, 'go test ./...', 'running'], [AMB, 'held-out (2, hidden)', 'running'], [AMB, 'go vet ./...', 'running']] },
      { title: 'CHECK #1 · failed', tc: RED, rows: [[GREEN, 'go test ./...', '48 passed'], [RED, 'held-out (2, hidden)', '1 failing · AC-2'], [GREEN, 'go vet ./...', 'ok']] },
      { title: 'CHECK #2 · running', tc: AMB, rows: [[GREEN, 'go test ./...', '48 passed'], [AMB, 'held-out (2, hidden)', 'running'], [AMB, 'go vet ./...', 'running']] },
      { title: 'CHECK #2 · passed', tc: GREEN, rows: [[GREEN, 'go test ./...', '49 passed'], [GREEN, 'held-out (2, hidden)', '2 of 2 passing'], [GREEN, 'go vet ./...', 'ok']] },
    ];
    versions.forEach((v, k) => {
      const r = { x: base.x, y: base.y + k * (BH + 4), w: BW, h: BH };
      panelBg(r, v.tc === GR ? '#4a423c' : v.tc, '#0d0c0b', 14, 3);
      ag2.textBaseline = 'middle';
      ag2.font = MONO(24, true); ag2.fillStyle = v.tc; ag2.fillText(v.title, r.x + 22, r.y + 28);
      v.rows.forEach(([c, name, st], i) => {
        const y = r.y + 66 + i * 31;
        ag2.beginPath(); ag2.arc(r.x + 32, y, 9, 0, Math.PI * 2); ag2.fillStyle = c; ag2.fill();
        ag2.font = MONO(23); ag2.fillStyle = CR; ag2.fillText(name, r.x + 54, y);
        ag2.fillStyle = c === '#3a3632' ? GR : c; ag2.textAlign = 'right'; ag2.fillText(st, r.x + BW - 22, y); ag2.textAlign = 'left';
      });
    });
  }
  // ---- held-out test chips (QA-written, hidden from the implementer)
  const lock = (x: number, y: number, c: string) => {
    ag2.strokeStyle = c; ag2.lineWidth = 3.5; ag2.beginPath(); ag2.arc(x + 9, y - 3, 6.5, Math.PI, 0); ag2.stroke();
    ag2.fillStyle = c; ag2.fillRect(x, y - 2, 18, 14);
  };
  for (const [id, t] of [['held0', 'AC-1 retries at most 3×'], ['held1', 'AC-2 never retry a decline']]) {
    const r = alloc(id, 420, 56);
    panelBg(r, '#bfe3ff', '#0c1014', 28, 3);
    lock(r.x + 22, r.y + 26, '#bfe3ff');
    ag2.font = MONO(24, true); ag2.fillStyle = '#dff1ff'; ag2.textBaseline = 'middle'; ag2.fillText(t, r.x + 54, r.y + 29);
  }
  // ---- printer bar
  {
    const r = alloc('bar', 480, 50);
    rr(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 10); ag2.fillStyle = '#1a1614'; ag2.fill();
    ag2.strokeStyle = '#3a322c'; ag2.lineWidth = 3; ag2.stroke();
    ag2.fillStyle = '#050403'; ag2.fillRect(r.x + 30, r.y + 8, r.w - 60, 9);
    ag2.fillStyle = OR; ag2.fillRect(r.x + 30, r.y + 15, r.w - 60, 3);
    ag2.font = MONO(18, true); ag2.fillStyle = GR; ag2.textBaseline = 'middle'; ag2.fillText('ÖGE', r.x + 30, r.y + 33);
    ag2.beginPath(); ag2.arc(r.x + r.w - 40, r.y + 33, 6, 0, Math.PI * 2); ag2.fillStyle = GREEN; ag2.fill();
  }
  // ---- command chips
  for (const [id, t] of [['cmd0', '/diff'], ['cmd1', '/apply'], ['cmd2', '/receipt']]) {
    const r = alloc(id, 240, 54);
    panelBg(r, OR, '#160f0b', 12, 3);
    ag2.font = MONO(28, true); ag2.fillStyle = CR; ag2.textBaseline = 'middle'; ag2.fillText(t, r.x + 22, r.y + 28);
  }
  // ---- stamp ink (alpha)
  {
    const r = alloc('ink', 512, 320);
    ag2.drawImage(makeInk(), r.x, r.y);
  }
  // ---- token glyphs (16 cells, white on transparent)
  const TOK = ['retry', 'err', 'nil', 'if', 'func', 'ctx', 'return', '++', '{', '}', ':=', '!=', 'test', 'i<3', 'ok', 'Is('];
  {
    // 8 × 2 cells of 74 × 48 under the check-board column
    const r = { x: 6, y: 5 * 160 + 24, w: 8 * 74, h: 96 };
    rects.tok = r;
    ag2.fillStyle = '#fff'; ag2.textAlign = 'center'; ag2.textBaseline = 'middle';
    ag2.font = MONO(22, true);
    TOK.forEach((s, i) => ag2.fillText(s, r.x + (i % 8) * 74 + 37, r.y + Math.floor(i / 8) * 48 + 25));
    ag2.textAlign = 'left';
  }
  // ---- agent terminals (30 lines: 20 + the first 10 repeated so the 10-line window scrolls without a seam)
  const TERM_LINES: Line[][] = [
    [['o', '› chat 2 · fix flaky TestUpload'], ['d', 'read internal/upload/upload_test.go'], ['c', 'func TestUpload(t *testing.T) {'], ['c', '  srv := httptest.NewServer(h)'], ['d', '› think: race on srv.Close'], ['c', '+ t.Cleanup(srv.Close)'], ['c', '- defer srv.Close()'], ['d', 'go test ./internal/upload -race'], ['c', 'ok  internal/upload 1.92s'], ['o', '› waiting for QA'],
      ['d', 'read internal/upload/limit.go'], ['c', 'const maxBody = 32 << 20'], ['d', '› think: 413 not 500'], ['c', '+ http.MaxBytesReader(w, r.Body,'], ['c', '+   maxBody)'], ['d', 'edit internal/upload/limit.go'], ['c', '     +9 -2'], ['d', 'go vet ./...'], ['c', 'ok'], ['o', '› handing off candidate']],
    [['o', '› chat 3 · add rate limit /v1/up'], ['d', 'read cmd/api/routes.go'], ['c', 'r.Post("/v1/upload", up)'], ['d', '› plan: token bucket per key'], ['c', '+ lim := rate.NewLimiter(5, 10)'], ['c', '+ if !lim.Allow() {'], ['c', '+   http.Error(w, "slow", 429)'], ['c', '+ }'], ['d', 'go test ./cmd/api'], ['c', 'ok  cmd/api 0.88s'],
      ['d', 'read internal/limit/store.go'], ['c', 'type Store struct {'], ['c', '  mu sync.Mutex'], ['d', '› think: evict idle keys'], ['c', '+ go s.sweep(ctx, time.Minute)'], ['d', 'edit internal/limit/store.go'], ['c', '     +31 -4'], ['d', 'go test ./internal/limit'], ['c', 'ok  internal/limit 0.31s'], ['o', '› handing off candidate']],
    [['o', '› fix the payment retry bug'], ['d', 'read internal/payment/retry.go'], ['c', 'for i := 0; i < 5; i++ {'], ['d', '› think: AC says at most 3'], ['c', '+ const maxRetries = 3'], ['c', '+ if !isTransient(err) {'], ['c', '+   break'], ['c', '+ }'], ['d', 'go test ./internal/payment'], ['c', 'ok  internal/payment 0.41s'],
      ['r', '← QA: AC-2 failing (decline)'], ['d', '› think: declined ≠ transient'], ['c', '+ if errors.Is(err,'], ['c', '+     ErrDeclined) {'], ['c', '+   return err'], ['c', '+ }'], ['d', 'go test ./internal/payment'], ['c', 'ok  internal/payment 0.44s'], ['o', '› "Done. All tests pass."'], ['d', '› handing off candidate']],
  ];
  const TERM_LH = 26;
  const termRects: Rect[] = [];
  {
    const cols: Record<string, string> = { o: '#ff7a3d', c: '#ece6da', d: '#867f74', r: '#ff5a48' };
    TERM_LINES.forEach((lines, k) => {
      const r = { x: k * 520, y: AT - 30 * TERM_LH - 8, w: 512, h: 30 * TERM_LH };
      termRects.push(r);
      ag2.fillStyle = '#0b0a09'; ag2.fillRect(r.x, r.y, r.w, r.h);
      ag2.textBaseline = 'middle';
      for (let i = 0; i < 30; i++) {
        const [c, s] = lines[i % 20];
        ag2.fillStyle = cols[c]; ag2.font = MONO(19, c === 'o');
        ag2.fillText(s, r.x + 14, r.y + i * TERM_LH + TERM_LH / 2);
      }
    });
  }
  // ---- the Receipt (from the real accepted-repaired Receipt format), printed upward out of the bar
  const RC_W = 400, RC_H = 780;
  {
    const r = { x: 3 * 520 + 8, y: AT - RC_H - 8, w: RC_W, h: RC_H };
    rects.rcpt = r;
    ag2.fillStyle = '#f2eee6'; ag2.fillRect(r.x, r.y, r.w, r.h);
    ag2.fillStyle = '#26221f'; ag2.textBaseline = 'top';
    let y = r.y + 30;
    const ln = (s: string, sz = 21, b = false, dy = 29, c = '#26221f') => { ag2.font = MONO(sz, b); ag2.fillStyle = c; ag2.fillText(s, r.x + 20, y); y += dy; };
    const rule = () => ln('- - - - - - - - - - - - - - -', 18, false, 26, '#8a847a');
    // short and large enough to read through the post chain; the blank band is where the stamp lands
    ln('ÖGE RECEIPT', 44, true, 56);
    ln('Run 20261112T1542', 24, false, 34, '#5d5750');
    rule();
    ln('✓ Accepted', 40, true, 54, '#1d6b3c');
    ln('fix the payment', 30, false, 38);
    ln('retry bug', 30, false, 44);
    ln('Check #1 ✗ AC-2', 30, true, 38, '#b8321f');
    ln('→ sent back,', 28, false, 36);
    ln('  repaired', 28, false, 44);
    ln('Check #2 ✓ 2/2', 30, true, 44, '#1d6b3c');
    y += 150;
    ln('your attention 0s', 30, true, 44);
    ln('Not covered:', 26, true, 34, '#5d5750');
    ln('checks unsandboxed', 26, false, 36, '#5d5750');
    rule();
    // perforation at the top edge
    ag2.fillStyle = '#d6d0c2';
    for (let x = 0; x < RC_W; x += 16) ag2.fillRect(r.x + x, r.y + 4, 8, 3);
  }
  const atlasTex = new CanvasTexture(atlasCv);
  atlasTex.colorSpace = SRGBColorSpace;
  atlasTex.anisotropy = 8;
  const uvRect = (r: Rect): [number, number, number, number] => [r.x / AT, 1 - (r.y + r.h) / AT, (r.x + r.w) / AT, 1 - r.y / AT];

  // ---------------------------------------------------------------- layout (px at a 1440 × 900 reference frame)
  type Item = { id: string; atlas?: string; x: number; y: number; w?: number; h: number; mode: number; d?: number; rot?: number };
  // modes: 0 alpha/colour text · 1 opaque panel · 2 terminal · 3 receipt · 4 board · 5 typed chip · 6 diff (scanned)
  const ITEMS: Item[] = [
    // smoked glass behind the pipeline columns (drawn first): calms the desk monitors behind the labels
    { id: 'smokeL', atlas: 'tok', x: -220, y: -200, w: 860, h: 1020, mode: 7, d: 1.2 },
    { id: 'smokeR', atlas: 'tok', x: 1170, y: -200, w: 470, h: 1020, mode: 7, d: 1.2 },
    { id: 'tag', x: 612, y: 504, h: 16, mode: 0 },
    { id: 'chip', x: 40, y: 34, w: 500, h: 38, mode: 5 },
    { id: 'n1', x: 40, y: 92, h: 22, mode: 0 },
    { id: 's1', x: 40, y: 117, h: 14, mode: 0 },
    { id: 'term0', x: 35, y: 238, w: 150, h: 84, mode: 2 },
    { id: 'term1', x: 200, y: 238, w: 150, h: 84, mode: 2 },
    { id: 'term2', x: 370, y: 238, w: 150, h: 84, mode: 2 },
    { id: 'nm0', x: 110, y: 218, h: 15, mode: 0 },
    { id: 'nm1', x: 275, y: 218, h: 15, mode: 0 },
    { id: 'nm2', x: 445, y: 218, h: 15, mode: 0 },
    { id: 'n2', x: 330, y: 342, h: 22, mode: 0 },
    { id: 's2', x: 330, y: 367, h: 14, mode: 0 },
    { id: 'diff', x: 398, y: 392, w: 168, h: 84, mode: 6 },
    { id: 'n3', x: 140, y: 495, h: 20, mode: 0 },
    { id: 'n4', x: 345, y: 495, h: 20, mode: 0 },
    { id: 'board', x: 140, y: 521, w: 400, h: 112, mode: 4 },
    { id: 'held0', x: 0, y: 0, w: 168, h: 22, mode: 1 },
    { id: 'held1', x: 0, y: 0, w: 168, h: 22, mode: 1 },
    { id: 'rcpt', x: 1288, y: 120, w: 136, h: 360, mode: 3 },
    { id: 'bar', x: 1276, y: 470, w: 160, h: 17, mode: 1 },
    { id: 'n5', x: 1150, y: 469, h: 20, mode: 0 },
    { id: 'ink', x: 1292, y: 341, w: 128, h: 80, mode: 0, rot: 0.14 },
    { id: 'n6', x: 1020, y: 540, h: 21, mode: 0 },
    { id: 's6a', x: 1020, y: 565, h: 15, mode: 0 },
    { id: 's6b', x: 1020, y: 565, h: 15, mode: 0 },
    { id: 'cmd0', x: 1020, y: 590, h: 27, mode: 1 },
    { id: 'cmd1', x: 1146, y: 590, h: 27, mode: 1 },
    { id: 'cmd2', x: 1272, y: 590, h: 27, mode: 1 },
  ];
  rects.term0 = termRects[0]; rects.term1 = termRects[1]; rects.term2 = termRects[2];
  const centred = new Set(['nm0', 'nm1', 'nm2']);
  // centres of orbs (px) and orb sizes
  const ORBS = [
    { x: 110, y: 170, s: 112, col: [1.0, 0.86, 0.62], kind: 0 },   // Codex: cream
    { x: 275, y: 170, s: 112, col: [1.0, 0.62, 0.25], kind: 0 },   // Antigravity: amber
    { x: 445, y: 168, s: 126, col: [1.0, 0.36, 0.12], kind: 0 },   // Claude Code: orange (this Run)
    { x: 356, y: 434, s: 100, col: [0.62, 0.86, 1.0], kind: 1 },   // QA: cool, independent
    { x: 960, y: 590, s: 108, col: [1.0, 0.42, 0.14], kind: 2 },  // you
  ];
  const NP = ITEMS.length;
  const itemIdx: Record<string, number> = {};
  ITEMS.forEach((it, i) => {
    itemIdx[it.id] = i;
    const r = rects[it.atlas ?? it.id];
    if (!it.w) it.w = (it.h * r.w) / r.h;
    if (centred.has(it.id)) it.x -= it.w / 2;
  });
  // receipt aspect follows the atlas (keep the paper's lines undistorted)
  { const it = ITEMS[itemIdx.rcpt]; it.h = (it.w! * RC_H) / RC_W; it.y = 470 - it.h; }

  // reference hold camera → world anchors
  const refCam = new PerspectiveCamera(FOV, 1.6, 0.05, 60);
  const _v = new Vector3();
  let pxScale = 1; // shrink sizes when narrower than 16:10
  /** world point at reference-frame pixel (px, py) and depth D (along the view axis) */
  // The layout above is authored on a 1440 × 900 sheet; the post chain (and the live site) magnifies the frame
  // ~1.2× with a barrel crop, so the sheet is squeezed into the post-safe rectangle of the raw frame
  // (x 153..1291, y 104..626), which also keeps it clear of the header and the "Selected work" nav.
  const SAFE_LAND = { x0: 35, y0: 34, X0: 153, Y0: 104, sx: 0.825, sy: 0.86, s: 0.83, half: 720 };
  const SAFE = { ...SAFE_LAND };
  /** portrait: the whole sheet shrinks into the band under the display (decorative more than legible on phones) */
  function setSafe(aspect: number) {
    if (aspect > 1.1) { Object.assign(SAFE, SAFE_LAND); return; }
    const W = 900 * aspect, k = (0.94 * W) / 1380;
    Object.assign(SAFE, { x0: 35, y0: 34, X0: 0.1 * W, Y0: 470, sx: k * 0.86, sy: k * 0.86, s: k * 0.86, half: W / 2 });
  }
  function anchor(px: number, py: number, D: number, out: Vector3) {
    const tanV = Math.tan((FOV * Math.PI) / 360), tanH = tanV * refCam.aspect;
    const rx = SAFE.X0 + (px - SAFE.x0) * SAFE.sx, ry = SAFE.Y0 + (py - SAFE.y0) * SAFE.sy;
    const nx = rx / SAFE.half - 1, ny = 1 - ry / 450;
    out.set(nx * tanH * D, ny * tanV * D, -D).applyQuaternion(refCam.quaternion).add(refCam.position);
    return out;
  }
  const worldPerPx = (D: number) => (2 * Math.tan((FOV * Math.PI) / 360) * D) / 900;
  // the layer floats just in front of the camera so no room geometry can cut through it
  const D_PANEL = 1.32, D_ORB = 1.28;

  // ---------------------------------------------------------------- panels (one instanced draw)
  const pR = new InstancedBufferAttribute(new Float32Array(NP * 4), 4);
  const pP = new InstancedBufferAttribute(new Float32Array(NP * 4), 4);
  const pT = new InstancedBufferAttribute(new Float32Array(NP * 4), 4);
  ITEMS.forEach((it, i) => { pR.array.set(uvRect(rects[it.atlas ?? it.id]), i * 4); pP.array[i * 4] = it.mode; });
  const panelMesh = (() => {
    const m = new MeshBasicNodeMaterial();
    m.transparent = true; m.depthWrite = false; m.depthTest = false; m.toneMapped = false; m.fog = false;
    const vR: N = varying(instancedBufferAttribute(pR, 'vec4'), 'vPanR');
    const vP: N = varying(instancedBufferAttribute(pP, 'vec4'), 'vPanP');
    const vT: N = varying(instancedBufferAttribute(pT, 'vec4'), 'vPanT');
    const BOARD_STRIDE = (156 + 4) / AT;
    m.colorNode = Fn(() => {
      const p = uv();
      const mode = vP.x, alpha = vP.y, p1 = vP.z, p2 = vP.w;
      const tint = vT.xyz, appear = vT.w;
      const isTerm = step(1.5, mode).mul(step(mode, 2.5));
      const isRc = step(2.5, mode).mul(step(mode, 3.5));
      const isBoard = step(3.5, mode).mul(step(mode, 4.5));
      const isChip = step(4.5, mode).mul(step(mode, 5.5));
      const isDiff = step(5.5, mode).mul(step(mode, 6.5));
      const isSmoke = step(6.5, mode);
      // content fraction from the top of the atlas rect
      const fTop0 = float(1).sub(p.y);
      const fTerm = p1.mul(20).add(fTop0.mul(10)).div(30);
      const fRc = p1.sub(p.y);                                   // receipt grows upward: header farthest from the slot
      const fTop = mix(mix(fTop0, fTerm, isTerm), fRc, isRc);
      const ux = mix(vR.x, vR.z, p.x);
      const uy = vR.w.sub(fTop.mul(vR.w.sub(vR.y))).sub(isBoard.mul(p1.mul(BOARD_STRIDE)));
      const tx: N = texture(atlasTex, vec2(ux, uy));
      let rgb: N = tx.rgb;
      let a: N = tx.a;
      // text (mode 0): tinted coverage
      // terminal: typing on the bottom line + block cursor; dim when the agent idles
      const lineIdx = fTop0.mul(10);
      const onLast = step(9, lineIdx);
      const hideT = onLast.mul(step(p2, p.x)).mul(isTerm);
      const cur = onLast.mul(step(p2, p.x)).mul(step(p.x, p2.add(0.035))).mul(step(0.5, fract(uTime.mul(2.2)))).mul(isTerm);
      rgb = mix(rgb, vec3(0.006, 0.005, 0.0045), hideT);
      const tEdge = max(max(step(p.x, 0.012), step(0.988, p.x)), max(step(p.y, 0.022), step(0.978, p.y))).mul(isTerm);
      rgb = mix(rgb, vec3(0.42, 0.13, 0.04), tEdge);
      rgb = rgb.add(vec3(1, 0.36, 0.12).mul(cur.mul(1.4)));
      // receipt: only the printed part exists; serrated tear edge on top; soft paper shading
      const serr = abs(fract(p.x.mul(16)).sub(0.5)).mul(0.012);
      const printed = step(p.y, p1.sub(serr)).mul(step(0.0005, p1));
      a = mix(a, printed, isRc);
      rgb = mix(rgb, rgb.mul(float(0.86).add(p.x.mul(0.14))), isRc);
      // typed chip: reveal left → right with a cursor
      const inner = step(0.012, p.x).mul(step(p.x, 0.988)).mul(step(0.12, p.y)).mul(step(p.y, 0.88));
      const hideC = step(p1, p.x).mul(inner).mul(isChip);
      const curC = step(p1, p.x).mul(step(p.x, p1.add(0.012))).mul(inner).mul(step(0.4, fract(uTime.mul(2)))).mul(isChip).mul(step(p1, 0.999));
      rgb = mix(rgb, vec3(0.006, 0.0045, 0.004), hideC).add(vec3(1, 0.35, 0.1).mul(curC.mul(1.5)));
      // diff: QA scan line (p1 = position from top, p2 = strength); scanned rows turn cool
      const dy = fTop0.sub(p1);
      const band = exp(abs(dy).mul(-70)).mul(p2);
      const scanned = step(dy, 0).mul(p2).mul(0.35);
      rgb = mix(rgb, rgb.add(vec3(0.03, 0.12, 0.2).mul(scanned)).add(vec3(0.35, 0.75, 1.0).mul(band.mul(0.9))), isDiff);
      // board brightness (blink while running) and panel tint
      rgb = mix(rgb, rgb.mul(p2), isBoard);
      rgb = rgb.mul(tint);
      // hologram materialise: horizontal slices flicker in while appearing
      const slice = floor(p.y.mul(18)).add(floor(uTime.mul(18)));
      const hsh = fract(sin(slice.mul(91.7).add(vR.x.mul(311))).mul(43758.5453));
      const vis = clamp(appear.mul(1.3).sub(hsh.mul(0.3)).sub(0.15).mul(6), 0, 1);
      const scan = sin(p.y.mul(160)).mul(0.04).add(0.96);
      // smoked glass: feathered dark pane
      const fe = smoothstep(0, 0.16, p.x).mul(smoothstep(0, 0.16, float(1).sub(p.x))).mul(smoothstep(0, 0.14, p.y)).mul(smoothstep(0, 0.14, float(1).sub(p.y)));
      rgb = mix(rgb.mul(scan), vec3(0.0035, 0.003, 0.0027), isSmoke);
      a = mix(a, fe, isSmoke);
      return vec4(rgb, a.mul(alpha).mul(mix(vis, float(1), isSmoke)));
    })();
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), m, NP);
    mesh.frustumCulled = false;
    mesh.renderOrder = 11;
    pR.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  })();

  // ---------------------------------------------------------------- orbs (agents, QA, you): additive billboards
  const NO = ORBS.length;
  const oA = new InstancedBufferAttribute(new Float32Array(NO * 4), 4); // centre xyz, size
  const oB = new InstancedBufferAttribute(new Float32Array(NO * 4), 4); // colour, activity
  const oC = new InstancedBufferAttribute(new Float32Array(NO * 4), 4); // kind, seed, flare, -
  ORBS.forEach((o, i) => { oB.array.set([...o.col, 0], i * 4); oC.array.set([o.kind, i * 0.37, 0, 0], i * 4); });
  const uRight = uniform(new Vector3(1, 0, 0)), uUp = uniform(new Vector3(0, 1, 0));
  {
    const m = new MeshBasicNodeMaterial();
    m.transparent = true; m.depthWrite = false; m.depthTest = false; m.blending = AdditiveBlending; m.toneMapped = false; m.fog = false;
    const A: N = instancedBufferAttribute(oA, 'vec4');
    m.positionNode = A.xyz.add(uRight.mul(positionGeometry.x.mul(A.w))).add(uUp.mul(positionGeometry.y.mul(A.w)));
    const vB: N = varying(instancedBufferAttribute(oB, 'vec4'), 'vOrbB');
    const vK: N = varying(instancedBufferAttribute(oC, 'vec4'), 'vOrbK');
    m.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const r = length(p);
      const ang = atan(p.y, p.x);
      const col = vB.xyz, act = vB.w, kind = vK.x, seed = vK.y, flare = vK.z;
      const tt = uTime.add(seed.mul(10));
      const isQA = step(0.5, kind).mul(step(kind, 1.5));
      const isYou = step(1.5, kind);
      // plasma core: swirling bands inside a soft sphere
      const swirl = sin(ang.mul(3).add(r.mul(11)).sub(tt.mul(2.6))).mul(0.5).add(0.5);
      const swirl2 = sin(ang.mul(-5).add(r.mul(17)).add(tt.mul(1.7))).mul(0.5).add(0.5);
      const ball = rsmooth(0.42, 0.3, r);
      const plasma = ball.mul(swirl.mul(swirl2).mul(0.9).add(0.25)).mul(float(1).sub(isYou));
      const core = exp(r.mul(r).mul(-60)).mul(1.6).mul(float(1).sub(isYou));
      const halo = exp(r.mul(-4.2)).mul(0.35);
      // orbiting rings with travelling gaps (the "thinking" ring speeds up with activity)
      const sp = act.mul(2.4).add(0.3);
      const ring1 = exp(abs(r.sub(0.56)).mul(-90)).mul(smoothstep(-0.2, 0.6, sin(ang.add(tt.mul(sp)))));
      const ring2 = exp(abs(r.sub(0.7)).mul(-120)).mul(smoothstep(0.3, 0.9, sin(ang.mul(3).sub(tt.mul(sp.mul(0.7)))))).mul(0.7);
      // QA: a horizontal scanning eye-line sweeps through the core
      const eye = exp(abs(p.y.sub(sin(tt.mul(3)).mul(0.28))).mul(-40)).mul(step(r, 0.5)).mul(isQA).mul(act);
      // you: an abstract person (head + shoulders) inside an attention ring that pulses when lit
      const head = rsmooth(0.165, 0.135, length(p.sub(vec2(0, 0.14))));
      const sh = length(vec2(p.x.mul(0.8), p.y.add(0.38)));
      const body = rsmooth(0.33, 0.3, sh).mul(step(p.y, -0.09)).mul(step(0, p.y.add(0.4)));
      const person = max(head, body).mul(isYou);
      const pulse = exp(abs(r.sub(fract(tt.mul(0.7)).mul(0.5).add(0.5))).mul(-40)).mul(float(1).sub(fract(tt.mul(0.7)))).mul(isYou).mul(act);
      const youRing = exp(abs(r.sub(0.62)).mul(-70)).mul(isYou);
      const youCol = mix(vec3(0.22, 0.21, 0.2), col, act);
      let c: N = col.mul(plasma.mul(act.mul(0.9).add(0.25)).add(core.mul(act.mul(0.8).add(0.2))).add(halo.mul(act.mul(1.2).add(0.15))));
      c = c.add(col.mul(ring1.add(ring2).mul(act.mul(0.8).add(0.12))));
      c = c.add(vec3(0.8, 0.95, 1).mul(eye.mul(1.2)));
      c = c.add(youCol.mul(youRing.mul(act.mul(1.4).add(0.35)).add(halo.mul(isYou).mul(act.mul(1.5))).add(pulse.mul(1.2))));
      c = c.add(mix(vec3(0.16, 0.155, 0.15), vec3(1, 0.93, 0.85), act).mul(person.mul(0.9)));
      c = c.add(vec3(1, 0.5, 0.3).mul(halo.mul(flare).mul(2.5)));
      c = c.mul(rsmooth(1, 0.85, r));
      return vec4(c, 1);
    })();
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), m, NO);
    mesh.frustumCulled = false;
    mesh.renderOrder = 13;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- tokens: glyphs streaming agent → terminal, diff → QA
  const NTA = high ? 34 : 24, NTQ = high ? 30 : 20;
  const NT = NTA * 3 + NTQ;
  const tS = new InstancedBufferAttribute(new Float32Array(NT * 4), 4); // start xyz, seed
  const tE = new InstancedBufferAttribute(new Float32Array(NT * 4), 4); // end xyz, stream index 0..3
  const tokJ: number[] = [];
  { const r = mulberry(31); for (let i = 0; i < NT; i++) tokJ.push(r(), r(), r()); }
  const uAct = [uniform(0), uniform(0), uniform(0), uniform(0)];
  const uTokSize = uniform(0.02);
  {
    const m = new MeshBasicNodeMaterial();
    m.transparent = true; m.depthWrite = false; m.depthTest = false; m.blending = AdditiveBlending; m.toneMapped = false; m.fog = false;
    const S: N = instancedBufferAttribute(tS, 'vec4');
    const E: N = instancedBufferAttribute(tE, 'vec4');
    const seed = S.w;
    const prog = fract(uTime.mul(seed.mul(0.35).add(0.45)).add(seed.mul(17.3)));
    const mid = S.xyz.add(E.xyz).mul(0.5).add(uUp.mul(seed.sub(0.5).mul(0.12))).add(uRight.mul(fract(seed.mul(7.1)).sub(0.5).mul(0.16)));
    const k = prog;
    const pos = S.xyz.mul(float(1).sub(k).mul(float(1).sub(k))).add(mid.mul(k.mul(float(1).sub(k)).mul(2))).add(E.xyz.mul(k.mul(k)));
    const sz = uTokSize.mul(seed.mul(0.5).add(0.75));
    m.positionNode = pos.add(uRight.mul(positionGeometry.x.mul(sz.mul(2)))).add(uUp.mul(positionGeometry.y.mul(sz)));
    const vPr: N = varying(prog, 'vTokP');
    const vSd: N = varying(seed, 'vTokS');
    const vSt: N = varying(E.w, 'vTokI');
    const r = rects.tok;
    const u0 = r.x / AT, vTop = 1 - r.y / AT, du = 74 / AT, dv = 48 / AT;
    m.colorNode = Fn(() => {
      const p = uv();
      const cell = floor(vSd.mul(16));
      const col8 = cell.mod(8), row8 = floor(cell.div(8));
      const g = texture(atlasTex, vec2(float(u0).add(col8.add(p.x).mul(du)), float(vTop).sub(row8.add(float(1).sub(p.y)).mul(dv)))).a;
      const st = vSt;
      const act = select(st.lessThan(0.5), uAct[0], select(st.lessThan(1.5), uAct[1], select(st.lessThan(2.5), uAct[2], uAct[3])));
      const col = select(st.lessThan(2.5), mix(vec3(1, 0.62, 0.32), vec3(1, 0.85, 0.65), fract(vSd.mul(5.3))), vec3(0.6, 0.85, 1));
      const fade = smoothstep(0, 0.15, vPr).mul(rsmooth(1, 0.8, vPr));
      return vec4(col.mul(g).mul(fade).mul(act).mul(1.3), 1);
    })();
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), m, NT);
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- links, repair arc and the QA beam: camera-facing ribbons
  const SEGS = 28;
  // curve ids: 0 task→CC, 1 CC→diff, 2 QA→board, 3 board→printer, 4 printer→you, 5 repair arc board→CC, 6 QA beam
  const NCURVE = 7;
  const nV = NCURVE * (SEGS + 1) * 2;
  const rPos = new Float32Array(nV * 3);
  const rAux = new Float32Array(nV * 4); // s, across, -, kind
  const rPar = new Float32Array(nV * 4); // prog, intensity, dir, -
  const ribGeo = new BufferGeometry();
  {
    const idx: number[] = [];
    for (let c = 0; c < NCURVE; c++) for (let i = 0; i < SEGS; i++) {
      const a = (c * (SEGS + 1) + i) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    ribGeo.setIndex(idx);
    ribGeo.setAttribute('position', new BufferAttribute(rPos, 3));
    ribGeo.setAttribute('aux', new BufferAttribute(rAux, 4));
    ribGeo.setAttribute('par', new BufferAttribute(rPar, 4));
    const m = new MeshBasicNodeMaterial();
    m.transparent = true; m.depthWrite = false; m.depthTest = false; m.blending = AdditiveBlending; m.toneMapped = false; m.fog = false; m.side = DoubleSide;
    const vAux: N = varying(attribute('aux', 'vec4'), 'vRibA');
    const vPar: N = varying(attribute('par', 'vec4'), 'vRibP');
    m.colorNode = Fn(() => {
      const s = vAux.x, across = vAux.y, kind = vAux.w;
      const prog = vPar.x, inten = vPar.y, dir = vPar.z;
      const prof = exp(abs(across.sub(0.5)).mul(-9));
      const isBeam = step(2.5, kind);
      const isRep = step(0.5, kind).mul(step(kind, 1.5));
      // forward (dir>0): lit behind the head (s < prog); backward: lit ahead of it (s > prog)
      const lit = select(dir.greaterThan(0), step(s, prog), step(prog, s));
      const head = exp(abs(s.sub(prog)).mul(-28)).mul(step(0.001, prog)).mul(step(prog, 0.999));
      const dash = step(0.55, fract(s.mul(26).sub(uTime.mul(0.8)))).mul(0.13);
      const base: N = mix(vec3(1, 0.36, 0.12), vec3(1, 0.18, 0.1), isRep);
      let c: N = base.mul(dash.add(lit.mul(0.55)).add(head.mul(2.4))).mul(prof).mul(inten);
      // QA beam: fan from the orb (s=0) to the scan line (s=1)
      const beam = vec3(0.45, 0.8, 1).mul(pow(s, 1.6).mul(0.32).add(exp(s.sub(1).abs().mul(-30)).mul(0.9))).mul(inten);
      c = mix(c, beam, isBeam);
      return vec4(c, 1);
    })();
    const mesh = new Mesh(ribGeo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    scene.add(mesh);
  }
  // curve control points in reference px (+ depth); beam is rebuilt from the scan line each frame
  const CURVES: [number, number][][] = [
    [[445, 74], [445, 110], [445, 136]],
    [[452, 324], [462, 360], [478, 392]],
    [[352, 470], [330, 500], [300, 545]],
    [[540, 590], [562, 516], [600, 482], [900, 478], [1200, 477], [1276, 476]],
    [[1300, 490], [1190, 518], [1070, 556], [1008, 582]],
    [[540, 552], [578, 470], [586, 330], [540, 228], [482, 192]],
  ];
  const _rt = new Vector3(), _a = new Vector3(), _b = new Vector3(), _t = new Vector3(), _sd = new Vector3(), _fw = new Vector3();
  const cr = (p0: number, p1: number, p2: number, p3: number, k: number) =>
    0.5 * (2 * p1 + (-p0 + p2) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k * k + (-p0 + 3 * p1 - 3 * p2 + p3) * k * k * k);
  /** sample a Catmull-Rom curve through px points at u∈[0,1] */
  function curvePx(pts: [number, number][], u: number): [number, number] {
    const n = pts.length - 1;
    const f = Math.min(n - 1e-6, u * n), i = Math.floor(f), k = f - i;
    const P = (j: number) => pts[Math.max(0, Math.min(n, j))];
    return [cr(P(i - 1)[0], P(i)[0], P(i + 1)[0], P(i + 2)[0], k), cr(P(i - 1)[1], P(i)[1], P(i + 1)[1], P(i + 2)[1], k)];
  }
  function writeCurve(c: number, ptAt: (u: number, out: Vector3) => Vector3, widthAt: (u: number) => number, kind: number, prog: number, inten: number, dir: number) {
    _fw.set(0, 0, -1).applyQuaternion(refCam.quaternion);
    _rt.set(1, 0, 0).applyQuaternion(refCam.quaternion);
    for (let i = 0; i <= SEGS; i++) {
      const u = i / SEGS;
      ptAt(u, _a);
      ptAt(Math.min(1, u + 1 / SEGS), _b);
      if (i === SEGS) { ptAt(u - 1 / SEGS, _b); _t.subVectors(_a, _b); } else _t.subVectors(_b, _a);
      if (kind === 3) _sd.copy(_rt); else _sd.crossVectors(_t, _fw).normalize();
      _sd.multiplyScalar(widthAt(u) / 2);
      for (let s = 0; s < 2; s++) {
        const o = (c * (SEGS + 1) + i) * 2 + s;
        rPos[o * 3] = _a.x + (s ? _sd.x : -_sd.x); rPos[o * 3 + 1] = _a.y + (s ? _sd.y : -_sd.y); rPos[o * 3 + 2] = _a.z + (s ? _sd.z : -_sd.z);
        rAux[o * 4] = u; rAux[o * 4 + 1] = s; rAux[o * 4 + 3] = kind;
        rPar[o * 4] = prog; rPar[o * 4 + 1] = inten; rPar[o * 4 + 2] = dir;
      }
    }
  }

  // ---------------------------------------------------------------- story (a pure function of t; scroll can run backwards)
  const ph = (a: number, b: number, t: number) => sat((t - a) / (b - a));
  const _m = new Matrix4(), _q2 = new Quaternion(), _s3 = new Vector3(), _p3 = new Vector3(), _e2 = new Euler();
  const stampPos = new Vector3();
  function layoutAndStory(t: number, time: number, aspect: number) {
    setSafe(aspect);
    pxScale = (aspect > 1.1 ? Math.min(1, aspect / 1.6) : 1) * SAFE.s;
    // portrait screens are too narrow for the sheet: the pipeline stays hidden there (the DOM panel tells the story)
    const vis = aspect > 1.1 ? 1 : 0;
    const show = vis * sstep(0.12, 0.22, t) * (1 - sstep(0.83, 0.9, t));
    const stagger = (k: number) => vis * sstep(0.12 + k * 0.012, 0.2 + k * 0.012, t) * (1 - sstep(0.83, 0.9, t));
    // --- phases
    const typed = ph(0.17, 0.25, t);
    const implA = sstep(0.23, 0.27, t) * (1 - sstep(0.38, 0.42, t));
    const repair = sstep(0.52, 0.535, t) * (1 - sstep(0.605, 0.62, t));
    const qa = sstep(0.39, 0.42, t) * (1 - sstep(0.49, 0.52, t));
    const scanK = ph(0.41, 0.48, t);
    
    const boardV = t < 0.48 ? 0 : t < 0.51 ? 1 : t < 0.61 ? 2 : t < 0.63 ? 3 : 4;
    const running = boardV === 1 || boardV === 3;
    const printK = ph(0.65, 0.7, t);
    const stampK = ph(0.702, 0.716, t);
    const youK = sstep(0.735, 0.755, t);
    const cmdK = (i: number) => sstep(0.745 + i * 0.01, 0.765 + i * 0.01, t);
    // --- per-item state
    const P = pP.array as Float32Array, T = pT.array as Float32Array;
    const set = (id: string, alpha: number, p1 = 0, p2 = 0, tint: [number, number, number] = [1, 1, 1], appear = 1) => {
      const i = itemIdx[id];
      P[i * 4 + 1] = alpha; P[i * 4 + 2] = p1; P[i * 4 + 3] = p2;
      T.set([tint[0], tint[1], tint[2], appear], i * 4);
    };
    const hi = (k: number, lo = 0.5): [number, number, number] => { const b = lo + (1 - lo) * k; return [b, b, b]; };
    set('smokeL', 0.95 * show, 0, 0, [1, 1, 1], 1);
    set('smokeR', 0.95 * show, 0, 0, [1, 1, 1], 1);
    set('tag', 0.75 * show, 0, 0, hi(youK, 0.75), stagger(9));
    set('chip', show, typed, 0, [1, 1, 1], stagger(0));
    const implOn = Math.max(implA, repair);
    set('n1', show, 0, 0, hi(implOn, 0.55), stagger(1));
    set('s1', show * 0.9, 0, 0, hi(implOn, 0.6), stagger(1));
    const agentAct = [0.55 + 0.1 * Math.sin(time * 0.7), 0.55 + 0.1 * Math.sin(time * 0.9 + 2), 0.28 + 0.72 * implOn];
    for (let k = 0; k < 3; k++) {
      // terminals stream line by line; the bottom line types out
      const rate = k === 2 ? 1.6 : 1.1 + k * 0.3;
      const lines = time * rate + k * 7.3;
      const scroll = (Math.floor(lines) % 20) / 20;
      set(`term${k}`, show * 0.95, scroll, (lines % 1) * 1.15, hi(agentAct[k], 0.45), stagger(2 + k * 0.5));
      set(`nm${k}`, show, 0, 0, hi(k === 2 ? implOn : 0.6, 0.6), stagger(2 + k * 0.5));
    }
    set('n2', show, 0, 0, hi(qa, 0.55), stagger(4));
    set('s2', show * 0.9, 0, 0, hi(qa, 0.6), stagger(4));
    const diffOn = sstep(0.38, 0.41, t);
    set('diff', show * (0.35 + 0.65 * diffOn), scanK, qa, hi(Math.max(diffOn * 0.7, qa), 0.5), stagger(5));
    set('n3', show, 0, 0, hi(sstep(0.44, 0.47, t) * (1 - sstep(0.62, 0.66, t)), 0.55), stagger(6));
    set('n4', show, 0, 0, repair > 0.01 ? [1, 0.55 + 0.45 * (1 - repair) - 0.2 * repair, 0.5 + 0.5 * (1 - repair) - 0.25 * repair] : hi(0, 0.55), stagger(6));
    const blink = running ? 0.75 + 0.25 * Math.sin(time * 14) : 1;
    set('board', show, boardV, (boardV === 0 ? 0.6 : 1) * blink, [1, 1, 1], stagger(7));
    // held-out chips fly from the QA orb into the board, then fold into it
    for (let k = 0; k < 2; k++) {
      const kk = ph(0.44 + k * 0.015, 0.475 + k * 0.015, t);
      const vis = kk > 0 && kk < 1 ? 1 : 0;
      set(`held${k}`, show * vis * Math.min(1, kk * 6) * Math.min(1, (1 - kk) * 5), 0, 0, [1, 1, 1], 1);
      const it = ITEMS[itemIdx[`held${k}`]];
      const e = easeInOut(kk);
      const [cx, cy] = curvePx([[356, 434], [310 + k * 40, 500], [250 + k * 70, 560 + k * 4]], e);
      it.x = cx - it.w! / 2; it.y = cy - it.h / 2;
    }
    set('rcpt', show, printK > 0 ? Math.max(0.002, Math.min(1, (Math.floor(printK * 40) + sstep(0, 0.5, (printK * 40) % 1)) / 40)) : 0, 0, [1, 1, 1], 1);
    set('bar', show, 0, 0, hi(sstep(0.63, 0.65, t) * (1 - sstep(0.71, 0.74, t)), 0.6), stagger(8));
    set('n5', show, 0, 0, hi(sstep(0.64, 0.66, t) * (1 - sstep(0.72, 0.75, t)), 0.55), stagger(8));
    set('ink', show * (stampK > 0 ? 1 : 0) * Math.min(1, stampK * 3), 0, 0, [1.0, 0.24, 0.06], 1);
    set('n6', show, 0, 0, hi(youK, 0.5), stagger(9));
    set('s6a', show * (1 - youK) * 0.9, 0, 0, [1, 1, 1], stagger(9));
    set('s6b', show * youK, 0, 0, [1, 1, 1], 1);
    for (let i = 0; i < 3; i++) set(`cmd${i}`, show * (0.25 + 0.75 * cmdK(i)), 0, 0, hi(cmdK(i), 0.4), stagger(9));
    pP.needsUpdate = true; pT.needsUpdate = true;

    // --- panel transforms
    const wpp = worldPerPx(D_PANEL);
    ITEMS.forEach((it, i) => {
      let w = it.w! * pxScale, h = it.h * pxScale;
      let cx = it.x + it.w! / 2, cy = it.y + it.h / 2;
      if (it.id === 'ink') {
        // the stamp slams down: from large + transparent to its resting size, with a small overshoot
        const k = stampK;
        const s = k < 1 ? lerp(1.9, 0.94, easeIn(k)) : 1 - 0.06 * Math.exp(-(t - 0.716) * 300) * Math.cos((t - 0.716) * 900);
        w *= s; h *= s;
      }
      if (it.id === 'rcpt') cy = it.y + it.h / 2; // grows upward in the shader; the quad stays put
      // gentle hologram bob
      const bob = Math.sin(time * 0.9 + i * 1.7) * 1.2;
      const D = it.d ?? D_PANEL;
      anchor(cx, cy + (it.mode === 7 ? 0 : bob), D, _p3);
      _q2.copy(refCam.quaternion);
      if (it.rot) _q2.multiply(new Quaternion().setFromEuler(_e2.set(0, 0, it.rot)));
      const wk = worldPerPx(D) / wpp;
      _s3.set(w * wpp * wk, h * wpp * wk, 1);
      _m.compose(_p3, _q2, _s3);
      panelMesh.setMatrixAt(i, _m);
      if (it.id === 'ink') stampPos.copy(_p3);
    });
    panelMesh.instanceMatrix.needsUpdate = true;

    // --- orbs
    const youAct = 0.12 + 0.88 * youK;
    const qaAct = 0.22 + 0.78 * Math.max(qa, sstep(0.61, 0.62, t) * (1 - sstep(0.63, 0.65, t)) * 0.6);
    const acts = [agentAct[0], agentAct[1], agentAct[2], qaAct, youAct];
    const wpo = worldPerPx(D_ORB);
    ORBS.forEach((o, i) => {
      anchor(o.x, o.y + Math.sin(time * 1.1 + i) * 2, D_ORB, _p3);
      const s = o.s * pxScale * wpo * (1 + 0.04 * Math.sin(time * 2 + i) * acts[i]);
      oA.array.set([_p3.x, _p3.y, _p3.z, s * stagger(i < 3 ? 2 + i * 0.5 : i === 3 ? 4 : 9)], i * 4);
      oB.array[i * 4 + 3] = acts[i];
      oC.array[i * 4 + 2] = i === 2 ? repair * (0.6 + 0.4 * Math.sin(time * 9)) : 0;
    });
    oA.needsUpdate = true; oB.needsUpdate = true; oC.needsUpdate = true;

    // --- tokens
    uAct[0].value = agentAct[0] * show; uAct[1].value = agentAct[1] * show; uAct[2].value = (0.15 + 0.85 * implOn) * agentAct[2] * show;
    uAct[3].value = qa * show;
    uTokSize.value = 10 * wpo * pxScale;
    const S = tS.array as Float32Array, E = tE.array as Float32Array;
    for (let i = 0; i < NT; i++) {
      const st = i < NTA * 3 ? Math.floor(i / NTA) : 3;
      const j0 = tokJ[i * 3], j1 = tokJ[i * 3 + 1], j2 = tokJ[i * 3 + 2];
      if (st < 3) {
        const o = ORBS[st];
        anchor(o.x + (j0 - 0.5) * 20, o.y + (j1 - 0.5) * 16, D_ORB, _a);
        const tm = ITEMS[itemIdx[`term${st}`]];
        anchor(tm.x + 12 + j2 * (tm.w! - 24), tm.y + 6 + j1 * 30, D_PANEL, _b);
      } else {
        const dc = ITEMS[itemIdx.diff];
        anchor(dc.x + 10 + j0 * (dc.w! - 20), dc.y + 10 + j1 * (dc.h - 20), D_PANEL, _a);
        anchor(ORBS[3].x, ORBS[3].y, D_ORB, _b);
      }
      S.set([_a.x, _a.y, _a.z, j0 * 0.618 + j2 * 0.382], i * 4);
      E.set([_b.x, _b.y, _b.z, st], i * 4);
    }
    tS.needsUpdate = true; tE.needsUpdate = true;

    // --- ribbons
    const wl = 3 * wpp * pxScale;
    const link = (c: number, prog: number, inten: number, dir = 1, kind = 0) => {
      const pts = CURVES[c];
      const w = kind === 1 ? wl * (1 + 1.6 * repair) : wl;
      writeCurve(c, (u, out) => { const [x, y] = curvePx(pts, u); return anchor(x, y, D_PANEL, out); }, () => w, kind, prog, inten * show, dir);
    };
    link(0, ph(0.24, 0.27, t), 1);
    link(1, ph(0.385, 0.41, t), 1);
    link(2, ph(0.44, 0.49, t), 1);
    link(3, ph(0.63, 0.65, t), 1);
    link(4, ph(0.72, 0.74, t), 1);
    // repair arc: board → Claude Code (.525 → .565), then the new candidate rides back (.565 → .61)
    if (t < 0.565) link(5, ph(0.525, 0.565, t), 0.5 + 1.3 * repair, 1, 1);
    else link(5, 1 - ph(0.565, 0.61, t), 0.5 + 1.3 * repair, -1, 1);
    // QA beam: from the orb to the scan line across the diff card
    const dc = ITEMS[itemIdx.diff];
    const sy = dc.y + 6 + scanK * (dc.h - 12);
    const beamOn = qa * (scanK > 0 && scanK < 1 ? 1 : 0.0) * show;
    writeCurve(6, (u, out) => {
      // u: 0 at the orb → 1 at the scan line; across handled by width
      anchor(lerp(ORBS[3].x + 20, dc.x + dc.w! / 2, u), lerp(ORBS[3].y, sy, u), D_PANEL, out);
      return out;
    }, (u) => lerp(2, dc.w! * 0.98, u) * wpp * pxScale, 3, 0, beamOn, 1);
    ribGeo.attributes.position.needsUpdate = true;
    (ribGeo.attributes.aux as BufferAttribute).needsUpdate = true;
    (ribGeo.attributes.par as BufferAttribute).needsUpdate = true;
    return { stampK };
  }

  // ---------------------------------------------------------------- dust (additive billboards)
  const nDust = high ? 420 : 240;
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
    void single;

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
    // landscape: the display sits upper right (clear of the "Selected work" nav), the pipeline wraps around it
    const widthFrac = land ? 0.365 : 0.94;
    let d = SW / (widthFrac * 2 * tanH);
    d = Math.max(d, SH / (2 * 0.6 * tanV));
    return { d, ndcX: land ? 0.215 : 0, ndcY: land ? 0.318 : 0.32, tanV, tanH };
  }
  function holdEye(h: number, d: number, out: Vector3) {
    return out.set(0.3 - 0.3 * h, EYE_Y + 0.05 * Math.sin(h * Math.PI), C.z + d + 0.3 - 0.42 * h);
  }
  const _q = new Quaternion(), _e = new Euler();
  function poseBase(t: number, aspect: number, cam: PerspectiveCamera, par = { x: 0, y: 0 }, time = -1) {
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
    // parallax + idle breathing (none for the reference pose)
    const pw = 0.4 + 0.6 * w;
    const br = time >= 0 ? 1 : 0;
    cam.position.copy(eye);
    cam.up.copy(up);
    cam.lookAt(look);
    cam.translateX(par.x * 0.16 * pw + Math.sin(time * 0.31) * 0.012 * br);
    cam.translateY(par.y * 0.09 * pw + Math.sin(time * 0.47) * 0.008 * br);
    cam.lookAt(look);
    // place the display at the framed NDC position: yaw/pitch away from it
    const yaw = -Math.atan(H.ndcX * H.tanH) * w;
    const pitch = -Math.atan(H.ndcY * H.tanV) * w;
    // positive rotation about y turns left; the display sits left of centre (ndcX<0) → turn right (negative)
    _q.setFromEuler(_e.set(pitch + par.y * 0.012, -yaw + par.x * -0.015, roll, 'YXZ'));
    cam.quaternion.multiply(_q);
    cam.updateMatrixWorld(true);
  }
  function poseCamera(t: number, f: StageFrame) {
    poseBase(t, f.aspect || camera.aspect, camera, f.parallax ?? { x: 0, y: 0 }, f.time);
    // stamp impact shake
    const fl = uFlash.value;
    if (fl > 0.01) {
      camera.rotateZ(Math.sin(t * 2400) * 0.003 * fl);
      camera.rotateX(Math.sin(t * 1900 + 1) * 0.002 * fl);
    }
    camera.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- update
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
      poseCamera(t, f);
      // the pipeline is laid out against the base hold pose (no parallax / breathing), frozen outside the hold
      refCam.aspect = f.aspect || camera.aspect;
      { // follow most of the pointer parallax: the near layer then drifts about as much as the display behind it
        const par = f.parallax ?? { x: 0, y: 0 };
        poseBase(Math.min(DEPART, Math.max(ARRIVE, t)), refCam.aspect, refCam, { x: par.x * 0.78, y: par.y * 0.78 }, f.time);
      }
      // dust + orbs + tokens face the camera
      uRight.value.set(1, 0, 0).applyQuaternion(camera.quaternion);
      uUp.value.set(0, 1, 0).applyQuaternion(camera.quaternion);
      layoutAndStory(t, f.time, refCam.aspect);
      // stamp impact: flash the room accent light from the stamp
      const since = t - 0.716;
      uFlash.value = since >= 0 ? Math.exp(-since * 45) : 0;
      uPedLight.value.copy(stampPos);
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
      [termTex, thumbTex, blank, atlasTex, ...slideTex].forEach((t) => t?.dispose());
    },
  };
  void wallMesh; void If; void NormalBlending; void min;
  return stage;
}
