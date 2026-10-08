import { loadDef } from '../test/defs'
import { expect, test } from 'vitest'
import { makeKey } from './curve'
import { newProject } from './defaults'
import { evaluate, evaluateClip, evaluateItem, type RobotDefs } from './evaluate'
import { eulerToQuat, quatAngle, quatYaw } from './rootMath'
import { rebasePose } from './pose'
import { REST_HOLD, REST_LEN, restPoseClip } from './restPose'
import { createEditorStore } from '../store/store'
import type { Clip, Curve, Project } from './types'

const g1 = loadDef('g1')
const defs: RobotDefs = { g1, go2: loadDef('go2') }
const knee = 'left_knee_joint', ki = g1.joints.findIndex(j => j.name === knee)
const lin = (...kv: [number, number][]): Curve => ({ keys: kv.map(([f, v]) => makeKey(f, v, 'linear')) })

test('restPoseClip: hold at zero/standing, ease into the first pose, x/y/yaw pinned', () => {
  const first = evaluateClip({ id: 'c', name: 'c', robot: 'g1', length: 1, channels: {
    'root.x': lin([0, 1.5]), 'root.y': lin([0, -2]), 'root.z': lin([0, 0.6]), 'root.roll': lin([0, 0.1]), 'root.pitch': lin([0, -0.2]), 'root.yaw': lin([0, 2]),
    [knee]: lin([0, 0.8]),
  } }, g1, 0)
  const c = restPoseClip(g1, first, 'walk_기본자세')
  expect(c).toMatchObject({ name: 'walk_기본자세', robot: 'g1', length: REST_LEN })
  expect(REST_LEN).toBe(90)
  const at = (f: number) => evaluateClip(c, g1, f)
  for (const f of [0, REST_HOLD]) {
    expect(at(f).q.every(v => Math.abs(v) < 1e-6)).toBe(true) // exact at 0; HOLD is the bezier start (bisection-evaluated)
    expect(at(f).rootPos[2]).toBeCloseTo(g1.standingHeight, 6)
    expect(quatAngle(at(f).rootQuat, eulerToQuat(0, 0, 2))).toBeLessThan(1e-6)
  }
  const end = at(REST_LEN - 1)
  expect(end.q[ki]).toBeCloseTo(0.8, 12)
  expect(end.rootPos.map(v => +v.toFixed(9))).toEqual([1.5, -2, 0.6])
  expect(quatAngle(end.rootQuat, first.rootQuat)).toBeLessThan(1e-6)
  for (const f of [0, 45, 89]) expect([at(f).rootPos[0], at(f).rootPos[1]].map(v => +v.toFixed(9))).toEqual([1.5, -2])
  const mid = at(60).q[ki] // eases monotonically in between
  expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(0.8)
})

test('rebasePose: the origin pose lands at (0,0,z) facing yaw 0', () => {
  const o = { rootPos: [1, 2, 0.7] as [number, number, number], rootQuat: eulerToQuat(0.1, 0, 1), q: [] }
  const r = rebasePose(o, o)
  expect(r.rootPos.map(v => +v.toFixed(12))).toEqual([0, 0, 0.7])
  expect(quatYaw(r.rootQuat)).toBeCloseTo(0, 12)
  const p = rebasePose({ ...o, rootPos: [1 + Math.cos(1), 2 + Math.sin(1), 0.5] }, o) // 1 m ahead along the origin heading
  expect(p.rootPos.map(v => +v.toFixed(12))).toEqual([1, 0, 0.5])
})

// G1 track with items [start, trimIn, trimOut]; clip k<i> has moving root and a knee ramp
function setup(items: [number, number, number][]) {
  const p: Project = structuredClone(newProject())
  const actor = p.actors.find(a => a.robot === 'g1')!
  const track = p.sequence.tracks.find(t => t.actorId === actor.id)!
  track.items = items.map(([start, trimIn, trimOut], i) => {
    const clip: Clip = { id: `k${i}`, name: `k${i}`, robot: 'g1', length: 120, channels: {
      'root.x': lin([0, 0], [119, 1 + i]), 'root.y': lin([0, 0.3 * i], [119, 0.5]), 'root.yaw': lin([0, 0.4 * i], [119, 1.2]),
      'root.z': lin([0, 0.7], [119, 0.6]), 'root.pitch': lin([0, 0.05], [119, 0.1]), [knee]: lin([0, 0.2], [119, 1]),
    } }
    p.clips[clip.id] = clip
    return { id: `i${i}`, refId: clip.id, start, trimIn, trimOut }
  })
  const st = createEditorStore(defs, p)
  return { st, actor: actor.id, track: () => st.getState().project.sequence.tracks.find(t => t.id === track.id)! }
}

