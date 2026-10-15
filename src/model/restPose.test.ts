import { loadDef } from '../test/defs'
import { expect, test } from 'vitest'
import { evalCurve, makeKey } from './curve'
import { newProject } from './defaults'
import { evaluate, evaluateClip, type RobotDefs } from './evaluate'
import { autoBlend, leadOf, prependRestPose, REST_BLEND, REST_HOLD, restClipFor } from './restPose'
import { autoInertia, motionEnergy } from './inertia'
import { footMat, legsOf, rootMat } from './legIk'
import { samplePoses } from '../export/csv'
import { eulerToQuat, quatAngle, quatToEuler, quatYaw } from './rootMath'
import { placePose, rebasePose } from './pose'
import { createEditorStore } from '../store/store'
import type { Clip, Curve, Project } from './types'

const g1 = loadDef('g1')
const defs: RobotDefs = { g1, go2: loadDef('go2') }
const knee = 'left_knee_joint', ki = g1.joints.findIndex(j => j.name === knee)
const expectRest = (q: number[]) => q.forEach((v, i) => expect(v).toBeCloseTo(g1.rest.q[i], 9)) // 기본자세 (차렷) joint angles
const lin = (...kv: [number, number][]): Curve => ({ keys: kv.map(([f, v]) => makeKey(f, v, 'linear')) })

test('rebasePose: the origin pose lands at (0,0,z) facing yaw 0', () => {
  const o = { rootPos: [1, 2, 0.7] as [number, number, number], rootQuat: eulerToQuat(0.1, 0, 1), q: [] }
  const r = rebasePose(o, o)
  expect(r.rootPos.map(v => +v.toFixed(12))).toEqual([0, 0, 0.7])
  expect(quatYaw(r.rootQuat)).toBeCloseTo(0, 12)
  const p = rebasePose({ ...o, rootPos: [1 + Math.cos(1), 2 + Math.sin(1), 0.5] }, o) // 1 m ahead along the origin heading
  expect(p.rootPos.map(v => +v.toFixed(12))).toEqual([1, 0, 0.5])
})

