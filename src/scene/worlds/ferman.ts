/**
 * Ferman world (project #1): a giant imperial edict scroll unfurls in a dim vaulted hall. The featured screenshot
 * is set into the scroll as a gilded, illuminated panel; a cartouche above it reads the rollout state, with the
 * wax seal stamped beside it. Glowing "patch" sparks leave the cartouche and arc to the devices in the two niche
 * cabinets flanking the scroll (and to the rows on the floor tiers), whose screens fill as the staged rollout
 * advances with scroll: beta 10% (t≈.29) → stable 50% (t≈.49) → stable 100% (t≈.69).
 *
 * Timeline (local t):  0 → .22 arrive (fly up the aisle while the scroll unrolls)
 *                     .22 → .82 hold (panel framed for legibility, slow drift, rollout waves)
 *                     .82 → 1   depart (crane up past the emblem into the vault glow)
 *
 * Draws (19): bays (instanced) · end wall + cabinets · tiers · paper · panel · rollers ×2 · seal · devices ×3 (instanced)
 *               · screens (instanced) · sparks · light shafts · dust · halo.
 * Geometry: public/worlds/ferman/ferman.glb (tools/blender/worlds/ferman/build.py). Paper, emblem, screen labels
 * and the readout are drawn into canvases at runtime (original artwork; the emblem is an abstract composition).
 */
import {
  Scene, Color, PerspectiveCamera, Mesh, InstancedMesh, PlaneGeometry, BufferGeometry, InstancedBufferAttribute,
  MeshBasicNodeMaterial, CanvasTexture, TextureLoader, SRGBColorSpace, NoColorSpace, DoubleSide, AdditiveBlending,
  Matrix4, Vector3, Quaternion, Euler, Object3D, type Texture,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, attribute, varying, texture, instancedBufferAttribute, positionGeometry,
  positionWorld, normalWorld, cameraPosition, uv, mix, smoothstep, clamp, max, min, pow, exp, length, normalize, dot,
  sin, cos, fract, abs, reflect, cross, select, frontFacing, step,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Stage, StageFrame, ProjectWorldContext, SlideImage } from '../journey/types';

type N = any; // TSL node (loosely typed on purpose)

// ------------------------------------------------------------------ layout (metres, y up, hall runs toward -z)
const PW = 3.5;          // paper width
const PL = 8.0;          // paper length
const YTOP = 8.4;        // paper top (under the top roller)
const RB = 0.17;         // radius of the outer turn of the bottom roll
const SC = 3.95;         // image centre, distance down the paper
const FB = 0.1;          // frame border
const TABH = 0.36, TABW = 1.7;
const IMG_MAX_W = 2.9, IMG_MAX_H = 2.25;
const BAYS = 9;
const FOV = 45;
// device cabinets flanking the scroll (match build.py)
const CAB_A = 1.95, CAB_B = 4.25, CAB_Y0 = 3.0, CAB_DY = 0.92, CAB_ROWS = 4, CAB_ZD = -0.98, CAB_S = 0.55;

const NAVY = new Color('#0a0f1a');
const GOLD = new Color('#e8b04a');
const PALE = new Color('#d9e2ef');

// lights (shared by every lit material)
const KEY_P = new Vector3(1.5, 11, 9), KEY_C = new Color(1.0, 0.8, 0.55).multiplyScalar(1.5), KEY_K = 0.004;
const KEY_AIM = new Vector3(0, 4.2, 0).sub(KEY_P).normalize();
const LAMP_P = new Vector3(0, 1.8, 3.4), LAMP_C = new Color(1.0, 0.62, 0.26).multiplyScalar(0.9), LAMP_K = 0.22;
const SCR_P = new Vector3(0, 4.6, 0.7), SCR_C = new Color(1.0, 0.78, 0.48).multiplyScalar(1.15), SCR_K = 0.16;
const MOON_D = new Vector3(-0.55, 0.8, 0.15).normalize(), MOON_C = new Color(0.32, 0.42, 0.75).multiplyScalar(0.32);
const SHAFT_D = new Vector3(0.55, -0.8, -0.12).normalize();

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const v3 = (c: Color | Vector3) => (c instanceof Color ? vec3(c.r, c.g, c.b) : vec3(c.x, c.y, c.z));

/** rollout fraction for local t: beta 10% → stable 50% → stable 100% */
export const rolloutAt = (t: number) => 0.1 * sstep(0.23, 0.29, t) + 0.4 * sstep(0.42, 0.49, t) + 0.5 * sstep(0.62, 0.69, t);

