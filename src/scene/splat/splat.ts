/**
 * Gaussian-splat renderer (spec-3d §8.1, §8.2) — TSL, runs on WebGPU and on the WebGL2 fallback.
 *
 * Data layout (WebGL2-friendly, no storage buffers): four nearest-filtered DataTextures
 *   centre  RGBA32F (x, y, z, 1)
 *   covA    RGBA32F (σ00, σ01, σ02, σ11)   object-space 3×3 covariance, upper triangle
 *   covB    RGBA32F (σ12, σ22, 0, 0)
 *   colour  RGBA8   (sRGB rgb, opacity)
 * plus one per-instance float attribute `order` (splat index, back to front) rewritten after each sort.
 *
 * Loading, parsing and sorting run in a Web Worker (splat.worker.ts), so a background load never blocks the
 * main thread. Sorting: counting sort (65536 depth bins) over the splats inside a guard band around the view
 * frustum (the same test the vertex shader uses to drop splats, so culling only saves work), triggered only
 * when the view changes (direction dot < .9995, camera moved > 2 cm in object units, or the projection changed).
 * instanceCount = number of splats that survived culling.
 *
 * Hover (§8.2): the WebGPU compute physics is replaced by the documented cheap fallback on all backends:
 * a vertex-shader push of splat centres away from the pointer ray, with a damped strength (rate 2.5) that is
 * active for a few seconds after the pointer last moved, plus a small curl-ish swirl and the
 * `rgb·(1+speed)^(1/2.4)` brightening.
 *
 * Input files: standard 32-byte `.splat` (pos f32×3, scale f32×3, rgba u8×4, quat u8×4 w-first, q·128+128) or the
 * compact 16-byte `.csplat` (tools/splat/compact.mjs). The format is detected from the file's magic bytes.
 * `cap` limits the splat count (a prefix of the file: importance-sorted .csplat drops the smallest/faintest
 * splats first; shuffled files are subsampled uniformly with a size compensation).
 */
import {
  Mesh, InstancedBufferGeometry, BufferAttribute, InstancedBufferAttribute, DataTexture, FloatType, RGBAFormat,
  UnsignedByteType, NearestFilter, MeshBasicNodeMaterial, Vector3, Matrix4, DoubleSide, NormalBlending,
  type Object3D, type PerspectiveCamera, type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, If, Discard, instancedBufferAttribute, textureLoad, ivec2, int, float, vec2, vec3, vec4, uniform,
  varyingProperty, positionGeometry, modelViewMatrix, cameraProjectionMatrix, screenSize, dot, sqrt, max, min,
  atan, cos, sin, exp, smoothstep, length, floor, pow, mix, step, select, abs, time,
} from 'three/tsl';

export interface SplatPointer { x: number; y: number; inside: boolean }
export interface SplatHandle {
  object: Object3D;
  ready: Promise<void>;
  update(dt: number, camera: PerspectiveCamera, pointer: SplatPointer): void;
  setOpacity(v: number): void;
  dispose(): void;
  /** number of splats drawn */
  readonly count: number;
}

const TEX_W = 2048; // keep in sync with splat.worker.ts
/** default cap when none is given (phones) — the alley passes its own per-tier cap */
const PHONE_MAX = 220_000;

