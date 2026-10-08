import { loadDef } from '../test/defs'
import { expect, test } from 'vitest'
import { makeKey } from './curve'
import { newProject } from './defaults'
import { evaluateClip, evaluateItem, type RobotDefs } from './evaluate'
import { eulerToQuat, quatAngle, quatYaw } from './rootMath'
import { rebasePose } from './pose'
import { createEditorStore } from '../store/store'
import type { Clip, Curve, Project } from './types'

const g1 = loadDef('g1')
const defs: RobotDefs = { g1, go2: loadDef('go2') }
const knee = 'left_knee_joint', ki = g1.joints.findIndex(j => j.name === knee)
const lin = (...kv: [number, number][]): Curve => ({ keys: kv.map(([f, v]) => makeKey(f, v, 'linear')) })

test('rebasePose: the origin pose lands at (0,0,z) facing yaw 0', () => {
  const o = { rootPos: [1, 2, 0.7] as [number, number, number], rootQuat: eulerToQuat(0.1, 0, 1), q: [] }
  const r = rebasePose(o, o)
  expect(r.rootPos.map(v => +v.toFixed(12))).toEqual([0, 0, 0.7])
  expect(quatYaw(r.rootQuat)).toBeCloseTo(0, 12)
  const p = rebasePose({ ...o, rootPos: [1 + Math.cos(1), 2 + Math.sin(1), 0.5] }, o) // 1 m ahead along the origin heading
  expect(p.rootPos.map(v => +v.toFixed(12))).toEqual([1, 0, 0.5])
})

// G1 track with items [start, trimIn, trimOut]; clip k<i> has moving root and a knee ramp
function setup(items: [number, number, number][], patch?: (c: Clip) => void) {
  const p: Project = structuredClone(newProject())
  const actor = p.actors.find(a => a.robot === 'g1')!
  const track = p.sequence.tracks.find(t => t.actorId === actor.id)!
  track.items = items.map(([start, trimIn, trimOut], i) => {
    const clip: Clip = { id: `k${i}`, name: `k${i}`, robot: 'g1', length: 120, channels: {
      'root.x': lin([0, 0], [119, 1 + i]), 'root.y': lin([0, 0.3 * i], [119, 0.5]), 'root.yaw': lin([0, 0.4 * i], [119, 1.2]),
      'root.z': lin([0, 0.7], [119, 0.6]), 'root.pitch': lin([0, 0.05], [119, 0.1]), [knee]: lin([0, 0.2], [119, 1]),
    } }
    patch?.(clip)
    p.clips[clip.id] = clip
    return { id: `i${i}`, refId: clip.id, start, trimIn, trimOut }
  })
  const st = createEditorStore(defs, p)
  return { st, actor: actor.id, track: () => st.getState().project.sequence.tracks.find(t => t.id === track.id)! }
}

const sparse = (v0: number, v1: number): Curve => ({ keys: [makeKey(0, v0), makeKey(100, v1)] }) // bezier, flat tangents
const dense = (g: (f: number) => number): Curve => ({ keys: Array.from({ length: 120 }, (_, f) => makeKey(f, g(f), 'linear')) })

function rpSetup(win: [number, number], mk: (c: Curve) => Curve = c => c) {
  let orig!: Clip
  const s = setup([[0, 0, 60], [60, win[0], win[1]]], clip => {
    clip.channels[knee] = mk(sparse(0.2, 1)); clip.channels['root.z'] = mk(sparse(0.7, 0.6)); clip.channels['root.x'] = mk(sparse(0, 2))
    if (clip.id === 'k1') orig = structuredClone(clip)
  })
  return { ...s, orig }
}

test('setRestPose: rest at a and a+HOLD, original from end, outside untouched, in place, one undo', () => {
  for (const mk of [(c: Curve) => c, () => dense(f => 0.5 + 0.3 * Math.sin(f / 7))]) {
    const { st, track, orig } = rpSetup([10, 110], mk)
    const before = st.getState().project, t0 = track().items
    expect(st.getState().setRestPose('i1')).toBe(true)
    const p = st.getState().project, c = p.clips.k1, a = 10, hold = 30, end = a + hold + 60
    expect(track().items).toEqual(t0)
    expect(Object.keys(p.clips)).toEqual(Object.keys(before.clips))
    const at = (cl: Clip, f: number) => evaluateClip(cl, g1, f), o = (f: number) => at(orig, f)
    for (const f of [a, a + hold]) {
      const r = at(c, f)
      expect(r.q.every(v => Math.abs(v) < 1e-9)).toBe(true)
      expect(r.rootPos[2]).toBeCloseTo(g1.standingHeight, 9)
      expect(r.rootPos[0]).toBeCloseTo(o(a).rootPos[0], 9); expect(r.rootPos[1]).toBeCloseTo(o(a).rootPos[1], 9)
      expect(quatAngle(r.rootQuat, eulerToQuat(0, 0, quatYaw(o(a).rootQuat)))).toBeLessThan(1e-6)
    }
    expect(at(c, end).q[ki]).toBeCloseTo(o(end).q[ki], 12)
    const mid = at(c, a + hold + 30).q[ki]
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(o(a + hold + 30).q[ki] + 1e-9)
    for (const f of [0, 3, 8, 9, end, end + 1, end + 2, 100, 119]) {
      const x = at(c, f), y = o(f)
      expect(Math.abs(x.q[ki] - y.q[ki])).toBeLessThan(1e-6); expect(Math.abs(x.rootPos[2] - y.rootPos[2])).toBeLessThan(1e-6)
    }
    for (let f = end + 1; f < 120; f += 3) expect(Math.abs(at(c, f).q[ki] - o(f).q[ki])).toBeLessThan(1e-6)
    for (let f = 0; f < a; f++) expect(Math.abs(at(c, f).rootPos[0] - o(f).rootPos[0])).toBeLessThan(1e-6)
    // previous piece (clip frames before a) is unaffected in the sequence
    expect(evaluateItem(p, defs, 'i0', 30).q).toEqual(evaluateItem(before, defs, 'i0', 30).q)
    st.getState().undo()
    expect(st.getState().project).toBe(before)
  }
})

