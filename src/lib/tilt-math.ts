/**
 * The device-orientation maths of scripts/tilt.ts, written out so the page script doesn't need three for it
 * (three is ~330 kB over the wire and otherwise only arrives with the scene).
 * Pose relative to a slowly re-centring baseline; ±20° → ±1.
 */
type Quat = [x: number, y: number, z: number, w: number];

const D = Math.PI / 180;
const MAX = 20 * D;

/** Euler angles (radians, order YXZ) → quaternion */
function fromEulerYXZ(x: number, y: number, z: number, out: Quat) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  out[0] = s1 * c2 * c3 + c1 * s2 * s3;
  out[1] = c1 * s2 * c3 - s1 * c2 * s3;
  out[2] = c1 * c2 * s3 - s1 * s2 * c3;
  out[3] = c1 * c2 * c3 + s1 * s2 * s3;
}

/** a → towards b by t, along the shorter arc (in place) */
function slerp(a: Quat, b: Quat, t: number) {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let ka = 1 - t, kb = t;
  if (cos < 0.9995) {
    const th = Math.acos(cos), sin = Math.sin(th);
    ka = Math.sin((1 - t) * th) / sin;
    kb = Math.sin(t * th) / sin;
  }
  a[0] = a[0] * ka + bx * kb; a[1] = a[1] * ka + by * kb; a[2] = a[2] * ka + bz * kb; a[3] = a[3] * ka + bw * kb;
  const len = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
  a[0] /= len; a[1] /= len; a[2] /= len; a[3] /= len;
}

export function createTiltPose() {
  const q: Quat = [0, 0, 0, 1], base: Quat = [0, 0, 0, 1];
  let hasBase = false;
  /**
   * @param beta, alpha, gamma  DeviceOrientationEvent angles, degrees
   * @param dt                  seconds since the previous reading
   * @param screenAngle         screen.orientation.angle, degrees
   * @returns tilt, each axis −1..1
   */
  return (beta: number, alpha: number, gamma: number, dt: number, screenAngle: number): { x: number; y: number } => {
    fromEulerYXZ(beta * D, alpha * D, -gamma * D, q);
    if (!hasBase) { base[0] = q[0]; base[1] = q[1]; base[2] = q[2]; base[3] = q[3]; hasBase = true; }
    slerp(base, q, 1 - Math.exp(-0.5 * dt));
    // rel = base⁻¹ · q
    const ax = -base[0], ay = -base[1], az = -base[2], aw = base[3];
    const rx = ax * q[3] + aw * q[0] + ay * q[2] - az * q[1];
    const ry = ay * q[3] + aw * q[1] + az * q[0] - ax * q[2];
    const rz = az * q[3] + aw * q[2] + ax * q[1] - ay * q[0];
    const rw = aw * q[3] - ax * q[0] - ay * q[1] - az * q[2];
    // the forward axis (0, 0, 1) turned by rel
    const nx = 2 * (rx * rz + rw * ry), ny = 2 * (ry * rz - rw * rx), nz = 1 - 2 * (rx * rx + ry * ry);
    const ang = screenAngle * D;
    const x = Math.atan2(nx, nz), y = Math.atan2(ny, nz);
    const clamp = (v: number) => Math.max(-1, Math.min(1, v / MAX));
    return { x: clamp(x * Math.cos(ang) + y * Math.sin(ang)), y: clamp(-x * Math.sin(ang) + y * Math.cos(ang)) };
  };
}
