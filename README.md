# erengun-lab

A private experiment: a scroll-driven WebGPU portfolio for Eren Gün. Its flow comes from a reference site
(intro portrait → helix of project screens → fly-through corridor → twisting city → portal into a splat
alley → contact). Everything here was written or modelled from scratch: the code, the shaders, the Blender
assets and the copy. Nothing from the reference site is included.

```sh
bun install
bun run dev        # http://localhost:4380
```

Add `?webgl` to force the WebGL2 backend.

## How it fits together

| Path | What it does |
|---|---|
| `src/pages/index.astro` | DOM shell: preloader, header and menu, intro text, project panels, "Selected work" nav, about / who / CTA |
| `src/scripts/main.ts` | Lenis smooth scroll and snap, route state, body classes, overlays, the frame loop, renderer boot |
| `src/lib/timeline.ts` | Scroll maths: carousel index, scene progress, wipes, snap points. It derives everything from `PROJECTS.length` |
| `src/lib/content.ts` | All copy and projects. Add a project here and the helix grows |
| `src/scene/app.ts` | WebGPURenderer, helix of portal tiles, portal fly-through, picking, labels, routing from scroll |
| `src/scene/portals/*` | One scene per portal: `intro` (voxel quadtree bust), `project` + `project-slides` (procedural slides, rooms, star sky), `last` (robot-arm corridor → twisting city → splat) |
| `src/scene/splat/splat.ts` | Gaussian-splat renderer: EWA projection, 4096-bin counting sort in a Web Worker, hover push |
| `src/scene/post/*` | Fish-eye with overscan, then the VHS camcorder + CRT pass |
| `src/pages/test-*.astro` | Isolated test pages for each part, configured with query params |

## Regenerating assets (Blender 4.x, headless)

```sh
blender -b -P tools/blender/robot-arm-tile/build.py      # public/models/robot-arm-tile.glb
blender -b -P tools/blender/city-block/build.py          # public/models/city-block.glb
blender -b -P tools/blender/rooms/build_rooms.py         # gallery-tile.glb, studio-corridor.glb
blender -b -P tools/blender/portrait/bust.py -- <frames> && python3 -I tools/blender/portrait/pack.py <frames> public/portrait
# alley splat: about 25 min, mostly Cycles
blender -b --factory-startup -P tools/blender/alley/alley.py -- build
blender -b --factory-startup $ALLEY_WORK/alley.blend -P tools/blender/alley/alley.py -- render
blender -b --factory-startup $ALLEY_WORK/alley.blend -P tools/blender/alley/alley.py -- splat 500000
```

## Before this goes anywhere public

- **Font:** `public/fonts/OffBit-DotBold.ttf` is free for **personal use only**. A public or commercial site
  needs a license from the foundry (Power Type), or a swap to the OFL-licensed Doto, which is already loaded.
- **Size:** `alley.splat` is 16 MB. Phones download all of it and use the first 220k splats. A separate phone
  file, or a compressed format such as SPZ, would help.
- **Testing:** headless runs used WebGL2. WebGPU was checked by stripping `featureLevel` from `requestAdapter`.
  Test on real devices, including Safari.
