import Lenis from 'lenis';
import Snap from 'lenis/snap';
import { createTimeline } from 'animejs';
import { $route, $preloader, scroll, tilt, type Route } from '../lib/stores';
import {
  TOTAL_VP, SNAP_VP, STAGES, HOLD, ANCHOR_VP, journeyAt, stageLocal, stageIndex, worldStage, holdCenterVp, clamp, damp,
  smoothstep, invLerp, PROJECT_COUNT, TRANSITIONS, HAS_MEMORIES, type StageDef,
} from '../lib/timeline';
import { scramble, initHoverScramble } from './scramble';
import { initMenu } from './menu';
import { initTilt } from './tilt';

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as T[];

const body = document.body;
const scroller = $('[data-page-scroll]');
const phoneMq = matchMedia('(max-width: 47.99rem), (max-aspect-ratio: 4/3)');
const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');

addEventListener('keydown', (e) => e.key === 'Tab' && document.documentElement.classList.add('is-tabbing'));
addEventListener('pointerdown', () => document.documentElement.classList.remove('is-tabbing'));

initHoverScramble();
initMenu();

// ---------------------------------------------------------------- Lenis + snap
const lenis = new Lenis({ wrapper: scroller, content: $('[data-scroll-length]'), autoRaf: false, lerp: 0.08, touchMultiplier: 1.5 });
lenis.stop();

const snap = new Snap(lenis, { type: 'proximity', debounce: 500, distanceThreshold: '50%' });
let snapRemovers: (() => void)[] = [];
let snapEnabled = false;
function setSnap(on: boolean) {
  if (on === snapEnabled) return;
  snapEnabled = on;
  snapRemovers.forEach((r) => r());
  snapRemovers = [];
  if (on) {
    snapRemovers = SNAP_VP.map((v) => snap.add((v / TOTAL_VP) * lenis.limit));
  }
}
addEventListener('resize', () => { if (snapEnabled) { snapEnabled = false; setSnap(true); } });

let programmaticUntil = 0;
function scrollToVp(vp: number, eased = false) {
  programmaticUntil = performance.now() + (eased ? 900 : 1200) + 100;
  const to = (vp / TOTAL_VP) * lenis.limit;
  if (eased) {
    lenis.scrollTo(to, { duration: 0.9, force: true, lock: true, easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) });
  } else lenis.scrollTo(to, { duration: 1.2, force: true });
}

// ---------------------------------------------------------------- route + body classes
let lastProject = -1;
function setRoute(route: Route, overlay: 'hidden' | 'shown' | 'leaving') {
  const cur = $route.get();
  const proj = route?.startsWith('project') ? Number(route.split('-')[1]) : -1;
  const slide = proj >= 0 && proj !== lastProject ? 0 : cur.slide;
  if (proj >= 0) lastProject = proj;
  if (cur.route === route && cur.overlay === overlay && cur.slide === slide) return;
  $route.set({ ...cur, route, overlay, slide, entered: overlay === 'shown' });
}
$route.subscribe(({ route }) => {
  body.classList.toggle('is--intro', route === 'intro');
  body.classList.toggle('is--about', route === 'about');
  body.classList.toggle('is--who', route === 'who');
  body.classList.toggle('is--project', !!route?.startsWith('project'));
  body.classList.toggle('is--contact', route === 'contact');
  // the about/who/contact overlays share the ".last" section
  body.classList.toggle('is--last', route === 'about' || route === 'who' || route === 'contact');
});

// ---------------------------------------------------------------- intro text
const introSpans = $$('[data-intro] [data-scramble-text]');
let introState = '';
$route.subscribe(({ route, overlay }) => {
  const state = route === 'intro' ? overlay : 'hidden';
  if (state === introState) return;
  introState = state;
  if (state === 'shown') {
    introSpans.forEach((el) => {
      el.style.opacity = '';
      scramble(el, { duration: 700, override: ' ', settleRate: 15 });
    });
  } else if (state === 'leaving') {
    introSpans.forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' }));
  }
});

