import { expect, test } from 'vitest'
import { DEFAULT_PHYSICS, cacheKey, groupOf, withDefaults } from './settings'
import { loadDef } from '../test/defs'

test('every G1 joint maps to a known group', () => {
  const known = Object.keys(DEFAULT_PHYSICS.g1.groups)
  expect(known).toHaveLength(5)
  for (const j of loadDef('g1').joints) expect(known).toContain(groupOf('g1', j.name))
  expect(groupOf('g1', 'left_hip_yaw_joint')).toBe('고관절')
  expect(groupOf('g1', 'right_knee_joint')).toBe('무릎')
  expect(groupOf('g1', 'left_wrist_roll_joint')).toBe('팔')
  expect(groupOf('go2', 'FL_calf_joint')).toBe('전체')
})
test('withDefaults', () => {
  expect(withDefaults({})).toEqual(DEFAULT_PHYSICS)
  expect(withDefaults()).toEqual(DEFAULT_PHYSICS)
  const bad = withDefaults({ g1: { groups: { 무릎: { kp: -1, kd: NaN } }, torqueScale: 0, warnPct: 5000 } } as any)
  expect(bad).toEqual(DEFAULT_PHYSICS)
  expect(withDefaults({ g1: { ...DEFAULT_PHYSICS.g1, warnPct: 70 } }).g1.warnPct).toBe(70)
})
test('cacheKey', () => {
  const k = cacheKey('g1', 'abc', DEFAULT_PHYSICS)
  expect(k).toMatch(/^[0-9a-f]{16}$/)
  expect(cacheKey('g1', 'abc', DEFAULT_PHYSICS)).toBe(k)
  expect(cacheKey('g1', 'abd', DEFAULT_PHYSICS)).not.toBe(k)
  expect(cacheKey('g1', 'abc', withDefaults({ assist: { ...DEFAULT_PHYSICS.assist, kpF: 1 } }))).not.toBe(k)
})
