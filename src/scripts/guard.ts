/**
 * Keeps the page usable on devices the 3D scene is too much for.
 *
 * A browser can drop the scene in ways the frame-rate controller never sees: the tab is killed for memory (iOS
 * reloads it), the graphics context is lost, or the GPU is a software renderer drawing a few frames a second. This
 * remembers how the last visits went and caps the quality tier for the next one:
 *   breadcrumb  set (per tab) while the page is visible, cleared when it is hidden or left. Still set at boot →
 *               the previous load died in front of the visitor → start one tier lower.
 *   cap         'medium' | 'low' | 'lite', kept for a day. 'lite' shows stills of every scene instead of 3D
 *               (scripts/lite.ts) and never downloads the renderer.
 * `?quality=…` ignores the cap (testing), `?lite` forces the stills, `?full` forgets everything.
 */
export type Tier = 'high' | 'medium' | 'low';
export type Cap = Tier | 'lite';

const KEY = 'lab-cap', CRUMB = 'lab-alive', RESTORE = 'lab-restore';
const DAY = 864e5;
const ORDER: Cap[] = ['high', 'medium', 'low', 'lite'];

// storage can throw (private modes, locked-down webviews): every access is guarded
const get = (s: 'local' | 'session', k: string): string | null => {
  try { return (s === 'local' ? localStorage : sessionStorage).getItem(k); } catch { return null; }
};
const set = (s: 'local' | 'session', k: string, v: string | null) => {
  try {
    const st = s === 'local' ? localStorage : sessionStorage;
    if (v === null) st.removeItem(k); else st.setItem(k, v);
  } catch { /* no storage: the guard just doesn't remember */ }
};
/** sessionStorage that never throws (used by the tilt prompt too) */
export const session = { get: (k: string) => get('session', k), set: (k: string, v: string | null) => set('session', k, v) };

const params = new URLSearchParams(location.search);
if (params.has('full')) { set('local', KEY, null); set('session', CRUMB, null); set('session', RESTORE, null); }

function readCap(): Cap {
  try {
    const c = JSON.parse(get('local', KEY) ?? 'null') as { cap: Cap; until: number } | null;
    if (c && c.until > Date.now() && ORDER.includes(c.cap)) return c.cap;
  } catch { /* unreadable: no cap */ }
  return 'high';
}
let cap: Cap = readCap();
const log: string[] = [];

/** remember that `from` was too much for this device: the next load starts one step lower */
export function lower(from: Cap, why: string): Cap {
  const next = ORDER[Math.min(ORDER.length - 1, Math.max(ORDER.indexOf(from), ORDER.indexOf(cap)) + 1)];
  capTo(next, why);
  return next;
}
export function capTo(c: Cap, why: string) {
  if (ORDER.indexOf(c) <= ORDER.indexOf(cap)) return;
  cap = c;
  log.push(`${why} → ${c}`);
  console.warn(`[guard] ${why}: next load capped at ${c}`);
  set('local', KEY, JSON.stringify({ cap: c, until: Date.now() + DAY }));
}

// ---- breadcrumb: did the previous load die while it was on screen?
const died = get('session', CRUMB) === '1';
if (died && !params.has('full')) {
  // the tier that load ran at is not known for sure; one step below the cap it had is the safe reading
  lower(cap, 'previous load died');
}
const mark = () => set('session', CRUMB, document.hidden ? null : '1');
mark();
document.addEventListener('visibilitychange', mark);
addEventListener('pagehide', () => set('session', CRUMB, null));
addEventListener('pageshow', mark);

/** scroll position carried across a recovery reload */
const restore = Number(get('session', RESTORE) ?? NaN);
set('session', RESTORE, null);
const RELOADED = 'lab-reloaded';

export const guard = {
  /** forced by the URL → the cap is ignored */
  forced: params.get('quality') as Tier | null,
  get cap(): Cap { return params.has('lite') ? 'lite' : params.has('quality') ? 'high' : cap; },
  died,
  log,
  /** vp to return to after a recovery reload (NaN: none) */
  restoreVp: restore,
  /** reload to get the scene back (keeps the scroll position); false when that was just tried */
  reloadOnce(vp: number): boolean {
    // without working storage the reload could not be told apart from a first load, and would repeat
    // (and one that fails again right after a reload would loop: only once a minute)
    if (Date.now() - Number(get('session', RELOADED) ?? 0) < 60_000 || !storageWorks()) return false;
    set('session', RELOADED, String(Date.now()));
    set('session', RESTORE, String(vp));
    const go = () => location.reload();
    if (document.hidden) document.addEventListener('visibilitychange', () => !document.hidden && go(), { once: true });
    else setTimeout(go, 250);
    return true;
  },
};
function storageWorks() {
  set('session', 'lab-probe', '1');
  const ok = get('session', 'lab-probe') === '1';
  set('session', 'lab-probe', null);
  return ok;
}
