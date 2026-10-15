import type { Range } from '../model/rangeEdit'
import { getEditor } from '../store/store'
import { frameToX, xToFrame, type TimeScale } from './timeScale'

// 구간 (clip-view time axis = clip frames): the band drawn over the ruler and the rows, and Shift+drag on the ruler to pick it.

/** Band of `r` from y `top` to `h`: [a, b] tinted, the 가감 frames on each side lighter, edges as lines. */
export function drawRangeBand(ctx: CanvasRenderingContext2D, sc: TimeScale, r: Range, top: number, h: number, left: number, w: number, color: string) {
  const x = (f: number) => frameToX(sc, f)
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, w - left, h - top); ctx.clip()
  ctx.fillStyle = color
  ctx.globalAlpha = 0.07; ctx.fillRect(x(r.a - r.fade), top, x(r.a) - x(r.a - r.fade), h - top); ctx.fillRect(x(r.b + 1), top, x(r.b + 1 + r.fade) - x(r.b + 1), h - top)
  ctx.globalAlpha = 0.16; ctx.fillRect(x(r.a), top, x(r.b + 1) - x(r.a), h - top)
  ctx.globalAlpha = 0.8; ctx.fillRect(Math.round(x(r.a)), top, 1, h - top); ctx.fillRect(Math.round(x(r.b + 1)), top, 1, h - top)
  ctx.restore()
}

/** Shift+press on the ruler: drag out a 구간 from the pressed clip frame (keeps the current 가감). Returns true when handled. */
export function startRangeDrag(e: MouseEvent, x: number, sc: () => TimeScale, posX: (m: MouseEvent) => number,
  drag: (mv: (m: MouseEvent) => void, up: (m: MouseEvent) => void) => void): boolean {
  if (!e.shiftKey) return false
  const st = getEditor().getState(), fade = st.range?.fade ?? 15
  const at = (px: number) => Math.round(xToFrame(sc(), px))
  const a = at(x)
  st.setRange({ a, b: a, fade })
  drag(m => getEditor().getState().setRange({ a, b: at(posX(m)), fade }), () => {})
  return true
}
