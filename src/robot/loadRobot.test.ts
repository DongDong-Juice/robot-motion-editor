import { loadDef } from '../test/defs'
import { expect, test } from 'vitest'

const loadG1 = () => loadDef('g1')

const loadGo2 = () => loadDef('go2')

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

test('기본자세: inside the URDF limits; G1 legs straight (same height as all-zero), GO2 crouched lower', () => {
  for (const d of [loadG1(), loadGo2()]) {
    expect(d.rest.q).toHaveLength(d.joints.length)
    d.joints.forEach((j, i) => { expect(d.rest.q[i]).toBeGreaterThanOrEqual(j.lower); expect(d.rest.q[i]).toBeLessThanOrEqual(j.upper) })
  }
  expect(loadG1().rest.z).toBeCloseTo(loadG1().standingHeight, 3)
  expect(loadGo2().rest.z).toBeGreaterThan(0.2); expect(loadGo2().rest.z).toBeLessThan(loadGo2().standingHeight)
})
