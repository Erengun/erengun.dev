import type { Portal, PortalContext } from '../types';
import { PROJECTS } from '../../lib/content';
import { createPlaceholderPortal } from './placeholder';

/**
 * Portal registry: tile 0 intro portrait, tiles 1..4 projects, tile 5 last-scene sequence.
 * Real implementations replace the placeholders as they land (see ./intro.ts, ./project.ts, ./last.ts).
 */
const mods = (import.meta as any).glob(['./intro.ts', './project.ts', './last.ts'], { eager: true }) as Record<string, any>;

export function createPortals(ctx: PortalContext): Portal[] {
  const intro = mods['./intro.ts']?.createIntroPortal?.(ctx) ?? createPlaceholderPortal(ctx, 'intro', 0);
  const projects = PROJECTS.map(
    (p, i) => mods['./project.ts']?.createProjectPortal?.(ctx, p, i) ?? createPlaceholderPortal(ctx, 'project', i + 1, p.palette),
  );
  const last = mods['./last.ts']?.createLastPortal?.(ctx) ?? createPlaceholderPortal(ctx, 'last', 5);
  return [intro, ...projects, last];
}