// ---------------------------------------------------------------- project panels + slides
const panels = $$('[data-project-panel]');
const slideCount = (i: number) => $$('[data-thumb]', panels[i]).length || 1;
$route.subscribe(({ route, overlay, slide }) => {
  panels.forEach((p, i) => {
    const on = route === `project-${i}` && overlay === 'shown';
    p.toggleAttribute('data-shown', on);
    p.inert = !on;
    $$<HTMLButtonElement>('[data-thumb]', p).forEach((b, s) => {
      b.toggleAttribute('data-slide-active', s === slide);
      b.disabled = !on;
    });
    const num = $('[data-project-slide-number]', p);
    if (num) num.textContent = String(slide + 1).padStart(2, '0');
  });
});
panels.forEach((p) => $$<HTMLButtonElement>('[data-thumb]', p).forEach((b, s) => b.addEventListener('click', () => $route.setKey('slide', s))));
// thumbnails come straight from the project's screenshot manifest (lazy: they're tiny but not needed for the gate)
const fillThumbs = () =>
  panels.forEach((p) => {
    const imgs = $$<HTMLImageElement>('[data-thumb-img]', p);
    const id = imgs[0]?.dataset.thumbImg?.split(':')[0];
    if (!id) return;
    fetch(`/projects/${id}/manifest.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((slides: { src: string }[]) => imgs.forEach((img, s) => slides[s] && ((img.loading = 'lazy'), (img.decoding = 'async'), (img.src = slides[s].src))))
      .catch(() => {});
  });
('requestIdleCallback' in window ? requestIdleCallback : setTimeout)(fillThumbs as any, { timeout: 4000 } as any);
const currentProject = () => {
  const r = $route.get().route;
  return r?.startsWith('project') ? Number(r.split('-')[1]) : -1;
};
function stepSlide(d: number) {
  const i = currentProject();
  if (i < 0 || $route.get().overlay !== 'shown') return;
  const n = slideCount(i);
  $route.setKey('slide', ((($route.get().slide + d) % n) + n) % n);
}
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') stepSlide(1);
  if (e.key === 'ArrowLeft') stepSlide(-1);
});
// horizontal drag on the scene switches slides (vertical drags keep scrolling)
{
  let sx = 0, sy = 0, down = false;
  const stage = $('[data-stage]');
  stage.addEventListener('pointerdown', (e) => { down = true; sx = e.clientX; sy = e.clientY; });
  stage.addEventListener('pointerup', (e) => {
    if (!down) return;
    down = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && !(e.target as Element).closest('a, button')) stepSlide(dx < 0 ? 1 : -1);
  });
}

// ---------------------------------------------------------------- selected work nav
const workList = $('.work__list');
const workItems = $$('[data-work-item]');
workItems.forEach((b, i) => b.addEventListener('click', () => scrollToVp(holdCenterVp(worldStage(i)), true)));
$('[data-scroll-back]')?.addEventListener('click', () => scrollToVp(holdCenterVp(worldStage(PROJECT_COUNT - 1)), true));

// in-page anchors drive the scroll timeline (the overlays are fixed, so native hash jumps do nothing)
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const to = ANCHOR_VP[a.getAttribute('href') ?? ''];
  if (to === undefined) return;
  e.preventDefault();
  $('[data-menu-trigger]')?.getAttribute('aria-expanded') === 'true' && $<HTMLButtonElement>('[data-menu-trigger]').click();
  scrollToVp(to);
});

// ---------------------------------------------------------------- about / memories / who text blocks
type TextBlock = { el: HTMLElement; stage: number; anchor: number };
const lastSection = $('[data-last]');
const backdropFade = $('[data-last-backdrop-fade]');
const blocks: TextBlock[] = [];
function addBlock(el: HTMLElement, stageId: string, anchorOffset: number) {
  const i = stageIndex(stageId);
  if (i < 0) return;
  blocks.push({ el, stage: i, anchor: STAGES[i].start + anchorOffset });
}
{
  const [about, who] = $$('[data-last-scroll]');
  addBlock(about, 'corridor', 1.224);
  addBlock(who, 'city', 1.009);
}
// memory captions (module may not exist yet)
const memoryCopy = (import.meta as any).glob('../scene/memories/index.ts') as Record<string, () => Promise<any>>;
for (const load of HAS_MEMORIES ? Object.values(memoryCopy) : []) {
  load()
    .then((m) => {
      const copy: { id: string; kicker?: string; title?: string; body?: string }[] = m.MEMORY_COPY ?? [];
      for (const c of copy) {
        const stageEl = document.createElement('div');
        stageEl.className = 'last-stage';
        stageEl.setAttribute('data-memory-stage', c.id);
        stageEl.innerHTML = `<div class="last-block" data-memory-block>
          <div class="last-rail" aria-hidden="true"><svg width="6" height="5" viewBox="0 0 5.77 5"><path d="M2.885 0 5.77 5H0z" fill="#fff"/></svg><span class="line"></span><svg width="6" height="5" viewBox="0 0 5.77 5"><path d="M2.885 5 0 0h5.77z" fill="#fff"/></svg></div>
          <div class="last-text"><p class="h"></p><p class="b1"></p><p class="b2"></p></div></div>`;
        const [h, b1, b2] = $$('.last-text p', stageEl);
        h.textContent = c.kicker ?? '';
        b1.textContent = c.title ?? '';
        b2.textContent = c.body ?? '';
        if (!c.body) b2.remove();
        lastSection.insertBefore(stageEl, $('[data-last-stage="2"]'));
        const s = STAGES[stageIndex(c.id)];
        if (s) addBlock($('.last-block', stageEl), c.id, s.span * 0.3);
      }
    })
    .catch((e) => console.warn('[journey] memory captions unavailable', e));
}

/** style writes only when a value actually changes: a still page does no style work per frame */
const written = new WeakMap<HTMLElement, Record<string, string>>();
const setStyle = (el: HTMLElement, prop: 'clipPath' | 'opacity' | 'translate', v: string) => {
  let w = written.get(el);
  if (!w) written.set(el, (w = {}));
  if (w[prop] === v) return;
  w[prop] = v;
  el.style[prop] = v;
};
function updateBlocks(vp: number, vh: number) {
  let anyVisible = false;
  for (const b of blocks) {
    const l = stageLocal(b.stage, vp);
    const tin = TRANSITIONS[b.stage - 1], tout = TRANSITIONS[b.stage];
    const visible = l.enter > 0 && l.exit < 1;
    const host = b.el.parentElement as HTMLElement;
    if (host.hasAttribute('data-active') !== visible) host.toggleAttribute('data-active', visible);
    if (!visible) continue;
    anyVisible = true;
    // wipes clip the text with the picture; other transitions fade it
    const top = tout?.kind === 'wipe' ? l.exit : 0;
    const bottom = tin?.kind === 'wipe' ? 1 - l.enter : 0;
    setStyle(b.el, 'clipPath', `inset(${top * 100}% 0px ${bottom * 100}% 0px)`);
    const fadeIn = tin?.kind === 'wipe' ? 1 : smoothstep(0.55, 0.95, l.enter);
    const fadeOut = tout?.kind === 'wipe' ? 1 : 1 - smoothstep(0.05, 0.45, l.exit);
    setStyle(b.el, 'opacity', String(fadeIn * fadeOut));
    setStyle(b.el, 'translate', `0px ${-(vp - b.anchor) * 0.5 * vh}px`);
  }
  if (backdropFade.hasAttribute('data-past-header') !== !anyVisible) backdropFade.toggleAttribute('data-past-header', !anyVisible);
}

// ---------------------------------------------------------------- contact CTA (alley)
const alleyIndex = stageIndex('alley');
const contactStage = $('[data-last-stage="2"]');
const talkTl = createTimeline({ autoplay: false });
talkTl.add($$('[data-talk-reveal]'), { opacity: [0, 1], duration: 900, delay: (_: unknown, i: number) => i * 70, ease: 'outCubic' }, 0);
let talkP = -1;
function updateContact(vp: number) {
  const l = stageLocal(alleyIndex, vp);
  if (contactStage.hasAttribute('data-active') !== l.enter > 0.5) contactStage.toggleAttribute('data-active', l.enter > 0.5);
  const p = clamp(invLerp(0.02, 0.14, l.t));
  if (p === talkP) return; // seeking writes styles on every reveal target: only when the progress moved
  talkP = p;
  talkTl.seek(p * talkTl.duration);
}

// ---------------------------------------------------------------- frame loop
let renderer: { frame: (dt: number, t: number) => void; resize: () => void } | null = null;
let last = performance.now();
let lastScroll = 0;
let lastWorkProj = -1;
function routeFor(vp: number): [Route, 'hidden' | 'shown' | 'leaving'] {
  const js = journeyAt(vp);
  const s: StageDef = STAGES[js.current];
  const l = stageLocal(js.current, vp);
  if (s.kind === 'world') {
    const hold = l.t >= HOLD[0] - 0.06 && l.t <= HOLD[1] + 0.06;
    return [s.route as Route, hold ? 'shown' : 'leaving'];
  }
  if (s.kind === 'intro') return ['intro', l.exit < 0.25 ? 'shown' : 'leaving'];
  return [s.route as Route, 'shown'];
}
function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  lenis.raf(now);
  const limit = Math.max(1, lenis.limit);
  const vh = scroller.clientHeight;
  scroll.limit = limit;
  scroll.isPhone = phoneMq.matches;
  const target = lenis.scroll / limit;
  scroll.progress = scroll.isPhone && !lenis.isSmooth ? scroll.progress + (target - scroll.progress) * damp(1 / 0.07, dt) : target;
  scroll.vp = scroll.progress * TOTAL_VP;
  scroll.velocity = (lenis.scroll - lastScroll) / vh / Math.max(dt, 1e-3);
  lastScroll = lenis.scroll;
  scroll.isProgrammatic = now < programmaticUntil;

  const gate = $preloader.get().isGateOpen;
  setSnap(!scroll.isPhone && gate);
  if (gate) {
    const [r, o] = routeFor(scroll.vp);
    setRoute(r, o);
  }
  const proj = currentProject();
  if (proj >= 0 && proj !== lastWorkProj) {
    lastWorkProj = proj;
    workList.style.setProperty('--active-index', String(proj));
    workItems.forEach((b, i) => b.toggleAttribute('aria-current', i === proj));
  }

  renderer?.frame(dt, now / 1000);
  updateBlocks(scroll.vp, vh);
  updateContact(scroll.vp);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------- preloader + renderer boot
const pre = $('[data-preloader]');
const header = $('[data-header]');
const intro = $('[data-intro]');

function openGate() {
  $preloader.setKey('isGateOpen', true);
  pre.setAttribute('data-exiting', '');
  pre.addEventListener('transitionend', (e) => e.propertyName === 'opacity' && pre.setAttribute('hidden', ''), { once: true });
  setTimeout(() => pre.setAttribute('hidden', ''), 600);
  body.classList.remove('is--loading');
  header.setAttribute('data-ready', '');
  intro.setAttribute('data-ready', '');
  lenis.start();
  scroller.focus({ preventScroll: true });
}

async function boot() {
  const fallback = setTimeout(() => $preloader.set({ ...$preloader.get(), isReady: true, isWarm: true }), 30000);
  try {
    const { createApp } = await import('../scene/app');
    renderer = await createApp($('#app'), { onProgress: (p) => $preloader.setKey('progress', p) });
    addEventListener('resize', () => renderer?.resize());
  } catch (err) {
    console.error('[lab] renderer failed', err);
  }
  clearTimeout(fallback);
  $preloader.set({ ...$preloader.get(), isReady: true, isWarm: true });
  const needsMotion = initTilt(() => tryGate());
  $preloader.setKey('isMotionPending', needsMotion);
  tryGate();
}
function tryGate() {
  const p = $preloader.get();
  if (p.isGateOpen || !p.isReady || !p.isWarm) return;
  if (p.isMotionPending && !sessionStorage.getItem('motion-declined') && !tilt.active) {
    pre.setAttribute('data-asking', '');
    $<HTMLButtonElement>('[data-motion-allow]').focus();
    return;
  }
  pre.removeAttribute('data-asking');
  openGate();
}
$preloader.subscribe(() => tryGate());
boot();

(window as any).__lab = { snap, lenis, $route, scroll, scrollToVp, STAGES, TRANSITIONS, TOTAL_VP };
if (reducedMq.matches) body.classList.add('is--reduced');
