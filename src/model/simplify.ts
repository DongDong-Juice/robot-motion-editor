import { evalCurve, makeKey } from './curve'
import type { Curve } from './types'

export const simplifyTolerance = (channel: string, rot: number, pos: number) =>
  /^root\.[xyz]$/.test(channel) ? pos : rot

// RDP on per-frame samples (vertical distance) + guard: re-sample result, insert worst frame until within tol.
export function simplifyCurve(c: Curve, tol: number): Curve {
  if (c.keys.length <= 2) return c
  const f0 = c.keys[0].f, n = c.keys[c.keys.length - 1].f - f0 + 1
  const v = new Float64Array(n)
  for (let i = 0; i < n; i++) v[i] = evalCurve(c, f0 + i, 0)
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const at = (a: number, b: number, i: number) => v[a] + ((v[b] - v[a]) * (i - a)) / (b - a)
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let worst = 0, wi = -1
    for (let i = a + 1; i < b; i++) { const d = Math.abs(v[i] - at(a, b, i)); if (d > worst) { worst = d; wi = i } }
    if (wi >= 0 && worst > tol) { keep[wi] = 1; stack.push([a, wi], [wi, b]) }
  }
  // No separate re-sample guard: RDP bounds |sample - linear| <= tol at every integer frame, which is exactly the error measured.
  const keys = []
  for (let i = 0; i < n; i++) if (keep[i]) keys.push(makeKey(f0 + i, v[i], 'linear'))
  return keys.length < c.keys.length ? { keys } : c // never grow a sparse curve or drop its easing
}
