/**
 * Last tile (index 5): scroll-driven sequence  robot-arm corridor → twisting city → splat (spec-3d §7).
 *
 * Three stage scenes are rendered into their own targets with their own cameras and composited into the
 * portal's target by one fullscreen pass (vertical wipe 0→1, stage 2 inside the projected 4:3 city portal quad,
 * per-stage grade + AgX + vignette, spec §7.3).
 *
 * Stage cameras: the inner camera handed in by app.ts is expressed relative to a reference "open" pose
 * (portal flown through), and that relative transform is re-applied on top of each stage's own camera path.
 * So the stage still reads as a window while the tile sits on the carousel, follows the "pan" parallax
 * (spec §3) and needs no knowledge of the carousel.
 */
import {
  Scene, Color, Mesh, PerspectiveCamera, RenderTarget, HalfFloatType, DataTexture, RGBAFormat, FloatType,
  NearestFilter, InstancedBufferAttribute, BufferGeometry, BufferAttribute, MeshBasicNodeMaterial, QuadMesh,
  Matrix3, Matrix4, Vector2, Vector3, Vector4, Quaternion, FrontSide, BackSide, BoxGeometry, AnimationMixer, SphereGeometry, Group,
  PlaneGeometry, type Object3D, type SkinnedMesh, type WebGPURenderer, type Texture,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, int, ivec2, uniform, attribute, varying, texture, textureLoad, instancedBufferAttribute,
  positionGeometry, normalGeometry, cameraPosition, screenUV, mix, smoothstep, clamp, max, min, pow, exp, length,
  normalize, dot, atan, sin, cos, floor, fract, step, select, agxToneMapping, saturation, abs, reflect, uv,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Portal, PortalContext, PortalFrame } from '../types';
import { PORTAL_H, PORTAL_W } from '../types';
import { SCENE_START, SCENE_VP, WIPES, invLerp, clamp as clampN, lerp, smoothstep as smoothN, damp, stageBlend } from '../../lib/timeline';

type N = any; // TSL node (loosely typed on purpose)

// ------------------------------------------------------------------ timeline (spec §7)
const W0_END = WIPES[0].start + WIPES[0].length;
const CITY_END = WIPES[1].start; // .79
const CORRIDOR_A = -1.6 / SCENE_VP, CORRIDOR_B = 3 / SCENE_VP;
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);

// ------------------------------------------------------------------ corridor constants
const PAIR_STEP = 0.56;
/** spec says the portal camera opens to 40°; the reference frames read wider because of the fish-eye overscan */
const OPEN_FOV = 50;
const SPLAT_EXPOSURE = 0.85;
const SPLAT_SAT = 0.72;
const BAKE_FPS = 60;
const PAIR_DELAY = 0.125;
const CORRIDOR_BG = new Color(0.002, 0.002, 0.003);

// ------------------------------------------------------------------ city constants (spec §7.2)
const STREET_X = 25.401;
/** blocks are centred on the street line, so their facades sit at ±(25.401 - 26.8/2) */
const CANYON_WIDEN = 4;
const FACADE_X = STREET_X + CANYON_WIDEN - 26.8015 / 2;
const BLOCK_W = 14.044, BLOCK_H = 13.435, BLOCK_D = 26.8015;
const TWIST_LEN = 430;
const CITY_DIST = 250; // forward travel over the city stage
const DOLLY = 24;
const SUN_DIR = new Vector3(-0.3215, 0.9186, 0.2297).normalize();

const splatMods = (import.meta as any).glob('../splat/splat.ts') as Record<string, () => Promise<any>>;

