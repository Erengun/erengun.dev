/**
 * Ferman world (project #1): self-hosted live updates / code push. A giant imperial edict scroll hangs in a dim
 * vaulted hall; the edict is the signed patch. Its gilded panel shows the featured screenshot, the cartouche reads the
 * rollout, and the edict's text is the release terminal (ferman patch → rollout → promote, typed as you scroll).
 * The hero of the hold is the PATCH BENCH in front of the right-hand cabinet (see createBench):
 *   base build (app-release.apk, Setup.exe, Runner.ipa, libapp.so as grids of byte blocks) → the changed blocks of the
 *   APK are cut out as a diff → stamped with the ferman's seal (= Ed25519 signature) → the packet flies to devices,
 *   which verify the seal (✓), hot-swap the changed blocks in place and relaunch on "v2.3.0+41 → patch 3";
 *   rollout 10 % beta → 50 % → promote stable 100 %, then one device reverts ("rollback → base").
 * Everything on the bench is a pure function of the scroll progress t (scrubbable; see PT) plus idle motion.
 *
 * Timeline (local t):  0 → .22 arrive (fly up the aisle while the scroll unrolls)
 *                     .22 → .82 hold (diff .19–.27 · beta .27 · 50 % .42 · stable .57 · rollback .71)
 *                     .82 → 1   depart (crane up past the emblem into the vault glow)
 *
 * Draws (24): bays (instanced) · end wall + cabinets · tiers · paper · panel · terminal · rollers ×2 · seal
 *   · devices ×3 (instanced) · screens (instanced) · sparks · light shafts · dust · halo · bench boxes · bench labels.
 * Geometry: public/worlds/ferman/ferman.glb (tools/blender/worlds/ferman/build.py). Paper, emblem, screen labels,
 * bench atlas, terminal and readout are drawn into canvases at runtime (original artwork).
 */
