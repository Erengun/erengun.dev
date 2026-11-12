# Journey restructure (v2 flow)

The user's direction: no white carousel. The flow is **intro → about → projects → contact**, and every
section is a cinematic 3D scene with transitions, as the about section already is.

```
intro face ── corridor (about me) ── city (who I work with) ── Öge world ── Ferman world ── CNI CE world
          ── Elek world ── Subara world ── lantern alley (contact CTA)
```

## Contract
`src/scene/journey/types.ts` defines `Stage`, `StageFrame` and `ProjectWorldContext`. Every stage owns its
scene and camera and is driven by `StageFrame.t` (local 0..1 over its own scroll span), `enter`, `exit`,
`parallax`, `pointer` and `slide`.

## Project world stage (each about 2.6 viewports of scroll)
- `t` 0 → .22: **arrive**. The camera flies into the world while the transition from the previous stage plays.
- `t` .22 → .82: **hold**. The world is calm, with slow camera drift and pointer/tilt parallax. The project's
  REAL screenshots (`ctx.slides`) are shown inside the world on screens, billboards, devices or whatever
  suits the concept, and must be readable at 1440×900 (the DOM panel, described below, occupies the bottom ~28%).
  `f.slide` selects which screenshot is featured; changing it animates (≤ 600 ms). Keep the project's
  palette and identity.
- `t` .82 → 1: **depart**. The camera moves on and the next transition starts.
- Optional `portalQuad()` returns a quad whose interior reveals the next stage for a portal transition.
- DOM overlay (owned by the core, not the world): title / info / role / thumbnails along the bottom, shown
  during hold.
- Budget: ≤ ~1.2 ms GPU at 1440×900 on an M1-class GPU, ≤ 40 draw calls, assets ≤ 2.5 MB per world.
  It must work on both the WebGPU and WebGL2 backends.

## World concepts (approved by the user)
| # | Project | World |
|---|---|---|
| 0 | Öge | A dark control room ("One Desk"): long desks of monitors running coding agents, scrolling terminal text, receipts printing out of a printer and an "ACCEPTED" stamp. Orange accent #ff5a1f on near-black. |
| 1 | Ferman | A giant unfurling Ottoman *ferman* (imperial edict) scroll in a dim hall, with gold tughra-like calligraphy (an original, abstract design, not a real tughra) and a wax/gold seal. Glowing "patches" travel from the scroll to rows of devices (Android, Windows, iOS) as rollout percentages fill. Gold #e8b04a on navy #0a0f1a. |
| 2 | Cached Network Image CE | An endless tunnel of photo frames streaming past smoothly (instanced quads, procedural or abstract photos generated locally, no stock photos), with cache hits flashing as frames snap into place. Flutter blue #02569b, amber #ffb300. |
| 3 | Elek | A huge sieve (elek): thousands of test particles fall onto the mesh, green ones pass through and red/stale ones bounce. Big "107×" in-world typography. Lime #c8ff00 on black. |
| 4 | Subara | Liquid-glass subscription cards (made-up services) orbiting a giant phone over a reflective calendar floor with payment dots, plus a Dynamic Island pill. Violet #5b3df5 → pink #ff8fc7. |

## Real screenshots
`public/projects/<id>/manifest.json` → `SlideImage[]`. The project-slides worker produces them. Until they
exist, worlds use `/projects/_placeholder/manifest.json` or generate their own placeholder images.

## Ownership
- **Core (journey worker):** `src/scene/app.ts` (rewrite: no helix), `src/scene/journey/*` (compositor,
  timeline, transitions), `src/lib/timeline.ts`, `src/scripts/main.ts`, `src/pages/index.astro`,
  `src/styles/global.css`, and wiring `intro.ts`, `last.ts` and the splat into stages (splitting `last.ts`
  into corridor / city / alley stages).
- **World workers:** only `src/scene/worlds/<id>.ts` (+ `tools/blender/worlds/<id>/`, `public/worlds/<id>/`)
  and their test page `src/pages/test-world-<id>.astro`. Develop as `<id>.wip.ts` and rename at the end.
- **Face worker:** `src/scene/portals/intro.ts` (to be exposed as the intro stage by core).
- **Slides worker:** `public/projects/*`, `src/scene/portals/project-slides.ts`.
