import { expect, test } from 'bun:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { createTiltPose } from './tilt-math';

/** the version this replaced, on three's own classes */
function reference() {
  const q = new Quaternion(), base = new Quaternion(), rel = new Quaternion(), e = new Euler(), n = new Vector3();
  let hasBase = false;
  const D = Math.PI / 180, MAX = 20 * D;
  return (beta: number, alpha: number, gamma: number, dt: number, screenAngle: number) => {
    e.set(beta * D, alpha * D, -gamma * D, 'YXZ');
    q.setFromEuler(e);
    if (!hasBase) { base.copy(q); hasBase = true; }
    base.slerp(q, 1 - Math.exp(-0.5 * dt));
    rel.copy(base).invert().multiply(q);
    n.set(0, 0, 1).applyQuaternion(rel);
    const ang = screenAngle * D;
    let x = Math.atan2(n.x, n.z), y = Math.atan2(n.y, n.z);
    [x, y] = [x * Math.cos(ang) + y * Math.sin(ang), -x * Math.sin(ang) + y * Math.cos(ang)];
    return { x: Math.max(-1, Math.min(1, x / MAX)), y: Math.max(-1, Math.min(1, y / MAX)) };
  };
}

test('matches the three.js version over a wandering phone', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const screenAngle of [0, 90, 180, 270]) {
    const mine = createTiltPose(), ref = reference();
    let beta = 40, alpha = 120, gamma = -5;
    for (let i = 0; i < 400; i++) {
      // mostly small hand movements, now and then a big swing (which exercises the shorter-arc branch)
      const big = rnd() < 0.05 ? 60 : 3;
      beta = Math.max(-180, Math.min(180, beta + (rnd() - 0.5) * big));
      alpha = (alpha + (rnd() - 0.5) * big + 360) % 360;
      gamma = Math.max(-90, Math.min(90, gamma + (rnd() - 0.5) * big));
      const dt = 0.005 + rnd() * 0.095;
      const a = mine(beta, alpha, gamma, dt, screenAngle), b = ref(beta, alpha, gamma, dt, screenAngle);
      expect(a.x).toBeCloseTo(b.x, 5);
      expect(a.y).toBeCloseTo(b.y, 5);
    }
  }
});

test('a phone held still reads as no tilt', () => {
  const pose = createTiltPose();
  let last = { x: 1, y: 1 };
  for (let i = 0; i < 10; i++) last = pose(45, 10, 3, 0.016, 0);
  expect(Math.abs(last.x)).toBeLessThan(1e-6);
  expect(Math.abs(last.y)).toBeLessThan(1e-6);
});
