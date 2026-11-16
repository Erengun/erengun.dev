// Captures the journey as the frame sequence scripts/lite.ts plays when the 3D scene can't run.
// Serve a build first (astro build && astro preview --port 4381), then for each orientation:
//   CHROME=<chromium binary> node tools/capture-lite-seq.mjs public/lite/seq l
//   CHROME=<chromium binary> node tools/capture-lite-seq.mjs public/lite/seq p
// Re-run after any visual change to the scenes, or the fallback shows the old look.
import { chromium } from 'playwright'; // not a project dependency: run with a Playwright install on NODE_PATH

import fs from 'fs';
import sharp from 'sharp';
const [,, out, variant, Karg] = process.argv;
const K = Number(Karg || 12);
const cfg = variant === 'p'
  ? { ctx: { viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, w: 600, q: Number(process.env.Q || 56) }
  : { ctx: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 }, w: 1120, q: Number(process.env.Q || 56) };
const dir = `${out}/${variant}`; fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--headless=new', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu-rasterization'] });
const ctx = await b.newContext(cfg.ctx);
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 160)));
await p.goto((process.env.BASE || 'http://localhost:4381/') + '?quality=high&bench', { waitUntil: 'load' });
await p.waitForFunction(() => window.__scene, null, { timeout: 60000 });
await p.evaluate(() => document.querySelector('[data-motion-decline]')?.click());
await p.waitForFunction(() => !document.body.classList.contains('is--loading'), null, { timeout: 60000 });
const total = await p.evaluate(() => window.__lab.TOTAL_VP);
const go = (vp) => p.evaluate(async ([vp, n]) => {
  const L = window.__lab;
  L.lenis.scrollTo((vp / L.TOTAL_VP) * L.lenis.limit, { immediate: true, force: true });
  window.__sceneTime = 100 + vp * 0.45;
  for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
}, [vp, 14]);
// visit every stage so all of them load and compile before anything is captured
const n = await p.evaluate(() => window.__lab.STAGES.length);
for (let i = 0; i < n; i++) {
  await go(await p.evaluate((i) => { const s = window.__lab.STAGES[i]; return s.start + s.span * 0.5; }, i));
  await p.waitForFunction((i) => window.__scene.journey.isReady(i), i, { timeout: 90000 });
}
await p.waitForFunction(() => !window.__scene.journey.busy(), null, { timeout: 90000 });
await p.waitForTimeout(6000);
await p.evaluate(() => { const app = document.querySelector('#app'); for (const el of document.querySelectorAll('body *')) if (!el.contains(app) && !app.contains(el)) el.style.setProperty('opacity', '0', 'important'); });
const count = Math.round(total * K) + 1;
// approach the start from a little further on, so damped values settle the same way as during the run
await go(0.5); await go(0);
await p.waitForTimeout(3000);
let bytes = 0; const jobs = [];
for (let i = 0; i < count; i++) {
  const vp = Math.min(total, i / K);
  await go(vp);
  const png = await p.screenshot({ type: 'png' });
  const f = `${dir}/${String(i).padStart(4, '0')}.webp`;
  jobs.push(sharp(png).resize({ width: cfg.w }).webp({ quality: cfg.q, effort: 5 }).toFile(f).then((r) => { bytes += r.size; }));
  if (i % 40 === 0) console.log(variant, i, '/', count);
}
await Promise.all(jobs);
const meta = await sharp(`${dir}/0000.webp`).metadata();
fs.writeFileSync(`${dir}/meta.json`, JSON.stringify({ count, perVp: K, width: meta.width, height: meta.height }));
console.log(variant, 'frames', count, 'size', meta.width + 'x' + meta.height, 'total', (bytes / 1048576).toFixed(1) + 'MB', 'avg', (bytes / count / 1024).toFixed(0) + 'KB');
await b.close();
