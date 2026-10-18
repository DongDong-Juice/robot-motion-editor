import { expect, test } from 'vitest'
import { badge, graphCols, pctY, segmentAt, seqFrameOf, treeSuffix, treeTag } from './physGraph'
import type { ItemPhys } from '../physics/physicsStore'
import type { Metrics } from '../physics/sim'
import { loadDef } from '../test/defs'
import type { Project } from '../model/types'

const item = { id: 'i', refId: 'c', start: 100, trimIn: 30, trimOut: 90 }
const metrics = (o: Partial<Metrics>) => ({ meanPct: 31.4, maxPct: 86.6, segments: [], ...o }) as unknown as Metrics
const done = (o: Partial<Metrics> = {}): ItemPhys => ({ key: 'k', status: 'done', metrics: metrics(o) })

test('pctY clamps to 0..100 within the strip', () => {
  expect(pctY(0, 10, 20)).toBe(30)
  expect(pctY(100, 10, 20)).toBe(10)
  expect(pctY(250, 10, 20)).toBe(10)
  expect(pctY(-5, 10, 20)).toBe(30)
  expect(pctY(50, 10, 20)).toBe(20)
})

test('graphCols maps CSV frame k to timeline frame f0+k, one point per frame when zoomed in', () => {
  const sc = { x0: 0, pxPerFrame: 2 }
  expect(graphCols([1, 2, 3], 10, sc, 0, 1000)).toEqual([[20, 1], [22, 2], [24, 3]])
  expect(graphCols([1, 2, 3], 10, sc, 21, 23)).toEqual([[22, 2]]) // only frames in [xa, xb]
})

test('graphCols keeps the max per pixel column when zoomed out', () => {
  const sc = { x0: 0, pxPerFrame: 0.5 }
  expect(graphCols([1, 9, 3, 4], 0, sc, 0, 100)).toEqual([[0, 9], [1, 4]])
})

test('segmentAt finds the segment holding CSV frame k (inclusive)', () => {
  const segs = [{ from: 5, to: 9, maxPct: 60, maxTorque: 1 }, { from: 20, to: 25, maxPct: 70, maxTorque: 1 }]
  expect(segmentAt(segs, 4)).toBeNull()
  expect(segmentAt(segs, 5)).toBe(segs[0])
  expect(segmentAt(segs, 9)).toBe(segs[0])
  expect(segmentAt(segs, 22)).toBe(segs[1])
})

const defs = { g1: loadDef('g1'), go2: loadDef('go2') } // parsed once per file, outside any test's timeout (a full parallel run can take >20 s per parse)

test('seqFrameOf: CSV frame 0 is itemFrameRange(item).from (= item.start, rest pose or not)', () => {
  const p = { clips: { c: { id: 'c', name: 'c', robot: 'g1', length: 200, channels: {} } } } as unknown as Project
  const at = (it: object, k: number) => seqFrameOf(p, defs, { ...item, ...it }, k)
  expect(at({}, 0)).toBe(100)
  expect(at({}, 12)).toBe(112)
  expect(at({ restPose: true }, 12)).toBe(112)
  expect(at({ restPose: 'prepend', inertia: 0 }, 90)).toBe(100) // 기본자세 덧붙이기: 정지 30 + 전이 60 CSV rows before the item
  expect(at({ restPose: 'prepend', inertia: 0 }, 0)).toBe(10)
  expect(at({ restPose: 'prepend', restHold: 12, restBlend: 30, inertia: 20 }, 62)).toBe(100) // + 관성 rows
})

test('badge text', () => {
  expect(badge(undefined, false)).toBeNull()
  expect(badge({ key: 'k', status: 'running' }, false)).toBeNull()
  expect(badge({ key: 'k', status: 'error', message: '미지원' }, false)).toBe('미지원')
  expect(badge(done(), true)).toBe('오래됨')
  expect(badge(done(), false)).toBe('✓ 평균 31% · 최대 87%')
  expect(badge(done({ segments: [{}, {}, {}] as Metrics['segments'] }), false)).toBe('⚠ 3')
})

test('tree suffix', () => {
  expect(treeTag(undefined, false)).toEqual({ text: '', warn: false })
  expect(treeTag(done(), false)).toEqual({ text: '87%', warn: false })
  expect(treeTag(done({ segments: [{}, {}, {}] as Metrics['segments'] }), false)).toEqual({ text: '⚠3', warn: true })
  expect(treeTag(done(), true)).toEqual({ text: '오래됨', warn: false })
  expect(treeSuffix(undefined, false)).toBe('')
  expect(treeSuffix(done(), false)).toBe(' · 최대 87%')
  expect(treeSuffix(done({ segments: [{}, {}, {}] as Metrics['segments'] }), false)).toBe(' · 최대 87% ⚠3')
  expect(treeSuffix(done(), true)).toBe(' · 오래됨')
  expect(treeSuffix({ key: 'k', status: 'error', message: '미지원' }, false)).toBe(' · 미지원')
})