export function createWorld(ctx: ProjectWorldContext): Stage {
  const high = ctx.quality === 'high';
  const scene = new Scene();
  scene.background = NAVY.clone();
  const camera = new PerspectiveCamera(FOV, 16 / 10, 0.05, 140);
  camera.position.set(0, 2, 20);

  // ---------------------------------------------------------------- uniforms
  const uTime = uniform(0);
  const uL = uniform(PL);                     // unrolled length
  const uRollout = uniform(0);
  const uWp = uniform(IMG_MAX_W), uHp = uniform(IMG_MAX_W / 1.68);
  const uMix = uniform(0);                    // slide crossfade
  const uAspA = uniform(1.68), uAspB = uniform(1.68);
  const uOrigin = uniform(new Vector3(0, 5.8, 0.1));
  const uCamR = uniform(new Vector3(1, 0, 0)), uCamU = uniform(new Vector3(0, 1, 0));
  const uGleam = uniform(-5);
  const uShow = uniform(1);                   // global fade-in of sparks/screens energy

  // ---------------------------------------------------------------- shared lighting
  const tonemap = (c: N) => clamp(c.mul(c.mul(2.51).add(0.03)).div(c.mul(c.mul(2.43).add(0.59)).add(0.14)), 0, 1);
  const fogged = (c: N, P: N) => {
    const toP = P.sub(cameraPosition);
    const dist = length(toP);
    const fd = dist.mul(0.03);
    const f = float(1).sub(exp(fd.mul(fd).negate()));
    const hf = exp(P.y.mul(-0.45)).mul(0.25).mul(float(1).sub(exp(dist.mul(-0.06))));
    const toward = max(dot(normalize(toP), normalize(v3(SCR_P).sub(cameraPosition))), 0);
    const fogC = v3(NAVY).mul(1.6).add(v3(GOLD).mul(pow(toward, 10).mul(0.07)));
    return mix(c, fogC, clamp(f.add(hf), 0, 1));
  };
  const pointL = (P: N, Nn: N, V: N, pos: Vector3, col: Color, k: number, shin: N, spot?: Vector3) => {
    const D = v3(pos).sub(P);
    const d2 = dot(D, D);
    const L = D.div(d2.sqrt());
    let att: N = float(1).div(d2.mul(k).add(1));
    if (spot) att = att.mul(smoothstep(Math.cos((24 * Math.PI) / 180), Math.cos((13 * Math.PI) / 180), dot(L.negate(), v3(spot))));
    const H = normalize(L.add(V));
    const nl = max(dot(Nn, L), 0);
    return {
      d: v3(col).mul(nl.mul(att)),
      s: v3(col).mul(pow(max(dot(Nn, H), 0), shin).mul(att).mul(select(nl.greaterThan(0), float(1), float(0)))),
    };
  };
  /** albedo + class (see build.py) → final colour (fogged, tonemapped) */
  const lit = (P: N, Nraw: N, alb: N, cls: N) => {
    const V = normalize(cameraPosition.sub(P));
    const n0 = normalize(Nraw);
    const Nn = select(dot(n0, V).lessThan(0), n0.negate(), n0);
    const band = (a: number, b: number) => smoothstep(a - 0.05, a, cls).mul(float(1).sub(smoothstep(b, b + 0.05, cls)));
    const recess = band(0.15, 0.25), floorK = band(0.35, 0.45), gold = band(0.55, 0.65), gloss = band(0.75, 0.85);
    const win = smoothstep(0.9, 0.95, cls);
    const shin = mix(float(14), float(70), gold.add(gloss));
    const a0 = pointL(P, Nn, V, KEY_P, KEY_C, KEY_K, shin, KEY_AIM);
    // the key is a narrow vertical slot of light on the scroll; the flanks fall back into the dark
    const kx = max(abs(P.x).sub(1.7), 0);
    const keyMask = exp(kx.mul(kx).mul(-2.2)).mul(0.85).add(0.15).mul(float(1).sub(recess.mul(0.75)));
    const a = { d: a0.d.mul(keyMask), s: a0.s.mul(keyMask) };
    const b = pointL(P, Nn, V, LAMP_P, LAMP_C, LAMP_K, shin);
    const c = pointL(P, Nn, V, SCR_P, SCR_C, SCR_K, shin);
    // moonlight through the high windows of the left wall: lit patches where a shaft lands
    const sh0 = P.x.add(8.4).div(SHAFT_D.x);
    const sq = P.sub(v3(SHAFT_D).mul(sh0));
    const sdz = fract(sq.z.add(0.6).div(4)).sub(0.5).mul(4);
    const inShaft = exp(pow(sq.y.sub(6.9), 2).div(-0.35).sub(sdz.mul(sdz).div(0.18))).mul(step(0, sh0));
    const moon = v3(MOON_C).mul(max(dot(Nn, v3(MOON_D)), 0).mul(inShaft.mul(5).add(0.25)));
    const amb = mix(vec3(0.006, 0.009, 0.02), vec3(0.016, 0.024, 0.05), Nn.y.mul(0.5).add(0.5));
    // floor: tile grout + gold inlay along the aisle
    const g = fract(P.xz.div(1.4));
    const grout = smoothstep(0.0, 0.025, min(min(g.x, g.y), min(float(1).sub(g.x), float(1).sub(g.y))));
    const inlay = float(1).sub(smoothstep(0.015, 0.04, abs(abs(P.x).sub(2.05))));
    const albF = mix(alb.mul(mix(float(0.55), float(1), grout)), v3(GOLD).mul(0.55), inlay.mul(step(0.1, P.z)));
    const albedo = mix(alb.mul(float(1).sub(recess.mul(0.2))), albF, floorK);
    const ks = float(0.03).add(gold.mul(1.4)).add(gloss.mul(0.7)).add(floorK.mul(0.35).add(inlay.mul(floorK)));
    const specTint = mix(vec3(1, 1, 1), albedo.mul(1.6), gold);
    // cool spill from the device screens inside the cabinets
    const inCab = smoothstep(CAB_A - 0.2, CAB_A + 0.1, abs(P.x)).mul(float(1).sub(smoothstep(CAB_B - 0.1, CAB_B + 0.3, abs(P.x))))
      .mul(smoothstep(CAB_Y0 - 0.4, CAB_Y0, P.y)).mul(float(1).sub(smoothstep(CAB_Y0 + CAB_DY * CAB_ROWS, CAB_Y0 + CAB_DY * CAB_ROWS + 0.4, P.y)))
      .mul(float(1).sub(smoothstep(-0.7, -0.4, P.z)));
    const scrSpill = vec3(0.25, 0.4, 0.95).mul(inCab.mul(0.55).mul(float(0.7).add(uRollout.mul(0.3))));
    let col: N = albedo.mul(a.d.add(b.d).add(c.d.mul(float(1).sub(inCab.mul(0.6)))).add(moon).add(amb).add(scrSpill)).add(a.s.add(b.s).add(c.s).mul(ks).mul(specTint));
    // polished floor: blurred reflection of the lit scroll (ray → plane z = 0)
    const R = reflect(V.negate(), Nn);
    const tt = clamp(P.z.negate().div(min(R.z, -0.001)), 0, 80);
    const hit = P.add(R.mul(tt));
    const blur = tt.mul(0.05).add(0.08);
    const inX2 = float(1).sub(smoothstep(float(PW / 2).sub(blur), float(PW / 2).add(blur), abs(hit.x)));
    const inY = smoothstep(float(YTOP).sub(uL).sub(blur), float(YTOP).sub(uL).add(blur), hit.y)
      .mul(float(1).sub(smoothstep(float(YTOP).sub(blur), float(YTOP).add(blur), hit.y)));
    const refl = vec3(0.85, 0.62, 0.34).mul(inX2.mul(inY).mul(exp(tt.mul(-0.07))).mul(0.32)).mul(step(R.z, 0));
    col = col.add(refl.mul(floorK));
    col = mix(col, alb.mul(2.6), win);
    return tonemap(fogged(col, P));
  };

  // ---------------------------------------------------------------- paper deformation (shader + CPU mirror)
  const paperPos = (u: N, s: N) => {
    const x = u.sub(0.5).mul(PW);
    const fl = s.min(uL);
    const sway = sin(uTime.mul(0.31)).mul(0.006);
    const wave = (ss: N) => sin(ss.mul(0.9).sub(uTime.mul(0.7)).add(x.mul(0.5))).mul(0.03).mul(smoothstep(0, 1.6, ss))
      .add(x.mul(x).mul(0.012)).add(ss.mul(sway));
    const flat = vec3(x, float(YTOP).sub(fl), wave(fl));
    const phi = max(s.sub(uL), 0).div(RB);
    const r = max(float(RB).sub(phi.mul(0.0016)), 0.085);
    const roll = vec3(x, float(YTOP).sub(uL).sub(r.mul(sin(phi))), wave(uL).add(float(RB).sub(r.mul(cos(phi)))).add(r.sub(RB).mul(0)));
    return select(s.lessThanEqual(uL), flat, roll);
  };
  const paperPosCPU = (u: number, s: number, out: Vector3) => {
    const t = uTime.value as number, L = uL.value as number;
    const x = (u - 0.5) * PW;
    const sway = Math.sin(t * 0.31) * 0.006;
    const wave = (ss: number) => Math.sin(ss * 0.9 - t * 0.7 + x * 0.5) * 0.03 * sstep(0, 1.6, ss) + x * x * 0.012 + ss * sway;
    if (s <= L) return out.set(x, YTOP - s, wave(s));
    const phi = (s - L) / RB, r = Math.max(RB - phi * 0.0016, 0.085);
    return out.set(x, YTOP - L - r * Math.sin(phi), wave(L) + RB - r * Math.cos(phi));
  };
  const paperFrame = (u: N, s: N, du: number, ds: number) => {
    const p = paperPos(u, s);
    const pu = paperPos(u.add(du), s);
    const ps = paperPos(u, s.add(ds));
    const n = normalize(cross(ps.sub(p), pu.sub(p)));
    return { p, n };
  };

  // ---------------------------------------------------------------- textures drawn at runtime
  const paperArt = drawPaper();
  const paperTex = new CanvasTexture(paperArt.color);
  paperTex.colorSpace = SRGBColorSpace;
  paperTex.anisotropy = 8;
  const maskTex = new CanvasTexture(paperArt.mask);
  maskTex.colorSpace = NoColorSpace;
  const atlasTex = new CanvasTexture(drawAtlas());
  atlasTex.colorSpace = NoColorSpace;
  atlasTex.anisotropy = 4;
  const readout = makeReadout();
  const readoutTex = new CanvasTexture(readout.canvas);
  readoutTex.colorSpace = SRGBColorSpace;
  readoutTex.anisotropy = 8;

  const gleamAt = (P: N) => exp(pow(P.x.mul(0.6).add(P.y.mul(0.8)).sub(uGleam), 2).mul(-3));

  // ---------------------------------------------------------------- paper
  {
    const geo = new PlaneGeometry(1, 1, 20, high ? 280 : 200);
    const mat = new MeshBasicNodeMaterial({ side: DoubleSide });
    const u0: N = uv();
    const fr = paperFrame(u0.x, float(1).sub(u0.y).mul(PL), 0.01, 0.02);
    mat.positionNode = fr.p;
    const vP: N = varying(fr.p, 'vFerPaperP');
    const vN: N = varying(fr.n, 'vFerPaperN');
    mat.colorNode = Fn(() => {
      const st: N = uv();
      const s = float(1).sub(st.y).mul(PL);
      const base = texture(paperTex, st).rgb;
      const m = texture(maskTex, st).r;
      const V = normalize(cameraPosition.sub(vP));
      const n0 = normalize(vN);
      const Nn = select(frontFacing, n0, n0.negate());
      const shin = mix(float(10), float(60), m);
      const a = pointL(vP, Nn, V, KEY_P, KEY_C, KEY_K, shin, KEY_AIM);
      const b = pointL(vP, Nn, V, LAMP_P, LAMP_C, LAMP_K, shin);
      const amb = vec3(0.05, 0.05, 0.07);
      const back = vec3(0.32, 0.25, 0.16);
      const alb = select(frontFacing, base, back);
      // roll shadow just above the bottom roll, and contact darkening under the top roller
      const sh = mix(float(0.55), float(1), smoothstep(0, 0.5, uL.sub(s))).mul(mix(float(0.6), float(1), smoothstep(0, 0.25, s)));
      // a warm pool of light centred on the panel; the top and bottom of the long sheet fall off into the dark
      const pr = vP.xy.sub(vec2(0, YTOP - SC + 0.2));
      const pool = mix(float(0.32), float(1), exp(dot(pr, pr).mul(-0.1)));
      let c: N = alb.mul(0.52).mul(a.d.add(b.d).mul(sh).mul(pool).add(amb)).add(alb.mul(0.035).mul(pool)); // faint translucency glow
      // gold leaf: metallic tint, specular, and a slow gleam sweeping over the paper
      const goldLeaf = v3(GOLD).mul(a.d.add(b.d).mul(0.55).add(0.16)).add(v3(GOLD).mul(a.s.add(b.s).mul(1.2)))
        .add(v3(GOLD).mul(gleamAt(vP).mul(1.4)));
      c = mix(c, goldLeaf.mul(sh), m.mul(select(frontFacing, float(1), float(0))));
      return vec4(tonemap(fogged(c, vP)), 1);
    })();
    mat.toneMapped = false;
    mat.fog = false;
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- framed screenshot panel + readout cartouche
  const slideTexA = texture(placeholderTex());
  const slideTexB = texture(placeholderTex());
  {
    const geo = new PlaneGeometry(1, 1, 14, 18);
    const mat = new MeshBasicNodeMaterial({ side: DoubleSide });
    const q: N = uv();
    const Wq = max(uWp.add(2 * FB), TABW);
    const Hq = uHp.add(2 * FB + TABH);
    const sTop = float(SC).sub(uHp.mul(0.5)).sub(FB + TABH);
    const uu = q.x.sub(0.5).mul(Wq).div(PW).add(0.5);
    const ss = sTop.add(float(1).sub(q.y).mul(Hq));
    const fr = paperFrame(uu, ss, 0.01, 0.02);
    mat.positionNode = fr.p.add(fr.n.mul(0.012));
    const vP: N = varying(fr.p, 'vFerPanelP');
    const vS: N = varying(ss, 'vFerPanelS');
    const opaque = () => {
      const st: N = uv();
      const xm = st.x.sub(0.5).mul(Wq);
      const ym = st.y.mul(Hq).sub(uHp.mul(0.5).add(FB)); // 0 = image centre
      const hw = uWp.mul(0.5), hh = uHp.mul(0.5);
      const inImg = step(abs(xm), hw).mul(step(abs(ym), hh));
      const inFrame = step(abs(xm), hw.add(FB)).mul(step(abs(ym), hh.add(FB)));
      const tr = TABH / 2;
      const yc = hh.add(FB + tr - 0.03);
      const dx = max(abs(xm).sub(TABW / 2 - tr), 0);
      const tabD = length(vec2(dx, ym.sub(yc)));
      const inTab = step(tabD, tr);
      return { xm, ym, hw, hh, inImg, inFrame, inTab, tabD, yc };
    };
    const o = opaque();
    mat.opacityNode = max(o.inFrame, o.inTab).mul(step(vS, uL.sub(0.02)));
    mat.alphaTest = 0.5;
    mat.colorNode = Fn(() => {
      const { xm, ym, hw, hh, inImg, inTab, tabD, yc } = o;
      // ---- image (contain-fit for each slot, diagonal gilded wipe between them)
      const iu = xm.div(uWp).add(0.5), iv = ym.div(uHp).add(0.5);
      const regA = uWp.div(uHp);
      const fit = (asp: N) => {
        const kx = min(asp.div(regA), 1), ky = min(regA.div(asp), 1); // fraction of the region the image covers
        const fu = iu.sub(0.5).div(kx).add(0.5), fv = iv.sub(0.5).div(ky).add(0.5);
        const inside = step(0, fu).mul(step(fu, 1)).mul(step(0, fv)).mul(step(fv, 1));
        return { uvv: vec2(fu, fv), inside };
      };
      const fa = fit(uAspA), fb = fit(uAspB);
      const ca = mix(vec3(0.004, 0.006, 0.014), slideTexA.sample(fa.uvv).rgb, fa.inside);
      const cb = mix(vec3(0.004, 0.006, 0.014), slideTexB.sample(fb.uvv).rgb, fb.inside);
      const d = iu.mul(0.75).add(float(1).sub(iv).mul(0.25));
      const w = uMix.mul(1.3).sub(0.15);
      const showB = float(1).sub(smoothstep(w.sub(0.01), w, d));
      const edge = exp(pow(d.sub(w).div(0.025), 2).negate()).mul(step(0.001, uMix)).mul(step(uMix, 0.999));
      const edgeIn = min(min(hw.sub(abs(xm)), hh.sub(abs(ym))), 0.2).div(0.2);
      let img: N = mix(ca, cb, showB).mul(mix(float(0.78), float(1), smoothstep(0, 0.12, edgeIn)));
      img = img.add(v3(GOLD).mul(edge.mul(1.6)));
      // ---- gilt frame: moulded profile with a bead row
      const e = min(hw.add(FB).sub(abs(xm)), hh.add(FB).sub(abs(ym))).div(FB); // 0 outer edge → 1 inner edge
      const prof = mix(float(0.35), float(1), pow(abs(sin(e.mul(Math.PI * 1.5))), 0.6));
      const along = select(abs(xm).sub(hw).greaterThan(abs(ym).sub(hh)), ym, xm);
      const bead = float(1).sub(smoothstep(0.3, 0.42, length(vec2(fract(along.div(0.06)).sub(0.5), e.sub(0.78).div(0.12).mul(0.5)))));
      const gl = gleamAt(vP);
      const frameC = v3(GOLD).mul(prof.mul(0.62).add(bead.mul(0.35))).mul(float(0.75).add(gl.mul(1.6))).add(gl.mul(0.25));
      // ---- cartouche: gold rim, navy field, readout text
      const rim = smoothstep(TABH / 2 - 0.035, TABH / 2 - 0.025, tabD);
      const ru = xm.div(TABW).add(0.5), rv = ym.sub(yc).div(TABH).add(0.5);
      const rt = texture(readoutTex, vec2(ru, rv)).rgb;
      const tabC = mix(rt.mul(1.15), v3(GOLD).mul(float(0.7).add(gl.mul(1.4))), rim);
      const isTab = inTab.mul(step(hh.add(FB * 0.5), ym));
      let c: N = mix(frameC, img, inImg);
      c = mix(c, tabC, isTab);
      // image stays unlit; the gold gets the hall's tonemap curve
      return vec4(select(inImg.mul(float(1).sub(isTab)).greaterThan(0.5), c, tonemap(c)), 1);
    })();
    mat.toneMapped = false;
    mat.fog = false;
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- halo behind the scroll + light shafts
  {
    const geo = new PlaneGeometry(9, 12);
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const st: N = uv();
    const r = length(st.sub(vec2(0.5, 0.55)).mul(vec2(1.25, 1)));
    mat.colorNode = vec4(v3(GOLD).mul(exp(r.mul(r).mul(-9)).mul(0.33).add(exp(r.mul(-7)).mul(0.08))), 1);
    mat.toneMapped = false;
    const halo = new Mesh(geo, mat);
    halo.position.set(0, 5.0, -0.45);
    scene.add(halo);
  }
  const shafts: { start: Vector3; dir: Vector3; len: number; width: number; col: Color }[] = [];
  for (let k = 0; k < BAYS; k++) shafts.push({ start: new Vector3(-8.4, 6.9, -0.6 + 4 * k), dir: SHAFT_D.clone(), len: 13, width: 0.75, col: new Color(0.45, 0.58, 1).multiplyScalar(0.11) });
  shafts.push({ start: new Vector3(0, 13.2, -3.5), dir: new Vector3(0, -0.88, 0.47).normalize(), len: 13, width: 2.6, col: GOLD.clone().multiplyScalar(0.09) });
  {
    const n = shafts.length;
    const A = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const Bv = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const C = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    shafts.forEach((s, i) => {
      A.setXYZW(i, s.start.x, s.start.y, s.start.z, s.len);
      Bv.setXYZW(i, s.dir.x, s.dir.y, s.dir.z, s.width);
      C.setXYZW(i, s.col.r, s.col.g, s.col.b, i);
    });
    const a: N = instancedBufferAttribute(A, 'vec4'), b: N = instancedBufferAttribute(Bv, 'vec4'), c: N = instancedBufferAttribute(C, 'vec4');
    const along = positionGeometry.y.add(0.5);
    const p0 = a.xyz.add(b.xyz.mul(along.mul(a.w)));
    const side = normalize(cross(b.xyz, cameraPosition.sub(p0)));
    const wdt = b.w.mul(along.mul(1.6).add(0.6));
    const geo = new PlaneGeometry(1, 1, 1, 8);
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    mat.positionNode = p0.add(side.mul(positionGeometry.x.mul(wdt)));
    const vA: N = varying(along, 'vFerShaftA');
    const vC: N = varying(c, 'vFerShaftC');
    mat.colorNode = Fn(() => {
      const st: N = uv();
      const across = exp(pow(st.x.sub(0.5).mul(2.6), 2).negate());
      const fade = smoothstep(0, 0.12, vA).mul(float(1).sub(smoothstep(0.55, 1, vA)));
      const flick = sin(vA.mul(9).sub(uTime.mul(0.4)).add(vC.w.mul(1.7))).mul(0.18).add(0.82);
      return vec4(vC.rgb.mul(across.mul(fade).mul(flick)), 1);
    })();
    mat.toneMapped = false;
    const mesh = new Mesh(geo, mat);
    (mesh as any).count = n;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- dust motes
  {
    const n = high ? 420 : 240;
    const A = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    for (let i = 0; i < n; i++) A.setXYZW(i, (hash(i) - 0.5) * 14, hash(i + 0.31) * 11, -2 + hash(i + 0.77) * 24, hash(i + 0.13));
    const a: N = instancedBufferAttribute(A, 'vec4');
    const t = uTime.mul(0.04).add(a.w.mul(7));
    const p = vec3(a.x.add(sin(t.mul(3).add(a.w.mul(20))).mul(0.4)), fract(a.y.div(11).add(t.mul(0.3))).mul(11), a.z.add(cos(t.mul(2.3)).mul(0.4)));
    // brightness: inside a window shaft (project back to the left wall) or near the scroll
    const t0 = p.x.add(8.4).div(SHAFT_D.x);
    const qx = p.sub(v3(SHAFT_D).mul(t0));
    const dzz = fract(qx.z.add(0.6).div(4)).sub(0.5).mul(4);
    const inShaft = exp(pow(qx.y.sub(6.9), 2).div(-0.5).sub(dzz.mul(dzz).div(0.35)));
    const nearScroll = exp(length(p.sub(vec3(0, 4.8, 0.8))).mul(-0.45));
    const br = inShaft.mul(0.9).add(nearScroll.mul(1.2)).add(0.06);
    const size = a.w.mul(0.018).add(0.012);
    const geo = new PlaneGeometry(1, 1);
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    mat.positionNode = p.add(vec3(uCamR).mul(positionGeometry.x.mul(size))).add(vec3(uCamU).mul(positionGeometry.y.mul(size)));
    const vB: N = varying(br, 'vFerDustB');
    const vPd: N = varying(p, 'vFerDustP');
    mat.colorNode = Fn(() => {
      const st: N = uv();
      const r = length(st.sub(0.5)).mul(2);
      const fadeD = exp(length(vPd.sub(cameraPosition)).mul(-0.08));
      const tint = mix(vec3(0.7, 0.78, 1), vec3(1, 0.8, 0.5), smoothstep(0.2, 0.8, vB));
      return vec4(tint.mul(float(1).sub(smoothstep(0, 1, r)).mul(vB).mul(fadeD).mul(0.55)), 1);
    })();
    mat.toneMapped = false;
    const mesh = new Mesh(geo, mat);
    (mesh as any).count = n;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- devices
  type Dev = { type: 0 | 1 | 2; pos: Vector3; ry: number; thr: number; seed: number; scl: number; cab: boolean };
  const devices: Dev[] = [];
  {
    let id = 0;
    const pick = (i: number): 0 | 1 | 2 => (Math.floor(hash(i * 3.7 + 1) * 3) as 0 | 1 | 2);
    // cabinets: two cells per row and side, each holding a pair (phone + tablet / laptop + phone ...)
    const combos: [0 | 1 | 2, number][][] = [
      [[0, -0.27], [1, 0.12]], [[2, -0.1], [0, 0.34]], [[1, -0.14], [0, 0.29]], [[0, -0.3], [2, 0.08]],
    ];
    for (const s of [-1, 1]) {
      const cw = (CAB_B - CAB_A) / 2;
      for (let k = 0; k < CAB_ROWS; k++) {
        for (let c = 0; c < 2; c++) {
          const cx = CAB_A + cw * (c + 0.5);
          const combo = combos[Math.floor(hash(k * 5.3 + c * 2.1 + s * 0.7) * combos.length)];
          for (const [type, off] of combo) {
            devices.push({ type, pos: new Vector3(s * (cx + off * (s > 0 ? 1 : -1)), CAB_Y0 + CAB_DY * k, CAB_ZD + (type === 2 ? 0.05 : 0)),
              ry: -s * 0.2, thr: 0, seed: hash(id + 9), scl: CAB_S, cab: true });
            id++;
          }
        }
      }
    }
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const y = 0.55 + 0.7 * k, z = 1.2 - 0.9 * k - 0.55;
        for (let x = 2.85 + 1.45 * k; x < 6.7; x += 1.3) {
          devices.push({ type: pick(id), pos: new Vector3(s * x, y, z), ry: -s * (0.25 + 0.04 * x), thr: 0, seed: hash(id + 9), scl: 1, cab: false });
          id++;
        }
      }
      for (let k = 0; k < 2; k++) {
        const y = 0.45 + 0.6 * k, x = 3.95 + 1.5 * k;
        for (let z = 4.2 + k * 0.7; z < 22; z += 1.65) {
          devices.push({ type: pick(id), pos: new Vector3(s * x, y, z), ry: Math.atan2(-s * 0.8, 0.6), thr: 0, seed: hash(id + 9), scl: 1, cab: false });
          id++;
        }
      }
    }
    // thresholds: within each group (cabinets / floor) the share of updated screens equals the rollout fraction;
    // the ones nearest the cartouche go first (they form the beta ring), the rest follow outward with a little jitter
    const cart = new Vector3(0, YTOP - SC + 1.2, 0);
    for (const cab of [true, false]) {
      const grp = devices.map((d, i) => ({ i, d })).filter((e) => e.d.cab === cab);
      const order = grp.map((e) => ({ i: e.i, k: e.d.pos.distanceTo(cart) + (hash(e.i + 3) - 0.5) * 1.2 })).sort((a, b) => a.k - b.k);
      order.forEach((o, rank) => { devices[o.i].thr = 0.004 + 0.97 * (rank / order.length); });
    }
  }
  const ND = devices.length;
  // local screen transforms per device type (matches build.py)
  const SCREENS = [
    { p: new Vector3(0, 0.62, 0.0265), rx: 0, w: 0.44, h: 0.92 },
    { p: new Vector3(0, 0.5, 0.0235), rx: 0, w: 0.98, h: 0.68 },
    { p: new Vector3(0, 0.4305, -0.488), rx: -Math.PI / 12, w: 1.1, h: 0.72 },
  ];
  const deviceMats = devices.map((d) => new Matrix4().compose(d.pos, new Quaternion().setFromEuler(new Euler(0, d.ry, 0)), new Vector3(d.scl, d.scl, d.scl)));
  const screenPos = devices.map((d, i) => {
    const s = SCREENS[d.type];
    return s.p.clone().applyMatrix4(deviceMats[i]);
  });

  // screens: one instanced draw
  const SPARK_PERIOD = 2.9, FLIGHT = 0.55;
  {
    const geo = new PlaneGeometry(1, 1);
    const data = new InstancedBufferAttribute(new Float32Array(ND * 4), 4);
    const mat = new MeshBasicNodeMaterial();
    const mesh = new InstancedMesh(geo, mat, ND);
    const m = new Matrix4(), q = new Quaternion();
    devices.forEach((d, i) => {
      const s = SCREENS[d.type];
      m.compose(s.p, q.setFromEuler(new Euler(s.rx, 0, 0)), new Vector3(s.w, s.h, 1)).premultiply(deviceMats[i]);
      mesh.setMatrixAt(i, m);
      data.setXYZW(i, d.thr, d.seed, d.type, s.w / s.h);
    });
    const D: N = instancedBufferAttribute(data, 'vec4');
    const vD: N = varying(D, 'vFerScrD');
    mat.colorNode = Fn(() => {
      const st: N = uv();
      const thr = vD.x, seed = vD.y, type = vD.z, A = vD.w;
      const prog = clamp(uRollout.sub(thr).div(0.05), 0, 1);
      const done = smoothstep(0.96, 1, prog);
      const ph = fract(uTime.div(SPARK_PERIOD).add(seed));
      const pulse = exp(max(ph.sub(FLIGHT), 0).mul(-9)).mul(step(FLIGHT, ph)).mul(step(thr, uRollout.add(0.02)));
      // background
      let c: N = mix(vec3(0.01, 0.018, 0.04), vec3(0.03, 0.05, 0.1), st.y);
      c = c.add(v3(GOLD).mul(done.mul(0.12).add(pulse.mul(0.35))).mul(float(1).sub(st.y.mul(0.5))));
      // text from the atlas (4 × 4 cells, 2:1)
      const cell = (idx: N, cx: number, cy: number, hgt: N) => {
        const wd = hgt.mul(2).div(A);
        const lu = st.x.sub(cx).div(wd).add(0.5), lv = st.y.sub(cy).div(hgt).add(0.5);
        const ins = step(0, lu).mul(step(lu, 1)).mul(step(0, lv)).mul(step(lv, 1));
        const col = idx.mod(4), row = idx.div(4).floor();
        const tv = texture(atlasTex, vec2(col.add(lu).div(4), float(1).sub(row.add(1).sub(lv).div(4)))).r;
        return tv.mul(ins);
      };
      const hS = min(float(0.11), A.mul(0.22));
      const plat = cell(type, 0.5, 0.86, hS);
      const vOld = cell(float(4), 0.5, 0.6, hS.mul(1.6));
      const vNew = cell(float(5), 0.5, 0.6, hS.mul(1.6));
      const isBeta = step(thr, 0.08);
      const chan = cell(select(isBeta.greaterThan(0.5), float(6), float(7)), 0.5, 0.15, hS.mul(0.95));
      const pale = v3(PALE).mul(0.75);
      c = c.add(pale.mul(plat).mul(0.6));
      c = c.add(pale.mul(vOld).mul(float(1).sub(done)).mul(0.55));
      c = c.add(v3(GOLD).mul(vNew).mul(done).mul(1.5));
      // progress bar
      const bx = st.x.sub(0.12).div(0.76);
      const inBar = step(0, bx).mul(step(bx, 1)).mul(step(abs(st.y.sub(0.36)), 0.022));
      const fill = step(bx, prog);
      c = c.add(mix(vec3(0.05, 0.07, 0.12), v3(GOLD).mul(float(1.1).add(pulse)), fill).mul(inBar));
      // channel pill
      const pill = step(abs(st.x.sub(0.5)), hS.mul(1.15).div(A).add(0.02)).mul(step(abs(st.y.sub(0.15)), hS.mul(0.42)));
      const pc = select(isBeta.greaterThan(0.5), v3(GOLD), v3(PALE));
      c = c.add(pc.mul(pill).mul(0.12)).add(pc.mul(chan).mul(0.9));
      // bezel fade + scanline
      const bez = smoothstep(0, 0.03, min(min(st.x, float(1).sub(st.x)), min(st.y, float(1).sub(st.y))));
      c = c.mul(bez).mul(sin(st.y.mul(400)).mul(0.04).add(0.96)).mul(uShow.mul(0.85).add(0.15));
      return vec4(tonemap(fogged(c.mul(1.3), positionWorld)), 1);
    })();
    mat.toneMapped = false;
    mat.fog = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // sparks: 2 per device, a trail quad along a quadratic arc from the cartouche to the screen
  {
    const n = ND * 2;
    const A = new InstancedBufferAttribute(new Float32Array(n * 4), 4); // target xyz, thr
    const Bv = new InstancedBufferAttribute(new Float32Array(n * 4), 4); // origin x offset, seed, lift, intensity
    for (let i = 0; i < n; i++) {
      const j = i % ND, d = devices[j], sp = screenPos[j];
      A.setXYZW(i, sp.x, sp.y, sp.z, d.thr);
      const second = i >= ND;
      const dist = sp.distanceTo(new Vector3(0, YTOP - SC + 1.2, 0));
      Bv.setXYZW(i, (hash(i + 0.5) - 0.5) * 1.4, second ? (d.seed + 0.5) % 1 : d.seed, (0.25 + hash(i + 2) * 0.35) * dist, second ? 0.6 : 1);
    }
    const a: N = instancedBufferAttribute(A, 'vec4'), b: N = instancedBufferAttribute(Bv, 'vec4');
    const ph = fract(uTime.div(SPARK_PERIOD).add(b.y));
    const k = clamp(ph.div(FLIGHT), 0, 1);
    const o = vec3(uOrigin).add(vec3(b.x, 0, 0));
    const tgt = a.xyz;
    const mid = o.add(tgt).mul(0.5).add(vec3(0, b.z, 0.8));
    const bez = (t: N) => {
      const it = float(1).sub(t);
      return o.mul(it.mul(it)).add(mid.mul(it.mul(t).mul(2))).add(tgt.mul(t.mul(t)));
    };
    const kk = k.mul(k).mul(float(3).sub(k.mul(2))).mul(0.85).add(k.mul(0.15));
    const head = bez(kk), tail = bez(max(kk.sub(0.09), 0));
    const along = positionGeometry.y.add(0.5);
    const p = mix(tail, head, along);
    const side = normalize(cross(head.sub(tail).add(vec3(0, 1e-4, 0)), cameraPosition.sub(p)));
    const active = step(a.w, uRollout.add(0.025)).mul(step(ph, FLIGHT));
    const done = step(a.w.add(0.05), uRollout);
    const inten = b.w.mul(mix(float(1), float(0.28), done)).mul(active).mul(uShow);
    const w = along.mul(0.03).add(0.006).mul(select(inten.greaterThan(0.01), float(1), float(0)));
    const geo = new PlaneGeometry(1, 1, 1, 6);
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    mat.positionNode = p.add(side.mul(positionGeometry.x.mul(w).mul(2)));
    const vI: N = varying(inten.mul(smoothstep(0, 0.08, k)).mul(float(1).sub(smoothstep(0.9, 1, k))), 'vFerSparkI');
    mat.colorNode = Fn(() => {
      const st: N = uv();
      const across = exp(pow(st.x.sub(0.5).mul(4), 2).negate());
      const hot = pow(st.y, 3);
      const c = mix(v3(GOLD).mul(1.2), vec3(1.6, 1.4, 1.0), hot.mul(across));
      return vec4(c.mul(across.mul(st.y.mul(0.9).add(0.1))).mul(vI).mul(1.6), 1);
    })();
    mat.toneMapped = false;
    const mesh = new Mesh(geo, mat);
    (mesh as any).count = n;
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- glb: hall, end wall, tiers, rollers, seal, device bodies
  const litMat = () => {
    const mat = new MeshBasicNodeMaterial({ side: DoubleSide });
    const col: N = attribute('color', 'vec4');
    mat.colorNode = vec4(lit(positionWorld, normalWorld, col.rgb, col.a), 1);
    mat.toneMapped = false;
    mat.fog = false;
    return mat;
  };
  let rollerTop: Object3D | null = null, rollerBottom: Object3D | null = null, seal: Object3D | null = null;
  async function loadGlb() {
    const gltf = await new GLTFLoader().loadAsync('/worlds/ferman/ferman.glb');
    const byName: Record<string, BufferGeometry> = {};
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o: any) => {
      if (o.isMesh) {
        const g = (o.geometry as BufferGeometry).clone();
        g.applyMatrix4(o.matrixWorld);
        byName[o.name] = g;
      }
    });
    const mat = litMat();
    const bays = new InstancedMesh(byName.Bay, mat, BAYS);
    for (let k = 0; k < BAYS; k++) bays.setMatrixAt(k, new Matrix4().makeTranslation(0, 0, -0.6 + 4 * k));
    bays.frustumCulled = false;
    scene.add(bays);
    for (const nm of ['Back', 'Tiers']) {
      const m = new Mesh(byName[nm], mat);
      m.frustumCulled = false;
      scene.add(m);
    }
    rollerTop = new Mesh(byName.RollerTop, mat);
    rollerTop.position.set(0, YTOP + 0.02, -0.09);
    rollerBottom = new Mesh(byName.RollerBottom, mat);
    seal = new Mesh(byName.Seal, mat);
    for (const m of [rollerTop, rollerBottom, seal]) { m.frustumCulled = false; scene.add(m); }
    const types = ['Phone', 'Tablet', 'Laptop'];
    types.forEach((nm, ti) => {
      const list = devices.map((d, i) => ({ d, i })).filter((e) => e.d.type === ti);
      const im = new InstancedMesh(byName[nm], mat, Math.max(1, list.length));
      list.forEach((e, k) => im.setMatrixAt(k, deviceMats[e.i]));
      im.count = list.length;
      im.frustumCulled = false;
      scene.add(im);
    });
  }

  // ---------------------------------------------------------------- slides
  const slideTex: (Texture | null)[] = [];
  let slides: SlideImage[] = ctx.slides ?? [];
  const loader = new TextureLoader();
  const aspOf = (i: number) => { const s = slides[i]; return s ? s.w / s.h : 1.68; };
  const panelSize = (asp: number) => {
    let w = IMG_MAX_W, h = w / asp;
    if (h > IMG_MAX_H) { h = IMG_MAX_H; w = h * asp; }
    return { w, h };
  };
  async function loadSlides() {
    if (!slides.length) {
      for (const url of [`/projects/${ctx.project.id}/manifest.json`, '/projects/_placeholder/manifest.json']) {
        try {
          const r = await fetch(url);
          if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) { slides = j; break; } }
        } catch { /* fall through */ }
      }
    }
    if (!slides.length) {
      slides = generatedSlides();
      return;
    }
    await Promise.all(slides.map(async (s, i) => {
      try {
        const t = await loader.loadAsync(s.src);
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = 8;
        slideTex[i] = t;
      } catch {
        slideTex[i] = null;
      }
    }));
  }
  function generatedSlides(): SlideImage[] {
    const out: SlideImage[] = [];
    for (let i = 0; i < 3; i++) {
      const cv = document.createElement('canvas');
      cv.width = 1600; cv.height = 1000;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#0a0f1a'; g.fillRect(0, 0, 1600, 1000);
      g.fillStyle = '#e8b04a'; g.font = 'bold 110px Georgia, serif';
      g.fillText('Ferman', 90, 200);
      g.fillStyle = '#d9e2ef'; g.font = '40px Menlo, monospace';
      ['release 1.9.0  signed', `rollout  ${[10, 50, 100][i]}%  ${i ? 'stable' : 'beta'}`, 'android  windows  ios'].forEach((l, k) => g.fillText(l, 90, 380 + k * 80));
      const t = new CanvasTexture(cv);
      t.colorSpace = SRGBColorSpace;
      slideTex[i] = t;
      out.push({ src: '', w: 1600, h: 1000, kind: 'desktop' });
    }
    return out;
  }

  let curSlide = -1, nextSlide = -1, mixT = 0;
  const sizeA = { w: IMG_MAX_W, h: IMG_MAX_W / 1.68 }, sizeB = { ...sizeA };
  function showSlideNow(i: number) {
    const t = slideTex[i];
    if (!t) return;
    slideTexA.value = t;
    uAspA.value = aspOf(i);
    Object.assign(sizeA, panelSize(aspOf(i)));
    uWp.value = sizeA.w; uHp.value = sizeA.h;
    curSlide = i;
  }
  function requestSlide(i: number) {
    if (!slides.length) return;
    i = ((Math.round(i) % slides.length) + slides.length) % slides.length;
    if (curSlide < 0) { showSlideNow(i); return; }
    if (i === curSlide && nextSlide < 0) return;
    if (i === nextSlide) return;
    if (nextSlide >= 0) { showSlideNow(nextSlide); nextSlide = -1; uMix.value = 0; }
    if (i === curSlide || !slideTex[i]) return;
    nextSlide = i;
    mixT = 0;
    slideTexB.value = slideTex[i]!;
    uAspB.value = aspOf(i);
    Object.assign(sizeB, panelSize(aspOf(i)));
  }

  const ready = Promise.all([loadGlb(), loadSlides()]).then(() => { requestSlide(0); });

  // ---------------------------------------------------------------- camera
  const tmp = new Vector3(), tmp2 = new Vector3(), look = new Vector3();
  const holdPose = (out: { pos: Vector3; look: Vector3 }, aspect: number, u: number) => {
    const Wq = Math.max((uWp.value as number) + 2 * FB, TABW);
    const yc = YTOP - SC;
    const yTop = yc + (uHp.value as number) / 2 + FB + TABH, yBot = yc - (uHp.value as number) / 2 - FB;
    // panel spans 12% → 59% of the screen height, and at most ~70% of its width
    let Hv = (yTop - yBot) / 0.53;
    Hv = Math.max(Hv, Wq / (0.7 * aspect));
    const cy = yTop + 0.11 * Hv - Hv / 2;
    const d = Hv / 2 / Math.tan((FOV * Math.PI) / 360);
    const x = lerp(0.42, -0.42, u);
    out.pos.set(x, cy + 0.32, d - 0.25 * u);
    out.look.set(x * 0.25, cy, 0);
  };
  const H0 = { pos: new Vector3(), look: new Vector3() };
  const P0 = { pos: new Vector3(0, 1.7, 23), look: new Vector3(0, 5.6, 0) };
  const camQ = new Quaternion(), rollQ = new Quaternion(), mtx = new Matrix4(), Zax = new Vector3(0, 0, 1);

  function update(f: StageFrame) {
    const t = f.t;
    uTime.value = f.time;
    uGleam.value = -4 + ((f.time / 7) % 1) * 20;
    uRollout.value = rolloutAt(t);
    uL.value = lerp(1.1, PL, easeInOut(clamp01((t + 0.02) / 0.24)));
    uShow.value = sstep(0.05, 0.25, t) * (1 - sstep(0.93, 1.02, t) * 0.5);
    readout.set(uRollout.value as number);
    if (readout.dirty) { readoutTex.needsUpdate = true; readout.dirty = false; }

    // slide crossfade (≤ 600 ms)
    requestSlide(f.slide);
    if (nextSlide >= 0) {
      mixT = Math.min(1, mixT + f.dt / 0.55);
      const e = easeInOut(mixT);
      uMix.value = e;
      uWp.value = lerp(sizeA.w, sizeB.w, e);
      uHp.value = lerp(sizeA.h, sizeB.h, e);
      if (mixT >= 1) { showSlideNow(nextSlide); nextSlide = -1; uMix.value = 0; }
    }

    // camera
    const aspect = f.aspect || camera.aspect;
    const hu = clamp01((t - 0.22) / 0.6);
    holdPose(H0, aspect, sstep(0, 1, hu));
    const pos = tmp.copy(H0.pos);
    look.copy(H0.look);
    let roll = 0;
    if (t < 0.22) {
      const k = clamp01(t / 0.22);
      const e = outCubic(k);
      pos.lerpVectors(P0.pos, H0.pos, e);
      pos.y += Math.sin(k * Math.PI) * 1.4;
      pos.x += Math.sin(k * Math.PI) * -0.9;
      look.lerpVectors(P0.look, H0.look, easeInOut(k));
      roll = Math.sin(k * Math.PI) * 0.05;
    } else if (t > 0.82) {
      const k = clamp01((t - 0.82) / 0.18);
      const e = k * k * (3 - 2 * k);
      pos.y += 6.2 * e * e + 0.6 * e;
      pos.z -= 2.8 * e;
      look.y += 8.5 * e;
      look.z -= 2.5 * e;
      roll = -0.06 * e;
    }
    // parallax + idle drift
    const px = f.parallax?.x ?? 0, py = f.parallax?.y ?? 0;
    pos.x += px * 0.35 + Math.sin(f.time * 0.13) * 0.07;
    pos.y += py * 0.2 + Math.sin(f.time * 0.17 + 1) * 0.05;
    look.x += px * 0.08;
    look.y += py * 0.05;
    camera.position.copy(pos);
    mtx.lookAt(pos, look, tmp2.set(0, 1, 0));
    camQ.setFromRotationMatrix(mtx);
    camera.quaternion.copy(camQ).multiply(rollQ.setFromAxisAngle(Zax, roll));
    camera.fov = FOV;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    (uCamR.value as Vector3).setFromMatrixColumn(camera.matrixWorld, 0);
    (uCamU.value as Vector3).setFromMatrixColumn(camera.matrixWorld, 1);

    // CPU-side followers of the paper: bottom roller, seal, spark origin (top of the cartouche)
    const L = uL.value as number;
    if (rollerBottom) {
      paperPosCPU(0.5, L, tmp2);
      rollerBottom.position.set(0, tmp2.y, tmp2.z + RB);
      rollerBottom.rotation.x = -L / RB;
    }
    if (seal) {
      // stamped on the paper right of the cartouche, pressed in as the sheet unrolls past it
      const sS = SC - (uHp.value as number) / 2 - FB - TABH * 0.5 + 0.03;
      paperPosCPU(0.5 + ((uWp.value as number) / 2 - 0.2) / PW, sS, tmp2);
      const vis = sstep(0, 0.5, L - sS - 0.25);
      seal.position.set(tmp2.x, tmp2.y, tmp2.z + 0.03);
      seal.scale.setScalar(Math.max(0.001, 0.78 * (0.6 + 0.4 * outCubic(vis))) * (vis > 0 ? 1 : 0.001));
      seal.rotation.z = Math.sin(f.time * 0.6) * 0.03;
    }
    const sTab = SC - (uHp.value as number) / 2 - FB - TABH * 0.5;
    paperPosCPU(0.5, sTab, uOrigin.value as Vector3);
    (uOrigin.value as Vector3).z += 0.05;
  }

  return {
    id: ctx.project.id,
    scene,
    camera,
    background: NAVY.clone(),
    ready,
    update,
  };
}

