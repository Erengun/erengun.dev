/**
 * `?debug` overlay for diagnosing performance on real devices: live fps / CPU frame time / resolution, plus a
 * per-stage summary (frame-time percentiles, slow frames, main-thread long tasks) that can be copied as text.
 */
type Info = Record<string, string | number | boolean>;
type Acc = { n: number; dts: number[]; cpu: number; slow: number; long: number; longMs: number; minDpr: number; links: number; linkMs: number; linkMax: number; frz: number; frzMs: number; up: number; upMs: number; upMax: number };

export function createHud(info: Info, live: () => Info, gl?: WebGL2RenderingContext | null, backend?: any) {
  const jl: string[] = ((window as any).__journeyLog = []);
  // which render objects get a pipeline outside compileAsync (promises === null): the warm-up missed them
  if (backend?.createRenderPipeline) {
    const crp = backend.createRenderPipeline.bind(backend);
    backend.createRenderPipeline = (ro: any, promises: unknown) => {
      if (promises === null) {
        const o = ro.object, m = ro.material;
        jl.push(`@${(performance.now() / 1000).toFixed(2)}s LIVE PIPELINE in ${cur}: ${o?.name || o?.type} [${o?.geometry?.type} ${o?.geometry?.attributes?.position?.count}v] / ${m?.name || m?.type} transparent=${m?.transparent} side=${m?.side} rt=${ro.context?.renderTarget?.texture?.name ?? (ro.context?.textures ? 'target' : 'canvas')}${o?.parent ? ` (parent ${o.parent.name || o.parent.type})` : ''}`);
      }
      return crp(ro, promises);
    };
  }
  const per = new Map<string, Acc>();
  let cur = '';
  const acc = (id: string) => {
    let a = per.get(id);
    if (!a) per.set(id, (a = { n: 0, dts: [], cpu: 0, slow: 0, long: 0, longMs: 0, minDpr: Infinity, links: 0, linkMs: 0, linkMax: 0, frz: 0, frzMs: 0, up: 0, upMs: 0, upMax: 0 }));
    return a;
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { const a = acc(cur || 'loading'); a.long++; a.longMs += e.duration; }
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* Safari: no long-task API */ }

  // WebGL2 only: shader programs linked, and main-thread time blocked waiting on LINK_STATUS (synchronous when the
  // browser lacks KHR_parallel_shader_compile). WebGPU compiles pipelines asynchronously, so there is nothing to time.
  let links = 0;
  if (gl) {
    const link = gl.linkProgram.bind(gl), param = gl.getProgramParameter.bind(gl);
    gl.linkProgram = (pr) => { links++; acc(cur || 'loading').links++; link(pr); };
    gl.getProgramParameter = (pr, pname) => {
      if (pname !== gl.LINK_STATUS) {
        const t0 = performance.now(); const r0 = param(pr, pname); const d0 = performance.now() - t0;
        // Safari: a status query waits for the GPU process to drain queued work (e.g. a large texture upload)
        if (d0 > 8) jl.push(`@${(t0 / 1000).toFixed(2)}s SLOW getProgramParameter(0x${pname.toString(16)}) ${d0.toFixed(0)}ms`);
        return r0;
      }
      const t = performance.now(); const r = param(pr, pname); const ms = performance.now() - t;
      const a = acc(cur || 'loading'); a.linkMs += ms; a.linkMax = Math.max(a.linkMax, ms);
      return r;
    };
  }

  // slow individual GL calls (with the upload source) and main-thread gaps > 60 ms (Safari has no long-task API)
  if (gl) {
    for (const name of ['compileShader', 'linkProgram', 'shaderSource', 'createProgram', 'attachShader', 'useProgram', 'getShaderParameter', 'getUniformLocation', 'getUniformBlockIndex', 'uniformBlockBinding', 'getAttribLocation', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'texImage2D', 'texSubImage2D', 'readPixels', 'clientWaitSync', 'getError'] as const) {
      const fn = (gl as any)[name];
      if (!fn) continue;
      const b = fn.bind(gl);
      (gl as any)[name] = (...args: unknown[]) => {
        const t = performance.now(); const r = b(...args); const ms = performance.now() - t;
        if (ms > 15) { const src: any = args.find((a: any) => a && typeof a === 'object' && ('width' in a)); jl.push(`@${(t / 1000).toFixed(2)}s SLOW ${name} ${ms.toFixed(0)}ms ${src ? `${src.constructor?.name} ${src.width}x${src.height} ${(src.src ?? '').split('/').slice(-2).join('/')}` : ''}`); }
        return r;
      };
    }
  }
  {
    let lt = performance.now();
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { const n = performance.now(); if (n - lt > 60) jl.push(`@${(lt / 1000).toFixed(2)}s GAP ${(n - lt).toFixed(0)}ms`); lt = n; setTimeout(() => ch.port2.postMessage(0), 0); };
    ch.port2.postMessage(0);
  }
  // WebGL2 only: texture / buffer uploads (image decode happens inside texImage2D for <img> sources)
  if (gl) {
    for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexImage2D', 'bufferData', 'bufferSubData'] as const) {
      const fn = (gl as any)[name].bind(gl);
      (gl as any)[name] = (...args: unknown[]) => {
        const t = performance.now(); const r = fn(...args); const ms = performance.now() - t;
        const a = acc(cur || 'loading'); a.up++; a.upMs += ms; a.upMax = Math.max(a.upMax, ms);
        return r;
      };
    }
  }

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
    const lines = Object.entries({ ...info, ...live(), programsLinked: links }).map(([k, v]) => `${k}: ${v}`);
    lines.push('', 'stage                          frames  fps(med)  p95ms  >33ms%  freezes>100ms  cpu ms  longtasks  minDpr  links  linkMs(max)  uploads ms(max)');
    for (const [id, a] of per) {
      if (!a.n && !a.links) continue;
      const med = pct(a.dts, 0.5);
      const n = Math.max(1, a.n);
      lines.push(
        `${id.padEnd(30)} ${String(a.n).padStart(6)}  ${(med ? 1000 / med : 0).toFixed(0).padStart(8)}  ` +
        `${pct(a.dts, 0.95).toFixed(0).padStart(5)}  ${((100 * a.slow) / n).toFixed(0).padStart(6)}  ${`${a.frz} (${a.frzMs.toFixed(0)}ms)`.padStart(13)}  ` +
        `${(a.cpu / n).toFixed(1).padStart(6)}  ${`${a.long} (${a.longMs.toFixed(0)}ms)`.padStart(9)}  ${(a.n ? a.minDpr.toFixed(2) : '-').padStart(6)}  ${String(a.links).padStart(5)}  ${a.linkMs.toFixed(0)} (${a.linkMax.toFixed(0)})  ${a.up} ${a.upMs.toFixed(0)} (${a.upMax.toFixed(0)})`,
      );
    }
    lines.push('', 'journey:', ...jl);
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

  // `&autotest`: once the page is interactive, scroll the whole journey at a fixed pace (same run on every device),
  // then show the report full screen
  if (new URLSearchParams(location.search).has('autotest')) {
    const scroller = document.querySelector('[data-page-scroll]') as HTMLElement | null;
    const start = () => {
      if (!scroller || document.body.classList.contains('is--loading')) return void setTimeout(start, 500);
      (document.querySelector('[data-motion-decline]') as HTMLElement | null)?.click();
      [...document.querySelectorAll('button')].find((b) => /no thanks/i.test(b.textContent ?? ''))?.click();
      // `&idle=<s>`: watch the opening that long before scrolling (default 3 s)
      const t0 = performance.now(), DUR = 60_000, from = 1000 * Number(new URLSearchParams(location.search).get('idle') ?? 3);
      const step = () => {
        const k = (performance.now() - t0 - from) / DUR;
        if (k >= 0) scroller.scrollTop = Math.min(1, k) * (scroller.scrollHeight - scroller.clientHeight);
        if (k < 1.05) return void requestAnimationFrame(step);
        const ta = document.createElement('textarea');
        ta.value = `autotest ${DUR / 1000}s scroll after ${from / 1000}s idle, gate open at ${(t0 / 1000).toFixed(1)}s\n` + report();
        ta.setAttribute('style', 'position:fixed;inset:8px;z-index:100001;font:5px/1.25 ui-monospace,monospace;background:#000;color:#0f0;white-space:pre;overflow:auto');
        document.body.appendChild(ta);
        (window as any).__autotestDone = ta.value;
        // `&post=<url>`: also send the report there (local test rigs: emulators, simulators)
        const post = new URLSearchParams(location.search).get('post');
        if (post) fetch(post, { method: 'POST', body: ta.value, mode: 'no-cors' }).catch(() => {});
      };
      requestAnimationFrame(step);
    };
    start();
  }

  let win: number[] = [], winCpu = 0, last = 0, prev = 0;
  return {
    report,
    sample(_dt: number, cpuMs: number, stage: string, dpr: number, now: number) {
      cur = stage;
      // real interval between frames (the loop's dt is clamped to 50 ms, which would hide stalls)
      const ms = prev ? (now - prev) * 1000 : 16.7;
      prev = now;
      const a = acc(stage);
      a.n++; a.cpu += cpuMs; if (ms > 34) a.slow++; if (ms > 100) { a.frz++; a.frzMs += ms; jl.push(`@${now.toFixed(2)}s FREEZE ${ms.toFixed(0)}ms in ${stage}`); } a.minDpr = Math.min(a.minDpr, dpr);
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
