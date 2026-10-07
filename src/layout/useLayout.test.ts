import { describe, expect, it } from 'vitest'
import { clampLayout } from './useLayout'

describe('clampLayout', () => {
  it('keeps in-range values', () => {
    expect(clampLayout({ left: 220, right: 280, bottom: 300 }, 1600, 900)).toEqual({ left: 220, right: 280, bottom: 300 })
  })
  it('clamps each to its bounds', () => {
    expect(clampLayout({ left: 10, right: 10, bottom: 10 }, 1600, 900)).toEqual({ left: 160, right: 220, bottom: 160 })
    expect(clampLayout({ left: 999, right: 999, bottom: 999 }, 2400, 900)).toEqual({ left: 480, right: 520, bottom: 900 - 32 - 200 })
  })
  it('guarantees stage width >= 320 by shrinking left/right', () => {
    const c = clampLayout({ left: 480, right: 520, bottom: 300 }, 1024, 700)
    expect(1024 - c.left - c.right).toBeGreaterThanOrEqual(320)
    expect(c.left).toBeGreaterThanOrEqual(160)
    expect(c.right).toBeGreaterThanOrEqual(220)
    const d = clampLayout({ left: 160, right: 520, bottom: 300 }, 700, 700)
    expect(700 - d.left - d.right).toBeGreaterThanOrEqual(320)
  })
  it('prefer: drag of one side takes the overflow from that side only', () => {
    const c = clampLayout({ left: 480, right: 300, bottom: 300 }, 1024, 700, 'left')
    expect(c).toEqual({ left: 1024 - 320 - 300, right: 300, bottom: 300 })
    const d = clampLayout({ left: 300, right: 520, bottom: 300 }, 1024, 700, 'right')
    expect(d).toEqual({ left: 300, right: 1024 - 320 - 300, bottom: 300 })
    const e = clampLayout({ left: 200, right: 520, bottom: 300 }, 700, 700, 'left') // left already at floor-ish: other side gives the rest
    expect(700 - e.left - e.right).toBeGreaterThanOrEqual(320)
  })
  it('small window: never below minimums', () => {
    const c = clampLayout({ left: 300, right: 300, bottom: 500 }, 500, 300)
    expect(c.left).toBe(160); expect(c.right).toBe(220); expect(c.bottom).toBe(160)
  })
})
