import { atom, map } from 'nanostores';
import { PROJECTS } from './content';

export type Route = null | 'intro' | 'last' | `project-${number}`;

export const $route = map<{
  route: Route;
  overlay: 'hidden' | 'shown' | 'leaving';
  slide: number;
  entered: boolean;
  isHeaderOnWhite: boolean;
}>({ route: null, overlay: 'hidden', slide: 0, entered: false, isHeaderOnWhite: false });

export const $preloader = map({ progress: 0, isReady: false, isWarm: false, isGateOpen: false, isMotionPending: false });

/** per-frame scroll info written by the scroll controller, read by the renderer */
export const scroll = { progress: 0, vp: 0, limit: 1, isPhone: false, velocity: 0, isProgrammatic: false };

/** device tilt (-1..1) */
export const tilt = { x: 0, y: 0, active: false };

/** pointer in NDC (-1..1), updated by the canvas */
export const pointer = { x: 0, y: 0, inside: false };

/** commands from renderer → scroll controller */
export const $scrollCommand = atom<{ to: number; eased?: boolean; id: number } | null>(null);

/** per-frame overlay data the renderer publishes */
export const overlays = {
  labelMatrices: new Float32Array(16 * PROJECTS.length),
  labelHidden: PROJECTS.map(() => true),
  hoveredIndex: -1,
  stageBlend: 0,
  lastParallax: '',
  boundaryClickable: false,
  talkOpacity: 0,
};
