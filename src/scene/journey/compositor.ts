/**
 * Journey compositor: renders at most two stages (the current one and, inside a transition window, the
 * other one) into two pooled render targets and blends them with a transition shader. The blend runs inside
 * a fullscreen mesh of `scene`, which the app renders through the post chain's scene pass (fish-eye →
 * camcorder), so compositing costs no extra fullscreen copy.
 *
 * Transitions (uKind): 0 cut · 1 zoom-dissolve · 2 vertical wipe · 3 portal quad · 4 tape-glitch cut ·
 * 5 iris · 6 whiteout. Per-stage grade (StageGrade) is applied while sampling each slot.
 */
import {
  Scene, Mesh, PlaneGeometry, MeshBasicNodeMaterial, RenderTarget, HalfFloatType, Color, Vector2, Vector3, PerspectiveCamera,
  OrthographicCamera, type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, texture, screenUV, mix, smoothstep, clamp, max, min, pow, length, step, fract, sin,
  dot, floor, abs, agxToneMapping, saturation, positionGeometry, select,
} from 'three/tsl';
import type { Stage, StageGrade } from './types';
import type { TransitionKind } from '../../lib/timeline';

type N = any;

export const KIND_ID: Record<TransitionKind, number> = { cut: 0, zoom: 1, wipe: 2, portal: 3, glitch: 4, iris: 5, whiteout: 6 };

function slotUniforms() {
  return {
    exposure: uniform(1),
    tint: uniform(new Vector3(1, 1, 1)),
    contrast: uniform(1),
    sat: uniform(1),
    agx: uniform(0),
    vig: uniform(0),
    clampOn: uniform(0),
  };
}
type Slot = ReturnType<typeof slotUniforms>;

function setGrade(u: Slot, g: StageGrade | undefined) {
  u.exposure.value = g?.exposure ?? 1;
  const t = g?.tint ?? [1, 1, 1];
  (u.tint.value as Vector3).set(t[0], t[1], t[2]);
  u.contrast.value = g?.contrast ?? 1;
  u.sat.value = g?.saturation ?? 1;
  u.agx.value = g?.toneMap === 'agx' ? 1 : 0;
  u.vig.value = g?.vignette ? 1 : 0;
  u.clampOn.value = g?.clamp ? 1 : 0;
}

