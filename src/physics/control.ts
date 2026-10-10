type Q = [number, number, number, number]
type V3 = [number, number, number]

export function interpRow(rows: Float64Array[], tf: number): { i: number; u: number } {
  const i = Math.min(Math.floor(tf), rows.length - 2)
  return { i, u: tf - i }
}

export function pdTorque(kp: number, kd: number, qRef: number, q: number, dqRef: number, dq: number, lim: number): { tau: number; sat: boolean } {
  const t = kp * (qRef - q) + kd * (dqRef - dq)
  return t > lim ? { tau: lim, sat: true } : t < -lim ? { tau: -lim, sat: true } : { tau: t, sat: false }
}

// rotation vector of conj(q)*qr (wxyz), local frame
export function rotErrLocal(q: Q, qr: Q): V3 {
  const [aw, ax, ay, az] = [q[0], -q[1], -q[2], -q[3]], [bw, bx, by, bz] = qr
  let w = aw * bw - ax * bx - ay * by - az * bz, x = aw * bx + ax * bw + ay * bz - az * by,
    y = aw * by - ax * bz + ay * bw + az * bx, z = aw * bz + ax * by - ay * bx + az * bw
  if (w < 0) { w = -w; x = -x; y = -y; z = -z }
  const s = Math.hypot(x, y, z), k = s > 1e-12 ? 2 * Math.atan2(s, w) / s : 2
  return [x * k, y * k, z * k]
}

export function capNorm(v: V3, max: number): V3 {
  const n = Math.hypot(...v)
  return n > max ? [v[0] * max / n, v[1] * max / n, v[2] * max / n] : v
}

export const pctBW = (f: number, totalMass: number) => f / (totalMass * 9.81) * 100
