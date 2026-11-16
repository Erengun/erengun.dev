/**
 * Fallback picture for when the 3D scene can't run: no WebGL, a software renderer, a lost graphics context, a
 * renderer that is still downloading, or a device that keeps killing the tab. Two layers, both captured from the
 * real scenes and both driven by the same scroll timeline the scene follows:
 *
 *   stills    one frame per stage (public/lite/<stage>-<l|p>.webp), crossfaded. ~100 KB each, there at once.
 *   sequence  the whole journey pre-rendered as frames (public/lite/seq/<l|p>/0000.webp …, `perVp` frames per
 *             viewport of scroll; tools/capture-lite-seq.mjs captures them). The frame for the scroll position is drawn to
 *             a canvas, blended with the next one, so scrolling plays the journey forwards and backwards like the
 *             real thing. Frames load around the scroll position; until the ones needed are in, the stills show.
 *
 * A sequence instead of a video: seeking a <video> per scroll tick decodes from the last keyframe every time, which
 * stutters on exactly the devices this is for (and worst when scrolling backwards). Single images decode off the
 * main thread and cost one blit to show.
 */
import { STAGES, journeyAt } from '../lib/timeline';

type Meta = { count: number; perVp: number; width: number; height: number };
type Pic = ImageBitmap | HTMLImageElement;

/** frames kept decoded (≈3 MB each): a short run either side of the scroll position */
const DECODED = 18;
/** compressed frames fetched ahead of / behind the scroll position */
const AHEAD = 54, BEHIND = 18;
const FETCHES = 4, DECODES = 2;

function createSequence(root: HTMLElement, variant: string) {
  const base = `/lite/seq/${variant}/`;
  const canvas = document.createElement('canvas');
  canvas.className = 'lite__seq';
  canvas.style.opacity = '0';
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: false });
  let meta: Meta | null = null;
  let dead = false;
  const blobs = new Map<number, Blob>();
  const pics = new Map<number, Pic>();
  const fetching = new Set<number>(), decoding = new Set<number>();
  let want = 0, dir = 1, visible = false;
  let drawnA = -1, drawnB = -1, drawnMix = -1;
  // the real scene never holds still (idle camera drift, tape noise): while the scroll rests, the picture sways
  // between the neighbouring frames, which moves the camera a touch and keeps the recorded grain alive
  let lastVp = -1, restSince = 0;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  fetch(base + 'meta.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((m: Meta) => {
      if (dead || !ctx) return;
      meta = m;
      canvas.width = m.width;
      canvas.height = m.height;
      pump();
    })
    .catch(() => { /* no sequence for this build: the stills stay */ });

  const decode = (blob: Blob): Promise<Pic> =>
    'createImageBitmap' in window
      ? createImageBitmap(blob)
      : new Promise((res, rej) => {
          const im = new Image();
          const url = URL.createObjectURL(blob);
          im.onload = () => { URL.revokeObjectURL(url); res(im); };
          im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('frame decode')); };
          im.src = url;
        });
  const drop = (i: number) => {
    const p = pics.get(i);
    (p as ImageBitmap | undefined)?.close?.();
    pics.delete(i);
  };

  /** frames to have, nearest first, the scroll direction favoured; every 4th first so a fast scroll has something */
  function wanted(span0: number, span1: number): number[] {
    const out: [number, number][] = [];
    const lo = Math.max(0, want - (dir > 0 ? span0 : span1)), hi = Math.min(meta!.count - 1, want + (dir > 0 ? span1 : span0));
    for (let i = lo; i <= hi; i++) {
      const d = i - want;
      const near = Math.abs(d) <= 3;
      out.push([i, Math.abs(d) * (d * dir < 0 ? 2 : 1) + (near || i % 4 === 0 ? 0 : 40)]);
    }
    return out.sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  }
  function pump() {
    if (!meta || dead) return;
    for (const i of wanted(BEHIND, AHEAD)) {
      if (fetching.size >= FETCHES) break;
      if (blobs.has(i) || fetching.has(i)) continue;
      fetching.add(i);
      fetch(`${base}${String(i).padStart(4, '0')}.webp`)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((b) => { blobs.set(i, b); })
        .catch(() => { /* retried when it is wanted again */ })
        .finally(() => { fetching.delete(i); pump(); });
    }
    const keep = new Set(wanted(5, DECODED - 6).slice(0, DECODED));
    for (const i of keep) {
      if (decoding.size >= DECODES) break;
      if (pics.has(i) || decoding.has(i) || !blobs.has(i)) continue;
      decoding.add(i);
      decode(blobs.get(i)!)
        .then((p) => { if (dead) (p as ImageBitmap).close?.(); else pics.set(i, p); })
        .catch(() => { blobs.delete(i); })
        .finally(() => { decoding.delete(i); pump(); });
    }
    if (pics.size > DECODED + 4) for (const i of [...pics.keys()]) if (!keep.has(i) && i !== drawnA && i !== drawnB) drop(i);
  }

  return {
    /** draw the journey at vp; false while the frames for it aren't in (the stills show instead) */
    frame(vp: number): boolean {
      if (!meta || !ctx) return false;
      const now = performance.now();
      if (Math.abs(vp - lastVp) > 2e-4) { lastVp = vp; restSince = now; }
      const rest = still ? 0 : Math.min(1, Math.max(0, (now - restSince - 150) / 900));
      const sway = rest * (0.55 * Math.sin(now / 1300) + 0.3 * Math.sin(now / 470 + 1.7));
      const f = Math.max(0, Math.min(meta.count - 1, vp * meta.perVp + sway));
      const a = Math.floor(f), mix = Math.round((f - a) * 32) / 32;
      const target = Math.round(vp * meta.perVp);
      if (target !== want) { dir = target > want ? 1 : -1; want = target; pump(); }
      // exact pair when decoded, else the nearest decoded frame within a few steps
      let pa = pics.get(a), pb = mix > 0 ? pics.get(a + 1) : undefined, ia = a, m = pb ? mix : 0;
      if (!pa) {
        for (let d = 1; d <= 4 && !pa; d++) for (const i of [a + d, a - d]) if (!pa && pics.has(i)) { pa = pics.get(i); ia = i; }
        m = 0; pb = undefined;
      }
      const ok = !!pa;
      if (ok !== visible) { visible = ok; canvas.style.opacity = ok ? '1' : '0'; }
      if (!pa) return false;
      const ib = pb ? a + 1 : -1;
      if (ia === drawnA && ib === drawnB && m === drawnMix) return true;
      drawnA = ia; drawnB = ib; drawnMix = m;
      ctx.globalAlpha = 1;
      ctx.drawImage(pa, 0, 0);
      if (pb) { ctx.globalAlpha = m; ctx.drawImage(pb, 0, 0); }
      return true;
    },
    dispose() {
      dead = true;
      for (const i of [...pics.keys()]) drop(i);
      blobs.clear();
      canvas.remove();
    },
  };
}

