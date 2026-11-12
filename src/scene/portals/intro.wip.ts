/**
 * Intro portal (tile 0): the "glitch portrait" (spec-3d §5).
 *
 * Source: an original Blender-rendered bust (tools/blender/portrait), 54 frames of colour + depth packed into
 * atlases in /public/portrait (no WebCodecs video). Played ping-pong at 30 fps.
 *
 *  - voxels: ONE instanced draw (Sprite with count = 151·151·layers, SpriteNodeMaterial). No per-instance
 *    attributes: the cell + layer come from instanceIndex; colour/depth/neighbour-min are fetched in the vertex
 *    shader with textureLoad. Each voxel is a camera-facing rounded quad with a fake bevel normal (stands in for
 *    the reference's octahedral impostor; at ~5–8 px per voxel the result is the same), lit by hand with the
 *    three #E0FFFF directional lights, opacity .66.
 *  - grid: a subdivided plane displaced by the relief, drawing per-frame quadtree cell edges (1 px, fwidth),
 *    leaf levels from a precomputed atlas, teal → #222 as the reveal threshold drops.
 *  - composite: chromatic aberration, teal edge glow, radial vignette, quarter-res gaussian glow added ×.27.
 *  - pointer: CPU ray-march against the CPU copy of the depth frame (spec "locate" pass), then a stateless
 *    vertex-shader push from a smoothed cursor + velocity + hover-enter ripple (works on WebGPU and WebGL2).
 */
import {
  Scene, Color, Group, Sprite, Mesh, PlaneGeometry, SpriteNodeMaterial, MeshBasicNodeMaterial, Texture,
  NearestFilter, NoColorSpace, AdditiveBlending, RenderTarget, HalfFloatType, QuadMesh, Vector2, Vector3, Matrix4,
  type WebGPURenderer, type PerspectiveCamera,
} from 'three/webgpu';
import {
  Fn, uniform, float, int, ivec2, vec2, vec3, vec4, instanceIndex, textureLoad, texture, varying, uv, screenUV,
  smoothstep, mix, clamp, floor, fract, max, min, abs, length, normalize, dot, pow, exp2, fwidth, log2, sign,
  cameraViewMatrix, select, hash, positionGeometry,
} from 'three/tsl';
import type { Portal, PortalContext, PortalFrame } from '../types';

// ------------------------------------------------------------------ constants (spec §5)
const BASE = '/portrait/';
const N = 151;                 // xCount = yCount = floor(13.7·11)+1
const EXTENT = 13.7;           // grid units across the frame
const CELL = EXTENT / (N - 1); // voxel pitch
const CUTOFF = 0.35;
const OPACITY = 0.66;
const GROUP_SCALE = 0.44;      // grid units → portal units (tuned for the FOV-110 inner camera)
const FRAME_DIST = 1.95;       // distance camera → frame baseline when fully open
const CAM_OPEN = 0.406;        // inner camera distance to the portal plane when open (coverDepth·0.8)
const GROUP_Y = -0.12;
const TEAL = new Color().setRGB(121 / 255, 199 / 255, 199 / 255); // sRGB → linear handled by Color
const GRID_END = new Color('#222222');
const LIGHT = new Color('#E0FFFF');
const LIGHTS: [number, [number, number, number]][] = [
  [1.95, [1, 0.17, -0.05]], // top
  [0.9, [-1, -0.01, -0.46]], // left
  [1.25, [1, 0.25, 0.45]],  // right
];

const relief = (d: number) => (Math.floor(Math.max(d, CUTOFF) * 100) / 100 - CUTOFF) * 3 + CUTOFF;
const inOutQuart = (t: number) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2);
const outQuad = (t: number) => 1 - (1 - t) * (1 - t);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

type Meta = { frames: number; size: number; cols: number; rows: number; fps: number; quadtree: { roots: number; maxDepth: number; size: number; levelScale: number } };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('intro portrait: failed to load ' + src));
    im.src = src;
  });
}

