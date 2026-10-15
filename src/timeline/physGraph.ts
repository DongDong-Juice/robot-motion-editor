import { itemFrameRange, restLead } from '../export/csv'
import type { RobotDefs } from '../model/evaluate'
import type { Item, Project } from '../model/types'
import type { ItemPhys } from '../physics/physicsStore'
import type { Segment } from '../physics/segments'
import { frameToX, type TimeScale } from './timeScale'

export const WARN_RED = '#E5484D'
export const PHYS_NOTE = '참고 지표 (RL 정책 결과와 다를 수 있음)'

/** y of a % value in a strip [top, top+h]; 0..100 clamped, 100 at the top. */
export const pctY = (p: number, top: number, h: number) => top + h * (1 - Math.min(Math.max(p, 0), 100) / 100)

/** [x, pct] points for CSV frames placed at timeline frame f0+k, within [xa, xb]; one point per pixel column (its max). */
export function graphCols(pct: ArrayLike<number>, f0: number, sc: TimeScale, xa: number, xb: number): [number, number][] {
  const out: [number, number][] = []
  const k0 = Math.max(0, Math.floor((xa - sc.x0) / sc.pxPerFrame) - f0), k1 = Math.min(pct.length - 1, Math.ceil((xb - sc.x0) / sc.pxPerFrame) - f0)
  let col = NaN
  for (let k = k0; k <= k1; k++) {
    const x = frameToX(sc, f0 + k)
    if (x < xa || x > xb) continue
    const c = Math.floor(x), last = out[out.length - 1]
    if (c === col) last[1] = Math.max(last[1], pct[k])
    else { out.push([x, pct[k]]); col = c }
  }
  return out
}

export const segmentAt = (segs: Segment[], k: number) => segs.find(s => k >= s.from && k <= s.to) ?? null

/** Sequence frame of CSV frame k (exportItemCsv samples itemFrameRange; 기본자세 덧붙이기 adds restLead rows before it). */
export const seqFrameOf = (p: Project, defs: RobotDefs, item: Item, k: number) => itemFrameRange(item).from - restLead(p, defs, item) + k

export function badge(st: ItemPhys | undefined, stale: boolean): string | null {
  if (!st || st.status === 'queued' || st.status === 'running') return null
  if (st.status === 'error') return st.message ?? '오류'
  if (stale) return '오래됨'
  const m = st.metrics!
  return m.segments.length ? `⚠ ${m.segments.length}` : `✓ 평균 ${Math.round(m.meanPct)}% · 최대 ${Math.round(m.maxPct)}%`
}

export function treeSuffix(st: ItemPhys | undefined, stale: boolean): string {
  if (!st || st.status === 'queued' || st.status === 'running') return ''
  if (st.status === 'error') return ` · ${st.message ?? '오류'}`
  if (stale) return ' · 오래됨'
  const m = st.metrics!
  return ` · 최대 ${Math.round(m.maxPct)}%${m.segments.length ? ` ⚠${m.segments.length}` : ''}`
}

/** Short form of treeSuffix for a narrow lane label: "⚠3" (warn), "87%", "오래됨", or the error; '' while none. */
export function treeTag(st: ItemPhys | undefined, stale: boolean): { text: string; warn: boolean } {
  if (!st || st.status === 'queued' || st.status === 'running') return { text: '', warn: false }
  if (st.status === 'error') return { text: st.message ?? '오류', warn: false }
  if (stale) return { text: '오래됨', warn: false }
  const m = st.metrics!
  return m.segments.length ? { text: `⚠${m.segments.length}`, warn: true } : { text: `${Math.round(m.maxPct)}%`, warn: false }
}

/** Assist % line over [top, top+h], red warning spans behind it, dotted warning level. */
export function drawAssist(ctx: CanvasRenderingContext2D, pct: ArrayLike<number>, segs: Segment[], f0: number, sc: TimeScale,
  xa: number, xb: number, top: number, h: number, color: string, warnPct: number, stale: boolean) {
  ctx.save(); ctx.beginPath(); ctx.rect(xa, top, xb - xa, h); ctx.clip()
  const a0 = ctx.globalAlpha
  if (!stale) {
    ctx.fillStyle = WARN_RED; ctx.globalAlpha = 0.35 * a0
    for (const s of segs) { const a = frameToX(sc, f0 + s.from), b = frameToX(sc, f0 + s.to + 1); ctx.fillRect(a, top, b - a, h) }
    ctx.globalAlpha = a0
  }
  const wy = Math.round(pctY(warnPct, top, h)) + 0.5
  ctx.strokeStyle = stale ? '#8d96a3' : WARN_RED; ctx.lineWidth = 1; ctx.setLineDash([2, 2])
  ctx.beginPath(); ctx.moveTo(xa, wy); ctx.lineTo(xb, wy); ctx.stroke(); ctx.setLineDash([])
  ctx.strokeStyle = stale ? '#8d96a3' : color; ctx.beginPath()
  graphCols(pct, f0, sc, xa, xb).forEach(([x, p], i) => { const y = pctY(p, top, h); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
  ctx.stroke(); ctx.restore()
}
