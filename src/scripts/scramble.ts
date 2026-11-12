// Scramble/decode text (spec-dom §7). Own implementation.
const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!%#_';
const rand = () => CHARS[(Math.random() * CHARS.length) | 0];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

type Opts = {
  duration?: number;
  ease?: (t: number) => number;
  /** null → original letters stay and get scrambled (hover). string → start from this char (intro decode). */
  override?: string | null;
  settleRate?: number; // glyph refresh Hz
};

const running = new WeakMap<HTMLElement, { raf: number; text: string }>();

export const outCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function settle(el: HTMLElement) {
  const r = running.get(el);
  if (!r) return;
  cancelAnimationFrame(r.raf);
  el.textContent = r.text;
  running.delete(el);
}

export function scramble(el: HTMLElement, o: Opts = {}): Promise<void> {
  const prev = running.get(el);
  const text = prev ? prev.text : el.dataset.text ?? el.textContent ?? '';
  el.dataset.text = text;
  if (prev) cancelAnimationFrame(prev.raf);
  if (reduced.matches) {
    el.textContent = text;
    return Promise.resolve();
  }
  const { duration = 700, ease = (t: number) => t, override = null, settleRate = 30 } = o;
  const len = text.length;
  const settleFrac = 0.35; // portion of time a char spends scrambling once it starts
  const glyphs = [...text].map((c) => (c === ' ' ? ' ' : override === null ? c : override));
  let lastTick = -1;
  const t0 = performance.now();
  return new Promise((resolve) => {
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = ease(t);
      const tick = Math.floor(((now - t0) / 1000) * settleRate);
      const refresh = tick !== lastTick;
      lastTick = tick;
      let out = '';
      for (let i = 0; i < len; i++) {
        const c = text[i];
        if (c === ' ' || c === '\n') { out += c; continue; }
        const start = (i / Math.max(1, len)) * (1 - settleFrac);
        const end = start + settleFrac;
        if (e >= end) out += c;
        else if (e >= start) {
          if (refresh || glyphs[i] === c || glyphs[i] === override) glyphs[i] = rand();
          out += glyphs[i];
        } else out += override === null ? c : override;
      }
      el.textContent = out;
      if (t < 1) running.set(el, { raf: requestAnimationFrame(step), text });
      else { el.textContent = text; running.delete(el); resolve(); }
    };
    running.set(el, { raf: requestAnimationFrame(step), text });
  });
}

/** hover scramble on every link/button (ignores moves inside the same control) */
export function initHoverScramble() {
  let current: Element | null = null;
  document.addEventListener('pointerover', (ev) => {
    const ctl = (ev.target as Element)?.closest?.('a, button');
    if (ctl === current) return;
    current = ctl;
    if (!ctl) return;
    ctl.querySelectorAll<HTMLElement>('[data-scramble-text]:not([data-logo])').forEach((el) =>
      scramble(el, { duration: 700, ease: outCubic }),
    );
  });
  document.addEventListener('pointerdown', (ev) => {
    const ctl = (ev.target as Element)?.closest?.('a, button, [data-menu]');
    ctl?.querySelectorAll<HTMLElement>('[data-scramble-text]').forEach(settle);
  });
}
