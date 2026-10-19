import { loadDef } from '../test/defs'
import { expect, test } from 'vitest'
import { validatePoses } from '../export/validate'
import { makeKey } from './curve'
import { newProject } from './defaults'
import { evaluate, evaluateItem, type Pose, type RobotDefs } from './evaluate'
import { eulerToQuat, quatAngle, quatMul, quatYaw, yawQuat } from './rootMath'
import { blendPose, hiddenAt, slerp, stitchTransforms, worldToClipRoot } from './sequence'
import type { Curve, Project } from './types'

const g1 = loadDef('g1')
const defs = { g1 } as unknown as RobotDefs
const knee = g1.joints.findIndex(j => j.name === 'left_knee_joint')
const lin = (...kv: [number, number][]): Curve => ({ keys: kv.map(([f, v]) => makeKey(f, v, 'linear')) })

// G1 actor with items [start, trimIn, trimOut, channels]; clip length 120 each.
function build(items: [number, number, number, Record<string, Curve>][]) {
  const p: Project = structuredClone(newProject())
  const actor = p.actors.find(a => a.robot === 'g1')!
  actor.placement = { x: 0, y: 0, yaw: 0 }
  const track = p.sequence.tracks.find(t => t.actorId === actor.id)!
  track.items = items.map(([start, trimIn, trimOut, channels], i) => {
    p.clips[`k${i}`] = { id: `k${i}`, name: `k${i}`, robot: 'g1', length: 120, channels }
    return { id: `i${i}`, refId: `k${i}`, start, trimIn, trimOut }
  })
  return { p, actor: actor.id }
}
const range = (p: Project, a: string, f0: number, f1: number): Pose[] =>
  Array.from({ length: f1 - f0 }, (_, i) => evaluate(p, defs, a, f0 + i))

test('stitch: B starts one frame past where A ended (x, y, yaw)', () => {
  const { p, actor } = build([
    [0, 0, 60, { 'root.x': lin([0, 0], [59, 1]), 'root.yaw': lin([0, 0], [59, Math.PI / 2]) }],
    [60, 0, 60, { 'root.x': lin([0, 0], [59, 1]) }],
  ])
  const a59 = evaluate(p, defs, actor, 59), b60 = evaluate(p, defs, actor, 60)
  expect(Math.hypot(a59.rootPos[0] - b60.rootPos[0], a59.rootPos[1] - b60.rootPos[1])).toBeLessThan(0.02)
  expect(quatYaw(b60.rootQuat)).toBeCloseTo(Math.PI / 2 + Math.PI / 2 / 59, 5)
  const b119 = evaluate(p, defs, actor, 119)
  expect(b119.rootPos[1] - b60.rootPos[1]).toBeCloseTo(1, 1)
})

test('butt seam: root keeps moving across the cut (no 1-frame stall)', () => {
  const { p, actor } = build([
    [0, 0, 60, { 'root.x': lin([0, 0], [59, 0.59]), 'root.yaw': lin([0, 0], [59, 0.59]) }],
    [60, 0, 60, { 'root.x': lin([0, 0], [59, 0.59]) }],
  ])
  const x = (f: number) => evaluate(p, defs, actor, f).rootPos
  const step = (f: number) => Math.hypot(x(f)[0] - x(f - 1)[0], x(f)[1] - x(f - 1)[1])
  expect(step(59)).toBeCloseTo(0.01, 4)
  expect(step(60)).toBeCloseTo(0.01, 4)
  expect(step(61)).toBeCloseTo(0.01, 4)
  const yaw = (f: number) => quatYaw(evaluate(p, defs, actor, f).rootQuat)
  expect(yaw(60) - yaw(59)).toBeCloseTo(0.01, 4) // A's turn rate carries over the cut
})

test('crossfade: weights and continuity', () => {
  const { p, actor } = build([[0, 0, 60, {}], [40, 0, 60, { left_knee_joint: lin([0, 1]) }]])
  const k = (f: number) => evaluate(p, defs, actor, f).q[knee]
  expect(k(39)).toBe(0)
  expect(k(40)).toBeCloseTo(1 / 21)
  expect(k(59)).toBeCloseTo(20 / 21)
  expect(k(60)).toBe(1)
})