function dataTex(data: Float32Array | Uint8Array, rows: number, float: boolean) {
  const t = new DataTexture(data, TEX_W, rows, RGBAFormat, float ? FloatType : UnsignedByteType);
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

// ----------------------------------------------------------------------------------------------- create
export function createSplat({ renderer: _renderer, url, isPhone, cap }: {
  renderer: WebGPURenderer; url: string; isPhone: boolean;
  /** max splats to keep (prefix of the file). Default: all on desktop, 220k on phones. */
  cap?: number;
}): SplatHandle {
  // uniforms
  const uOpacity = uniform(1);
  const uRayO = uniform(new Vector3());
  const uRayD = uniform(new Vector3(0, 0, -1));
  const uRadPerDepth = uniform(0.42);
  const uPush = uniform(0);

  // geometry: one quad [-2,2]² instanced
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.instanceCount = 0;

  const mat = new MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.side = DoubleSide;
  // transparent + DoubleSide would otherwise be drawn twice (back faces, then front faces); every billboard has the
  // same winding, so one of those passes culls everything after running the full vertex shader for all splats
  mat.forceSinglePass = true;
  mat.blending = NormalBlending;
  mat.toneMapped = false;
  mat.fog = false;

  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = 'GaussianSplat';

  let count = 0;
  const textures: DataTexture[] = [];
  let orderAttr: InstancedBufferAttribute | null = null;
  let worker: Worker | null = null;
  let inFlight = false, dirty = true, sortId = 0, spare: Float32Array | null = null, firstDone = false;

  const lastCam = new Vector3(1e9, 0, 0), lastDir = new Vector3(0, 0, 0);
  let lastP0 = 0, lastP5 = 0;
  // initial order for the default hero view (origin looking down -Z, no lateral culling): w = −z
  const sortVP = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0]);
  const viewProj = new Matrix4();

  function buildMaterial(d: { centre: DataTexture; covA: DataTexture; covB: DataTexture; colour: DataTexture }) {
    const vColor = varyingProperty('vec4', 'vSplatColor');
    const vUv = varyingProperty('vec2', 'vSplatUv');
    const order = instancedBufferAttribute(orderAttr!, 'float') as any;

    mat.vertexNode = Fn(() => {
      const fy = floor(order.add(0.5).div(TEX_W));
      const fx = order.sub(fy.mul(TEX_W));
      const tc = ivec2(int(fx), int(fy));
      const c = textureLoad(d.centre, tc).xyz.toVar();
      const ca = textureLoad(d.covA, tc);
      const cb = textureLoad(d.covB, tc);
      const col = textureLoad(d.colour, tc);

      // ---- hover push (object space): splats near the pointer ray are pushed away from it
      const e = c.sub(uRayO);
      const along = dot(e, uRayD);
      const perp = e.sub(uRayD.mul(along));
      const dist = length(perp);
      const R = max(along.mul(uRadPerDepth), 1e-4);
      const infl = select(along.greaterThan(0), float(1).sub(smoothstep(0, R, dist)), float(0)).mul(uPush).toVar();
      const ph = c.mul(9.0).add(time.mul(vec3(2.1, 2.7, 1.9)));
      const swirl = vec3(sin(ph.y), sin(ph.z), sin(ph.x));
      c.addAssign(perp.div(max(dist, R.mul(0.25))).mul(R.mul(0.32)).add(swirl.mul(R.mul(0.08))).mul(infl));

      // ---- projection
      const v = modelViewMatrix.mul(vec4(c, 1)).xyz.toVar();
      const clip = cameraProjectionMatrix.mul(vec4(v, 1)).toVar();
      const P00 = cameraProjectionMatrix.mul(vec4(1, 0, 0, 0)).x;
      const P11 = cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y;
      const vp = screenSize;
      const fxp = vp.x.mul(0.5).mul(P00);
      const fyp = vp.y.mul(0.5).mul(P11);
      const z = min(v.z, -0.01);
      const iz = float(1).div(z);
      const j0 = vec3(fxp.negate().mul(iz), 0, fxp.mul(v.x).mul(iz).mul(iz));
      const j1 = vec3(0, fyp.negate().mul(iz), fyp.mul(v.y).mul(iz).mul(iz));
      // Wᵀ·j (W = upper 3×3 of modelView), so Σ' = (Wᵀj_a)ᵀ Σ (Wᵀj_b) in object space
      const w0 = modelViewMatrix.mul(vec4(1, 0, 0, 0)).xyz;
      const w1 = modelViewMatrix.mul(vec4(0, 1, 0, 0)).xyz;
      const w2 = modelViewMatrix.mul(vec4(0, 0, 1, 0)).xyz;
      const u0 = vec3(dot(w0, j0), dot(w1, j0), dot(w2, j0)).toVar();
      const u1 = vec3(dot(w0, j1), dot(w1, j1), dot(w2, j1)).toVar();
      const r0 = vec3(ca.x, ca.y, ca.z), r1 = vec3(ca.y, ca.w, cb.x), r2 = vec3(ca.z, cb.x, cb.y);
      const S = (q: any) => vec3(dot(r0, q), dot(r1, q), dot(r2, q));
      const Su1 = S(u1).toVar();
      const A = dot(u0, S(u0)), B = dot(u0, Su1), C = dot(u1, Su1);
      const a = A.add(0.3), cc = C.add(0.3), b = B;
      const detRaw = A.mul(C).sub(B.mul(B));
      const det = a.mul(cc).sub(b.mul(b));
      const aScale = sqrt(max(detRaw.div(max(det, 1e-12)), 0));
      const mid = a.add(cc).mul(0.5);
      const rad = sqrt(a.sub(cc).mul(0.5).pow(2).add(b.mul(b)));
      const l1 = mid.add(rad), l2 = max(mid.sub(rad), 0.1);
      const th = atan(b.mul(2), a.sub(cc)).mul(0.5);
      const ax1 = vec2(cos(th), sin(th)), ax2 = vec2(sin(th).negate(), cos(th));
      const pxy = positionGeometry.xy;
      const off = ax1.mul(pxy.x.mul(min(sqrt(l1), 1024))).add(ax2.mul(pxy.y.mul(min(sqrt(l2), 1024))));
      const ndc = clip.xy.div(clip.w);

      // colour: sRGB → linear working space, hover brightening
      const srgb = col.rgb;
      const lin = mix(srgb.div(12.92), pow(srgb.add(0.055).div(1.055), vec3(2.4)), step(0.04045, srgb));
      const alpha = col.a.mul(aScale).mul(uOpacity);
      vColor.assign(vec4(lin.mul(pow(infl.mul(2).add(1), 1 / 2.4)), alpha));
      vUv.assign(pxy);

      const out = vec4(clip.xy.add(off.mul(2).div(vp).mul(clip.w)), clip.z, clip.w).toVar();
      If(v.z.greaterThanEqual(-0.01).or(abs(ndc.x).greaterThan(1.4)).or(abs(ndc.y).greaterThan(1.4)).or(alpha.lessThan(1 / 255)), () => {
        out.assign(vec4(2, 2, 2, 1));
      });
      return out;
    })();

    mat.colorNode = vColor.rgb;
    mat.opacityNode = Fn(() => {
      const r2 = dot(vUv, vUv);
      If(r2.greaterThan(4), () => {
        Discard();
      });
      return exp(r2.mul(-0.5)).mul(vColor.a);
    })();
    mat.needsUpdate = true;
  }

  function requestSort() {
    if (!worker) return;
    if (inFlight) { dirty = true; return; }
    inFlight = true;
    dirty = false;
    const out = spare;
    spare = null;
    worker.postMessage({ type: 'sort', id: ++sortId, viewProj: sortVP.slice(), out }, out ? [out.buffer] : []);
  }

  const ready = new Promise<void>((resolve, reject) => {
    worker = new Worker(new URL('./splat.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'error') {
        reject(new Error(`splat: ${m.message}`));
        return;
      }
      if (m.type === 'parsed') {
        count = m.n;
        orderAttr = new InstancedBufferAttribute(new Float32Array(count), 1);
        geo.setAttribute('order', orderAttr);
        const tex = {
          centre: dataTex(m.centre, m.rows, true), covA: dataTex(m.covA, m.rows, true),
          covB: dataTex(m.covB, m.rows, true), colour: dataTex(m.colour, m.rows, false),
        };
        buildMaterial(tex);
        textures.push(tex.centre, tex.covA, tex.covB, tex.colour);
        (mesh.userData as any).bounds = m.bounds;
        (mesh.userData as any).total = m.total;
        requestSort();
        return;
      }
      if (m.type !== 'order') return;
      (orderAttr!.array as Float32Array).set(m.order);
      orderAttr!.needsUpdate = true;
      geo.instanceCount = m.count;
      spare = m.order;
      lastSortMs = m.ms;
      inFlight = false;
      if (dirty) requestSort();
      if (!firstDone) {
        firstDone = true;
        // visible from here on so renderer.compileAsync warm-ups include it (update() keeps it in sync with opacity)
        mesh.visible = opacity > 0.001;
        resolve();
      }
    };
    worker.onerror = (e) => reject(new Error(`splat worker: ${e.message}`));
    worker.postMessage({
      type: 'load', url: new URL(url, location.href).href, cap: cap ?? (isPhone ? PHONE_MAX : Infinity),
    });
  });

  // ---- per-frame
  const invObj = new Matrix4();
  const tmp = new Vector3(), camPos = new Vector3(), camDir = new Vector3();
  let opacity = 1;
  let lastPX = 0, lastPY = 0, idle = 1e9, lastSortMs = 0;

  function update(dt: number, camera: PerspectiveCamera, pointer: SplatPointer) {
    mesh.visible = opacity > 0.001 && firstDone;
    if (!count) return;
    mesh.updateWorldMatrix(true, false);
    invObj.copy(mesh.matrixWorld).invert();
    camPos.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(invObj);
    camDir.set(0, 0, -1).transformDirection(camera.matrixWorld).transformDirection(invObj);

    // re-sort (and re-cull) only on meaningful view changes
    const P = camera.projectionMatrix.elements;
    if (camDir.dot(lastDir) < 0.9995 || camPos.distanceTo(lastCam) > 0.02 || P[0] !== lastP0 || P[5] !== lastP5) {
      lastDir.copy(camDir);
      lastCam.copy(camPos);
      lastP0 = P[0]; lastP5 = P[5];
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld);
      sortVP.set(viewProj.elements);
      requestSort();
    }

    // pointer ray (object space); P[8], P[9] handle off-centre projections
    tmp.set((pointer.x + P[8]) / P[0], (pointer.y + P[9]) / P[5], -1).transformDirection(camera.matrixWorld).transformDirection(invObj);
    uRayO.value.copy(camPos);
    uRayD.value.copy(tmp);
    uRadPerDepth.value = (isPhone ? 0.16 : 0.24) / P[5]; // gentler than spec .42: a resting cursor otherwise punches a hole in the alley

    const moved = Math.hypot(pointer.x - lastPX, pointer.y - lastPY);
    lastPX = pointer.x; lastPY = pointer.y;
    idle = pointer.inside && moved > 1e-4 ? 0 : idle + dt;
    // active for ~log(1e7)/2.5 + .6 s after the last movement (spec), damped at rate 2.5
    const target = pointer.inside && idle < Math.log(1e7) / 2.5 + 0.6 ? 1 : 0;
    uPush.value += (target - uPush.value) * (1 - Math.exp(-2.5 * dt));
  }

  return {
    object: mesh,
    ready,
    update,
    setOpacity(v: number) {
      opacity = v;
      uOpacity.value = v;
      mesh.visible = v > 0.001 && firstDone;
    },
    dispose() {
      worker?.terminate();
      worker = null;
      geo.dispose();
      mat.dispose();
      for (const t of textures) t.dispose();
    },
    get count() { return count; },
    get lastSortMs() { return lastSortMs; },
  } as SplatHandle;
}