// ====================================================================== canvas artwork
function placeholderTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 4;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0a0f1a';
  g.fillRect(0, 0, 4, 4);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** parchment, illuminated border, an original abstract emblem, abstract script lines. Also a gold mask. */
function drawPaper() {
  const PX = 320; // px per metre
  const W = Math.round(PW * PX), H = Math.round(PL * PX);
  const color = document.createElement('canvas');
  color.width = W; color.height = H;
  const mask = document.createElement('canvas');
  mask.width = W / 2; mask.height = H / 2;
  const g = color.getContext('2d')!;
  const mk = mask.getContext('2d')!;
  mk.fillStyle = '#000'; mk.fillRect(0, 0, mask.width, mask.height);
  mk.scale(0.5, 0.5);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const both = (fn: (c: CanvasRenderingContext2D, isMask: boolean) => void) => { fn(g, false); fn(mk, true); };

  // parchment base
  const gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, '#cdb68a'); gr.addColorStop(0.12, '#e6d6b4'); gr.addColorStop(0.5, '#efe2c4'); gr.addColorStop(0.88, '#e6d6b4'); gr.addColorStop(1, '#c8b083');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W, y = rnd() * H, r = 60 + rnd() * 260;
    const sg = g.createRadialGradient(x, y, 0, x, y, r);
    sg.addColorStop(0, `rgba(150,110,60,${0.05 + rnd() * 0.06})`); sg.addColorStop(1, 'rgba(150,110,60,0)');
    g.fillStyle = sg; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.globalAlpha = 0.08;
  for (let i = 0; i < 3000; i++) { g.fillStyle = rnd() < 0.5 ? '#8a6a3a' : '#fff6e0'; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1); }
  for (let i = 0; i < 220; i++) { g.strokeStyle = '#9b7f52'; g.lineWidth = 1; g.beginPath(); const x = rnd() * W, y = rnd() * H; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 6); g.stroke(); }
  g.globalAlpha = 1;

  // illuminated border
  const m1 = 0.1 * PX, m2 = 0.24 * PX;
  both((c, isM) => {
    c.strokeStyle = isM ? '#fff' : '#b8862c';
    c.lineWidth = 6; c.strokeRect(m1, m1, W - 2 * m1, H - 2 * m1);
    c.lineWidth = 3; c.strokeRect(m2, m2, W - 2 * m2, H - 2 * m2);
  });
  g.fillStyle = 'rgba(20,32,70,0.85)';
  g.fillRect(m1 + 5, m1 + 5, W - 2 * m1 - 10, m2 - m1 - 8);
  g.fillRect(m1 + 5, H - m2 + 3, W - 2 * m1 - 10, m2 - m1 - 8);
  g.fillRect(m1 + 5, m1 + 5, m2 - m1 - 8, H - 2 * m1 - 10);
  g.fillRect(W - m2 + 3, m1 + 5, m2 - m1 - 8, H - 2 * m1 - 10);
  const step = 0.14 * PX, mid = (m1 + m2) / 2, hs = (m2 - m1) * 0.32;
  const lozenge = (c: CanvasRenderingContext2D, x: number, y: number) => {
    c.beginPath(); c.moveTo(x, y - hs); c.lineTo(x + hs, y); c.lineTo(x, y + hs); c.lineTo(x - hs, y); c.closePath(); c.fill();
  };
  both((c, isM) => {
    c.fillStyle = isM ? '#fff' : '#d4a245';
    for (let x = m2; x < W - m2; x += step) { lozenge(c, x, mid); lozenge(c, x, H - mid); }
    for (let y = m2; y < H - m2; y += step) { lozenge(c, mid, y); lozenge(c, W - mid, y); }
  });

  // ---- original abstract emblem (not a real tughra): three rising stems with flag-like tips, two nested
  //      open loops sweeping left, two long arms sweeping right, a knot of small strokes at the base.
  const E = (x: number, y: number): [number, number] => [x * PX, y * PX];
  const strokePath = (c: CanvasRenderingContext2D, pts: [number, number][]) => {
    c.beginPath();
    c.moveTo(...E(...pts[0]));
    for (let i = 1; i + 2 < pts.length + 1; i += 3) {
      if (i + 2 >= pts.length) break;
      c.bezierCurveTo(...E(...pts[i]), ...E(...pts[i + 1]), ...E(...pts[i + 2]));
    }
    c.stroke();
  };
  const paths: { pts: [number, number][]; w: number }[] = [];
  // stems
  [[1.55, 0.62], [1.78, 0.5], [2.0, 0.68]].forEach(([x, top], i) => {
    paths.push({ pts: [[x - 0.04, 2.08], [x - 0.02, 1.6], [x + 0.03, 1.0], [x, top], [x + 0.02, top - 0.12], [x + 0.18, top - 0.1], [x + 0.2 + i * 0.03, top + 0.05]], w: 0.05 });
  });
  // nested loops
  paths.push({ pts: [[1.5, 2.0], [0.6, 2.25], [0.2, 1.4], [0.85, 1.12], [1.3, 0.95], [1.62, 1.45], [1.2, 1.78]], w: 0.045 });
  paths.push({ pts: [[1.45, 1.92], [0.9, 2.0], [0.62, 1.55], [0.98, 1.38], [1.25, 1.27], [1.4, 1.55], [1.15, 1.68]], w: 0.035 });
  // arms
  paths.push({ pts: [[1.1, 1.86], [1.8, 1.7], [2.5, 1.95], [3.15, 1.62]], w: 0.04 });
  paths.push({ pts: [[1.2, 2.0], [1.9, 1.86], [2.55, 2.12], [3.05, 1.86]], w: 0.03 });
  // base knot
  paths.push({ pts: [[1.4, 2.15], [1.6, 2.32], [1.95, 2.3], [2.15, 2.12]], w: 0.03 });
  paths.push({ pts: [[1.62, 2.1], [1.72, 1.98], [1.86, 2.0], [1.9, 2.12]], w: 0.025 });
  // illumination inside the loops: small navy/gold spirals and dots
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
    const cx = 0.92 + Math.cos(a) * 0.42 * r, cy = 1.62 + Math.sin(a) * 0.3 * r;
    g.strokeStyle = i % 3 ? 'rgba(25,45,110,0.8)' : 'rgba(190,140,50,0.9)';
    g.lineWidth = 2;
    g.beginPath();
    for (let k = 0; k < 18; k++) { const t = k / 17 * Math.PI * 2.4, rr = (0.004 + 0.012 * k / 17) * PX; g.lineTo(cx * PX + Math.cos(t + a) * rr, cy * PX + Math.sin(t + a) * rr); }
    g.stroke();
  }
  g.lineCap = mk.lineCap = 'round';
  g.lineJoin = mk.lineJoin = 'round';
  for (const p of paths) { g.strokeStyle = '#6b4310'; g.lineWidth = (p.w + 0.016) * PX; strokePath(g, p.pts); }
  for (const p of paths) { g.strokeStyle = '#c9902e'; g.lineWidth = p.w * PX; strokePath(g, p.pts); }
  for (const p of paths) { g.strokeStyle = '#f4d488'; g.lineWidth = p.w * 0.3 * PX; strokePath(g, p.pts); }
  for (const p of paths) { mk.strokeStyle = '#fff'; mk.lineWidth = (p.w + 0.01) * PX; strokePath(mk, p.pts); }
  both((c, isM) => {
    c.fillStyle = isM ? '#fff' : '#d9a640';
    for (const [x, y] of [[2.3, 1.5], [2.45, 1.42], [0.5, 2.15], [2.75, 2.3], [1.3, 0.7]] as [number, number][]) { c.beginPath(); c.arc(x * PX, y * PX, 0.022 * PX, 0, Math.PI * 2); c.fill(); }
  });

  // panel bed (slightly darker), behind the framed screenshot
  g.fillStyle = 'rgba(120,90,50,0.12)';
  g.fillRect(0.25 * PX, 2.5 * PX, W - 0.5 * PX, 2.95 * PX);

  // abstract script lines (not text): connected strokes with dots, a few gilded words
  for (let line = 0; line < 7; line++) {
    const y = (5.62 + line * 0.27) * PX;
    const x1 = W - 0.42 * PX, x0 = line > 4 ? 1.1 * PX : 0.42 * PX;
    const xEnd = line >= 5 ? W - 1.15 * PX : x1; // leave room for the seal
    let x = Math.min(x1, xEnd + (line >= 5 ? 0 : 0));
    x = line >= 5 ? xEnd : x1;
    while (x > x0) {
      const wlen = (0.18 + rnd() * 0.35) * PX;
      const gold = rnd() < 0.12;
      const ctx2 = [g, ...(gold ? [mk] : [])];
      for (const c of ctx2) {
        c.strokeStyle = c === mk ? '#fff' : gold ? '#c08a2c' : '#1d2436';
        c.lineWidth = c === mk ? 6 : 3.2;
        c.beginPath();
        c.moveTo(x, y);
        let xx = x;
        let s2 = seed;
        const r2 = () => { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
        while (xx > x - wlen) {
          const dx = (0.03 + r2() * 0.05) * PX, up = (r2() < 0.3 ? -0.09 : -0.025) * PX, dn = (r2() < 0.2 ? 0.06 : 0.01) * PX;
          c.bezierCurveTo(xx - dx * 0.2, y + up, xx - dx * 0.8, y + dn, xx - dx, y);
          xx -= dx;
        }
        c.stroke();
      }
      for (let k = 0; k < 3; k++) {
        if (rnd() < 0.55) { g.fillStyle = '#1d2436'; g.beginPath(); g.arc(x - rnd() * wlen, y + (rnd() < 0.5 ? -0.07 : 0.05) * PX, 3, 0, Math.PI * 2); g.fill(); }
      }
      seed = (seed * 16807) % 2147483647;
      x -= wlen + 0.07 * PX;
    }
  }
  return { color, mask };
}

