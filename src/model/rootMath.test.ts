import { expect, test } from 'vitest'
import { eulerToQuat, nearestAngle, quatAngle, quatToEuler, type Quat } from './rootMath'

test('nearestAngle unwraps to the value closest to current', () => {
  const y = nearestAngle(-2.98, 3.0)
  expect(y).toBeCloseTo(-2.98 + 2 * Math.PI)
  expect(nearestAngle(0.2, 0.1)).toBeCloseTo(0.2)
  expect(nearestAngle(3.1, -3.1)).toBeCloseTo(3.1 - 2 * Math.PI)
  expect(nearestAngle(0.5, 7 * Math.PI)).toBeCloseTo(0.5 + 6 * Math.PI)
})

test('quatToEuler inverts eulerToQuat', () => {
  for (const [r, p, y] of [[0.3, -0.5, 2.0], [-1.2, 0.9, -2.8], [0, 0, 0], [3.0, 0.2, 0.1]]) {
    const q = eulerToQuat(r, p, y)
    const e = quatToEuler(q)
    const q2 = eulerToQuat(...e)
    expect(Math.abs(q.reduce((s, v, i) => s + v * q2[i], 0))).toBeCloseTo(1, 9)
    if (Math.abs(r) < Math.PI) e.forEach((v, i) => expect(v).toBeCloseTo([r, p, y][i], 9))
  }
})

test.each([1.5, Math.PI / 2 - 1e-3, Math.PI / 2 - 1e-6, Math.PI / 2, -Math.PI / 2, -1.5])('quatToEuler preserves rotation at pitch %f', p => {
  const q = eulerToQuat(0.4, p, 0.1)
  expect(quatAngle(eulerToQuat(...quatToEuler(q)), q)).toBeLessThan(1e-6)
  const r6 = q.map(v => Math.round(v * 1e6) / 1e6), n = Math.hypot(...r6) // quatAngle needs a unit quat
  const r = r6.map(v => v / n) as Quat
  expect(quatAngle(eulerToQuat(...quatToEuler(r)), r)).toBeLessThan(1e-5)
})
