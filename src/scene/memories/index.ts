/**
 * Memory stages: two "captured places" rebuilt from Eren's own photos.
 *
 *   stage   GDG DevFest Istanbul 2022 talk; the projector screen turns into a window into the BAU codelab room
 *   teams   gallery-in-space of competition team photos (FRC, TEKNOFEST, THK aviation, Women Techmakers)
 *
 * Every photo was turned into layered 2.5D gaussian splats offline (tools/memories/build.py): monocular depth,
 * person mattes, an inpainted background layer extended past the photo border plus a separate foreground
 * layer, adaptive quadtree splats oriented along the surface. Each splat (.csplat, tools/splat/compact.mjs) is authored in its own "capture"
 * frame: camera at the origin looking down −Z, photo width = HFOV. A camera at that pose reproduces the photo
 * exactly; the paths below stay within the angles the layered depth supports (a few degrees of orbit, dolly
 * along the view axis), which is what makes them read as places instead of flat cards.
 *
 * Rendering uses the shared splat renderer (src/scene/splat/splat.ts) unchanged: one handle per file, with
 * renderOrder deciding how the separately-sorted files composite.
 */
import { Scene, Color, PerspectiveCamera, Group, Vector3, Quaternion, Matrix4 } from 'three/webgpu';
import type { Stage, StageContext, StageFrame } from '../journey/types';
import { createSplat, type SplatHandle } from '../splat/splat';

export const MEMORY_COPY = [
  {
    id: 'stage',
    kicker: 'talks & codelabs',
    title: 'On stage',
    body: 'On stage at GDG DevFest Istanbul 2022, and teaching a Flutter codelab at BAU. I like showing people how the thing actually works.',
  },
  {
    id: 'teams',
    kicker: 'teams',
    title: 'Built with teams',
    body: 'FRC 2018 Istanbul Regional, TEKNOFEST, an aviation team, and a Women Techmakers night. The best parts were always the people.',
  },
] as const;

// ------------------------------------------------------------------------------------------------ helpers
const HFOV = 64; // must match tools/memories/build.py
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** vertical fov (deg) whose horizontal span at 16:10 is `h` degrees */
const vfovFor = (h: number, aspect = 1.6) => (2 * Math.atan(Math.tan((h * Math.PI) / 360) / aspect) * 180) / Math.PI;

const _m = new Matrix4(), _up = new Vector3(0, 1, 0), _t = new Vector3(), _q = new Quaternion();

/** poses `cam` at `pos` looking at `target`, then applies a small extra yaw/pitch (parallax) */
function lookFrom(cam: PerspectiveCamera, pos: Vector3, target: Vector3, roll = 0) {
  cam.position.copy(pos);
  _m.lookAt(pos, target, _up);
  cam.quaternion.setFromRotationMatrix(_m);
  if (roll) cam.quaternion.multiply(_q.setFromAxisAngle(_t.set(0, 0, 1), roll));
  cam.updateMatrixWorld();
}

type Layer = { h: SplatHandle; base: number };

function makeLayer(ctx: StageContext, url: string, parent: Group | Scene, order: number): Layer {
  const h = createSplat({ renderer: ctx.renderer, url, isPhone: ctx.isPhone });
  h.object.renderOrder = order;
  parent.add(h.object);
  return { h, base: 1 };
}

function updateLayers(layers: Layer[], f: StageFrame, cam: PerspectiveCamera) {
  // hover push from the shared renderer: kept but only while the pointer is really inside
  const p = { x: f.pointer.x, y: f.pointer.y, inside: f.pointer.inside };
  for (const l of layers) l.h.update(f.dt, cam, p);
}

function baseStage(id: string, bg: Color, fov: number) {
  const scene = new Scene();
  scene.background = bg;
  const camera = new PerspectiveCamera(fov, 16 / 10, 0.05, 400);
  return { scene, camera };
}

// ------------------------------------------------------------------------------------------------ stage
/**
 * The codelab capture shares the DevFest capture's origin and axes, scaled by K so all of its content that
 * can be seen through the projector screen lies BEHIND the screen plane (z ≈ -9.3). Seen from near the
 * origin, the window therefore shows the codelab photo in its own correct perspective (no "diorama box"),
 * and flying through the screen is a plain dolly into the codelab capture, the motion 2.5D supports best.
 */
