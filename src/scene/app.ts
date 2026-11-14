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
import { WebGPURenderer, TextureLoader, type Texture, Vector2, RenderPipeline, PerspectiveCamera, type Object3D, type Camera, type Mesh, type Material, type RenderTarget, RenderTarget as RenderTargetClass, HalfFloatType } from 'three/webgpu';
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
        renderer.backend,
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
   * Adaptive pixel ratio: MEDIAN frame time over 1 s windows → −.25 below 45 fps, +.25 above 55 fps.
   * The median measures how fast the GPU draws a typical frame; one-off stalls (a shader link, an image upload)
   * would drag a mean down and cut resolution for nothing, then block it from coming back. Windows containing
   * a tab switch, a stage swap/compile or a resize are dropped; a 30 Hz-capped display (steady ~33 ms) is not
   * treated as slow; after a step down, going back up to that ratio waits 8 s so it can't oscillate.
   */
  const ctl = { t: 0, dts: [] as number[], skip: true, blockUpUntil: 0, blockedRatio: Infinity };
  let loading = () => true; // set once the journey exists: background loads/compiles make frames unrepresentative
  function skipWindow() { ctl.skip = true; }
  function adapt(dt: number, now: number) {
    // while stages stream in, frames are noisy; still react to a clearly struggling GPU (< 30 fps)
    if (document.hidden || dt > 0.1) skipWindow();
    ctl.t += dt; ctl.dts.push(dt);
    if (ctl.t < 1) return;
    const d = ctl.dts.sort((a, b) => a - b);
    const q = (p: number) => d[Math.min(d.length - 1, Math.floor(p * d.length))];
    const med = q(0.5), spread = q(0.75) - q(0.25);
    const skip = ctl.skip;
    ctl.t = 0; ctl.dts = [];
    ctl.skip = false;
    if (skip) return;
    const fps = 1 / med;
    const capped30 = fps > 26 && fps < 34 && spread < 0.004;
    if (loading() && fps >= 30) return;
    // safety net when the GPU name is hidden: still < 30 fps at the floor → allow going down to .5
    if (fps < 30 && !capped30 && dpr.applied <= floorRatio() + 1e-3 && dpr.minRatio > 0.5) dpr.minRatio = 0.5;
    if (fps < 45 && !capped30 && dpr.applied > floorRatio() + 1e-3) {
      ctl.blockedRatio = dpr.applied;
      ctl.blockUpUntil = now + 8;
      // badly struggling: drop two steps at once
      dpr.reduction = Math.min(dpr.reduction + (fps < 30 ? 2 : 1) * DPR_STEP, dprCap() - floorRatio());
    } else if (fps > 55 && dpr.reduction > 0 && !loading()) {
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
  // every image texture the worlds load; the ones a stage doesn't show right away (later slides) would otherwise
  // upload the first time they appear, mid-scroll. They are uploaded in the background with their stage.
  const loadedTextures = new Set<Texture>();
  const tlLoad = TextureLoader.prototype.load;
  TextureLoader.prototype.load = function (this: TextureLoader, ...a: Parameters<TextureLoader['load']>) {
    const t = tlLoad.apply(this, a);
    loadedTextures.add(t);
    return t;
  };
  async function uploadPending() {
    for (const t of loadedTextures) {
      const im = t.image as { width?: number } | null;
      if (!im?.width) continue; // still loading: picked up with a later stage
      loadedTextures.delete(t);
      renderer.initTexture(t);
      // one upload per frame: a large image can take tens of ms on the GPU side
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
  }
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
  /**
   * compileAsync only builds pipelines for what would be drawn right now: hidden objects, hidden materials and
   * anything outside the camera are skipped, and then compile synchronously the first time they appear, which
   * freezes the page mid-scroll (Safari / WebGL2 most of all). Warm everything: unhide and un-cull the whole
   * scene for the compile, then restore. Stages being compiled are not on screen yet, so nothing flashes.
   */
  // 1×1 stand-in with the stage targets' format, for the warm-up draw below
  const warmRT = new RenderTargetClass(1, 1, { type: HalfFloatType, depthBuffer: true });
  /**
   * Runs fn (a draw) with every pipeline it needs created asynchronously (parallel shader compile on WebGL2,
   * createRenderPipelineAsync on WebGPU) instead of linked on the spot; draws whose pipeline isn't ready yet are
   * skipped. Resolves once those pipelines are done.
   */
  const pipelines = (renderer as any)._pipelines;
  function asyncPipelines(fn: () => void): Promise<unknown> {
    const pending: Promise<unknown>[] = [];
    const syncUpdate = pipelines.updateForRender;
    pipelines.updateForRender = (ro: unknown) => pipelines.getForRender(ro, pending);
    try { fn(); } finally { pipelines.updateForRender = syncUpdate; }
    return Promise.all(pending);
  }
  async function warm(scene: Object3D, camera: Camera, target: RenderTarget | null = comp.stageTarget, draw?: () => void) {
    const objs: [Object3D, boolean, boolean][] = [];
    const mats: Material[] = [];
    scene.traverse((o) => {
      objs.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
      const m = (o as Mesh).material;
      for (const mm of Array.isArray(m) ? m : m ? [m] : []) if (!mm.visible) { mm.visible = true; mats.push(mm); }
    });
    try {
      // shaders differ per destination (a stage target is linear half-float, the canvas gets the output
      // transform), so compile against the target the stage really draws into. compileAsync reads the current
      // target synchronously, so it is set only around the call, never across a frame
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      const done = renderer.compileAsync(scene, camera);
      renderer.setRenderTarget(prev);
      await done;
      // Safari (WebGL over ANGLE/Metal) creates the final GPU pipeline state only at the first draw, so a compiled
      // stage still hitches the first time it's drawn: draw it once now into a 1×1 target, everything unhidden
      if (draw) {
        // (pipelines the draw still needs, e.g. passes drawn into a stage's own targets, compile asynchronously;
        // then it draws once more for the GPU state)
        for (let k = 0; k < 2; k++) {
          const p2 = renderer.getRenderTarget();
          renderer.setRenderTarget(warmRT);
          let done: Promise<unknown> = Promise.resolve();
          try { done = asyncPipelines(draw); } finally { renderer.setRenderTarget(p2); }
          await done;
        }
      }
    } finally {
      for (const [o, v, f] of objs) { o.visible = v; o.frustumCulled = f; }
      for (const mm of mats) mm.visible = false;
    }
  }

  // warm-up: compile the gate stages (intro, corridor) + the compositor/post so the first frames don't hitch
  try {
    for (const s of stages.slice(0, 2)) await warm(s.scene, fitCamera(s));
    await warm(comp.scene, comp.camera, null);
  } catch (e) {
    console.warn('compile warmup', e);
  }
  // everything else streams in after the gate opens (a beat later, so it never competes with the gate itself);
  // each stage is compiled before it is swapped in
  // Streaming the other stages in costs a phone dearly: without KHR_parallel_shader_compile (e.g. Mali) every
  // shader link blocks the page for 40–90 ms, and with WebGPU on Android the intro was measured at 12 fps for
  // ~10 s while stages streamed in, with the main thread mostly idle (GPU-side work). On phones, keep the opening shot
  // clean: wait until the viewer scrolls or the intro's glide has played (a stage the viewer reaches still
  // loads at once, see journey.tick).
  const syncCompile = (renderer.backend as any).isWebGLBackend && !(renderer.backend as any).parallel;
  const afterIntro = (go: () => void) => {
    if (!syncCompile && !ctx.isPhone) return void setTimeout(go, 400);
    const t0 = performance.now(), vp0 = scroll.vp;
    const poll = () => (Math.abs(scroll.vp - vp0) > 0.05 || performance.now() - t0 > 6000 ? go() : setTimeout(poll, 150));
    poll();
  };
  const startBackground = () =>
    afterIntro(() => journey.startBackground(async (s) => {
        if (params.has('nowarm')) return; // diagnostics: load stages without the warm-up
        const cam = fitCamera(s);
        await warm(s.scene, cam);
        for (const [o, c] of s.warmup?.(comp.stageTarget.width, comp.stageTarget.height) ?? []) await warm(o, c);
        // pipelines are compiled by now: the draw only creates the remaining GPU state
        await warm(s.scene, cam, comp.stageTarget, () => (s.render ? s.render(renderer, warmRT) : renderer.render(s.scene, cam)));
        await uploadPending();
      }));
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
    // frames drawn behind the preloader are filed separately: nobody sees them
    hud?.sample(dt, performance.now() - t0, !$preloader.get().isGateOpen ? 'preloader' : b >= 0 ? `${STAGES[a].id}>${STAGES[b].id}` : STAGES[a].id, dpr.applied, time);
    if (gpuTime) {
      renderer.resolveTimestampsAsync('render').then((ms) => {
        if (typeof ms === 'number' && ms > 0) { gpuMs.push(ms); if (gpuMs.length > 240) gpuMs.shift(); }
      });
    }
  }

  (window as any).__scene = { renderer, stages, comp, uFish, post, journey, dpr, gpuMs, frame, hud };
  // Real frames while the preloader still covers the page build the post chain's pipelines (tape passes,
  // fish-eye, output), which compileAsync does not reach. The first one only *starts* every pipeline it needs
  // (async: parallel shader compile on WebGL2, createRenderPipelineAsync on WebGPU) and skips draws that aren't
  // ready, instead of linking them one after another on the main thread (~0.7 s on Safari, right at the gate);
  // the second, once they're done, creates the remaining GPU state.
  try { await asyncPipelines(() => frame(1 / 60, performance.now() / 1000)); } catch (e) { console.warn('first frame', e); }
  try { frame(1 / 60, performance.now() / 1000); } catch (e) { console.warn('first frame', e); }
  hud?.resetClock(); // the next sample is the first visible frame, not the gap since these hidden ones
  return { frame, resize };
}
