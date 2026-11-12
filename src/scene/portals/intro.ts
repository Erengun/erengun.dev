/**
 * Intro portal: "DOT-MATRIX YOU". Eren's portrait rebuilt from glowing LED dots and dot-font glyphs (OffBit dot font
 * atlas), intentionally low-res and graphic.
 *
 * Data (tools/portrait/dots_prep.py, from the local photo pipeline): a 128×128 RGBA texture,
 *   R = LED intensity (local-contrast luma + edge emphasis), G = depth, B = ink (dark features + edges), A = matte.
 * Glyphs: tools/portrait/glyph_atlas.py → 8×4 atlas: 0..9 luma ramp " .:-=+*#%@", 10..31 letters/symbols.
 *
 * One instanced draw (Sprite with count = 128², SpriteNodeMaterial, additive glow), no per-instance attributes:
 * cell = instanceIndex. Small relief from depth; rendered through a narrow "dolly" lens with the same framing as the
 * inner camera, so the relief parallaxes (pointer/tilt + slow drift) without wide-angle distortion.
 * Motion: power-on wave + glyph scramble on reveal, idle scramble waves + scanline sweep, cursor repel/scale/scramble
 * + ripple on hover-enter, progress-driven exit (dots stream into depth) from f.focus (journey: focus = 1 − exit).
 * Works on WebGPU and WebGL2 (no compute).
 */
import {
  Scene, Color, Group, Sprite, Mesh, PlaneGeometry, SpriteNodeMaterial, MeshBasicNodeMaterial, Texture,
  NearestFilter, LinearFilter, NoColorSpace, AdditiveBlending, Vector2, Vector3, Matrix4, PerspectiveCamera,
  type WebGPURenderer, type RenderTarget,
} from 'three/webgpu';
import {
  Fn, uniform, float, int, ivec2, vec2, vec3, vec4, instanceIndex, textureLoad, texture, varying, uv,
  smoothstep, mix, clamp, floor, fract, max, min, abs, length, exp, select, hash, sin, fwidth, positionGeometry,
} from 'three/tsl';
import type { Portal, PortalContext, PortalFrame } from '../types';

const BASE = '/portrait/';
const C = 128;                      // dot columns/rows
const ICE = new Color('#cde7e9');   // warm off-white / ice LED colour (linear via Color)
const FRAME_DIST = 2.2;             // camera → dot plane (portal units, inner-camera space)
const RELIEF = 0.22;                // depth relief as a fraction of the frame width (small: stays frontal)
const LENS_FOV = 28;                // dolly lens
const WIDEN = 1.12;                 // horizontal stretch of the portrait (user: "make face wider")
const REVEAL_S = 1.6;
const GLYPH_COLS = 8, GLYPH_ROWS = 4;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('intro dots: failed to load ' + src));
    im.src = src;
  });
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const outQuad = (t: number) => 1 - (1 - t) * (1 - t);

