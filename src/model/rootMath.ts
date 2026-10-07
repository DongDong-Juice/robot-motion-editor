export type Quat = [number, number, number, number] // xyzw

// ZYX intrinsic: qz(yaw) ⊗ qy(pitch) ⊗ qx(roll)
export function eulerToQuat(roll: number, pitch: number, yaw: number): Quat {
  const [cr, sr] = [Math.cos(roll / 2), Math.sin(roll / 2)]
  const [cp, sp] = [Math.cos(pitch / 2), Math.sin(pitch / 2)]
  const [cy, sy] = [Math.cos(yaw / 2), Math.sin(yaw / 2)]
  return [
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy,
  ]
}

// Inverse of eulerToQuat (ZYX); pitch in [-pi/2, pi/2], roll/yaw in (-pi, pi].
export function quatToEuler(q: Quat): [number, number, number] {
  const n = Math.hypot(...q) || 1
  const [x, y, z, w] = q.map(v => v / n)
  const a = 2 * (w * x + y * z), b = 1 - 2 * (x * x + y * y), s = 2 * (w * y - z * x)
  const c = Math.hypot(a, b) // = cos(pitch); atan2 stays accurate near +-pi/2
  if (c < 1e-9) // gimbal lock: only yaw -/+ roll is defined; put it all in yaw with roll = 0 (R01 = -sin yaw, R11 = cos yaw)
    return [0, Math.sign(s) * Math.PI / 2, Math.atan2(-2 * (x * y - w * z), 1 - 2 * (x * x + z * z))]
  return [Math.atan2(a, b), Math.atan2(s, c), Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))]
}

export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

export function quatYaw(q: Quat): number {
  const [x, y, z, w] = q
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
}

export const yawQuat = (yaw: number): Quat => eulerToQuat(0, 0, yaw)

export function quatAngle(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
  return 2 * Math.acos(Math.min(1, d))
}

// v shifted by 2k*pi to the value nearest cur (keeps gizmo read-backs continuous instead of wrapped)
export const nearestAngle = (v: number, cur: number): number => cur + Math.atan2(Math.sin(v - cur), Math.cos(v - cur))
