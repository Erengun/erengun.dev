// Journey timeline: the whole site is one scroll-driven chain of fullscreen stages (JOURNEY.md).
//   intro → corridor (about) → [slopes → stage → teams] → city (who) → project worlds ×N → alley (contact)
// Every stage owns a span of scroll (in viewports); consecutive stages overlap inside a transition window
// [boundary - pre, boundary + post] where both are rendered and blended by the compositor.
import { PROJECTS } from './content';

export const PROJECT_COUNT = PROJECTS.length;

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const invLerp = (a: number, b: number, x: number) => clamp((x - a) / (b - a));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

// ------------------------------------------------------------------ legacy (last-scene spec units)
/** the original last-tile sequence was 11.9 vp long; corridor/city keep its internal timing (spec §7) */
export const SCENE_VP = 11.9;
export const WIPES = [
  { start: 1.18125 / SCENE_VP, length: 0.91875 / SCENE_VP },
  { start: 9.4 / SCENE_VP, length: 0 },
];
/** corridor stage span covers legacy scene-vp [-1.2, 1.64]; city covers [1.64, 9.4] */
export const CORRIDOR_LEGACY = [-1.2, 1.64] as const;
export const CITY_LEGACY = [1.64, 9.4] as const;
/** @deprecated carousel-era constants kept so older modules still compile */
export const LAST_INDEX = PROJECT_COUNT + 1;
export const STEP = Math.PI / 12;

// ------------------------------------------------------------------ stages
export type StageKind = 'intro' | 'corridor' | 'memory' | 'city' | 'world' | 'alley';
export type TransitionKind = 'cut' | 'zoom' | 'wipe' | 'portal' | 'glitch' | 'iris' | 'whiteout';
export type JourneyRoute = 'intro' | 'about' | 'who' | `project-${number}` | 'contact';

export interface StageDef {
  id: string;
  kind: StageKind;
  span: number;
  start: number;
  end: number;
  route: JourneyRoute;
  project?: number;
}
export interface TransitionDef {
  kind: TransitionKind;
  /** boundary between stage i and i+1 (vp) */
  at: number;
  /** window */
  a: number;
  b: number;
}

/** memory stages exist only once src/scene/memories/index.ts has landed */
export const MEMORY_IDS = ['stage', 'teams'] as const;
/** user: "for now hide the memory scenes" — flip to true to bring them back */
// assets removed from public/ (2026-11-13); restore first: git checkout memories-assets-2026-11-13 -- public/memories
export const SHOW_MEMORIES = false;
export const HAS_MEMORIES = SHOW_MEMORIES && Object.keys((import.meta as any).glob('../scene/memories/index.ts')).length > 0;

type Spec = Omit<StageDef, 'start' | 'end'> & { t?: [TransitionKind, number, number] };
const WIPE_HALF = 0.91875 / 2;
const specs: Spec[] = [
  // t: transition INTO the next stage: kind, pre (vp before the boundary), post (vp after)
  { id: 'intro', kind: 'intro', span: 1.2, route: 'intro', t: ['zoom', 0.75, 0.45] },
  { id: 'corridor', kind: 'corridor', span: CORRIDOR_LEGACY[1] - CORRIDOR_LEGACY[0], route: 'about', t: HAS_MEMORIES ? ['whiteout', 0.4, 0.4] : ['wipe', WIPE_HALF, WIPE_HALF] },
  ...(HAS_MEMORIES
    ? ([
        { id: 'stage', kind: 'memory', span: 2.2, route: 'about', t: ['iris', 0.35, 0.35] },
        { id: 'teams', kind: 'memory', span: 2.2, route: 'about', t: ['wipe', WIPE_HALF, WIPE_HALF] },
      ] as Spec[])
    : []),
  // the city's own portal quad opens over legacy travel .63 → .9 and the next stage owns the screen at 9.4
  { id: 'city', kind: 'city', span: CITY_LEGACY[1] - CITY_LEGACY[0], route: 'who', t: ['portal', 9.4 - lerp(1.18125, 9.4, 0.63), 0] },
  ...PROJECTS.map(
    (p, i): Spec => ({
      id: p.id,
      kind: 'world',
      span: 2.6,
      route: `project-${i}`,
      project: i,
      t: i === PROJECTS.length - 1 ? ['portal', 0.5, 0.4] : [(['glitch', 'iris', 'zoom', 'glitch'] as TransitionKind[])[i % 4], 0.35, 0.35],
    }),
  ),
  { id: 'alley', kind: 'alley', span: 3, route: 'contact' },
];

