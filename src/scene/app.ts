/**
 * Journey app: the site is one scroll-driven chain of fullscreen stages (JOURNEY.md, src/lib/timeline.ts).
 * Per frame: update the (at most two) stages around the scroll position → compositor renders them into its
 * two targets and blends them with the active transition inside the post chain's scene pass → fish-eye →
 * camcorder/VHS.
 *
 * Loading: createApp resolves (→ preloader gate) once the intro and corridor are loaded and compiled; the other
 * stages stream in afterwards (journey/stages.ts buildJourney).
 * Resolution: adaptive pixel ratio (spec §9) — 1 s frame-time windows, −.25 below ~45 fps, +.25 above 58 fps,
 * capped per tier/device.
 * Debug: `?debug` shows a perf overlay with a copyable per-stage report; `?gputime` enables WebGPU timestamp queries; `__scene.gpuMs` holds the last GPU frame times.
 */
import { WebGPURenderer, Vector2, RenderPipeline, PerspectiveCamera } from 'three/webgpu';
import { pass, uniform } from 'three/tsl';
import { $route, $preloader, scroll, tilt, pointer as sharedPointer } from '../lib/stores';
import { STAGES, TRANSITIONS, SCENE_VP, WIPES, journeyAt, stageLocal, clamp, damp, smoothstep } from '../lib/timeline';
import { fishEye, fishEyeCPU, overscanScale } from './post/fisheye';
import { createPostChain } from './post';
import { createCompositor } from './journey/compositor';
import { buildJourney } from './journey/stages';
import type { Stage, StageContext, StageFrame } from './journey/types';
import { createHud } from './debug-hud';

type Hooks = {
  onProgress: (p: number) => void;
};

/** GPU name from a throwaway WebGL context ('' when the browser hides it) */
function probeGpu(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}
/** entry-level mobile GPUs (e.g. Galaxy M31s: Mali-G72 MP3): fill-rate bound, slow WebGPU drivers */
/** flagship GPUs always get the high tier, whatever memory the browser reports (Chrome rounds 6 GB down to 4) */
const HIGH_END_GPU = /Apple (GPU|M\d)|Adreno[^\d]*\b(7\d\d|8\d\d)\b|Mali-G(71[05]|72[05]|9\d\d)|Immortalis|Xclipse|NVIDIA|GeForce|Radeon/i;
const LOW_END_GPU = /Mali-(T\d+|G(31|51|52|57|71|72|76)\b)|Adreno[^\d]*(\b[2-5]\d\d\b|\b6[01]\d\b)|PowerVR|IMG BXM|Mali-400/i;

