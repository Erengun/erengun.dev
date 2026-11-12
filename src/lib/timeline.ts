// Scroll timeline (spec-3d §3 "Scroll → carousel rotation").
export const TILE_COUNT = 6;
export const LAST_INDEX = 5;
export const STEP = Math.PI / 12; // 15° per tile
export const OPENING_TILES = 0.4;
export const OPENING_VP = 1.6;
export const SCENE_START = LAST_INDEX - OPENING_TILES + OPENING_VP; // 6.2
export const SCENE_VP = 11.9;
export const TOTAL_VP = SCENE_START + SCENE_VP; // 18.1
export const WIPES = [
  { start: 1.18125 / SCENE_VP, length: 0.91875 / SCENE_VP },
  { start: 9.4 / SCENE_VP, length: 0 },
];

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const invLerp = (a: number, b: number, x: number) => clamp((x - a) / (b - a));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

/** carousel index (0..5, fractional) from scrolled viewports */
export function carouselIndex(vp: number): number {
  const o = LAST_INDEX - OPENING_TILES;
  const r = Math.min(vp, SCENE_START);
  const a = 1 - Math.pow(1 - clamp((r - o) / OPENING_VP), 4);
  return Math.min(r, o) + a * OPENING_TILES;
}

/** scene progress inside the last tile (0..1) */
export const sceneProgress = (vp: number) => clamp((vp - SCENE_START) / SCENE_VP);

/** 0..2 stage selector for corridor → city → splat */
export function stageBlend(t: number): number {
  let b = 0;
  for (const w of WIPES) {
    const end = w.start + w.length;
    b += t >= end ? 1 : w.length > 0 ? invLerp(w.start, end, t) : 0;
  }
  return b;
}

/** viewport positions to snap to */
export const SNAP_VP = [0, 1, 2, 3, 4, SCENE_START, SCENE_START + (WIPES[0].start + WIPES[0].length) * SCENE_VP];

export const routeToVp = (route: string): number => {
  if (route === 'intro') return 0;
  if (route === 'last') return SCENE_START;
  const m = /^project-(\d)$/.exec(route);
  return m ? Number(m[1]) + 1 : 0;
};