test('setRestPose: short item shrinks hold/blend; len < 3 rejected; locked and unknown rejected', () => {
  const { st, orig } = rpSetup([20, 29]) // len 9: HOLD 3, BLEND 5 -> end = 28
  expect(st.getState().setRestPose('i1')).toBe(true)
  const c = st.getState().project.clips.k1
  expect(evaluateClip(c, g1, 23).q.every(v => Math.abs(v) < 1e-9)).toBe(true)
  expect(evaluateClip(c, g1, 24).q[ki]).not.toBe(0)
  expect(evaluateClip(c, g1, 28).q[ki]).toBeCloseTo(evaluateClip(orig, g1, 28).q[ki], 12)
  const t = rpSetup([20, 22])
  const p = t.st.getState().project
  expect(t.st.getState().setRestPose('i1')).toBe(false)
  expect(t.st.getState().project).toBe(p)
  const l = rpSetup([10, 110]), s = () => l.st.getState()
  s().setTrackFlag(l.track().id, 'locked', true)
  const q = s().project
  expect(s().setRestPose('i1')).toBe(false)
  expect(s().project).toBe(q)
  s().setTrackFlag(l.track().id, 'locked', false)
  expect(s().setRestPose('nope')).toBe(false)
  const m = s().addMedia('v', 100)
  expect(s().addVideoItem(m, 0)).toBe(true)
  expect(s().setRestPose(s().project.sequence.tracks.find(t => t.kind === 'video')!.items[0].id)).toBe(false)
})

test('setRestPose on a shared clip bakes a private copy; others untouched; one undo', () => {
  const { st, track } = rpSetup([10, 110]) // i0 = k0
  const s = () => st.getState()
  s().splitItem('i0', 30)
  const a = track().items.find(i => i.id === 'i0')!, b = track().items.find(i => i.id !== 'i0' && i.refId === 'k0')!, before = s().project, orig = before.clips[a.refId]
  expect(a.refId).toBe(b.refId)
  const curves = JSON.stringify(orig.channels), poseA = evaluateItem(before, defs, a.id, a.start + 5).q
  expect(s().setRestPose(b.id)).toBe(true)
  const p = s().project, a2 = track().items.find(i => i.id === 'i0')!, b2 = track().items.find(i => i.id === b.id)!, copy = p.clips[b2.refId]
  expect(b2.refId).not.toBe(a.refId); expect(copy.owner).toBe(b.id); expect(copy.name).toBe(orig.name)
  expect(a2.refId).toBe(a.refId)
  expect(JSON.stringify(p.clips[a.refId].channels)).toBe(curves)
  expect(evaluateItem(p, defs, a.id, a.start + 5).q).toEqual(poseA)
  expect(evaluateClip(copy, g1, b2.trimIn).q.every(v => Math.abs(v) < 1e-9)).toBe(true)
  expect(Object.values(p.clips).filter(c => !c.owner).length).toBe(Object.keys(before.clips).length) // the copy is hidden
  s().undo()
  expect(s().project).toBe(before)
  s().redo(); s().deleteItem(b2.id) // owner removed -> copy removed
  expect(s().project.clips[copy.id]).toBeUndefined()
})

test('setRestPose: single user bakes in place; same asset on two tracks stays private', () => {
  const one = rpSetup([10, 110]), n = Object.keys(one.st.getState().project.clips).length
  one.st.getState().setRestPose('i1')
  expect(Object.keys(one.st.getState().project.clips).length).toBe(n)
  expect(one.st.getState().project.clips.k1.owner).toBeUndefined()
  const s = () => one.st.getState()
  const r = s().placeClipAsNewActor('k1', 0)!
  const before = JSON.stringify(s().project.clips.k1.channels)
  expect(s().setRestPose(r.itemId)).toBe(true)
  expect(JSON.stringify(s().project.clips.k1.channels)).toBe(before)
  expect(s().project.sequence.tracks.flatMap(t => t.items).find(i => i.id === r.itemId)!.refId).not.toBe('k1')
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