export async function createApp(container: HTMLElement, hooks: Hooks) {
  const params = new URLSearchParams(location.search);
  const isPhoneDevice = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  const gpuName = probeGpu();
  const forcedQ = params.get('quality');
  const lowEnd =
    forcedQ === 'low' ||
    (!forcedQ && isPhoneDevice && (LOW_END_GPU.test(gpuName) || ((navigator as any).deviceMemory ?? 8) <= 3));
  // entry-level phone GPUs run three's WebGL2 backend noticeably faster than their WebGPU drivers
  const forceWebGL = params.has('webgl') || lowEnd;
  const gpuTime = params.has('gputime');
  const renderer = new WebGPURenderer({ antialias: false, forceWebGL, trackTimestamp: gpuTime } as any);
  await renderer.init();
  container.appendChild(renderer.domElement);
  const isPhoneNow = () => scroll.isPhone || matchMedia('(max-width: 47.99rem), (max-aspect-ratio: 4/3)').matches;
  // hybrid: a tier from the GPU (low / medium / high) picks resolution caps and scene detail; the adaptive pixel
  // ratio below then only steps down if frames actually drop, and climbs back when they recover
  const quality: 'high' | 'medium' | 'low' = lowEnd
    ? 'low'
    : forcedQ === 'high' || forcedQ === 'medium'
      ? forcedQ
      : HIGH_END_GPU.test(gpuName)
        ? 'high'
        : (navigator as any).deviceMemory <= 4 || (renderer.backend as any).isWebGLBackend ? 'medium' : 'high';
  const ctx: StageContext = { renderer, isPhone: isPhoneNow(), quality };
  // created early so it also counts the shader programs compiled before the preloader gate opens
  const hud = params.has('debug')
    ? createHud(
        {
          gpu: gpuName || '(hidden)', backend: (renderer.backend as any).isWebGLBackend ? 'WebGL2' : 'WebGPU', tier: quality,
          parallelCompile: (renderer.backend as any).isWebGLBackend ? !!(renderer.backend as any).parallel : 'n/a (WebGPU is async)',
          lowEnd, phone: isPhoneDevice, devicePixelRatio, screen: `${screen.width}x${screen.height}`,
          deviceMemory: (navigator as any).deviceMemory ?? '?', cores: navigator.hardwareConcurrency ?? '?', ua: navigator.userAgent,
        },
        () => ({ dpr: dpr.applied.toFixed(2), buffer: `${size.x}x${size.y}`, minRatio: dpr.minRatio }),
        (renderer.backend as any).isWebGLBackend ? (renderer.backend as any).gl : null,
      )
    : null;

  // ------------------------------------------------------------- compositor + post
  const comp = createCompositor(renderer);
  const uFish = uniform(0.1);
  const uOverscan = uniform(1);
  const scenePass = pass(comp.scene, comp.camera);
  const post = createPostChain({ renderer, scenePass, uFish, uOverscan, fishEye });
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = post.output;
  const size = new Vector2();

  // ------------------------------------------------------------- input
  const ndc = { x: 0, y: 0, inside: false, down: false };
  let pressX = 0, pressY = 0, moved = false;
  const canvas = renderer.domElement;
  let stages: Stage[] = [];
  const toNdc = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const u0 = (e.clientX - r.left) / r.width;
    const v0 = 1 - (e.clientY - r.top) / r.height;
    const [u, v] = post.toSource(u0, v0);
    const [pu, pv] = fishEyeCPU(u, v, uFish.value, size.x / size.y, uOverscan.value);
    ndc.x = pu * 2 - 1;
    ndc.y = pv * 2 - 1;
    ndc.inside = true;
    sharedPointer.x = u0 * 2 - 1;
    sharedPointer.y = v0 * 2 - 1;
    sharedPointer.inside = true;
  };
  const stageEl = container.closest('[data-stage]') as HTMLElement;
  stageEl.addEventListener('pointermove', (e) => {
    toNdc(e);
    if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > 6) moved = true;
  });
  stageEl.addEventListener('pointerleave', () => { ndc.inside = false; sharedPointer.inside = false; });
  stageEl.addEventListener('pointerdown', (e) => { toNdc(e); ndc.down = true; pressX = e.clientX; pressY = e.clientY; moved = false; });
  stageEl.addEventListener('pointerup', (e) => {
    ndc.down = false;
    if (moved || (e.target as Element).closest('a, button')) return;
    toNdc(e);
    stages[journeyAt(scroll.vp).current]?.onClick?.(ndc.x, ndc.y);
  });

  // ------------------------------------------------------------- resolution
  // tier caps: desktop 1.6 / phone 2 on high; medium (WebGL2 fallback, ≤ 4 GB) 1 / 1.25; low (entry-level
  // phone GPU) 1, down to .5. Phones start a step below their cap and climb only if frames stay smooth.
  const dprCap = () => {
    const dev = Math.min(devicePixelRatio, 2);
    const cap = quality === 'low' ? 1 : ctx.isPhone ? (quality === 'high' ? 2 : 1.25) : quality === 'high' ? 1.6 : 1;
    return Math.min(dev, cap);
  };
  const DPR_STEP = 0.25;
  const dpr = { reduction: 0, applied: 0, minRatio: quality === 'low' ? 0.5 : 0.75 };
  // medium phones start a step below their cap and climb if smooth; high-tier devices start at full quality
  if (ctx.isPhone && quality === 'medium') dpr.reduction = DPR_STEP;
  const floorRatio = () => Math.min(dpr.minRatio, dprCap());
  const targetRatio = () => Math.max(dprCap() - dpr.reduction, floorRatio());
  function applySize() {
    const w = container.clientWidth, h = container.clientHeight;
    dpr.applied = targetRatio();
    renderer.setPixelRatio(dpr.applied);
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(size);
    comp.setSize(size.x, size.y);
    post.setSize(size.x, size.y);
  }
  function resize() {
    ctx.isPhone = isPhoneNow();
    applySize(); // keeps the adaptive reduction
    skipWindow();
  }

  /**
   * Adaptive pixel ratio: mean frame time over 1 s windows → −.25 below 45 fps, +.25 above 58 fps.
   * Windows containing a long frame (tab switch), a stage swap/compile or a resize are dropped; a 30 Hz-capped
   * display (steady ~33 ms) is not treated as slow; after a step down, going back up to that ratio waits 8 s
   * so it can't oscillate between two levels.
   */
  const ctl = { t: 0, n: 0, sum: 0, sq: 0, skip: true, blockUpUntil: 0, blockedRatio: Infinity };
  let loading = () => true; // set once the journey exists: background loads/compiles make frames unrepresentative
  function skipWindow() { ctl.skip = true; }
  function adapt(dt: number, now: number) {
    // while stages stream in, frames are noisy; still react to a clearly struggling GPU (< 30 fps)
    if (document.hidden || dt > 0.1) skipWindow();
    ctl.t += dt; ctl.n++; ctl.sum += dt; ctl.sq += dt * dt;
    if (ctl.t < 1) return;
    const mean = ctl.sum / ctl.n;
    const sd = Math.sqrt(Math.max(0, ctl.sq / ctl.n - mean * mean));
    const skip = ctl.skip;
    ctl.t = ctl.n = ctl.sum = ctl.sq = 0;
    ctl.skip = false;
    if (skip) return;
    const fps = 1 / mean;
    const capped30 = fps > 26 && fps < 34 && sd < 0.004;
    if (loading() && fps >= 30) return;
    // safety net when the GPU name is hidden: still < 30 fps at the floor → allow going down to .5
    if (fps < 30 && !capped30 && dpr.applied <= floorRatio() + 1e-3 && dpr.minRatio > 0.5) dpr.minRatio = 0.5;
    if (fps < 45 && !capped30 && dpr.applied > floorRatio() + 1e-3) {
      ctl.blockedRatio = dpr.applied;
      ctl.blockUpUntil = now + 8;
      // badly struggling: drop two steps at once
      dpr.reduction = Math.min(dpr.reduction + (fps < 30 ? 2 : 1) * DPR_STEP, dprCap() - floorRatio());
    } else if (fps > 58 && dpr.reduction > 0 && !loading()) {
      const next = Math.max(dprCap() - (dpr.reduction - DPR_STEP), floorRatio());
      if (next >= ctl.blockedRatio - 1e-3 && now < ctl.blockUpUntil) return;
      dpr.reduction = Math.max(0, dpr.reduction - DPR_STEP);
    } else return;
    if (Math.abs(targetRatio() - dpr.applied) > 1e-3) {
      applySize();
      skipWindow();
    }
  }
  resize();

  // ------------------------------------------------------------- stages
  const journey = buildJourney(ctx, hooks.onProgress);
  stages = journey.stages;
  journey.onActivity = skipWindow;
  loading = () => !$preloader.get().isGateOpen || journey.busy();
  await journey.critical;

  const fitCamera = (s: Stage) => {
    const cam = s.camera as PerspectiveCamera;
    cam.aspect = size.x / size.y;
    cam.updateProjectionMatrix();
    return cam;
  };
  // warm-up: compile the gate stages (intro, corridor) + the compositor/post so the first frames don't hitch
  try {
    for (const s of stages.slice(0, 2)) await renderer.compileAsync(s.scene, fitCamera(s));
    await renderer.compileAsync(comp.scene, comp.camera);
  } catch (e) {
    console.warn('compile warmup', e);
  }
  // everything else streams in after the gate opens (a beat later, so it never competes with the gate itself);
  // each stage is compiled before it is swapped in
  const startBackground = () =>
    setTimeout(() => journey.startBackground((s) => renderer.compileAsync(s.scene, fitCamera(s))), 400);
  if ($preloader.get().isGateOpen) startBackground();
  else {
    const off = $preloader.subscribe((p) => {
      if (!p.isGateOpen) return;
      queueMicrotask(() => off());
      startBackground();
    });
  }

  // ------------------------------------------------------------- frame
  const parallax = { x: 0, y: 0 };
  const frames: StageFrame[] = stages.map(() => ({
    dt: 0, time: 0, t: 0, enter: 0, exit: 0, vp: 0, pointer: ndc, parallax, aspect: 1, isPhone: false, quality,
    slide: 0, gateOpen: false,
  }));

  function stageFrame(i: number, dt: number, time: number, vp: number): StageFrame {
    const f = frames[i];
    const l = stageLocal(i, vp);
    const route = $route.get();
    f.dt = dt; f.time = time; f.vp = vp;
    f.t = l.t; f.enter = l.enter; f.exit = l.exit;
    f.aspect = size.x / size.y;
    f.isPhone = ctx.isPhone;
    f.gateOpen = $preloader.get().isGateOpen;
    const proj = STAGES[i].project;
    f.slide = proj !== undefined && route.route === `project-${proj}` ? route.slide : 0;
    return f;
  }

  const gpuMs: number[] = [];
  function frame(dt: number, time: number) {
    const t0 = hud ? performance.now() : 0;
    ctx.isPhone = scroll.isPhone || isPhoneNow();
    adapt(dt, time);
    const vp = scroll.vp;
    const js = journeyAt(vp);

    // parallax input (pointer on desktop, tilt on touch), damped
    const k = damp(5, dt);
    const inX = tilt.active ? tilt.x : sharedPointer.x;
    const inY = tilt.active ? tilt.y : sharedPointer.y;
    parallax.x += (inX - parallax.x) * k;
    parallax.y += (inY - parallax.y) * k;

    // fish-eye: .1 desktop / .2 phone on the face, eased out as we dive into the corridor
    const introW = 1 - stageLocal(0, vp).exit;
    const fishTarget = (ctx.isPhone ? 0.2 : 0.1) * smoothstep(0, 1, introW);
    uFish.value += (fishTarget - uFish.value) * damp(2.5, dt);
    uOverscan.value = overscanScale(size.x / size.y, uFish.value);

    // update + render the active stage(s): never more than two
    const a = js.trans ? js.from : js.current;
    const b = js.trans ? js.from + 1 : -1;
    journey.tick(a, b);
    stages[a].update(stageFrame(a, dt, time, vp));
    if (b >= 0) stages[b].update(stageFrame(b, dt, time, vp));
    comp.render(stages[a], b >= 0 ? stages[b] : null, js.trans?.kind ?? 'cut', js.p, time, uOverscan.value);

    // camcorder: intro weight, full vignette, and the handover grain burst around every transition centre
    let near = Infinity;
    for (const tr of TRANSITIONS) if (Math.abs(vp - tr.at) < Math.abs(near)) near = vp - tr.at;
    const wipeMid = WIPES[0].start + WIPES[0].length * 0.5;
    post.update(dt, time, {
      isHome: true, isPhone: ctx.isPhone, inside: false, idx: clamp(1 - introW) * 0.85,
      sceneT: wipeMid + clamp(near, -5, 5) / SCENE_VP, lastOpen: 1,
    });
    pipeline.render();
    hud?.sample(dt, performance.now() - t0, b >= 0 ? `${STAGES[a].id}>${STAGES[b].id}` : STAGES[a].id, dpr.applied, time);
    if (gpuTime) {
      renderer.resolveTimestampsAsync('render').then((ms) => {
        if (typeof ms === 'number' && ms > 0) { gpuMs.push(ms); if (gpuMs.length > 240) gpuMs.shift(); }
      });
    }
  }

  (window as any).__scene = { renderer, stages, comp, uFish, post, journey, dpr, gpuMs, frame, hud };
  return { frame, resize };
}
