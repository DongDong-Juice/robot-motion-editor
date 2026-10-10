import { expect, test } from 'vitest'
import { warnSegments } from './segments'

const mk = (on: number[], n = 40) => { const p = new Float32Array(n); on.forEach(i => (p[i] = 60)); return p }
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

test('drops runs shorter than 3, keeps 3', () => {
  expect(warnSegments(mk(range(5, 6)), new Float32Array(40), 50)).toEqual([])
  expect(warnSegments(mk(range(5, 7)), new Float32Array(40), 50)).toHaveLength(1)
})
test('gap 6 merges, gap 7 splits', () => {
  expect(warnSegments(mk([...range(2, 4), ...range(11, 13)]), new Float32Array(40), 50)).toHaveLength(1)
  expect(warnSegments(mk([...range(2, 4), ...range(12, 14)]), new Float32Array(40), 50)).toHaveLength(2)
})
test('merge before drop: short runs bridged by small gap survive', () => {
  expect(warnSegments(mk([2, 3, 6, 7]), new Float32Array(40), 50)).toEqual([{ from: 2, to: 7, maxPct: 60, maxTorque: 0 }])
})
test('maxPct / maxTorque', () => {
  const p = mk(range(3, 6)); p[4] = 90
  const t = new Float32Array(40); t[5] = 12
  expect(warnSegments(p, t, 50)).toEqual([{ from: 3, to: 6, maxPct: 90, maxTorque: 12 }])
})
