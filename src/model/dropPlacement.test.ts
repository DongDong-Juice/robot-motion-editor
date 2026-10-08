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
test('rule 1: snaps right after the overlapped item', () => {
  const p = proj()
  expect(dropPlacement(p, b, row(p), 0)).toEqual({ kind: 'existing', trackId: row(p), start: 100 })
})
test('rule 1: falls back to the end of the track', () => {
  const p = proj(); p.sequence.tracks[0].items = [item('a', 0), item('a', 100)] // a drop at 40 snaps to 100 which is taken
  expect(dropPlacement(p, b, row(p), 0)).toEqual({ kind: 'existing', trackId: row(p), start: 200 })
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
