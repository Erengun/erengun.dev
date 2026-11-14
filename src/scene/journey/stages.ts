/**
 * Builds the journey's stage list in timeline order (src/lib/timeline.ts STAGES):
 * intro (face portal adapter) · corridor / city / alley (portals/last.ts) · memories (optional module) ·
 * project worlds (src/scene/worlds/<id>.ts, else a placeholder world). Loading is progressive: see buildJourney.
 */
import {
  Scene, Color, PerspectiveCamera, Mesh, PlaneGeometry, BoxGeometry, MeshBasicNodeMaterial, TextureLoader, SRGBColorSpace,
  Group, DataTexture, type Texture, type RenderTarget, type WebGPURenderer,
} from 'three/webgpu';
import { vec3, vec4, uniform, texture, uv, mix, positionWorld, smoothstep, length } from 'three/tsl';
import { PROJECTS, type Project } from '../../lib/content';
import { STAGES, HOLD, HAS_MEMORIES, smoothstep as smoothN } from '../../lib/timeline';
import { PORTAL_H, PORTAL_W, type Portal, type PortalFrame } from '../types';
import type { Stage, StageContext, StageFrame, SlideImage, CreateWorld, ProjectWorldContext } from './types';
import { createIntroPortal } from '../portals/intro';
import { createLastStages } from '../portals/last';

const worldMods = (import.meta as any).glob('../worlds/*.ts') as Record<string, () => Promise<{ createWorld?: CreateWorld }>>;
const memoryMods = (import.meta as any).glob('../memories/index.ts') as Record<string, () => Promise<any>>;

/** wraps the intro face Portal (written for the carousel) as a fullscreen stage */
export function introStage(ctx: StageContext): Stage {
  const portal: Portal = createIntroPortal({ renderer: ctx.renderer, isPhone: ctx.isPhone, quality: ctx.quality });
  // the portal expects the carousel's 110° camera posed in the portal plane's frame, fully flown through
  const camera = new PerspectiveCamera(110, 1, 0.01, 1000);
  const frame: PortalFrame = {
    dt: 0, time: 0, openness: 1, focus: 1, camera, pointer: { x: 0, y: 0, inside: false, down: false },
    parallax: { x: 0, y: 0 }, vp: 0, sceneT: 0, isPhone: ctx.isPhone, gateOpen: false, slide: 0, inside: false,
  };
  return {
    id: 'intro',
    scene: portal.scene,
    camera,
    background: portal.background,
    ready: portal.ready,
    update(f) {
      camera.fov = 110;
      camera.aspect = f.aspect;
      camera.updateProjectionMatrix();
      const t = Math.tan((camera.fov * Math.PI) / 360);
      const cover = Math.min(PORTAL_H / (2 * t), PORTAL_W / (2 * t * camera.aspect));
      camera.position.set(0, 0, cover * 0.8);
      camera.quaternion.identity();
      camera.updateMatrixWorld(true);
      Object.assign(frame, {
        dt: f.dt, time: f.time, pointer: f.pointer, parallax: f.parallax, vp: f.vp, isPhone: f.isPhone, gateOpen: f.gateOpen,
        // stop pointer interaction once the dive starts
        focus: 1 - f.exit,
      });
      portal.update(frame);
    },
    render(r: WebGPURenderer, rt: RenderTarget) {
      if (portal.render) portal.render(r, camera, rt);
      else {
        r.setRenderTarget(rt);
        r.setClearColor(portal.background, 1);
        r.clear();
        r.render(portal.scene, camera);
      }
    },
    onClick: portal.onClick ? (x, y) => portal.onClick!(x, y) : undefined,
    dispose: () => portal.dispose?.(),
  };
}

async function loadSlides(p: Project): Promise<SlideImage[]> {
  for (const url of [`/projects/${p.id}/manifest.json`, '/projects/_placeholder/manifest.json']) {
    try {
      const r = await fetch(url);
      if (r.ok) return (await r.json()) as SlideImage[];
    } catch {
      /* next */
    }
  }
  return [];
}

