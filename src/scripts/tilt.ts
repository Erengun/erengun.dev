import { session } from './guard';
import { tilt } from '../lib/stores';
import { createTiltPose } from '../lib/tilt-math';

/**
 * Device-orientation tilt (spec-dom §3): pose relative to a slowly re-centring baseline,
 * ±20° → ±1. Returns true when an iOS-style permission prompt is needed.
 */
export function initTilt(onResolved: () => void): boolean {
  const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!touch || reduced || typeof DeviceOrientationEvent === 'undefined') return false;

  const pose = createTiltPose();
  let lastT = performance.now();

  const onOrient = (ev: DeviceOrientationEvent) => {
    if (ev.beta == null || ev.gamma == null) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const p = pose(ev.beta, ev.alpha ?? 0, ev.gamma, dt, screen.orientation?.angle ?? 0);
    tilt.x = p.x;
    tilt.y = p.y;
    tilt.active = true;
  };

  const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof DOE.requestPermission !== 'function') {
    addEventListener('deviceorientation', onOrient);
    return false;
  }
  if (session.get('motion-declined')) return false;
  document.querySelector('[data-motion-allow]')?.addEventListener('click', async () => {
    try {
      if ((await DOE.requestPermission!()) === 'granted') addEventListener('deviceorientation', onOrient);
    } catch { /* ignore */ }
    tilt.active = true;
    onResolved();
  });
  document.querySelector('[data-motion-decline]')?.addEventListener('click', () => {
    session.set('motion-declined', '1');
    onResolved();
  });
  return true;
}
