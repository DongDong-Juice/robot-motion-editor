import { expect, test } from 'vitest'
import { makeKey } from '../model/curve'
import { fitView, handlePoints, velocityViolations } from './graph'

test('velocityViolations detects steep segment', () => {
  const c = { keys: [makeKey(0, 0, 'linear'), makeKey(2, 2)] }
  expect(velocityViolations(c, 32, 0, 10)).toEqual([{ from: 0, to: 2 }])
})
test('no violation for slow curve', () =>
  expect(velocityViolations({ keys: [makeKey(0, 0, 'linear'), makeKey(60, 1)] }, 32, 0, 60)).toEqual([]))
test('fitView includes limits', () => {
  const vs = fitView([{ keys: [makeKey(0, 0)] }], [{ lower: -1, upper: 2 }], 0, 60, 300)
  expect(vs.y0 - 2 * vs.pxPerUnit).toBeGreaterThanOrEqual(0)
  expect(vs.y0 + 1 * vs.pxPerUnit).toBeLessThanOrEqual(300)
})
test('handlePoints maps tangents to pixels', () => {
  const k = { ...makeKey(10, 1), outTan: { df: 5, dv: 0.5 }, inTan: { df: -4, dv: 0 } }
  const h = handlePoints(k, { x0: 0, pxPerFrame: 2 }, { y0: 100, pxPerUnit: 10 })
  expect(h.out).toEqual([30, 85])
  expect(h.in).toEqual([12, 90])
})