test('crossfade seam has no root jump', () => {
  const { p, actor } = build([
    [0, 0, 60, { 'root.x': lin([0, 0], [59, 0.5]) }],
    [40, 0, 60, { 'root.x': lin([0, 3], [59, 3.5]) }],
  ])
  expect(validatePoses(range(p, actor, 0, 100), g1, 0).filter(x => x.kind === 'rootJump')).toEqual([])
})

test('stitch uses previous item alone, clamped; stitchTransforms is cached', () => {
  const { p, actor } = build([[0, 0, 60, { 'root.x': lin([0, 0], [59, 1]) }], [30, 0, 60, { 'root.x': lin([0, 0], [59, 1]) }]])
  const track = p.sequence.tracks.find(t => t.actorId === actor)!
  const xf = stitchTransforms(p, defs, track)
  expect(xf.get('i1')!.x).toBeCloseTo(30 / 59) // A at clip frame 30, not blended
  expect(stitchTransforms(p, defs, track)).toBe(xf)
})

test('slerp endpoints and midpoint', () => {
  const a = eulerToQuat(0, 0, 0), b = eulerToQuat(0, 0, Math.PI / 2)
  expect(quatYaw(slerp(a, b, 0))).toBeCloseTo(0)
  expect(quatYaw(slerp(a, b, 1))).toBeCloseTo(Math.PI / 2)
  expect(quatYaw(slerp(a, b, 0.5))).toBeCloseTo(Math.PI / 4)
  expect(quatYaw(slerp(a, b.map(v => -v) as typeof b, 0.5))).toBeCloseTo(Math.PI / 4) // shortest path
})

test('blendPose lerps pos and q', () => {
  const a: Pose = { rootPos: [0, 0, 1], rootQuat: [0, 0, 0, 1], q: [0] }
  const b: Pose = { rootPos: [2, 4, 1], rootQuat: [0, 0, 0, 1], q: [1] }
  const m = blendPose(a, b, 0.5)
  expect(m.rootPos).toEqual([1, 2, 1])
  expect(m.q).toEqual([0.5])
})

test('evaluateItem ignores trims (clip frame outside trim)', () => {
  const { p } = build([[0, 30, 60, { 'root.x': lin([0, 0], [119, 119]) }]])
  expect(evaluateItem(p, defs, 'i0', 0).rootPos[0]).toBeCloseTo(0)
  expect(evaluateItem(p, defs, 'i0', 500).rootPos[0]).toBeCloseTo(119)
})

test('stitch with nonzero clip-start root: xy/yaw continuous, z/roll/pitch preserved', () => {
  const b = {
    'root.x': lin([0, 0.4], [59, 1.4]), 'root.y': lin([0, -0.3], [59, -0.3]), 'root.yaw': lin([0, 0.7], [59, 0.7]),
    'root.z': lin([0, 0.5], [59, 0.5]), 'root.roll': lin([0, 0.1], [59, 0.1]), 'root.pitch': lin([0, 0.2], [59, 0.2]),
  }
  const { p, actor } = build([
    [0, 0, 60, { 'root.x': lin([0, 0], [59, 1]), 'root.yaw': lin([0, 0], [59, Math.PI / 2]) }],
    [60, 0, 60, b],
  ])
  const a0 = evaluate(p, defs, actor, 58), a = evaluate(p, defs, actor, 59), s = evaluate(p, defs, actor, 60)
  expect(s.rootPos[0]).toBeCloseTo(2 * a.rootPos[0] - a0.rootPos[0], 5) // one more frame at A's velocity
  expect(s.rootPos[1]).toBeCloseTo(2 * a.rootPos[1] - a0.rootPos[1], 5)
  expect(quatYaw(s.rootQuat)).toBeCloseTo(2 * quatYaw(a.rootQuat) - quatYaw(a0.rootQuat), 5)
  expect(s.rootPos[2]).toBeCloseTo(0.5, 5)
  // roll/pitch survive: Rz(yaw)^-1 * q == clip's own roll/pitch/yaw=0.7 quat after removing stitch yaw
  const own = eulerToQuat(0.1, 0.2, 0.7)
  const yaw = quatYaw(s.rootQuat) - 0.7
  expect(quatAngle(s.rootQuat, quatMul(yawQuat(yaw), own))).toBeCloseTo(0, 5)
})

