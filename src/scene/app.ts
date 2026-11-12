import {
  WebGPURenderer, PerspectiveCamera, Scene, Group, Mesh, PlaneGeometry, MeshBasicNodeMaterial, RenderTarget,
  Color, Vector2, Vector3, Matrix4, Raycaster, AmbientLight, DirectionalLight, HalfFloatType, RenderPipeline,
} from 'three/webgpu';
import { texture, screenUV, uniform, mix, color, pass, vec4 } from 'three/tsl';
import { $route, $preloader, scroll, tilt, overlays, pointer as sharedPointer, type Route } from '../lib/stores';
import {
  STEP, LAST_INDEX, TILE_COUNT, SCENE_START, PROJECT_COUNT, carouselIndex, sceneProgress, invLerp, clamp, damp, smoothstep,
} from '../lib/timeline';
import { PORTAL_H, PORTAL_W, type Portal, type PortalFrame, type PortalContext } from './types';
import { fishEye, fishEyeCPU, fishEyeInverseCPU, overscanScale } from './post/fisheye';
import { createPortals } from './portals';
import { createPostChain } from './post';
import { createTerminal } from './terminal';

type Hooks = {
  onProgress: (p: number) => void;
  openProject: (i: number) => void;
  scrollToVp: (vp: number, eased?: boolean) => void;
  setRoute: (r: Route, o: 'hidden' | 'shown' | 'leaving') => void;
};

const FOV = 110;

