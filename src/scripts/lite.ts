/**
 * Stills fallback: one captured frame of every stage (public/lite/<stage>-<l|p>.webp, taken from the real scenes at
 * their hold position), crossfaded by the same scroll timeline the 3D scene follows. Costs no GPU work beyond
 * compositing two images, so the page stays readable and scrollable where the scene can't run: no WebGL, a software
 * renderer, a lost graphics context, a renderer that is still downloading, or a device that keeps killing the tab.
 */
import { STAGES, journeyAt } from '../lib/timeline';

export function createLite(container: HTMLElement) {
  let root: HTMLElement | null = null;
  let imgs: (HTMLImageElement | null)[] = [];
  let variant = '';
  let shown = false;
  const opacity: number[] = [];
  const portrait = () => innerHeight > innerWidth;

  function build() {
    root = document.createElement('div');
    root.className = 'lite';
    root.setAttribute('aria-hidden', 'true');
    container.appendChild(root);
    addEventListener('resize', () => { if (shown && variant !== (portrait() ? 'p' : 'l')) reset(); });
  }
  function reset() {
    variant = portrait() ? 'p' : 'l';
    root!.replaceChildren();
    imgs = STAGES.map(() => null);
    opacity.length = 0;
  }
  /** images are created on demand: the stage on screen and its neighbours */
  function img(i: number): HTMLImageElement | null {
    if (i < 0 || i >= STAGES.length) return null;
    if (imgs[i]) return imgs[i];
    const el = document.createElement('img');
    el.alt = '';
    el.decoding = 'async';
    el.draggable = false;
    el.style.opacity = '0';
    el.src = `/lite/${STAGES[i].id}-${variant}.webp`;
    root!.appendChild(el);
    return (imgs[i] = el);
  }
  const setOpacity = (i: number, v: number) => {
    const el = img(i);
    if (!el || opacity[i] === v) return;
    opacity[i] = v;
    el.style.opacity = String(v);
    el.style.zIndex = v > 0 ? '1' : '0';
  };

  return {
    get shown() { return shown; },
    show() {
      if (shown) return;
      shown = true;
      if (!root) build();
      reset();
      root!.hidden = false;
      document.documentElement.dataset.lite = '';
    },
    hide() {
      if (!shown) return;
      shown = false;
      root!.hidden = true;
      delete document.documentElement.dataset.lite;
    },
    frame(vp: number) {
      if (!shown) return;
      const js = journeyAt(vp);
      const a = js.trans ? js.from : js.current;
      const b = js.trans ? js.from + 1 : -1;
      // the incoming picture fades in over the outgoing one
      const p = b >= 0 ? Math.round(js.p * 100) / 100 : 0;
      for (let i = 0; i < imgs.length; i++) if (imgs[i] && i !== a && i !== b) setOpacity(i, 0);
      setOpacity(a, 1);
      if (b >= 0) { setOpacity(b, p); imgs[b]!.style.zIndex = '2'; }
      // neighbours decode ahead of the scroll
      img(a + 1); img(a - 1);
    },
  };
}
