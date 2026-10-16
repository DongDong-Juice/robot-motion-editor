import { expect, test } from 'vitest'
import { addActor, emptyProject } from './defaults'
import { dropPlacement } from './dropPlacement'
import type { Clip, Project } from './types'

const clip = (id: string, robot: 'g1' | 'go2' = 'g1', length = 100): Clip => ({ id, name: id, robot, length, channels: {} })
const item = (refId: string, start: number, len = 100) => ({ id: `i${start}`, refId, start, trimIn: 0, trimOut: len })

// one G1 actor whose track holds clip "a" at 0..100; asset clip "b" (G1, 100) and "g" (GO2)
function proj(): Project {
  const p = addActor(emptyProject(), 'g1', false)
  p.clips = { a: clip('a'), b: clip('b'), g: clip('g', 'go2') }
  p.sequence.tracks[0].items = [item('a', 0)]
  return p
}
const row = (p: Project) => p.sequence.tracks[0].id
const b = { kind: 'clip', id: 'b' } as const

test('rule 1: free frame is used as is', () => {
  const p = proj(); p.sequence.tracks[0].items = [item('a', 0, 50)]
  expect(dropPlacement(p, b, row(p), 300)).toEqual({ kind: 'existing', trackId: row(p), start: 300 })
})
test('rule 1: a drop inside a piece inserts at its nearer edge: front half before it (it and the rest pushed back), back half after it', () => {
  const p = proj() // a at 0..100
  expect(dropPlacement(p, b, row(p), 40)).toEqual({ kind: 'existing', trackId: row(p), start: 0, shift: { ids: ['i0'], by: 100 } })
  expect(dropPlacement(p, b, row(p), 0)).toEqual({ kind: 'existing', trackId: row(p), start: 0, shift: { ids: ['i0'], by: 100 } })
  expect(dropPlacement(p, b, row(p), 70)).toEqual({ kind: 'existing', trackId: row(p), start: 100 })
  p.sequence.tracks[0].items = [item('a', 0), item('a', 100), item('a', 250)] // back half of the first: the two after it move by the clip length
  expect(dropPlacement(p, b, row(p), 80)).toEqual({ kind: 'existing', trackId: row(p), start: 100, shift: { ids: ['i100', 'i250'], by: 100 } })
})
test('rule 1: a drop in a gap too short for the clip stays at the drop frame and pushes the pieces after it just enough', () => {
  const p = proj(); p.sequence.tracks[0].items = [item('a', 0, 50), item('a', 100, 50)] // gap 50..100 is 50 long, clip b is 100
  expect(dropPlacement(p, b, row(p), 50)).toEqual({ kind: 'existing', trackId: row(p), start: 50, shift: { ids: ['i100'], by: 50 } })
  expect(dropPlacement(p, b, row(p), 10)).toEqual({ kind: 'existing', trackId: row(p), start: 0, shift: { ids: ['i0', 'i100'], by: 100 } })
})
test('rule 1: negative frame clamps to 0; locked track rejects', () => {
  const p = proj(); p.sequence.tracks[0].items = []
  expect(dropPlacement(p, b, row(p), -9)).toMatchObject({ start: 0 })
  p.sequence.tracks[0].locked = true
  expect(dropPlacement(p, b, row(p), 5)).toEqual({ kind: 'reject', reason: '잠긴 트랙입니다' })
})
test('rule 2: below the tracks creates a new actor at the frame', () => {
  expect(dropPlacement(proj(), b, null, 250)).toEqual({ kind: 'newActor', robot: 'g1', start: 250 })
})
test('rule 2: empty timeline places at 0', () => {
  expect(dropPlacement({ ...emptyProject(), clips: { b: clip('b') } }, b, null, 250)).toEqual({ kind: 'newActor', robot: 'g1', start: 0 })
})
test('rule 2: another robot\'s track creates a new actor instead of rejecting', () => {
  const p = proj()
  expect(dropPlacement(p, { kind: 'clip', id: 'g' }, row(p), 30)).toEqual({ kind: 'newActor', robot: 'go2', start: 30 })
})
test('rule 3: video from a motion row goes to V1, snapped; V1 missing is fine', () => {
  const p = proj(); p.media = [{ id: 'm', name: 'm', durationF: 60 }]
  expect(dropPlacement(p, { kind: 'media', id: 'm' }, row(p), 20)).toEqual({ kind: 'video', start: 20 })
  p.sequence.tracks.unshift({ id: 'v', kind: 'video', hidden: false, locked: false, items: [{ id: 'x', refId: 'm', start: 0, trimIn: 0, trimOut: 60 }] })
  expect(dropPlacement(p, { kind: 'media', id: 'm' }, row(p), 20)).toEqual({ kind: 'video', start: 60 })
  expect(dropPlacement(p, { kind: 'media', id: 'm' }, 'v', 300)).toEqual({ kind: 'video', start: 300 })
})