/** simple stand-in world: the project's screenshots on a floating screen in a palette-tinted void */
export function placeholderWorld(ctx: ProjectWorldContext): Stage {
  const { project } = ctx;
  const [c0, c1, c2] = project.palette.map((c) => new Color(c));
  const scene = new Scene();
  const background = c0.clone().multiplyScalar(0.25);
  const camera = new PerspectiveCamera(50, 1, 0.05, 100);
  const loader = new TextureLoader();
  const texes: Texture[] = [];
  const uMix = uniform(0);
  const screenMat = new MeshBasicNodeMaterial();
  const blank = new DataTexture(new Uint8Array([24, 24, 24, 255]), 1, 1);
  blank.needsUpdate = true;
  const tA = texture(blank);
  const tB = texture(tA.value);
  screenMat.colorNode = mix(tA.sample(uv()).rgb, tB.sample(uv()).rgb, uMix);
  screenMat.toneMapped = false;
  const screen = new Mesh(new PlaneGeometry(3.2, 2), screenMat);
  scene.add(screen);
  const frame = new Mesh(new BoxGeometry(3.32, 2.12, 0.04), new MeshBasicNodeMaterial({ color: c1.clone().multiplyScalar(0.15) }));
  frame.position.z = -0.03;
  scene.add(frame);
  // a field of palette-coloured blocks
  const blocks = new Group();
  const bm = new MeshBasicNodeMaterial();
  const d = length(positionWorld.xz);
  bm.colorNode = vec4(mix(vec3(c2.r, c2.g, c2.b), vec3(c1.r, c1.g, c1.b), smoothstep(2, 9, d)).mul(0.35), 1);
  const bg = new BoxGeometry(0.4, 0.4, 0.4);
  for (let i = 0; i < 60; i++) {
    const m = new Mesh(bg, bm);
    const a = (i / 60) * Math.PI * 2 * 3.1;
    const rr = 3 + (i % 7) * 0.8;
    m.position.set(Math.cos(a) * rr, ((i * 37) % 11) / 11 * 4 - 2, -2 - Math.abs(Math.sin(a)) * rr);
    m.scale.setScalar(0.4 + ((i * 13) % 5) / 5);
    blocks.add(m);
  }
  scene.add(blocks);
  let shown = -1, from = 0, mixT = 1;
  const ready = loadSlides(project).then((slides) => {
    for (const s of slides.length ? slides : []) {
      const t = loader.load(s.src);
      t.colorSpace = SRGBColorSpace;
      texes.push(t);
    }
    if (texes[0]) { tA.value = texes[0]; tB.value = texes[0]; }
  });
  return {
    id: project.id,
    scene,
    camera,
    background,
    ready,
    update(f: StageFrame) {
      const arrive = smoothN(-0.3, HOLD[0], f.t), depart = smoothN(HOLD[1], 1.3, f.t);
      camera.fov = 50;
      camera.aspect = f.aspect;
      camera.position.set(f.parallax.x * 0.25, 0.1 - f.parallax.y * 0.15, 3.6 + (1 - arrive) * 4 - depart * 2.5);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      blocks.rotation.y = f.time * 0.03 + f.t * 0.8;
      screen.rotation.y = (1 - arrive) * 0.6 - depart * 0.5;
      frame.rotation.y = screen.rotation.y;
      const n = texes.length;
      if (n) {
        const want = ((f.slide % n) + n) % n;
        if (want !== shown) {
          from = shown < 0 ? want : shown;
          shown = want;
          mixT = shown === from ? 1 : 0;
          tA.value = texes[from];
          tB.value = texes[shown];
        }
        mixT = Math.min(1, mixT + f.dt / 0.5);
        uMix.value = mixT * mixT * (3 - 2 * mixT);
      }
    },
  };
}

