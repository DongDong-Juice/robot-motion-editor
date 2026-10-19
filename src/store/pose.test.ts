import { loadDef } from '../test/defs'
import { beforeEach, expect, test } from 'vitest'
import type { RobotDefs } from '../model/evaluate'
import { createEditorStore, editTarget, keyOwner } from './store'
import { groundZ } from '../model/bodyPose'

const defs: RobotDefs = { g1: loadDef('g1'), go2: loadDef('go2') }
let st: ReturnType<typeof createEditorStore>
let actor: string
const s = () => st.getState()

beforeEach(() => {
  st = createEditorStore(defs)
  actor = s().project.actors[0].id
})

test('editPose writes several channels as one undo step, even inside an open gesture', () => {
  const before = s().project
  s().beginGesture()
  expect(s().editPose(actor, { 'root.x': 0.3, left_knee_joint: 0.5 })).toBe(true)
  expect(s().editPose(actor, { 'root.x': 0.4 })).toBe(true)
  s().endGesture()
  expect(s().poseAt(actor)!.body.x).toBeCloseTo(0.4)
  s().undo()
  expect(s().project).toBe(before)
})
test('editPose outside a gesture is one undo step', () => {
  const before = s().project
  s().editPose(actor, { 'root.x': 0.3, left_knee_joint: 0.5 })
  expect(s().inGesture).toBe(false)
  s().undo()
  expect(s().project).toBe(before)
})
test('feetLock: small move keeps feet, 1 m move is refused and changes nothing', () => {
  s().setFeetLock(true)
  expect(s().editPose(actor, { 'root.x': s().poseAt(actor)!.body.x + 0.03 })).toBe(true)
  const before = s().project
  expect(s().editPose(actor, { 'root.x': 5 })).toBe(false)
  expect(s().project).toBe(before)
})
test('autoGround: knee bend recomputes root.z so the lowest foot is on the floor', () => {
  s().setAutoGround(true)
  s().editPose(actor, { left_knee_joint: 1.2, right_knee_joint: 1.2 })
  const p = s().poseAt(actor)!
  expect(p.body.z).toBeCloseTo(groundZ(p.def, p.q, p.body), 3)
})
test('standPose: rest joints, zero tilt, rest height, x/y/yaw kept; works over an existing piece edit; one undo', () => {
  s().setValue(actor, 'left_knee_joint', 1)
  s().editPose(actor, { 'root.x': 0.2, 'root.yaw': 0.5, 'root.pitch': 0.1 })
  const before = s().project
  s().standPose(actor)
  const p = s().poseAt(actor)!
  p.def.joints.forEach((_, i) => expect(p.q[i]).toBeCloseTo(p.def.rest.q[i], 4))
  expect(p.body).toMatchObject({ x: expect.closeTo(0.2), yaw: expect.closeTo(0.5), pitch: expect.closeTo(0), roll: expect.closeTo(0), z: expect.closeTo(p.def.rest.z) })
  s().undo(); expect(s().project).toBe(before)
})
test('keyPose keys every root and joint channel at the frame', () => {
  s().setFrame(7)
  s().keyPose(actor)
  const f = editTarget(s(), actor)!.f
  const own = keyOwner(s().project, s().project.sequence.tracks.find(t => t.actorId === actor)!.items[0].id)!
  const names = ['root.x', 'root.y', 'root.z', 'root.roll', 'root.pitch', 'root.yaw', ...defs.g1.joints.map(j => j.name)]
  for (const n of names) expect(own.channels[n]?.keys.some(k => k.f === f), n).toBe(true)
})