export function createCompositor(renderer: WebGPURenderer) {
  const opts = { type: HalfFloatType, depthBuffer: true };
  const rts = [new RenderTarget(1, 1, opts), new RenderTarget(1, 1, opts)];
  const slots = [slotUniforms(), slotUniforms()];
  const uP = uniform(0);
  const uKind = uniform(0);
  const uTwoSlots = uniform(0);
  const uTime = uniform(0);
  const uAspect = uniform(1);
  const uQuadOn = uniform(0);
  const uQ = [uniform(new Vector2()), uniform(new Vector2()), uniform(new Vector2()), uniform(new Vector2())];

  const hash = (v: N) => fract(sin(dot(v, vec2(12.9898, 78.233))).mul(43758.5453));

  const grade = (c: N, u: Slot, uv: N) => {
    let g: N = saturation(pow(max(c.mul(u.exposure).mul(u.tint).div(0.18), 0), vec3(u.contrast)).mul(0.18), u.sat);
    g = mix(g, agxToneMapping(g, float(1)), u.agx);
    g = mix(g, clamp(g, 0, 1), u.clampOn);
    const vig = float(1).sub(smoothstep(0.25, 0.95, length(uv.sub(0.5))).mul(0.8));
    return g.mul(mix(float(1), vig, u.vig));
  };

  const colorNode = Fn(() => {
    const uv = screenUV; // y down
    const p = uP;
    const bump = sin(p.mul(Math.PI));
    const k = uKind;
    const centred = uv.sub(0.5).mul(vec2(uAspect, 1));
    const r = length(centred);

    // ---- per-kind sample coordinates
    // zoom-dissolve: dive into A, B settles from a slight push-in
    const zoomA = uv.sub(0.5).div(float(1).add(p.mul(p).mul(2.2))).add(0.5);
    const zoomB = uv.sub(0.5).div(float(1).add(float(1).sub(p).mul(0.35))).add(0.5);
    // glitch: horizontal tape slices shoved sideways, re-rolled ~14×/s
    const tick = floor(uTime.mul(14));
    const rows = float(18).add(hash(vec2(tick, 3.1)).mul(26));
    const row = floor(uv.y.mul(rows));
    const rr = hash(vec2(row, tick));
    const shove = rr.sub(0.5).mul(0.22).mul(bump).mul(step(0.55, hash(vec2(row.add(7), tick))));
    const glA = vec2(fract(uv.x.add(shove)), uv.y);
    const glB = vec2(fract(uv.x.add(shove.mul(0.6))), uv.y);
    // iris: B grows from the centre with a slight settle
    const irisB = uv.sub(0.5).mul(float(1).sub(float(1).sub(p).mul(0.12))).add(0.5);

    const isZoom = step(0.5, k).mul(step(k, 1.5));
    const isGlitch = step(3.5, k).mul(step(k, 4.5));
    const isIris = step(4.5, k).mul(step(k, 5.5));
    const uvA = mix(mix(uv, zoomA, isZoom), glA, isGlitch);
    const uvB = mix(mix(mix(uv, zoomB, isZoom), glB, isGlitch), irisB, isIris);

    const A: N = grade(texture(rts[0].texture, uvA).rgb, slots[0], uvA);
    const B: N = grade(texture(rts[1].texture, uvB).rgb, slots[1], uvB);

    // ---- masks (1 = show B)
    const cut = step(0.5, p);
    // zoom: noisy dissolve that eats the image from the centre outwards, with a cold glowing front
    const blocks = hash(floor(uv.mul(vec2(uAspect.mul(90), 90))));
    const front = p.mul(1.5).sub(r.mul(0.45)).sub(blocks.mul(0.35));
    const zoomM = step(0, front);
    const zoomGlow = float(1).sub(smoothstep(0, 0.05, abs(front))).mul(bump);
    const wipe = step(uv.y, p);
    // portal: inside the projected convex quad (any winding)
    const edge = (a: N, b: N) => {
      const e = b.sub(a), q = uv.sub(a);
      return e.x.mul(q.y).sub(e.y.mul(q.x));
    };
    const e0 = edge(uQ[0], uQ[1]), e1 = edge(uQ[1], uQ[2]), e2 = edge(uQ[2], uQ[3]), e3 = edge(uQ[3], uQ[0]);
    const inQ = max(step(0, e0).mul(step(0, e1)).mul(step(0, e2)).mul(step(0, e3)), step(e0, 0).mul(step(e1, 0)).mul(step(e2, 0)).mul(step(e3, 0)));
    const portal = max(inQ.mul(uQuadOn), step(0.999, p));
    // glitch: rows switch at random moments
    const glitchM = step(rr, smoothstep(0.15, 0.85, p));
    // iris: soft circle
    const R = p.mul(1.08);
    const irisM = smoothstep(R, R.sub(0.015), r);
    const irisRing = float(1).sub(smoothstep(0, 0.02, abs(r.sub(R)))).mul(bump);

    const m = select(k.lessThan(0.5), cut,
      select(k.lessThan(1.5), zoomM,
        select(k.lessThan(2.5), wipe,
          select(k.lessThan(3.5), portal,
            select(k.lessThan(4.5), glitchM,
              select(k.lessThan(5.5), irisM, float(0)))))));
    let c: N = mix(A, B, m.mul(uTwoSlots));

    // whiteout: A blooms to white with drifting flakes, then B fades in from white
    const isWhite = step(5.5, k).mul(uTwoSlots);
    const flakes = step(0.985, hash(floor(uv.add(vec2(uTime.mul(0.03), uTime.mul(-0.08))).mul(vec2(uAspect.mul(160), 160)))));
    const toWhite = smoothstep(0, 0.5, p);
    const fromWhite = smoothstep(0.5, 1, p);
    const white = vec3(0.92, 0.95, 1);
    const wo = mix(mix(A, white, min(toWhite.add(flakes.mul(bump).mul(0.6)), 1)), B, fromWhite.mul(fromWhite));
    const woOut = mix(wo, white, float(1).sub(fromWhite).mul(step(0.5, p)).mul(0.9));
    c = mix(c, woOut, isWhite);

    // glows
    c = c.add(vec3(0.75, 0.88, 1).mul(zoomGlow).mul(isZoom).mul(uTwoSlots).mul(0.9));
    c = c.add(vec3(1, 0.97, 0.9).mul(irisRing).mul(isIris).mul(uTwoSlots).mul(0.6));
    // glitch: brightness flicker per slice + a hint of chroma bleed
    const flick = hash(vec2(row, tick.add(9))).sub(0.5).mul(0.35).mul(bump).mul(isGlitch).mul(uTwoSlots);
    c = c.mul(float(1).add(flick)).add(vec3(0.05, 0, 0.08).mul(bump).mul(isGlitch).mul(uTwoSlots).mul(step(0.8, rr)));
    return vec4(max(c, 0), 1);
  })();

  const mat = new MeshBasicNodeMaterial();
  mat.vertexNode = vec4(positionGeometry.xy, 0, 1);
  mat.colorNode = colorNode;
  mat.toneMapped = false;
  mat.depthTest = false;
  mat.depthWrite = false;
  const mesh = new Mesh(new PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const clearColor = new Color();

  /** render a stage into slot i with the overscanned projection the fish-eye expects */
  function renderStage(stage: Stage, i: number, overscan: number) {
    const rt = rts[i];
    const cam = stage.camera as PerspectiveCamera;
    const fov = cam.fov, aspect = cam.aspect;
    cam.fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * overscan) * 180) / Math.PI;
    cam.aspect = aspect / overscan;
    cam.updateProjectionMatrix();
    if (stage.render) stage.render(renderer, rt);
    else {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(stage.background, 1);
      renderer.clear();
      renderer.render(stage.scene, cam);
    }
    cam.fov = fov;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    setGrade(slots[i], stage.grade);
  }

  return {
    scene,
    camera,
    setSize(w: number, h: number) {
      for (const rt of rts) rt.setSize(w, h);
      uAspect.value = w / h;
    },
    /**
     * a: stage in slot 0 (always), b: optional second stage (transition target), p: progress, kind.
     * When b is given, a is the stage being left (from) and b the one being entered (to).
     */
    render(a: Stage, b: Stage | null, kind: TransitionKind, p: number, time: number, overscan: number) {
      renderer.getClearColor(clearColor);
      const alpha = renderer.getClearAlpha();
      renderStage(a, 0, overscan);
      if (b) {
        renderStage(b, 1, overscan);
        if (kind === 'portal') {
          const q = a.portalQuad?.() ?? null;
          uQuadOn.value = q ? 1 : 0;
          if (q) q.forEach(([x, y], j) => (uQ[j].value as Vector2).set(x * 0.5 + 0.5, 0.5 - y * 0.5));
        }
      }
      uTwoSlots.value = b ? 1 : 0;
      // portal without a quad on the leaving stage → fall back to an iris
      uKind.value = b ? (kind === 'portal' && !a.portalQuad ? KIND_ID.iris : KIND_ID[kind]) : 0;
      uP.value = b ? p : 0;
      uTime.value = time;
      renderer.setRenderTarget(null);
      renderer.setClearColor(clearColor, alpha);
    },
    dispose() {
      for (const rt of rts) rt.dispose();
      mat.dispose();
    },
  };
}
