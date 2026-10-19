import { expect, test } from 'vitest'
import { loadDef } from '../test/defs'
import { makeKey } from './curve'
import { newProject } from './defaults'
import { evaluate, type RobotDefs } from './evaluate'
import { itemClip, itemSeam } from './itemClip'
import { SEAM_DEFAULT } from './seam'
import { createEditorStore } from '../store/store'
import type { Clip } from './types'

const defs: RobotDefs = { g1: loadDef('g1'), go2: loadDef('go2') }
// a clip holding one pose: joint values from `q` (others 차렷), pelvis height z
const still = (id: string, robot: 'g1' | 'go2', len: number, q: Record<number, number>, z: number): Clip => {
  const d = defs[robot]
  return { id, name: id, robot, length: len, channels: Object.fromEntries([['root.z', { keys: [makeKey(0, z, 'linear')] }],
    ...d.joints.map((j, i) => [j.name, { keys: [makeKey(0, q[i] ?? d.rest.q[i], 'linear')] }])]) }
}
function chain(robot: 'g1' | 'go2', gap = 0) {
  const st = createEditorStore(defs, newProject()), s = () => st.getState()
  const a = still('a', robot, 60, { 7: 0.72, 10: 0.72 }, 0.33), b = still('b', robot, 80, {}, 0.36) // the log's rear thighs vs 차렷 1.0
  const ia = s().appendClip(null, a)!, actor = s().project.actors.at(-1)!.id, ib = s().appendClip(actor, b)!
  if (gap) s().moveItem(ib, 60 + gap)
  const item = (id: string) => s().project.sequence.tracks.flatMap(t => t.items).find(i => i.id === id)!
  return { s, actor, ia, ib, item }
}
const rearThigh = (robot: 'g1' | 'go2', s: () => { project: any }, actor: string, f: number) => evaluate(s().project, defs, actor, f).q[robot === 'go2' ? 7 : 0]

test('GO2 seam: the piece after another starts where it ended and eases back to its own pose over 20 frames', () => {
  const { s, actor, ib, item } = chain('go2')
  expect(itemSeam(s().project, defs, item(ib))).toMatchObject({ n: SEAM_DEFAULT, warn: false })
  const q = (f: number) => rearThigh('go2', s, actor, f), z = (f: number) => evaluate(s().project, defs, actor, f).rootPos[2]
  expect(q(59)).toBeCloseTo(0.72, 6)
  expect(q(60)).toBeCloseTo(0.72, 6) // no pop: was 1.0 (17°)
  expect(z(60)).toBeCloseTo(0.33, 6)
  for (let f = 60; f < 80; f++) expect(Math.abs(q(f + 1) - q(f))).toBeLessThan(0.03) // eased
  for (let f = 80; f < 140; f++) expect(q(f)).toBeCloseTo(1.0, 9) // the block's own frames after the seam
  expect(itemClip(s().project, defs, item(ib))).toBe(itemClip(s().project, defs, item(ib))) // cached per project
})

test('GO2 seam length: setRestLead seam (0 = off), one undo; a gap or G1 has no seam', () => {
  const { s, actor, ib } = chain('go2')
  expect(s().setRestLead(ib, { seam: 40 })).toBe(true)
  expect(rearThigh('go2', s, actor, 80)).not.toBeCloseTo(1.0, 3)
  expect(rearThigh('go2', s, actor, 100)).toBeCloseTo(1.0, 9)
  expect(s().setRestLead(ib, { seam: 0 })).toBe(true)
  expect(rearThigh('go2', s, actor, 60)).toBeCloseTo(1.0, 9)
  s().undo(); expect(rearThigh('go2', s, actor, 80)).not.toBeCloseTo(1.0, 3)
  const g = chain('go2', 10)
  expect(itemSeam(g.s().project, defs, g.item(g.ib))).toBeNull()
  const h = chain('g1')
  expect(itemSeam(h.s().project, defs, h.item(h.ib))).toBeNull()
})

test('GO2 seam warns when the gap is too big to look natural (sitting end → standing)', () => {
  const st = createEditorStore(defs, newProject()), s = () => st.getState()
  s().appendClip(null, still('sit', 'go2', 60, { 7: 2.0, 10: 2.0, 8: -2.8, 11: -2.8 }, 0.25))
  const ib = s().appendClip(s().project.actors.at(-1)!.id, still('stand', 'go2', 60, {}, 0.33))!
  expect(itemSeam(s().project, defs, s().project.sequence.tracks.flatMap(t => t.items).find(i => i.id === ib)!)?.warn).toBe(true)
})