function createStageMemory(ctx: StageContext): Stage {
  const bg = new Color(0x050608);
  const { scene, camera } = baseStage('stage', bg, vfovFor(HFOV * 0.9));
  const K = 3.5;
  const codelabRoot = new Group();
  codelabRoot.scale.setScalar(K);
  scene.add(codelabRoot);
  // draw order between the separately sorted files: codelab (furthest), the slide, then the DevFest room
  // (walls + people, sorted together) so the speaker stays in front of the slide
  const codelab = makeLayer(ctx, '/memories/stage-codelab.csplat', codelabRoot, 0);
  const screen = makeLayer(ctx, '/memories/stage-screen.csplat', scene, 1);
  const devfest = makeLayer(ctx, '/memories/stage-devfest.csplat', scene, 2);
  // landmarks in the DevFest capture frame (tools/memories/landmark.py)
  const SPEAKER = new Vector3(1.9, 0.4, -8.3);
  const WINDOW = new Vector3(3.15, 0.35, -8.6); // free part of the screen, right of the speaker
  const APPROACH = new Vector3(1.9, 0.45, -4.2); // between the roll-up banner (x>2.5 at z≈-4.7) and the speaker
  const VIA = new Vector3(1.2, 0.3, -1.4);
  const FINAL = new Vector3(1.3, 0.3, -6.0);
  const FINAL_AT = new Vector3(-0.2, -1.15, -11.8).multiplyScalar(K); // between the code on the projector and Eren
  const pos = new Vector3(), tgt = new Vector3(), a0 = new Vector3(), a1 = new Vector3(), b0 = new Vector3();
  const ready = Promise.all([codelab.h.ready, devfest.h.ready, screen.h.ready]).then(() => {});
  return {
    id: 'stage', scene, camera, background: bg, ready,
    update(f) {
      const t = f.t;
      // ---- arrive + hold in the DevFest room
      const a = easeInOut(sstep(-0.05, 0.3, t));
      const hold = sstep(0.2, 0.58, t);
      const orb = Math.sin(lerp(-1, 1, hold)) * 0.28;
      a0.set(lerp(-0.35, 0, a) + orb, lerp(0.3, 0.05, a), lerp(2.2, 0.3, a) - hold * 0.7);
      a1.copy(SPEAKER).lerp(WINDOW, hold * 0.5);
      a1.x -= orb * 0.3;
      // ---- approach the screen (now a window), quadratic bezier
      const fly = easeInOut(sstep(0.55, 0.8, t));
      const iu = 1 - fly;
      b0.set(0, 0, 0).addScaledVector(a0, iu * iu).addScaledVector(VIA, 2 * iu * fly).addScaledVector(APPROACH, fly * fly);
      _t.copy(WINDOW); _t.z -= 4;
      tgt.copy(a1).lerp(_t, fly);
      // ---- the room dissolves, we drift on into the codelab
      const settle = easeInOut(sstep(0.74, 1.02, t));
      pos.copy(b0).lerp(FINAL, settle);
      tgt.lerp(FINAL_AT, settle);
      pos.x += f.parallax.x * 0.1;
      pos.y += f.parallax.y * 0.05;
      lookFrom(camera, pos, tgt);
      screen.h.setOpacity(1 - sstep(0.36, 0.56, t));
      devfest.h.setOpacity(1 - sstep(0.7, 0.8, t));
      updateLayers([codelab, devfest, screen], f, camera);
    },
    dispose() { codelab.h.dispose(); devfest.h.dispose(); screen.h.dispose(); },
  };
}

// ------------------------------------------------------------------------------------------------ teams
/**
 * Four captures floating in the dark along a winding path. Each panel is its own capture frame (scaled by k,
 * yawed towards the path); the camera dwells at each panel's capture origin (pulled back a little, so the
 * slab reads as a floating piece of a real place) and swings across to the next one on the other side.
 * Panels fade out as the camera slips past them, so nothing is seen from behind or edge-on.
 */
const PANELS = [
  { file: 'teams-frc', pos: [3.0, 0.2, 0], yaw: 0.2, k: 0.3 },
  { file: 'teams-teknofest', pos: [-3.2, -0.1, -8.5], yaw: -0.2, k: 0.33 },
  { file: 'teams-thk', pos: [3.1, 0.25, -17], yaw: 0.2, k: 0.3 },
  { file: 'teams-wtm', pos: [-2.6, 0.0, -22.5], yaw: -0.2, k: 0.45 },
];

