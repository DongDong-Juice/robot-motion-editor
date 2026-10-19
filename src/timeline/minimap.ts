// Sequence minimap: the strip under the lanes (where the horizontal scrollbar was) showing the whole sequence, with the visible
// window as a box. Drag inside = scroll, drag an edge = zoom with the other edge fixed, click outside = centre there, double-click =
// fit the whole sequence (Premiere's zoom scrollbar).

export const MM_H = 24 // strip height, px
export const PPF_MIN = 0.5, PPF_MAX = 40 // the timeline's zoom limits (px per frame)
const EDGE = 5 // px either side of a window edge that grabs it

// x0..x1 = the strip (track area), total = frames it shows (the sequence plus half a screen, at least to the window's end), vis = the
// visible window in frames. Frozen at a press so a zoom drag does not rescale the strip under the pointer.
export interface MmGeom { x0: number; x1: number; total: number; vis: number }
export function mmGeom(x0: number, x1: number, end: number, scrollF: number, ppf: number): MmGeom {
  const vis = (x1 - x0) / ppf
  return { x0, x1, vis, total: Math.max(end + vis / 2, scrollF + vis, 1) }
}
export const mmX = (g: MmGeom, f: number) => g.x0 + f / g.total * (g.x1 - g.x0)
export const mmF = (g: MmGeom, x: number) => (x - g.x0) / (g.x1 - g.x0) * g.total

export type MmHit = 'left' | 'right' | 'move' | 'outside'
export function mmHit(g: MmGeom, scrollF: number, x: number): MmHit {
  const a = mmX(g, scrollF), b = mmX(g, scrollF + g.vis)
  if (Math.abs(x - a) <= EDGE && x <= (a + b) / 2) return 'left'
  if (Math.abs(x - b) <= EDGE) return 'right'
  return x > a && x < b ? 'move' : 'outside'
}

/** The window after dragging `kind` by dx px from `at` (both from the press). Width limits follow the zoom limits. */
export function mmDrag(g: MmGeom, at: { scrollF: number; vis: number }, kind: 'left' | 'right' | 'move', dx: number): { scrollF: number; vis: number } {
  const df = dx / (g.x1 - g.x0) * g.total, view = g.x1 - g.x0, lo = view / PPF_MAX, hi = view / PPF_MIN
  const clampW = (w: number) => Math.min(Math.max(w, lo), hi)
  if (kind === 'move') return { scrollF: Math.min(Math.max(at.scrollF + df, 0), Math.max(0, g.total - at.vis)), vis: at.vis }
  if (kind === 'right') return { scrollF: at.scrollF, vis: clampW(at.vis + df) }
  const right = at.scrollF + at.vis, left = Math.max(0, right - clampW(right - (at.scrollF + df)))
  return { scrollF: left, vis: right - left }
}

/** Whole sequence in a `view` px wide track area. */
export const mmFit = (view: number, end: number) => ({ scrollF: 0, ppf: Math.min(Math.max(view / Math.max(end, 1), PPF_MIN), PPF_MAX) })

export interface MmTrack { color: string; spans: [number, number][] } // one line per track: its items as frame spans
export interface MmMarks { frame: number; inF: number | null; outF: number | null; markers: number[] }

export function drawMinimap(ctx: CanvasRenderingContext2D, g: MmGeom, y: number, scrollF: number, tracks: MmTrack[], m: MmMarks,
  label: string, labelW: number, hover: MmHit | null, drag: boolean, C: { bg: string; panel: string; line: string; text: string; accent: string; dim: string }) {
  const h = MM_H, x = (f: number) => mmX(g, f)
  ctx.save()
  ctx.fillStyle = C.bg; ctx.fillRect(0, y, g.x1 + 20, h)
  ctx.fillStyle = C.line; ctx.fillRect(0, y, g.x1 + 20, 1)
  ctx.font = '10px "IBM Plex Sans KR", sans-serif'; ctx.fillStyle = C.dim; ctx.textBaseline = 'middle'
  ctx.fillText(label, 8, y + h / 2, labelW - 12)
  ctx.beginPath(); ctx.rect(g.x0, y + 1, g.x1 - g.x0, h - 1); ctx.clip()
  if (m.inF !== null || m.outF !== null) { // In/Out
    const a = x(m.inF ?? 0), b = m.outF !== null ? x(m.outF) : g.x1
    ctx.fillStyle = C.text; ctx.globalAlpha = 0.07; ctx.fillRect(a, y + 1, b - a, h - 1); ctx.globalAlpha = 1
  }
  const n = Math.max(tracks.length, 1), lane = Math.min(4, (h - 6) / n), top = y + (h - lane * n) / 2
  tracks.forEach((t, i) => { // one thin line of bars per track
    ctx.fillStyle = t.color; ctx.globalAlpha = 0.8
    for (const [a, b] of t.spans) ctx.fillRect(x(a), top + i * lane, Math.max(x(b) - x(a), 1), Math.max(lane - 1, 1))
  })
  ctx.globalAlpha = 1; ctx.fillStyle = C.dim
  for (const f of m.markers) ctx.fillRect(Math.round(x(f)), y + 1, 1, 3)
  const a = x(scrollF), b = x(scrollF + g.vis) // the visible window: the rest dimmed, the window boxed
  ctx.fillStyle = C.bg; ctx.globalAlpha = 0.45; ctx.fillRect(g.x0, y + 1, a - g.x0, h - 1); ctx.fillRect(b, y + 1, g.x1 - b, h - 1)
  ctx.globalAlpha = drag || hover === 'move' ? 1 : 0.75; ctx.strokeStyle = C.accent; ctx.lineWidth = 1
  ctx.strokeRect(Math.round(a) + 0.5, y + 2.5, Math.max(Math.round(b - a) - 1, 2), h - 4)
  if (hover === 'left' || hover === 'right') { ctx.globalAlpha = 1; ctx.fillStyle = C.accent; ctx.fillRect(Math.round(hover === 'left' ? a : b) - 1, y + 2, 3, h - 3) }
  ctx.globalAlpha = 1; ctx.fillStyle = C.accent; ctx.fillRect(Math.round(x(m.frame)), y + 1, 1, h - 1) // playhead
  ctx.restore()
}
