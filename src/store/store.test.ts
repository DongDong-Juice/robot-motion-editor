import { readFileSync } from 'node:fs'
import { beforeEach, expect, test } from 'vitest'
import { loadRobotDef } from '../robot/loadRobot'
import type { RobotKind } from '../robot/types'
import type { RobotDefs } from '../model/evaluate'
import { clipFrameAt, createEditorStore } from './store'

const load = (k: RobotKind) => {
  const r = (f: string) => JSON.parse(readFileSync(new URL(`../../public/robots/${k}/${f}`, import.meta.url), 'utf8'))
  return loadRobotDef(k, r('model.json'), r('meshes.json'))
}
const defs: RobotDefs = { g1: load('g1'), go2: load('go2') }

let st: ReturnType<typeof createEditorStore>
let c: string, actor: string
const s = () => st.getState()
const curve = (ch: string) => s().project.clips[c].channels[ch] ?? { keys: [] }
const keyAt = (ch: string, f: number) => curve(ch).keys.find(k => k.f === f)!
const ch = 'left_knee_joint'

beforeEach(() => {
  st = createEditorStore(defs)
  actor = s().project.actors[0].id
  c = s().project.sequence.tracks.find(t => t.actorId === actor)!.items[0].refId
})

test('setKey clamps to joint limits', () => {
  s().setKey(c, ch, 0, 99)
  expect(keyAt(ch, 0).v).toBeCloseTo(defs.g1.joints.find(j => j.name === ch)!.upper)
})

test('setKey on existing frame replaces value only', () => {
  s().setKey(c, ch, 5, 1)
  s().setInterp(c, [{ channel: ch, f: 5 }], 'hold')
  s().setKey(c, ch, 5, 0.5)
  expect(curve(ch).keys).toHaveLength(1)
  expect(keyAt(ch, 5)).toMatchObject({ v: 0.5, interp: 'hold' })
})

test('setKey rounds/clamps f and keeps sorted', () => {
  s().setKey(c, ch, 50.4, 0); s().setKey(c, ch, -3, 0); s().setKey(c, ch, 999, 0)
  expect(curve(ch).keys.map(k => k.f)).toEqual([0, 50, 119])
})

test('moveKeys onto existing key replaces it', () => {
  s().setKey(c, ch, 0, 1); s().setKey(c, ch, 10, 2)
  s().moveKeys(c, [{ channel: ch, f: 0 }], 10)
  expect(curve(ch).keys.map(k => [k.f, k.v])).toEqual([[10, 1]])
})

test('deleteKeys', () => {
  s().setKey(c, ch, 0, 1); s().setKey(c, ch, 10, 2)
  s().deleteKeys(c, [{ channel: ch, f: 0 }])
  expect(curve(ch).keys.map(k => k.f)).toEqual([10])
})

test('setValue with autoKey off does not create key', () => {
  s().setValue(actor, ch, 1)
  expect(curve(ch).keys).toHaveLength(0)
  expect(s().autoKey).toBe(false)
})

test('setValue with autoKey keys at current clip frame', () => {
  s().toggleAutoKey(); s().setFrame(7); s().setValue(actor, ch, 1)
  expect(keyAt(ch, 7).v).toBe(1)
  expect(clipFrameAt(s().project, actor, 500)).toEqual({ clipId: c, f: 119 })
})

test('undo/redo restores project', () => {
  s().setKey(c, ch, 5, 1); s().undo()
  expect(curve(ch).keys).toHaveLength(0)
  s().redo()
  expect(curve(ch).keys).toHaveLength(1)
})

test('new edit clears redo; undo stack capped at 200', () => {
  s().setKey(c, ch, 5, 1); s().undo(); s().setKey(c, ch, 6, 1); s().redo()
  expect(curve(ch).keys.map(k => k.f)).toEqual([6])
  for (let i = 0; i < 210; i++) s().setKey(c, ch, i % 100, i * 0.001)
  let n = 0
  while (s().project !== undefined && n < 300) { const before = s().project; s().undo(); if (s().project === before) break; n++ }
  expect(n).toBe(200)
})

test('linked tangent mirrors slope', () => {
  s().setKey(c, ch, 5, 0)
  s().setTangent(c, ch, 5, 'out', { df: 10, dv: 2 }, true)
  const k = keyAt(ch, 5)
  expect(k.inTan.dv / k.inTan.df).toBeCloseTo(0.2)
  s().setTangent(c, ch, 5, 'in', { df: -5, dv: 0 }, false)
  expect(keyAt(ch, 5).outTan).toEqual({ df: 10, dv: 2 })
})