test('worldToClipRoot inverts evaluateItem (placement + stitch)', () => {
  const { p, actor } = build([
    [0, 0, 60, { 'root.x': lin([0, 0], [59, 1]), 'root.yaw': lin([0, 0], [59, 1]) }],
    [60, 0, 60, { 'root.x': lin([0, 0.3], [59, 0.8]), 'root.y': lin([0, 0.2]), 'root.z': lin([0, 0.7]), 'root.roll': lin([0, 0.1]), 'root.pitch': lin([0, -0.2]), 'root.yaw': lin([0, 0.5]) }],
  ])
  p.actors.find(a => a.id === actor)!.placement = { x: 1, y: -2, yaw: 0.7 }
  const track = p.sequence.tracks.find(t => t.actorId === actor)!
  const xf = stitchTransforms(p, defs, track).get('i1')!
  expect(Math.hypot(xf.x, xf.y)).toBeGreaterThan(0.5)
  const w = evaluateItem(p, defs, 'i1', 30)
  const r = worldToClipRoot({ pos: w.rootPos, quat: w.rootQuat }, p.actors[0].placement, xf)
  expect(r.x).toBeCloseTo(0.3 + 0.5 * 30 / 59, 5); expect(r.y).toBeCloseTo(0.2, 5); expect(r.z).toBeCloseTo(0.7, 5)
  expect(r.roll).toBeCloseTo(0.1, 5); expect(r.pitch).toBeCloseTo(-0.2, 5); expect(r.yaw).toBeCloseTo(0.5, 5)
})

test('hiddenAt: the piece under the playhead; a crossfade only when both are hidden; a gap holds the piece before', () => {
  const it = (id: string, start: number, len: number, hidden?: true) => ({ id, refId: 'c', start, trimIn: 0, trimOut: len, ...(hidden ? { hidden } : {}) })
  const track = (...items: ReturnType<typeof it>[]) => ({ id: 't', kind: 'motion' as const, actorId: 'a', hidden: false, locked: false, items })
  const t = track(it('a', 0, 60), it('b', 50, 60, true), it('c', 200, 30))
  expect([0, 49, 55, 60, 109, 150, 199, 200, 300].map(f => hiddenAt(t, f))).toEqual([false, false, false, true, true, true, true, false, false])
  expect(hiddenAt(track(it('a', 0, 60, true), it('b', 50, 60, true)), 55)).toBe(true)
  expect(hiddenAt(track(), 10)).toBe(false)
})

test('pieceTag: cut pieces of one clip are numbered by start with their clip frames; a lone item has none', async () => {
  const { pieceTag, pieceName } = await import('./sequence')
  const t = { id: 't', kind: 'motion' as const, hidden: false, locked: false, items: [
    { id: 'b', refId: 'c', start: 100, trimIn: 100, trimOut: 250 },
    { id: 'a', refId: 'c', start: 0, trimIn: 0, trimOut: 100 },
    { id: 'x', refId: 'other', start: 300, trimIn: 0, trimOut: 50 },
  ] }
  expect(pieceTag(t, t.items[1])).toBe('#1 · F0–100')
  expect(pieceTag(t, t.items[0])).toBe('#2 · F100–250')
  expect(pieceTag(t, t.items[2])).toBe('')
  expect(pieceName(t, t.items[0], { name: 'Track2', robot: 'g1' }, 'proj')).toBe('proj-G1-2')
  expect(pieceName(t, t.items[1], { name: 'Track2', robot: 'go2' }, 'proj')).toBe('proj-GO2-1')
  expect(pieceName(t, t.items[2], { name: 'Other', robot: 'g1' }, 'proj')).toBe('Other')
  const { projectTitle } = await import('./sequence')
  expect(projectTitle('dance.motion.json')).toBe('dance')
  expect(projectTitle('dance.mproj')).toBe('dance')
  expect(projectTitle(null)).toBe('Untitled')
})
