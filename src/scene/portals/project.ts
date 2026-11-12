// Project portals (tiles 1..4): slide strip + room / star sky behind it. spec-3d §6.1–6.2, spec-dom §5.2.
import {
  Scene, Color, Group, Mesh, InstancedMesh, PlaneGeometry, SphereGeometry, MeshBasicNodeMaterial, CanvasTexture,
  SRGBColorSpace, BackSide, DoubleSide, Matrix4, Vector3, Quaternion, Box3, BufferGeometry, LinearMipmapLinearFilter,
  InstancedBufferAttribute, DataTexture,
} from 'three/webgpu';
import {
  Fn, texture, uv, uniform, vec2, vec3, vec4, float, color, positionLocal, normalize, floor, fract, dot, sin, abs,
  mix, smoothstep, length, fwidth, max, pow, hash, mx_fractal_noise_float, vertexColor, luminance, fog,
  rangeFogFactor, instancedBufferAttribute, select,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Portal, PortalContext, PortalFrame } from '../types';
import { PORTAL_W, PORTAL_H } from '../types';
import type { Project } from '../../lib/content';
import { $route } from '../../lib/stores';
import { buildSlideAtlas } from './project-slides';

// ------------------------------------------------------------------ constants (spec §6.1)
const SW = (504 / 191) * 0.85; // slide width  2.2429
const SH = (300 / 191) * 0.85; // slide height 1.3351
const GAP = 74 / 191;
const SNAP_MS = 800;
const FOLLOW = 20;
const LOCK_PX = 6;
const ADVANCE_V = 0.0015; // |velocity px/ms| / slidePx

type RoomCfg = { url: string; darkness: number; saturation: number; tint: string; exposure: number; contrast: number };
// per project index (content.ts order): null = procedural star sky
//   0 Öge: warm gallery ("the desk")      1 Ferman: dark studio corridor, gold-tinted
//   2 Cached Network Image CE: star sky    3 Elek: studio corridor with a lime cast
//   4 Subara: lavender gallery
const ROOMS: (RoomCfg | null)[] = [
  { url: '/models/gallery-tile.glb', darkness: 0.5, saturation: 0.55, tint: '#ffdcc2', exposure: 0.72, contrast: 3.2 },
  { url: '/models/studio-corridor.glb', darkness: 0.3, saturation: 1, tint: '#ffe4b0', exposure: 1, contrast: 1.7 },
  null,
  { url: '/models/studio-corridor.glb', darkness: 0.25, saturation: 1, tint: '#e2ffa8', exposure: 1.05, contrast: 1.6 },
  { url: '/models/gallery-tile.glb', darkness: 0.55, saturation: 0.6, tint: '#d4c8ff', exposure: 0.7, contrast: 3 },
];
const BACKGROUNDS = ['#000000', '#000000', '#010209', '#000000', '#000000'];

const outCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mod = (a: number, n: number) => ((a % n) + n) % n;

// ------------------------------------------------------------------ shared room geometry cache
const roomCache = new Map<string, Promise<BufferGeometry>>();
function loadRoom(url: string): Promise<BufferGeometry> {
  let p = roomCache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((gltf) => {
      let geo: BufferGeometry | null = null;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o: any) => {
        if (!geo && o.isMesh) geo = (o.geometry as BufferGeometry).clone().applyMatrix4(o.matrixWorld);
      });
      if (!geo) throw new Error('room: no mesh in ' + url);
      return geo;
    });
    roomCache.set(url, p);
  }
  return p;
}