/**
 * Progressive journey loading.
 *
 * Only the intro and the corridor are part of the preloader gate (`critical`). Every other stage loads in the
 * background after the gate (startBackground), one at a time, nearest-next first relative to where the user
 * is (re-prioritised on every pick, so anchor jumps are honoured), each followed by a shader compile so the
 * swap never hitches. Until a stage is in, its slot shows a stand-in:
 *   city   the real stage with only its sky (blocks pop in once city-block.glb is parsed)
 *   alley  the real stage with its procedural lantern alley (the splat swaps in once sorted)
 *   world  a lightweight placeholder world (built on first use) → replaced by the real world in place
 * A stage the user is already looking at jumps the queue.
 */
export interface Journey {
  /** STAGES order; entries are swapped in place when a real stage is ready */
  stages: Stage[];
  /** intro + corridor assets in */
  critical: Promise<void>;
  /** begin background loading. compile() should warm the stage's pipelines (renderer.compileAsync). */
  startBackground(compile: (s: Stage) => Promise<void>): void;
  /** call every frame with the stage indices on screen (b = -1 when none): pending ones jump the queue */
  tick(a: number, b: number): void;
  /** true once stage i is the real, compiled stage */
  isReady(i: number): boolean;
  /** true while a background load/compile is in flight (or queued but not yet started after the gate) */
  busy(): boolean;
  /** called after every swap / compile (adaptive resolution ignores the frame-time window around it) */
  onActivity?: () => void;
}

type Job = () => Promise<Stage>;
/** `?debug` only: timings the perf overlay prints with its report */
const jlog = (what: string, ms: number) => (window as any).__journeyLog?.push(`@${(performance.now() / 1000).toFixed(2)}s ${what}: ${ms.toFixed(0)}ms`);