export function createLite(container: HTMLElement) {
  let root: HTMLElement | null = null;
  let pics: HTMLElement | null = null;
  let imgs: (HTMLImageElement | null)[] = [];
  let seq: ReturnType<typeof createSequence> | null = null;
  let variant = '';
  let shown = false;
  const opacity: number[] = [];
  const portrait = () => innerHeight > innerWidth;
  const noSeq = new URLSearchParams(location.search).has('stills');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // pointer parallax, as the scene has: the picture is drawn slightly oversized and leans away from the pointer
  const lean = { x: 0, y: 0, tx: 0, ty: 0, last: '' };
  /** a small tile of tape noise, stepped around by CSS (compositor only) */
  function noise(): string {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const d = g.createImageData(128, 128);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    return c.toDataURL('image/png');
  }

  function build() {
    root = document.createElement('div');
    root.className = 'lite';
    root.setAttribute('aria-hidden', 'true');
    container.appendChild(root);
    if (!calm) {
      root.style.setProperty('--lite-noise', `url(${noise()})`);
      addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        lean.tx = (e.clientX / innerWidth) * 2 - 1;
        lean.ty = (e.clientY / innerHeight) * 2 - 1;
      }, { passive: true });
    }
    addEventListener('resize', () => { if (shown && variant !== (portrait() ? 'p' : 'l')) reset(); });
  }
  function reset() {
    variant = portrait() ? 'p' : 'l';
    seq?.dispose();
    root!.replaceChildren();
    pics = document.createElement('div');
    pics.className = 'lite__pics';
    root!.appendChild(pics);
    imgs = STAGES.map(() => null);
    opacity.length = 0;
    // data saver / 2G: the stills alone
    const conn = (navigator as any).connection as { saveData?: boolean; effectiveType?: string } | undefined;
    seq = noSeq || conn?.saveData || /2g/.test(conn?.effectiveType ?? '') ? null : createSequence(pics, variant);
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
    pics!.insertBefore(el, pics!.firstChild);
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
      seq?.dispose();
      seq = null;
      delete document.documentElement.dataset.lite;
    },
    frame(vp: number) {
      if (!shown) return;
      if (!calm) {
        lean.x += (lean.tx - lean.x) * 0.06;
        lean.y += (lean.ty - lean.y) * 0.06;
        const t = `translate(${(-lean.x * 1.1).toFixed(2)}%, ${(-lean.y * 0.9).toFixed(2)}%) scale(1.035)`;
        if (t !== lean.last) { lean.last = t; pics!.style.transform = t; }
      }
      const playing = seq?.frame(vp) ?? false;
      if (document.documentElement.dataset.lite !== (playing ? 'seq' : '')) document.documentElement.dataset.lite = playing ? 'seq' : '';
      const js = journeyAt(vp);
      const a = js.trans ? js.from : js.current;
      const b = js.trans ? js.from + 1 : -1;
      // (kept current under the sequence too: they are what shows the moment its frames run out)
      const p = b >= 0 ? Math.round(js.p * 100) / 100 : 0;
      for (let i = 0; i < imgs.length; i++) if (imgs[i] && i !== a && i !== b) setOpacity(i, 0);
      setOpacity(a, 1);
      if (b >= 0) { setOpacity(b, p); imgs[b]!.style.zIndex = '2'; }
      // neighbours decode ahead of the scroll
      img(a + 1); img(a - 1);
    },
  };
}
