import type { WebGPURenderer, Node, PassNode, UniformNode } from 'three/webgpu';
import { screenUV, vec4 } from 'three/tsl';

export type PostState = { isHome: boolean; isPhone: boolean; inside: boolean; idx: number; sceneT: number; lastOpen: number };

/**
 * Post chain: fish-eye (+ overscan) → camcorder/VHS + CRT.
 * The camcorder stage is pluggable: see ./camcorder.ts (built separately).
 */
export function createPostChain(o: {
  renderer: WebGPURenderer;
  scenePass: PassNode;
  uFish: UniformNode<'float', number>;
  uOverscan: UniformNode<'float', number>;
  fishEye: (uv: Node, s: Node, ov: Node) => Node;
}) {
  const uvFish = o.fishEye(screenUV, o.uFish, o.uOverscan);
  const src = o.scenePass.getTextureNode('output');
  const sampled = src.sample(uvFish);
  let output: Node = vec4(sampled.rgb, 1);
  let cam: {
    update: (dt: number, t: number, s: PostState) => void;
    setSize: (w: number, h: number) => void;
    toSource?: (u: number, v: number) => [number, number];
    fromSource?: (u: number, v: number) => [number, number];
    debug?: { zoomOut: number };
  } | null = null;
  try {
    // camcorder module is optional until it exists
    const mod = (import.meta as any).glob('./camcorder.ts', { eager: true })['./camcorder.ts'] as any;
    if (mod?.createCamcorder) {
      const c = mod.createCamcorder({ renderer: o.renderer, source: sampled, sourceTexture: src, uvFish, uFish: o.uFish, uOverscan: o.uOverscan });
      output = c.output;
      cam = c;
    }
  } catch (e) {
    console.warn('camcorder unavailable', e);
  }
  return {
    output,
    update: (dt: number, t: number, s: PostState) => cam?.update(dt, t, s),
    setSize: (w: number, h: number) => cam?.setSize(w, h),
    /** screen uv → uv fed into the fish-eye (undo CRT bulge/zoom/handheld) */
    toSource: (u: number, v: number): [number, number] => cam?.toSource?.(u, v) ?? [u, v],
    /** inverse of toSource */
    fromSource: (u: number, v: number): [number, number] => cam?.fromSource?.(u, v) ?? [u, v],
  };
}
