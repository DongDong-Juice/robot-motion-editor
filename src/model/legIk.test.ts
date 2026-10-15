import { expect, test } from 'vitest'
import { loadDef } from '../test/defs'
import { footMat, legsOf, rootMat, solveLeg } from './legIk'

// Each leg reaches a foot pose taken from a nearby reachable configuration, within joint limits (G1: position + tilt, GO2: point).
for (const [k, n] of [['g1', 2], ['go2', 4]] as const) test(`solveLeg reaches a reachable foot target (${k})`, () => {
  const def = loadDef(k), legs = legsOf(def), root = rootMat(0.1, -0.2, def.rest.z, 0.05, -0.03, 0.4)
  expect(legs).toHaveLength(n)
  for (const leg of legs) {
    const moved = [...def.rest.q]
    for (const i of leg.qis) { const j = def.joints[i]; moved[i] = Math.min(Math.max(moved[i] + 0.15, j.lower), j.upper) }
    const target = footMat(leg, root, moved), q = [...def.rest.q]
    solveLeg(def, leg, root, target, q)
    const got = footMat(leg, root, q)
    expect(Math.hypot(got[3] - target[3], got[7] - target[7], got[11] - target[11])).toBeLessThan(1e-4)
    if (leg.orient) for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect(Math.abs(got[i] - target[i])).toBeLessThan(1e-3)
    for (const i of leg.qis) { const j = def.joints[i]; expect(q[i]).toBeGreaterThanOrEqual(j.lower); expect(q[i]).toBeLessThanOrEqual(j.upper) }
    q.forEach((v, i) => { if (!leg.qis.includes(i)) expect(v).toBe(def.rest.q[i]) }) // other joints untouched
  }
})
