import { expect, test } from 'vitest'
import { eulerToQuat, nearestAngle, quatToEuler } from './rootMath'

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
