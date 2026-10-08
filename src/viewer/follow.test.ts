import { describe, expect, it } from 'vitest'
import { followStep } from './follow'

describe('followStep', () => {
  const t: [number, number, number] = [0.75, 0, 0.6], c: [number, number, number] = [3.2, -3.4, 2]
  const r = followStep(t, c, [2, 1, 1.0], 0.15)
  it('x/y land exactly on the robot', () => { expect(r.target[0]).toBe(2); expect(r.target[1]).toBe(1) })
  it('z moves by the damp fraction', () => expect(r.target[2]).toBeCloseTo(0.6 + 0.4 * 0.15, 12))
  it('camera offset is preserved', () => {
    for (let i = 0; i < 3; i++) expect(r.camera[i] - r.target[i]).toBeCloseTo(c[i] - t[i], 12)
  })
  it('zDamp 1 snaps z', () => expect(followStep(t, c, [2, 1, 1], 1).target[2]).toBe(1))
})