test('prependRestPose: rest item before the target, later items rippled by L, pose continuous', () => {
  const { st, actor, track } = setup([[0, 0, 60], [55, 10, 100], [140, 0, 120]])
  const before = st.getState().project
  const old = evaluateItem(before, defs, 'i1', 10) // i1's own start pose (frame 55 itself is a crossfade with i0)
  expect(st.getState().prependRestPose('i1')).toBe(true)
  const p = st.getState().project, t = track()
  expect(t.items).toHaveLength(4)
  const rest = t.items.find(i => !['i0', 'i1', 'i2'].includes(i.id))!
  expect(rest).toMatchObject({ start: 55, trimIn: 0, trimOut: REST_LEN })
  expect(p.clips[rest.refId].name).toBe('k1_기본자세')
  expect(t.items.find(i => i.id === 'i0')).toEqual(before.sequence.tracks.find(x => x.id === t.id)!.items[0]) // untouched
  expect(t.items.find(i => i.id === 'i1')!.start).toBe(55 + REST_LEN)
  expect(t.items.find(i => i.id === 'i2')!.start).toBe(140 + REST_LEN)
  const now = evaluate(p, defs, actor, 55 + REST_LEN)
  now.rootPos.forEach((v, k) => expect(Math.abs(v - old.rootPos[k])).toBeLessThan(1e-6))
  expect(quatAngle(now.rootQuat, old.rootQuat)).toBeLessThan(1e-6)
  expect(now.q).toEqual(old.q)
  // rest segment frame 0 (past the crossfade with i0): joints 0, standing height
  const r0 = evaluate(p, defs, actor, 60)
  expect(r0.q.every(v => v === 0)).toBe(true)
  expect(r0.rootPos[2]).toBe(g1.standingHeight)
  // later items keep their world poses
  const o2 = evaluate(before, defs, actor, 200), n2 = evaluate(p, defs, actor, 200 + REST_LEN)
  n2.rootPos.forEach((v, k) => expect(Math.abs(v - o2.rootPos[k])).toBeLessThan(1e-6))
  st.getState().undo()
  expect(st.getState().project).toBe(before)
})

test('prependRestPose on the first item: frame 0 is the rest pose', () => {
  const { st, actor } = setup([[0, 30, 90]])
  const old = evaluate(st.getState().project, defs, actor, 0)
  expect(st.getState().prependRestPose('i0')).toBe(true)
  const p = st.getState().project
  const r0 = evaluate(p, defs, actor, 0)
  expect(r0.q.every(v => v === 0)).toBe(true)
  expect(r0.rootPos[2]).toBe(g1.standingHeight)
  const now = evaluate(p, defs, actor, REST_LEN)
  now.rootPos.forEach((v, k) => expect(Math.abs(v - old.rootPos[k])).toBeLessThan(1e-6))
  expect(quatAngle(now.rootQuat, old.rootQuat)).toBeLessThan(1e-6)
  expect(now.q).toEqual(old.q)
})

test('prependRestPose rejects locked tracks, video and unknown items; name dedupes', () => {
  const { st, track } = setup([[0, 0, 60]])
  const s = () => st.getState()
  s().setTrackFlag(track().id, 'locked', true)
  const p = s().project
  expect(s().prependRestPose('i0')).toBe(false)
  expect(s().project).toBe(p)
  s().setTrackFlag(track().id, 'locked', false)
  expect(s().prependRestPose('nope')).toBe(false)
  const m = s().addMedia('v', 100)
  expect(s().addVideoItem(m, 0)).toBe(true)
  const vid = s().project.sequence.tracks.find(t => t.kind === 'video')!.items[0].id
  expect(s().prependRestPose(vid)).toBe(false)
  expect(s().prependRestPose('i0')).toBe(true)
  expect(s().prependRestPose('i0')).toBe(true)
  expect(Object.values(s().project.clips).map(c => c.name).filter(n => n.startsWith('k0_'))).toEqual(['k0_기본자세', 'k0_기본자세_2'])
})

test('itemPreview: open/close, pruned when the item goes away', () => {
  const { st } = setup([[0, 0, 60], [100, 0, 60]])
  const s = () => st.getState()
  s().openItemPreview('i1')
  expect(s().itemPreview).toBe('i1')
  s().deleteItem('i1')
  expect(s().itemPreview).toBe(null)
  s().undo()
  expect(s().itemPreview).toBe(null) // pruning only; undo does not reopen
  s().openItemPreview('i1'); s().closeItemPreview()
  expect(s().itemPreview).toBe(null)
  s().openItemPreview('i1'); s().redo()
  expect(s().itemPreview).toBe(null)
  s().openItemPreview('i0'); s().loadProject(newProject(), null)
  expect(s().itemPreview).toBe(null)
})
