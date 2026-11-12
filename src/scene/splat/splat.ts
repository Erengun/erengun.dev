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
 * Sorting: CPU counting sort (4096 depth bins) in a Web Worker for every backend, triggered only when the
 * view direction changes (dot < .9995) or the camera moved > 2 cm (object-local units).
 *
 * Hover (§8.2): the WebGPU compute physics is replaced by the documented cheap fallback on all backends:
 * a vertex-shader push of splat centres away from the pointer ray, with a damped strength (rate 2.5) that is
 * active for a few seconds after the pointer last moved, plus a small curl-ish swirl and the
 * `rgb·(1+speed)^(1/2.4)` brightening.
 *
 * Input file: standard 32-byte `.splat` (pos f32×3, scale f32×3, rgba u8×4, quat u8×4 w-first, q·128+128).
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

const TEX_W = 2048;
const BINS = 4096;
const PHONE_MAX = 220_000;

// ----------------------------------------------------------------------------------------------- sort worker
const workerSource = /* js */ `
let pos = null, n = 0, depth = null, keys = null;
const counts = new Uint32Array(${BINS});
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    pos = m.pos; n = pos.length / 3;
    depth = new Float32Array(n); keys = new Uint16Array(n);
    return;
  }
  if (m.type === 'sort') {
    const t0 = performance.now();
    const [cx, cy, cz] = m.cam, [fx, fy, fz] = m.dir;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const d = (pos[j] - cx) * fx + (pos[j + 1] - cy) * fy + (pos[j + 2] - cz) * fz;
      depth[i] = d;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    lo = Math.max(lo, m.near); // splats behind the near plane are culled in the shader anyway
    const s = (${BINS} - 1e-3) / Math.max(hi - lo, 1e-6);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      let k = ((depth[i] - lo) * s) | 0;
      k = k < 0 ? 0 : k > ${BINS - 1} ? ${BINS - 1} : k;
      k = ${BINS - 1} - k; // far first
      keys[i] = k;
      counts[k]++;
    }
    let acc = 0;
    for (let b = 0; b < ${BINS}; b++) { const c = counts[b]; counts[b] = acc; acc += c; }
    const order = m.out && m.out.length === n ? m.out : new Float32Array(n);
    for (let i = 0; i < n; i++) order[counts[keys[i]]++] = i;
    self.postMessage({ type: 'order', order, id: m.id, ms: performance.now() - t0 }, [order.buffer]);
  }
};`;

