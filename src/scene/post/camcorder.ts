import type { WebGPURenderer, Node, UniformNode } from 'three/webgpu';
import { HalfFloatType, Vector2 } from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, screenUV, rtt, hash, abs, max, clamp, floor, fract, sin, sqrt, pow,
  smoothstep, step, mix, dot, saturate,
} from 'three/tsl';
import { WIPES, SCENE_VP, damp, smoothstep as smoothstepCPU } from '../../lib/timeline';
import type { PostState } from './index';

// TSL nodes are dynamically typed (swizzles / operator chaining); keep the helpers loosely typed.
type N = any;

/**
 * Camcorder / VHS tape + CRT pass (spec-3d §4.2).
 *
 * Three stages, all inside the post graph (RTT nodes update before the final pass each frame):
 *   1. "narrow" tape RTT  (≈1.12·min(W, 1700/tw) × min(H, 1700)): per tape texel, 4-tap luma FIR
 *      (+1:.15, 0:.40, -1:.27, -2:.18, tap = tapePixel·(1+2·band)) → R, ghost luma at x-.018·tw → G.
 *   2. "wide" tape RTT    (1/4 of narrow width): 9-tap triangular RGB blur (±4·chromaSpacing) stored as YIQ.
 *   3. final full-res pass: tube bulge → scanline/jitter/tracking offsets → 3 texture fetches
 *      → unsharp + ghost, grain, chroma noise, dropouts, YIQ→RGB, black level, glow, hum, flicker, vignette.
 *
 * Tape space: x ∈ [-.06, 1.06] across the RTT width (the 12 % margin covers jitter / ghost / chroma delay),
 * y = screen y. A tape texel at (x, y) reads the scene at fishEye(zoom/handheld(x, y)), i.e. the fish-eye is
 * applied *before* tape sampling, exactly like the reference.
 */

// ---- params (`ae` in the spec) ----
const P = {
  tvWidth: 1.15, screenWidth: 0.98, screenHeight: 1,
  trackingNoise: 0.35, lineJitter: 0.44, chromaBlur: 0.16, chromaShift: 0.4, sharpen: 1.8,
  noise: 0.6, dropouts: 0.11, saturation: 2, blackLevel: 0.03,
  crt: 1, curvature: 1, portraitCurvature: 0.4, tapeResolution: 1700,
  glow: 0.6, vignette: 0.7, carouselVignette: 0, humBar: 0.12, loopSeconds: 12,
  transitionZoom: 1, handoverWidth: 3 /* w = 1 - smoothstep(0, width/2, |dist|) */, handoverGrain: 1, handoverChromaNoise: 1,
};
const LINES = P.tapeResolution;
const X0 = -0.06, XW = 1.12; // tape-space x range of the RTTs

export type CamcorderOptions = {
  renderer: WebGPURenderer;
  source: N; // linear scene colour already sampled through the fish-eye uv (unused: we resample along the tape)
  sourceTexture: Node & { sample: (uv: N) => Node };
  uvFish: Node;
  uFish?: UniformNode<number>;
  uOverscan?: UniformNode<number>;
};

