import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { loadRobotDef } from './loadRobot'

const read = (f: string) =>
  JSON.parse(readFileSync(new URL(`../../public/robots/g1/${f}`, import.meta.url), 'utf8'))
const loadG1 = () => loadRobotDef('g1', read('model.json'), read('meshes.json'))

const readGo2 = (f: string) =>
  JSON.parse(readFileSync(new URL(`../../public/robots/go2/${f}`, import.meta.url), 'utf8'))
const loadGo2 = () => loadRobotDef('go2', readGo2('model.json'), readGo2('meshes.json'))

test('go2 joints: 12 revolute, FL first', () => {
  const d = loadGo2()
  expect(d.joints.map(j => j.name).slice(0, 3)).toEqual(['FL_hip_joint', 'FL_thigh_joint', 'FL_calf_joint'])
  expect(d.joints).toHaveLength(12)
  expect(Object.keys(d.meshes).length).toBeGreaterThan(0)
  expect(d.standingHeight).toBeGreaterThan(0.2)
})

test('g1 joints: 29 revolute in URDF order', () => {
  const d = loadG1()
  expect(d.joints).toHaveLength(29)
  expect(d.joints[0].name).toBe('left_hip_pitch_joint')
  expect(d.joints[28].name).toBe('right_wrist_yaw_joint')
  expect(d.joints[0].lower).toBeCloseTo(-2.5307)
  expect(d.rootLink).toBe('pelvis')
  expect(d.fixedJoints).toHaveLength(9)
})

test('g1 meshes decode', () => {
  const m = loadG1().meshes['pelvis']
  expect(m.positions.length).toBe(10620 * 3)
  expect(m.indices.length).toBe(63648)
  expect(m.positions[0]).toBeCloseTo(0.0105, 4)
})

test('g1 standing height plausible', () => {
  expect(loadG1().standingHeight).toBeGreaterThan(0.6)
  expect(loadG1().standingHeight).toBeLessThan(0.9)
})

test('g1 groups cover all joints exactly once', () => {
  const d = loadG1()
  expect(d.groups.flatMap(g => g.joints).sort()).toEqual(d.joints.map(j => j.name).sort())
  expect(d.groups.map(g => g.name)).toEqual(['왼다리', '오른다리', '허리', '왼팔', '오른팔'])
})