// ----------------------------------------------------------------------------------------------- parse
function parseSplat(buf: ArrayBuffer, isPhone: boolean) {
  const total = Math.floor(buf.byteLength / 32);
  const n = isPhone ? Math.min(total, PHONE_MAX) : total; // file is shuffled, so a prefix is a uniform subsample
  const sizeComp = Math.sqrt(total / n);
  const f = new Float32Array(buf, 0, total * 8);
  const u = new Uint8Array(buf);
  const rows = Math.ceil(n / TEX_W);
  const centre = new Float32Array(TEX_W * rows * 4);
  const covA = new Float32Array(TEX_W * rows * 4);
  const covB = new Float32Array(TEX_W * rows * 4);
  const colour = new Uint8Array(TEX_W * rows * 4);
  const pos = new Float32Array(n * 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * 8, b = i * 32;
    const x = f[o], y = f[o + 1], z = f[o + 2];
    const sx = f[o + 3] * sizeComp, sy = f[o + 4] * sizeComp, sz = f[o + 5] * sizeComp;
    let qw = (u[b + 28] - 128) / 128, qx = (u[b + 29] - 128) / 128, qy = (u[b + 30] - 128) / 128, qz = (u[b + 31] - 128) / 128;
    const ql = Math.hypot(qw, qx, qy, qz) || 1;
    qw /= ql; qx /= ql; qy /= ql; qz /= ql;
    // rotation matrix R (row-major r[row][col])
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    // M = R·S ; Σ = M·Mᵀ
    const m00 = r00 * sx, m01 = r01 * sy, m02 = r02 * sz;
    const m10 = r10 * sx, m11 = r11 * sy, m12 = r12 * sz;
    const m20 = r20 * sx, m21 = r21 * sy, m22 = r22 * sz;
    const p = i * 4;
    centre[p] = x; centre[p + 1] = y; centre[p + 2] = z; centre[p + 3] = 1;
    covA[p] = m00 * m00 + m01 * m01 + m02 * m02;
    covA[p + 1] = m00 * m10 + m01 * m11 + m02 * m12;
    covA[p + 2] = m00 * m20 + m01 * m21 + m02 * m22;
    covA[p + 3] = m10 * m10 + m11 * m11 + m12 * m12;
    covB[p] = m10 * m20 + m11 * m21 + m12 * m22;
    covB[p + 1] = m20 * m20 + m21 * m21 + m22 * m22;
    colour[p] = u[b + 24]; colour[p + 1] = u[b + 25]; colour[p + 2] = u[b + 26]; colour[p + 3] = u[b + 27];
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  const tex = (data: Float32Array | Uint8Array, float: boolean) => {
    const t = new DataTexture(data, TEX_W, rows, RGBAFormat, float ? FloatType : UnsignedByteType);
    t.minFilter = t.magFilter = NearestFilter;
    t.generateMipmaps = false;
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  };
  return {
    n, pos,
    centre: tex(centre, true), covA: tex(covA, true), covB: tex(covB, true), colour: tex(colour, false),
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}

// ----------------------------------------------------------------------------------------------- create
export function createSplat({ renderer: _renderer, url, isPhone }: { renderer: WebGPURenderer; url: string; isPhone: boolean }): SplatHandle {
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
  let inFlight = false, dirty = true, sortId = 0, spare: Float32Array | null = null;
  let resolveFirst: () => void = () => {};
  const firstSort = new Promise<void>((r) => (resolveFirst = r));

  const lastCam = new Vector3(1e9, 0, 0), lastDir = new Vector3(0, 0, 0);
  const sortCam = new Vector3(), sortDir = new Vector3();

  function buildMaterial(d: ReturnType<typeof parseSplat>) {
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
    worker.postMessage(
      { type: 'sort', id: ++sortId, cam: sortCam.toArray(), dir: sortDir.toArray(), near: 0.01, out },
      out ? [out.buffer] : [],
    );
  }

  const ready = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`splat: ${url} ${res.status}`);
    const d = parseSplat(await res.arrayBuffer(), isPhone);
    count = d.n;
    orderAttr = new InstancedBufferAttribute(new Float32Array(count).map((_, i) => i), 1);
    geo.setAttribute('order', orderAttr);
    geo.instanceCount = count;
    buildMaterial(d);
    textures.push(d.centre, d.covA, d.covB, d.colour);
    (mesh.userData as any).bounds = d.bounds;

    const blobUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    worker = new Worker(blobUrl);
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type !== 'order') return;
      (orderAttr!.array as Float32Array).set(m.order);
      orderAttr!.needsUpdate = true;
      spare = m.order;
      lastSortMs = m.ms;
      inFlight = false;
      resolveFirst();
      if (dirty) requestSort();
    };
    worker.postMessage({ type: 'init', pos: d.pos }, [d.pos.buffer]);
    // initial order for the default hero view (origin looking down -Z); update() re-sorts as needed
    sortCam.set(0, 0, 0);
    sortDir.set(0, 0, -1);
    requestSort();
    await firstSort;
    // visible from here on so renderer.compileAsync warm-ups include it (update() keeps it in sync with opacity)
    mesh.visible = opacity > 0.001;
  })();

  // ---- per-frame
  const invObj = new Matrix4();
  const tmp = new Vector3(), camPos = new Vector3(), camDir = new Vector3();
  let opacity = 1;
  let lastPX = 0, lastPY = 0, idle = 1e9, lastSortMs = 0;

  function update(dt: number, camera: PerspectiveCamera, pointer: SplatPointer) {
    mesh.visible = opacity > 0.001 && count > 0;
    if (!count) return;
    mesh.updateWorldMatrix(true, false);
    invObj.copy(mesh.matrixWorld).invert();
    camPos.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(invObj);
    camDir.set(0, 0, -1).transformDirection(camera.matrixWorld).transformDirection(invObj);

    // re-sort only on meaningful view changes
    if (camDir.dot(lastDir) < 0.9995 || camPos.distanceTo(lastCam) > 0.02) {
      lastDir.copy(camDir);
      lastCam.copy(camPos);
      sortCam.copy(camPos);
      sortDir.copy(camDir);
      requestSort();
    }

    // pointer ray (object space); P[8], P[9] handle off-centre projections
    const P = camera.projectionMatrix.elements;
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
      mesh.visible = v > 0.001 && count > 0;
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
