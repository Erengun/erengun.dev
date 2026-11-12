/**
 * Elek world (project 3): a huge sieve.
 *
 * A bent-wood drum sieve (tools/blender/worlds/elek → /worlds/elek/sieve.glb) hangs tilted in a black void under
 * a spot of light. Thousands of test particles rain onto its wire mesh; the mesh sorts them on contact:
 * changed tests (lime) drop through toward a lime glow pool, cached ones (grey) bounce and get flung over the
 * low rim. The real screenshots sit on a big panel to the right; "107×" and a 192.5s → 1.8s counter are
 * in-world type behind the sieve.
 *
 * Beats (local t):  arrive 0 → .22  camera cranes down from inside the rain above the mesh to the hold pose
 *                   hold   .22 → .82 slow dolly + drift, counter rolls 192.5s → 1.8s, "107×" flickers on
 *                   depart .82 → 1   camera swoops over the sieve and drops through the mesh after the lime ones
 *
 * Everything is one closed-form vertex animation (no compute, no CPU sim): works on WebGPU and WebGL2.
 * All materials are unlit node materials with hand-written lighting and fog, toneMapped = false, values kept in
 * display range (the compositor's tone mapping is not known yet).
 */
import {
  Scene, Color, Mesh, Group, PerspectiveCamera, InstancedBufferAttribute, IcosahedronGeometry, PlaneGeometry,
  CircleGeometry, CylinderGeometry, MeshBasicNodeMaterial, CanvasTexture, SRGBColorSpace, TextureLoader, Vector3,
  Matrix4, Quaternion, Euler, DoubleSide, AdditiveBlending, type Texture, type BufferGeometry,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, uv, instancedBufferAttribute, positionGeometry, normalGeometry, positionWorld,
  normalWorld, cameraPosition, texture, attribute, varying, mix, smoothstep, clamp, max, min, pow, exp, length,
  normalize, dot, sin, cos, floor, fract, step, select, abs, sqrt, hash, fwidth, mx_noise_float,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Stage, StageFrame, ProjectWorldContext, SlideImage } from '../journey/types';

type N = any; // TSL nodes (loosely typed on purpose)

