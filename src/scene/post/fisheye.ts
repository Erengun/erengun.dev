import { Fn, vec2, float, screenSize } from 'three/tsl';
import type { Node } from 'three/webgpu';

/**
 * Fish-eye lens with overscan (spec-3d §4.1).
 * Maps an output screen uv to the uv to sample in the (taller, overscanned) scene pass.
 */
export const fishEye = Fn(([uv, s, overscanY]: [Node, Node, Node]) => {
  const aspect = screenSize.x.div(screenSize.y);
  const p = uv.sub(0.5).mul(2).mul(vec2(aspect, 1));
  const d = vec2(
    float(1).sub(p.y.mul(p.y)).mul(s).mul(p.x).mul(1.2),
    float(1).sub(p.x.mul(p.x)).mul(s).mul(p.y).mul(1.2),
  );
  return p.sub(d).div(vec2(aspect, overscanY)).mul(0.5).add(0.5);
});

/** CPU mirror of the shader, uv in 0..1 (y up). */
export function fishEyeCPU(u: number, v: number, s: number, aspect: number, overscanY: number): [number, number] {
  const px = (u - 0.5) * 2 * aspect;
  const py = (v - 0.5) * 2;
  const dx = (1 - py * py) * s * px * 1.2;
  const dy = (1 - px * px) * s * py * 1.2;
  return [((px - dx) / aspect) * 0.5 + 0.5, ((py - dy) / overscanY) * 0.5 + 0.5];
}

/** inverse: find screen uv that samples pass uv (u,v). 12 fixed-point iterations. */
export function fishEyeInverseCPU(u: number, v: number, s: number, aspect: number, overscanY: number): [number, number] {
  let x = u, y = v;
  for (let i = 0; i < 12; i++) {
    const [fx, fy] = fishEyeCPU(x, y, s, aspect, overscanY);
    x += u - fx;
    y += v - fy;
  }
  return [x, y];
}

export const overscanScale = (aspect: number, s: number) => Math.min(2, Math.max(1, 1 + Math.max(0, aspect * aspect - 1) * s * 1.2));
