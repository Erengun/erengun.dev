import type { Color, PerspectiveCamera, Scene, WebGPURenderer, RenderTarget } from 'three/webgpu';
import type { Project } from '../../lib/content';

/**
 * Journey = the whole site as one scroll-driven chain of fullscreen stages:
 *   intro → corridor (about) → city (who) → project worlds ×N → alley (contact)
 * Each stage renders its own scene with its own camera into a render target; the compositor
 * blends the current and next stage with a transition (see JOURNEY.md).
 */
export interface StageFrame {
  dt: number;
  time: number;
  /** local progress through this stage's own scroll span, 0..1 (can go <0 or >1 while transitioning in/out) */
  t: number;
  /** 0..1 how far the transition INTO this stage has progressed (1 once fully on screen) */
  enter: number;
  /** 0..1 how far the transition OUT of this stage has progressed */
  exit: number;
  /** global scrolled viewports */
  vp: number;
  /** pointer in NDC (-1..1) of the full screen, after fish-eye/CRT inverse */
  pointer: { x: number; y: number; inside: boolean; down: boolean };
  /** damped parallax input (pointer on desktop, device tilt on touch), -1..1 */
  parallax: { x: number; y: number };
  aspect: number;
  isPhone: boolean;
  quality: 'high' | 'medium' | 'low';
  /** project stages: active slide index driven by the DOM thumbs / arrow keys / drag */
  slide: number;
  /** true once the preloader gate has opened */
  gateOpen: boolean;
}

export interface Stage {
  id: string;
  scene: Scene;
  /** the stage owns its camera; the compositor sets aspect/projection size, the stage poses it */
  camera: PerspectiveCamera;
  background: Color;
  ready: Promise<void>;
  update(f: StageFrame): void;
  /** optional custom render into rt (multi-pass). Default: renderer.render(scene, camera) into rt. */
  render?(renderer: WebGPURenderer, rt: RenderTarget): void;
  /**
   * optional: a quad in this stage's screen space (NDC corners TL,TR,BR,BL) through which the NEXT stage
   * is revealed during a 'portal' transition (like the city's quad revealing the alley).
   */
  portalQuad?(): [number, number][] | null;
  /**
   * optional colour treatment the compositor applies when sampling this stage's target (core extension).
   * Default: none, the target is shown as-is (linear; the post converts to sRGB). Worlds that light with
   * physical intensities usually want { toneMap: 'agx' }.
   */
  grade?: StageGrade;
  /** optional click handling in NDC; return true if consumed */
  onClick?(x: number, y: number): boolean;
  dispose?(): void;
}

export interface StageContext {
  renderer: WebGPURenderer;
  isPhone: boolean;
  quality: 'high' | 'medium' | 'low';
}

/** Real screenshots for a project, from public/projects/<id>/manifest.json */
export interface SlideImage {
  src: string; // e.g. /projects/oge/slide-1.webp
  w: number;
  h: number;
  /** 'desktop' browser capture, 'phone' app/store screenshot, 'cover' designed cover */
  kind: 'desktop' | 'phone' | 'cover';
  caption?: string;
}

export interface ProjectWorldContext extends StageContext {
  project: Project;
  index: number;
  slides: SlideImage[];
}

/** A project world module exports: createWorld(ctx: ProjectWorldContext): Stage */
export type CreateWorld = (ctx: ProjectWorldContext) => Stage;

/** compositor-side grade: c = saturation(pow(rgb·exposure·tint / .18, contrast)·.18, saturation) → tone map → vignette */
export interface StageGrade {
  exposure?: number;
  tint?: [number, number, number];
  contrast?: number;
  saturation?: number;
  toneMap?: 'agx' | 'none';
  /** spec §7.3 vignette 1 - .8·smoothstep(.25,.95,|uv-.5|) */
  vignette?: boolean;
  /** clamp to 0..1 after grading */
  clamp?: boolean;
}
