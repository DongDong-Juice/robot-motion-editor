import { loadDef } from '../test/defs'
import { expect, test } from 'vitest'

import { newProject } from '../model/defaults'
import { makeKey } from '../model/curve'
import { evaluateClip, type Pose, type RobotDefs } from '../model/evaluate'
import type { Clip } from '../model/types'
import { normalizedPose, posesToCsv, samplePoses } from './csv'
import { csvToClip } from './importCsv'

const load = loadDef
const defs: RobotDefs = { g1: load('g1'), go2: load('go2') }

const poseRows = (clip: Clip): Pose[] => {
  const out: Pose[] = []
  for (let f = 0; f < clip.length; f++) out.push(normalizedPose(evaluateClip(clip, defs[clip.robot], f), out[out.length - 1]))
  return out
}
const expectCsvClose = (a: string, b: string, tol: number) => {
  const ra = a.trimEnd().split('\n'), rb = b.trimEnd().split('\n')
  expect(rb).toHaveLength(ra.length)
  ra.forEach((r, i) => r.split(',').forEach((v, j) => expect(Math.abs(Number(v) - Number(rb[i].split(',')[j]))).toBeLessThan(tol)))
}
const row = (n: number, over: Record<number, number> = {}) =>
  Array.from({ length: n }, (_, i) => (i === 6 ? 1 : over[i] ?? 0)).join(',')

test('roundtrip: export → import → export at 60fps equals', () => {
  const proj = structuredClone(newProject())
  const [g1] = proj.actors
  const item = proj.sequence.tracks.find(t => t.actorId === g1.id)!.items[0]
  const clip = proj.clips[item.refId]
  clip.channels['root.x'] = { keys: [makeKey(0, 0, 'linear'), makeKey(119, 1, 'linear')] }
  clip.channels['root.yaw'] = { keys: [makeKey(0, 0.2, 'bezier'), makeKey(100, 3.5, 'bezier')] }
  clip.channels['root.pitch'] = { keys: [makeKey(0, 0.1, 'hold')] }
  clip.channels['left_elbow_joint'] = { keys: [makeKey(5, 0.3, 'linear'), makeKey(80, 1.1, 'linear')] }
  const csv1 = posesToCsv(samplePoses(proj, defs, g1.id, item.id, 'world'))
  const imp = csvToClip(csv1, defs, 60, 'rt')
  expect(imp.robot).toBe('g1')
  expect(imp.length).toBe(120)
  expectCsvClose(csv1, posesToCsv(poseRows(imp)), 1e-5)
})

test('30fps resampled to 60fps (2N-1 frames, midpoints interpolated)', () => {
  const clip = csvToClip([row(36, { 7: 0 }), row(36, { 7: 1 }), row(36, { 7: 0.5, 0: 2 })].join('\n') + '\n', defs, 30, 'x')
  expect(clip.length).toBe(5)
  const j = defs.g1.joints[0].name
  expect(clip.channels[j].keys.map(k => k.v)).toEqual([0, 0.5, 1, 0.75, 0.5])
  expect(clip.channels['root.x'].keys.map(k => k.v)).toEqual([0, 0, 0, 1, 2])
})

test('yaw beyond π stays continuous after import', () => {
  const rows = [3.0, 3.1, 3.2, 3.3].map(y => {
    const h = y / 2
    return [0, 0, 0, 0, 0, Math.sin(h), Math.cos(h), ...new Array(29).fill(0)].join(',')
  })
  const ks = csvToClip(rows.join('\n'), defs, 60, 'x').channels['root.yaw'].keys.map(k => k.v)
  ks.forEach((v, i) => { if (i) expect(v).toBeGreaterThan(ks[i - 1]) })
  expect(ks[3]).toBeCloseTo(3.3, 6)
})

test('bad column count and non-numeric rejected', () => {
  expect(() => csvToClip('1,2,3\n', defs, 60, 'x')).toThrow('열 수가')
  expect(() => csvToClip(row(36).replace('0', 'abc'), defs, 60, 'x')).toThrow('1행에 숫자가 아닌')
})

test('GO2 detected by 19 columns; blank lines ignored', () => {
  const clip = csvToClip(`\n${row(19)}\n\n${row(19)}\n`, defs, 60, 'g')
  expect(clip.robot).toBe('go2')
  expect(clip.length).toBe(2)
  expect(clip.name).toBe('g')
})

test('rejects hex/Infinity/overflow; column error names the row', () => {
  for (const v of ['0x10', 'Infinity', '1e999']) expect(() => csvToClip(row(36).replace('0', v), defs, 60, 'x')).toThrow('숫자가 아닌')
  expect(() => csvToClip(`${row(36)}

${row(19)}
`, defs, 60, 'x')).toThrow('19 (3행)')
})