import {
  Scene, Color, PerspectiveCamera, Mesh, InstancedMesh, PlaneGeometry, BufferGeometry, InstancedBufferAttribute,
  MeshBasicNodeMaterial, CanvasTexture, TextureLoader, SRGBColorSpace, NoColorSpace, DoubleSide, AdditiveBlending,
  Matrix4, Vector3, Quaternion, Euler, Object3D, BoxGeometry, type Texture,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, attribute, varying, texture, instancedBufferAttribute, positionGeometry,
  positionWorld, normalWorld, cameraPosition, uv, mix, smoothstep, clamp, max, min, pow, exp, length, normalize, dot,
  sin, cos, fract, abs, reflect, cross, select, frontFacing, step, instancedDynamicBufferAttribute, normalGeometry,
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
const IMG_MAX_W = 2.62, IMG_MAX_H = 1.6;
const TERM_GAP = 0.06, TERM_H = 0.42, TERM_W = 2.62; // in-world terminal under the panel (paper metres)
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

  // ---------------------------------------------------------------- terminal set into the edict under the panel
  const term = makeTerminal();
  const termTex = new CanvasTexture(term.canvas);
  termTex.colorSpace = SRGBColorSpace;
  termTex.anisotropy = 8;
  {
    const geo = new PlaneGeometry(1, 1, 10, 4);
    const mat = new MeshBasicNodeMaterial({ side: DoubleSide });
    const q: N = uv();
    const s0 = float(SC + FB + TERM_GAP).add(uHp.mul(0.5));
    const ss = s0.add(float(1).sub(q.y).mul(TERM_H));
    const uu = q.x.sub(0.5).mul(TERM_W / PW).add(0.5);
    const fr = paperFrame(uu, ss, 0.01, 0.02);
    mat.positionNode = fr.p.add(fr.n.mul(0.01));
    const vS: N = varying(ss, 'vFerTermS');
    mat.opacityNode = step(vS, uL.sub(0.02));
    mat.alphaTest = 0.5;
    mat.colorNode = Fn(() => {
      const c = texture(termTex, uv()).rgb;
      return vec4(c.mul(c.mul(0.25).add(0.95)), 1);
    })();
    mat.toneMapped = false;
    mat.fog = false;
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- the patch bench (hero of the hold)
  const bench = createBench(high);
  scene.add(bench.group);
  bench.group.updateMatrixWorld(true);
  const benchCorner = (x: number, y: number) => new Vector3(x, y, 0).applyMatrix4(bench.group.matrixWorld);

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
      // devices on the right stand behind the patch bench: their arcs would cut across it, so they get none
      A.setXYZW(i, sp.x, sp.y, sp.z, sp.x > 1.5 ? 9 : d.thr);
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
  // hold framing: the edict panel (+ terminal) on the left, the patch bench on the right; everything above the DOM
  // panel (bottom 28 %) and right of the left nav (≈ 18 %)
  const benchR = benchCorner(B_W + 0.03, 0), benchT = benchCorner(B_W, B_H + 0.03);
  const holdPose = (out: { pos: Vector3; look: Vector3 }, aspect: number, u: number) => {
    const Wq = Math.max((uWp.value as number) + 2 * FB, TABW);
    const hp = uHp.value as number;
    const xL = -Wq / 2;
    const yTop = Math.max(YTOP - (SC - hp / 2 - FB - TABH), benchT.y);
    const yBot = Math.min(YTOP - (SC + hp / 2 + FB + TERM_GAP + TERM_H), B_POS.y);
    // margins chosen for the site's fish-eye post + header/nav (measured on the main page, not the test page)
    const L = 0.285, R = 0.87, T = 0.165, B = 0.66;
    const tanH = Math.tan((FOV * Math.PI) / 360);
    if (aspect < 1.1) {
      // portrait: panel + bench side by side would be tiny, so frame the patch bench (the hero) on its own;
      // the screenshots are still on the scroll to its left and in the DOM thumbnails
      const bx0 = benchCorner(0, 0).x - 0.05, bx1 = benchR.x + 0.05;
      const Hb = Math.max((benchT.y - B_POS.y + 0.1) / (0.62 - 0.12), (bx1 - bx0) / (0.94 * aspect));
      const db = Hb / 2 / tanH + 0.4;
      const cxb = (bx0 + bx1) / 2 + 0.1, cyb = benchT.y + 0.165 * Hb - Hb / 2;
      out.pos.set(cxb + lerp(0.04, -0.04, u) - 0.25, cyb + 0.05, db + 0.6);
      out.look.set(cxb - 0.05, cyb, 0.5);
      return;
    }
    let Hv = (yTop - yBot) / (B - T), cx = 0, d = 6;
    for (let it = 0; it < 3; it++) {
      // the bench's right end stands closer to the camera: widen it by its perspective gain
      const xR = cx + (benchR.x - cx) * d / Math.max(0.5, d - benchR.z);
      Hv = Math.max((yTop - yBot) / (B - T), (xR - xL) / ((R - L) * aspect));
      d = Hv / 2 / tanH;
      cx = xL + (0.5 - L) * Hv * aspect;
    }
    const cy = yTop + T * Hv - Hv / 2;
    const x = cx + lerp(0.08, -0.08, u);
    out.pos.set(x, cy + 0.1, d - 0.12 * u);
    out.look.set(x - 0.06, cy, 0);
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
    term.set(t, f.time);
    if (term.dirty) { termTex.needsUpdate = true; term.dirty = false; }
    bench.update(t, f.time);

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
    // the hold framing is tight (nav left, header top, DOM panel bottom): damp the parallax there
    const pk = 1 - 0.6 * sstep(0.16, 0.24, t) * (1 - sstep(0.8, 0.88, t));
    pos.x += px * 0.35 * pk + Math.sin(f.time * 0.13) * 0.05;
    pos.y += py * 0.2 * pk + Math.sin(f.time * 0.17 + 1) * 0.04;
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
    ['2.3.0+41', '700 58px Menlo, Consolas, monospace'], ['patch 3', '700 66px Menlo, Consolas, monospace'], ['BETA', '700 64px Menlo, Consolas, monospace'], ['STABLE', '700 60px Menlo, Consolas, monospace'],
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
    const chan = r <= 0.505 ? 'BETA' : 'STABLE'; // `ferman rollout 3 50` stays beta; only `promote` makes it stable
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

// ====================================================================== the patch bench
// A gilded board in front of the right-hand cabinet that explains what Ferman does, in world space:
//   base build (shipped binaries as grids of byte blocks) → the changed blocks are cut out as a DIFF → sealed with the
//   ferman's seal (= Ed25519 signature) → the packet flies to devices → each verifies the seal, hot-swaps the changed
//   blocks in place and shows "patch 3" after the next launch; rollout 10% beta → 50% → promote stable 100%;
//   one device reverts ("rollback → base").
// Everything is driven by the scroll progress t (scrubbable, deterministic stills) plus a little idle motion.
// Draws: 2 (all boxes in one instanced draw, all labels/sprites in one instanced draw).

/** scroll timeline of the patch story (local t of the world) */
export const PT = {
  scan: [0.19, 0.225] as const,   // the changed blocks of the APK light up (diff vs base)
  cut: [0.222, 0.252] as const,   // they lift out and gather into the packet
  seal: [0.25, 0.272] as const,  // the seal stamps the packet: "signed diff"
  // deliveries (flight → verify → hot swap → relaunch) per hero device
  dev: [[0.27, 0.34], [0.42, 0.49], [0.435, 0.505], [0.57, 0.64]] as [number, number][],
  rollback: [0.705, 0.775] as const,
  // bar segment i lights at segAt[i] (10 devices = 10 %)
  segAt: [0.345, 0.43, 0.455, 0.49, 0.515, 0.575, 0.59, 0.605, 0.62, 0.64],
};
/** rollout fraction for local t (matches the bench's 10-device bar: beta 10 % → 50 % → stable 100 %) */
export const rolloutAt = (t: number) => PT.segAt.reduce((acc, a) => acc + 0.1 * sstep(a - 0.012, a, t), 0);

const COLS = 5, ROWS = 6;
const DIFF = [6, 7, 12, 18, 19, 23];          // changed blocks (row-major from the top left), same on every device
const B_W = 2.3, B_H = 2.86;                   // board size (local x 0..B_W, y 0..B_H)
const B_POS = new Vector3(1.98, 2.96, 0.3), B_YAW = -0.17;

type Cell = { u0: number; v0: number; u1: number; v1: number; asp: number };

function makeAtlas() {
  const AW = 2048, AH = 1024;
  const cv = document.createElement('canvas');
  cv.width = AW; cv.height = AH;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, AW, AH);
  const cells: Record<string, Cell> = {};
  let x = 4, y = 4, rowH = 0;
  const alloc = (w: number, h: number) => {
    if (x + w > AW - 4) { x = 4; y += rowH + 6; rowH = 0; }
    const r = { x, y };
    x += w + 6; rowH = Math.max(rowH, h);
    return r;
  };
  const put = (key: string, w: number, h: number, r: { x: number; y: number }) => {
    cells[key] = { u0: r.x / AW, u1: (r.x + w) / AW, v0: 1 - (r.y + h) / AH, v1: 1 - r.y / AH, asp: w / h };
  };
  const MONO = 'Menlo, "DejaVu Sans Mono", Consolas, monospace';
  const text = (key: string, lines: string[], px: number, font = MONO, weight = 600, align: 'left' | 'center' = 'left') => {
    g.font = `${weight} ${px}px ${font}`;
    const lh = Math.round(px * 1.18);
    const w = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + 12;
    const h = lh * lines.length + 8;
    const r = alloc(w, h);
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.textAlign = align;
    lines.forEach((l, i) => g.fillText(l, align === 'center' ? r.x + w / 2 : r.x + 6, r.y + 4 + lh * (i + 0.5)));
    put(key, w, h, r);
  };
  text('base build', ['BASE BUILD'], 64, 'Georgia, "Times New Roman", serif', 700);
  text('release', ['release 2.3.0+41'], 52);
  text('app-release.apk', ['app-release.apk'], 56);
  text('Setup.exe', ['Setup.exe'], 56);
  text('Runner.ipa', ['Runner.ipa'], 56);
  text('libapp.so', ['libapp.so'], 56);
  text('signed diff', ['SIGNED DIFF'], 64, 'Georgia, "Times New Roman", serif', 700);
  text('diffinfo', ['bidiff · 6 blocks · ed25519'], 48, MONO, 600);
  text('r10', ['rollout 10% · beta'], 60);
  text('r50', ['rollout 50% · beta'], 60);
  text('r100', ['promote · stable 100%'], 60);
  text('verify', ['verify', 'signature ✓'], 50, MONO, 700, 'center');
  text('applied', ['applied on', 'next launch'], 50, MONO, 700, 'center');
  text('rollback', ['rollback', '→ base'], 50, MONO, 700, 'center');
  text('ver', ['v2.3.0+41'], 60, MONO, 700, 'center');
  text('patch3', ['→ patch 3'], 60, MONO, 700, 'center');
  text('base', ['→ base'], 60, MONO, 700, 'center');
  text('android', ['android'], 40, MONO, 500, 'center');
  // sprites: the seal (gold rim, red wax, gold star), a check badge and a soft glow
  const sprite = (key: string, s: number, draw: (cx: number, cy: number, R: number) => void) => {
    const r = alloc(s, s);
    draw(r.x + s / 2, r.y + s / 2, s / 2);
    put(key, s, s, r);
  };
  sprite('seal', 200, (cx, cy, R) => {
    const rg = g.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
    rg.addColorStop(0, '#ffe6a0'); rg.addColorStop(0.6, '#d9a53e'); rg.addColorStop(1, '#8a5a14');
    g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, R - 4, 0, Math.PI * 2); g.fill();
    const wg = g.createRadialGradient(cx - R * 0.2, cy - R * 0.2, 2, cx, cy, R * 0.72);
    wg.addColorStop(0, '#d0393a'); wg.addColorStop(1, '#6e0f14');
    g.fillStyle = wg; g.beginPath(); g.arc(cx, cy, R * 0.72, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2c766';
    g.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? R * 0.22 : R * 0.52; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath(); g.fill();
    g.fillStyle = '#6e0f14'; g.beginPath(); g.arc(cx, cy, R * 0.12, 0, Math.PI * 2); g.fill();
  });
  sprite('check', 140, (cx, cy, R) => {
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, R - 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#000'; g.globalCompositeOperation = 'destination-out'; g.lineWidth = R * 0.24; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(cx - R * 0.42, cy + R * 0.02); g.lineTo(cx - R * 0.1, cy + R * 0.34); g.lineTo(cx + R * 0.45, cy - R * 0.3); g.stroke();
    g.globalCompositeOperation = 'source-over';
  });
  sprite('glow', 128, (cx, cy, R) => {
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,255,255,0.45)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  });
  return { canvas: cv, cells };
}

function createBench(high: boolean) {
  const group = new Object3D();
  group.position.copy(B_POS);
  group.rotation.y = B_YAW;

  // ------------------------------------------------ boxes: one instanced draw
  const NB = 640;
  const bA = new InstancedBufferAttribute(new Float32Array(NB * 4), 4); // x y z rotZ
  const bB = new InstancedBufferAttribute(new Float32Array(NB * 4), 4); // sx sy sz emissive
  const bC = new InstancedBufferAttribute(new Float32Array(NB * 4), 4); // r g b gloss
  for (const a of [bA, bB, bC]) a.setUsage(35048 /* DynamicDrawUsage */);
  {
    const A: N = instancedDynamicBufferAttribute(bA, 'vec4'), Bq: N = instancedDynamicBufferAttribute(bB, 'vec4'), C: N = instancedDynamicBufferAttribute(bC, 'vec4');
    const cr = cos(A.w), sr = sin(A.w);
    const rot = (v: N) => vec3(v.x.mul(cr).sub(v.y.mul(sr)), v.x.mul(sr).add(v.y.mul(cr)), v.z);
    const geo = new BoxGeometry(1, 1, 1);
    const mat = new MeshBasicNodeMaterial();
    mat.positionNode = rot(positionGeometry.mul(Bq.xyz)).add(A.xyz);
    const vN: N = varying(rot(normalGeometry), 'vFerBenchN');
    const vC: N = varying(C, 'vFerBenchC');
    const vE: N = varying(Bq.w, 'vFerBenchE');
    mat.colorNode = Fn(() => {
      const n = normalize(vN);
      const lam = max(dot(n, normalize(vec3(-0.25, 0.55, 0.8))), 0);
      const rim = pow(float(1).sub(abs(n.z)), 2).mul(0.25);
      const top = smoothstep(0.5, 0.9, n.y).mul(0.25);
      let c: N = vC.rgb.mul(float(0.22).add(lam.mul(0.78)).add(rim).add(top.mul(vC.w)));
      c = c.add(vC.rgb.mul(vE.mul(1.25))).mul(0.72);
      return vec4(clamp(c.mul(c.mul(2.51).add(0.03)).div(c.mul(c.mul(2.43).add(0.59)).add(0.14)), 0, 1), 1);
    })();
    mat.toneMapped = false;
    mat.fog = false;
    const mesh = new Mesh(geo, mat);
    (mesh as any).count = NB;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    group.add(mesh);
  }
  let nb = 0;
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, col: Color | [number, number, number], em = 0, rz = 0, gloss = 0) => {
    if (nb >= NB) return;
    const c = col instanceof Color ? [col.r, col.g, col.b] : col;
    bA.setXYZW(nb, x, y, z, rz);
    bB.setXYZW(nb, sx, sy, sz, em);
    bC.setXYZW(nb, c[0], c[1], c[2], gloss);
    nb++;
  };

  // ------------------------------------------------ labels / sprites: one instanced draw
  const atlas = makeAtlas();
  const atlasTex = new CanvasTexture(atlas.canvas);
  atlasTex.colorSpace = SRGBColorSpace;
  atlasTex.anisotropy = 8;
  const NL = 96;
  const lP = new InstancedBufferAttribute(new Float32Array(NL * 4), 4); // x y z rot
  const lS = new InstancedBufferAttribute(new Float32Array(NL * 4), 4); // w h ax(anchor -0.5..0.5) additive
  const lQ = new InstancedBufferAttribute(new Float32Array(NL * 4), 4); // u0 v0 u1 v1
  const lT = new InstancedBufferAttribute(new Float32Array(NL * 4), 4); // tint rgb, alpha
  for (const a of [lP, lS, lQ, lT]) a.setUsage(35048);
  {
    const P: N = instancedDynamicBufferAttribute(lP, 'vec4'), S: N = instancedDynamicBufferAttribute(lS, 'vec4');
    const Q: N = instancedDynamicBufferAttribute(lQ, 'vec4'), T: N = instancedDynamicBufferAttribute(lT, 'vec4');
    const geo = new PlaneGeometry(1, 1);
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const lx = positionGeometry.x.add(S.z).mul(S.x), ly = positionGeometry.y.mul(S.y);
    const cr = cos(P.w), sr = sin(P.w);
    mat.positionNode = vec3(lx.mul(cr).sub(ly.mul(sr)), lx.mul(sr).add(ly.mul(cr)), 0).add(P.xyz);
    const vUV: N = varying(mix(Q.xy, Q.zw, uv()), 'vFerLabUV');
    const vT: N = varying(T, 'vFerLabT');
    mat.colorNode = Fn(() => {
      const tx = texture(atlasTex, vUV);
      return vec4(tx.rgb.mul(vT.rgb), tx.a.mul(vT.a));
    })();
    mat.toneMapped = false;
    mat.fog = false;
    const mesh = new Mesh(geo, mat);
    (mesh as any).count = NL;
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    group.add(mesh);
  }
  let nl = 0;
  /** label by height h (metres); anchor 'l' left edge at x, 'c' centred */
  const label = (key: string, x: number, y: number, z: number, h: number, col: [number, number, number], a: number, anchor: 'l' | 'c' | 'r' = 'c', rot = 0) => {
    const c = atlas.cells[key];
    if (!c || nl >= NL || a <= 0.003) return;
    const w = h * c.asp;
    lP.setXYZW(nl, x, y, z, rot);
    lS.setXYZW(nl, w, h, anchor === 'l' ? 0.5 : anchor === 'r' ? -0.5 : 0, 0);
    lQ.setXYZW(nl, c.u0, c.v0, c.u1, c.v1);
    lT.setXYZW(nl, col[0], col[1], col[2], Math.min(1, a));
    nl++;
  };

  // ------------------------------------------------ layout + palette
  const GOLDc: [number, number, number] = [1.0, 0.66, 0.2];
  const GOLD_HI: [number, number, number] = [1.0, 0.85, 0.5];
  const PALEc: [number, number, number] = [0.85, 0.89, 0.95];
  const DIM: [number, number, number] = [0.55, 0.62, 0.75];
  const RED: [number, number, number] = [1.0, 0.42, 0.36];
  const NAVYB: [number, number, number] = [0.018, 0.026, 0.055];
  const TILE_BG: [number, number, number] = [0.03, 0.045, 0.09];
  const TILES = ['app-release.apk', 'Setup.exe', 'Runner.ipa', 'libapp.so'];
  const TP = 0.072, TB = 0.058;                // tile block pitch / size
  const tileX = (i: number) => 0.3 + 0.565 * i;
  const TILE_Y0 = 1.99;                        // bottom of the tile grids
  const slotTile = (ti: number, k: number) => {
    const c = k % COLS, r = Math.floor(k / COLS);
    return [tileX(ti) + (c - (COLS - 1) / 2) * TP, TILE_Y0 + (ROWS - 1 - r) * TP + TP / 2] as const;
  };
  const byteCol = (seed: number, tint: number): [number, number, number] => {
    const v = 0.55 + hash(seed) * 0.6;
    return [0.075 * v + tint * 0.012, 0.11 * v + tint * 0.018, 0.22 * v];
  };
  const PK = new Vector3(0.98, 1.67, 0.1);     // packet home
  const pkSlot = (j: number, s = 0.05) => [PK.x + ((j % 3) - 1) * s, PK.y + (Math.floor(j / 3) === 0 ? s / 2 : -s / 2)] as const;
  // hero devices
  const PH_W = 0.46, PH_H = 0.94, PH_Y = 0.07;
  const phX = (i: number) => 0.27 + 0.56 * i;
  const DP = 0.064, DB = 0.052;
  const slotDev = (i: number, k: number) => {
    const c = k % COLS, r = Math.floor(k / COLS);
    return [phX(i) + (c - (COLS - 1) / 2) * DP, PH_Y + 0.1 + (ROWS - 1 - r) * DP + DP / 2] as const;
  };
  const SCR_TOP = PH_Y + PH_H - 0.05;
  const BAR_X0 = 1.27, BAR_P = 0.098;

  const arc = (a: Vector3, b: Vector3, k: number, lift: number, out: Vector3) => {
    const it = 1 - k;
    const mx = (a.x + b.x) / 2, my = Math.max(a.y, b.y) + lift, mz = (a.z + b.z) / 2 + 0.55;
    return out.set(it * it * a.x + 2 * it * k * mx + k * k * b.x, it * it * a.y + 2 * it * k * my + k * k * b.y, it * it * a.z + 2 * it * k * mz + k * k * b.z);
  };
  const tmpA = new Vector3(), tmpB = new Vector3(), tmpC = new Vector3();
  const ph = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

  function update(t: number, time: number) {
    nb = 0; nl = 0;
    const show = sstep(0.02, 0.16, t);
    // ---- board: navy plate, gold rim, two gilt rules between the zones
    box(B_W / 2, B_H / 2, -0.03, B_W, B_H, 0.04, NAVYB, 0.02);
    const rimC: [number, number, number] = [0.8, 0.52, 0.18];
    box(B_W / 2, B_H + 0.015, -0.01, B_W + 0.06, 0.03, 0.06, rimC, 0.06, 0, 1);
    box(B_W / 2, -0.015, -0.01, B_W + 0.06, 0.03, 0.06, rimC, 0.06, 0, 1);
    box(-0.015, B_H / 2, -0.01, 0.03, B_H + 0.06, 0.06, rimC, 0.06, 0, 1);
    box(B_W + 0.015, B_H / 2, -0.01, 0.03, B_H + 0.06, 0.06, rimC, 0.06, 0, 1);
    box(B_W / 2, 1.43, 0.0, B_W - 0.12, 0.006, 0.01, rimC, 0.25);
    box(B_W / 2, 1.9, 0.0, B_W - 0.12, 0.006, 0.01, rimC, 0.12);

    // ---- base build: four shipped binaries as byte grids
    label('base build', 0.07, 2.735, 0.01, 0.115, GOLDc, show, 'l');
    label('release', B_W - 0.07, 2.735, 0.01, 0.075, DIM, show, 'r');
    const scan = ph(t, PT.scan[0], PT.scan[1]);
    const cut = ph(t, PT.cut[0], PT.cut[1]);
    const seal = ph(t, PT.seal[0], PT.seal[1]);
    for (let ti = 0; ti < 4; ti++) {
      const active = ti === 0;
      const hi = active ? sstep(0, 0.4, scan) : 0;
      box(tileX(ti), TILE_Y0 + ROWS * TP / 2, 0.0, COLS * TP + 0.05, ROWS * TP + 0.05, 0.02, active ? [0.05 + 0.15 * hi, 0.05 + 0.1 * hi, 0.08] : TILE_BG, 0.02 + hi * 0.15);
      label(TILES[ti], tileX(ti), 2.51, 0.02, 0.078, active ? (hi > 0.5 ? GOLD_HI : PALEc) : DIM, show);
      for (let k = 0; k < COLS * ROWS; k++) {
        const [x, y] = slotTile(ti, k);
        const changed = active && DIFF.includes(k);
        const shimmer = 0.5 + 0.5 * Math.sin(time * 1.3 + hash(ti * 40 + k) * 30);
        let col = byteCol(ti * 40 + k, ti);
        let em = 0.03 + 0.05 * shimmer * shimmer;
        if (changed && hi > 0) {
          const pulse = 0.6 + 0.4 * Math.sin(time * 5 + k);
          col = [lerp(col[0], GOLDc[0], hi), lerp(col[1], GOLDc[1], hi), lerp(col[2], GOLDc[2], hi)];
          em = lerp(em, 0.35 + 0.25 * pulse * (1 - cut), hi);
        }
        box(x, y, 0.025, TB, TB, 0.03, col, em);
      }
      // the iOS / Flutter binaries mark their patchable regions (assets, libapp) with a thin gold underline
      if (ti >= 2) box(tileX(ti), TILE_Y0 - 0.012, 0.02, COLS * TP, 0.008, 0.01, GOLDc, 0.2);
    }
    // ---- cut: copies of the changed blocks lift out of the APK and gather into the packet
    const packetHome = cut > 0;
    const bob = Math.sin(time * 1.6) * 0.012;
    if (packetHome) {
      DIFF.forEach((k, j) => {
        const kk = sstep(j * 0.08, 0.55 + j * 0.08, cut);
        const [sx, sy] = slotTile(0, k);
        const [px, py] = pkSlot(j);
        const x = lerp(sx, px, kk), y = lerp(sy, py + bob, kk);
        const z = 0.04 + Math.sin(kk * Math.PI) * 0.35 + 0.06 * kk;
        box(x, y, z, TB * lerp(1, 0.82, kk), TB * lerp(1, 0.82, kk), 0.03, GOLDc, 0.4 + 0.3 * (1 - seal), Math.sin(kk * Math.PI) * 0.6);
      });
    }
    // dotted gold trail: APK → packet (the diff was cut from this binary)
    if (cut > 0) for (let k = 0; k < 6; k++) {
      const u = (k + 0.5) / 6, a = sstep(u * 0.8, u * 0.8 + 0.2, cut);
      box(lerp(tileX(0) + 0.05, PK.x - 0.14, u), lerp(TILE_Y0 - 0.04, PK.y + 0.02, u * u), 0.01, 0.018, 0.018, 0.01, GOLDc, 0.35 * a);
    }
    // seal stamp → "signed diff"
    if (seal > 0) {
      const k = outCubic(seal);
      const s = lerp(0.55, 0.15, k);
      const flash = Math.exp(-Math.pow((seal - 0.75) / 0.12, 2));
      label('glow', PK.x, PK.y + bob, 0.12, 0.5 + flash * 0.5, GOLD_HI, 0.25 + flash * 0.6);
      label('seal', PK.x + 0.12 * k, PK.y - 0.06 * k + bob, 0.15, s, [1, 1, 1], sstep(0, 0.25, seal), 'c', (1 - k) * 0.8 + Math.sin(time * 0.8) * 0.05);
      const la = sstep(0.6, 1, seal) * show;
      label('signed diff', 1.25, 1.74, 0.02, 0.105, GOLDc, la, 'l');
      label('diffinfo', 1.25, 1.6, 0.02, 0.07, DIM, la, 'l');
    }

    // ---- rollout header: label + 10-device bar
    const rKey = t >= PT.dev[3][0] - 0.01 ? 'r100' : t >= PT.dev[1][0] - 0.01 ? 'r50' : 'r10';
    const rA = sstep(PT.dev[0][0] - 0.02, PT.dev[0][0] + 0.01, t) * show;
    label(rKey, 0.07, 1.31, 0.02, 0.092, rKey === 'r100' ? GOLD_HI : PALEc, Math.max(rA, 0.25 * show), 'l');
    const rb = ph(t, PT.rollback[0], PT.rollback[1]);
    for (let i = 0; i < 10; i++) {
      const on = sstep(PT.segAt[i] - 0.012, PT.segAt[i], t);
      const back = i === 9 ? sstep(0.45, 0.7, rb) : 0;
      const col: [number, number, number] = back > 0 ? [lerp(GOLDc[0], 0.75, back), lerp(GOLDc[1], 0.2, back), lerp(GOLDc[2], 0.18, back)] : on > 0.5 ? GOLDc : [0.1, 0.13, 0.22];
      box(BAR_X0 + i * BAR_P, 1.31, 0.02, 0.066, 0.11, 0.025, col, on * (0.35 + 0.1 * Math.sin(time * 2 + i)) * (1 - back * 0.5) + back * 0.3);
    }

    // ---- hero devices (one beta phone, two in the 50 % wave, one in stable that rolls back)
    for (let i = 0; i < 4; i++) {
      const [a, b] = PT.dev[i];
      const p = ph(t, a, b);
      const isRb = i === 3;
      const r = isRb ? rb : 0;
      const x = phX(i);
      box(x, PH_Y + PH_H / 2, 0.035, PH_W, PH_H, 0.05, [0.05, 0.055, 0.07], 0.0, 0, 1); // body
      // screen: relaunch blink between the swap and the new version
      const blink = p > 0.8 && p < 0.92 ? 1 - Math.sin(((p - 0.8) / 0.12) * Math.PI) : 1;
      const rbBlink = r > 0.25 && r < 0.4 ? 0.3 : 1;
      const done = sstep(0.9, 0.96, p) * (1 - sstep(0.45, 0.55, r));
      const sc: [number, number, number] = r > 0.05 && r < 0.45 ? [0.09, 0.025, 0.03] : [0.025, 0.035, 0.07];
      box(x, PH_Y + PH_H / 2, 0.062, PH_W - 0.05, PH_H - 0.06, 0.006, sc, 0.18 * blink * rbBlink + done * 0.08);
      // version lines
      const la = show * blink * rbBlink;
      label('ver', x, SCR_TOP - 0.065, 0.07, 0.085, PALEc, la * 0.95);
      if (done > 0) label('patch3', x, SCR_TOP - 0.16, 0.07, 0.08, GOLD_HI, la * done);
      else if (r > 0.55) label('base', x, SCR_TOP - 0.16, 0.07, 0.08, RED, la * sstep(0.55, 0.7, r));
      else label('android', x, SCR_TOP - 0.16, 0.07, 0.055, DIM, la * 0.7);
      // app blocks; changed slots get the patch blocks
      const swap = ph(p, 0.52, 0.82);
      for (let k = 0; k < COLS * ROWS; k++) {
        const [sx, sy] = slotDev(i, k);
        const j = DIFF.indexOf(k);
        const baseC = byteCol(100 + i * 40 + k, 0);
        if (j < 0) { box(sx, sy, 0.07, DB, DB, 0.012, baseC, 0.06 * blink * rbBlink); continue; }
        const kj = sstep(j * 0.1, 0.5 + j * 0.1, swap);   // this block's swap progress
        const rj = isRb ? sstep(0.4 + j * 0.05, 0.75 + j * 0.05, r) : 0; // rollback: gold leaves, base returns
        // old block: pushed out toward the viewer and shrinks away (and the reverse on rollback)
        const oldK = kj * (1 - rj);
        if (oldK < 0.999) {
          const e = oldK;
          box(sx + e * 0.05, sy + e * 0.08, 0.07 + e * 0.3, DB * (1 - e), DB * (1 - e), 0.012, baseC, 0.06 * blink, e * 2);
        }
        if (kj > 0.001 && rj < 0.999) {
          // new block: arrives from the hovering packet and settles into the slot
          const hx = x + ((j % 3) - 1) * 0.05, hy = PH_Y + PH_H * 0.48 + (Math.floor(j / 3) === 0 ? 0.025 : -0.025);
          const e = outCubic(kj);
          const s = DB * (1 - rj);
          box(lerp(hx, sx, e) + rj * 0.04, lerp(hy, sy, e) - rj * 0.12, lerp(0.32, 0.075, e) + rj * 0.25, s, s, 0.014, GOLDc,
            (0.25 + 0.45 * (1 - e) + 0.08 * Math.sin(time * 2 + k)) * blink, (1 - e) * 0.5 - rj * 1.5);
        }
      }
      // packet in flight → hover + verify
      if (p > 0 && p < 0.6) {
        const fk = sstep(0, 0.36, p);
        tmpA.set(PK.x, PK.y + bob, 0.15);
        tmpB.set(x, PH_Y + PH_H * 0.48, 0.32);
        arc(tmpA, tmpB, fk, 0.25, tmpC);
        const gather = p < 0.52 ? 1 : 0;
        if (gather) for (let j = 0; j < DIFF.length; j++) {
          box(tmpC.x + ((j % 3) - 1) * 0.05, tmpC.y + (Math.floor(j / 3) === 0 ? 0.025 : -0.025), tmpC.z, 0.046, 0.046, 0.03, GOLDc, 0.55, fk < 1 ? Math.sin(fk * Math.PI) * 0.4 : 0);
        }
        label('glow', tmpC.x, tmpC.y, tmpC.z - 0.02, 0.42, GOLD_HI, 0.35 * (1 - sstep(0.5, 0.6, p)));
        const vk = ph(p, 0.36, 0.5);
        label('seal', tmpC.x + 0.1, tmpC.y - 0.07, tmpC.z + 0.04, 0.13, [1, 1, 1], 1 - sstep(0.52, 0.6, p), 'c', vk * Math.PI * 2);
        if (vk > 0) label('check', tmpC.x + 0.1, tmpC.y - 0.07, tmpC.z + 0.05, 0.1, [0.55, 1, 0.6], sstep(0.25, 0.6, vk) * (1 - sstep(0.52, 0.6, p)));
      }
      // status above the device
      const verifyA = sstep(0.36, 0.42, p) * (1 - sstep(0.6, 0.66, p));
      const appliedA = sstep(0.84, 0.92, p) * (1 - sstep(0.02, 0.15, r)) * (1 - 0.35 * sstep(0.04, 0.08, t - b));
      const yS = PH_Y + PH_H + 0.115;
      if (verifyA > 0) label('verify', x, yS, 0.03, 0.155, [0.7, 1, 0.72], verifyA * show);
      if (appliedA > 0) label('applied', x, yS, 0.03, 0.155, GOLD_HI, appliedA * show);
      if (r > 0) label('rollback', x, yS, 0.03, 0.155, RED, sstep(0.05, 0.2, r) * show);
      if (done > 0.5 && p >= 1) label('check', x + PH_W / 2 - 0.06, PH_Y + 0.06, 0.08, 0.07, GOLDc, show);
    }
    // packet at home keeps glowing once sealed
    if (seal >= 1) label('glow', PK.x, PK.y + bob, 0.05, 0.36, GOLD_HI, 0.18 + 0.06 * Math.sin(time * 2.2));

    // flush: unused instances collapse to nothing
    for (let i = nb; i < NB; i++) bB.setXYZW(i, 0, 0, 0, 0);
    for (let i = nl; i < NL; i++) lT.setXYZW(i, 0, 0, 0, 0), lS.setXYZW(i, 0, 0, 0, 0);
    for (const a of [bA, bB, bC, lP, lS, lQ, lT]) a.needsUpdate = true;
  }
  return { group, update, high };
}

