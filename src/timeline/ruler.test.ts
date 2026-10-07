import { expect, test } from 'vitest'
import type { Sequence } from '../model/types'
import { hitMarker, tickStep } from './ruler'

test('tickStep keeps labels >= 60px', () => {
  for (const ppf of [0.5, 1, 4, 16, 40]) expect(tickStep(ppf).major * ppf).toBeGreaterThanOrEqual(60)
})

test('hitMarker within 4px', () => {
  const seq: Sequence = { tracks: [], markers: [{ f: 10, name: 'a' }, { f: 30, name: 'b' }], inF: null, outF: null }
  const sc = { x0: 160, pxPerFrame: 4 }
  expect(hitMarker(seq, sc, 160 + 120 + 3)).toBe(1)
  expect(hitMarker(seq, sc, 160 + 120 - 4)).toBe(1)
  expect(hitMarker(seq, sc, 160 + 120 + 6)).toBeNull()
  expect(hitMarker(seq, sc, 160 + 40)).toBe(0)
})
