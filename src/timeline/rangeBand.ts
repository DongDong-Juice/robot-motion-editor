import type { Range } from '../model/rangeEdit'
import { getEditor } from '../store/store'
import { frameToX, xToFrame, type TimeScale } from './timeScale'
import { itemLead, itemTail } from '../model/restPose'
import type { Item } from '../model/types'

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

/** Clip view of piece `it` (clip frames): everything outside it and its lead-in / 끝 기본자세 blank, those sections tinted and
 *  labelled (기본자세 · 전이 · 관성 before it, 전이 · 기본자세 after it), from y `top` to `h`. */
export function drawPieceBounds(ctx: CanvasRenderingContext2D, sc: TimeScale, it: Item, top: number, h: number, left: number, w: number,
  C: { bg: string; text: string; rest: string; blend: string; inertia: string }) {
  const s = getEditor().getState(), ld = itemLead(s.project, s.defs, it), tl = itemTail(s.project, s.defs, it)
  const x = (f: number) => frameToX(sc, f), a = it.trimIn - (ld?.lead ?? 0), b = it.trimOut + (tl?.tail ?? 0)
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, w - left, h - top); ctx.clip()
  ctx.fillStyle = C.bg; ctx.fillRect(left, top, x(a) - left, h - top); ctx.fillRect(x(b), top, w - x(b), h - top)
  const spans: [string, string, number, number][] = []
  if (ld) spans.push(['기본자세', C.rest, a, a + ld.hold], ['전이', C.blend, a + ld.hold, a + ld.hold + ld.blend], ['관성', C.inertia, it.trimIn - ld.inertia, it.trimIn])
  if (tl) spans.push(['전이', C.blend, it.trimOut, it.trimOut + tl.blend], ['기본자세', C.rest, it.trimOut + tl.blend, b])
  ctx.font = '11px "IBM Plex Sans KR", sans-serif'; ctx.textBaseline = 'top'
  for (const [label, c, f0, f1] of spans) {
    if (f1 <= f0) continue
    ctx.globalAlpha = 0.12; ctx.fillStyle = c; ctx.fillRect(x(f0), top, x(f1) - x(f0), h - top)
    ctx.globalAlpha = 1; if (x(f1) - Math.max(x(f0), left) > ctx.measureText(label).width + 8) ctx.fillText(label, Math.max(x(f0), left) + 4, top + 3)
  }
  ctx.restore()
}
/** Lowest scroll frame of the clip-view window: 0, or the open piece's lead-in start when that is before clip frame 0. */
export function minScrollF(): number {
  const s = getEditor().getState(), it = s.editing ? s.project.sequence.tracks.flatMap(t => t.items).find(i => i.id === s.editing) : undefined
  return it ? Math.min(0, it.trimIn - (itemLead(s.project, s.defs, it)?.lead ?? 0)) : 0
}
