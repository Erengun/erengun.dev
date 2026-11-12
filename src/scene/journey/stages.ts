/**
 * Builds the journey's stage list in timeline order (src/lib/timeline.ts STAGES):
 * intro (face portal adapter) · corridor / city / alley (portals/last.ts) · memories (optional module) ·
 * project worlds (src/scene/worlds/<id>.ts, else a placeholder world).
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

export interface BuiltStages {
  stages: Stage[];
  /** resolves when every stage's assets are in */
  ready: Promise<void>;
}

/** builds Stage objects in STAGES order */
export async function buildStages(ctx: StageContext, onProgress: (p: number) => void): Promise<Stage[]> {
  const last = createLastStages(ctx);
  let memories: Stage[] = [];
  const memLoader = memoryMods['../memories/index.ts'];
  if (memLoader && HAS_MEMORIES) {
    try {
      const mod = await memLoader();
      memories = mod.createMemoryStages?.(ctx) ?? [];
    } catch (e) {
      console.warn('[journey] memories unavailable', e);
    }
  }
  const worlds = await Promise.all(
    PROJECTS.map(async (project, index) => {
      const slides = await loadSlides(project);
      const wctx: ProjectWorldContext = { ...ctx, project, index, slides };
      const load = worldMods[`../worlds/${project.id}.ts`];
      if (load) {
        try {
          const mod = await load();
          if (mod.createWorld) return mod.createWorld(wctx);
        } catch (e) {
          console.warn(`[journey] world ${project.id} failed, using placeholder`, e);
        }
      }
      return placeholderWorld(wctx);
    }),
  );
  const byId = new Map<string, Stage>();
  byId.set('intro', introStage(ctx));
  byId.set('corridor', last.corridor);
  byId.set('city', last.city);
  byId.set('alley', last.alley);
  for (const m of memories) byId.set(m.id, m);
  PROJECTS.forEach((p, i) => byId.set(p.id, worlds[i]));
  const stages = STAGES.map((s) => {
    const st = byId.get(s.id);
    if (st) return st;
    console.warn(`[journey] no stage for ${s.id}, using a blank one`);
    return blankStage(s.id);
  });
  let done = 0;
  await Promise.all(
    stages.map((s) =>
      s.ready.catch((e) => console.warn(`[journey] ${s.id} ready failed`, e)).then(() => onProgress(++done / stages.length)),
    ),
  );
  return stages;
}

function blankStage(id: string): Stage {
  const camera = new PerspectiveCamera(50, 1, 0.1, 10);
  return { id, scene: new Scene(), camera, background: new Color(0x050505), ready: Promise.resolve(), update(f) { camera.aspect = f.aspect; } };
}