// ------------------------------------------------------------------ star sky (spec §6.2)
function starSkyMaterial(uTime: any) {
  const m = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  m.fog = false;
  m.colorNode = Fn(() => {
    // slightly rotated basis so the grid isn't axis aligned
    const p = normalize(positionLocal);
    const d = vec3(p.x.mul(0.94).add(p.z.mul(0.34)), p.y, p.z.mul(0.94).sub(p.x.mul(0.34))).normalize();
    const g = d.mul(32);
    const cell = floor(g);
    const seed = dot(cell.add(64), vec3(1, 128, 16384)).mul(8);
    const h = (k: number) => hash(seed.add(k));
    const jitter = vec3(h(0), h(1), h(2)).mul(1 - 0.42).add(0.21);
    const centre = cell.add(jitter);
    const v = centre.sub(g);
    const proj = v.sub(d.mul(dot(v, d)));
    const dist = length(proj);
    const hs = h(3);
    const present = hs.lessThan(0.32);
    const size = mix(0.02, 0.065, pow(float(1).sub(hs.div(0.32)).max(0), 4));
    // pixel footprint from the continuous grid coordinate (fwidth(dist) jumps at cell borders → streaks)
    const aa = length(fwidth(g)).mul(0.6).max(1e-4);
    const star = float(1).sub(smoothstep(size.sub(aa), size.add(aa), dist)).mul(select(present, float(1), float(0)));
    const h5 = h(5), h6 = h(6);
    const tw = sin(uTime.mul(mix(0.5, 1.2, h5)).add(h6.mul(40))).mul(0.35).add(0.65);
    const twinkle = select(h(7).lessThan(0.3), tw, float(1));
    const tint = mix(vec3(0.72, 0.83, 1), vec3(1), h(4));
    const neb = smoothstep(-0.05, 0.6, mx_fractal_noise_float(d.mul(1.4).add(vec3(3.1, 7.7, 1.3)), 2, 2, 0.5));
    const band = float(1).sub(smoothstep(0, 0.55, abs(dot(d, vec3(0.42, 0.86, 0.28).normalize()))));
    const sky = mix(color('#010209'), color('#071433'), smoothstep(-0.75, 0.9, d.y))
      .add(color('#1b44a6').mul(neb.mul(0.22).add(band.mul(neb.mul(0.6).add(0.4)).mul(0.14))));
    return sky.add(tint.mul(star).mul(twinkle).mul(1.6));
  })();
  return m;
}

