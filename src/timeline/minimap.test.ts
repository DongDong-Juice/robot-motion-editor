import { expect, test } from 'vitest'
import { mmDrag, mmFit, mmGeom, mmHit, mmX } from './minimap'

// track area 100..500 px (400 px), sequence end 300 frames, 2 px per frame → 200 frames visible
const g = mmGeom(100, 500, 300, 0, 2)

test('the strip spans the sequence plus half a screen; frames map linearly onto it', () => {
  expect(g.total).toBe(400) // 300 + 200 / 2
  expect(g.vis).toBe(200)
  expect(mmX(g, 0)).toBe(100)
  expect(mmX(g, 400)).toBe(500)
  expect(mmX(g, 200)).toBe(300)
})

test('hits: the window edges resize, inside moves, anything else is outside', () => {
  // window = frames 0..200 → x 100..300
  expect(mmHit(g, 0, 101)).toBe('left')
  expect(mmHit(g, 0, 298)).toBe('right')
  expect(mmHit(g, 0, 200)).toBe('move')
  expect(mmHit(g, 0, 400)).toBe('outside')
})

test('drag: move keeps the width; an edge keeps the other edge fixed; limits hold', () => {
  const at = { scrollF: 0, vis: 200 }
  expect(mmDrag(g, at, 'move', 100)).toEqual({ scrollF: 100, vis: 200 }) // 100 px = 100 frames on this strip
  expect(mmDrag(g, at, 'move', -50)).toEqual({ scrollF: 0, vis: 200 }) // never before 0
  expect(mmDrag(g, at, 'move', 1000)).toEqual({ scrollF: 200, vis: 200 }) // never past the strip's end
  expect(mmDrag(g, at, 'right', -100)).toEqual({ scrollF: 0, vis: 100 }) // zoom in, the left edge stays
  const l = mmDrag(g, { scrollF: 100, vis: 200 }, 'left', 50) // zoom in from the left, the right edge (300) stays
  expect(l.scrollF + l.vis).toBe(300)
  expect(l.scrollF).toBe(150)
  // ppf limits 0.5..40 over a 400 px view: 10..800 frames
  expect(mmDrag(g, at, 'right', -1000).vis).toBe(10)
  expect(mmDrag(g, at, 'right', 5000).vis).toBe(800)
})

test('fit: the whole sequence in view from frame 0', () => {
  expect(mmFit(400, 300)).toEqual({ scrollF: 0, ppf: 400 / 300 })
  expect(mmFit(400, 0).ppf).toBe(40) // an empty sequence: the zoom limit
})
