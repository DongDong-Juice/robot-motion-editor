import { expect, test } from 'vitest'
import { evalCurve, makeKey } from './curve'
import { simplifyCurve, simplifyTolerance } from './simplify'
import type { Curve } from './types'

const dense = (n: number, fn: (f: number) => number): Curve => ({ keys: Array.from({ length: n }, (_, f) => makeKey(f, fn(f), 'linear')) })
const maxErr = (a: Curve, b: Curve) => {
  let m = 0
  const last = a.keys[a.keys.length - 1].f
  for (let f = a.keys[0].f; f <= last; f++) m = Math.max(m, Math.abs(evalCurve(a, f, 0) - evalCurve(b, f, 0)))
  return m
}
const freeze = (c: Curve) => { c.keys.forEach(k => { Object.freeze(k.inTan); Object.freeze(k.outTan); Object.freeze(k) }); Object.freeze(c.keys); return Object.freeze(c) }

test('straight line 1000 keys -> 2', () => {
  const r = simplifyCurve(freeze(dense(1000, f => 0.001 * f)), 0.001)
  expect(r.keys.map(k => k.f)).toEqual([0, 999])
  expect(r.keys.every(k => k.interp === 'linear')).toBe(true)
})

test('sine 600 keys shrinks, error within tol, ends kept', () => {
  const c = freeze(dense(600, f => Math.sin(f / 40)))
  const r = simplifyCurve(c, 0.001)
  expect(r.keys.length).toBeLessThan(300)
  expect(maxErr(c, r)).toBeLessThanOrEqual(0.001)
  expect(r.keys[0].f).toBe(0); expect(r.keys[r.keys.length - 1].f).toBe(599)
})

test('hold and bezier originals stay within tol on samples', () => {
  const hold = freeze({ keys: [0, 20, 40, 60].map(f => makeKey(f, f % 40 ? 1 : 0, 'hold')) })
  expect(maxErr(hold, simplifyCurve(hold, 0.001))).toBeLessThanOrEqual(0.001)
  const bez = freeze({ keys: [makeKey(0, 0), makeKey(30, 1), makeKey(90, -0.5), makeKey(120, 0.2)] })
  expect(maxErr(bez, simplifyCurve(bez, 0.001))).toBeLessThanOrEqual(0.001)
})

test('<=2 keys unchanged; tolerance by channel', () => {
  const c = freeze(dense(2, f => f))
  expect(simplifyCurve(c, 0.001)).toBe(c)
  expect(simplifyCurve({ keys: [] }, 0.001).keys).toEqual([])
  expect(simplifyTolerance('root.x', 1, 2)).toBe(2)
  expect(simplifyTolerance('root.yaw', 1, 2)).toBe(1)
  expect(simplifyTolerance('left_knee_joint', 1, 2)).toBe(1)
})

test('5000 samples is fast', () => {
  const c = dense(5000, f => Math.sin(f / 50) + 0.3 * Math.sin(f / 7))
  const t = performance.now()
  const r = simplifyCurve(c, 0.001)
  expect(performance.now() - t).toBeLessThan(3000)
  expect(maxErr(c, r)).toBeLessThanOrEqual(0.001)
})

test('sparse bezier/hold curve returned as the same object (never grows)', () => {
  const bez = freeze({ keys: [makeKey(0, 0), makeKey(30, 1), makeKey(90, -0.5), makeKey(120, 0.2)] })
  expect(simplifyCurve(bez, 0.001)).toBe(bez)
  const hold = freeze({ keys: [0, 20, 40, 60].map(f => makeKey(f, f % 40 ? 1 : 0, 'hold')) })
  expect(simplifyCurve(hold, 0.001)).toBe(hold)
})