/** the in-world terminal on the edict, under the screenshot: the decree's text is the release command */
const TERM_LINES: { txt: string; at: [number, number]; kind: 'cmd' | 'out' }[] = [
  { txt: '$ ferman patch --release 2.3.0+41 --platform android \\', at: [0.165, 0.2], kind: 'cmd' },
  { txt: '      --channel beta --rollout 10', at: [0.2, 0.215], kind: 'cmd' },
  { txt: '  ✓ signed patch 3 · 6 blocks · beta 10%', at: [0.272, 0.273], kind: 'out' },
  { txt: '$ ferman rollout 3 50', at: [0.39, 0.41], kind: 'cmd' },
  { txt: '  ✓ patch 3 → 50%', at: [0.42, 0.421], kind: 'out' },
  { txt: '$ ferman promote 3 --channel stable', at: [0.54, 0.565], kind: 'cmd' },
  { txt: '  ✓ patch 3 → stable 100%', at: [0.572, 0.573], kind: 'out' },
];
function makeTerminal() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 384;
  const g = canvas.getContext('2d')!;
  const state = { canvas, dirty: true, key: '', set: (t: number, time: number) => {} };
  state.set = (t: number, time: number) => {
    const shown: { txt: string; kind: string }[] = [];
    for (const l of TERM_LINES) {
      const k = clamp01((t - l.at[0]) / (l.at[1] - l.at[0]));
      if (k <= 0) break;
      shown.push({ txt: l.txt.slice(0, Math.ceil(l.txt.length * k)), kind: l.kind });
    }
    const cursor = Math.floor(time * 1.8) % 2 === 0;
    const key = shown.map((s) => s.txt).join('|') + (cursor ? '_' : '');
    if (key === state.key) return;
    state.key = key;
    state.dirty = true;
    const W = canvas.width, H = canvas.height;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#111a33'); bg.addColorStop(1, '#070b16');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#c9902e'; g.lineWidth = 8; g.strokeRect(4, 4, W - 8, H - 8);
    g.strokeStyle = 'rgba(201,144,46,0.45)'; g.lineWidth = 2; g.strokeRect(18, 18, W - 36, H - 36);
    // title strip
    g.fillStyle = 'rgba(232,176,74,0.75)'; g.font = '600 30px Menlo, "DejaVu Sans Mono", monospace'; g.textBaseline = 'middle';
    g.fillText('release.sh  —  ci', 44, 46);
    [0, 1, 2].forEach((i) => { g.fillStyle = 'rgba(232,176,74,0.5)'; g.beginPath(); g.arc(W - 60 - i * 34, 48, 9, 0, Math.PI * 2); g.fill(); });
    const rows = shown.slice(-5);
    const lh = 52;
    g.font = '600 44px Menlo, "DejaVu Sans Mono", monospace';
    rows.forEach((r, i) => {
      const y = 96 + lh * (i + 0.5);
      if (r.kind === 'out') { g.fillStyle = '#f2c766'; g.fillText(r.txt, 44, y); return; }
      const m = r.txt.match(/^(\$ )(ferman)(.*)$/);
      let x = 44;
      const seg = (s: string, c: string) => { g.fillStyle = c; g.fillText(s, x, y); x += g.measureText(s).width; };
      if (m) { seg(m[1], '#7f8db0'); seg(m[2], '#f2c766'); seg(m[3], '#dfe6f2'); } else seg(r.txt, '#dfe6f2');
    });
    if (cursor) {
      const last = rows[rows.length - 1];
      const i = Math.max(0, rows.length - 1);
      const x = 44 + (last ? g.measureText(last.txt).width + 8 : 0);
      const y = 96 + lh * (rows.length ? i + 0.5 : 0.5);
      g.fillStyle = '#e8b04a'; g.fillRect(x, y - 21, 24, 42);
    }
  };
  return state;
}