export function createLastPortal(ctx: PortalContext): Portal {
  const { renderer } = ctx;
  const high = ctx.quality === 'high';
  const PAIRS = high ? 32 : 20;
  const ROWS_ABOVE = high ? 16 : 11, ROWS_BELOW = high ? 20 : 13, LEVELS = high ? 24 : 16;

  // =========================================================== corridor stage
  const corridorScene = new Scene();
  corridorScene.background = CORRIDOR_BG;
  const corridorCam = new PerspectiveCamera(50, 1, 0.01, 60);
  const uTime = uniform(0);
  const uCamZ = uniform(0);
  const pairAttr = new InstancedBufferAttribute(new Float32Array(PAIRS + 4), 1);
  const corridorMeshes: Mesh[] = [];
  let firstPair = Number.NaN;

  async function buildCorridor() {
    const gltf = await new GLTFLoader().loadAsync('/models/robot-arm-tile.glb');
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    let skinned: SkinnedMesh | null = null;
    const statics: Mesh[] = [];
    root.traverse((o: any) => {
      if (o.isSkinnedMesh) skinned = o;
      else if (o.isMesh) statics.push(o);
    });
    if (!skinned) throw new Error('robot-arm-tile: no skinned mesh');
    const sk = skinned as SkinnedMesh;
    const bones = sk.skeleton.bones;
    const nb = bones.length;
    const clip = gltf.animations.find((a) => a.name === 'Arm_Dip_Rig') ?? gltf.animations[0];
    const duration = clip.duration;
    const frames = Math.max(1, Math.round(duration * BAKE_FPS));

    // ---- bake the clip into a bone-matrix texture: (nb + 1 identity slot) × 4 texels wide, one row per frame
    const W = (nb + 1) * 4;
    const data = new Float32Array(W * frames * 4);
    const mixer = new AnimationMixer(root);
    mixer.clipAction(clip).play();
    const m = new Matrix4();
    for (let f = 0; f < frames; f++) {
      mixer.setTime(f / BAKE_FPS);
      root.updateMatrixWorld(true);
      for (let b = 0; b <= nb; b++) {
        if (b < nb) {
          m.copy(sk.matrixWorld).multiply(sk.bindMatrixInverse).multiply(bones[b].matrixWorld)
            .multiply(sk.skeleton.boneInverses[b]).multiply(sk.bindMatrix);
        } else m.identity();
        const e = m.elements;
        for (let c = 0; c < 4; c++) {
          const o = ((f * W) + b * 4 + c) * 4;
          data[o] = e[c * 4]; data[o + 1] = e[c * 4 + 1]; data[o + 2] = e[c * 4 + 2]; data[o + 3] = e[c * 4 + 3];
        }
      }
    }
    mixer.stopAllAction();
    const boneTex = new DataTexture(data, W, frames, RGBAFormat, FloatType);
    boneTex.minFilter = boneTex.magFilter = NearestFilter;
    boneTex.generateMipmaps = false;
    boneTex.needsUpdate = true;

    // ---- one merged geometry: position, normal, color(vec4), aBone
    const prep = (g: BufferGeometry, boneOf: (i: number) => number, mat?: Matrix4) => {
      const out = new BufferGeometry();
      const n = g.attributes.position.count;
      const pos = g.attributes.position.clone();
      const nor = g.attributes.normal.clone();
      if (mat) { pos.applyMatrix4(mat); nor.applyNormalMatrix(new Matrix3().getNormalMatrix(mat)); }
      const col: N = new Float32Array(n * 4);
      const ca = g.attributes.color;
      const bone = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        col[i * 4] = ca ? ca.getX(i) : 0.5; col[i * 4 + 1] = ca ? ca.getY(i) : 0.5;
        col[i * 4 + 2] = ca ? ca.getZ(i) : 0.5; col[i * 4 + 3] = ca && ca.itemSize > 3 ? ca.getW(i) : 1;
        bone[i] = boneOf(i);
      }
      out.setAttribute('position', pos);
      out.setAttribute('normal', nor);
      out.setAttribute('color', new BufferAttribute(col, 4));
      out.setAttribute('aBone', new BufferAttribute(bone, 1));
      if (g.index) out.setIndex(g.index.clone());
      return out;
    };
    const si = sk.geometry.attributes.skinIndex;
    const parts = [prep(sk.geometry, (i) => si.getX(i))];
    for (const s of statics) parts.push(prep(s.geometry, () => nb, s.matrixWorld));
    const geo = mergeGeometries(parts.map((p) => (p.index ? p : p)), false)!;
    geo.computeBoundingSphere();

    // ---- material (rigid skinning from the baked texture, per-pair time offset, custom lighting)
    const pair: N = instancedBufferAttribute(pairAttr, 'float');
    const aBone: N = attribute('aBone', 'float');
    const aCol: N = attribute('color', 'vec4');
    const makeMat = (mirror: number) => {
      const row: N = int(floor(fract(uTime.sub(pair.mul(PAIR_DELAY)).div(duration)).mul(frames)));
      const col: N = int(aBone.mul(4));
      const c0: N = textureLoad(boneTex, ivec2(col, row));
      const c1: N = textureLoad(boneTex, ivec2(col.add(1), row));
      const c2: N = textureLoad(boneTex, ivec2(col.add(2), row));
      const c3: N = textureLoad(boneTex, ivec2(col.add(3), row));
      const pg = positionGeometry, ng = normalGeometry;
      const p = c0.xyz.mul(pg.x).add(c1.xyz.mul(pg.y)).add(c2.xyz.mul(pg.z)).add(c3.xyz);
      const pw = vec3(p.x.mul(mirror), p.y, p.z.sub(pair.mul(PAIR_STEP)));
      const nn = c0.xyz.mul(ng.x).add(c1.xyz.mul(ng.y)).add(c2.xyz.mul(ng.z));
      const nw = vec3(nn.x.mul(mirror), nn.y, nn.z);
      const vW: N = varying(pw, 'vCorW');
      const vN: N = varying(nw, 'vCorN');
      const vC: N = varying(aCol, 'vCorC');
      // LED pulse once per loop (spec: exp(-max(0, t - 73/24 + 51/24)/.6))
      const loopT: N = fract(uTime.sub(pair.mul(PAIR_DELAY)).div(duration)).mul(duration);
      const vLed: N = varying(exp(max(loopT.sub(51 / 24), 0).negate().div(0.6)).mul(step(51 / 24, loopT)), 'vLed');
      const mat = new MeshBasicNodeMaterial();
      mat.side = mirror > 0 ? FrontSide : BackSide;
      mat.toneMapped = false;
      mat.fog = false;
      mat.positionNode = pw;
      mat.colorNode = corridorShade(vW, vN, vC, vLed);
      return mat;
    };
    for (const mirror of [1, -1]) {
      const mesh = new Mesh(geo, makeMat(mirror));
      mesh.frustumCulled = false;
      (mesh as any).count = PAIRS;
      corridorScene.add(mesh);
      corridorMeshes.push(mesh);
    }
  }

  function corridorShade(vW: N, vN: N, vC: N, vLed: N) {
    return Fn(() => {
      const P = vW;
      const Nn: N = normalize(vN);
      const V: N = normalize(cameraPosition.sub(P));
      const alb = vC.rgb;
      const cls = vC.a;
      const shin = select(cls.greaterThan(0.8), float(40), select(cls.greaterThan(0.45), float(140), float(8)));
      const ks = select(cls.greaterThan(0.8), float(0.3), select(cls.greaterThan(0.45), float(1.2), float(0.05)));
      const za = uCamZ.add(4.73), zb = uCamZ.sub(6.23);
      const ly = float(2.2);
      let diff: N = float(0), spec: N = float(0);
      for (const lx of [-0.75, 0.75]) {
        const D = vec2(float(lx).sub(P.x), ly.sub(P.y));
        const d = max(length(D), 0.05);
        const F = (t: N) => t.mul(2).add(sin(t.mul(2))).div(2 * Math.PI);
        const cover = abs(F(atan(za.sub(P.z).div(d))).sub(F(atan(zb.sub(P.z).div(d)))));
        const zc = clamp(P.z, zb, za);
        const L = normalize(vec3(D.x, D.y, zc.sub(P.z)));
        diff = diff.add(max(dot(Nn, L), 0).mul(cover).div(d));
        const R: N = reflect(V.negate() as N, Nn as N);
        const rr = max(dot(R.xy, R.xy), 1e-4);
        const s = max(dot(D, R.xy).div(rr), 0);
        const zs = clamp(P.z.add(R.z.mul(s)), zb, za);
        const Ls = normalize(vec3(D.x, D.y, zs.sub(P.z)));
        const H = normalize(Ls.add(V));
        const sp = pow(max(dot(Nn, H), 0), shin).mul(shin.add(8).div(8 * Math.PI)).mul(max(dot(Nn, Ls), 0)).div(d.mul(d).add(0.25));
        spec = spec.add(sp);
      }
      const lightCol = vec3(0.82, 0.9, 1).mul(2.1);
      // cheap occlusion: benches/floor under the arm rows and the gap behind them sit in shadow
      const ax = abs(P.x);
      const occl = mix(float(1), float(0.55), smoothstep(0.3, 0.5, ax).mul(float(1).sub(smoothstep(0.3, 0.62, P.y))));
      const amb = mix(vec3(0.01, 0.01, 0.012), vec3(0.06, 0.066, 0.08), Nn.y.mul(0.5).add(0.5)).mul(0.8);
      let c: N = alb.mul(lightCol.mul(diff).mul(occl).add(amb));
      c = c.add(lightCol.mul(spec).mul(ks).mul(occl));
      // emissive LED (class 0)
      c = mix(c, alb.mul(float(2.2).add(vLed.mul(10).mul(step(cls, 0.02)))), step(cls, 0.1));
      // exp² fog (density .17)
      const dist = length(cameraPosition.sub(P));
      const fd = dist.mul(0.17);
      const fog = float(1).sub(exp(fd.mul(fd).negate()));
      c = mix(c, vec3(CORRIDOR_BG.r, CORRIDOR_BG.g, CORRIDOR_BG.b), fog);
      return vec4(c, 1);
    })();
  }

  function updateCorridorInstances(camZ: number) {
    const i0 = Math.floor(-camZ / PAIR_STEP) - 3;
    if (i0 === firstPair) return;
    firstPair = i0;
    for (let i = 0; i < PAIRS; i++) pairAttr.array[i] = i0 + i;
    pairAttr.needsUpdate = true;
  }

  /** corridor camera path (corridor progress c in 0..1): slides down the placement's "up" axis while
   *  dollying forward; spec placement eye [0,.7,.17], forward [0,-.45,-1.5] at c ≈ .35 */
  const CORR_EYE = new Vector3(0, 0.78, 0.17);
  const CORR_FWD = new Vector3(0, -0.45, -1.5).normalize();
  const CORR_UP = new Vector3(0, 1.5, -0.45).normalize();
  const corridorPose = new Matrix4();
  function corridorPath(c: number) {
    // high above the arms before the portal opens, down to the placement at c ≈ .35, then lower still
    const s = c < 0.35 ? Math.pow((0.35 - c) / 0.35, 1.4) * 1.7 : (0.35 - c) * 1.0;
    const eye = CORR_EYE.clone().addScaledVector(CORR_UP, s).add(new Vector3(0, 0, -c * 2.4));
    eye.y = Math.max(eye.y, 0.4);
    const look = -0.16 + (c < 0.35 ? -Math.pow((0.35 - c) / 0.35, 1.4) * 0.35 : -smoothN(0.35, 0.75, c) * 0.22);
    const pitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), look);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), CORR_FWD).multiply(pitch);
    corridorPose.compose(eye, q, new Vector3(1, 1, 1));
    return eye.z;
  }

  // =========================================================== city stage
  const cityScene = new Scene();
  const cityCam = new PerspectiveCamera(50, 1, 0.5, 1200);
  const uTravel = uniform(0);
  const uTwist = uniform(0);
  const uNight = uniform(0);
  const uCityCam = uniform(new Vector3());
  const uSun = uniform(new Color(0.8, 0.9, 1).multiplyScalar(1.4));
  const uAmb = uniform(new Color(0.3, 0.64, 1).multiplyScalar(0.88));
  const uHaze = uniform(new Color(0.32, 0.62, 1).multiplyScalar(1.6));
  const uFogNear = uniform(ctx.isPhone ? 150 : 45);
  const skyColor = new Color();
  const cityCount = (ROWS_ABOVE + ROWS_BELOW) * 2 * LEVELS;
  /** blocks come in VARIANTS (city-block.glb); each variant is one instanced draw with its own instance data */
  const VARIANTS = 4;
  type CityVariant = { mesh: Mesh | null; iA: InstancedBufferAttribute; iB: InstancedBufferAttribute };
  const variants: CityVariant[] = Array.from({ length: VARIANTS }, () => ({
    mesh: null,
    iA: new InstancedBufferAttribute(new Float32Array(cityCount * 4), 4), // pos.xyz, seed
    iB: new InstancedBufferAttribute(new Float32Array(cityCount * 4), 4), // cos roll, sin roll, scale, side
  }));
  let firstLevel = Number.NaN;

  async function buildCity() {
    const gltf = await new GLTFLoader().loadAsync('/models/city-block.glb');
    gltf.scene.updateMatrixWorld(true);
    const geos: BufferGeometry[] = [];
    gltf.scene.traverse((o: any) => {
      const m = /^Block(\d)$/.exec(o.name);
      if (o.isMesh && m) {
        const g = (o.geometry as BufferGeometry).clone();
        g.applyMatrix4(o.matrixWorld);
        geos[Number(m[1])] = g;
      }
    });
    variants.forEach((v, vi) => {
      const geo = geos[vi] ?? geos[0];
      const mesh = new Mesh(geo, makeCityMaterial(v));
      mesh.frustumCulled = false;
      (mesh as any).count = 2;
      cityScene.add(mesh);
      v.mesh = mesh;
    });
  }

  function makeCityMaterial(v: CityVariant) {
    const A: N = instancedBufferAttribute(v.iA, 'vec4');
    const Bn: N = instancedBufferAttribute(v.iB, 'vec4');
    const pg = positionGeometry, ng = normalGeometry;
    // instance transform: roll about local x, scale, mirror for the left street side, translate
    const rollv = (q: N) => vec3(q.x, q.y.mul(Bn.x).sub(q.z.mul(Bn.y)), q.y.mul(Bn.y).add(q.z.mul(Bn.x)));
    const side = (q: N) => vec3(q.x.mul(Bn.w), q.y, q.z.mul(Bn.w));
    const p0 = side(rollv(pg).mul(Bn.z)).add(A.xyz);
    const n0 = side(rollv(ng));
    // twist about the street axis (spec §7.2): k = clamp(along/430)·twist ; angle = -π k ; squeeze
    const along = clamp(uCityCam.z.add(10).sub(p0.z).div(TWIST_LEN), 0, 1);
    const k = along.mul(uTwist);
    const ang = k.mul(-3.14);
    const ca = cos(ang), sa = sin(ang);
    const ex = p0.x.mul(float(1).sub(k.mul(0.35)));
    const ey = p0.y.sub(uCityCam.y);
    const pw = vec3(ex.mul(ca).sub(ey.mul(sa)), ex.mul(sa).add(ey.mul(ca)).add(uCityCam.y), p0.z);
    const nw = vec3(n0.x.mul(ca).sub(n0.y.mul(sa)), n0.x.mul(sa).add(n0.y.mul(ca)), n0.z);
    const vW: N = varying(pw, 'vCityW');
    const vN: N = varying(nw, 'vCityN');
    const vC: N = varying(attribute('color', 'vec4'), 'vCityC');
    const vUv: N = varying(uv(), 'vCityUv');
    const vSeed: N = varying(A.w, 'vCitySeed');
    const vDepth: N = varying(abs(p0.x).sub(FACADE_X), 'vCityDepth');

    const hash2 = (q: N) => fract(sin(dot(q, vec2(12.9898, 78.233))).mul(43758.5453));
    const shade = Fn(() => {
      const Nn: N = normalize(vN);
      const L = vec3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z);
      const ndl = max(dot(Nn, L), 0);
      const glass = vC.a;
      // vertex albedo (grey) pushed into the reference's cold blue, per-block tint variation
      const tint = hash2(vec2(vSeed, 3.1)).mul(0.3).add(0.85);
      const alb = vC.rgb.mul(vec3(0.2, 0.38, 0.66)).mul(tint);
      // skylight from "above" the canyon reads on bevels and ledges; deep parts of the wall go dark
      const sky = Nn.y.mul(0.35).add(0.65);
      const ao = mix(float(0.12), float(1), float(1).sub(smoothstep(9, 15, vDepth)));
      let c: N = alb.mul(vec3(uAmb as N).mul(sky).add(vec3(uSun as N).mul(ndl))).mul(ao);
      // window glass: dark with a faint sky sheen; a lit window lights all its panes (uv.y = window id)
      const wid = vUv.y.add(vSeed.mul(0.137));
      const lit = glass.mul(step(hash2(vec2(wid, 1.7)), 0.4)).mul(step(hash2(vec2(wid, 5.3)), uNight));
      const bright = mix(float(0.75), float(1), hash2(vec2(vUv.x.add(vSeed), 2.9)));
      c = mix(c, vec3(uAmb as N).mul(0.04).add(c.mul(0.6)), glass.mul(float(1).sub(lit)));
      c = mix(c, vec3(0.8714, 0.8632, 0.855).mul(bright).mul(3.2), lit);
      const dist = length(cameraPosition.sub(vW));
      const fog = pow(smoothstep(uFogNear, 340, dist), 0.55);
      c = mix(c, vec3(uHaze as N), fog);
      return vec4(c, 1);
    });
    const mat = new MeshBasicNodeMaterial();
    mat.positionNode = pw;
    mat.colorNode = shade();
    mat.toneMapped = false;
    mat.fog = false;
    return mat;
  }

  const rnd = (a: number, b: number, c: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  function updateCityInstances(camZ: number) {
    if (!variants[0].mesh) return;
    const j0 = Math.floor(-camZ / BLOCK_W) - 2;
    if (j0 === firstLevel) return;
    firstLevel = j0;
    const counts = new Array(VARIANTS).fill(0);
    for (let s = -1; s <= 1; s += 2) {
      for (let r = -ROWS_BELOW; r < ROWS_ABOVE; r++) {
        for (let l = 0; l < LEVELS; l++) {
          const j = j0 + l;
          const vi = Math.floor(rnd(j * 1.3, r * 2.1, s + 7) * VARIANTS) % VARIANTS;
          const v = variants[vi];
          const n = counts[vi]++;
          const a = v.iA.array as Float32Array, b = v.iB.array as Float32Array;
          const h = rnd(j, r, s);
          const sc = 1 + (rnd(r, j, s * 3) * 2 - 1) * 0.125;
          const rr = h < 0.6 ? 0 : h < 0.8 ? Math.PI / 2 : -Math.PI / 2;
          // instance centre on the street line; the left side (s = -1) is the right side rotated 180° about y
          a[n * 4] = s * (STREET_X + CANYON_WIDEN + (BLOCK_D / 2) * (sc - 1) + (rnd(j * 0.7, r * 1.9, s) - 0.35) * 3.5);
          a[n * 4 + 1] = r * BLOCK_H + BLOCK_H / 2;
          a[n * 4 + 2] = -j * BLOCK_W;
          a[n * 4 + 3] = rnd(j * 3, r * 7, s) * 100;
          b[n * 4] = Math.cos(rr); b[n * 4 + 1] = Math.sin(rr); b[n * 4 + 2] = sc; b[n * 4 + 3] = s;
        }
      }
    }
    variants.forEach((v, i) => {
      (v.mesh as any).count = Math.max(2, counts[i]);
      v.iA.needsUpdate = true;
      v.iB.needsUpdate = true;
    });
  }

  // city camera path: forward through the canyon (x³ - x⁴/2 = ∫ smoothstep speed), roll π/2 over .45→.9,
  // and a dolly (.56→1, in ^2 / out ^1.5) that turns toward the right-hand wall where the portal quad hangs
  const cityPose = new Matrix4();
  const quadCenter = new Vector3();
  const v3c = new Vector3(), ONE = new Vector3(1, 1, 1);
  const Y_AXIS = new Vector3(0, 1, 0), Z_AXIS = new Vector3(0, 0, 1), X_AXIS = new Vector3(1, 0, 0);
  const CAM_END_Z = -CITY_DIST - DOLLY;
  // the portal quad hangs on the right-hand wall (facing the street), a little ahead of the dolly's end
  const lookM = new Matrix4();
  const qBase = new Quaternion(), qLook = new Quaternion(), qRoll = new Quaternion();
  function cityPath(x: number) {
    const fwd = 2 * (x * x * x - (x * x * x * x) / 2);
    const dRaw = invLerp(0.56, 1, x);
    const dolly = dRaw < 0.5 ? 2 * dRaw * dRaw : 1 - Math.pow(2 - 2 * dRaw, 1.5) / 2;
    const z = -CITY_DIST * fwd - DOLLY * dolly;
    const roll = smoothN(0.45, 0.9, x) * Math.PI / 2;
    const eye = v3c.set(-dolly * 2, 2, z);
    qRoll.setFromAxisAngle(Z_AXIS, roll);
    qBase.setFromAxisAngle(X_AXIS, 0.06 * (1 - x)).premultiply(qRoll);
    // turn toward the quad during the dolly so it stays near the centre of the view while it opens
    lookM.lookAt(eye, quadCenter, Y_AXIS);
    qLook.setFromRotationMatrix(lookM).multiply(qRoll);
    const turn = smoothN(0, 1, invLerp(0.5, 0.85, x));
    qBase.slerp(qLook, turn);
    cityPose.compose(eye, qBase, ONE);
    return z;
  }
  const QUAD_W = 40, QUAD_H = 30;
  // hung in front of the right-hand wall just short of where the camera is at travel ~.95, turned to face the
  // approaching camera (as seen at travel .8) and tilted in-plane
  const quadRot = new Quaternion();
  {
    quadCenter.set(FACADE_X - 2.5, 1, -CITY_DIST * 2 * (0.9 ** 3 - 0.9 ** 4 / 2) - DOLLY * 0.77 - 8);
    cityPath(0.8);
    const eye = new Vector3().setFromMatrixPosition(cityPose);
    // Matrix4.lookAt(eye, target) points the object's +z from target to eye: the quad's front faces the camera
    quadRot.setFromRotationMatrix(new Matrix4().lookAt(eye, quadCenter, Y_AXIS))
      .multiply(new Quaternion().setFromAxisAngle(Z_AXIS, -0.35));
  }

  // =========================================================== splat stage
  const splatScene = new Scene();
  splatScene.background = new Color(0.003, 0.0008, 0.0006);
  const splatCam = new PerspectiveCamera(50, 1, 0.01, 200);
  const splatPose = new Matrix4();
  const SPLAT_PITCH = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.157);
  const SPLAT_FOV = 58;
  let splat: { object: Object3D; update(dt: number, cam: PerspectiveCamera, p: { x: number; y: number; inside: boolean }): void; setOpacity(v: number): void } | null = null;
  const placeholder = new Group();

  function buildPlaceholderSplat() {
    // red-lit alley: two walls of boxes, hanging lanterns, a hazy floor
    const wallMat = new MeshBasicNodeMaterial();
    const vW: N = varying(vec3(0), 'vSplW');
    wallMat.toneMapped = false;
    const box = new BoxGeometry(1, 1, 1);
    const lanternMat = new MeshBasicNodeMaterial({ color: new Color(4, 0.6, 0.15) });
    lanternMat.toneMapped = false;
    const sph = new SphereGeometry(0.22, 16, 12);
    for (let i = 0; i < 26; i++) {
      const s = i % 2 ? 1 : -1;
      const z = -1.5 - Math.floor(i / 2) * 0.9;
      const h = 1.2 + rnd(i, 1, 2) * 2.4;
      const m = new MeshBasicNodeMaterial();
      const k = 0.25 + rnd(i, 3, 4) * 0.5;
      m.colorNode = vec4(vec3(0.9 * k, 0.12 * k, 0.04 * k).mul(float(1).add(uv().y.mul(0.6))), 1);
      m.toneMapped = false;
      const b = new Mesh(box, m);
      b.scale.set(0.6 + rnd(i, 5, 6) * 0.6, h, 0.8);
      b.position.set(s * (1.4 + rnd(i, 7, 8) * 0.4), -1.2 + h / 2, z);
      placeholder.add(b);
      if (i % 3 === 0) {
        const l = new Mesh(sph, lanternMat);
        l.position.set(s * 1.0, 0.9 + rnd(i, 9, 1) * 0.5, z);
        placeholder.add(l);
      }
    }
    const floor = new Mesh(new PlaneGeometry(6, 30), new MeshBasicNodeMaterial({ color: new Color(0.12, 0.012, 0.004) }));
    (floor.material as MeshBasicNodeMaterial).toneMapped = false;
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -1.2, -12);
    placeholder.add(floor);
    void vW; void wallMat;
    splatScene.add(placeholder);
  }

  async function loadSplat() {
    const loader = splatMods['../splat/splat.ts'];
    if (!loader) return;
    try {
      const mod = await loader();
      if (!mod?.createSplat) return;
      const s = mod.createSplat({ renderer, url: '/splats/alley.splat', isPhone: ctx.isPhone });
      await s.ready;
      splat = s;
      placeholder.visible = false;
      splatScene.add(s.object);
    } catch (e) {
      console.warn('last portal: splat unavailable, using placeholder', e);
    }
  }

  // =========================================================== composite (spec §7.3)
  const rtOpts = { type: HalfFloatType, depthBuffer: true };
  const rts = [new RenderTarget(1, 1, rtOpts), new RenderTarget(1, 1, rtOpts), new RenderTarget(1, 1, rtOpts)];
  const uBlend = uniform(0);
  const uQuadOn = uniform(0);
  const uQ = [uniform(new Vector2()), uniform(new Vector2()), uniform(new Vector2()), uniform(new Vector2())];
  const compMat = new MeshBasicNodeMaterial();
  compMat.toneMapped = false;
  compMat.colorNode = Fn(() => {
    const p = screenUV;
    // inside the (convex) projected quad?
    const edge = (a: N, b: N) => {
      const e = b.sub(a), q = p.sub(a);
      return e.x.mul(q.y).sub(e.y.mul(q.x));
    };
    const e0 = edge(uQ[0], uQ[1]), e1 = edge(uQ[1], uQ[2]), e2 = edge(uQ[2], uQ[3]), e3 = edge(uQ[3], uQ[0]);
    const allPos = step(0, e0).mul(step(0, e1)).mul(step(0, e2)).mul(step(0, e3));
    const allNeg = step(e0, 0).mul(step(e1, 0)).mul(step(e2, 0)).mul(step(e3, 0));
    const inQuad = max(allPos, allNeg).mul(uQuadOn);
    // wipe: stage 1 comes down from the top of the screen
    const s01 = step(p.y, uBlend);
    const sel2 = max(inQuad, step(2, uBlend));
    const c0: N = texture(rts[0].texture, p).rgb;
    const c1: N = texture(rts[1].texture, p).rgb;
    const c2: N = texture(rts[2].texture, p).rgb;
    const grade = (c: N, tint: number[], pw: number, sat: number) =>
      saturation(pow(max(c.mul(vec3(tint[0], tint[1], tint[2])).div(0.18), 0), vec3(pw)).mul(0.18), sat);
    const g0 = agxToneMapping(grade(c0, [0.93, 1, 1.08], 0.9, 1.05), float(1));
    const g1 = agxToneMapping(grade(c1, [1, 1, 1], 1.2, 1), float(1));
    // spec: splat pixels skip AgX and get a neutral grade (the asset's grade is baked); slight exposure trim
    // The VHS/camcorder post pushes saturated reds further, so the splat gets a small exposure and
    // saturation trim to land on the reference's mean colour, and is clamped to display range.
    const g2 = clamp(saturation(c2.mul(SPLAT_EXPOSURE), SPLAT_SAT), 0, 1);
    let c: N = mix(g0 as N, g1 as N, s01);
    c = mix(c, g2, sel2);
    const vig = float(1).sub(smoothstep(0.25, 0.95, length(p.sub(0.5))).mul(0.8));
    return vec4(c.mul(vig), 1);
  })();
  const quad = new QuadMesh(compMat);

  // =========================================================== per-frame state
  const state = {
    t: 0, corridor: 0, cityTarget: 0, travel: 0, blend: 0, quadOpen: 0, splatT: 0,
    renderCorridor: true, renderCity: false, renderSplat: false, ready: false, first: true,
  };
  const rel = new Matrix4();
  const tmp = new Matrix4();
  const v3 = new Vector3();
  const content = new Vector3();
  const p4 = new Vector4();

  function relativePose(f: PortalFrame, scale: number) {
    // inner camera in the content frame (content is pushed back by openness and panned by the parallax)
    rel.copy(f.camera.matrixWorld);
    const e = rel.elements;
    e[12] -= content.x; e[13] -= content.y; e[14] -= content.z;
    // relative to the reference "fully open" pose
    const t = Math.tan((f.camera.fov * Math.PI) / 360);
    const cover = Math.min(PORTAL_H / (2 * t), PORTAL_W / (2 * t * f.camera.aspect));
    const refZ = cover * 0.8 + 1;
    e[14] -= refZ;
    e[12] *= scale; e[13] *= scale; e[14] *= scale;
    return rel;
  }

  function poseCamera(cam: PerspectiveCamera, pose: Matrix4, f: PortalFrame, scale: number, fov: number) {
    tmp.multiplyMatrices(pose, relativePose(f, scale));
    tmp.decompose(cam.position, cam.quaternion, v3);
    cam.scale.set(1, 1, 1);
    // spec: portal fov 60.655 → "open" fov 40, widened by the main camera's overscan factor
    const ov = Math.tan((f.camera.fov * Math.PI) / 360) / Math.tan((110 * Math.PI) / 360);
    cam.fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * ov) * 180) / Math.PI;
    cam.aspect = f.camera.aspect;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  const parallaxS = { x: 0, y: 0 };

  function update(f: PortalFrame) {
    const t = (f.vp - SCENE_START) / SCENE_VP; // unclamped: corridor starts before the scene does
    state.t = t;
    uTime.value = f.time;
    const corridor = invLerp(CORRIDOR_A, CORRIDOR_B, t);
    state.corridor = corridor;
    const cityTarget = invLerp(WIPES[0].start, CITY_END, t);
    // damped city travel (rate 5.66); big jumps (route snaps, first frame) settle at once
    if (state.first || Math.abs(cityTarget - state.travel) > 0.35) state.travel = cityTarget;
    else state.travel += (cityTarget - state.travel) * damp(5.66, f.dt);
    state.first = false;
    const x = state.travel;
    state.blend = stageBlend(clampN(t));
    state.quadOpen = outCubic(invLerp(0.63, 0.9, x));
    state.splatT = invLerp(lerp(0.63, 0.9, 0.95), 1, x);

    // pan parallax (spec §3 "pan" mode): d = tile progress · gate
    const gate = t >= W0_END ? 1 : clampN((WIPES[0].start - t) / 0.04);
    const weight = f.isPhone ? lerp(1, 2.5, state.splatT) : 1;
    const d = f.openness * weight * gate;
    parallaxS.x = f.parallax.x; parallaxS.y = f.parallax.y;
    content.set(-parallaxS.x * 0.15 * d, parallaxS.y * 0.15 * 0.5 * d, -f.openness);

    const fov = lerp(60.655, OPEN_FOV, f.openness);
    // corridor
    state.renderCorridor = state.blend < 1;
    if (state.renderCorridor) {
      const camZ = corridorPath(corridor);
      uCamZ.value = camZ;
      updateCorridorInstances(camZ);
      poseCamera(corridorCam, corridorPose, f, 1, fov);
    }
    // city
    state.renderCity = state.blend > 0 && state.blend < 2;
    if (state.renderCity || state.quadOpen > 0) {
      const camZ = cityPath(x);
      uTravel.value = x;
      uTwist.value = (1 - Math.cos(Math.PI * invLerp(0.24, 1, x))) / 2;
      const night = smoothN(0.2, 0.68, x);
      uNight.value = smoothN(0.25, 0.75, x);
      skyColor.setRGB(lerp(0.512, 0.006, night), lerp(0.992, 0.013, night), lerp(1.6, 0.03, night));
      (uHaze.value as Color).setRGB(lerp(0.512, 0.006, night), lerp(0.992, 0.013, night), lerp(1.6, 0.03, night));
      (uSun.value as Color).setRGB(lerp(0.8, 0.5, night), lerp(0.9, 0.6, night), 1).multiplyScalar(lerp(1.4, 0.5, night));
      (uAmb.value as Color).setRGB(0.3, 0.64, 1).multiplyScalar(lerp(0.2, 0.06, night));
      updateCityInstances(camZ);
      poseCamera(cityCam, cityPose, f, 18, fov);
      (uCityCam.value as Vector3).copy(cityCam.position);
      uCityCam.value.z = camZ;
    }
    // portal quad corners (projected with the city camera) → composite uniforms
    uQuadOn.value = state.quadOpen > 0 && state.blend < 2 ? 1 : 0;
    if (uQuadOn.value) {
      const grow = state.quadOpen * (1 + 1.5 * state.splatT);
      const w = (QUAD_W / 2) * grow, h = (QUAD_H / 2) * grow;
      const corners = [[-w, -h], [w, -h], [w, h], [-w, h]];
      let behind = false;
      for (let i = 0; i < 4; i++) {
        v3.set(corners[i][0], corners[i][1], 0).applyQuaternion(quadRot).add(quadCenter);
        p4.set(v3.x, v3.y, v3.z, 1).applyMatrix4(cityCam.matrixWorldInverse).applyMatrix4(cityCam.projectionMatrix);
        if (p4.w <= 1e-3) behind = true;
        const ww = Math.max(p4.w, 1e-3);
        (uQ[i].value as Vector2).set((p4.x / ww) * 0.5 + 0.5, 0.5 - (p4.y / ww) * 0.5); // screenUV is y-down
      }
      if (behind) {
        // the quad straddles the camera plane: only possible right before it fills the screen
        if (state.quadOpen > 0.9) {
          (uQ[0].value as Vector2).set(-1, -1); (uQ[1].value as Vector2).set(2, -1);
          (uQ[2].value as Vector2).set(2, 2); (uQ[3].value as Vector2).set(-1, 2);
        } else uQuadOn.value = 0;
      }
    }
    // splat
    state.renderSplat = state.blend >= 2 || uQuadOn.value > 0;
    if (state.renderSplat) {
      // splat frame (splat worker): hero eye at the origin looking down −z, pitched up ~9°, fov 55–62.
      // A small dolly (0.6 m) ends exactly at the hero eye as the stage fills the screen.
      splatPose.compose(new Vector3(0, 0, 0.6 * (1 - state.splatT)), SPLAT_PITCH, ONE);
      poseCamera(splatCam, splatPose, f, 1, lerp(60.655, SPLAT_FOV, f.openness));
      if (splat) {
        splat.setOpacity(1);
        splat.update(f.dt, splatCam, f.pointer);
      }
    }
    uBlend.value = state.blend;
  }

  if (import.meta.env.DEV) (globalThis as any).__lastDebug = { state, uQ, uQuadOn, quadCenter, cityCam };

  function render(r: WebGPURenderer, _camera: PerspectiveCamera, rt: RenderTarget) {
    const w = rt.width, h = rt.height;
    for (const t of rts) if (t.width !== w || t.height !== h) t.setSize(w, h);
    const prevClear = new Color();
    r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();
    if (state.renderCorridor) {
      r.setRenderTarget(rts[0]);
      r.setClearColor(CORRIDOR_BG, 1);
      r.clear();
      r.render(corridorScene, corridorCam);
    }
    if (state.renderCity) {
      r.setRenderTarget(rts[1]);
      r.setClearColor(skyColor, 1);
      r.clear();
      r.render(cityScene, cityCam);
    }
    if (state.renderSplat) {
      r.setRenderTarget(rts[2]);
      r.setClearColor(splatScene.background as Color, 1);
      r.clear();
      r.render(splatScene, splatCam);
    }
    r.setRenderTarget(rt);
    quad.render(r);
    r.setClearColor(prevClear, prevAlpha);
  }

  // =========================================================== ready
  const ready = (async () => {
    buildPlaceholderSplat();
    await Promise.all([buildCity(), buildCorridor()]);
    updateCityInstances(0);
    updateCorridorInstances(0);
    void loadSplat();
    // warm every stage + the composite so the first wipe doesn't hitch
    try {
      await renderer.compileAsync(cityScene, cityCam);
      await renderer.compileAsync(splatScene, splatCam);
      await renderer.compileAsync(corridorScene, corridorCam);
    } catch (e) {
      console.warn('last portal warm-up', e);
    }
    state.ready = true;
  })();

  return {
    scene: corridorScene,
    background: CORRIDOR_BG,
    ready,
    update,
    render,
    dispose() {
      for (const t of rts) t.dispose();
      (quad.material as MeshBasicNodeMaterial).dispose();
    },
  };
}

