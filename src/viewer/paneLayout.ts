export type Side = 'left' | 'right' | 'top' | 'bottom'
export interface Rect { x: number; y: number; w: number; h: number }

export const clampRatio = (r: number) => Math.min(0.8, Math.max(0.2, r))

/** Stage edge nearest the pointer (ties: left, right, top, bottom). */
export function dockSide(x: number, y: number, w: number, h: number): Side {
  const d: [Side, number][] = [['left', x], ['right', w - x], ['top', y], ['bottom', h - y]]
  return d.reduce((a, b) => (b[1] < a[1] ? b : a))[0]
}

/** Video pane docked at `side` taking `ratio` of the stage; robot pane gets the rest. */
export function paneRects(side: Side, ratio: number, w: number, h: number): { video: Rect; robot: Rect } {
  const r = clampRatio(ratio)
  const vw = w * r, vh = h * r
  switch (side) {
    case 'left': return { video: { x: 0, y: 0, w: vw, h }, robot: { x: vw, y: 0, w: w - vw, h } }
    case 'right': return { video: { x: w - vw, y: 0, w: vw, h }, robot: { x: 0, y: 0, w: w - vw, h } }
    case 'top': return { video: { x: 0, y: 0, w, h: vh }, robot: { x: 0, y: vh, w, h: h - vh } }
    case 'bottom': return { video: { x: 0, y: h - vh, w, h: vh }, robot: { x: 0, y: 0, w, h: h - vh } }
  }
}
