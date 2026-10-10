export interface Segment { from: number; to: number; maxPct: number; maxTorque: number }

export function warnSegments(pct: Float32Array, torque: Float32Array, warnPct: number): Segment[] {
  const runs: Segment[] = []
  let cur: Segment | null = null
  for (let i = 0; i < pct.length; i++) {
    if (pct[i] > warnPct) {
      if (!cur) runs.push(cur = { from: i, to: i, maxPct: pct[i], maxTorque: torque[i] })
      cur.to = i; cur.maxPct = Math.max(cur.maxPct, pct[i]); cur.maxTorque = Math.max(cur.maxTorque, torque[i])
    } else cur = null
  }
  const merged: Segment[] = []
  for (const r of runs) {
    const p = merged[merged.length - 1]
    if (p && r.from - p.to - 1 <= 6) { p.to = r.to; p.maxPct = Math.max(p.maxPct, r.maxPct); p.maxTorque = Math.max(p.maxTorque, r.maxTorque) }
    else merged.push(r)
  }
  return merged.filter(s => s.to - s.from + 1 >= 3)
}
