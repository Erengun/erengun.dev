/**
 * Intro stage: an immersive SKI SCENE built from Eren's ski photo (a place, not a portrait).
 *
 * Hero: the photo as a layered gaussian splat (tools/portrait/ski_world.py → /intro/ski.splat → tools/splat/compact.mjs → /intro/ski.csplat, using the memories
 * pipeline: background inpainted behind the skier, skier + skis/poles as a clean foreground layer, sky pushed far,
 * borders extended and faded). Splat space: photo camera at the origin looking −Z, +Y up, metres.
 * Around it a procedural world in the same frame (/intro/ski.json: ground plane fit, skier position, sky colours):
 *   - snow ground aligned to the photo's slope, flat near the capture, gently undulating far away
 *   - instanced stylised pines continuing the treeline (kept out of the photo's frustum so they never cover it)
 *   - a distant mountain ridge, a sky dome in the photo's sky colours with soft cloud noise
 *   - falling snow + a little powder spray at the skis
 * Camera: starts wide and a little high, glides toward him with a ~15° orbit after the gate opens (≈7 s), then a slow idle
 * drift + pointer/tilt orbit parallax; the exit (focus = 1 − exit) skis past him downhill into the corridor.
 * Same module/export as before (createIntroPortal), the journey wrapper keeps working. WebGPU + WebGL2.
 */
import {
  Scene, Color, Group, Mesh, PlaneGeometry, SphereGeometry, ConeGeometry, CylinderGeometry, BufferGeometry,
  BufferAttribute, InstancedMesh, MeshBasicNodeMaterial, SpriteNodeMaterial, Sprite, PerspectiveCamera,
  Vector3, Quaternion, Matrix4, BackSide, AdditiveBlending, SRGBColorSpace, QuadMesh,
  type WebGPURenderer, type RenderTarget,
} from 'three/webgpu';
import {
  Fn, uniform, float, vec2, vec3, vec4, instanceIndex, hash, fract, sin, mix, smoothstep, clamp, length,
  positionWorld, positionLocal, positionGeometry, normalLocal, cameraPosition, uv, screenUV, mx_noise_float, abs, select,
} from 'three/tsl';
import { createSplat, type SplatHandle } from '../splat/splat';
import type { Portal, PortalContext, PortalFrame } from '../types';

const BASE = '/intro/';
type SkiMeta = {
  hfov: number; zn: number; zf: number;
  ground: [number, number, number];
  skier: { centre: number[]; feet: number[]; head: number[] };
  sky_zenith: number[]; sky_horizon: number[]; snow: number[]; snow_near?: number[]; snow_shadow?: number[];
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const srgb = (a: number[], k = 1) => new Color().setRGB(a[0] * k, a[1] * k, a[2] * k, SRGBColorSpace);

/** one stylised pine: trunk + three stacked cones, merged (non-indexed) */
function pineGeometry(): BufferGeometry {
  const parts = [
    new CylinderGeometry(0.06, 0.09, 0.5, 6).translate(0, 0.25, 0),
    new ConeGeometry(0.55, 0.9, 7).translate(0, 0.75, 0),
    new ConeGeometry(0.42, 0.75, 7).translate(0, 1.15, 0),
    new ConeGeometry(0.28, 0.6, 7).translate(0, 1.5, 0),
  ].map((g) => g.toNonIndexed());
  const n = parts.reduce((s, g) => s + g.getAttribute('position').count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
    g.dispose();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nor, 3));
  return geo;
}