export function createCamcorder(o: CamcorderOptions) {
  // ---------------------------------------------------------------- uniforms
  const uAspect = uniform(16 / 9); // drawing-buffer aspect (screenSize is the RTT size inside the tape passes)
  const uFish: N = o.uFish ?? uniform(0);
  const uOverscan: N = o.uOverscan ?? uniform(1);
  const uFrame = uniform(0);
  const uSourceScale = uniform(1 / 1.06);
  const uSourceOffset = uniform(new Vector2(0, 0));
  const uBulge = uniform(0.12);
  const uTapeWidth = uniform(0.7);
  const uBandCenter = uniform(0.5);
  const uTracking = uniform(P.trackingNoise);
  const uJitter = uniform(P.lineJitter * 0.0025);
  const uWobble = uniform(P.lineJitter * 0.0012);
  const uWobblePhase = uniform(0);
  const uChromaSpacing = uniform(0);
  const uChromaDelay = uniform(0);
  const uChromaGain = uniform(P.saturation);
  const uChromaNoise = uniform(P.noise * 0.12);
  const uGrain = uniform(P.noise * 0.12);
  const uDropRate = uniform(P.dropouts * 0.0012);
  const uTapePixel = uniform(0.7 / LINES);
  const uGlow = uniform(P.glow * 0.35);
  const uHum = uniform(P.humBar * P.crt);
  const uHumPhase = uniform(0);
  const uFlicker = uniform(1);
  const uVignette = uniform(P.vignette * P.crt * 0.85);

  // ---------------------------------------------------------------- helpers
  const fishEyeA = (uv: N) => {
    // same math as ./fisheye.ts, but with the screen aspect as a uniform (valid inside RTT passes)
    const p: N = uv.sub(0.5).mul(2).mul(vec2(uAspect, 1));
    const d = (vec2 as N)(
      float(1).sub(p.y.mul(p.y)).mul(uFish).mul(p.x).mul(1.2),
      float(1).sub(p.x.mul(p.x)).mul(uFish).mul(p.y).mul(1.2),
    );
    return p.sub(d).div(vec2(uAspect, uOverscan)).mul(0.5).add(0.5);
  };
  /** tape (x, y) → scene colour, gamma 1/2.2 (zoom 1.06 + handheld wobble + fish-eye) */
  const tapeSrc = (x: N, y: N) => {
    const uv = vec2(x, y).sub(0.5).mul(uSourceScale).add(0.5).add(uSourceOffset);
    const c = (o.sourceTexture as N).sample(fishEyeA(uv)).rgb;
    return pow(max(c, vec3(0)), vec3(1 / 2.2));
  };
  const luma = (c: N) => dot(c, vec3(0.299, 0.587, 0.114));
  const toYIQ = (c: N) => vec3(
    luma(c),
    dot(c, vec3(0.596, -0.274, -0.322)),
    dot(c, vec3(0.211, -0.523, 0.312)),
  );
  const bandAt = (y: N) => float(1).sub(smoothstep(0, 0.07, abs(y.sub(uBandCenter)))).mul(uTracking);
  const lineOf = (y: N) => floor(clamp(y, 0, 0.9999).mul(LINES));

  // ---------------------------------------------------------------- stage 1: narrow luma tape
  const narrowNode = Fn(() => {
    const x = screenUV.x.mul(XW).add(X0);
    const y = screenUV.y;
    const lineY = lineOf(y).add(0.5).div(LINES);
    const tap = uTapePixel.mul(bandAt(lineY).mul(2).add(1));
    const l = luma(tapeSrc(x.add(tap), lineY)).mul(0.15)
      .add(luma(tapeSrc(x, lineY)).mul(0.4))
      .add(luma(tapeSrc(x.sub(tap), lineY)).mul(0.27))
      .add(luma(tapeSrc(x.sub(tap.mul(2)), lineY)).mul(0.18));
    const ghost = luma(tapeSrc(x.sub(uTapeWidth.mul(0.018)), lineY));
    return vec4(l, ghost, 0, 1);
  })();
  // ---------------------------------------------------------------- stage 2: wide chroma tape (YIQ)
  const wideNode = Fn(() => {
    const x = screenUV.x.mul(XW).add(X0);
    const y = screenUV.y;
    let acc: N = vec3(0);
    for (let k = -4; k <= 4; k++) {
      const w = (5 - Math.abs(k)) / 25;
      acc = acc.add(tapeSrc(x.add(uChromaSpacing.mul(k)), y).mul(w));
    }
    return vec4(toYIQ(acc), 1);
  })();

  const rtOpts = { type: HalfFloatType, depthBuffer: false };
  const narrow = rtt(narrowNode, 16, 16, rtOpts);
  const wide = rtt(wideNode, 4, 16, rtOpts);
  narrow.name = 'tapeNarrow';
  wide.name = 'tapeWide';

  // ---------------------------------------------------------------- stage 3: final
  const output = (() => {
    const uv = screenUV;
    // glass / tube curvature (barrel, corners fixed)
    const screen = vec2(P.screenWidth, P.screenHeight);
    const p = uv.sub(0.5).mul(2);
    const t = p.div(screen);
    const n = dot(t, t).mul(uBulge);
    const inv = vec2(1 / P.screenWidth, 1 / P.screenHeight);
    const n0 = dot(inv, inv).mul(uBulge);
    const tube = p.mul(n.add(1)).div(n0.add(1)).mul(0.5).add(0.5);
    const half = screen.mul(0.5);
    const ed = abs(t.mul(half)).sub(half);
    const edgeDist = max(ed.x, ed.y);

    // scanline structure
    const y = clamp(tube.y, 0, 0.9999);
    const line = floor(y.mul(LINES));
    const lineY = line.add(0.5).div(LINES);
    const fseed = uFrame.mul(1013);
    const r1 = hash(line.add(fseed).add(17));
    const r2 = hash(line.add(fseed).add(50021));
    const band = bandAt(y);
    const xOff = r1.sub(0.5).mul(uJitter)
      .add(sin(y.mul(9).add(uWobblePhase)).mul(uWobble))
      .add(r2.sub(0.5).mul(0.08).add(0.015).mul(band))
      .mul(uTapeWidth);
    const x = tube.x.add(xOff);
    const tu = (xx: N) => vec2(xx.sub(X0).div(XW), lineY);

    // the wide (chroma) record lags the luma by uChromaDelay; its Y is also the unsharp-mask reference, so the
    // undershoot halo lands on the trailing (right) side of bright strokes, like the reference.
    narrow.uvNode = tu(x);
    wide.uvNode = tu(x.sub(uChromaDelay));
    const nar = narrow;
    const wd = wide;
    const wdDelayed = wd;

    const nL = nar.r;
    const ghost = nar.g;
    const lumaWide = wd.r;
    const sharpLuma = nL.add(nL.sub(lumaWide).mul(P.sharpen)).add(ghost.sub(nL).mul(0.08));
    const signal = mix(sharpLuma, lumaWide, saturate(band.mul(0.3)));

    // tape noise
    const lineSeed = line;
    const xs = x.div(uTapeWidth);
    const grain = hash(floor(xs.mul(320)).add(400).add(lineSeed.mul(733)).add(uFrame.mul(7919))).sub(0.5).mul(uGrain);
    const cSeed = floor(xs.mul(28)).add(40).add(floor(lineSeed.div(2)).mul(61)).add(uFrame.mul(3001));
    const chromaN = vec2(hash(cSeed), hash(cSeed.add(1847))).sub(0.5).mul(uChromaNoise);
    const f = xs.mul(40).add(r1.mul(7));
    const dSeed = floor(f).add(500).add(lineSeed.mul(97)).add(uFrame.mul(9001));
    const drop = step(float(1).sub(uDropRate.add(band.mul(0.05))), hash(dSeed)).mul(sqrt(float(1).sub(fract(f))));
    const L0 = signal.add(grain).add(drop.mul(0.7));
    const L = mix(L0, hash(dSeed.add(123)).mul(0.9), band.mul(r2).mul(0.55));
    const chroma = wdDelayed.gb.mul(uChromaGain).mul(float(1).sub(band.mul(0.6))).add(chromaN);

    // YIQ → RGB + black level
    const I = chroma.x, Q = chroma.y;
    let rgb: N = vec3(
      L.add(I.mul(0.956)).add(Q.mul(0.621)),
      L.sub(I.mul(0.272)).sub(Q.mul(0.647)),
      L.sub(I.mul(1.106)).add(Q.mul(1.703)),
    ).add(P.blackLevel);

    // CRT light
    const glowAdd = vec3(0.8, 1, 0.95).mul(lumaWide.mul(lumaWide).mul(uGlow));
    const hum = float(1).sub(uHum.mul(sin(tube.y.mul(Math.PI * 2).sub(uHumPhase)).mul(0.5).add(0.5)));
    const e = smoothstep(-0.45, 0, edgeDist);
    const vig = float(1).sub(uVignette.mul(e).mul(sqrt(e)));
    rgb = rgb.mul(hum).mul(uFlicker).mul(vig).add(glowAdd.mul(vig));
    return vec4(pow(max(rgb, vec3(0)), vec3(2.2)), 1);
  })();

  // ---------------------------------------------------------------- CPU side
  const hash1 = (n: number) => {
    // CPU PCG matching three's TSL hash
    let s = (Math.floor(n) >>> 0) * 747796405 + 2891336453;
    s = s >>> 0;
    let w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
    w = ((w >>> 22) ^ w) >>> 0;
    return w / 2 ** 32;
  };
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const st = { phase: 0, handheld: 1, vigK: 0, portraitW: 1, zoomOut: 0, phaseOverride: null as number | null, aspect: 16 / 9 };

  function update(dt: number, _time: number, s: PostState) {
    if (!reduced) st.phase = (st.phase + dt / P.loopSeconds) % 1;
    const phase = st.phaseOverride ?? st.phase;
    const frame = Math.floor(phase * P.loopSeconds * 30);
    uFrame.value = frame;

    const zoom = 1.06 + (P.transitionZoom - 1.06) * st.zoomOut;
    uSourceScale.value = 1 / zoom;
    st.handheld += ((s.inside ? 0 : 1) - st.handheld) * damp(4, dt);
    const a = (frame / 360) * Math.PI * 2;
    const h = st.handheld;
    uSourceOffset.value.set(
      h * (0.003 * Math.sin(2 * a + 0.5) + 0.002 * Math.sin(3 * a)),
      h * (0.002 * Math.sin(5 * a + 2) + 0.0015 * Math.sin(7 * a + 1) + 0.00075 * Math.sin(13 * a)),
    );

    // intro (portrait) weight mirrors app.ts tile-0 openness target
    const introW = 1 - smoothstepCPU(0, 0.85, s.idx);
    st.portraitW = introW;
    const curv = P.curvature + (P.portraitCurvature - P.curvature) * st.portraitW;
    uBulge.value = s.isHome ? (s.isPhone ? 0.1 : curv) * P.crt * 0.12 : 0;

    uBandCenter.value = Math.sin(2 * Math.PI * phase + 0.6) * 0.55 + 0.5 + (hash1(frame + 911) - 0.5) * 0.02;
    uWobblePhase.value = 2 * Math.PI * phase * 4;
    uHumPhase.value = 2 * Math.PI * phase * 3;
    uFlicker.value = 1 + (hash1(frame + 4242) - 0.5) * 0.04 * P.crt;

    // vignette: full on intro / last / inside a project, eased to carouselVignette in the carousel
    const vigTarget = Math.max(introW, s.lastOpen, s.inside ? 1 : 0);
    st.vigK += (vigTarget - st.vigK) * damp(4, dt);
    const vFull = P.vignette * P.crt * 0.85;
    const vCar = P.carouselVignette * P.crt * 0.85;
    uVignette.value = vCar + (vFull - vCar) * st.vigK;

    // handover grain boost near the corridor→city wipe (dist measured in scrolled viewports)
    const wipeMid = WIPES[0].start + WIPES[0].length * 0.5;
    const dist = (s.sceneT - wipeMid) * SCENE_VP;
    const w = s.lastOpen > 0.5 ? 1 - smoothstepCPU(0, P.handoverWidth / 2, Math.abs(dist)) : 0;
    uGrain.value = P.noise * 0.12 * (1 + P.handoverGrain * w);
    uChromaNoise.value = P.noise * 0.12 * (1 + P.handoverChromaNoise * w);
  }

  function setSize(w: number, h: number) {
    const aspect = w / h;
    st.aspect = aspect;
    uAspect.value = aspect;
    const tw = P.tvWidth / (aspect * (P.screenWidth / P.screenHeight));
    uTapeWidth.value = tw;
    uTapePixel.value = tw / LINES;
    uChromaSpacing.value = P.chromaBlur * 0.006 * tw;
    uChromaDelay.value = P.chromaShift * 0.008 * tw;
    uJitter.value = P.lineJitter * 0.0025;
    uWobble.value = P.lineJitter * 0.0012;
    const nw = Math.max(16, Math.round(XW * Math.min(w, LINES / tw)));
    const nh = Math.max(16, Math.min(h, LINES));
    narrow.setSize(nw, nh);
    wide.setSize(Math.max(4, Math.round(nw / 4)), nh);
  }

  // ---------------------------------------------------------------- CPU geometry mirror
  const bypass = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nocam');
  // uv convention here = fishEyeCPU's (0..1, y up). "source uv" = the uv fed into the fish-eye
  // (i.e. before fishEyeCPU). Ignores the per-line jitter (sub-pixel).
  const tubeCPU = (u: number, vDown: number): [number, number] => {
    const b = uBulge.value, sw = P.screenWidth, sh = P.screenHeight;
    const px = (u - 0.5) * 2, py = (vDown - 0.5) * 2;
    const tx = px / sw, ty = py / sh;
    const n = (tx * tx + ty * ty) * b;
    const n0 = (1 / (sw * sw) + 1 / (sh * sh)) * b;
    const k = (n + 1) / (n0 + 1);
    return [px * k * 0.5 + 0.5, py * k * 0.5 + 0.5];
  };
  /** screen uv → source uv (apply before fishEyeCPU when picking) */
  function toSource(u: number, v: number): [number, number] {
    if (bypass) return [u, v];
    const [tx, ty] = tubeCPU(u, 1 - v);
    const sc = uSourceScale.value, off = uSourceOffset.value;
    const sx = (tx - 0.5) * sc + 0.5 + off.x;
    const sy = (ty - 0.5) * sc + 0.5 + off.y; // y-down
    return [sx, 1 - sy];
  }
  /** source uv → screen uv (apply after fishEyeInverseCPU when placing labels); 8 fixed-point iterations */
  function fromSource(u: number, v: number): [number, number] {
    if (bypass) return [u, v];
    let x = u, y = v;
    for (let i = 0; i < 8; i++) {
      const [fx, fy] = toSource(x, y);
      x += u - fx;
      y += v - fy;
    }
    return [x, y];
  }

  // debug layer toggle (spec §4 "camcorder" layer): ?nocam bypasses the tape/CRT pass
  return {
    output: bypass ? vec4(o.source.rgb, 1) : output,
    update,
    setSize,
    /** test hooks */
    toSource,
    fromSource,
    debug: st,
  };
}