/** 4 × 4 cells (256 × 128): platform names, versions, channels. White on black (used as a mask). */
function drawAtlas() {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 512;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 512);
  g.fillStyle = '#fff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const cells: [string, string][] = [
    ['ANDROID', '600 52px Menlo, Consolas, monospace'], ['WINDOWS', '600 52px Menlo, Consolas, monospace'], ['iOS', '600 60px Menlo, Consolas, monospace'], ['', ''],
    ['v1.8.2', '700 74px Menlo, Consolas, monospace'], ['v1.9.0', '700 74px Menlo, Consolas, monospace'], ['BETA', '700 64px Menlo, Consolas, monospace'], ['STABLE', '700 60px Menlo, Consolas, monospace'],
  ];
  cells.forEach(([txt, font], i) => {
    if (!txt) return;
    g.font = font;
    g.fillText(txt, (i % 4) * 256 + 128, Math.floor(i / 4) * 128 + 66, 240);
  });
  return cv;
}

/** the cartouche readout: "ROLLOUT · 50% · STABLE", redrawn only when the shown value changes */
function makeReadout() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 216;
  const g = canvas.getContext('2d')!;
  const state = { canvas, dirty: true, shown: -1, set: (r: number) => {} };
  state.set = (r: number) => {
    const pct = Math.round(r * 100);
    if (pct === state.shown) return;
    state.shown = pct;
    state.dirty = true;
    const W = canvas.width, H = canvas.height;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#16213d'); bg.addColorStop(1, '#0a0f1a');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.textBaseline = 'middle';
    const chan = r <= 0.105 ? 'BETA' : 'STABLE';
    g.fillStyle = '#c9a25a'; g.font = '600 40px Georgia, "Times New Roman", serif';
    g.textAlign = 'left'; g.fillText('ROLLOUT', 120, H / 2 + 2);
    g.textAlign = 'right'; g.fillText(r <= 0.001 ? 'SIGNED' : chan, W - 120, H / 2 + 2);
    g.fillStyle = '#f2c766'; g.font = '700 112px Georgia, "Times New Roman", serif';
    g.textAlign = 'center'; g.fillText(`${pct}%`, W / 2, H / 2 + 6);
    // three stage pips under the number
    [0.1, 0.5, 1].forEach((s, i) => {
      g.fillStyle = r >= s - 0.001 ? '#f2c766' : 'rgba(201,162,90,0.3)';
      g.beginPath(); g.arc(W / 2 - 40 + i * 40, H - 26, 7, 0, Math.PI * 2); g.fill();
    });
  };
  return state;
}
