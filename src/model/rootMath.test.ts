import { expect, test } from 'vitest'
import { nearestAngle } from './rootMath'

test('nearestAngle unwraps to the value closest to current', () => {
  const y = nearestAngle(-2.98, 3.0)
  expect(y).toBeCloseTo(-2.98 + 2 * Math.PI)
  expect(nearestAngle(0.2, 0.1)).toBeCloseTo(0.2)
  expect(nearestAngle(3.1, -3.1)).toBeCloseTo(3.1 - 2 * Math.PI)
  expect(nearestAngle(0.5, 7 * Math.PI)).toBeCloseTo(0.5 + 6 * Math.PI)
})
