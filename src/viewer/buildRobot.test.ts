import { loadDef } from '../test/defs'
import * as THREE from 'three'
import { expect, test } from 'vitest'
import type { Pose } from '../model/evaluate'
import { buildRobot, pivotAngle } from './buildRobot'

const g1 = loadDef('g1')

const zeroPose = (): Pose => ({ rootPos: [0, 0, 0], rootQuat: [0, 0, 0, 1], q: g1.joints.map(() => 0) })
const poseWith = (name: string, v: number): Pose => {
  const p = zeroPose(); p.q[g1.joints.findIndex(j => j.name === name)] = v; return p
}
const worldPos = (rig: ReturnType<typeof buildRobot>, link: string) =>
  rig.root.getObjectByName(link)!.getWorldPosition(new THREE.Vector3())

test('zero pose: left foot below pelvis by ~standingHeight', () => {
  const rig = buildRobot(g1, '#58B4D1'); rig.applyPose(zeroPose())
  expect(worldPos(rig, 'left_ankle_roll_link').z).toBeLessThan(-0.6)
})
test('pivotAngle reads back applied angle', () => {
  const rig = buildRobot(g1, '#fff'); rig.applyPose(poseWith('left_elbow_joint', 0.8))
  const j = g1.joints.find(j => j.name === 'left_elbow_joint')!
  expect(pivotAngle(rig.jointPivots['left_elbow_joint'], j.axis)).toBeCloseTo(0.8)
  expect(pivotAngle(rig.jointPivots['left_elbow_joint'], [0, 1, 0])).toBeCloseTo(0.8)
})
test('pelvis and arm meshes map to joints', () => {
  const rig = buildRobot(g1, '#fff')
  expect(rig.linkToJoint.get(rig.root.getObjectByName('pelvis')!)).toBe('root')
  expect(rig.linkToJoint.get(rig.root.getObjectByName('left_elbow_link')!)).toBe('left_elbow_joint')
})
