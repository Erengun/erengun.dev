import Lenis from 'lenis';
import Snap from 'lenis/snap';
import { createTimeline } from 'animejs';
import { $route, $preloader, $scrollCommand, scroll, overlays, tilt, type Route } from '../lib/stores';
import { TOTAL_VP, SNAP_VP, SCENE_START, SCENE_VP, sceneProgress, stageBlend, clamp, routeToVp, damp } from '../lib/timeline';
import { scramble, initHoverScramble } from './scramble';
import { initMenu } from './menu';
import { initTilt } from './tilt';

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as T[];

const body = document.body;
const scroller = $('[data-page-scroll]');
const phoneMq = matchMedia('(max-width: 47.99rem), (max-aspect-ratio: 4/3)');
const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');

// keyboard-mode focus styles
addEventListener('keydown', (e) => e.key === 'Tab' && document.documentElement.classList.add('is-tabbing'));
addEventListener('pointerdown', () => document.documentElement.classList.remove('is-tabbing'));

initHoverScramble();
initMenu();

// ---------------------------------------------------------------- Lenis + snap
const lenis = new Lenis({
  wrapper: scroller,
  content: $('[data-scroll-length]'),
  autoRaf: false,
  lerp: 0.08,
  touchMultiplier: 1.5,
});
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
    const vh = scroller.clientHeight;
    snapRemovers = SNAP_VP.map((v) => snap.add(v * vh));
  }
}

let programmaticUntil = 0;
function scrollToVp(vp: number, eased = false) {
  programmaticUntil = performance.now() + (eased ? 900 : 1200) + 100;
  const to = (vp / TOTAL_VP) * lenis.limit;
  if (eased) {
    lenis.scrollTo(to, {
      duration: 0.9,
      force: true,
      lock: true,
      easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    });
  } else lenis.scrollTo(to, { duration: 1.2, force: true });
}
$scrollCommand.subscribe((c) => c && scrollToVp(c.to, c.eased));

// ---------------------------------------------------------------- body classes
function syncBody() {
  const { route } = $route.get();
  body.classList.toggle('is--intro', route === 'intro');
  body.classList.toggle('is--project', !!route?.startsWith('project'));
  body.classList.toggle('is--last', route === 'last');
  body.classList.toggle('is--carousel', route === null);
}
$route.subscribe(syncBody);

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
      scramble(el, { duration: 700, override: ' ', settleRate: 15 });
    });
  } else if (state === 'leaving') {
    introSpans.forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' }));
  }
});

// ---------------------------------------------------------------- project panels
const panels = $$('[data-project-panel]');
$route.subscribe(({ route, overlay, slide, entered }) => {
  panels.forEach((p, i) => {
    const on = route === `project-${i}` && overlay === 'shown';
    p.toggleAttribute('data-shown', on);
    $$<HTMLButtonElement>('[data-thumb]', p).forEach((b, s) => {
      b.toggleAttribute('data-slide-active', s === slide);
      b.disabled = !(on && entered);
    });
    const num = $('[data-project-slide-number]', p);
    if (num) num.textContent = String(slide + 1).padStart(2, '0');
  });
});
panels.forEach((p) =>
  $$<HTMLButtonElement>('[data-thumb]', p).forEach((b, s) => b.addEventListener('click', () => $route.setKey('slide', s))),
);

export function openProject(i: number) {
  $route.set({ ...$route.get(), route: `project-${i}` as Route, overlay: 'shown', slide: 0, entered: false });
}
export function closeProject() {
  const r = $route.get().route;
  if (!r?.startsWith('project')) return;
  $route.set({ ...$route.get(), route: null, overlay: 'hidden', entered: false });
}
$('[data-close-button]').addEventListener('click', closeProject);
$$('[data-open-project]').forEach((b) => b.addEventListener('click', () => openProject(Number(b.dataset.openProject))));
addEventListener('keydown', (e) => {
  const { route, slide } = $route.get();
  if (!route?.startsWith('project')) return;
  const n = $$('[data-thumb]', panels[Number(route.split('-')[1])]).length;
  if (e.key === 'Escape') closeProject();
  if (e.key === 'ArrowRight') $route.setKey('slide', (slide + 1) % n);
  if (e.key === 'ArrowLeft') $route.setKey('slide', (slide - 1 + n) % n);
});

// ---------------------------------------------------------------- selected work nav
const workList = $('.work__list');
$$('[data-work-item]').forEach((b, i) => b.addEventListener('click', () => scrollToVp(i + 1, true)));

// ---------------------------------------------------------------- last section
const lastStages = $$('[data-last-stage]');
const lastBlocks = $$('[data-last-scroll]');
const backdropFade = $('[data-last-backdrop-fade]');
const talkParallax = $('[data-last-parallax]');
const talkTl = createTimeline({ autoplay: false });
talkTl.add($$('[data-talk-reveal]'), { opacity: [0, 1], duration: 900, delay: (_: unknown, i: number) => i * 70, ease: 'outCubic' }, 0);

