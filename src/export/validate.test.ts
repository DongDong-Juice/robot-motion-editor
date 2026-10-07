import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { loadRobotDef } from '../robot/loadRobot'
import { eulerToQuat } from '../model/rootMath'
import type { Pose } from '../model/evaluate'
import { validatePoses } from './validate'

const r = (f: string) => JSON.parse(readFileSync(new URL(`../../public/robots/g1/${f}`, import.meta.url), 'utf8'))
const g1 = loadRobotDef('g1', r('model.json'), r('meshes.json'))
const rest = (): Pose => ({ rootPos: [0, 0, 0.7], rootQuat: [0, 0, 0, 1], q: g1.joints.map(() => 0) })
const knee = g1.joints.findIndex(j => j.name === 'left_knee_joint')

test('no rootJump warning for smooth yaw crossing pi', () => {
  const poses = Array.from({ length: 60 }, (_, i) => ({ ...rest(), rootQuat: eulerToQuat(0, 0, 3.0 + i * 0.005) }))
  expect(validatePoses(poses, g1, 0)).toEqual([])
})

test('joint limit warning, once per run, with sequence frame', () => {
  const poses = Array.from({ length: 20 }, rest)
  for (const i of [10, 11, 12]) poses[i].q[knee] = -1.0
  const w = validatePoses(poses, g1, 100).filter(x => x.kind === 'jointLimit')
  expect(w).toHaveLength(1)
  expect(w[0]).toMatchObject({ channel: 'left_knee_joint', frame: 110 })
  expect(w[0].message).toContain('left_knee_joint')
})

test('joint velocity warning', () => {
  const poses = [rest(), rest()]
  poses[1].q[knee] = 0.5
  const w = validatePoses(poses, g1, 0)
  expect(w.some(x => x.kind === 'jointVelocity' && x.channel === 'left_knee_joint' && x.frame === 1)).toBe(true)
})

test('root jump warning', () => {
  const poses = [rest(), rest(), rest()]
  poses[1].rootPos = [0.2, 0, 0.7]
  poses[2].rootPos = [0.2, 0, 0.7]
  const w = validatePoses(poses, g1, 0).filter(x => x.kind === 'rootJump')
  expect(w).toHaveLength(1)
  expect(w[0]).toMatchObject({ channel: 'root', frame: 1 })
})
