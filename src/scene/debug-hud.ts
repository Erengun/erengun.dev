/**
 * `?debug` overlay for diagnosing performance on real devices: live fps / CPU frame time / resolution, plus a
 * per-stage summary (frame-time percentiles, slow frames, main-thread long tasks) that can be copied as text.
 */
type Info = Record<string, string | number | boolean>;
type Acc = { n: number; dts: number[]; cpu: number; slow: number; long: number; longMs: number; minDpr: number };

export function createHud(info: Info, live: () => Info) {
  const per = new Map<string, Acc>();
  let cur = '';
  const acc = (id: string) => {
    let a = per.get(id);
    if (!a) per.set(id, (a = { n: 0, dts: [], cpu: 0, slow: 0, long: 0, longMs: 0, minDpr: Infinity }));
    return a;
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { const a = acc(cur || 'loading'); a.long++; a.longMs += e.duration; }
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* Safari: no long-task API */ }

  const el = document.createElement('div');
  el.setAttribute('style', [
    'position:fixed', 'left:6px', 'bottom:6px', 'z-index:100000', 'max-width:calc(100vw - 12px)',
    'font:11px/1.35 ui-monospace,Menlo,monospace', 'color:#0f0', 'background:rgb(0 0 0 / .78)', 'padding:6px 8px',
    'white-space:pre', 'pointer-events:auto', 'border-radius:4px',
  ].join(';'));
  const text = document.createElement('div');
  const btn = document.createElement('button');
  btn.textContent = 'copy report';
  btn.setAttribute('style', 'margin-top:4px;font:inherit;color:#000;background:#0f0;border:0;padding:4px 8px;border-radius:3px');
  el.append(text, btn);
  document.body.appendChild(el);

  const pct = (xs: number[], p: number) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  const report = () => {
    const lines = Object.entries({ ...info, ...live() }).map(([k, v]) => `${k}: ${v}`);
    lines.push('', 'stage                          frames  fps(med)  p95ms  >33ms%  cpu ms  longtasks  minDpr');
    for (const [id, a] of per) {
      if (!a.n) continue;
      const med = pct(a.dts, 0.5);
      lines.push(
        `${id.padEnd(30)} ${String(a.n).padStart(6)}  ${(med ? 1000 / med : 0).toFixed(0).padStart(8)}  ` +
        `${pct(a.dts, 0.95).toFixed(0).padStart(5)}  ${((100 * a.slow) / a.n).toFixed(0).padStart(6)}  ` +
        `${(a.cpu / a.n).toFixed(1).padStart(6)}  ${`${a.long} (${a.longMs.toFixed(0)}ms)`.padStart(9)}  ${a.minDpr.toFixed(2)}`,
      );
    }
    return lines.join('\n');
  };
  btn.addEventListener('click', async () => {
    const r = report();
    try { await navigator.clipboard.writeText(r); btn.textContent = 'copied ✓'; }
    catch {
      // clipboard blocked: show the text so it can be selected by hand
      const ta = document.createElement('textarea');
      ta.value = r; ta.setAttribute('style', 'display:block;width:90vw;height:50vh;font:10px monospace');
      el.appendChild(ta); ta.select(); btn.textContent = 'select + copy the text';
    }
    setTimeout(() => (btn.textContent = 'copy report'), 2000);
  });

  let win: number[] = [], winCpu = 0, last = 0;
  return {
    report,
    sample(dt: number, cpuMs: number, stage: string, dpr: number, now: number) {
      cur = stage;
      const ms = dt * 1000;
      const a = acc(stage);
      a.n++; a.cpu += cpuMs; if (ms > 34) a.slow++; a.minDpr = Math.min(a.minDpr, dpr);
      if (a.dts.length < 4000) a.dts.push(ms);
      win.push(ms); winCpu += cpuMs;
      if (now - last < 0.5) return;
      const med = pct(win, 0.5);
      const l = live();
      text.textContent =
        `${info.backend} · ${info.tier} · ${String(info.gpu).slice(0, 34)}\n` +
        `${stage}  ${(med ? 1000 / med : 0).toFixed(0)} fps  worst ${Math.max(...win).toFixed(0)}ms  cpu ${(winCpu / win.length).toFixed(1)}ms\n` +
        `dpr ${l.dpr}  buffer ${l.buffer}`;
      win = []; winCpu = 0; last = now;
    },
  };
}
