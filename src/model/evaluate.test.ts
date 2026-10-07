import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { loadRobotDef } from '../robot/loadRobot'
import type { RobotKind } from '../robot/types'
import { makeKey } from './curve'
import { addActor, newProject } from './defaults'
import { evaluate, evaluateClip, evaluateRoot, type RobotDefs } from './evaluate'
import { eulerToQuat, quatAngle, quatYaw, type Quat } from './rootMath'
import type { Clip, Project } from './types'

const load = (k: RobotKind) => {
  const r = (f: string) => JSON.parse(readFileSync(new URL(`../../public/robots/${k}/${f}`, import.meta.url), 'utf8'))
  return loadRobotDef(k, r('model.json'), r('meshes.json'))
}
const g1 = load('g1')
const defs: RobotDefs = { g1, go2: load('go2') }

const emptyClip = (robot: RobotKind): Clip => ({ id: 'c', name: 'c', robot, length: 120, channels: {} })
const expectQuat = (a: Quat, b: Quat) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]))

function projectWithRootX(x: number, placement: { x: number; y: number; yaw: number }) {
  const p = newProject()
  const actor = p.actors[0]
  actor.placement = placement
  const clip = p.clips[p.sequence.tracks.find(t => t.actorId === actor.id)!.items[0].refId]
  clip.channels['root.x'] = { keys: [makeKey(0, x, 'linear'), makeKey(119, x + 119, 'linear')] }
  return { proj: p, actorId: actor.id, clip }
}

test('euler→quat yaw 90°', () => expectQuat(eulerToQuat(0, 0, Math.PI / 2), [0, 0, Math.SQRT1_2, Math.SQRT1_2]))
test('quatYaw roundtrip', () => expect(quatYaw(eulerToQuat(0.1, 0.2, 2.5))).toBeCloseTo(2.5))
test('quatAngle', () => expect(quatAngle(eulerToQuat(0, 0, 0), eulerToQuat(0, 0, 1))).toBeCloseTo(1))

test('empty clip pose: zeros, root z = standingHeight', () => {
  const p = evaluateClip(emptyClip('g1'), g1, 0)
  expect(p.q).toHaveLength(29)
  expect(p.q.every(v => v === 0)).toBe(true)
  expect(p.rootPos[2]).toBeCloseTo(g1.standingHeight)
})

test('placement applied: yaw 90° maps clip +x to world +y', () => {
  const { proj, actorId } = projectWithRootX(1.0, { x: 2, y: 0, yaw: Math.PI / 2 })
  const pose = evaluate(proj, defs, actorId, 0)
  expect(pose.rootPos[0]).toBeCloseTo(2)
  expect(pose.rootPos[1]).toBeCloseTo(1)
  expect(quatYaw(pose.rootQuat)).toBeCloseTo(Math.PI / 2)
})

test('frame after item end holds last pose; before start holds first', () => {
  const { proj, actorId } = projectWithRootX(1.0, { x: 0, y: 0, yaw: 0 })
  expect(evaluate(proj, defs, actorId, 150).rootPos[0]).toBeCloseTo(1 + 119)
  expect(evaluate(proj, defs, actorId, -5).rootPos[0]).toBeCloseTo(1)
})

test('item start/trimIn offset', () => {
  const { proj, actorId } = projectWithRootX(0, { x: 0, y: 0, yaw: 0 })
  const it = proj.sequence.tracks.find(t => t.actorId === actorId)!.items[0]
  it.start = 10; it.trimIn = 20
  expect(evaluate(proj, defs, actorId, 15).rootPos[0]).toBeCloseTo(25)
})

test('actor with no items yields default pose', () => {
  const { proj, actorId } = projectWithRootX(1, { x: 0, y: 0, yaw: 0 })
  proj.sequence.tracks.find(t => t.actorId === actorId)!.items = []
  expect(evaluate(proj, defs, actorId, 3).rootPos[2]).toBeCloseTo(g1.standingHeight)
})

test('newProject has G1 and GO2 actors with one item each', () => {
  const p = newProject()
  expect(p.actors.map(a => a.robot)).toEqual(['g1', 'go2'])
  expect(p.sequence.tracks.filter(t => t.kind === 'motion').every(t => t.items.length === 1)).toBe(true)
})

test('addActor does not mutate and names/places the new actor', () => {
  const p = newProject()
  const p2: Project = addActor(p, 'g1')
  expect(p.actors).toHaveLength(2)
  const a = p2.actors[2]
  expect(a.name).toBe('G1 #2')
  expect(a.placement.x).toBeCloseTo(3)
  expect(Object.keys(p2.clips)).toHaveLength(3)
  expect(p2.sequence.tracks.filter(t => t.actorId === a.id)[0].items).toHaveLength(1)
})

test('evaluateRoot equals evaluate root across stitch, crossfade, gaps', () => {
  const { proj, actorId, clip } = projectWithRootX(0.5, { x: 1, y: -2, yaw: 0.7 })
  clip.channels['root.yaw'] = { keys: [makeKey(0, 0, 'linear'), makeKey(119, 1.2, 'linear')] }
  clip.channels['root.pitch'] = { keys: [makeKey(0, 0.1, 'linear')] }
  const items = proj.sequence.tracks.find(t => t.actorId === actorId)!.items
  items.push({ id: 'b', refId: clip.id, start: 100, trimIn: 10, trimOut: 120 }, { id: 'c', refId: clip.id, start: 230, trimIn: 0, trimOut: 60 })
  for (let f = -3; f < 300; f++) {
    const a = evaluate(proj, defs, actorId, f), b = evaluateRoot(proj, defs, actorId, f)
    a.rootPos.forEach((v, i) => expect(b.rootPos[i]).toBeCloseTo(v, 9))
    a.rootQuat.forEach((v, i) => expect(b.rootQuat[i]).toBeCloseTo(v, 9))
  }
})
