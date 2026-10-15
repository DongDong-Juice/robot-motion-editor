import { expect, test } from 'vitest'
import { evalCurve, makeKey } from './curve'
import { addOverRange, rangeWeight } from './rangeEdit'
import type { Curve } from './types'

const dense = (n: number, g: (f: number) => number): Curve => ({ keys: Array.from({ length: n }, (_, f) => makeKey(f, g(f), 'linear')) })
const sparse: Curve = { keys: [makeKey(0, 0), makeKey(100, 1)] } // one bezier segment across the whole range

test('rangeWeight: 1 inside, smooth falloff over fade, 0 beyond; fade 0 = hard edges', () => {
  const r = { a: 40, b: 60, fade: 10 }
  expect([39, 40, 50, 60].map(f => rangeWeight(r, f)).slice(1)).toEqual([1, 1, 1])
  expect(rangeWeight(r, 35)).toBeGreaterThan(0); expect(rangeWeight(r, 35)).toBeLessThan(1)
  expect(rangeWeight(r, 29)).toBe(0); expect(rangeWeight(r, 71)).toBe(0)
  expect(rangeWeight(r, 39)).toBeGreaterThan(rangeWeight(r, 31))
  expect(rangeWeight({ a: 40, b: 60, fade: 0 }, 39)).toBe(0)
})

test('addOverRange: same difference inside, eased at the edges, the curve outside untouched (dense and bezier)', () => {
  for (const c of [dense(120, f => Math.sin(f / 9)), sparse]) {
    const r = { a: 40, b: 60, fade: 10 }, out = addOverRange(c, 0, r, 0.3, 120)
    for (const f of [40, 45, 60]) expect(evalCurve(out, f, 0) - evalCurve(c, f, 0)).toBeCloseTo(0.3, 9)
    for (const f of [0, 10, 29, 71, 90, 110]) expect(evalCurve(out, f, 0)).toBeCloseTo(evalCurve(c, f, 0), 7) // (a bezier split is exact to ~1e-9)
    const d35 = evalCurve(out, 35, 0) - evalCurve(c, 35, 0)
    expect(d35).toBeGreaterThan(0); expect(d35).toBeLessThan(0.3)
  }
})

test('addOverRange: empty curve uses the fallback; window clipped at the clip ends; clamp bounds written values', () => {
  const out = addOverRange(undefined, 0, { a: 0, b: 5, fade: 3 }, 0.5, 20)
  expect(evalCurve(out, 0, 0)).toBeCloseTo(0.5, 9)
  expect(evalCurve(out, 15, 0)).toBeCloseTo(0, 9) // outside: still the fallback
  const end = addOverRange(dense(20, () => 1), 0, { a: 15, b: 19, fade: 5 }, 2, 20, v => Math.min(v, 2.5))
  expect(end.keys.at(-1)!.f).toBe(19)
  expect(evalCurve(end, 19, 0)).toBeCloseTo(2.5, 9)
})
