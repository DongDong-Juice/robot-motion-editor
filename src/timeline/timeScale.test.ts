import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { loadRobotDef } from '../robot/loadRobot'
import type { RobotKind } from '../robot/types'
import type { RobotDefs } from '../model/evaluate'
import { newProject } from '../model/defaults'
import { makeKey } from '../model/curve'
import { buildRows, formatTimecode, frameToX, hitKey, keysIn, rowKey, xToFrame } from './timeScale'

const load = (k: RobotKind) => {
  const r = (f: string) => JSON.parse(readFileSync(new URL(`../../public/robots/${k}/${f}`, import.meta.url), 'utf8'))
  return loadRobotDef(k, r('model.json'), r('meshes.json'))
}
const defs: RobotDefs = { g1: load('g1'), go2: load('go2') }
const g1Only = () => { const p = newProject(); return { ...p, actors: [p.actors[0]] } }

test('frame<->x roundtrip', () => {
  const s = { x0: 160, pxPerFrame: 4 }
  expect(xToFrame(s, frameToX(s, 37))).toBe(37)
})

test('timecode', () => {
  expect(formatTimecode(0)).toBe('00:00.00')
  expect(formatTimecode(61)).toBe('00:01.01')
  expect(formatTimecode(3600)).toBe('01:00.00')
  expect(formatTimecode(-61)).toBe('-00:01.01')
})

test('rows: g1 = actor + root + 5 groups collapsed', () => {
  expect(buildRows(g1Only(), defs, new Set()).map(r => r.label))
    .toEqual(['G1 #1', '루트', '왼다리', '오른다리', '허리', '왼팔', '오른팔'])
})

test('rows: expanded root adds 6 channel rows', () => {
  const p = g1Only()
  const rows = buildRows(p, defs, new Set([rowKey(p.actors[0].id, '루트')]))
  expect(rows).toHaveLength(7 + 6)
  expect(rows[2]).toMatchObject({ kind: 'channel', channels: ['root.x'] })
})

test('hitKey finds key within 4px', () => {
  const p = g1Only()
  const clip = Object.values(p.clips)[0]
  clip.channels['root.x'] = { keys: [makeKey(10, 0)] }
  const rows = buildRows(p, defs, new Set([rowKey(p.actors[0].id, '루트')]))
  const s = { x0: 160, pxPerFrame: 4 }, H = 20
  const x = frameToX(s, 10)
  expect(hitKey(rows, clip, s, H, x + 3, 2 * H + 10)).toEqual([{ channel: 'root.x', f: 10 }])
  expect(hitKey(rows, clip, s, H, x + 6, 2 * H + 10)).toBeNull()
  // collapsed group row summarises
  expect(hitKey(rows, clip, s, H, x, 1 * H + 10)).toEqual([{ channel: 'root.x', f: 10 }])
})

test('keysIn returns sorted keys with lo <= f <= hi', () => {
  const ks = [0, 3, 5, 9, 12].map(f => makeKey(f, 0))
  expect(keysIn(ks, 4, 9).map(k => k.f)).toEqual([5, 9])
  expect(keysIn(ks, -5, 0).map(k => k.f)).toEqual([0])
  expect(keysIn(ks, 13, 20)).toEqual([])
  expect(keysIn([], 0, 9)).toEqual([])
})
