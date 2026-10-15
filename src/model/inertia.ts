import { evalCurve } from './curve'
import type { Clip } from './types'
import type { RobotDef } from '../robot/types'
import { footContact } from './legIk'

// 관성 구간 (spec docs/superpowers/specs/2026-10-14-inertia-lead-in-design.md): how far back from a cut the 기본자세 lead-in
// should join the original motion, so the transition from the standing pose meets a calm frame instead of a fast one.

export const INERTIA_MAX = 90 // auto search range (1.5 s)
export const INERTIA_FAR = 180 // no frame with every foot down within 1.5 s: look back up to 3 s for one
const SMOOTH = 4 // ± frames of the moving average (9 frames)

export type InertiaWhy = 'still' | 'quiet' | 'trough' | 'min' | 'review' | 'start' | 'far' | 'air'
export const INERTIA_WHY: Record<InertiaWhy, string> = {
  still: '멈춤', quiet: '조용한 지점', trough: '움직임 바닥', min: '범위 내 최소', review: '검토 필요', start: '앞에 원본 없음',
  far: '두 발 딛는 지점(1.5초 넘게 앞)', air: '발이 떠 있음 · 검토 필요',
}

// legs and waist carry the body (GO2: every joint is a leg), arms less, wrists hardly
const weight = (def: RobotDef, n: string) => def.kind === 'go2' || /hip|knee|ankle|waist/.test(n) ? 1 : /wrist/.test(n) ? 0.2 : 0.5

const energyCache = new WeakMap<Clip, { E: Float64Array; Q: number }>()
/** Motion amount per clip frame (weighted joint speed rad/s + 3 × pelvis speed m/s + yaw rate rad/s, 9-frame average) and the
 * clip's quiet level Q (its 20th percentile). Cached per clip object (clips are structurally shared, edits make new objects). */
export function motionEnergy(clip: Clip, def: RobotDef): { E: Float64Array; Q: number } {
  const hit = energyCache.get(clip)
  if (hit) return hit
  const N = Math.max(clip.length, 1), raw = new Float64Array(N)
  const series = (n: string, fb = 0) => {
    const c = clip.channels[n], out = new Float64Array(N)
    for (let f = 0; f < N; f++) out[f] = c ? evalCurve(c, f, fb) : fb
    return out
  }
  const add = (s: Float64Array, w: number) => { for (let f = 0; f + 1 < N; f++) raw[f] += w * Math.abs(s[f + 1] - s[f]) * 60 }
  def.joints.forEach(j => add(series(j.name), weight(def, j.name)))
  const x = series('root.x'), y = series('root.y'), z = series('root.z', def.standingHeight)
  for (let f = 0; f + 1 < N; f++) raw[f] += 3 * Math.hypot(x[f + 1] - x[f], y[f + 1] - y[f], z[f + 1] - z[f]) * 60
  add(series('root.yaw'), 1)
  if (N > 1) raw[N - 1] = raw[N - 2]
  const E = new Float64Array(N)
  for (let f = 0; f < N; f++) {
    let s = 0, n = 0
    for (let k = -SMOOTH; k <= SMOOTH; k++) if (f + k >= 0 && f + k < N) { s += raw[f + k]; n++ }
    E[f] = s / n
  }
  const sorted = Float64Array.from(E).sort(), r = { E, Q: sorted[Math.floor(0.2 * (N - 1))] }
  energyCache.set(clip, r)
  return r
}

/** Auto 관성 length (frames) before clip frame c: walk back to the nearest quiet frame or motion trough within 1.5 s; failing that
 * the calmest frame in range ('review' when even that is still clearly moving). Never reaches before the clip start.
 * Only frames where every foot is on the floor count (footContact; user: the foot must not hang in the air and then jump into
 * the motion), so the 전이 always lands on real footholds; none within 1.5 s → the nearest within 3 s ('far'); none at all →
 * the calmest frame, flagged 'air'. */
export function autoInertia(clip: Clip, def: RobotDef, c: number): { len: number; why: InertiaWhy } {
  if (c <= 0) return { len: 0, why: 'start' }
  const { E, Q } = motionEnergy(clip, def), fc = footContact(clip, def)
  const down = (f: number) => !fc || fc.support[f] === 1
  c = Math.min(c, E.length - 1)
  if (E[c] <= Q && down(c)) return { len: 0, why: 'still' }
  const lim = Math.max(0, c - INERTIA_MAX)
  for (let f = c - 1; f >= lim; f--) {
    if (!down(f)) continue
    if (E[f] <= Q) return { len: c - f, why: 'quiet' }
    if (E[f] <= 0.3 * E[c] && E[f] <= E[Math.max(f - 1, 0)] && E[f] <= E[f + 1]) return { len: c - f, why: 'trough' }
  }
  let m = -1
  for (let f = c; f >= lim; f--) if (down(f) && (m < 0 || E[f] < E[m])) m = f
  if (m >= 0) return { len: c - m, why: E[m] <= 0.5 * E[c] || E[m] <= 2 * Q ? 'min' : 'review' }
  for (let f = lim - 1; f >= Math.max(0, c - INERTIA_FAR); f--) if (down(f)) return { len: c - f, why: 'far' }
  m = c
  for (let f = c - 1; f >= lim; f--) if (E[f] < E[m]) m = f
  return { len: c - m, why: 'air' }
}
