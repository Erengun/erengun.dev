/**
 * Journey app: the site is one scroll-driven chain of fullscreen stages (JOURNEY.md, src/lib/timeline.ts).
 * Per frame: update the (at most two) stages around the scroll position → compositor renders them into its
 * two targets and blends them with the active transition inside the post chain's scene pass → fish-eye →
 * camcorder/VHS.
 */
import { WebGPURenderer, Vector2, RenderPipeline, PerspectiveCamera } from 'three/webgpu';
import { pass, uniform } from 'three/tsl';
import { $route, $preloader, scroll, tilt, pointer as sharedPointer } from '../lib/stores';
import { STAGES, TRANSITIONS, SCENE_VP, WIPES, journeyAt, stageLocal, clamp, damp, smoothstep } from '../lib/timeline';
import { fishEye, fishEyeCPU, overscanScale } from './post/fisheye';
import { createPostChain } from './post';
import { createCompositor } from './journey/compositor';
import { buildStages } from './journey/stages';
import type { Stage, StageContext, StageFrame } from './journey/types';

type Hooks = {
  onProgress: (p: number) => void;
};

export async function createApp(container: HTMLElement, hooks: Hooks) {
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  const renderer = new WebGPURenderer({ antialias: false, forceWebGL });
  await renderer.init();
  container.appendChild(renderer.domElement);
  const isPhoneNow = () => scroll.isPhone || matchMedia('(max-width: 47.99rem), (max-aspect-ratio: 4/3)').matches;
  const quality: 'high' | 'medium' = (navigator as any).deviceMemory <= 4 || (renderer.backend as any).isWebGLBackend ? 'medium' : 'high';
  const ctx: StageContext = { renderer, isPhone: isPhoneNow(), quality };

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

  // ------------------------------------------------------------- resize
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    ctx.isPhone = isPhoneNow();
    const dpr = Math.min(devicePixelRatio, 2);
    const cap = ctx.isPhone ? (quality === 'high' ? 1.5 : 1.2) : quality === 'high' ? 1.6 : 1;
    renderer.setPixelRatio(Math.min(dpr, cap));
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(size);
    comp.setSize(size.x, size.y);
    post.setSize(size.x, size.y);
  }
  resize();

  // ------------------------------------------------------------- stages
  stages = await buildStages(ctx, hooks.onProgress);

  // warm-up: compile every stage once (+ the compositor/post) so transitions don't hitch
  try {
    for (const s of stages) {
      const cam = s.camera as PerspectiveCamera;
      cam.aspect = size.x / size.y;
      cam.updateProjectionMatrix();
      await renderer.compileAsync(s.scene, cam);
    }
    await renderer.compileAsync(comp.scene, comp.camera);
  } catch (e) {
    console.warn('compile warmup', e);
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

  function frame(dt: number, time: number) {
    ctx.isPhone = scroll.isPhone || isPhoneNow();
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
  }

  (window as any).__scene = { renderer, stages, comp, uFish, post };
  return { frame, resize };
}
