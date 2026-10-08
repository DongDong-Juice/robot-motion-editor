import { loadDef } from '../test/defs'
import { expect, test } from 'vitest'
import { makeKey } from './curve'
import { newProject } from './defaults'
import { evaluate, evaluateClip, type RobotDefs } from './evaluate'
import { restClipFor } from './restPose'
import { samplePoses } from '../export/csv'
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

const flag = (st: ReturnType<typeof setup>['st'], id: string) => st.getState().project.sequence.tracks.flatMap(t => t.items).find(i => i.id === id)!.restPose

test('setRestPose: toggles the flag only, one undo each, clips untouched', () => {
  const { st } = rpSetup([10, 110]), s = () => st.getState(), before = s().project
  expect(s().setRestPose('i1', true)).toBe(true)
  expect(flag(st, 'i1')).toBe(true); expect(flag(st, 'i0')).toBeUndefined()
  expect(s().project.clips).toEqual(before.clips); expect(s().dirty).toBe(true)
  s().undo(); expect(s().project).toBe(before); expect(flag(st, 'i1')).toBeUndefined()
  s().redo(); expect(s().setRestPose('i1', false)).toBe(true)
  expect(flag(st, 'i1')).toBeUndefined()
})

test('setRestPose: locked, unknown and video items rejected', () => {
  const l = rpSetup([10, 110]), s = () => l.st.getState()
  s().setTrackFlag(l.track().id, 'locked', true)
  const q = s().project
  expect(s().setRestPose('i1', true)).toBe(false)
  expect(s().project).toBe(q)
  s().setTrackFlag(l.track().id, 'locked', false)
  expect(s().setRestPose('nope', true)).toBe(false)
  const m = s().addMedia('v', 100)
  expect(s().addVideoItem(m, 0)).toBe(true)
  expect(s().setRestPose(s().project.sequence.tracks.find(t => t.kind === 'video')!.items[0].id, true)).toBe(false)
})

test('the flag never changes sequence evaluation (no jump at the item start)', () => {
  const { st, actor } = rpSetup([10, 110]), s = () => st.getState()
  const frames = [0, 59, 60, 61, 70, 100, 119], at = () => frames.map(f => evaluate(s().project, defs, actor, f))
  const before = at()
  s().setRestPose('i1', true)
  expect(at()).toEqual(before)
})

test('restClipFor: cached by clip identity and window; rest at a, original after the blend; input untouched', () => {
  const { orig } = rpSetup([10, 110])
  const a = restClipFor(orig, g1, 10, 110)
  expect(restClipFor(orig, g1, 10, 110)).toBe(a)
  expect(restClipFor(orig, g1, 10, 100)).not.toBe(a)
  expect(evaluateClip(a, g1, 10).q.every(v => Math.abs(v) < 1e-9)).toBe(true)
  expect(evaluateClip(a, g1, 109).q[ki]).toBeCloseTo(evaluateClip(orig, g1, 109).q[ki], 9)
})

test('samplePoses: flagged item starts standing; later rows and other items match the unflagged export', () => {
  const { st, actor } = rpSetup([10, 110]), s = () => st.getState()
  s().splitItem('i0', 30) // second piece of k0 shares its clip with i0
  const sibling = s().project.sequence.tracks[0].items.find(i => i.id !== 'i0' && i.refId === 'k0')!
  const plain = samplePoses(s().project, defs, actor, 'i1', 'world'), plainSib = samplePoses(s().project, defs, actor, sibling.id, 'world')
  const proj = s().project
  s().setRestPose('i1', true)
  expect(s().project.clips).toEqual(proj.clips)
  const rest = samplePoses(s().project, defs, actor, 'i1', 'world')
  expect(rest.length).toBe(plain.length)
  expect(rest[0].q.every(v => Math.abs(v) < 1e-9)).toBe(true)
  expect(rest[0].rootPos[2]).toBeCloseTo(g1.standingHeight, 9)
  for (let i = 30 + 60 + 1; i < rest.length; i++) expect(rest[i].q[ki]).toBeCloseTo(plain[i].q[ki], 6)
  expect(samplePoses(s().project, defs, actor, sibling.id, 'world')).toEqual(plainSib)
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