export function createIntroPortal(ctx: PortalContext): Portal {
  const layers = ctx.quality === 'high' ? 3 : 2;
  const scene = new Scene();
  const background = new Color('#000000');
  const group = new Group();
  group.scale.setScalar(GROUP_SCALE);
  scene.add(group);

  // textures get their images once the atlases arrive
  const colorTex = new Texture();
  const dataTex = new Texture();
  const qtTex = new Texture();
  for (const t of [colorTex, dataTex, qtTex]) {
    t.flipY = false; t.generateMipmaps = false; t.minFilter = t.magFilter = NearestFilter; t.colorSpace = NoColorSpace;
  }

  // ------------------------------------------------------------------ uniforms
  const uFrameOff = uniform(new Vector2(0, 0));   // atlas pixel offset of the current frame (colour/data)
  const uQtOff = uniform(new Vector2(0, 0));      // quadtree atlas offset
  const uThreshold = uniform(1);
  const uGridMix = uniform(0);
  const uReveal = uniform(0);                     // 0..1 progress of the threshold sweep (grid colour)
  const uCursor = uniform(new Vector2(999, 999)); // grid units
  const uVel = uniform(new Vector2(0, 0));        // smoothed cursor velocity, grid units / s
  const uHover = uniform(0);
  const uWave = uniform(new Vector2(0, 0));
  const uWaveP = uniform(1);
  const uTime = uniform(0);

  // ------------------------------------------------------------------ voxel material
  const NN = N * N;
  const half = (N - 1) / 2;
  const load = (tex: Texture, p: any) => textureLoad(tex, p, int(0));
  const voxel = new SpriteNodeMaterial({ transparent: true, depthWrite: true, depthTest: true });
  voxel.sizeAttenuation = true;

  // all of this runs per vertex (positionNode / scaleNode are vertex-stage); fragment receives varyings
  const idx = instanceIndex.toInt();
  const layer = idx.div(NN);
  const k = idx.mod(NN);
  const ix = k.mod(N);
  const iy = k.div(N);
  const base = ivec2(uFrameOff);
  const tc = ivec2(ix, iy).add(base);
  const d4 = load(dataTex, tc);
  const depth = d4.r;
  const nmin = d4.g;
  // relief gradient (for the ≤10° normal tilt)
  const dxp = load(dataTex, tc.add(ivec2(1, 0))).r, dxm = load(dataTex, tc.sub(ivec2(1, 0))).r;
  const dyp = load(dataTex, tc.sub(ivec2(0, 1))).r, dym = load(dataTex, tc.add(ivec2(0, 1))).r; // image rows go down
  const grad = vec2(dxp.sub(dxm), dyp.sub(dym)).mul(3.0 / (2 * CELL) * 0.06);

  const dC = max(depth, CUTOFF);
  const rel = floor(dC.mul(100)).div(100).sub(CUTOFF).mul(3).add(CUTOFF);
  const visible = select(nmin.greaterThanEqual(CUTOFF - 0.002), float(1), float(0));
  const weight = smoothstep(uThreshold.sub(0.03), uThreshold.add(0.03), depth).mul(visible);
  const cxy = vec2(ix.toFloat().sub(half), float(half).sub(iy.toFloat())).mul(CELL);

  // cursor push (stateless approximation of the spec's per-voxel sim) + ripple
  const rnd = hash(k.toFloat().add(layer.toFloat().mul(7.31)));
  const toC = cxy.sub(uCursor);
  const dist = length(toC);
  const fall = smoothstep(1.1, 0.0, dist).mul(uHover);
  const speed = length(uVel);
  const speedN = clamp(speed.div(6.0), 0, 1);
  const radial = toC.div(max(dist, 1e-4));
  const velDir = uVel.div(max(speed, 1e-4));
  const pushXY = radial.mul(fall.mul(float(0.06).add(speedN.mul(0.55)))).add(velDir.mul(fall.mul(speedN).mul(0.9)));
  const pushZ = fall.mul(float(0.1).add(speedN.mul(1.1)));
  const toW = cxy.sub(uWave);
  const wd = length(toW);
  const ring = smoothstep(2.3, 0.0, abs(wd.sub(uWaveP.mul(18)))).mul(float(1).sub(uWaveP));
  const waveXY = toW.div(max(wd, 1e-4)).mul(ring.mul(0.35));
  const jitter = rnd.mul(0.8).add(0.6);
  const offXY = pushXY.add(waveXY).mul(jitter);
  const offZ = pushZ.add(ring.mul(0.6)).mul(jitter);
  const moving = clamp(length(vec3(offXY, offZ)).div(0.35), 0, 1);

  voxel.positionNode = vec3(cxy.add(offXY), rel.sub(layer.toFloat().mul(CELL)).add(offZ));
  voxel.scaleNode = vec2(weight.mul(CELL * 0.86).mul(float(1).add(moving.mul(0.25))));

  // colour: grade (contrast .84, whites +.21), sRGB→linear, moving voxels → #F0FBFF + sat/contrast boost,
  // then the cosine-palette 3×3 matrix (columns = palette(0, 1/3, 2/3) / 1.5 so white stays white)
  const cosPal = (t: number) => {
    const p = [0.263, 0.416, 0.557];
    return p.map((pi) => 0.5 + 0.5 * Math.cos(2 * Math.PI * (t + pi)) ) as [number, number, number];
  };
  const P = [cosPal(0), cosPal(1 / 3), cosPal(2 / 3)];
  const colRaw = load(colorTex, tc).rgb;
  const gradeFn = Fn(([c0, mv]: any[]) => {
    let c = c0.sub(0.5).mul(0.84).add(0.5);
    const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = c.add(smoothstep(0.5, 1.0, l).mul(0.21));
    c = pow(clamp(c, 0, 1), vec3(2.2));
    const l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l2), c, mix(1, 2.61, mv));
    c = c.sub(0.18).mul(mix(1, 2.64, mv)).add(0.18).max(0);
    c = mix(c, vec3(0.871, 0.965, 1.0), mv.mul(0.6));
    const r = vec3(P[0][0], P[0][1], P[0][2]).mul(c.x);
    const g = vec3(P[1][0], P[1][1], P[1][2]).mul(c.y);
    const b = vec3(P[2][0], P[2][1], P[2][2]).mul(c.z);
    return r.add(g).add(b).div(1.5);
  });
  const vColor = varying(gradeFn(colRaw, moving), 'vColor');
  const vGrad = varying(grad, 'vGrad');
  const vMoving = varying(moving, 'vMoving');

  // fragment: rounded voxel + fake bevel normal + 3 lambert lights (view space)
  voxel.colorNode = Fn(() => {
    const q = uv().mul(2).sub(1);
    const bev = sign(q).mul(smoothstep(0.42, 1.0, abs(q))).mul(1.15);
    let g = vGrad;
    const gl = length(g);
    g = g.mul(min(gl, 0.176).div(max(gl, 1e-5)));
    const n = normalize(vec3(bev.add(g), 1));
    let lam: any = float(0);
    for (const [I, d] of LIGHTS) {
      const L = normalize(cameraViewMatrix.mul(vec4(new Vector3(...d).normalize(), 0)).xyz);
      lam = lam.add(max(dot(n, L), 0).mul(I));
    }
    const lit = vColor.mul(vec3(LIGHT.r, LIGHT.g, LIGHT.b)).mul(lam.mul(1 / Math.PI)).mul(1.9);
    return vec4(mix(lit, vColor.mul(1.4).add(0.1), vMoving.mul(0.5)), 1);
  })();
  voxel.opacityNode = Fn(() => {
    const q = uv().mul(2).sub(1);
    const r = 0.36;
    const dq = max(abs(q).sub(1 - r), 0);
    const sd = length(dq).sub(r);
    return select(sd.lessThan(0), float(OPACITY), float(0)).mul(float(1).sub(vMoving.mul(0.25)));
  })();
  voxel.alphaTest = 0.05;

  const voxels = new Sprite(voxel);
  voxels.count = NN * layers;
  voxels.frustumCulled = false;
  voxels.renderOrder = 1;
  group.add(voxels);

  // ------------------------------------------------------------------ quadtree grid plane
  const meta0: Meta = { frames: 54, size: N, cols: 8, rows: 7, fps: 30, quadtree: { roots: 9, maxDepth: 4, size: 144, levelScale: 60 } };
  const QT = meta0.quadtree;
  const GRID_SPAN = EXTENT * 3.2;
  const gridGeo = new PlaneGeometry(GRID_SPAN, GRID_SPAN, 220, 220);
  const gridMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
  // vertex: displace by relief (unquantized), slightly behind the voxels
  const uvF = positionGeometry.xy.div(EXTENT).add(0.5);
  const inside = uvF.x.greaterThanEqual(0).and(uvF.x.lessThanEqual(1)).and(uvF.y.greaterThanEqual(0)).and(uvF.y.lessThanEqual(1));
  const gtc = ivec2(clamp(uvF.x.mul(N - 1).add(0.5), 0, N - 1).toInt(), clamp(float(1).sub(uvF.y).mul(N - 1).add(0.5), 0, N - 1).toInt()).add(base);
  const gd = select(inside, load(dataTex, gtc).r, float(0));
  const gRel = max(gd, CUTOFF).sub(CUTOFF).mul(3).add(CUTOFF).sub(CELL * 1.2);
  gridMat.positionNode = vec3(positionGeometry.xy, gRel);
  const vUvF = varying(uvF, 'vUvF');
  const vGd = varying(gd, 'vGd');
  gridMat.colorNode = Fn(() => {
    const q = vUvF.mul(QT.roots);
    const qi = ivec2(clamp(vUvF.x.mul(QT.size), 0, QT.size - 1).toInt(), clamp(float(1).sub(vUvF.y).mul(QT.size), 0, QT.size - 1).toInt()).add(ivec2(uQtOff));
    const inF = vUvF.x.greaterThanEqual(0).and(vUvF.x.lessThanEqual(1)).and(vUvF.y.greaterThanEqual(0)).and(vUvF.y.lessThanEqual(1));
    const lvRaw = floor(load(qtTex, qi).r.mul(255 / QT.levelScale).add(0.5));
    const lv0 = select(inF, lvRaw, float(0));
    const fw = max(fwidth(q).x, fwidth(q).y);
    const cap = floor(log2(float(1).div(max(fw, 1e-6)).div(4)));
    const lv = clamp(min(lv0, cap), 0, QT.maxDepth);
    const s = exp2(lv);
    const gq = q.mul(s);
    const f = fract(gq);
    const w = fwidth(q).mul(s);
    const dd = min(f, float(1).sub(f)).div(max(w, vec2(1e-6)));
    const line = float(1).sub(smoothstep(0.5, 1.1, min(dd.x, dd.y)));
    const gridCol = mix(vec3(TEAL.r, TEAL.g, TEAL.b), vec3(GRID_END.r, GRID_END.g, GRID_END.b), uReveal);
    const band = float(1).sub(smoothstep(0.0, 0.06, abs(vGd.sub(uThreshold)))).mul(select(vGd.greaterThan(CUTOFF), float(1), float(0)));
    const c = gridCol.add(vec3(TEAL.r, TEAL.g, TEAL.b).mul(band.mul(1.2)));
    return vec4(c.mul(line).mul(uGridMix), 1);
  })();
  gridMat.opacityNode = float(1);
  gridMat.blending = AdditiveBlending; // lines add onto black
  const grid = new Mesh(gridGeo, gridMat);
  grid.frustumCulled = false;
  grid.renderOrder = 0;
  group.add(grid);

  // ------------------------------------------------------------------ composite (CA, edge glow, vignette, glow ×.27)
  const sceneRT = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true });
  const blurA = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  const blurB = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  const uTexel = uniform(new Vector2(1, 1));     // full-res texel
  const uTexelQ = uniform(new Vector2(1, 1));    // quarter-res texel
  const uAspect = uniform(1);                    // H / W

  const downMat = new MeshBasicNodeMaterial();
  downMat.colorNode = Fn(() => {
    const o = uTexel.mul(1.0);
    const s = texture(sceneRT.texture, screenUV.add(vec2(o.x, o.y))).rgb
      .add(texture(sceneRT.texture, screenUV.add(vec2(o.x.negate(), o.y))).rgb)
      .add(texture(sceneRT.texture, screenUV.add(vec2(o.x, o.y.negate()))).rgb)
      .add(texture(sceneRT.texture, screenUV.sub(o)).rgb);
    return vec4(s.mul(0.25), 1);
  })();
  const blurMat = (src: RenderTarget, dir: [number, number]) => {
    const m = new MeshBasicNodeMaterial();
    const sigma = 5 * 0.44;
    const taps: [number, number][] = [];
    let sum = 0;
    for (let i = -6; i <= 6; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); taps.push([i, w]); sum += w; }
    m.colorNode = Fn(() => {
      let acc: any = vec3(0);
      for (const [i, w] of taps) {
        const off = uTexelQ.mul(vec2(dir[0] * i, dir[1] * i));
        acc = acc.add(texture(src.texture, screenUV.add(off)).rgb.mul(w / sum));
      }
      return vec4(acc, 1);
    })();
    return m;
  };
  const hBlur = blurMat(blurA, [1, 0]);
  const vBlur = blurMat(blurB, [0, 1]);
  const compMat = new MeshBasicNodeMaterial();
  compMat.colorNode = Fn(() => {
    const ca = uAspect.mul(0.002);
    const r = texture(sceneRT.texture, screenUV.add(vec2(ca, 0))).r;
    const g = texture(sceneRT.texture, screenUV).g;
    const b = texture(sceneRT.texture, screenUV.sub(vec2(ca, 0))).b;
    const col = vec3(r, g, b);
    const glow = texture(blurA.texture, screenUV).rgb;
    const lum = (c: any) => dot(c, vec3(0.2126, 0.7152, 0.0722));
    const edge = max(lum(glow).sub(lum(col)), 0);
    const teal = vec3(TEAL.r, TEAL.g, TEAL.b);
    const d = length(screenUV.sub(0.5)).div(Math.SQRT1_2);
    const vig = float(1).sub(smoothstep(0.6, 0.95, d).mul(0.8));
    const outc = col.add(teal.mul(edge.mul(1.6))).mul(vig).add(glow.mul(0.27));
    return vec4(outc, 1);
  })();
  const downQuad = new QuadMesh(downMat);
  const hQuad = new QuadMesh(hBlur);
  const vQuad = new QuadMesh(vBlur);
  const compQuad = new QuadMesh(compMat);

  // ------------------------------------------------------------------ assets
  let meta = meta0;
  let cpuDepth: Uint8ClampedArray | null = null;
  let atlasW = 0;
  const ready = (async () => {
    meta = await fetch(BASE + 'meta.json').then((r) => r.json());
    const [ci, di, qi] = await Promise.all(['color.webp', 'data.webp', 'quadtree.webp'].map((f) => loadImage(BASE + f)));
    colorTex.image = ci; colorTex.needsUpdate = true;
    dataTex.image = di; dataTex.needsUpdate = true;
    qtTex.image = qi; qtTex.needsUpdate = true;
    // CPU copy of the depth channel for the cursor ray-march
    const cv = document.createElement('canvas');
    cv.width = di.width; cv.height = di.height;
    const c2 = cv.getContext('2d', { willReadFrequently: true })!;
    c2.drawImage(di, 0, 0);
    const px = c2.getImageData(0, 0, di.width, di.height).data;
    cpuDepth = new Uint8ClampedArray(di.width * di.height);
    for (let i = 0; i < cpuDepth.length; i++) cpuDepth[i] = px[i * 4];
    atlasW = di.width;
  })();

  // ------------------------------------------------------------------ state
  let frameIdx = 0;
  let playT = 0;
  let revealStart = -1;
  let revealT = 0;
  let gridT = 0;
  let hit = false;
  let wasHit = false;
  let waveStart = -1;
  const cursor = new Vector2(999, 999);
  const prevCursor = new Vector2(999, 999);
  const vel = new Vector2();
  const tmpV = new Vector2();
  const inv = new Matrix4();
  const ro = new Vector3();
  const rp = new Vector3();
  const overrides = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

  function depthAt(gx: number, gy: number): number {
    if (!cpuDepth) return 0;
    const ix = Math.round(gx / CELL + half), iy = Math.round(half - gy / CELL);
    if (ix < 0 || iy < 0 || ix >= N || iy >= N) return 0;
    const ox = (frameIdx % meta.cols) * N, oy = Math.floor(frameIdx / meta.cols) * N;
    return cpuDepth[(oy + iy) * atlasW + ox + ix] / 255;
  }

  function locate(f: PortalFrame) {
    // ray through the pointer, in group-local (grid) units
    const cam = f.camera;
    ro.setFromMatrixPosition(cam.matrixWorld);
    rp.set(f.pointer.x, f.pointer.y, 0.5).applyMatrix4(cam.projectionMatrixInverse).applyMatrix4(cam.matrixWorld);
    inv.copy(group.matrixWorld).invert();
    ro.applyMatrix4(inv);
    rp.applyMatrix4(inv).sub(ro);
    if (Math.abs(rp.z) < 1e-6) return false;
    const zTop = relief(1), zBot = CUTOFF;
    for (let s = 0; s <= 32; s++) {
      const z = zTop - ((zTop - zBot) * s) / 32;
      const t = (z - ro.z) / rp.z;
      const x = ro.x + rp.x * t, y = ro.y + rp.y * t;
      let r = 0;
      for (const [ox, oy] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]]) {
        const d = depthAt(x + ox, y + oy);
        if (d >= Math.max(uThreshold.value, CUTOFF)) r = Math.max(r, relief(d));
      }
      if (r >= z && r > CUTOFF) { cursor.set(x, y); return true; }
      if (s === 32) cursor.set(x, y);
    }
    return false;
  }

  function update(f: PortalFrame) {
    const active = f.focus > 0.001 || f.openness > 0.001;
    // content placement: frame baseline FRAME_DIST in front of the camera when open, moves by -openness
    const z0 = CAM_OPEN - FRAME_DIST + 1 - CUTOFF * GROUP_SCALE;
    group.position.set(0, GROUP_Y, z0 - f.openness);
    group.rotation.y = f.parallax.x * 0.06 * f.focus;
    group.rotation.x = -f.parallax.y * 0.04 * f.focus;
    if (!active) return;
    const dt = Math.min(f.dt, 0.1);
    uTime.value = f.time;

    // playback: 30 fps ping-pong
    playT += dt;
    const F = meta.frames;
    const step = Math.floor(playT * meta.fps) % (2 * (F - 1));
    frameIdx = step < F ? step : 2 * (F - 1) - step;
    if (overrides.has('frame')) frameIdx = Math.min(F - 1, +overrides.get('frame')!);
    uFrameOff.value.set((frameIdx % meta.cols) * N, Math.floor(frameIdx / meta.cols) * N);
    const Q = meta.quadtree.size;
    uQtOff.value.set((frameIdx % meta.cols) * Q, Math.floor(frameIdx / meta.cols) * Q);

    // reveal: threshold 1 → .2 over 3 s inOutQuart, grid mix 0 → 1 over 1.5 s outQuad
    if (f.gateOpen && revealStart < 0) revealStart = f.time;
    if (revealStart >= 0) {
      revealT = clamp01((f.time - revealStart) / 3);
      gridT = clamp01((f.time - revealStart) / 1.5);
    }
    let th = 1 - 0.8 * inOutQuart(revealT);
    if (overrides.has('threshold')) th = +overrides.get('threshold')!;
    uThreshold.value = th;
    uReveal.value = (1 - th) / 0.8;
    uGridMix.value = overrides.has('grid') ? +overrides.get('grid')! : outQuad(gridT);

    // pointer
    group.updateMatrixWorld();
    const interactive = uReveal.value > 0.5 && f.pointer.inside && f.focus > 0.5;
    hit = interactive ? locate(f) : false;
    if (interactive) {
      if (prevCursor.x > 900) prevCursor.copy(cursor);
      tmpV.copy(cursor).sub(prevCursor).divideScalar(Math.max(dt, 1e-3));
      if (tmpV.length() > 200) tmpV.set(0, 0);
      prevCursor.copy(cursor);
      vel.lerp(tmpV, 1 - Math.exp(-60 * dt));
    } else {
      prevCursor.set(999, 999);
    }
    vel.multiplyScalar(Math.exp(-15 * dt));
    uVel.value.copy(vel);
    uCursor.value.copy(cursor);
    uHover.value += ((hit ? 1 : 0) - uHover.value) * (1 - Math.exp(-10 * dt));
    if (hit && !wasHit) { waveStart = f.time; uWave.value.copy(cursor); }
    wasHit = hit;
    uWaveP.value = waveStart < 0 ? 1 : outQuad(clamp01((f.time - waveStart) / 1.5));
  }

  function render(renderer: WebGPURenderer, camera: PerspectiveCamera, rt: RenderTarget) {
    const w = rt.width, h = rt.height;
    const s = ctx.quality === 'high' ? 1 : 0.75;
    const sw = Math.max(1, Math.round(w * s)), sh = Math.max(1, Math.round(h * s));
    if (sceneRT.width !== sw || sceneRT.height !== sh) sceneRT.setSize(sw, sh);
    const qw = Math.max(1, Math.round(w / 4)), qh = Math.max(1, Math.round(h / 4));
    if (blurA.width !== qw || blurA.height !== qh) { blurA.setSize(qw, qh); blurB.setSize(qw, qh); }
    uTexel.value.set(1 / sw, 1 / sh);
    uTexelQ.value.set(1 / qw, 1 / qh);
    uAspect.value = h / w;

    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(blurA); downQuad.render(renderer);
    renderer.setRenderTarget(blurB); hQuad.render(renderer);
    renderer.setRenderTarget(blurA); vQuad.render(renderer);
    renderer.setRenderTarget(rt);
    renderer.clear();
    compQuad.render(renderer);
  }

  return {
    scene,
    background,
    ready,
    update,
    render,
    dispose() {
      sceneRT.dispose(); blurA.dispose(); blurB.dispose();
      colorTex.dispose(); dataTex.dispose(); qtTex.dispose();
      gridGeo.dispose(); gridMat.dispose(); voxel.dispose();
      downMat.dispose(); hBlur.dispose(); vBlur.dispose(); compMat.dispose();
    },
  };
}
