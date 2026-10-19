import { expect, test } from 'vitest'
import { loadDef } from '../test/defs'
import { footMat, legsOf } from './legIk'
import { bodyMat, groundZ, lockFeet, restFootZ } from './bodyPose'

const g1 = loadDef('g1'), go2 = loadDef('go2')

test('groundZ: rest pose sits at rest.z; tilted pose keeps lowest foot on the floor', () => {
  for (const def of [g1, go2]) {
    const b = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 }
    expect(groundZ(def, def.rest.q, b)).toBeCloseTo(def.rest.z, 4)
    const tilt = { ...b, pitch: 0.2 }, z = groundZ(def, def.rest.q, tilt)
    const low = Math.min(...legsOf(def).map(l => footMat(l, bodyMat({ ...tilt, z }), def.rest.q)[11]))
    expect(low).toBeCloseTo(restFootZ(def), 3)
  }
})
test('lockFeet: small body move keeps feet within 1 cm; huge move fails', () => {
  for (const def of [g1, go2]) {
    const from = { x: 0, y: 0, z: def.rest.z, roll: 0, pitch: 0, yaw: 0 }
    const q = lockFeet(def, [...def.rest.q], from, { ...from, x: 0.05 })!
    expect(q).not.toBeNull()
    for (const l of legsOf(def)) {
      const a = footMat(l, bodyMat(from), def.rest.q), c = footMat(l, bodyMat({ ...from, x: 0.05 }), q)
      expect(Math.hypot(a[3] - c[3], a[7] - c[7], a[11] - c[11])).toBeLessThan(0.01)
    }
    expect(lockFeet(def, [...def.rest.q], from, { ...from, x: 1 })).toBeNull()
  }
})