function updateLast(vp: number) {
  const t = sceneProgress(vp);
  const blend = stageBlend(t);
  overlays.stageBlend = blend;
  const vh = scroller.clientHeight;
  // which stage is active: 0 (about) 1 (who) 2 (talk)
  const active = blend >= 2 ? 2 : blend >= 1 ? 1 : 0;
  lastStages.forEach((s, i) => s.toggleAttribute('data-active', i === active || (i < 2 && blend > i - 1 && blend < i + 1 && active < 2)));
  // text blocks: wipe via clip-path, move at 0.5x scroll
  const scrolled = (vp - SCENE_START);
  const anchors = [0.3, 2.6];
  lastBlocks.forEach((b, i) => {
    const top = clamp(blend - (i - 1));
    const bottom = clamp(blend - i);
    b.style.clipPath = `inset(${(1 - top) * 100}% 0 ${bottom * 100}% 0)`;
    const y = -(scrolled - anchors[i]) * 0.5 * vh;
    b.style.translate = `0 ${y}px`;
    if (i === 0) {
      const r = b.getBoundingClientRect();
      backdropFade.toggleAttribute('data-past-header', r.bottom < 60 || blend >= 1.5);
    }
  });
  // talk reveal is scrubbed by the splat stage reveal
  const talkP = clamp((t - 0.86) / 0.1);
  overlays.talkOpacity = talkP;
  talkTl.seek(talkP * talkTl.duration);
  if (overlays.lastParallax) talkParallax.style.transform = overlays.lastParallax;
}

// ---------------------------------------------------------------- project labels (matrix3d from renderer)
const labels = $$('[data-project-labels] > li');
function updateLabels() {
  const m = overlays.labelMatrices;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  labels.forEach((li, i) => {
    const hidden = overlays.labelHidden[i];
    li.toggleAttribute('data-hidden', hidden);
    li.inert = hidden;
    li.toggleAttribute('data-hovered', overlays.hoveredIndex === i);
    if (!hidden) {
      const a = Array.from(m.subarray(i * 16, i * 16 + 16)).map((v) => v.toFixed(6)).join(',');
      li.style.transform = `matrix3d(${a}) scale(${16 / rem}) translate(-50%, -50%)`;
    }
  });
  $('[data-stage]').toggleAttribute('data-boundary-clickable', overlays.boundaryClickable);
}

// ---------------------------------------------------------------- frame loop
let renderer: { frame: (dt: number, t: number) => void; resize: () => void } | null = null;
let last = performance.now();
let lastScroll = 0;
function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  lenis.raf(now);
  const limit = Math.max(1, lenis.limit);
  const vh = scroller.clientHeight;
  scroll.limit = limit;
  scroll.isPhone = phoneMq.matches;
  // native touch scroll on phones is extra-damped
  const target = lenis.scroll / limit;
  scroll.progress = scroll.isPhone && !lenis.isSmooth ? scroll.progress + (target - scroll.progress) * damp(1 / 0.07, dt) : target;
  scroll.vp = scroll.progress * TOTAL_VP;
  scroll.velocity = (lenis.scroll - lastScroll) / vh / Math.max(dt, 1e-3);
  lastScroll = lenis.scroll;
  scroll.isProgrammatic = now < programmaticUntil;

  const { route } = $route.get();
  // user scroll closes an open project
  if (route?.startsWith('project') && Math.abs(scroll.velocity) > 0.05 && !scroll.isProgrammatic) closeProject();
  setSnap(!scroll.isPhone && !route?.startsWith('project') && $preloader.get().isGateOpen && scroll.vp < SCENE_START + 0.05 + (SNAP_VP[6] - SCENE_START));

  // work nav
  workList.style.setProperty('--active-index', String(clamp(Math.ceil(scroll.vp - 0.5), 1, 4) - 1));
  $$('[data-work-item]').forEach((b, i) => b.toggleAttribute('aria-current', i === clamp(Math.ceil(scroll.vp - 0.5), 1, 4) - 1));

  renderer?.frame(dt, now / 1000);
  updateLabels();
  if (body.classList.contains('is--last')) updateLast(scroll.vp);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------- preloader + renderer boot
const pre = $('[data-preloader]');
const header = $('[data-header]');
const intro = $('[data-intro]');
const labelsUl = $('[data-project-labels]');

function openGate() {
  $preloader.setKey('isGateOpen', true);
  pre.setAttribute('data-exiting', '');
  pre.addEventListener('transitionend', (e) => e.propertyName === 'opacity' && pre.setAttribute('hidden', ''), { once: true });
  setTimeout(() => pre.setAttribute('hidden', ''), 600);
  body.classList.remove('is--loading');
  header.setAttribute('data-ready', '');
  intro.setAttribute('data-ready', '');
  labelsUl.setAttribute('data-ready', '');
  lenis.start();
  scroller.focus({ preventScroll: true });
  $route.set({ ...$route.get(), route: 'intro', overlay: 'shown' });
}

async function boot() {
  const fallback = setTimeout(() => $preloader.set({ ...$preloader.get(), isReady: true, isWarm: true }), 20000);
  try {
    const { createApp } = await import('../scene/app');
    renderer = await createApp($('#app'), {
      onProgress: (p) => $preloader.setKey('progress', p),
      openProject,
      scrollToVp,
      setRoute: (r, o) => setScrollRoute(r, o),
    });
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

// route state from scroll (only when not inside a project)
let lastRouteKey = '';
export function setScrollRoute(next: Route, overlay: 'hidden' | 'shown' | 'leaving') {
  const cur = $route.get();
  if (cur.route?.startsWith('project')) return;
  const key = `${next}|${overlay}`;
  if (key === lastRouteKey) return;
  lastRouteKey = key;
  $route.set({ ...cur, route: next, overlay });
}
(window as any).__lab = { lenis, $route, scroll, overlays, routeToVp, scrollToVp, SCENE_VP };
if (reducedMq.matches) body.classList.add('is--reduced');
