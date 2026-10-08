import { describe, expect, it } from 'vitest'
import { clampRatio, dockSide, equalRatios, moveDivider, paneRects, rowWidths } from './paneLayout'

describe('dockSide', () => {
  it('picks the nearest edge', () => {
    expect(dockSide(10, 300, 1000, 600)).toBe('left')
    expect(dockSide(990, 300, 1000, 600)).toBe('right')
    expect(dockSide(500, 5, 1000, 600)).toBe('top')
    expect(dockSide(500, 595, 1000, 600)).toBe('bottom')
  })
  it('center of a wide stage is top/bottom (shorter distance)', () => {
    expect(dockSide(500, 100, 1000, 600)).toBe('top')
    expect(dockSide(500, 500, 1000, 600)).toBe('bottom')
  })
})

describe('clampRatio', () => {
  it('clamps to 0.2..0.8', () => {
    expect(clampRatio(0)).toBe(0.2)
    expect(clampRatio(1)).toBe(0.8)
    expect(clampRatio(0.5)).toBe(0.5)
  })
})

describe('paneRects', () => {
  it('left: video on the left', () => {
    expect(paneRects('left', 0.25, 1000, 600)).toEqual({ video: { x: 0, y: 0, w: 250, h: 600 }, robot: { x: 250, y: 0, w: 750, h: 600 } })
  })
  it('right: video on the right', () => {
    expect(paneRects('right', 0.25, 1000, 600)).toEqual({ video: { x: 750, y: 0, w: 250, h: 600 }, robot: { x: 0, y: 0, w: 750, h: 600 } })
  })
  it('top / bottom', () => {
    expect(paneRects('top', 0.5, 1000, 600)).toEqual({ video: { x: 0, y: 0, w: 1000, h: 300 }, robot: { x: 0, y: 300, w: 1000, h: 300 } })
    expect(paneRects('bottom', 0.5, 1000, 600)).toEqual({ video: { x: 0, y: 300, w: 1000, h: 300 }, robot: { x: 0, y: 0, w: 1000, h: 300 } })
  })
  it('clamps the ratio', () => {
    expect(paneRects('left', 5, 1000, 600).video.w).toBe(800)
  })
})

describe('pane row', () => {
  it('equal ratios and pixel widths net of dividers', () => {
    expect(equalRatios(3)).toEqual([1 / 3, 1 / 3, 1 / 3])
    expect(rowWidths([0.5, 0.25, 0.25], 412, 6)).toEqual([200, 100, 100])
  })
  it('a divider moves only its two neighbours, each kept >= 15%', () => {
    expect(moveDivider([0.5, 0.25, 0.25], 0, 0.1).map(r => +r.toFixed(3))).toEqual([0.6, 0.15, 0.25])
    expect(moveDivider([0.5, 0.25, 0.25], 0, 0.3).map(r => +r.toFixed(3))).toEqual([0.6, 0.15, 0.25])
    expect(moveDivider([0.5, 0.25, 0.25], 1, -0.5).map(r => +r.toFixed(3))).toEqual([0.5, 0.15, 0.35])
    expect(moveDivider([0.5, 0.5], 0, -1).map(r => +r.toFixed(3))).toEqual([0.15, 0.85])
  })
})