// ------------------------------------------------------------------ helpers
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const inv = (a: number, b: number, x: number) => clamp01((x - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => {
  const t = inv(a, b, x);
  return t * t * (3 - 2 * t);
};
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const bez = (out: Vector3, a: Vector3, b: Vector3, c: Vector3, t: number) => {
  const u = 1 - t;
  return out.set(0, 0, 0).addScaledVector(a, u * u).addScaledVector(b, 2 * u * t).addScaledVector(c, t * t);
};
const rnd = (i: number, k: number) => {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// ------------------------------------------------------------------ palette / layout
const LIME = new Color('#c8ff00');
const LIME_L = [0.58, 1.0, 0.0] as const; // linear-ish lime used in shaders
const BG = new Color(0.003, 0.003, 0.003);
const ARRIVE_END = 0.22, DEPART_START = 0.82;
const G = 9.0; // gravity of the test rain

const SIEVE_C = new Vector3(-3.05, 0.95, -0.7);
const SIEVE_R = 1.5;
const SIEVE_TILT = new Euler(0.62, 0, 0.24, 'ZXY'); // pitched toward the camera, low side on the left
const PANEL_C = new Vector3(1.85, 1.72, -1.1);
const PANEL_BOX = { w: 6.0, h: 3.55 };
const BIG_C = new Vector3(-5.0, 3.9, -7.5);
const FLOOR_Y = -2.6;
const KEY_POS = new Vector3(-4.6, 9.5, 4.2);
const HOLD_EYE = new Vector3(-0.35, 0.85, 12.3);
const HOLD_TARGET = new Vector3(0.1, 1.15, 0);

export function createWorld(ctx: ProjectWorldContext): Stage {
  const high = ctx.quality === 'high' && !ctx.isPhone;
  const COUNT = high ? 3400 : 1800;

  const scene = new Scene();
  scene.background = BG;
  const camera = new PerspectiveCamera(36, 16 / 9, 0.05, 120);

  // ------------------------------------------------------------------ shared uniforms
  const uTime = uniform(0);
  const uC = uniform(SIEVE_C.clone());
  const uSX = uniform(new Vector3(1, 0, 0));
  const uSY = uniform(new Vector3(0, 1, 0));
  const uSZ = uniform(new Vector3(0, 0, 1));
  const uDown = uniform(new Vector3(-1, 0, 0)); // downhill direction inside the mesh plane
  const uSide = uniform(new Vector3(0, 0, 1));
  const uR = uniform(SIEVE_R);
  const uPulse = uniform(0); // 0..1 "sorting" intensity (lights the mesh)
  const uCamR = uniform(new Vector3(1, 0, 0)), uCamU = uniform(new Vector3(0, 1, 0));

  // ------------------------------------------------------------------ lighting (shared TSL helpers)
  const keyPos = vec3(KEY_POS.x, KEY_POS.y, KEY_POS.z);
  const keyAxis = vec3(SIEVE_C.x - KEY_POS.x, SIEVE_C.y - KEY_POS.y, SIEVE_C.z - KEY_POS.z).normalize();
  const lime = vec3(...LIME_L);
  const panelLightPos = vec3(PANEL_C.x, PANEL_C.y, PANEL_C.z + 0.6);
  /** custom light rig: spot key from above-left, lime pool under the sieve, cool back rim, panel spill */
  const light = (P: N, Nn: N, V: N, alb: N, shin: N, ks: N) => {
    const Lk = normalize(keyPos.sub(P));
    const cone = smoothstep(0.86, 0.97, dot(Lk.negate(), keyAxis));
    const key = max(dot(Nn, Lk), 0).mul(cone).mul(1.25);
    const Hk = normalize(Lk.add(V));
    const specK = pow(max(dot(Nn, Hk), 0), shin).mul(cone).mul(ks);
    const poolPos = uC.sub(vec3(0, 2.4, 0));
    const Dp = poolPos.sub(P);
    const dp = length(Dp);
    const pool = max(dot(Nn, Dp.div(dp)), 0).div(dp.mul(dp).mul(0.35).add(1)).mul(0.55);
    const Lr = normalize(vec3(0.35, 0.5, -1));
    const rim = pow(max(dot(Nn, Lr), 0), 2).mul(0.22);
    const Dl = panelLightPos.sub(P);
    const dl = length(Dl);
    const spill = max(dot(Nn, Dl.div(dl)), 0).div(dl.mul(dl).mul(0.08).add(1)).mul(0.16);
    const amb = mix(vec3(0.012, 0.012, 0.014), vec3(0.03, 0.032, 0.036), Nn.y.mul(0.5).add(0.5));
    let c: N = alb.mul(vec3(1, 0.96, 0.9).mul(key).add(lime.mul(pool)).add(vec3(0.7, 0.8, 1).mul(rim)).add(vec3(0.8, 0.85, 1).mul(spill)).add(amb));
    c = c.add(vec3(1, 0.97, 0.92).mul(specK)).add(lime.mul(pool).mul(ks).mul(0.3));
    return c;
  };
  const fogged = (c: N, P: N, dens = 0.032) => {
    const d = length(cameraPosition.sub(P)).mul(dens);
    return mix(c, vec3(BG.r, BG.g, BG.b), float(1).sub(exp(d.mul(d).negate())));
  };

  // ------------------------------------------------------------------ sieve group (rim glb + wire mesh)
  const sieve = new Group();
  sieve.position.copy(SIEVE_C);
  sieve.rotation.copy(SIEVE_TILT);
  sieve.scale.setScalar(SIEVE_R);
  scene.add(sieve);

  const rimMat = new MeshBasicNodeMaterial();
  rimMat.toneMapped = false;
  rimMat.fog = false;
  rimMat.colorNode = Fn(() => {
    const P: N = positionWorld;
    const Nn: N = normalize(normalWorld);
    const V: N = normalize(cameraPosition.sub(P));
    const col: N = attribute('color', 'vec4');
    const cls = col.a;
    const u: N = uv();
    // bent-veneer grain runs around the rim: stretched noise bands in v
    const n = mx_noise_float(vec3(u.x.mul(1.5), u.y.mul(42), 0.0));
    const n2 = mx_noise_float(vec3(u.x.mul(14), u.y.mul(260), 3.0));
    const grain = sin(u.y.mul(300).add(n.mul(9))).mul(0.5).add(0.5);
    const wood = cls.greaterThan(0.75);
    const alb = select(wood, col.rgb.mul(float(0.72).add(grain.mul(0.28)).add(n2.mul(0.08))), col.rgb);
    const shin = select(wood, float(18), select(cls.greaterThan(0.4), float(60), float(90)));
    const ks = select(wood, float(0.18), select(cls.greaterThan(0.4), float(1.1), float(0.6)));
    // fresnel edge sheen
    const fr = pow(float(1).sub(max(dot(Nn, V), 0)), 4).mul(0.08);
    const c = light(P, Nn, V, alb.mul(1.6), shin, ks).add(fr);
    return vec4(fogged(c, P), 1);
  })();

  // wire mesh: a disc in the sieve's local xz plane; the weave is procedural (anti-aliased with fwidth)
  const meshGeo = new CircleGeometry(0.985, 96);
  meshGeo.rotateX(-Math.PI / 2);
  const wireMat = new MeshBasicNodeMaterial();
  wireMat.toneMapped = false;
  wireMat.fog = false;
  wireMat.transparent = true;
  wireMat.depthWrite = false;
  wireMat.side = DoubleSide;
  wireMat.colorNode = Fn(() => {
    const lp: N = positionGeometry; // local, unit radius
    const S = float(0.026);
    const W = float(0.16); // wire half-width as a fraction of a cell
    const g: N = lp.xz.div(S);
    const fw: N = max(fwidth(g), vec2(1e-4));
    const dist: N = abs(fract(g).sub(0.5)).mul(-1).add(0.5); // 0 at the wire, .5 mid-cell
    const lines: N = vec2(1).sub(smoothstep(W.sub(fw.mul(0.5)), W.add(fw.mul(0.5)), dist));
    // weave: the wires alternate over/under, giving a subtle crossing brightness pattern
    const cell: N = floor(g);
    const over = fract(cell.x.add(cell.y).mul(0.5)).mul(2);
    const cov = max(lines.x, lines.y);
    const avg = W.mul(2).mul(2).sub(W.mul(W).mul(4));
    const aaFade = smoothstep(0.25, 0.6, max(fw.x, fw.y));
    const a = mix(cov, avg, aaFade);
    const r = length(lp.xz);
    const P: N = positionWorld;
    const Nn: N = normalize(normalWorld);
    const V: N = normalize(cameraPosition.sub(P));
    // wires: brushed metal, anisotropic-ish sheen from the key light
    const Nf = select(dot(Nn, V).lessThan(0), Nn.negate(), Nn);
    const base = light(P, Nf, V, vec3(0.5, 0.5, 0.48).mul(float(0.85).add(over.mul(0.3))), float(24), float(0.9));
    // lime glow from the pool below + a pulse where the tests pass through (centre)
    const glow = lime.mul(float(1).sub(smoothstep(0.0, 0.95, r))).mul(float(0.18).add(uPulse.mul(0.22)));
    const c = base.add(glow);
    const alpha = a.mul(0.92).add(0.05).mul(float(1).sub(smoothstep(0.97, 0.985, r)));
    return vec4(fogged(c, P), alpha);
  })();
  const wire = new Mesh(meshGeo, wireMat);
  wire.renderOrder = 2;
  sieve.add(wire);

  // ------------------------------------------------------------------ particles (one instanced draw)
  const iA = new InstancedBufferAttribute(new Float32Array(COUNT * 4), 4); // disc a, disc b, period, phase
  const iB = new InstancedBufferAttribute(new Float32Array(COUNT * 4), 4); // green?, launch up, rim angle, size
  {
    const a = iA.array as Float32Array, b = iB.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      const rr = Math.sqrt(rnd(i, 1)) * 0.82, th = rnd(i, 2) * Math.PI * 2;
      a[i * 4] = Math.cos(th) * rr;
      a[i * 4 + 1] = Math.sin(th) * rr;
      a[i * 4 + 2] = 2.9 + rnd(i, 3) * 1.3;
      a[i * 4 + 3] = rnd(i, 4);
      b[i * 4] = rnd(i, 5) < 0.2 ? 1 : 0;
      b[i * 4 + 1] = 3.9 + rnd(i, 6) * 0.9;
      b[i * 4 + 2] = (rnd(i, 7) - 0.5) * 1.5;
      b[i * 4 + 3] = 0.022 + rnd(i, 8) * 0.016;
    }
  }
  const partGeo = new IcosahedronGeometry(1, 1);
  const partMat = new MeshBasicNodeMaterial();
  partMat.toneMapped = false;
  partMat.fog = false;
  /** closed-form path of one test particle (shared by the sphere and the halo draws) */
  const particlePath = () => {
    const A: N = instancedBufferAttribute(iA, 'vec4');
    const B: N = instancedBufferAttribute(iB, 'vec4');
    const T = A.z;
    const tau: N = fract(uTime.div(T).add(A.w)).mul(T);
    const R: N = uR;
    const q: N = uC.add(uSX.mul(A.x.mul(R))).add(uSZ.mul(A.y.mul(R)));
    const H0 = float(6.8).add(A.w.mul(1.5));
    const tf: N = sqrt(H0.mul(2 / G));
    const Y = vec3(0, 1, 0);
    const u: N = max(tau.sub(tf), 0);
    const before = tau.lessThan(tf);
    const green = B.x.greaterThan(0.5);
    // phase 1: free fall onto q
    const pFall = q.add(Y.mul(H0.sub(tau.mul(tau).mul(G / 2))));
    const vFall = Y.mul(tau.mul(-G));
    // phase 2a (changed tests): through the mesh, damped by it, on toward the pool
    const v1: N = tf.mul(G * 0.55);
    const pGreen = q.sub(Y.mul(v1.mul(u).add(u.mul(u).mul(G * 0.5))));
    const vGreen = Y.mul(v1.add(u.mul(G)).negate());
    // phase 2b (cached tests): bounce off the mesh and get flung over the low rim
    const ang = B.z;
    const E: N = uC.add(uDown.mul(cos(ang)).add(uSide.mul(sin(ang))).mul(R.mul(1.02)));
    const dE: N = E.sub(q);
    const dEp: N = dE.sub(uSY.mul(dot(dE, uSY)));
    const lenE = max(length(dEp), 0.05);
    const v0: N = dEp.div(lenE).mul(lenE.add(0.45).div(0.55)).add(uSY.mul(B.y));
    const pGrey = q.add(v0.mul(u)).sub(Y.mul(u.mul(u).mul(G * 0.5)));
    const vGrey = v0.sub(Y.mul(u.mul(G)));
    const P2 = select(green, pGreen, pGrey);
    const V2 = select(green, vGreen, vGrey);
    const P: N = select(before, pFall, P2);
    const Vel: N = select(before, vFall, V2);
    // visibility: fade in high above, out after leaving the sieve
    const life = select(green, float(1).sub(smoothstep(0.55, 1.0, u)), float(1).sub(smoothstep(1.1, 1.6, u)));
    const vis: N = select(before, smoothstep(0.0, 0.25, tau), life);
    const size: N = B.w.mul(vis);
    return { A, B, P, Vel, before, u, green, size, tau };
  };
  {
    const { B, P, Vel, before, u, size } = particlePath();
    // stretch along velocity (fake motion blur)
    const sp = length(Vel);
    const vd: N = Vel.div(max(sp, 1e-3));
    const pl: N = positionGeometry.mul(size);
    const stretch = min(sp.mul(0.055), 3.2);
    const pw = P.add(pl).add(vd.mul(dot(pl, vd)).mul(stretch));
    partMat.positionNode = pw;
    const vP: N = varying(pw, 'vElekP');
    const vN: N = varying(normalGeometry, 'vElekN');
    const vState: N = varying(vec4(select(before, float(0), float(1)), B.x, exp(u.mul(-7)).mul(step(0.0001, u)), u), 'vElekS');
    partMat.colorNode = Fn(() => {
      const Nn: N = normalize(vN);
      const V: N = normalize(cameraPosition.sub(vP));
      const sorted = vState.x;
      const isGreen = vState.y.greaterThan(0.5);
      const flash = vState.z;
      // falling: neutral white; sorted: lime (emissive) or cached grey (lit)
      const white = light(vP, Nn, V, vec3(0.6), float(30), float(0.6)).add(vec3(0.06));
      const greyC = light(vP, Nn, V, vec3(0.32, 0.33, 0.34), float(40), float(0.5));
      const limeC = lime.mul(float(0.95).add(flash.mul(0.8))).add(vec3(flash.mul(0.5)));
      const sortedC = select(isGreen, limeC, greyC.add(vec3(flash.mul(0.6))));
      const c = mix(white, sortedC, sorted);
      return vec4(fogged(c, vP, 0.026), 1);
    })();
  }
  const particles = new Mesh(partGeo, partMat);
  particles.frustumCulled = false;
  (particles as any).count = COUNT;
  scene.add(particles);

  // additive halos on the lime (changed) tests once they pass the mesh: camera-facing quads, one draw
  const haloMat = new MeshBasicNodeMaterial();
  haloMat.toneMapped = false;
  haloMat.fog = false;
  haloMat.transparent = true;
  haloMat.depthWrite = false;
  haloMat.blending = AdditiveBlending;
  {
    const { P, before, green, size, u } = particlePath();
    const on = select(before, float(0), select(green, float(1), float(0)));
    const hs = size.mul(on).mul(float(9).add(exp(u.mul(-6)).mul(14)));
    // billboard: offset along the camera's right/up (from the view matrix rows)
    haloMat.positionNode = P.add(uCamR.mul(positionGeometry.x.mul(hs))).add(uCamU.mul(positionGeometry.y.mul(hs)));
    const vHu: N = varying(uv(), 'vHaloUv');
    const vHd: N = varying(length(cameraPosition.sub(P)), 'vHaloD');
    haloMat.colorNode = Fn(() => {
      const d = length(vHu.sub(0.5)).mul(2);
      const k = exp(d.mul(d).mul(-5)).mul(float(1).sub(smoothstep(0.8, 1, d))).mul(0.32).mul(smoothstep(0.4, 2.2, vHd));
      const fogK = exp(vHd.mul(0.026).pow(2).negate());
      return vec4(lime.mul(k).mul(fogK), 1);
    })();
  }
  const halos = new Mesh(new PlaneGeometry(1, 1), haloMat);
  halos.frustumCulled = false;
  (halos as any).count = COUNT;
  halos.renderOrder = 4;
  scene.add(halos);

  // ------------------------------------------------------------------ light beam over the sieve (additive)
  const beamLen = KEY_POS.distanceTo(SIEVE_C) - 0.4;
  const beamGeo = new CylinderGeometry(0.25, 2.25, beamLen, 48, 1, true);
  beamGeo.translate(0, -beamLen / 2, 0); // apex at the origin
  const beamMat = new MeshBasicNodeMaterial();
  beamMat.toneMapped = false;
  beamMat.transparent = true;
  beamMat.depthWrite = false;
  beamMat.blending = AdditiveBlending;
  beamMat.side = DoubleSide;
  beamMat.colorNode = Fn(() => {
    const P: N = positionWorld;
    const Nn: N = normalize(normalWorld);
    const V: N = normalize(cameraPosition.sub(P));
    const along = positionGeometry.y.negate().div(beamLen); // 0 at the lamp, 1 at the sieve
    const edge = pow(abs(dot(Nn, V)), 1.6);
    const motes = mx_noise_float(vec3(P.x.mul(2.5), P.y.mul(1.2).add(uTime.mul(0.25)), P.z.mul(2.5))).mul(0.35).add(0.8);
    const k = edge.mul(smoothstep(0.0, 0.35, along)).mul(float(1).sub(smoothstep(0.75, 1.0, along))).mul(0.055).mul(motes);
    return vec4(vec3(1, 0.97, 0.9).mul(k), 1);
  })();
  const beam = new Mesh(beamGeo, beamMat);
  beam.position.copy(KEY_POS);
  beam.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), SIEVE_C.clone().sub(KEY_POS).normalize());
  beam.renderOrder = 3;
  scene.add(beam);

  // ------------------------------------------------------------------ floor: lime pool + faint lab grid
  const floorMat = new MeshBasicNodeMaterial();
  floorMat.toneMapped = false;
  floorMat.fog = false;
  floorMat.colorNode = Fn(() => {
    const P: N = positionWorld;
    const d = P.xz.sub(uC.xz);
    const pool = exp(dot(d, d).mul(-0.42)).mul(0.42).add(exp(dot(d, d).mul(-3.5)).mul(0.35));
    const ripple = sin(length(d).mul(9).sub(uTime.mul(3.2))).mul(0.5).add(0.5).mul(exp(dot(d, d).mul(-0.6))).mul(0.06);
    const g = P.xz.div(1.2);
    const fw = max(fwidth(g), vec2(1e-4));
    const gl = vec2(1).sub(smoothstep(vec2(0), fw.mul(1.5), abs(fract(g).sub(0.5)).mul(-1).add(0.5)));
    const grid = max(gl.x, gl.y).mul(0.014).mul(exp(length(P.xz.sub(uC.xz)).mul(-0.12))).mul(float(1).sub(smoothstep(0.3, 1.2, max(fw.x, fw.y))));
    // spill of the screenshot panel on the floor in front of it
    const dpz = P.xz.sub(vec2(PANEL_C.x, PANEL_C.z + 1.0));
    const spill = exp(dot(dpz.mul(vec2(0.35, 0.8)), dpz.mul(vec2(0.35, 0.8))).negate()).mul(0.05);
    const near = clamp(cameraPosition.y.sub(FLOOR_Y).div(3.2), 0.3, 1);
    const c = vec3(0.006).add(lime.mul(pool.add(ripple).mul(near))).add(vec3(grid)).add(vec3(0.8, 0.85, 1).mul(spill));
    return vec4(fogged(c, P, 0.04), 1);
  })();
  const floor_ = new Mesh(new PlaneGeometry(80, 80), floorMat);
  floor_.rotation.x = -Math.PI / 2;
  floor_.position.y = FLOOR_Y;
  scene.add(floor_);


  // ------------------------------------------------------------------ backdrop: faint haze so the void has depth
  const backMat = new MeshBasicNodeMaterial();
  backMat.toneMapped = false;
  backMat.fog = false;
  backMat.depthWrite = false;
  backMat.colorNode = Fn(() => {
    const u: N = uv();
    const d = length(u.sub(vec2(0.42, 0.55)).mul(vec2(1.6, 1)));
    const haze = exp(d.mul(d).mul(-6)).mul(0.03);
    const n = mx_noise_float(vec3(u.mul(vec2(3, 2)), uTime.mul(0.03))).mul(0.5).add(0.5);
    const horizon = exp(abs(u.y.sub(0.36)).mul(-22)).mul(0.012);
    return vec4(vec3(0.75, 0.8, 0.7).mul(haze.mul(n.mul(0.6).add(0.4)).add(horizon)).add(lime.mul(horizon.mul(0.3))), 1);
  })();
  const back = new Mesh(new PlaneGeometry(90, 50), backMat);
  back.position.set(-2, 8, -34);
  back.renderOrder = -1;
  scene.add(back);

  // ------------------------------------------------------------------ typography: "107×" + counter
  const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const MONO = 'Menlo, "SF Mono", Monaco, monospace';
  const bigCv = document.createElement('canvas');
  bigCv.width = 2048; bigCv.height = 900;
  {
    const g = bigCv.getContext('2d')!;
    g.clearRect(0, 0, 2048, 900);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = `900 760px ${FONT}`;
    (g as any).letterSpacing = '-40px';
    g.fillText('107×', 1024, 760);
  }
  const bigTex = new CanvasTexture(bigCv);
  bigTex.colorSpace = SRGBColorSpace;
  bigTex.anisotropy = 4;
  const uBig = uniform(0);
  const bigMat = new MeshBasicNodeMaterial();
  bigMat.toneMapped = false;
  bigMat.transparent = true;
  bigMat.depthWrite = false;
  bigMat.fog = false;
  bigMat.colorNode = Fn(() => {
    const u: N = uv();
    const a: N = texture(bigTex, u).a;
    const scan = sin(u.y.mul(900)).mul(0.5).add(0.5).mul(0.25).add(0.75);
    // left→right wipe with a bright leading edge
    const wipe = smoothstep(uBig.mul(1.3).sub(0.3), uBig.mul(1.3).sub(0.25), u.x).oneMinus();
    const edge = float(1).sub(smoothstep(0.0, 0.06, abs(u.x.sub(uBig.mul(1.3).sub(0.275))))).mul(step(uBig, 0.99));
    const c = lime.mul(scan).mul(0.85).add(vec3(edge.mul(0.6)));
    return vec4(fogged(c, positionWorld, 0.018), a.mul(wipe).mul(0.95));
  })();
  const big = new Mesh(new PlaneGeometry(7.4, 7.4 * (900 / 2048)), bigMat);
  big.position.copy(BIG_C);
  big.rotation.y = 0.22;
  big.renderOrder = 1;
  scene.add(big);

  const cntCv = document.createElement('canvas');
  cntCv.width = 1024; cntCv.height = 192;
  const cntTex = new CanvasTexture(cntCv);
  cntTex.colorSpace = SRGBColorSpace;
  cntTex.anisotropy = 4;
  let cntLabel = '';
  function drawCounter(v: number, done: number) {
    const label = `${v.toFixed(1)}|${done > 0.5 ? 1 : 0}`;
    if (label === cntLabel) return;
    cntLabel = label;
    const g = cntCv.getContext('2d')!;
    g.clearRect(0, 0, 1024, 192);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.font = `500 34px ${MONO}`;
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.fillText('$ elek test', 8, 44);
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.fillText('# full suite', 600, 44);
    g.font = `700 96px ${MONO}`;
    g.fillStyle = done > 0.5 ? 'rgba(255,255,255,.38)' : 'rgba(255,255,255,.9)';
    g.fillText('192.5s', 600, 150);
    if (done > 0.5) {
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.fillRect(596, 112, 360, 6);
    }
    g.fillStyle = '#c8ff00';
    g.fillText(`${v.toFixed(1)}s`, 8, 150);
    cntTex.needsUpdate = true;
  }
  drawCounter(192.5, 0);
  const cntMat = new MeshBasicNodeMaterial();
  cntMat.toneMapped = false;
  cntMat.transparent = true;
  cntMat.depthWrite = false;
  cntMat.fog = false;
  const uCnt = uniform(0);
  cntMat.colorNode = Fn(() => {
    const t4: N = texture(cntTex, uv());
    return vec4(t4.rgb, t4.a.mul(uCnt));
  })();
  const CNT_W = 3.3;
  const counter = new Mesh(new PlaneGeometry(CNT_W, CNT_W * (192 / 1024)), cntMat);
  counter.renderOrder = 1;
  scene.add(counter);

  // ------------------------------------------------------------------ screenshot panel
  const panel = new Group();
  panel.position.copy(PANEL_C);
  scene.add(panel);
  const blank = makeBlank();
  const uPA = uniform(16 / 10); // current panel aspect (w/h)
  const uAspA = uniform(16 / 10), uAspB = uniform(16 / 10);
  const uMix = uniform(0);
  const uPanelOn = uniform(0);
  const uvP: N = uv();
  const fitUv = (asp: N) => {
    const s = vec2(max(float(1), uPA.div(asp)), max(float(1), asp.div(uPA)));
    return uvP.sub(0.5).mul(s).add(0.5);
  };
  const uvA: N = fitUv(uAspA), uvB: N = fitUv(uAspB);
  const texA: N = texture(blank, uvA);
  const texB: N = texture(blank, uvB);
  const panelMat = new MeshBasicNodeMaterial();
  panelMat.toneMapped = false;
  panelMat.fog = false;
  panelMat.colorNode = Fn(() => {
    const inside = (q: N) => step(0, q.x).mul(step(q.x, 1)).mul(step(0, q.y)).mul(step(q.y, 1));
    const bg = vec3(0.02);
    const cA = mix(bg, texA.rgb, inside(uvA));
    const cB = mix(bg, texB.rgb, inside(uvB));
    // sieve dissolve: the new slide falls into place cell by cell, a lime band at the front
    const cells: N = floor(uvP.mul(vec2(uPA.mul(14), 14)));
    const r = hash(cells.x.add(cells.y.mul(91.0)).add(7.0)).mul(0.45).add(float(1).sub(uvP.y).mul(0.55));
    const m = uMix.mul(1.12);
    const rev = step(r, m);
    const band = step(r, m).sub(step(r, m.sub(0.09)));
    let c: N = mix(cA, cB, rev);
    c = mix(c, lime.mul(0.9), band.mul(0.85).mul(step(0.001, uMix)).mul(step(uMix, 0.999)));
    // slight screen falloff + power-on
    const vig = float(1).sub(smoothstep(0.45, 0.75, length(uvP.sub(0.5))).mul(0.18));
    const on = step(r, uPanelOn.mul(1.12).sub(0.06));
    const onBand = on.sub(step(r, uPanelOn.mul(1.12).sub(0.15)));
    c = c.mul(vig).mul(on).add(lime.mul(onBand.mul(0.8)).mul(step(uPanelOn, 0.999))).add(vec3(0.01));
    return vec4(c.mul(0.97), 1);
  })();
  const screen = new Mesh(new PlaneGeometry(1, 1), panelMat);
  screen.renderOrder = 1;
  panel.add(screen);
  // frame: thin lime bracket corners + a soft halo behind (one draw each)
  const frameMat = new MeshBasicNodeMaterial();
  frameMat.toneMapped = false;
  frameMat.transparent = true;
  frameMat.depthWrite = false;
  frameMat.fog = false;
  const uFrameS = uniform(new Vector3(6, 3.6, 0)); // panel size in world units
  frameMat.colorNode = Fn(() => {
    const u: N = uv();
    const PADW = 0.22;
    const sz: N = uFrameS.xy.add(PADW * 2);
    const p: N = u.sub(0.5).mul(sz); // world units from centre
    const half: N = uFrameS.xy.mul(0.5);
    const off: N = abs(p).sub(half.add(0.07)); // distance outside the bracket line
    const lineW = float(0.012);
    const nearX = float(1).sub(smoothstep(0, lineW, abs(off.x))).mul(step(off.y, 0.0)).mul(step(half.y.sub(0.42), abs(p.y)));
    const nearY = float(1).sub(smoothstep(0, lineW, abs(off.y))).mul(step(off.x, 0.0)).mul(step(half.x.sub(0.42), abs(p.x)));
    const br = max(nearX, nearY);
    // halo: soft glow outside the screen edge
    const dOut = max(abs(p).sub(half), vec2(0));
    const halo = exp(length(dOut).mul(-9)).mul(0.07).mul(step(0.0001, length(dOut)));
    const c = lime.mul(br).add(vec3(0.75, 0.8, 0.85).mul(halo));
    return vec4(c, max(br, halo).mul(uPanelOn));
  })();
  const frame = new Mesh(new PlaneGeometry(1, 1), frameMat);
  frame.position.z = -0.01;
  panel.add(frame);

  // ------------------------------------------------------------------ slides
  let slides: SlideImage[] = ctx.slides ?? [];
  let textures: (Texture | null)[] = [];
  let aspects: number[] = [];
  let shown = -1, target = 0, mixT = 0;
  function makeBlank() {
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 4;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#060606';
    g.fillRect(0, 0, 4, 4);
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    return t;
  }
  async function loadSlides() {
    if (!slides.length) {
      for (const url of [`/projects/${ctx.project.id}/manifest.json`, '/projects/_placeholder/manifest.json']) {
        try {
          const r = await fetch(url);
          if (r.ok) {
            const j = await r.json();
            if (Array.isArray(j) && j.length) { slides = j; break; }
          }
        } catch { /* try next */ }
      }
    }
    const loader = new TextureLoader();
    if (slides.length) {
      const res = await Promise.all(slides.map(async (s) => {
        try {
          const t = await loader.loadAsync(s.src);
          t.colorSpace = SRGBColorSpace;
          t.anisotropy = 8;
          return t;
        } catch (e) {
          console.warn('elek: slide failed to load', s.src, e);
          return null;
        }
      }));
      textures = res.map((t, i) => t ?? generated(i));
      aspects = slides.map((s, i) => (res[i] ? s.w / s.h : 16 / 10));
    } else {
      textures = [0, 1, 2].map((i) => generated(i));
      aspects = textures.map(() => 16 / 10);
    }
  }
  /** fallback screenshots, only used when neither the manifest nor the placeholder images load */
  function generated(i: number): Texture {
    const cv = document.createElement('canvas');
    cv.width = 1600; cv.height = 1000;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#0c0c0c'; g.fillRect(0, 0, 1600, 1000);
    g.fillStyle = '#c8ff00'; g.font = `900 150px ${FONT}`;
    g.fillText(['elek', '107×', '1.8s'][i % 3], 90, 300);
    g.font = `500 34px ${MONO}`;
    const lines = ['$ elek test', 'scanning 412 tests …', '3 affected by your change', 'skipped 409 (already green)', 'done in 1.8s'];
    lines.forEach((l, k) => { g.fillStyle = k === 4 ? '#c8ff00' : 'rgba(255,255,255,.75)'; g.fillText(l, 90, 470 + k * 70); });
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    return t;
  }
  function panelSize(asp: number) {
    const w = Math.min(PANEL_BOX.w, PANEL_BOX.h * asp);
    return [w, w / asp];
  }

  // ------------------------------------------------------------------ per-frame
  const eye = new Vector3(), look = new Vector3(), tmpA = new Vector3(), tmpB = new Vector3(), tmpC = new Vector3();
  const m4 = new Matrix4();
  const qSieve = new Quaternion();
  const baseQ = new Quaternion().setFromEuler(SIEVE_TILT);
  const shakeE = new Euler();
  const ex = new Vector3(), ey = new Vector3(), ez = new Vector3();
  const downW = new Vector3(0, -1, 0);
  const par = { x: 0, y: 0 };
  // arrive / depart control points
  const A0 = SIEVE_C.clone().add(new Vector3(0.9, 6.6, 2.9));
  const A1 = SIEVE_C.clone().add(new Vector3(1.6, 3.2, 9.0));
  const D1 = SIEVE_C.clone().add(new Vector3(1.4, 3.6, 4.2));
  const D2 = SIEVE_C.clone().add(new Vector3(0.0, -1.5, 0.3));
  const TA0 = SIEVE_C.clone().add(new Vector3(0, 0.0, -0.6));
  const TD1 = SIEVE_C.clone().add(new Vector3(0, -0.2, 0));
  const TD2 = SIEVE_C.clone().add(new Vector3(0.0, -8, -1.4));

  function pose(t: number, time: number, aspect: number) {
    let fov = 36;
    // portrait screens: back the camera off so panel + sieve fit horizontally
    const fit = Math.max(1, 1.55 / Math.max(0.4, aspect));
    const holdEye = tmpC.copy(HOLD_EYE);
    holdEye.z = HOLD_TARGET.z + (HOLD_EYE.z - HOLD_TARGET.z) * fit;
    if (t < ARRIVE_END) {
      const e = easeInOut(inv(-0.02, ARRIVE_END, t));
      bez(eye, A0, A1, holdEye, e);
      if (t < 0) eye.y += -t * 4;
      look.copy(TA0).lerp(HOLD_TARGET, sstep(0.0, 1, e));
      fov = lerp(52, 36, sstep(0, 1, e));
    } else if (t < DEPART_START) {
      const h = inv(ARRIVE_END, DEPART_START, t);
      eye.copy(holdEye);
      eye.z -= h * 0.9;
      eye.x += Math.sin(h * Math.PI) * 0.25 - 0.1 + h * 0.2;
      eye.y += Math.sin(time * 0.31) * 0.04;
      look.copy(HOLD_TARGET);
      look.y += Math.sin(time * 0.23) * 0.03;
    } else {
      const d = easeInOut(inv(DEPART_START, 1.0, t));
      tmpA.copy(holdEye); tmpA.z -= 0.9; tmpA.x += 0.1;
      bez(eye, tmpA, D1, D2, d);
      if (t > 1) eye.y -= (t - 1) * 6;
      bez(look, HOLD_TARGET, TD1, TD2, Math.min(1, d * 1.05));
      fov = lerp(36, 58, sstep(0.55, 1, d));
    }
    // pointer / tilt parallax: shift the eye, keep the look point (strongest during hold)
    const w = sstep(0.1, 0.3, t) * (1 - sstep(0.85, 0.95, t));
    eye.x += par.x * 0.55 * w;
    eye.y += -par.y * 0.3 * w;
    camera.position.copy(eye);
    m4.lookAt(eye, look, tmpB.set(0, 1, 0));
    camera.quaternion.setFromRotationMatrix(m4);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    (uCamR.value as Vector3).setFromMatrixColumn(camera.matrixWorld, 0);
    (uCamU.value as Vector3).setFromMatrixColumn(camera.matrixWorld, 1);
  }

  let ready_ = false;
  function update(f: StageFrame) {
    const t = f.t;
    uTime.value = f.time;
    par.x = f.parallax.x; par.y = f.parallax.y;
    pose(t, f.time, f.aspect || camera.aspect);

    // sieve: gentle sifting shake (bursts every few seconds) + idle sway
    const burst = Math.pow(Math.max(0, Math.sin(f.time * 0.9)), 6);
    const sh = 0.008 + burst * 0.03;
    shakeE.set(Math.sin(f.time * 11.0) * sh, Math.sin(f.time * 0.5) * 0.04, Math.cos(f.time * 11.0) * sh + Math.sin(f.time * 0.37) * 0.02);
    qSieve.setFromEuler(shakeE).premultiply(baseQ);
    sieve.quaternion.copy(qSieve);
    sieve.position.set(SIEVE_C.x + Math.sin(f.time * 11) * burst * 0.025, SIEVE_C.y + Math.sin(f.time * 0.6) * 0.05, SIEVE_C.z);
    sieve.updateMatrixWorld();
    ex.set(1, 0, 0).applyQuaternion(qSieve);
    ey.set(0, 1, 0).applyQuaternion(qSieve);
    ez.set(0, 0, 1).applyQuaternion(qSieve);
    (uC.value as Vector3).copy(sieve.position);
    (uSX.value as Vector3).copy(ex);
    (uSY.value as Vector3).copy(ey);
    (uSZ.value as Vector3).copy(ez);
    const dn = (uDown.value as Vector3).copy(downW).addScaledVector(ey, -downW.dot(ey)).normalize();
    (uSide.value as Vector3).crossVectors(ey, dn).normalize();
    uPulse.value = 0.5 + 0.5 * Math.sin(f.time * 2.3);

    // type: counter rolls down during hold, 107× wipes on
    const k = inv(0.27, 0.47, t);
    const v = 192.5 * Math.pow(1.8 / 192.5, easeInOut(k));
    drawCounter(v, k >= 1 ? 1 : 0);
    uCnt.value = sstep(0.2, 0.27, t);
    const bigOn = inv(0.36, 0.5, t);
    const flick = bigOn > 0 && bigOn < 1 ? (Math.sin(f.time * 60) > 0.2 ? 1 : 0.6) : 1;
    uBig.value = easeInOut(bigOn) * flick;

    // slides: crossfade on dt (≤ 600 ms)
    if (textures.length) {
      const n = textures.length;
      const want = ((Math.round(f.slide) % n) + n) % n;
      if (shown < 0) {
        shown = want; target = want; mixT = 0;
        texA.value = textures[shown]; uAspA.value = aspects[shown];
        texB.value = textures[shown]; uAspB.value = aspects[shown];
      }
      if (want !== target && mixT === 0) {
        target = want;
        texB.value = textures[target]; uAspB.value = aspects[target];
        mixT = 1e-4;
      } else if (want !== target && mixT > 0) {
        // retarget: finish the running one instantly, then start the new one
        shown = target; texA.value = textures[shown]; uAspA.value = aspects[shown];
        target = want; texB.value = textures[target]; uAspB.value = aspects[target];
        mixT = 1e-4;
      }
      if (mixT > 0) {
        mixT += f.dt / 0.55;
        if (mixT >= 1) {
          shown = target; texA.value = textures[shown]; uAspA.value = aspects[shown];
          mixT = 0;
        }
      }
      uMix.value = mixT;
      const aspNow = lerp(aspects[shown], aspects[target], easeInOut(clamp01(mixT)));
      uPA.value = aspNow;
      const [w, h] = panelSize(aspNow);
      screen.scale.set(w, h, 1);
      (uFrameS.value as Vector3).set(w, h, 0);
      frame.scale.set(w + 0.44, h + 0.44, 1);
      // counter sits on the panel's top-left edge
      counter.position.set(PANEL_C.x - w / 2 + CNT_W / 2 - 0.02, PANEL_C.y + h / 2 + 0.48, PANEL_C.z + 0.02);
    }
    uPanelOn.value = ready_ ? sstep(0.08, 0.24, t) : 0;
    panel.visible = uPanelOn.value > 0.001;
    panel.position.set(PANEL_C.x, PANEL_C.y + Math.sin(f.time * 0.7) * 0.025, PANEL_C.z);
    // the panel faces the hold camera (legibility)
    panel.rotation.y = Math.atan2(HOLD_EYE.x - PANEL_C.x, HOLD_EYE.z - PANEL_C.z) * 0.9;
    counter.rotation.y = panel.rotation.y;
  }

  const ready = (async () => {
    const [gltf] = await Promise.all([
      new GLTFLoader().loadAsync('/worlds/elek/sieve.glb').catch((e) => {
        console.warn('elek: sieve.glb missing', e);
        return null;
      }),
      loadSlides(),
    ]);
    if (gltf) {
      gltf.scene.traverse((o: any) => {
        if (o.isMesh) {
          const m = new Mesh(o.geometry as BufferGeometry, rimMat);
          o.updateWorldMatrix(true, false);
          m.applyMatrix4(o.matrixWorld);
          sieve.add(m);
        }
      });
    }
    ready_ = true;
    try {
      await ctx.renderer.compileAsync(scene, camera);
    } catch (e) {
      console.warn('elek: warm-up', e);
    }
  })();

  return {
    id: `world-${ctx.project.id}`,
    scene,
    camera,
    background: BG,
    ready,
    update,
    dispose() {
      for (const t of textures) t?.dispose();
      bigTex.dispose();
      cntTex.dispose();
      scene.traverse((o: any) => {
        if (o.isMesh) {
          o.geometry?.dispose();
          o.material?.dispose?.();
        }
      });
    },
  };
}