// ------------------------------------------------------------------ portal
export function createProjectPortal(ctx: PortalContext, project: Project, index: number): Portal {
  const scene = new Scene();
  const background = new Color(BACKGROUNDS[index] ?? '#000000');
  const content = new Group(); // orbit parallax + openness push
  scene.add(content);

  const n = project.slides;
  const m = n * 2; // virtual instances so wrapping never pops in view
  const uTime = uniform(0);

  // ---- strip (one instanced draw call)
  const rectArray = new Float32Array(m * 4);
  const rectAttr = new InstancedBufferAttribute(rectArray, 4);
  const stripMat = new MeshBasicNodeMaterial();
  stripMat.fog = false;
  stripMat.toneMapped = false;
  const placeholder = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  placeholder.needsUpdate = true;
  const uAtlas = texture(placeholder);
  const rect = instancedBufferAttribute(rectAttr, 'vec4') as any;
  const dimArray = new Float32Array(m);
  const dimAttr = new InstancedBufferAttribute(dimArray, 1);
  const dim = instancedBufferAttribute(dimAttr, 'float') as any;
  stripMat.colorNode = uAtlas.sample(uv().mul(rect.zw).add(rect.xy)).rgb.mul(dim);
  const strip = new InstancedMesh(new PlaneGeometry(SW, SH), stripMat, m);
  strip.frustumCulled = false;
  strip.name = 'strip';
  content.add(strip);

  // ---- room / sky
  const roomCfg = index < ROOMS.length ? ROOMS[index] : null; // extra projects fall back to the star sky
  const room = new Group();
  content.add(room);
  if (!roomCfg) {
    const sky = new Mesh(new SphereGeometry(100, 48, 24), starSkyMaterial(uTime));
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    room.add(sky);
  }

  const ready = (async () => {
    const atlas = await buildSlideAtlas(project);
    const tex = new CanvasTexture(atlas.canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    tex.minFilter = LinearMipmapLinearFilter;
    uAtlas.value = tex;
    for (let j = 0; j < m; j++) rectArray.set(atlas.rects[j % n], j * 4);
    rectAttr.needsUpdate = true;
    atlas.thumbs.forEach((src, s) => {
      document.querySelectorAll<HTMLImageElement>(`img[data-thumb-img="${project.id}:${s}"]`).forEach((img) => (img.src = src));
    });
    if (roomCfg) await buildRoom(roomCfg);
  })();

  async function buildRoom(cfg: RoomCfg) {
    const geo = await loadRoom(cfg.url);
    const box = new Box3().setFromBufferAttribute(geo.getAttribute('position') as any);
    const size = box.getSize(new Vector3());
    const k = (PORTAL_W * 5) / size.x;
    const L = size.z * k;
    const mat = new MeshBasicNodeMaterial({ side: DoubleSide });
    const uDark = uniform(cfg.darkness), uSat = uniform(cfg.saturation);
    // baked vertex light, with a contrast curve so the rooms read moody rather than flat grey
    const base = pow(vertexColor(0).rgb, vec3(cfg.contrast)).mul(cfg.exposure).mul(color(cfg.tint));
    const l = luminance(base);
    const c = base.mul(float(1).sub(uDark.mul(0.6))).mul(float(1).sub(smoothstep(0.2, 1, l).mul(0.6)));
    mat.colorNode = mix(vec3(luminance(c)), c, uSat);
    // 8 tiles along −z, alternately mirrored (z flipped about the tile), black range fog 1 → 8 spacings
    const inst = new InstancedMesh(geo, mat, 8);
    inst.frustumCulled = false;
    const z0 = 3; // front edge, content-local (the camera sits inside the first tile when open)
    const mtx = new Matrix4(), q = new Quaternion(), sc = new Vector3(), pos = new Vector3();
    for (let i = 0; i < 8; i++) {
      const mirrored = i % 2 === 1;
      sc.set(k, k, mirrored ? -k : k);
      const zEdge = z0 - i * L;
      pos.set(-(box.min.x + size.x / 2) * k, -2.35 - box.min.y * k, mirrored ? zEdge + box.min.z * k : zEdge - L - box.min.z * k);
      inst.setMatrixAt(i, mtx.compose(pos, q, sc));
    }
    inst.instanceMatrix.needsUpdate = true;
    room.add(inst);
    scene.fogNode = fog(color(0x000000), rangeFogFactor(L, L * 8));
  }

  // ---- slide state (drag / snap / external changes)
  let offset = 0;
  let follow = 0; // drag follow target
  let tween: { from: number; to: number; t: number } | null = null;
  let lastSlide = 0;
  let wasDown = false;
  let dragging = false;
  let lock: 'none' | 'x' | 'y' = 'none';
  let startX = 0, startY = 0, startOffset = 0, prevX = 0, vel = 0, lastMoveT = 0;
  let slidePx = 400;
  const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpS = new Vector3(), tmpP = new Vector3();

  function goTo(dest: number) {
    tween = { from: offset, to: dest, t: 0 };
    const s = mod(Math.round(dest), n);
    lastSlide = s;
    if ($route.get().route === `project-${index}` && $route.get().slide !== s) $route.setKey('slide', s);
  }

  function updateDrag(f: PortalFrame) {
    const el = ctx.renderer.domElement;
    const W = el.clientWidth || innerWidth, H = el.clientHeight || innerHeight;
    const px = f.pointer.x * W * 0.5, py = -f.pointer.y * H * 0.5;
    const canDrag = f.inside && f.openness > 0.9;
    const down = f.pointer.down;
    if (down && !wasDown && canDrag) {
      dragging = true;
      lock = 'none';
      startX = prevX = px;
      startY = py;
      startOffset = offset;
      follow = offset;
      vel = 0;
      lastMoveT = f.time;
    }
    if (dragging && down) {
      if (lock === 'none' && Math.hypot(px - startX, py - startY) > LOCK_PX) lock = Math.abs(px - startX) > Math.abs(py - startY) ? 'x' : 'y';
      if (lock === 'x') {
        tween = null;
        follow = startOffset - (px - startX) / slidePx;
      }
      // velocity from actual pointer moves (frames can outpace pointer events on high-refresh screens)
      if (px !== prevX) {
        const dtMs = Math.max((f.time - lastMoveT) * 1000, 4);
        vel += ((px - prevX) / dtMs - vel) * 0.5;
        lastMoveT = f.time;
        prevX = px;
      }
    }
    if (dragging && (!down || !canDrag)) {
      dragging = false;
      if (lock === 'x') {
        const v = f.time - lastMoveT > 0.1 ? 0 : vel / slidePx; // pointer held still before release → no fling
        let dest = Math.round(offset);
        if (Math.abs(v) > ADVANCE_V) dest = v < 0 ? Math.floor(offset) + 1 : Math.ceil(offset) - 1;
        goTo(dest);
      }
      lock = 'none';
    }
    wasDown = down;

    // external slide change (thumbs, keys, click halves, leaving the project → 0)
    if (!dragging && f.slide !== lastSlide) {
      const cur = Math.round(tween ? tween.to : offset);
      let d = mod(f.slide - mod(cur, n), n);
      if (d > n / 2) d -= n;
      lastSlide = f.slide;
      tween = { from: offset, to: cur + d, t: 0 };
    }

    if (dragging && lock === 'x') offset += (follow - offset) * (1 - Math.exp(-FOLLOW * f.dt));
    else if (tween) {
      tween.t += (f.dt * 1000) / SNAP_MS;
      offset = tween.from + (tween.to - tween.from) * outCubic(clamp(tween.t));
      if (tween.t >= 1) {
        offset = tween.to;
        tween = null;
        offset = mod(offset, n); // keep the number small; positions are periodic in n
      }
    }
  }

  function layoutStrip(f: PortalFrame) {
    const o = clamp(f.openness);
    const e = smooth(o);
    const cam = f.camera;
    const D = Math.max(cam.position.z, 0.05); // camera distance to the portal plane
    const depth = o * 1 + 0.02 * e; // strip depth behind the plane (content pushed back by openness)
    const t = Math.tan((cam.fov * Math.PI) / 360);
    // apparent (plane-space) scale of one slide: cover-fit the window on the carousel …
    const s0 = Math.max(PORTAL_W / SW, PORTAL_H / SH) * 1.02;
    // … and fill the view when inside: contain-fit into the visible view, then shrink so the neighbours
    // and the room show around it (desktop .6, phone .92 of the fit; the app's CRT bulge + tape zoom magnify ~15%).
    const visW = 2 * D * t * cam.aspect, visH = 2 * D * t;
    const fit = Math.min(visW / SW, visH / SH);
    const s1 = fit * (f.isPhone ? 0.92 : 0.6);
    const sp = s0 + (s1 - s0) * e;
    const ws = (sp * (D + depth)) / D; // world scale at the strip depth
    const pitch = (SW + GAP) * ws;
    slidePx = (pitch / ((D + depth) * 2 * t * cam.aspect)) * (ctx.renderer.domElement.clientWidth || innerWidth);
    // lift the strip a little while inside so the project panel (top 71.5%) sits under the slide
    strip.position.set(0, (f.isPhone ? 0 : 0.09) * visH * e * ((D + depth) / D), -0.02 * e); // rests on the window plane while on the carousel
    for (let j = 0; j < m; j++) {
      const kx = mod(j - offset + m / 2, m) - m / 2;
      const x = kx * pitch;
      tmpP.set(x, 0, -Math.abs(x) * 0.005);
      tmpS.set(ws, ws, 1);
      strip.setMatrixAt(j, tmpM.compose(tmpP, tmpQ, tmpS));
      // neighbours a touch darker while inside (focus on the centre slide)
      dimArray[j] = 1 - 0.28 * e * clamp(Math.abs(kx));
    }
    strip.instanceMatrix.needsUpdate = true;
    dimAttr.needsUpdate = true;
  }

  return {
    scene,
    background,
    ready,
    update(f) {
      uTime.value = f.time;
      updateDrag(f);
      const o = clamp(f.openness);
      content.position.z = -o;
      // orbit parallax (spec §3): weight .65 scaled by open progress
      const d = o * 0.65;
      content.rotation.x = -f.parallax.y * 0.1 * d;
      content.rotation.y = -f.parallax.x * 0.1 * d;
      room.visible = o > 0.001;
      layoutStrip(f);
    },
    dispose() {
      strip.geometry.dispose();
      stripMat.dispose();
      (uAtlas.value as any)?.dispose?.();
    },
  };
}
