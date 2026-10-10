import { expect, test } from 'vitest'
import { capNorm, interpRow, pctBW, pdTorque, rotErrLocal } from './control'

test('pdTorque: unsaturated / clipped with sat flag', () => {
  expect(pdTorque(10, 1, 1, 0, 0, 0, 100)).toEqual({ tau: 10, sat: false })
  expect(pdTorque(10, 1, 1, 0, 0, 0, 5)).toEqual({ tau: 5, sat: true })
  expect(pdTorque(10, 1, -1, 0, 0, 0, 5)).toEqual({ tau: -5, sat: true })
  expect(pdTorque(10, 2, 0, 0, 1, 0.5, 100).tau).toBe(1)
})
test('rotErrLocal', () => {
  const I: [number, number, number, number] = [1, 0, 0, 0]
  expect(rotErrLocal(I, I)).toEqual([0, 0, 0])
  const h = Math.SQRT1_2
  const e = rotErrLocal(I, [h, 0, 0, h])
  expect(e[0]).toBeCloseTo(0); expect(e[2]).toBeCloseTo(Math.PI / 2)
  const f = rotErrLocal(I, [-h, 0, 0, -h])
  f.forEach((v, i) => expect(v).toBeCloseTo(e[i]))
})
test('capNorm', () => {
  expect(capNorm([3, 4, 0], 10)).toEqual([3, 4, 0])
  const c = capNorm([3, 4, 0], 2.5)
  expect(c[0]).toBeCloseTo(1.5); expect(c[1]).toBeCloseTo(2)
})
test('interpRow boundary', () => {
  const rows = [new Float64Array(1), new Float64Array(1), new Float64Array(1)]
  expect(interpRow(rows, 0.25)).toEqual({ i: 0, u: 0.25 })
  expect(interpRow(rows, 2)).toEqual({ i: 1, u: 1 })
})
test('pctBW', () => expect(pctBW(33.34 * 9.81 * 0.5, 33.34)).toBeCloseTo(50))
