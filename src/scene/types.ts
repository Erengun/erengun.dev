import type { Color, PerspectiveCamera, Scene, WebGPURenderer, RenderTarget } from 'three/webgpu';

/** Per-frame data every portal receives. */
export interface PortalFrame {
  dt: number;
  time: number;
  /** 0 = resting on the carousel, 1 = fully flown-through (covers the screen) */
  openness: number;
  /** 0..1 how centred this tile is in the carousel (1 = current stop) */
  focus: number;
  /** inner camera: same projection as the main camera, posed relative to the portal plane */
  camera: PerspectiveCamera;
  /** pointer in NDC (-1..1) after inverse fish-eye */
  pointer: { x: number; y: number; inside: boolean; down: boolean };
  /** device tilt on touch devices, else pointer */
  parallax: { x: number; y: number };
  /** scrolled viewports (0..18.1) */
  vp: number;
  /** progress through the last scene (0..1), only meaningful for the last tile */
  sceneT: number;
  isPhone: boolean;
  /** true once the preloader gate opened */
  gateOpen: boolean;
  /** for project portals: active slide index and whether we're inside the project */
  slide: number;
  inside: boolean;
}

/**
 * A portal is a separate scene seen through a tile's plane. Its contents live in the tile's
 * local frame: the plane is at z = 0 spanning PORTAL_W × PORTAL_H, and the content sits behind it (z < 0).
 */
export interface Portal {
  scene: Scene;
  background: Color;
  /** asset loading, resolves when ready to draw */
  ready: Promise<void>;
  update(f: PortalFrame): void;
  /** optional custom render into rt (multi-pass scenes); default: renderer.render(scene, camera) */
  render?(renderer: WebGPURenderer, camera: PerspectiveCamera, rt: RenderTarget): void;
  /** pointer click inside the opened portal, NDC coords. Return true if consumed. */
  onClick?(x: number, y: number): boolean;
  dispose?(): void;
}

export interface PortalContext {
  renderer: WebGPURenderer;
  isPhone: boolean;
  quality: 'high' | 'medium';
}

export const PORTAL_H = 1.5;
export const PORTAL_W = 1.5 * (65 / 42); // 2.3214
