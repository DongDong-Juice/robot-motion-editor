// Vertical scrollbar drawn on a timeline canvas (sequence lanes, clip-view channel rows): a slim rounded thumb at the
// right edge, only while the rows overflow. Wider on hover, accent while dragged.

export const SB_W = 12 // hit width at the canvas' right edge
const SB_MIN = 24 // smallest thumb

export interface SbGeom { top: number; view: number; maxY: number; ty: number; th: number }

// Thumb geometry for rows of `total` px shown from `top` to `H`, scrolled by `scrollY`; null when everything fits.
export function sbGeom(top: number, H: number, total: number, scrollY: number): SbGeom | null {
  const view = H - top
  if (total <= view || view <= 0) return null
  const maxY = total - view, th = Math.max(SB_MIN, view * view / total)
  return { top, view, maxY, th, ty: top + (view - th) * Math.min(Math.max(scrollY, 0), maxY) / maxY }
}

export function drawScrollbar(ctx: CanvasRenderingContext2D, W: number, g: SbGeom, hover: boolean, drag: boolean,
  C: { panel: string; text: string; accent: string }) {
  const w = hover || drag ? 8 : 5, x = W - SB_W / 2 - w / 2
  ctx.save()
  ctx.fillStyle = C.panel; ctx.globalAlpha = hover || drag ? 0.9 : 0.5
  ctx.beginPath(); ctx.roundRect(x, g.top + 2, w, g.view - 4, w / 2); ctx.fill()
  ctx.fillStyle = drag ? C.accent : C.text; ctx.globalAlpha = drag ? 0.9 : hover ? 0.55 : 0.3
  ctx.beginPath(); ctx.roundRect(x, g.ty + 2, w, g.th - 4, w / 2); ctx.fill()
  ctx.restore()
}

// Mouse down on the bar at canvas y (x for the horizontal bar): a click on the groove pages toward it, then the thumb follows the mouse.
// Cancelling (Ctrl+Z / Esc during the drag) restores the scroll from before the press.
export function pressScrollbar(g: SbGeom, y: number, scrollY: number, set: (v: number) => void, dragging: (on: boolean) => void,
  track: (mv: (e: MouseEvent) => void, up: (e: MouseEvent) => void, cancel: () => void) => void, yOf: (e: MouseEvent) => number) {
  const clamp = (v: number) => Math.min(g.maxY, Math.max(0, v)), y0 = scrollY, perPx = g.maxY / (g.view - g.th)
  const from = y < g.ty || y > g.ty + g.th ? clamp(scrollY + (y < g.ty ? -g.view : g.view)) : clamp(scrollY)
  set(from); dragging(true)
  track(m => set(clamp(from + (yOf(m) - y) * perPx)), () => dragging(false), () => { set(y0); dragging(false) })
}