export async function createApp(container: HTMLElement, hooks: Hooks) {
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  const renderer = new WebGPURenderer({ antialias: false, forceWebGL });
  await renderer.init();
  container.appendChild(renderer.domElement);
  const isPhoneNow = () => scroll.isPhone || matchMedia('(max-width: 47.99rem), (max-aspect-ratio: 4/3)').matches;
  const quality: 'high' | 'medium' = (navigator as any).deviceMemory <= 4 || (renderer.backend as any).isWebGLBackend ? 'medium' : 'high';
  const ctx: PortalContext = { renderer, isPhone: isPhoneNow(), quality };

  // ------------------------------------------------------------- cameras
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 1000);
  const passCamera = new PerspectiveCamera(FOV, 1, 0.1, 1000); // overscanned proxy used for every pass
  const innerCamera = new PerspectiveCamera(FOV, 1, 0.01, 1000);

  // ------------------------------------------------------------- main scene
  const scene = new Scene();
  scene.backgroundNode = mix(color(0xffffff), color(0xd2d2d2), screenUV.y);
  scene.add(new AmbientLight(0xffffff, 1.2));
  const sun = new DirectionalLight(0xffffff, 2.5);
  sun.position.set(3, 6, 6);
  scene.add(sun);

  const carousel = new Group();
  scene.add(carousel);
  const terminal = createTerminal();
  scene.add(terminal.mesh);

  const portals: Portal[] = createPortals(ctx);
  const size = new Vector2();
  const planeGeo = new PlaneGeometry(PORTAL_W, PORTAL_H);

  type Tile = {
    i: number;
    group: Group;
    frame: Group; // moves toward the camera when opening
    plane: Mesh;
    rt: RenderTarget;
    portal: Portal;
    openness: number;
    visible: boolean;
  };
  const tiles: Tile[] = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    const group = new Group();
    group.position.set(3 * Math.sin(i * STEP), 0, 3 * Math.cos(i * STEP));
    group.rotation.y = i * STEP;
    const frame = new Group();
    group.add(frame);
    const rt = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true });
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = texture(rt.texture, screenUV);
    mat.toneMapped = false;
    const plane = new Mesh(planeGeo, mat);
    plane.userData.tile = i;
    frame.add(plane);
    carousel.add(group);
    tiles.push({ i, group, frame, plane, rt, portal: portals[i], openness: i === 0 ? 1 : 0, visible: true });
  }

  // ------------------------------------------------------------- post
  const uFish = uniform(0.1);
  const uOverscan = uniform(1);
  const scenePass = pass(scene, passCamera);
  const post = createPostChain({ renderer, scenePass, uFish, uOverscan, fishEye });
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = post.output;

  // ------------------------------------------------------------- input
  const ndc = { x: 0, y: 0, inside: false, down: false };
  let pressX = 0, pressY = 0, moved = false;
  const canvas = renderer.domElement;
  const toNdc = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = 1 - (e.clientY - r.top) / r.height;
    // screen → pass uv through the fish-eye → pass NDC
    const [su, sv] = post.toSource(u, v);
    const [pu, pv] = fishEyeCPU(su, sv, uFish.value, size.x / size.y, uOverscan.value);
    ndc.x = pu * 2 - 1;
    ndc.y = pv * 2 - 1;
    ndc.inside = true;
    sharedPointer.x = (u * 2 - 1);
    sharedPointer.y = (v * 2 - 1);
    sharedPointer.inside = true;
  };
  // pointer events come from the overlay layer above the canvas too, so listen on the stage
  const stage = container.closest('[data-stage]') as HTMLElement;
  stage.addEventListener('pointermove', (e) => {
    toNdc(e);
    if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > 6) moved = true;
  });
  stage.addEventListener('pointerleave', () => { ndc.inside = false; sharedPointer.inside = false; });
  stage.addEventListener('pointerdown', (e) => { toNdc(e); ndc.down = true; pressX = e.clientX; pressY = e.clientY; moved = false; });
  stage.addEventListener('pointerup', (e) => {
    ndc.down = false;
    if (moved) return;
    if ((e.target as Element).closest('a, button')) return;
    toNdc(e);
    handleClick();
  });

  const raycaster = new Raycaster();
  let hovered = -1;
  function pick(): number {
    raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), passCamera);
    const hits = raycaster.intersectObjects(tiles.filter((t) => t.visible).map((t) => t.plane), false);
    return hits.length ? (hits[0].object.userData.tile as number) : -1;
  }
  function handleClick() {
    const { route } = $route.get();
    if (route?.startsWith('project')) {
      const p = Number(route.split('-')[1]);
      if (tiles[p + 1].portal.onClick?.(ndc.x, ndc.y)) return;
      // left/right half → prev/next slide
      const n = document.querySelectorAll(`[data-project-panel="${p}"] [data-thumb]`).length;
      const s = $route.get().slide;
      $route.setKey('slide', ndc.x > 0 ? (s + 1) % n : (s - 1 + n) % n);
      return;
    }
    const hit = pick();
    if (hit < 0) return;
    const idx = carouselIndex(scroll.vp);
    if (hit === 0 || hit === LAST_INDEX) {
      hooks.scrollToVp(hit === 0 ? 0 : SCENE_START, true);
    } else if (Math.abs(idx - hit) < 0.25) {
      hooks.openProject(hit - 1);
    } else {
      hooks.scrollToVp(hit, true);
    }
  }

  // ------------------------------------------------------------- resize
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    ctx.isPhone = isPhoneNow();
    const dpr = Math.min(devicePixelRatio, 2);
    const cap = ctx.isPhone ? (quality === 'high' ? 1.5 : 1.2) : quality === 'high' ? 1.6 : 1;
    renderer.setPixelRatio(Math.min(dpr, cap));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.set(0, 0, ctx.isPhone ? 5 : 4);
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(size);
    for (const t of tiles) t.rt.setSize(size.x, size.y);
    post.setSize(size.x, size.y);
  }
  resize();

  // ------------------------------------------------------------- loading
  let loaded = 0;
  await Promise.all(portals.map((p) => p.ready.then(() => hooks.onProgress(++loaded / portals.length)).catch((e) => console.warn(e))));

  // warm-up: compile everything once with every portal visible
  try {
    for (const t of tiles) await renderer.compileAsync(t.portal.scene, innerCamera);
    await renderer.compileAsync(scene, camera);
  } catch (e) { console.warn('compile warmup', e); }

  // ------------------------------------------------------------- frame
  const tmpM = new Matrix4();
  const corner = new Vector3();
  const fishTarget = { v: 0.1 };
  const parallax = { x: 0, y: 0 };
  let insideProject = -1;

  function updatePassCamera() {
    const s = uOverscan.value;
    passCamera.position.copy(camera.position);
    passCamera.quaternion.copy(camera.quaternion);
    passCamera.fov = (2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * s) * 180) / Math.PI;
    passCamera.aspect = camera.aspect / s;
    passCamera.updateProjectionMatrix();
    passCamera.updateMatrixWorld();
  }

  function coverDepth() {
    const t = Math.tan((passCamera.fov * Math.PI) / 360);
    return Math.min(PORTAL_H / (2 * t), PORTAL_W / (2 * t * passCamera.aspect));
  }

  function frame(dt: number, time: number) {
    const isPhone = (ctx.isPhone = scroll.isPhone);
    const vp = scroll.vp;
    const idx = carouselIndex(vp);
    const { route, slide } = $route.get();
    const gateOpen = $preloader.get().isGateOpen;
    insideProject = route?.startsWith('project') ? Number(route.split('-')[1]) : -1;

    // carousel transform
    const rot = idx * STEP;
    const lift = isPhone ? 2 : 1.7;
    carousel.rotation.y = -rot;
    carousel.position.y = idx * lift;
    // measured against reference captures: desktop .80, phone portrait 1.0 (tiles overflow the width)
    const tileScale = isPhone ? 1 : clamp(0.4497 * camera.aspect, 0.8019, 1);

    // parallax input
    const k = damp(5, dt);
    const inX = tilt.active ? tilt.x : sharedPointer.x;
    const inY = tilt.active ? tilt.y : sharedPointer.y;
    parallax.x += (inX - parallax.x) * k;
    parallax.y += (inY - parallax.y) * k;

    // fish-eye: .1 desktop / .2 phone / 0 inside a project or deep in the last scene
    const lastOpen = tiles[LAST_INDEX].openness;
    fishTarget.v = insideProject >= 0 ? 0 : (isPhone ? 0.2 : 0.1) * (1 - smoothstep(0.85, 1, lastOpen));
    uFish.value += (fishTarget.v - uFish.value) * damp(2.5, dt);
    uOverscan.value = overscanScale(camera.aspect, uFish.value);
    updatePassCamera();
    const cover = coverDepth();
    const restDist = camera.position.z - 3;

    for (const t of tiles) {
      // openness target
      let target = 0;
      if (t.i === 0) target = 1 - smoothstep(0.45, 0.95, idx);
      else if (t.i === LAST_INDEX) target = invLerp(LAST_INDEX - 0.4, LAST_INDEX - 0.03, idx);
      else target = insideProject === t.i - 1 ? 1 : 0;
      const boundary = t.i === 0 || t.i === LAST_INDEX;
      t.openness += (target - t.openness) * damp(boundary ? 8 : 5.66, dt);
      if (Math.abs(target - t.openness) < 1e-4) t.openness = target;
      const o = t.openness;

      t.group.position.y = -t.i * lift;
      const s = boundary || o > 0 ? 1 : tileScale;
      t.group.scale.setScalar(s + (1 - s) * o);
      // push the frame toward the camera until it covers the view (+ a bit for the bulge)
      const push = clamp(o) * 0.12 + smoothstep(0.6, 1, o) * 0.08;
      const targetDist = cover * (1 - push);
      const ease = o * o * (3 - 2 * o);
      t.frame.position.z = (restDist - targetDist) * ease;
      // straighten tile so it faces the camera head-on when open
      t.frame.rotation.y = 0;
    }
    carousel.updateMatrixWorld(true);

    // hide other tiles while a portal is fully open
    const anyOpen = tiles.find((t) => t.openness > 0.98);
    for (const t of tiles) {
      t.visible = !anyOpen || anyOpen === t;
      t.plane.visible = t.visible;
    }

    // terminal billboard near the carousel
    terminal.update(dt, idx, passCamera, anyOpen ? 0 : 1);

    // ---- render portals into their targets
    for (const t of tiles) {
      const portalVisible = t.visible && isOnScreen(t);
      const inner = innerCamera;
      // inner camera = main camera expressed in the portal plane's frame
      tmpM.copy(t.plane.matrixWorld).invert().multiply(passCamera.matrixWorld);
      inner.matrixWorld.copy(tmpM);
      inner.matrixWorld.decompose(inner.position, inner.quaternion, inner.scale);
      inner.projectionMatrix.copy(passCamera.projectionMatrix);
      inner.projectionMatrixInverse.copy(passCamera.projectionMatrixInverse);
      inner.fov = passCamera.fov;
      inner.aspect = passCamera.aspect;
      inner.matrixWorldInverse.copy(inner.matrixWorld).invert();

      const focus = 1 - clamp(Math.abs(idx - t.i));
      const f: PortalFrame = {
        dt, time, openness: t.openness, focus, camera: inner,
        pointer: ndc, parallax, vp, sceneT: sceneProgress(vp), isPhone, gateOpen,
        slide: insideProject === t.i - 1 ? slide : 0, inside: insideProject === t.i - 1,
      };
      t.portal.update(f);
      if (!portalVisible) continue;
      renderer.setRenderTarget(t.rt);
      renderer.setClearColor(t.portal.background, 1);
      if (t.portal.render) t.portal.render(renderer, inner, t.rt);
      else {
        renderer.clear();
        renderer.render(t.portal.scene, inner);
      }
    }
    renderer.setRenderTarget(null);

    // ---- route from scroll
    if (gateOpen && insideProject < 0) {
      const o0 = tiles[0].openness, o5 = tiles[LAST_INDEX].openness;
      if (o0 > 0.85) hooks.setRoute('intro', o0 >= 0.9 ? 'shown' : 'leaving');
      else if (o5 > 0.85) hooks.setRoute('last', o5 >= 0.9 ? 'shown' : 'leaving');
      else hooks.setRoute(null, 'hidden');
    }
    if (insideProject >= 0) {
      const t = tiles[insideProject + 1];
      if (t.openness > 0.82 && !$route.get().entered) $route.setKey('entered', true);
    }
    // header on white: when the carousel background is visible behind the header
    const onWhite = !anyOpen && tiles[0].openness < 0.5 && tiles[LAST_INDEX].openness < 0.5;
    if ($route.get().isHeaderOnWhite !== onWhite) $route.setKey('isHeaderOnWhite', onWhite);
    document.querySelector('[data-header]')?.toggleAttribute('data-on-white', onWhite);

    // ---- hover + labels
    hovered = ndc.inside && !anyOpen ? pick() : -1;
    overlays.hoveredIndex = hovered > 0 && hovered < LAST_INDEX ? hovered - 1 : -1;
    overlays.boundaryClickable = hovered === 0 || hovered === LAST_INDEX;
    updateLabels(idx);

    post.update(dt, time, { isHome: true, isPhone, inside: insideProject >= 0, idx, sceneT: sceneProgress(vp), lastOpen });
    pipeline.render();
  }

  function isOnScreen(t: Tile) {
    // cheap test: project tile centre; generous margin
    corner.setFromMatrixPosition(t.plane.matrixWorld).project(passCamera);
    return t.openness > 0.01 || (Math.abs(corner.x) < 2.2 && Math.abs(corner.y) < 2.2 && corner.z < 1);
  }

  // labels: place each project's DOM label on its tile centre (through the fish-eye)
  function updateLabels(idx: number) {
    const w = container.clientWidth, h = container.clientHeight;
    for (let p = 0; p < PROJECT_COUNT; p++) {
      const t = tiles[p + 1];
      const hidden = !t.visible || Math.abs(idx - t.i) > 0.6 || insideProject >= 0 || !$preloader.get().isGateOpen;
      overlays.labelHidden[p] = hidden;
      if (hidden) continue;
      corner.set(0, -PORTAL_H * 0.5 - 0.12, 0).applyMatrix4(t.plane.matrixWorld).project(passCamera);
      const [u, v] = post.fromSource(...fishEyeInverseCPU(corner.x * 0.5 + 0.5, corner.y * 0.5 + 0.5, uFish.value, size.x / size.y, uOverscan.value));
      const x = (u - 0.5) * w, y = (0.5 - v) * h;
      const sc = clamp(1 - Math.abs(idx - t.i) * 0.5, 0.5, 1);
      const m = overlays.labelMatrices;
      m.fill(0, p * 16, p * 16 + 16);
      m[p * 16 + 0] = sc; m[p * 16 + 5] = sc; m[p * 16 + 10] = 1; m[p * 16 + 15] = 1;
      m[p * 16 + 12] = x; m[p * 16 + 13] = y;
    }
  }

  // expose for debugging
  (window as any).__scene = { renderer, scene, tiles, camera, passCamera, uFish, post };

  return { frame, resize };
}