function createTeams(ctx: StageContext): Stage {
  const bg = new Color(0x040507);
  const { scene, camera } = baseStage('teams', bg, vfovFor(HFOV * 0.95));
  const panels = PANELS.map((p) => {
    const g = new Group();
    g.position.set(p.pos[0], p.pos[1], p.pos[2]);
    g.rotation.set(0, p.yaw, 0);
    g.scale.setScalar(p.k);
    scene.add(g);
    g.updateMatrixWorld();
    const l = makeLayer(ctx, `/memories/${p.file}.csplat`, g, 0);
    // dwell viewpoint (capture origin pulled back) and look target (a point deep in the capture)
    const eye = new Vector3();
    const at = new Vector3(0, 0, -8).applyMatrix4(g.matrixWorld);
    return { g, l, p, eye, at };
  });
  const ready = Promise.all(panels.map((p) => p.l.h.ready)).then(() => {});
  const pos = new Vector3(), tgt = new Vector3(), tmp = new Vector3(), loc = new Vector3(), inv = new Matrix4();
  const n = panels.length;
  const eyes: Vector3[] = [new Vector3(), ...panels.map((p) => p.eye), new Vector3()];
  let lastAspect = -1;
  /** dwell viewpoints: capture origin pulled back; further on portrait screens so a whole group stays in frame */
  const placeEyes = (aspect: number) => {
    const pull = 3.2 + (aspect < 1.3 ? (1.6 / aspect - 1) * 4 : 0);
    panels.forEach((p) => p.eye.set(0, 0, pull).applyMatrix4(p.g.matrixWorld));
    eyes[0].copy(panels[0].eye).add(new Vector3(-1.6, 0.4, 5));
    eyes[n + 1].copy(panels[n - 1].eye).add(new Vector3(2.5, 0, -7));
    lastAspect = aspect;
  };
  const ats = [panels[0].at.clone(), ...panels.map((p) => p.at), panels[n - 1].at.clone().add(new Vector3(3, 0, -6))];
  const catmull = (out: Vector3, pts: Vector3[], s: number) => {
    const m = pts.length - 1;
    const x = Math.min(Math.max(s, 0), m - 1e-6);
    const i = Math.floor(x), u = x - i;
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, m)];
    const u2 = u * u, u3 = u2 * u;
    for (const c of ['x', 'y', 'z'] as const) {
      out[c] = 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * u + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * u3);
    }
    return out;
  };
  return {
    id: 'teams', scene, camera, background: bg, ready,
    update(f) {
      if (Math.abs(f.aspect - lastAspect) > 1e-3) placeEyes(f.aspect);
      // s: 0 = arrival point, 1..n = dwell at panel i-1, n+1 = departure. Dwells are plateaus.
      const raw = lerp(0.2, n + 0.85, clamp01(f.t));
      const i0 = Math.floor(raw), fr = raw - i0;
      const s = i0 + easeInOut(sstep(0.4, 1.0, fr));
      catmull(pos, eyes, s);
      // the gaze leads the body: during a swing the next capture comes into view early
      catmull(tgt, ats, i0 + easeInOut(sstep(0.2, 0.75, fr)));
      // slow drift during dwells + parallax
      const drift = Math.sin(raw * Math.PI * 2) * 0.12;
      pos.x += drift + f.parallax.x * 0.1;
      pos.y += f.parallax.y * 0.05 + Math.sin(f.time * 0.3) * 0.015;
      lookFrom(camera, pos, tgt);
      for (const p of panels) {
        // far first between separately sorted panels
        tmp.setFromMatrixPosition(p.g.matrixWorld);
        p.l.h.object.renderOrder = -Math.round(tmp.distanceTo(camera.position) * 100);
        // fade a panel once the camera is past (or deep inside) its capture origin
        inv.copy(p.g.matrixWorld).invert();
        loc.copy(camera.position).applyMatrix4(inv);
        p.l.h.setOpacity(sstep(-5, -0.5, loc.z));
      }
      updateLayers(panels.map((p) => p.l), f, camera);
    },
    dispose() { panels.forEach((p) => p.l.h.dispose()); },
  };
}

export function createMemoryStages(ctx: StageContext): Stage[] {
  return [createStageMemory(ctx), createTeams(ctx)];
}