export function createIntroPortal(ctx: PortalContext): Portal {
  const scene = new Scene();
  const background = new Color('#0b1220');
  const world = new Group();
  scene.add(world);
  const cam = new PerspectiveCamera(48, 1, 0.05, 2000);

  // ------------------------------------------------------------------ uniforms
  const uTime = uniform(0);
  const uZenith = uniform(new Color('#26508a'));
  const uHorizon = uniform(new Color('#9fb0c2'));
  const uSnow = uniform(new Color('#c7cbcd'));       // sunlit snow (photo)
  const uSnowNear = uniform(new Color('#a9b0b3'));   // the photo's near, trodden snow
  const uSnowShadow = uniform(new Color('#5a6880')); // the photo's blue snow shadows
  const uSnowBox = uniform(new Vector3());   // centre of the falling-snow box (follows the camera target)
  const uFeet = uniform(new Vector3(0, -1, -2.5));
  const uSpray = uniform(0);

  // ------------------------------------------------------------------ sky dome
  const skyMat = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  skyMat.colorNode = Fn(() => {
    const dir = positionLocal.normalize();
    const g = smoothstep(-0.02, 0.55, dir.y);
    let c: any = mix(uHorizon, uZenith, g);
    // soft cloud bank near the horizon (like the photo), slowly drifting
    const n = mx_noise_float(vec3(dir.x.mul(3.2).add(uTime.mul(0.004)), dir.y.mul(7.0), dir.z.mul(3.2))).mul(0.5).add(0.5);
    const band = smoothstep(0.0, 0.08, dir.y).mul(float(1).sub(smoothstep(0.12, 0.35, dir.y)));
    c = mix(c, vec3(0.92, 0.94, 0.97), smoothstep(0.45, 0.85, n).mul(band).mul(0.85));
    c = mix(c, uHorizon.mul(1.05), float(1).sub(smoothstep(-0.12, 0.0, dir.y)));
    return vec4(c, 1);
  })();
  const sky = new Mesh(new SphereGeometry(1500, 48, 24), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  world.add(sky);

  // ------------------------------------------------------------------ ground (aligned to the photo's slope)
  const groundMat = new MeshBasicNodeMaterial();
  const gDist = length(positionGeometry.xy);
  groundMat.positionNode = vec3(positionGeometry.xy,
    mx_noise_float(vec3(positionGeometry.xy.mul(0.025), 0.0)).mul(2.2).mul(smoothstep(14.0, 80.0, gDist)));
  groundMat.colorNode = Fn(() => {
    const p = positionWorld;
    const grain = mx_noise_float(vec3(p.xz.mul(1.7), 0.5)).mul(0.5).add(0.5);
    const big = mx_noise_float(vec3(p.xz.mul(0.08), 1.0)).mul(0.5).add(0.5);
    // matched to the photo's near snow: trodden base, sunlit crests, blue shadow dimples (sampled colours)
    let c: any = mix(uSnowNear, uSnow, smoothstep(0.35, 0.75, big)).mul(mix(0.93, 1.05, grain));
    const dimple = mx_noise_float(vec3(p.xz.mul(1.1), 2.0)).mul(0.5).add(0.5);
    const dimple2 = mx_noise_float(vec3(p.xz.mul(3.2), 5.0)).mul(0.5).add(0.5);
    const ripple = mx_noise_float(vec3(p.x.mul(0.4), p.z.mul(1.3), 3.0)).mul(0.5).add(0.5);
    const shade = smoothstep(0.55, 0.85, dimple).mul(0.6).add(smoothstep(0.62, 0.9, dimple2).mul(0.35)).add(smoothstep(0.65, 0.9, ripple).mul(0.3));
    c = mix(c, uSnowShadow, clamp(shade, 0, 0.75));
    c = c.add(smoothstep(0.7, 0.95, float(1).sub(dimple)).mul(0.06));                 // crest highlights
    // occasional twinkle: sparse glints that come and go
    const glint = mx_noise_float(vec3(p.xz.mul(16.0), uTime.mul(0.6))).mul(0.5).add(0.5);
    c = c.add(smoothstep(0.9, 0.97, glint).mul(0.45));
    const d = length(p.sub(cameraPosition));
    c = mix(c, uHorizon.mul(1.02), smoothstep(40.0, 420.0, d));
    return vec4(c, 1);
  })();
  const ground = new Mesh(new PlaneGeometry(1600, 1600, 160, 160), groundMat);
  ground.frustumCulled = false;
  world.add(ground);

  // ------------------------------------------------------------------ pines (instanced) + mountains
  const pineMat = new MeshBasicNodeMaterial();
  pineMat.colorNode = Fn(() => {
    const up = normalLocal.y;
    const h = hash(float(instanceIndex));
    let c: any = mix(vec3(0.018, 0.034, 0.028), vec3(0.03, 0.05, 0.04), h);
    c = mix(c, uSnow.mul(0.9), smoothstep(0.3, 0.7, up).mul(mix(0.2, 0.5, h)));     // a little snow on the boughs
    const d = length(positionWorld.sub(cameraPosition));
    c = mix(c, uHorizon.mul(0.8), smoothstep(40.0, 320.0, d).mul(0.6));
    return vec4(c, 1);
  })();
  const PINES = ctx.isPhone ? 260 : 520;
  const pines = new InstancedMesh(pineGeometry(), pineMat, PINES);
  pines.count = 0;
  pines.frustumCulled = false;
  world.add(pines);

  const ridgeMat = new MeshBasicNodeMaterial();
  ridgeMat.colorNode = Fn(() => {
    const t = uv().y;
    let c: any = mix(vec3(0.40, 0.47, 0.58), vec3(0.88, 0.91, 0.95), smoothstep(0.35, 0.95, t));
    c = mix(c, uHorizon, 0.45);
    return vec4(c, 1);
  })();
  const ridge = new Mesh(new BufferGeometry(), ridgeMat);
  ridge.frustumCulled = false;
  ridge.visible = false;
  world.add(ridge);

  // ------------------------------------------------------------------ splat (photo, hero)
  const splat: SplatHandle = createSplat({ renderer: ctx.renderer, url: BASE + 'ski.csplat', isPhone: ctx.isPhone });
  splat.object.renderOrder = 10;
  world.add(splat.object);

  // ------------------------------------------------------------------ falling snow + spray
  const SNOW = ctx.isPhone ? 700 : 1600;
  const flakeMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const fi = float(instanceIndex);
  const h1 = hash(fi), h2 = hash(fi.add(3.1)), h3 = hash(fi.add(7.7)), h4 = hash(fi.add(11.3));
  const BOX = new Vector3(22, 12, 26);
  const fall = uTime.mul(mix(0.35, 0.9, h4));
  const rel = vec3(
    fract(h1.add(uTime.mul(0.012)).add(sin(uTime.mul(0.23)).mul(0.03)).add(sin(uTime.mul(0.071).add(1.3)).mul(0.05))).sub(0.5).mul(BOX.x)
      .add(sin(uTime.mul(0.6).add(h2.mul(30))).mul(0.25).mul(float(1).add(sin(uTime.mul(0.37)).mul(0.6)))),   // gusty wind
    fract(h2.sub(fall.div(BOX.y))).sub(0.5).mul(BOX.y),
    h3.sub(0.5).mul(BOX.z));
  flakeMat.positionNode = uSnowBox.add(rel);
  flakeMat.scaleNode = vec2(mix(0.018, 0.05, h4.mul(h4)));
  flakeMat.colorNode = Fn(() => {
    const d = length(uv().sub(0.5)).mul(2);
    const a = float(1).sub(smoothstep(0.2, 1.0, d)).mul(0.75);
    return vec4(vec3(0.95, 0.97, 1.0).mul(a), a);
  })();
  const flakes = new Sprite(flakeMat);
  flakes.count = SNOW;
  flakes.frustumCulled = false;
  flakes.renderOrder = 20;
  world.add(flakes);

  const SPRAY = 260;
  const sprayMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const LIFE = 1.3;
  const age = fract(uTime.div(LIFE).add(h1));
  const side = select(h2.greaterThan(0.5), float(0.32), float(-0.22));
  const v0 = vec3(h3.sub(0.5).mul(1.1), mix(0.7, 1.6, h4), h1.sub(0.5).mul(0.8));
  const tt = age.mul(LIFE);
  sprayMat.positionNode = uFeet.add(vec3(side, 0.02, h2.sub(0.5).mul(0.3))).add(v0.mul(tt)).add(vec3(0, tt.mul(tt).mul(-2.2), 0));
  sprayMat.scaleNode = vec2(mix(0.015, 0.035, h3).mul(float(1).add(age)));
  sprayMat.colorNode = Fn(() => {
    const d = length(uv().sub(0.5)).mul(2);
    const a = float(1).sub(smoothstep(0.1, 1.0, d)).mul(float(1).sub(age)).mul(uSpray).mul(0.8);
    return vec4(vec3(1.0).mul(a), a);
  })();
  const spray = new Sprite(sprayMat);
  spray.count = SPRAY;
  spray.frustumCulled = false;
  spray.renderOrder = 21;
  world.add(spray);

  // ------------------------------------------------------------------ text-legibility vignette (screen space)
  const vigMat = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  vigMat.colorNode = vec4(0, 0, 0, 1);
  vigMat.opacityNode = Fn(() => {
    const p = screenUV.sub(0.5);
    const sides = smoothstep(0.18, 0.5, abs(p.x)).mul(0.5);
    const top = smoothstep(0.25, 0.5, p.y).mul(0.35);
    return clamp(sides.add(top).add(0.14), 0, 0.8);
  })();
  const vignette = new QuadMesh(vigMat);

  // ------------------------------------------------------------------ assets + world layout
  let meta: SkiMeta | null = null;
  const pivot = new Vector3(0, 0, -2.5);
  const feet = new Vector3(0, -1, -2.5);
  let skierH = 2;
  const groundY = (x: number, z: number) => (meta ? meta.ground[0] * x + meta.ground[1] * z + meta.ground[2] : -1);
  const ready = (async () => {
    meta = (await fetch(BASE + 'ski.json').then((r) => r.json())) as SkiMeta;
    const [a, b, c] = meta.ground;
    pivot.fromArray(meta.skier.centre);
    feet.fromArray(meta.skier.feet);
    skierH = meta.skier.head[1] - meta.skier.feet[1];
    uFeet.value.copy(feet);
    uZenith.value.copy(srgb(meta.sky_zenith, 0.72));
    uHorizon.value.copy(srgb(meta.sky_horizon, 0.86));
    uSnow.value.copy(srgb(meta.snow, 0.98));
    if (meta.snow_near) uSnowNear.value.copy(srgb(meta.snow_near, 1.0));
    if (meta.snow_shadow) uSnowShadow.value.copy(srgb(meta.snow_shadow, 1.0));
    background.copy(uHorizon.value).multiplyScalar(0.5);
    // ground plane: normal (−a, 1, −b), through (0, c, 0), a few cm below the splat's snow
    const nrm = new Vector3(-a, 1, -b).normalize();
    ground.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), nrm);
    ground.position.set(0, c - 0.04, 0);   // at the photo snow's surface: the feathered splat dissolves into it
    // pines: clustered bands beyond the capture, never inside the photo frustum (it has its own treeline)
    const tanH = Math.tan(((meta.hfov / 2 + 4) * Math.PI) / 180);
    const m4 = new Matrix4(), q = new Quaternion(), s3 = new Vector3(), p3 = new Vector3();
    const up = new Vector3(0, 1, 0);
    let k = 0, guard = 0;
    const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    while (k < PINES && guard++ < PINES * 40) {
      const r1 = rnd(guard), r2 = rnd(guard + 0.5), r3 = rnd(guard + 0.25), r4 = rnd(guard + 0.75);
      const z = -14 - Math.pow(r1, 0.8) * 190;
      const x = (r2 - 0.5) * 2 * (40 + (-z) * 1.1);
      const clump = Math.sin(x * 0.11) * Math.sin(z * 0.09 + 1.3) + Math.sin(x * 0.031 + z * 0.02) * 0.8;
      if (clump < 0.1 + r4 * 0.4) continue;
      if (Math.abs(x) < (-z) * tanH + 4) continue;                     // never inside the photo's frustum (it has its own treeline)
      if (z > -50 || (Math.abs(x) < 45 && z > -95)) continue;          // keep the near field / glide path clear
      const hgt = 5 + r3 * 7 + (-z) * 0.02;
      p3.set(x, groundY(x, z) - 0.3, z);
      q.setFromAxisAngle(up, r4 * 6.28);
      s3.set(hgt * (0.85 + r1 * 0.3), hgt, hgt * (0.85 + r2 * 0.3));
      pines.setMatrixAt(k++, m4.compose(p3, q, s3));
    }
    pines.count = k;
    pines.instanceMatrix.needsUpdate = true;
    // mountain ridge: a jagged strip at ~520 m spanning ±110° around −Z
    const SEG = 220, RR = 520;
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const th = ((i / SEG) * 2 - 1) * (110 * Math.PI) / 180;
      const x = Math.sin(th) * RR, z = -Math.cos(th) * RR;
      const n = Math.sin(i * 0.21) * 0.5 + Math.sin(i * 0.067 + 1.7) * 0.8 + Math.sin(i * 0.53) * 0.18;
      const top = 45 + n * 32 + Math.abs(Math.sin(i * 0.031)) * 40;
      const base = groundY(x * 0.25, z * 0.25) - 30;
      pos.push(x, base, z, x, base + top + 30, z);
      uvs.push(i / SEG, 0, i / SEG, 1);
      if (i < SEG) { const j = i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
    }
    const rg = ridge.geometry;
    rg.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    rg.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    rg.setIndex(idx);
    ridge.visible = true;
    await splat.ready;
  })();

  // ------------------------------------------------------------------ camera path
  const debug: { glide?: number; exit?: number; px?: number; py?: number; hide?: number } = {};
  let t = 0, revealClock = -1;
  const camPos = new Vector3(), look = new Vector3(), tmp = new Vector3(), past = new Vector3();
  function poseCamera(f: PortalFrame, exit: number) {
    // rest distance so the skier fills ~40% of the screen height
    const vfov = ctx.isPhone || f.camera.aspect < 1 ? 68 : 46;
    // ~0.34 here → ~40% on screen after the post's centre magnification (fish-eye + camcorder zoom ≈ 1.2×)
    const frac = ctx.isPhone || f.camera.aspect < 1 ? 0.25 : 0.34;   // phones: stronger fish-eye magnification
    const rest = skierH / (2 * frac * Math.tan((vfov * Math.PI) / 360));
    const g = debug.glide ?? (revealClock < 0 ? 0 : clamp01(revealClock / 8));
    const e = g * g * g * (g * (g * 6 - 15) + 10);   // smootherstep: very gentle start
    const px = debug.px ?? f.parallax.x, py = debug.py ?? f.parallax.y;
    // orbit (yaw around the skier): start −8° further back and a little higher → rest +3°, idle drift ±2.5°,
    // pointer ±6°. The splat is a 2.5D capture: stay near the photo's eye line so it never shows its seams.
    const drift = Math.sin((t * 2 * Math.PI) / 16) * 2.5;
    const yaw = ((-5 + 8 * e + drift * e + px * 6) * Math.PI) / 180;
    const R = rest * (1.35 - 0.35 * e);
    const lift = 0.2 * (1 - e) + 0.1 + py * 0.3 + Math.sin((t * 2 * Math.PI) / 11) * 0.05;
    camPos.set(pivot.x + Math.sin(yaw) * R, pivot.y + lift + 0.2, pivot.z + Math.cos(yaw) * R);
    // portrait screens: aim higher so the scene sits lower and the tagline has calm sky behind it
    const aimUp = f.camera.aspect < 1 ? 0.75 : 0;
    look.copy(pivot).add(tmp.set(0, 0.45 - 0.08 * (1 - e) + aimUp, 0));
    // exit: ski past him downhill (to his right, low), looking far down the slope
    if (exit > 0) {
      const x = inOutCubic(exit);
      past.set(pivot.x + 1.1, feet.y + 0.9, pivot.z - 9);
      camPos.lerp(past, x);
      look.lerp(tmp.set(pivot.x + 2, feet.y + 0.6, pivot.z - 40), Math.min(1, x * 1.3));
    }
    cam.position.copy(camPos);
    cam.lookAt(look);
    cam.fov = vfov + exit * 14;
    cam.aspect = f.camera.aspect;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  function update(f: PortalFrame) {
    const dt = Math.min(f.dt, 0.1);
    t += dt;
    uTime.value = t;
    const exit = debug.exit ?? clamp01(1 - f.focus);
    if (f.gateOpen && revealClock < 0) revealClock = 0;
    else if (revealClock >= 0) revealClock += dt;
    poseCamera(f, exit);
    uSnowBox.value.copy(cam.position).lerp(pivot, 0.55);
    uSpray.value = 0.35 + 0.65 * Math.max(0, Math.sin(t * 0.9)) ** 3;
    // exit: the photo layer dissolves while we ski past him (at grazing angles its flat splats would show);
    // the procedural slope + snow carry the motion into the compositor's zoom-dissolve
    splat.setOpacity(1 - Math.min(1, Math.max(0, (exit - 0.25) / 0.45)));
    splat.update(dt, cam, { x: 0, y: 0, inside: false });
    if (debug.hide !== undefined) { splat.object.visible = (debug.hide & 1) === 0; sky.visible = (debug.hide & 2) === 0; flakes.visible = (debug.hide & 4) === 0; }
  }

  function render(renderer: WebGPURenderer, camera: PerspectiveCamera, rt: RenderTarget) {
    // honour the overscan the compositor/app put on the stage camera (its fov is the 110° base widened for the
    // fish-eye): widen our own camera by the same factor, so the post's fish-eye maps it back to the intended framing
    const ov = Math.max(1, Math.tan((camera.fov * Math.PI) / 360) / Math.tan((110 * Math.PI) / 360));
    const fov0 = cam.fov, asp0 = cam.aspect;
    cam.fov = (2 * Math.atan(Math.tan((fov0 * Math.PI) / 360) * ov) * 180) / Math.PI;
    cam.aspect = camera.aspect;
    cam.updateProjectionMatrix();
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    cam.fov = fov0; cam.aspect = asp0; cam.updateProjectionMatrix();
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    vignette.render(renderer);
    renderer.autoClear = ac;
  }

  const portal: Portal & { debug: typeof debug } = {
    debug, scene, background, ready, update, render,
    dispose() {
      splat.dispose();
      for (const o of [sky, ground, ridge]) o.geometry.dispose();
      pines.geometry.dispose();
      skyMat.dispose(); groundMat.dispose(); pineMat.dispose(); ridgeMat.dispose(); flakeMat.dispose(); sprayMat.dispose(); vigMat.dispose();
    },
  };
  return portal;
}