export const STAGES: StageDef[] = [];
export const TRANSITIONS: TransitionDef[] = [];
{
  let s = 0;
  specs.forEach((sp, i) => {
    STAGES.push({ id: sp.id, kind: sp.kind, span: sp.span, start: s, end: s + sp.span, route: sp.route, project: sp.project });
    s += sp.span;
    if (i < specs.length - 1) {
      const [kind, pre, post] = sp.t ?? ['cut', 0, 0];
      TRANSITIONS.push({ kind, at: s, a: s - pre, b: s + post });
    }
  });
}
export const TOTAL_VP = STAGES[STAGES.length - 1].end;
export const stageIndex = (id: string) => STAGES.findIndex((s) => s.id === id);
export const worldStage = (i: number) => STAGES.find((s) => s.kind === 'world' && s.project === i)!;

/** world hold window (local t) */
export const HOLD = [0.22, 0.82] as const;
export const holdCenterVp = (s: StageDef) => s.start + s.span * (HOLD[0] + HOLD[1]) * 0.5;

export interface JourneyState {
  /** stage index mostly on screen */
  current: number;
  /** the other stage while a transition window is active, else -1 */
  other: number;
  /** active transition (stages from → from + 1) and its progress p (0..1) */
  trans: TransitionDef | null;
  from: number;
  p: number;
}

export function journeyAt(vp: number): JourneyState {
  for (let i = 0; i < TRANSITIONS.length; i++) {
    const tr = TRANSITIONS[i];
    if (vp >= tr.a && vp < tr.b && tr.b > tr.a) {
      const p = invLerp(tr.a, tr.b, vp);
      return { current: p < 0.5 ? i : i + 1, other: p < 0.5 ? i + 1 : i, trans: tr, from: i, p };
    }
  }
  let cur = STAGES.length - 1;
  for (let i = 0; i < STAGES.length; i++) if (vp < STAGES[i].end) { cur = i; break; }
  return { current: cur, other: -1, trans: null, from: cur, p: 0 };
}

/** local frame values for stage i at vp: t (unclamped), enter / exit transition progress */
export function stageLocal(i: number, vp: number) {
  const s = STAGES[i];
  const tin = TRANSITIONS[i - 1];
  const tout = TRANSITIONS[i];
  return {
    t: (vp - s.start) / s.span,
    enter: tin ? (tin.b > tin.a ? invLerp(tin.a, tin.b, vp) : vp >= tin.at ? 1 : 0) : 1,
    exit: tout ? (tout.b > tout.a ? invLerp(tout.a, tout.b, vp) : vp >= tout.at ? 1 : 0) : 0,
  };
}

export function routeAt(vp: number): JourneyRoute {
  return STAGES[journeyAt(vp).current].route;
}

/** snap points: intro, the about text, each memory, the city, each world's hold centre, the CTA */
export const SNAP_VP = [
  0,
  ...STAGES.filter((s) => s.kind === 'corridor').map((s) => s.start + 1.2),
  ...STAGES.filter((s) => s.kind === 'memory').map((s) => s.start + s.span * 0.5),
  ...STAGES.filter((s) => s.kind === 'city').map((s) => s.start + 0.46),
  ...STAGES.filter((s) => s.kind === 'world').map(holdCenterVp),
  TOTAL_VP,
];

/** anchors used by links / the menu */
export const ANCHOR_VP: Record<string, number> = {
  '/': 0,
  '/#about': STAGES[stageIndex('corridor')].start + 1.2,
  '/#who': STAGES[stageIndex('city')].start + 0.46,
  '/#work': holdCenterVp(worldStage(0)),
  ...Object.fromEntries(PROJECTS.map((_, i) => [`/#work-${i + 1}`, holdCenterVp(worldStage(i))])),
  '/#contact': TOTAL_VP,
};

export const routeToVp = (route: string): number => {
  const m = /^project-(\d+)$/.exec(route);
  if (m) return holdCenterVp(worldStage(Number(m[1])));
  const s = STAGES.find((st) => st.route === route);
  return s ? s.start : 0;
};