export function createIntroPortal(_ctx: PortalContext): Portal {
  const scene = new Scene();
  const background = new Color('#000000');
  const group = new Group();
  scene.add(group);
  const src = typeof location !== 'undefined' && new URLSearchParams(location.search).get('src') === 'ski' ? 'ski' : 'face';

  const dataTex = new Texture();
  const glyphTex = new Texture();
  dataTex.flipY = false; dataTex.generateMipmaps = false; dataTex.minFilter = dataTex.magFilter = NearestFilter; dataTex.colorSpace = NoColorSpace;
  glyphTex.flipY = false; glyphTex.generateMipmaps = false; glyphTex.minFilter = glyphTex.magFilter = LinearFilter; glyphTex.colorSpace = NoColorSpace;

  // ------------------------------------------------------------------ uniforms
  const uFW = uniform(5);                         // frame width (portal units)
  const uTime = uniform(0);
  const uReveal = uniform(0);                     // 0..~1.15 power-on wave progress
  const uExit = uniform(0);                       // 0..1 exit progress
  const uCursor = uniform(new Vector2(99, 99));   // local plane coords (portal units)
  const uVel = uniform(new Vector2());
  const uHover = uniform(0);
  const uWave = uniform(new Vector2());
  const uWaveP = uniform(1);

  // ------------------------------------------------------------------ per-dot (vertex stage)
  const idx = instanceIndex.toInt();
  const col = idx.mod(C), row = idx.div(C);
  const fx = col.toFloat().add(0.5).div(C), fy = row.toFloat().add(0.5).div(C);   // 0..1, fy from the top
  const d4 = textureLoad(dataTex, ivec2(col, row), int(0));
  const inten0 = d4.r, depth = d4.g, ink = d4.b, matte = d4.a;
  const fi = idx.toFloat();
  const h = hash(fi), h2 = hash(fi.add(17.31)), h3 = hash(fi.add(51.7));
  // sparse dim background dots
  const bgDot = select(h.greaterThan(0.86), float(0.07), float(0.0)).mul(float(1).sub(matte));
  const inten = max(inten0, bgDot);
  const cell = uFW.div(C);
  const base = vec3(fx.sub(0.5).mul(uFW), float(0.5).sub(fy).mul(uFW),
    select(depth.greaterThan(0.02), depth.sub(0.5).mul(uFW).mul(RELIEF), uFW.mul(-0.12)));

  // reveal: left→right power-on wave with jitter, glyphs scramble while powering on
  const th = mix(fx, h, 0.25).mul(0.85);
  const on = smoothstep(th, th.add(0.1), uReveal);
  const revealScr = smoothstep(th, th.add(0.04), uReveal).mul(float(1).sub(smoothstep(th.add(0.12), th.add(0.28), uReveal)));
  // idle scramble wave (diagonal), scanline sweep
  const wavePos = fract(uTime.div(7)).mul(1.8).sub(0.4);
  const idleScr = float(1).sub(smoothstep(0.0, 0.05, abs(fx.add(fy).mul(0.5).sub(wavePos)))).mul(select(h2.lessThan(0.55), float(1), float(0)));
  const sd = fy.sub(fract(uTime.div(6.5)));
  const scan = exp(sd.mul(sd).div(-0.0009)).mul(0.45);
  // cursor: repel + scale + scramble, ripple ring on hover-enter
  const toC = base.xy.sub(uCursor);
  const dist = length(toC);
  const R = uFW.mul(0.11);
  const fall = float(1).sub(smoothstep(0.0, R, dist.mul(h3.mul(0.5).add(0.75)))).mul(uHover);
  const dir = toC.div(max(dist, 1e-4));
  const speed = length(uVel);
  const toW = base.xy.sub(uWave);
  const wd = length(toW);
  const ring = float(1).sub(smoothstep(0.0, uFW.mul(0.04), abs(wd.sub(uWaveP.mul(uFW).mul(0.9))))).mul(float(1).sub(uWaveP));
  const push = dir.mul(fall.mul(cell.mul(2.2).add(min(speed.mul(0.05), cell.mul(6)))))
    .add(toW.div(max(wd, 1e-4)).mul(ring.mul(cell.mul(1.5))));
  const lift = fall.mul(uFW.mul(0.05)).add(ring.mul(uFW.mul(0.02)));
  // exit: dots stream into depth with per-dot delay, then fade
  const delay = h.mul(0.45);
  const ee = clamp(uExit.sub(delay).div(0.55), 0, 1);
  const ee2 = ee.mul(ee);
  const exitOff = vec3(fx.sub(0.5).mul(ee2).mul(uFW).mul(0.3), ee2.mul(h2.sub(0.7)).mul(uFW).mul(0.25), ee2.mul(h2.mul(4).add(1.5)).mul(uFW).negate());
  const exitA = float(1).sub(smoothstep(0.65, 1.0, ee));
  // tiny per-dot breathing so it never looks frozen
  const shimmer = sin(uTime.mul(1.3).add(h.mul(40))).mul(cell.mul(0.04));

  const pos = base.add(vec3(push, lift.add(shimmer))).add(exitOff);
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  mat.positionNode = pos;
  mat.scaleNode = vec2(cell.mul(2.3).mul(float(1).add(fall.mul(0.9))).mul(float(1).sub(ee.mul(0.4))));

  const scramble = max(max(revealScr, idleScr), smoothstep(0.15, 0.4, fall));
  // ink cells (dark features + contours) are dense glyphs; a sparse subset of bright cells too (ASCII sparkle)
  const isInk = ink.greaterThan(0.35);
  const isGlyph = select(isInk.or(h.lessThan(0.08).and(inten.greaterThan(0.35))), float(1), float(0));
  // ink: darker → denser glyph (+ * # % @); bright sparkle cells use the luma ramp
  const ramp = select(isInk, floor(clamp(ink, 0, 0.999).mul(5)).add(5), floor(clamp(inten, 0, 0.999).mul(9)).add(1));
  const tick = floor(uTime.mul(16));
  const rnd = floor(hash(fi.add(tick.mul(13.7))).mul(22)).add(10);
  const glyph = select(scramble.greaterThan(0.5), rnd, ramp);
  const showGlyph = isGlyph.greaterThan(0.5).or(scramble.greaterThan(0.5).and(inten.greaterThan(0.12)));
  const vGlyph = varying(select(showGlyph, glyph, float(-1)), 'vGlyph');
  const glyphLevel = select(isInk, mix(0.30, 0.46, ink), inten);   // ink glyphs: steady mid brightness
  const vInt = varying(select(isGlyph.greaterThan(0.5), glyphLevel, inten).mul(on).mul(exitA).mul(float(1).add(scan)).mul(float(1).add(fall.mul(0.6))), 'vInt');

  // ------------------------------------------------------------------ fragment: LED dot or dot-font glyph, soft glow
  mat.colorNode = Fn(() => {
    const q = uv().mul(2).sub(1);
    const d = length(q);
    const I = vInt;
    // LED: core radius follows intensity (halftone), plus a soft CRT halo
    const r = mix(0.05, 0.38, clamp(I, 0, 1));
    const core = float(1).sub(smoothstep(r.mul(0.65), r, d));
    const halo = exp(d.mul(d).mul(-9.0)).mul(0.22);
    const led = core.add(halo).mul(I.pow(1.25)).mul(1.4);
    // glyph: atlas sampled in a ~1.2-cell box at the sprite centre
    const g = max(vGlyph, 0);
    const gx = g.mod(GLYPH_COLS), gy = floor(g.div(GLYPH_COLS));
    const lu = uv().sub(0.5).mul(2.3 / 1.2).add(0.5);
    const inBox = select(lu.x.greaterThan(0).and(lu.x.lessThan(1)).and(lu.y.greaterThan(0)).and(lu.y.lessThan(1)), float(1), float(0));
    const auv = vec2(gx.add(lu.x).div(GLYPH_COLS), gy.add(float(1).sub(lu.y)).div(GLYPH_ROWS));
    const ga = texture(glyphTex, auv).a.mul(inBox);
    const gly = ga.mul(I.mul(1.45)).add(halo.mul(I).mul(0.4));
    const a = select(vGlyph.lessThan(0), led, gly);
    return vec4(vec3(ICE.r, ICE.g, ICE.b).mul(a), a);
  })();
  mat.opacityNode = float(1);

  const dots = new Sprite(mat);
  dots.count = C * C;
  dots.frustumCulled = false;
  dots.renderOrder = 2;
  group.add(dots);

  // ------------------------------------------------------------------ faint grid behind (every 8 dots)
  const gridMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  gridMat.colorNode = Fn(() => {
    const p = positionGeometry.xy.mul(3).mul(C / 8);   // plane is scaled ×3·FW; cells of 8 dots
    const f = fract(p);
    const w = fwidth(p);
    const dd = min(f, float(1).sub(f)).div(max(w, vec2(1e-5)));
    const line = float(1).sub(smoothstep(0.3, 1.0, min(dd.x, dd.y)));
    const fade = float(1).sub(uExit).mul(smoothstep(0.0, 0.6, uReveal));
    return vec4(vec3(ICE.r, ICE.g, ICE.b).mul(line.mul(0.022).mul(fade)), 1);
  })();
  const grid = new Mesh(new PlaneGeometry(1, 1), gridMat);
  grid.frustumCulled = false;
  grid.renderOrder = 0;
  group.add(grid);

  // ------------------------------------------------------------------ assets
  const ready = (async () => {
    const [di, gi] = await Promise.all([loadImage(BASE + `dots-${src}.png`), loadImage(BASE + 'glyphs.png')]);
    dataTex.image = di; dataTex.needsUpdate = true;
    glyphTex.image = gi; glyphTex.needsUpdate = true;
  })();

  // ------------------------------------------------------------------ lens + state
  const lensCam = new PerspectiveCamera(LENS_FOV, 1, 0.05, 500);
  const fwd = new Vector3(), gpos = new Vector3(), ro = new Vector3(), rp = new Vector3();
  const inv = new Matrix4();
  function updateLens(c: PerspectiveCamera) {
    c.getWorldDirection(fwd);
    group.getWorldPosition(gpos);
    const D = Math.max(0.1, gpos.sub(c.position).dot(fwd));
    const k = Math.tan((c.fov * Math.PI) / 360) / Math.tan((LENS_FOV * Math.PI) / 360);
    lensCam.position.copy(c.position).addScaledVector(fwd, -D * (k - 1));
    lensCam.quaternion.copy(c.quaternion);
    lensCam.aspect = c.aspect;
    lensCam.far = D * k + 100;
    lensCam.updateProjectionMatrix();
    lensCam.updateMatrixWorld();
    // frame width: ~fill the height, never much wider than the view (phones)
    const visH = 2 * D * Math.tan((c.fov * Math.PI) / 360);
    const visW = visH * c.aspect;
    uFW.value = Math.min(visH * 0.62, visW * 0.95);
    group.scale.x = WIDEN;
    grid.scale.set(uFW.value * 3, uFW.value * 3, 1);
    grid.position.z = -uFW.value * 0.15;
  }

  const debug: { reveal?: number; exit?: number; cursor?: [number, number] } = {};
  let t = 0, revealClock = -1, hit = false, wasHit = false, waveClock = -1;
  const cursor = new Vector2(99, 99), prev = new Vector2(99, 99), vel = new Vector2(), tmp = new Vector2();

  function locate(f: PortalFrame) {
    ro.setFromMatrixPosition(lensCam.matrixWorld);
    rp.set(f.pointer.x, f.pointer.y, 0.5).applyMatrix4(lensCam.projectionMatrixInverse).applyMatrix4(lensCam.matrixWorld);
    inv.copy(group.matrixWorld).invert();
    ro.applyMatrix4(inv); rp.applyMatrix4(inv).sub(ro);
    if (Math.abs(rp.z) < 1e-6) return false;
    const s = -ro.z / rp.z;
    cursor.set(ro.x + rp.x * s, ro.y + rp.y * s);
    const half = uFW.value / 2;
    return Math.abs(cursor.x) < half && Math.abs(cursor.y) < half;
  }

  function update(f: PortalFrame) {
    const dt = Math.min(f.dt, 0.1);
    t += dt;
    uTime.value = t;
    const exit = debug.exit ?? clamp01(1 - f.focus);
    uExit.value = exit;
    if (f.gateOpen && revealClock < 0) revealClock = 0;
    else if (revealClock >= 0) revealClock += dt;
    uReveal.value = debug.reveal ?? (revealClock < 0 ? 0 : clamp01(revealClock / REVEAL_S) * 1.15);
    // placement + slow drift / parallax (small rotations: the lens keeps it undistorted)
    group.position.set(0, 0, 0.406 - FRAME_DIST);
    group.rotation.y = Math.sin((t * 2 * Math.PI) / 12) * 0.045 + f.parallax.x * 0.07 * (1 - exit);
    group.rotation.x = Math.sin((t * 2 * Math.PI) / 9) * 0.025 - f.parallax.y * 0.045 * (1 - exit);
    group.updateMatrixWorld();
    updateLens(f.camera);
    // pointer
    const interactive = f.pointer.inside && exit < 0.3 && uReveal.value > 0.6;
    hit = interactive ? locate(f) : false;
    if (debug.cursor) { cursor.set(debug.cursor[0] * uFW.value * 0.5, debug.cursor[1] * uFW.value * 0.5); hit = true; }
    if (hit) {
      if (prev.x > 90) prev.copy(cursor);
      tmp.copy(cursor).sub(prev).divideScalar(Math.max(dt, 1e-3));
      if (tmp.length() > 60) tmp.set(0, 0);
      prev.copy(cursor);
      vel.lerp(tmp, 1 - Math.exp(-30 * dt));
    } else prev.set(99, 99);
    vel.multiplyScalar(Math.exp(-6 * dt));
    uVel.value.copy(vel);
    uCursor.value.copy(cursor);
    uHover.value += ((hit ? 1 : 0) - uHover.value) * (1 - Math.exp(-(hit ? 12 : 4) * dt)); // spring-ish settle
    if (hit && !wasHit) { waveClock = 0; uWave.value.copy(cursor); } else if (waveClock >= 0) waveClock += dt;
    wasHit = hit;
    uWaveP.value = waveClock < 0 ? 1 : outQuad(clamp01(waveClock / 1.4));
  }

  function render(renderer: WebGPURenderer, _camera: PerspectiveCamera, rt: RenderTarget) {
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, lensCam);
  }

  const portal: Portal & { debug: typeof debug } = {
    debug, scene, background, ready, update, render,
    dispose() {
      dataTex.dispose(); glyphTex.dispose(); mat.dispose(); gridMat.dispose(); grid.geometry.dispose();
    },
  };
  return portal;
}