test('setInterp ease resets tangents, linear keeps them', () => {
  s().setKey(c, ch, 5, 0)
  s().setTangent(c, ch, 5, 'out', { df: 10, dv: 2 }, false)
  s().setInterp(c, [{ channel: ch, f: 5 }], 'linear')
  expect(keyAt(ch, 5)).toMatchObject({ interp: 'linear', outTan: { df: 10, dv: 2 } })
  s().setInterp(c, [{ channel: ch, f: 5 }], 'bezier')
  expect(keyAt(ch, 5)).toMatchObject({ interp: 'bezier', outTan: { df: 10, dv: 0 }, inTan: { df: -10, dv: 0 } })
})

test('keyGroup keys every joint of group in one undo entry', () => {
  const arm = defs.g1.groups.find(g => g.name === '왼팔')!
  expect(arm.joints).toHaveLength(7)
  s().setFrame(3); s().keyGroup(actor, '왼팔')
  for (const j of arm.joints) expect(keyAt(j, 3)).toBeDefined()
  s().undo()
  expect(Object.keys(s().project.clips[c].channels)).toHaveLength(0)
})

test('keyGroup 루트 keys 6 root channels with standing height', () => {
  s().keyGroup(actor, '루트')
  expect(Object.keys(s().project.clips[c].channels).sort()).toEqual(
    ['root.pitch', 'root.roll', 'root.x', 'root.y', 'root.yaw', 'root.z'])
  expect(keyAt('root.z', 0).v).toBeCloseTo(defs.g1.standingHeight)
})

test('selectKeys additive unions without duplicates', () => {
  s().selectKeys([{ channel: ch, f: 1 }], false)
  s().selectKeys([{ channel: ch, f: 1 }, { channel: ch, f: 2 }], true)
  expect(s().sel.keys).toHaveLength(2)
  s().selectKeys([{ channel: ch, f: 9 }], false)
  expect(s().sel.keys).toEqual([{ channel: ch, f: 9 }])
})

test('setPlacement and addActor are undoable', () => {
  s().setPlacement(actor, { x: 3 })
  expect(s().project.actors[0].placement.x).toBe(3)
  s().addActor('go2'); expect(s().project.actors).toHaveLength(3)
  s().undo(); s().undo()
  expect(s().project.actors[0].placement.x).toBe(0)
})

test('moveKeys clamps shared delta so keys never merge', () => {
  s().setKey(c, ch, 118, 1); s().setKey(c, ch, 119, 2)
  const both = [{ channel: ch, f: 118 }, { channel: ch, f: 119 }]
  s().moveKeys(c, both, 5)
  expect(curve(ch).keys.map(k => [k.f, k.v])).toEqual([[118, 1], [119, 2]])
  s().moveKeys(c, both, -200)
  expect(curve(ch).keys.map(k => [k.f, k.v])).toEqual([[0, 1], [1, 2]])
})

test('deleteKeys prunes selection; undo/redo clear key selection', () => {
  s().setKey(c, ch, 1, 1); s().setKey(c, ch, 2, 1)
  s().selectKeys([{ channel: ch, f: 1 }, { channel: ch, f: 2 }], false)
  s().deleteKeys(c, [{ channel: ch, f: 1 }])
  expect(s().sel.keys).toEqual([{ channel: ch, f: 2 }])
  s().undo(); expect(s().sel.keys).toEqual([])
  s().selectKeys([{ channel: ch, f: 2 }], false); s().redo(); expect(s().sel.keys).toEqual([])
})

test('gesture: many setValue = one undo entry; edits after endGesture push again', () => {
  s().toggleAutoKey()
  const before = s().project
  s().beginGesture()
  for (let i = 1; i <= 5; i++) s().setValue(actor, ch, i * 0.1)
  s().endGesture()
  expect(keyAt(ch, 0).v).toBeCloseTo(0.5)
  s().undo()
  expect(s().project).toBe(before)
  s().redo()
  s().setKey(c, ch, 7, 1)
  s().undo()
  expect(keyAt(ch, 0).v).toBeCloseTo(0.5)
  expect(curve(ch).keys.find(k => k.f === 7)).toBeUndefined()
})

test('empty gesture leaves no undo entry', () => {
  s().setKey(c, ch, 3, 1)
  s().beginGesture(); s().endGesture()
  s().undo()
  expect(curve(ch).keys).toHaveLength(0)
})
