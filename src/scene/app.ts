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
import { WebGPURenderer, TextureLoader, Texture as TextureClass, type Texture, Vector2, RenderPipeline, PerspectiveCamera, type Object3D, type Camera, type Mesh, type Material, type RenderTarget, RenderTarget as RenderTargetClass, HalfFloatType } from 'three/webgpu';
import { BITMAP_TEXTURES, fetchBlob, textureBitmap } from './bitmap';
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
  /** highest tier this device may use (scripts/guard.ts: lowered after a crash or a lost context) */
  cap?: 'high' | 'medium' | 'low';
  /** the graphics context / device is gone: nothing more can be drawn by this renderer */
  onLost?: (visible: boolean) => void;
  /** still a slideshow at the lowest resolution and detail */
  onTooSlow?: () => void;
};
/** software rasterisers (no usable GPU, or a blocklisted driver): a few frames a second at best */
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;

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
  if (!forcedQ && SOFTWARE_GPU.test(gpuName)) throw new Error(`software renderer (${gpuName})`);
  const cap = forcedQ ? undefined : hooks.cap;
  const lowEnd =
    forcedQ === 'low' || cap === 'low' ||
    (!forcedQ && isPhoneDevice && (LOW_END_GPU.test(gpuName) || ((navigator as any).deviceMemory ?? 8) <= 3));
  // entry-level phone GPUs run three's WebGL2 backend noticeably faster than their WebGPU drivers
  // Firefox's WebGPU is slower than its WebGL2 here (M1 report); `?webgpu` opts back in
  const firefox = /firefox\//i.test(navigator.userAgent) && !params.has('webgpu');
  const forceWebGL = params.has('webgl') || lowEnd || firefox;
  const gpuTime = params.has('gputime');
  const renderer = new WebGPURenderer({ antialias: false, forceWebGL, trackTimestamp: gpuTime } as any);
  await renderer.init();
  container.appendChild(renderer.domElement);
  // a lost context never comes back for this renderer: every later frame would throw and the picture would stay
  // frozen on its last frame. Hand over to the page (stills + one recovery reload, scripts/main.ts)
  const lostDefault = renderer.onDeviceLost.bind(renderer);
  renderer.onDeviceLost = (info) => {
    lostDefault(info);
    hooks.onLost?.(!document.hidden);
  };
  const isPhoneNow = () => scroll.isPhone || matchMedia('(max-width: 47.99rem), (max-aspect-ratio: 4/3)').matches;
  // hybrid: a tier from the GPU (low / medium / high) picks resolution caps and scene detail; the adaptive pixel
  // ratio below then only steps down if frames actually drop, and climbs back when they recover
  const quality: 'high' | 'medium' | 'low' = lowEnd
    ? 'low'
    : forcedQ === 'high' || forcedQ === 'medium'
      ? forcedQ
      : cap === 'medium'
        ? 'medium'
        : HIGH_END_GPU.test(gpuName)
          ? 'high'
          : (navigator as any).deviceMemory <= 4 || (renderer.backend as any).isWebGLBackend ? 'medium' : 'high';
  const ctx: StageContext = { renderer, isPhone: isPhoneNow(), quality };
  // created early so it also counts the shader programs compiled before the preloader gate opens
  const hud = params.has('debug')
    ? createHud(
        {
          cap: cap ?? 'none', gpu: gpuName || '(hidden)', backend: (renderer.backend as any).isWebGLBackend ? 'WebGL2' : 'WebGPU', tier: quality,
          parallelCompile: (renderer.backend as any).isWebGLBackend ? !!(renderer.backend as any).parallel : 'n/a (WebGPU is async)',
          lowEnd, phone: isPhoneDevice, devicePixelRatio, screen: `${screen.width}x${screen.height}`,
          deviceMemory: (navigator as any).deviceMemory ?? '?', cores: navigator.hardwareConcurrency ?? '?', ua: navigator.userAgent,
        },
        () => ({
          dpr: dpr.applied.toFixed(2), buffer: `${size.x}x${size.y}`, minRatio: dpr.minRatio,
          detail: [...detail].map(([s, l]) => `${s.id} ${DETAIL[l]}`).join(', ') || 'full',
        }),
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
  const dpr = { reduction: 0, applied: 0, minRatio: quality === 'low' ? 0.5 : 0.75, lock: params.has('bench') };
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
   * Adaptive pixel ratio + detail: MEDIAN real frame time over ~1 s windows.
   * Down (< 45 fps): the current stage's detail first (Stage.setDetail: the splat scenes draw fewer, larger splats;
   * their cost is per splat, so blurring the frame barely helps them), then −.25 pixel ratio. Up (> 55 fps):
   * resolution first, then detail.
   * The median measures how fast the GPU draws a typical frame; one-off stalls (a shader link, an image upload)
   * would drag a mean down. Windows with a tab switch or a resize are dropped. While stages stream in (or just
   * swapped/compiled) only a clearly struggling GPU (< 30 fps) is acted on, and nothing goes back up.
   * A 30 Hz-capped display (steady ~33 ms) is not treated as slow; after a step down, going back up to that level
   * waits 8 s so it can't oscillate.
   */
  // flips: down-steps that followed an up-step; after FLIPFLOPS of them quality stops climbing (it would only oscillate)
  const FLIPFLOPS = 4;
  const ctl = { t: 0, dts: [] as number[], skip: true, noisy: false, last: 0, blockUpUntil: 0, blockedRatio: Infinity, wentUp: false, flips: 0, stage: null as Stage | null, stuck: 0 };
  let loading = () => true; // set once the journey exists: background loads/compiles make frames unrepresentative
  function skipWindow() { ctl.skip = true; }
  function noisyWindow() { ctl.noisy = true; }
  const DETAIL = [1, 0.75, 0.5, 0.35];
  const detail = new Map<Stage, number>();
  const detailBlock = { stage: null as Stage | null, level: -1, until: 0 };
  function setDetail(s: Stage, level: number) {
    detail.set(s, level);
    s.setDetail!(DETAIL[level]);
  }
  const slow = { t: 0, n: 0, hits: 0, fired: false };
  function tooSlow() {
    if (slow.fired) return;
    slow.fired = true;
    hooks.onTooSlow?.();
  }
  function adapt(now: number) {
    // the real interval: the loop's dt is clamped to 50 ms, which would make a 7 fps GPU look like 20 fps
    const dt = ctl.last ? now - ctl.last : 1 / 60;
    ctl.last = now;
    // last resort, independent of the windows below (which drop frames longer than .5 s, so a GPU drawing two
    // frames a second would never register): under 12 fps on average over 5 s stretches, 2 in a row (4 while
    // stages are still streaming in, which slows healthy devices too)
    if (dt > 3) slow.t = slow.n = 0; // back from another tab or app: start the stretch over
    else if (!document.hidden && !dpr.lock) {
      slow.t += dt; slow.n++;
      if (slow.t >= 5) {
        slow.hits = slow.n / slow.t < 12 ? slow.hits + 1 : 0;
        slow.t = slow.n = 0;
        if (slow.hits >= (loading() ? 4 : 2)) tooSlow();
      }
    }
    if (document.hidden || dt > 0.5 || dpr.lock) skipWindow();
    ctl.t += dt; ctl.dts.push(dt);
    if (ctl.t < 1 || ctl.dts.length < 4) return;
    const d = ctl.dts.sort((a, b) => a - b);
    const q = (p: number) => d[Math.min(d.length - 1, Math.floor(p * d.length))];
    const med = q(0.5), spread = q(0.75) - q(0.25);
    const skip = ctl.skip, quiet = !ctl.noisy && !loading();
    ctl.t = 0; ctl.dts = [];
    ctl.skip = ctl.noisy = false;
    if (skip) return;
    const fps = 1 / med;
    const capped30 = fps > 26 && fps < 34 && spread < 0.004;
    const verySlow = fps < 30 && !capped30;
    if (fps >= 20) ctl.stuck = 0;
    const js = journeyAt(scroll.vp);
    const st = js.trans ? null : stages[js.current];
    const level = st?.setDetail ? detail.get(st) ?? 0 : -1;
    // flip-flops are counted per stage: a scene that oscillated must not pin the next ones low
    if (st && st !== ctl.stage) { ctl.stage = st; ctl.flips = 0; ctl.wentUp = false; }
    if (verySlow || (fps < 45 && !capped30 && quiet)) {
      let changed = false;
      if (st && level >= 0 && level < DETAIL.length - 1) {
        // the stage has a cheaper mode (fewer splats): use it before blurring the whole frame
        Object.assign(detailBlock, { stage: st, level, until: now + 8 });
        setDetail(st, level + 1);
        changed = true;
      } else {
        // safety net when the GPU name is hidden: still < 30 fps at the floor → allow going down to .5
        if (verySlow && dpr.applied <= floorRatio() + 1e-3 && dpr.minRatio > 0.5) dpr.minRatio = 0.5;
        if (dpr.applied > floorRatio() + 1e-3) {
          ctl.blockedRatio = dpr.applied;
          ctl.blockUpUntil = now + 8;
          dpr.reduction = Math.min(dpr.reduction + (verySlow ? 2 : 1) * DPR_STEP, dprCap() - floorRatio());
          changed = true;
        }
      }
      if (!changed) {
        // nothing left to give up and still under 15 fps, window after window: the scene can't run here. Longer
        // patience while stages are still streaming in, which slows a healthy device too
        if (fps < 15 && ++ctl.stuck >= (quiet ? 4 : 12)) tooSlow();
        return;
      }
      if (ctl.wentUp) ctl.flips++;
      ctl.wentUp = false;
    } else if (fps > 55 && quiet && ctl.flips < FLIPFLOPS) {
      // reverse order of going down: sharpness first, then the stage's detail
      if (dpr.reduction > 0) {
        const next = Math.max(dprCap() - (dpr.reduction - DPR_STEP), floorRatio());
        if (next >= ctl.blockedRatio - 1e-3 && now < ctl.blockUpUntil) return;
        dpr.reduction = Math.max(0, dpr.reduction - DPR_STEP);
      } else if (st && level > 0) {
        if (detailBlock.stage === st && level - 1 <= detailBlock.level && now < detailBlock.until) return;
        setDetail(st, level - 1);
      } else return;
      ctl.wentUp = true;
    } else return;
    if (Math.abs(targetRatio() - dpr.applied) > 1e-3) applySize();
    skipWindow();
  }
  resize();
  // Safari can run this before the stylesheet has applied: the container is then still an unstyled block around
  // the canvas (150 px tall) and no window resize follows, so the scene would stay rendered into that size and be
  // stretched. Follow the container's own box instead of relying on window resizes alone.
  if (typeof ResizeObserver !== 'undefined') {
    let lw = container.clientWidth, lh = container.clientHeight;
    new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (w === lw && h === lh) return;
      lw = w; lh = h;
      if (w > 0 && h > 0) resize();
    }).observe(container);
  }

  // ------------------------------------------------------------- stages
  // every image texture the worlds load; the ones a stage doesn't show right away (later slides) would otherwise
  // upload the first time they appear, mid-scroll. They are uploaded in the background with their stage.
  const loadedTextures = new Set<Texture>();
  const tlLoad = TextureLoader.prototype.load;
  TextureLoader.prototype.load = function (this: TextureLoader, ...a: Parameters<TextureLoader['load']>) {
    if (!BITMAP_TEXTURES) {
      const t = tlLoad.apply(this, a);
      loadedTextures.add(t);
      return t;
    }
    // same contract as TextureLoader.load, with an ImageBitmap as the image (see bitmap.ts): the upload that
    // follows is a plain copy instead of a main-thread conversion of the <img>
    const [url, onLoad, , onError] = a;
    const t = new TextureClass();
    t.flipY = false;
    loadedTextures.add(t);
    const full = this.manager.resolveURL(this.path ? this.path + url : url);
    this.manager.itemStart(full);
    fetchBlob(full).then(textureBitmap).then((bm) => {
      t.image = bm;
      t.needsUpdate = true;
      onLoad?.(t as never);
      this.manager.itemEnd(full);
    }).catch((e) => {
      if (onError) onError(e); else console.error(e);
      this.manager.itemError(full);
      this.manager.itemEnd(full);
    });
    return t as ReturnType<TextureLoader['load']>;
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
  journey.onActivity = noisyWindow;
  // entry-level GPUs open the splat photo one step thinner (it climbs back if frames allow)
  if (quality === 'low' && stages[0]?.setDetail) setDetail(stages[0], 1);
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
    adapt(time);
    // frame-sequence capture (scripts/lite.ts): the capture script pins the scene clock to the scroll position, so
    // every frame is a function of where the page is scrolled and nothing else
    if (typeof (window as any).__sceneTime === 'number') time = (window as any).__sceneTime;
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

  (window as any).__scene = { tier: quality, renderer, stages, comp, uFish, post, journey, dpr, gpuMs, frame, hud, applySize };
  // Real frames while the preloader still covers the page build the post chain's pipelines (tape passes,
  // fish-eye, output), which compileAsync does not reach. The first one only *starts* every pipeline it needs
  // (async: parallel shader compile on WebGL2, createRenderPipelineAsync on WebGPU) and skips draws that aren't
  // ready, instead of linking them one after another on the main thread (~0.7 s on Safari, right at the gate);
  // the second, once they're done, creates the remaining GPU state.
  try { await asyncPipelines(() => frame(1 / 60, performance.now() / 1000)); } catch (e) { console.warn('first frame', e); }
  try { frame(1 / 60, performance.now() / 1000); } catch (e) { console.warn('first frame', e); }
  hud?.resetClock(); // the next sample is the first visible frame, not the gap since these hidden ones
  /** the real (loaded, compiled) stages are in for this scroll position, not their stand-ins */
  const ready = (vp: number) => {
    const js = journeyAt(vp);
    const a = js.trans ? js.from : js.current;
    return journey.isReady(a) && (!js.trans || journey.isReady(a + 1));
  };
  return { frame, resize, ready, tier: quality };
}
