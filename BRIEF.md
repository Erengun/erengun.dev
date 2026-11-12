# Lab brief (read fully before starting)

Private learning experiment: a faithful re-creation of the *look and motion* of a reference portfolio
(fojcikdominik.com), rebuilt from scratch for Eren Gün's content. Not deployed anywhere.

## Hard rules
- **Never copy the reference's code or assets.** Do not fetch anything from fojcikdominik.com. Use the written specs
  and screenshots only. All shaders/code are written by you. All 3D assets are ours: generated with Blender
  headless scripts (`blender -b -P script.py`, Blender is at /opt/homebrew/bin/blender) or procedurally in three.js.
- Stack: Astro 5, three **r187** (`three/webgpu` + `three/tsl`, WebGPURenderer with automatic WebGL2 fallback),
  anime.js 4.5, Lenis 1.3.26, nanostores. Bun is the package manager (`bun add`), don't add heavy deps without need.
- Code must work on both the WebGPU and the WebGL2 backend (headless screenshot tooling runs the WebGL2 backend).
  Compute shaders are WebGPU-only: if you use them, provide a WebGL2 fallback path.
- Work only in the files assigned to you. Do not edit `src/scene/app.ts`, `src/scripts/*`, `src/styles/*` or other
  workers' files. If you need a change in a shared file, describe it in your final report instead.
- Develop your module under a `*.wip.ts` filename and test it on your own page `src/pages/test-<name>.astro`.
  Only rename to the final filename as your last step, after it works (the registry auto-loads the final name
  via `import.meta.glob`, so a broken final-named file breaks the main page for everyone).
- Put Blender scripts in `tools/blender/<name>/`, outputs in `public/models/` (glb, Draco off, keep < 3 MB each)
  or `public/<your-area>/`.

## Where things are
- Specs (from static analysis of the reference bundles):
  - 3D/rendering: `/private/tmp/claude-501/-Users-egun-dev-erengun-dev/9b67bd92-b738-4783-8cb7-3be6c01fb241/scratchpad/ref/spec-3d.md`
  - DOM/motion: `/private/tmp/claude-501/-Users-egun-dev-erengun-dev/9b67bd92-b738-4783-8cb7-3be6c01fb241/scratchpad/ref/spec-dom.md`
- Reference screenshots (1440×900, WebGL2 backend), named by scrolled viewports `vpN.png`:
  `/private/tmp/claude-501/-Users-egun-dev-erengun-dev/9b67bd92-b738-4783-8cb7-3be6c01fb241/scratchpad/shots/desk/`
  (contact sheets: `../sheet-carousel.png`, `../sheet-last.png`, `../sheet-load.png`)
- Portal interface: `src/scene/types.ts` (Portal, PortalFrame, PORTAL_W/H). Read `src/scene/app.ts` to see how
  portals are rendered (each into its own RenderTarget, using an inner camera posed relative to the portal plane;
  the main pass samples it with screenUV) and `src/scene/portals/placeholder.ts` for a minimal example.
- Content: `src/lib/content.ts` (Eren's projects). Timeline math: `src/lib/timeline.ts`.
- Dev server: http://localhost:4380 (already running; hot reloads). Don't start another one.
- Screenshot tool: `/private/tmp/claude-501/-Users-egun-dev-erengun-dev/9b67bd92-b738-4783-8cb7-3be6c01fb241/scratchpad/tools/`
  has playwright installed; launch Chromium with
  `chromium.launch({ executablePath:'/Applications/Chromium.app/Contents/MacOS/Chromium', headless:true, args:['--headless=new','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=metal'] })`.
  `cap.mjs` there is an example (full-page timeline capture). Write your own small scripts in your own
  scratch dir under `.../scratchpad/work-<name>/`. Look at your screenshots (Read the png) and compare with the
  reference ones. Iterate until it matches the reference's look closely.
- Python: run with `python3 -I`. PIL is available.

## Done means
Your module works on its test page on the WebGL2 backend, no console errors, you compared screenshots against the
reference and iterated, then renamed to the final filename and confirmed http://localhost:4380/ still loads without
errors. Final report: what you built, how it maps to the spec, deviations, perf notes, screenshot paths, and any
change you need in shared files. Commit nothing; the lead commits.