test('placePose undoes rebasePose', () => {
  const o = { rootPos: [1, 2, 0.7] as [number, number, number], rootQuat: eulerToQuat(0.1, 0, 1), q: [] }
  const p = { rootPos: [0.3, -0.4, 0.6] as [number, number, number], rootQuat: eulerToQuat(0, 0.2, 2.5), q: [1] }
  const r = placePose(rebasePose(p, o), o)
  r.rootPos.forEach((v, i) => expect(v).toBeCloseTo(p.rootPos[i], 12))
  expect(quatAngle(r.rootQuat, p.rootQuat)).toBeCloseTo(0, 6)
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

const REST_PREPEND = REST_HOLD + REST_BLEND // default lead-in without 관성

const flag = (st: ReturnType<typeof setup>['st'], id: string) => st.getState().project.sequence.tracks.flatMap(t => t.items).find(i => i.id === id)!.restPose

test('setRestPose: toggles the flag only, one undo each, clips untouched', () => {
  const { st } = rpSetup([10, 110]), s = () => st.getState(), before = s().project
  expect(s().setRestPose('i1', true)).toBe(true)
  expect(flag(st, 'i1')).toBe(true); expect(flag(st, 'i0')).toBeUndefined()
  expect(s().project.clips).toEqual(before.clips); expect(s().dirty).toBe(true)
  s().undo(); expect(s().project).toBe(before); expect(flag(st, 'i1')).toBeUndefined()
  s().redo(); expect(s().setRestPose('i1', null)).toBe(true)
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

test('the flag never changes sequence evaluation (timeline plays the original); a cut moves nothing, flags nothing', () => {
  for (const mode of [true, 'prepend'] as const) {
    const { st, actor } = rpSetup([10, 110]), s = () => st.getState()
    const frames = [0, 59, 60, 61, 70, 100, 119, 150, 200], at = () => frames.map(f => evaluate(s().project, defs, actor, f))
    const before = at()
    s().setRestPose('i1', mode)
    expect(at()).toEqual(before)
  }
  const { st, track } = setup([[0, 0, 60], [60, 0, 60], [200, 0, 60]]), s = () => st.getState()
  expect(s().splitItem('i0', 30)).toBe(true)
  expect(track().items.map(i => [i.id === 'i0' || i.id === 'i1' || i.id === 'i2' ? i.id : 'new', i.start, i.restPose ?? null]))
    .toEqual([['i0', 0, null], ['i1', 60, null], ['i2', 200, null], ['new', 30, null]])
})

test('restClipFor: cached by clip identity and window; rest at a, original after the blend; input untouched', () => {
  const { orig } = rpSetup([10, 110])
  const a = restClipFor(orig, g1, 10, 110)
  expect(restClipFor(orig, g1, 10, 110)).toBe(a)
  expect(restClipFor(orig, g1, 10, 100)).not.toBe(a)
  expectRest(evaluateClip(a, g1, 10).q)
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
  expectRest(rest[0].q)
  expect(rest[0].rootPos[2]).toBeCloseTo(g1.rest.z, 9)
  for (let i = 30 + 60 + 1; i < rest.length; i++) expect(rest[i].q[ki]).toBeCloseTo(plain[i].q[ki], 6)
  expect(samplePoses(s().project, defs, actor, sibling.id, 'world')).toEqual(plainSib)
})

test('prependRestPose: 90 frames inserted at a; standing at a, the original frame a lands at a+90, everything after shifted', () => {
  const { orig } = rpSetup([10, 110])
  const c = restClipFor(orig, g1, 10, 110, 'prepend')
  expect(restClipFor(orig, g1, 10, 110, 'prepend')).toBe(c)
  expect(restClipFor(orig, g1, 10, 110)).not.toBe(c)
  expect(c.length).toBe(orig.length + REST_PREPEND)
  expect(orig.length).toBe(120) // input untouched
  const at = (f: number) => evaluateClip(c, g1, f), o = (f: number) => evaluateClip(orig, g1, f)
  for (const k of [0, 15, REST_HOLD]) {
    expectRest(at(10 + k).q)
    expect(at(10 + k).rootPos[2]).toBeCloseTo(g1.rest.z, 9)
  }
  // no drift: x/y/yaw stay at the motion's first value through the whole lead-in (only the joints move)
  const ch = (c: Clip, n: string, f: number) => evalCurve(c.channels[n], f, 0)
  for (let k = 0; k < REST_PREPEND; k++) for (const n of ['root.x', 'root.y', 'root.yaw']) expect(ch(c, n, 10 + k)).toBeCloseTo(ch(orig, n, 10), 9)
  // blended channels still arrive with the motion's velocity (no stop before it); legs are re-solved for planted feet (own test)
  const vel = (n: string, f: number) => evalCurve(c.channels[n], f + 1, 0) - evalCurve(c.channels[n], f, 0)
  expect(Math.abs(vel('root.z', 10 + REST_PREPEND - 2) - vel('root.z', 10 + REST_PREPEND))).toBeLessThan(2e-3)
  const mid = at(10 + REST_HOLD + REST_BLEND / 2).rootPos[2] // pelvis height half way between standing and the motion
  expect(mid).toBeLessThan(g1.rest.z); expect(mid).toBeGreaterThan(o(10).rootPos[2])
  for (const f of [10, 11, 50, 109, 119]) {
    const a = at(f + REST_PREPEND), b = o(f)
    expect(a.q[ki]).toBeCloseTo(b.q[ki], 6) // bezier split at a: same curve up to rounding
    a.rootPos.forEach((v, i) => expect(v).toBeCloseTo(b.rootPos[i], 6))
    expect(quatAngle(a.rootQuat, b.rootQuat)).toBeCloseTo(0, 6)
  }
})

test('samplePoses prepend: 90 more rows, standing first, original rows untouched after them; local starts at zero', () => {
  const { st, actor } = rpSetup([10, 110]), s = () => st.getState()
  const plain = samplePoses(s().project, defs, actor, 'i1', 'world')
  expect(s().setRestPose('i1', 'prepend')).toBe(true)
  expect(s().setRestLead('i1', { inertia: 0 })).toBe(true)
  const rest = samplePoses(s().project, defs, actor, 'i1', 'world')
  expect(rest.length).toBe(plain.length + REST_PREPEND)
  expectRest(rest[0].q)
  expect(rest[0].rootPos[2]).toBeCloseTo(g1.rest.z, 9)
  for (let i = 0; i < plain.length; i++) {
    expect(rest[i + REST_PREPEND].q).toEqual(plain[i].q) // the original rows are the timeline's, untouched
    expect(rest[i + REST_PREPEND].rootPos).toEqual(plain[i].rootPos)
    expect(quatAngle(rest[i + REST_PREPEND].rootQuat, plain[i].rootQuat)).toBeCloseTo(0, 6)
  }
  const seam = rest[REST_PREPEND - 1], first = rest[REST_PREPEND] // the blend reaches the first frame smoothly
  expect(Math.abs(seam.rootPos[2] - first.rootPos[2])).toBeLessThan(0.01)
  const local = samplePoses(s().project, defs, actor, 'i1', 'local')
  expect(local[0].rootPos.slice(0, 2).map(v => +v.toFixed(12))).toEqual([0, 0])
  expect(quatYaw(local[0].rootQuat)).toBeCloseTo(0, 9)
})

test('setRestPose: modes switch in one undo step each', () => {
  const { st } = rpSetup([10, 110]), s = () => st.getState()
  s().setRestPose('i1', 'prepend'); expect(flag(st, 'i1')).toBe('prepend')
  s().setRestPose('i1', true); expect(flag(st, 'i1')).toBe(true)
  s().undo(); expect(flag(st, 'i1')).toBe('prepend')
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

const dense2 = (n: number, g: (f: number) => number): Curve => ({ keys: Array.from({ length: n }, (_, f) => makeKey(f, g(f), 'linear')) })
// knee still until frame 60, then swinging fast; root standing
const swing = (len = 200, from = 60): Clip =>
  ({ id: 'sw', name: 'sw', robot: 'g1', length: len, channels: { [knee]: dense2(len, f => f < from ? 0.3 : 0.3 + 0.6 * Math.sin((f - from) / 6)) } })

test('autoInertia: start / still / quiet / review; never longer than 1.5 s', () => {
  const c = swing()
  expect(autoInertia(c, g1, 0)).toEqual({ len: 0, why: 'start' })
  expect(autoInertia(c, g1, 30).why).toBe('still') // standing part
  const q = autoInertia(c, g1, 75) // 15 frames into the swing: walks back to the still part
  expect(q.why).toBe('quiet'); expect(q.len).toBeGreaterThan(8); expect(q.len).toBeLessThanOrEqual(20)
  expect(autoInertia(c, g1, 190).len).toBeLessThanOrEqual(90)
  expect(motionEnergy(c, g1)).toBe(motionEnergy(c, g1)) // cached per clip
  // a still start, then a steady fast spin: the feet never stand still within 3 s of the cut → 'air' (flagged for review)
  const spin: Clip = { ...c, id: 'sp', length: 400, channels: { [knee]: dense2(400, f => f < 100 ? 0.3 : 0.6 + 0.5 * Math.sin(f / 4)), 'root.yaw': dense2(400, f => f < 100 ? 0 : (f - 100) * 0.05) } }
  expect(autoInertia(spin, g1, 300).why).toBe('air')
})

test('leadOf: defaults, hand-set values clamped, 관성 never before the clip start', () => {
  const c = swing(), it = { id: 'x', refId: 'sw', start: 0, trimIn: 75, trimOut: 150, restPose: 'prepend' as const }
  const d = leadOf(it, c, g1)
  expect([d.hold, d.blend, d.why]).toEqual([REST_HOLD, REST_BLEND, 'quiet'])
  expect(d.lead).toBe(REST_HOLD + REST_BLEND + d.inertia)
  const m = leadOf({ ...it, restHold: 6, restBlend: 999, inertia: 500 }, c, g1)
  expect([m.hold, m.blend, m.inertia, m.why]).toEqual([6, 180, 75, null])
  const a = leadOf({ ...it, restBlend: 'auto' }, c, g1)
  expect(a.blend).toBe(autoBlend(c, g1, 75 - a.inertia).blend)
})

test('autoBlend: the transition stays under half the URDF velocity limit; longer for a bigger move', () => {
  const near = autoBlend(swing(), g1, 30)
  const far = autoBlend({ ...swing(), id: 'f', channels: { [knee]: dense2(200, () => 2.5) } }, g1, 30)
  expect(near.over).toBe(false); expect(far.blend).toBeGreaterThan(near.blend)
  const B = far.blend, R = g1.rest.q[ki], T = 2.5
  for (let k = 0; k <= B; k++) { const u = k / B; expect(Math.abs((6 * u * u - 6 * u) * R + (6 * u - 6 * u * u) * T) / B * 60).toBeLessThanOrEqual(0.5 * g1.joints[ki].velocity + 1e-9) }
})

test('prepend with 관성: hold + blend inserted at trimIn − 관성; the 관성 frames are the original ones; no jump into them', () => {
  const c = swing(), a = 75 - 15, P = 12 + 30
  const r = restClipFor(c, g1, a, 150, 'prepend', 12, 30)
  expect(r.length).toBe(c.length + P)
  expect(restClipFor(c, g1, a, 150, 'prepend', 12, 30)).toBe(r)
  expect(restClipFor(c, g1, a, 150, 'prepend', 30, 60)).not.toBe(r)
  expectRest(evaluateClip(r, g1, a).q)
  for (let f = a; f < 75; f++) expect(evaluateClip(r, g1, f + P).q[ki]).toBeCloseTo(evaluateClip(c, g1, f).q[ki], 6)
  const q = (f: number) => evalCurve(r.channels[knee], f, 0)
  expect(Math.abs(q(a + P - 1) - q(a + P))).toBeLessThan(0.05) // no jump into the 관성 frames (the IK legs end on the motion's pose)
})

test('samplePoses with 관성: rows = 정지 + 전이 + 관성 + piece; 관성 rows are the original frames before the cut; setRestLead clamps', () => {
  const { st, actor } = rpSetup([30, 110]), s = () => st.getState()
  const plain = samplePoses(s().project, defs, actor, 'i1', 'world')
  s().setRestPose('i1', 'prepend')
  expect(s().setRestLead('i1', { restHold: 10, restBlend: 20, inertia: 15 })).toBe(true)
  const it = () => s().project.sequence.tracks[0].items.find(i => i.id === 'i1')!
  expect([it().restHold, it().restBlend, it().inertia]).toEqual([10, 20, 15])
  const rows = samplePoses(s().project, defs, actor, 'i1', 'world'), clip = s().project.clips.k1
  expect(rows.length).toBe(plain.length + 45)
  for (let k = 0; k < 15; k++) expect(rows[30 + k].q[ki]).toBeCloseTo(evaluateClip(clip, g1, 15 + k).q[ki], 6)
  for (let i = 0; i < plain.length; i++) expect(rows[45 + i].q).toEqual(plain[i].q)
  expect(s().setRestLead('i1', { inertia: 999 })).toBe(true) // clamped to trimIn
  expect(it().inertia).toBe(30)
  s().undo(); expect(it().inertia).toBe(15)
  expect(s().setRestLead('i1', { inertia: null, restBlend: 'auto' })).toBe(true)
  expect(it().inertia).toBeUndefined(); expect(it().restBlend).toBe('auto')
  s().setTrackFlag(s().project.sequence.tracks[0].id, 'locked', true)
  expect(s().setRestLead('i1', { restHold: 5 })).toBe(false)
})

test('전이: the feet never slide — each stays planted or is lifted and set down at its place in the motion, one after another', () => {
  // wide, bent start (feet apart and forward of the 차렷 stance)
  const pose: Record<string, number> = { left_hip_roll_joint: 0.2, right_hip_roll_joint: -0.2, left_hip_pitch_joint: -0.35, right_hip_pitch_joint: -0.1,
    left_knee_joint: 0.6, right_knee_joint: 0.4, left_ankle_pitch_joint: -0.25, right_ankle_pitch_joint: -0.3 }
  const legs = legsOf(g1), q = g1.joints.map(j => pose[j.name] ?? 0)
  const ground = Math.min(...legs.map(l => footMat(l, rootMat(0, 0, g1.rest.z, 0, 0, 0), g1.rest.q)[11])) // ankle height standing
  const z = ground - Math.min(...legs.map(l => footMat(l, rootMat(0, 0, 0, 0, 0, 0), q)[11])) // pelvis height that puts the start pose on the floor
  const c: Clip = { id: 'st', name: 'st', robot: 'g1', length: 60, channels: { 'root.z': dense2(60, () => z),
    ...Object.fromEntries(Object.entries(pose).map(([n, v]) => [n, dense2(60, () => v)])) } }
  const r = prependRestPose(c, g1, 0)
  const feet = (f: number) => {
    const p = evaluateClip(r, g1, f), [ro, pi, ya] = quatToEuler(p.rootQuat)
    return legs.map(l => footMat(l, rootMat(p.rootPos[0], p.rootPos[1], p.rootPos[2], ro, pi, ya), p.q))
  }
  const start = feet(0), end = feet(REST_PREPEND)
  let lifted = [false, false]
  for (let f = 1; f <= REST_PREPEND; f++) {
    const a = feet(f - 1), b = feet(f)
    b.forEach((m, i) => {
      const step = Math.hypot(m[3] - a[i][3], m[7] - a[i][7]), up = Math.min(m[11], a[i][11]) - ground
      if (up > 0.02) lifted[i] = true
      if (step > 1e-3) expect(up, `foot ${i} frame ${f} moves ${step.toFixed(4)} m on the ground`).toBeGreaterThan(0.003)
    })
  }
  expect(lifted).toEqual([true, true]) // both feet had to move, so both stepped
  end.forEach((m, i) => expect(Math.hypot(m[3] - start[i][3], m[7] - start[i][7])).toBeGreaterThan(0.02))
  const rr = prependRestPose(c, g1, 0, 30, 0) // 전이 0: a snap, legs untouched
  expect(rr.length).toBe(c.length + 30)
})
