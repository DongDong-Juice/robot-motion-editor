import type { Curve, Interp, Key, Tan } from './types';

export function makeKey(f: number, v: number, interp: Interp = 'bezier'): Key {
  return { f, v, interp, inTan: { df: -10, dv: 0 }, outTan: { df: 10, dv: 0 } };
}

// Clamp handle df into [0, len] (sign: +1 out, -1 in); dv scaled by same ratio.
function clampTan(t: Tan, sign: 1 | -1, len: number): Tan {
  const df = Math.max(0, t.df * sign);
  const s = df > len ? len / df : 1;
  return { df: df * s * sign, dv: t.dv * s };
}

export function evalCurve(c: Curve, f: number, fallback: number): number {
  const ks = c.keys;
  if (ks.length === 0) return fallback;
  if (f <= ks[0].f) return ks[0].v;
  const last = ks[ks.length - 1];
  if (f >= last.f) return last.v;
  // binary search: last key with k.f <= f (f < last.f guarantees i+1 exists, k1.f > f)
  let lo0 = 0, hi0 = ks.length - 1;
  while (hi0 - lo0 > 1) { const m = (lo0 + hi0) >> 1; if (ks[m].f <= f) lo0 = m; else hi0 = m; }
  const i = lo0;
  const k0 = ks[i], k1 = ks[i + 1];
  if (k0.interp === 'hold') return k0.v;
  const len = k1.f - k0.f;
  if (k0.interp === 'linear') return k0.v + ((k1.v - k0.v) * (f - k0.f)) / len;
  const o = clampTan(k0.outTan, 1, len), n = clampTan(k1.inTan, -1, len);
  const x1 = k0.f + o.df, x2 = k1.f + n.df;
  const y1 = k0.v + o.dv, y2 = k1.v + n.dv;
  const bez = (a: number, b: number, c2: number, d: number, s: number) => {
    const u = 1 - s;
    return u * u * u * a + 3 * u * u * s * b + 3 * u * s * s * c2 + s * s * s * d;
  };
  let lo = 0, hi = 1;
  for (let j = 0; j < 30; j++) {
    const mid = (lo + hi) / 2;
    if (bez(k0.f, x1, x2, k1.f, mid) < f) lo = mid; else hi = mid;
  }
  return bez(k0.v, y1, y2, k1.v, (lo + hi) / 2);
}