export function buildJourney(ctx: StageContext, onProgress: (p: number) => void): Journey {
  const last = createLastStages(ctx);
  const intro = introStage(ctx);
  const n = STAGES.length;
  const stages: Stage[] = new Array(n);
  const jobs: (Job | null)[] = new Array(n).fill(null);
  const ready: boolean[] = new Array(n).fill(false);

  // memory stages come from one optional module (hidden for now, see timeline.ts SHOW_MEMORIES)
  let memMod: Promise<Stage[]> | null = null;
  const memories = () =>
    (memMod ??= (async () => {
      const load = memoryMods['../memories/index.ts'];
      if (!load || !HAS_MEMORIES) return [];
      const mod = await load();
      return (mod.createMemoryStages?.(ctx) ?? []) as Stage[];
    })());

  STAGES.forEach((def, i) => {
    if (def.id === 'intro') { stages[i] = intro; ready[i] = true; return; }
    if (def.id === 'corridor') { stages[i] = last.corridor; ready[i] = true; return; }
    if (def.id === 'city') {
      stages[i] = last.city;
      jobs[i] = () => last.loadCity().then(() => last.city);
      return;
    }
    if (def.id === 'alley') {
      stages[i] = last.alley;
      jobs[i] = () => last.loadAlley().then(() => last.alley);
      return;
    }
    if (def.kind === 'world' && def.project !== undefined) {
      const project = PROJECTS[def.project];
      const index = def.project;
      stages[i] = deferredStage(project.id, () => placeholderWorld({ ...ctx, project, index, slides: [] }));
      jobs[i] = async () => {
        const slides = await loadSlides(project);
        const wctx: ProjectWorldContext = { ...ctx, project, index, slides };
        const load = worldMods[`../worlds/${project.id}.ts`];
        let st: Stage | null = null;
        if (load) {
          try {
            const mod = await load();
            const t = performance.now();
            if (mod.createWorld) st = mod.createWorld(wctx);
            jlog(`${project.id} createWorld (sync)`, performance.now() - t);
          } catch (e) {
            console.warn(`[journey] world ${project.id} failed, using placeholder`, e);
          }
        }
        st ??= placeholderWorld(wctx);
        await st.ready;
        return st;
      };
      return;
    }
    if (def.kind === 'memory') {
      stages[i] = blankStage(def.id);
      jobs[i] = async () => {
        const st = (await memories()).find((m) => m.id === def.id);
        if (!st) throw new Error(`no memory stage ${def.id}`);
        await st.ready;
        return st;
      };
      return;
    }
    console.warn(`[journey] no stage for ${def.id}, using a blank one`);
    stages[i] = blankStage(def.id);
    ready[i] = true;
  });

  let done = 0;
  const critical = Promise.all(
    [intro.ready, last.corridor.ready].map((r) =>
      r.catch((e) => console.warn('[journey] critical stage failed', e)).then(() => onProgress(++done / 2)),
    ),
  ).then(() => {});

  // ------------------------------------------------------------------ background queue
  let compileFn: ((s: Stage) => Promise<void>) | null = null;
  const started: boolean[] = new Array(n).fill(false);
  let running = 0;
  let cur = 0, other = -1;
  const idle = (cb: () => void) =>
    'requestIdleCallback' in window ? (window as any).requestIdleCallback(cb, { timeout: 400 }) : setTimeout(cb, 60);

  /** nearest stage ahead of the viewer first, then the ones behind */
  function pick(): number {
    let best = -1, bestP = Infinity;
    for (let i = 0; i < n; i++) {
      if (!jobs[i] || started[i]) continue;
      const p = i >= cur ? i - cur : 100 + (cur - i);
      if (p < bestP) { bestP = p; best = i; }
    }
    return best;
  }

  async function run(i: number) {
    started[i] = true;
    running++;
    try {
      const t0 = performance.now();
      const st = await jobs[i]!();
      const t1 = performance.now();
      if (compileFn) await compileFn(st).catch((e) => console.warn(`[journey] compile ${st.id}`, e));
      jlog(`${STAGES[i].id} load (wall)`, t1 - t0);
      jlog(`${STAGES[i].id} compile (wall)`, performance.now() - t1);
      const prev = stages[i];
      stages[i] = st;
      ready[i] = true;
      if (prev !== st) (prev as any).__disposeDeferred?.();
    } catch (e) {
      console.warn(`[journey] ${STAGES[i].id} unavailable, keeping its stand-in`, e);
    } finally {
      running--;
      journey.onActivity?.();
      idle(pump);
    }
  }

  function pump() {
    if (!compileFn || running > 0) return;
    const i = pick();
    if (i >= 0) void run(i);
  }

  const journey: Journey = {
    stages,
    critical,
    startBackground(compile) {
      if (compileFn) return;
      compileFn = compile;
      idle(pump);
    },
    tick(a, b) {
      cur = a;
      other = b;
      if (!compileFn) return;
      // the viewer reached a stage that isn't in yet: load it now, alongside whatever is running
      for (const i of [a, other]) if (i >= 0 && jobs[i] && !started[i]) void run(i);
    },
    isReady: (i) => ready[i],
    busy: () => running > 0 || (!compileFn && jobs.some((j, i) => j && !started[i])),
  };
  return journey;
}

/** a stage whose (cheap) implementation is only built when something first touches it */
function deferredStage(id: string, make: () => Stage): Stage {
  let inner: Stage | null = null;
  const get = () => (inner ??= make());
  return {
    id,
    get scene() { return get().scene; },
    get camera() { return get().camera; },
    get background() { return get().background; },
    get grade() { return get().grade; },
    get ready() { return get().ready; },
    update: (f) => get().update(f),
    get render() { const s = get(); return s.render ? (r: WebGPURenderer, rt: RenderTarget) => s.render!(r, rt) : undefined; },
    get portalQuad() { const s = get(); return s.portalQuad ? () => s.portalQuad!() : undefined; },
    get onClick() { const s = get(); return s.onClick ? (x: number, y: number) => s.onClick!(x, y) : undefined; },
    __disposeDeferred: () => inner?.dispose?.(),
  } as Stage;
}

function blankStage(id: string): Stage {
  const camera = new PerspectiveCamera(50, 1, 0.1, 10);
  return { id, scene: new Scene(), camera, background: new Color(0x050505), ready: Promise.resolve(), update(f) { camera.aspect = f.aspect; } };
}
