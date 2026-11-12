import { tilt } from '../lib/stores';
import { Euler, Quaternion, Vector3 } from 'three';

/**
 * Device-orientation tilt (spec-dom §3): pose relative to a slowly re-centring baseline,
 * ±20° → ±1. Returns true when an iOS-style permission prompt is needed.
 */
export function initTilt(onResolved: () => void): boolean {
  const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!touch || reduced || typeof DeviceOrientationEvent === 'undefined') return false;

  const q = new Quaternion();
  const base = new Quaternion();
  const rel = new Quaternion();
  const e = new Euler();
  const n = new Vector3();
  let hasBase = false;
  let lastT = performance.now();
  const D = Math.PI / 180;
  const MAX = 20 * D;

  const onOrient = (ev: DeviceOrientationEvent) => {
    if (ev.beta == null || ev.gamma == null) return;
    e.set((ev.beta ?? 0) * D, (ev.alpha ?? 0) * D, -(ev.gamma ?? 0) * D, 'YXZ');
    q.setFromEuler(e);
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (!hasBase) { base.copy(q); hasBase = true; }
    base.slerp(q, 1 - Math.exp(-0.5 * dt));
    rel.copy(base).invert().multiply(q);
    n.set(0, 0, 1).applyQuaternion(rel);
    const ang = (screen.orientation?.angle ?? 0) * D;
    let x = Math.atan2(n.x, n.z);
    let y = Math.atan2(n.y, n.z);
    [x, y] = [x * Math.cos(ang) + y * Math.sin(ang), -x * Math.sin(ang) + y * Math.cos(ang)];
    tilt.x = Math.max(-1, Math.min(1, x / MAX));
    tilt.y = Math.max(-1, Math.min(1, y / MAX));
    tilt.active = true;
  };

  const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof DOE.requestPermission !== 'function') {
    addEventListener('deviceorientation', onOrient);
    return false;
  }
  if (sessionStorage.getItem('motion-declined')) return false;
  document.querySelector('[data-motion-allow]')?.addEventListener('click', async () => {
    try {
      if ((await DOE.requestPermission!()) === 'granted') addEventListener('deviceorientation', onOrient);
    } catch { /* ignore */ }
    tilt.active = true;
    onResolved();
  });
  document.querySelector('[data-motion-decline]')?.addEventListener('click', () => {
    sessionStorage.setItem('motion-declined', '1');
    onResolved();
  });
  return true;
}
