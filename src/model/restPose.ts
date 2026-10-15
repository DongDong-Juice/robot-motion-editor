import { evalCurve, makeKey } from './curve'
import type { RobotDefs } from './evaluate'
import type { Clip, Curve, Item, Key, Project } from './types'
import type { RobotDef } from '../robot/types'
import { autoInertia, type InertiaWhy } from './inertia'
import { itemClip } from './itemClip'
import { footContact, footMat, legsOf, reachDrop, rootMat, solveLeg, STEP_FAST, STEP_OK, stepLength, stepPlan, stepSpeed } from './legIk'

export const REST_HOLD = 30 // frames held at the rest pose (0.5 s); 덧붙이기 default, 덮어쓰기 max
export const REST_BLEND = 60 // frames easing back into the motion (1 s); 덧붙이기 default, 덮어쓰기 max
const MAX_DROP = 0.15 // m the pelvis may go below its blended height so a leg reaches its foothold
const PELVIS_FIRST = 0.5 // share of the 전이 in which the pelvis reaches the motion's height when the feet step
export const HOLD_RANGE = [0, 180] as const, BLEND_RANGE = [0, 180] as const, INERTIA_CAP = 180 // per-piece 덧붙이기 limits (frames); 전이 0 = snap (export warns)
const AUTO_BLEND = [15, 180] as const // 전이 자동 search range

const ROOT = ['root.x', 'root.y', 'root.z', 'root.roll', 'root.pitch', 'root.yaw']
// The 기본자세 (차렷) value of a channel: the robot's rest joint angles and floor height; roll/pitch 0 (x/y/yaw are kept by the callers).
const restValue = (def: RobotDef, n: string) => n === 'root.z' ? def.rest.z : def.rest.q[def.joints.findIndex(j => j.name === n)] ?? 0
const smooth = (t: number) => 3 * t * t - 2 * t * t * t

const VEL_SPAN = 10 // frames over which the motion's own speed shapes the end of the 전이
/** 전이 curve from R (still) into T arriving with slope v (per frame), at u ∈ [0, 1] of a `blend`-frame 전이: the motion's line
 * T + v·(f − a), bent to stay within v·VEL_SPAN of T (a fast start over a long 전이 must not swing far away), eased from R over
 * the first `reach` of the 전이. Zero speed at u = 0, slope v at u = 1. */
export function easeInto(R: number, T: number, v: number, blend: number, u: number, reach = 1): number {
  const line = T - v * VEL_SPAN * Math.tanh(blend * (1 - u) / VEL_SPAN)
  return line + (R - line) * (1 - smooth(Math.min(u / reach, 1)))
}
const lerp = (a: [number, number], b: [number, number], s: number): [number, number] => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]

// Clamp a handle to its segment like evalCurve does (sign: +1 out, -1 in).
const clampDf = (df: number, sign: 1 | -1, len: number) => { const d = Math.max(0, df * sign); return d > len ? len / d : 1 }

/** Split `ks` at frame f without changing the curve: returns the keys up to f and from f, each with a key at f. */
export function split(ks: Key[], f: number): [Key[], Key[]] {
  if (!ks.length) return [[], []]
  const i = ks.findIndex(k => k.f >= f)
  if (i >= 0 && ks[i].f === f) return [ks.slice(0, i + 1), ks.slice(i)]
  const k0 = i < 0 ? ks.at(-1) : ks[i - 1], k1 = i < 0 ? undefined : ks[i]
  if (!k0 || !k1) { const n = makeKey(f, (k0 ?? k1)!.v, 'linear'); return [[...ks.slice(0, i < 0 ? ks.length : i), n], [n, ...(i < 0 ? [] : ks.slice(i))]] }
  const n = makeKey(f, evalCurve({ keys: [k0, k1] }, f, 0), k0.interp === 'hold' ? 'hold' : 'linear')
  const L = ks.slice(0, i), R = ks.slice(i)
  if (k0.interp !== 'bezier') return [[...L, n], [n, ...R]]
  const len = k1.f - k0.f, so = clampDf(k0.outTan.df, 1, len), si = clampDf(k1.inTan.df, -1, len)
  const P: [number, number][] = [[k0.f, k0.v], [k0.f + k0.outTan.df * so, k0.v + k0.outTan.dv * so], [k1.f + k1.inTan.df * si, k1.v + k1.inTan.dv * si], [k1.f, k1.v]]
  let lo = 0, hi = 1
  for (let j = 0; j < 40; j++) { const m = (lo + hi) / 2; const u = 1 - m; const x = u * u * u * P[0][0] + 3 * u * u * m * P[1][0] + 3 * u * m * m * P[2][0] + m * m * m * P[3][0]; if (x < f) lo = m; else hi = m }
  const s = (lo + hi) / 2, q0 = lerp(P[0], P[1], s), q1 = lerp(P[1], P[2], s), q2 = lerp(P[2], P[3], s), r0 = lerp(q0, q1, s), r1 = lerp(q1, q2, s), p = lerp(r0, r1, s)
  n.v = p[1]
  const left = { ...k0, outTan: { df: q0[0] - P[0][0], dv: q0[1] - P[0][1] } }, right = { ...k1, inTan: { df: q2[0] - P[3][0], dv: q2[1] - P[3][1] } }
  const nl = { ...n, inTan: { df: r0[0] - f, dv: r0[1] - p[1] } }, nr = { ...n, interp: 'bezier' as const, outTan: { df: r1[0] - f, dv: r1[1] - p[1] } }
  return [[...L.slice(0, -1), left, nl], [nr, right, ...R.slice(1)]]
}

/** Bake a rest-pose start into clip frames [a, b): hold the standing pose, then ease back into the original motion.
 * Frames outside the baked window evaluate exactly as before. Returns a new clip; the input is untouched. */
export function applyRestPose(clip: Clip, def: RobotDef, a: number, b: number): Clip {
  const len = b - a, hold = Math.min(REST_HOLD, Math.floor(len / 3)), blend = Math.min(REST_BLEND, len - hold - 1), end = a + hold + blend
  const channels: Record<string, Curve> = { ...clip.channels }
  const names = [...ROOT, ...def.joints.map(j => j.name)]
  for (const n of names) {
    const orig = clip.channels[n] ?? { keys: [] }, fb = n === 'root.z' ? def.standingHeight : 0
    const o = (f: number) => evalCurve(orig, f, fb)
    const keep = n === 'root.x' || n === 'root.y' || n === 'root.yaw'
    const R = keep ? o(a) : restValue(def, n)
    const win: Key[] = []
    for (let f = a; f <= end; f++) {
      const s = f <= a + hold ? 0 : smooth((f - a - hold) / blend)
      win.push(makeKey(f, R + (o(f) - R) * s, 'linear'))
    }
    let ks = orig.keys
    const left = a > 0 ? split(ks, a - 1)[0] : []
    if (left.length) left[left.length - 1] = { ...left.at(-1)!, interp: 'linear' }
    const right = end + 1 <= clip.length - 1 ? split(ks, end + 1)[1] : ks.filter(k => k.f > end)
    channels[n] = { keys: [...left, ...win, ...right] }
  }
  return { ...clip, channels }
}

/** 기본자세 덧붙이기: insert hold + blend frames at clip frame `a` (hold the standing pose, then move into the motion at `a`
 * arriving with its velocity, so it carries on without a stop); everything from `a` on moves hold + blend frames later, unchanged.
 * With a 관성 구간 `a` is that many frames before the cut, so the original frames from `a` to the cut follow the transition.
 * Joints and z/roll/pitch: `easeInto` from the rest value (still) to the value and slope at `a`, clamped to the URDF limits.
 * x/y/yaw: stay at their value at `a` the whole time, so the body does not glide over the floor while only the joints
 * move (user-confirmed: no drift); the motion's own travel starts at `a`.
 * Legs: re-solved by IK during the 전이 so the feet never slide (user: "드리프트 하면 안된다") — each foot stays planted, or is
 * lifted and set down at its place in the motion's first frame, one foot after another (legIk.stepPlan).
 * Returns a new, longer clip. */
export function prependRestPose(clip: Clip, def: RobotDef, a: number, hold = REST_HOLD, blend = REST_BLEND): Clip {
  const P = hold + blend
  const channels: Record<string, Curve> = { ...clip.channels }
  const names = [...ROOT, ...def.joints.map(j => j.name)]
  const fbOf = (n: string) => n === 'root.z' ? def.standingHeight : 0
  const planted = legsOf(def).length > 0 && blend >= 2 // the legs are re-solved below (plantFeet)
  const vals: Record<string, number[]> = {} // lead-in value of each channel at a + k, k < P
  for (const n of names) {
    const orig = clip.channels[n] ?? { keys: [] }, fb = fbOf(n)
    const T = evalCurve(orig, a, fb)
    const v = a + 1 < clip.length ? evalCurve(orig, a + 1, fb) - T : a > 0 ? T - evalCurve(orig, a - 1, fb) : 0 // per frame
    const keep = n === 'root.x' || n === 'root.y' || n === 'root.yaw'
    const jd = def.joints.find(j => j.name === n)
    const R = keep ? T : restValue(def, n)
    // pelvis height with stepping feet: reach the motion's height in the first half (squat, then step: a planted leg can reach the
    // floor at a wide stance), then follow the motion's own slope into it. The tilt (roll/pitch) stays on the late curve, finishing
    // with the steps (a lean ahead of the feet would push the standing hip past its limit)
    const early = planted && n === 'root.z'
    const at = (u: number) => keep ? T
      : early ? Math.min(Math.max(R, T), easeInto(R, T, v, blend, u, PELVIS_FIRST)) // never above both ends
      : easeInto(R, T, v, blend, u)
    vals[n] = Array.from({ length: P }, (_, k) => { const y = k <= hold ? R : at((k - hold) / blend); return jd ? Math.min(Math.max(y, jd.lower), jd.upper) : y })
  }
  plantFeet(clip, def, a, hold, blend, vals)
  for (const n of names) {
    const orig = clip.channels[n] ?? { keys: [] }, fb = fbOf(n)
    const win: Key[] = vals[n].map((y, k) => makeKey(a + k, y, 'linear'))
    const ks = orig.keys.length ? orig.keys : [makeKey(a, fb, 'linear')]
    const left = a > 0 ? split(ks, a - 1)[0] : []
    if (left.length) left[left.length - 1] = { ...left.at(-1)!, interp: 'linear' }
    const right = split(ks, a)[1].map(k => ({ ...k, f: k.f + P }))
    channels[n] = { keys: [...left, ...win, ...right] }
  }
  return { ...clip, length: clip.length + P, channels }
}

/** Legs of the 전이 frames in `vals` re-solved so the feet go from the standing pose's footholds to the motion's first-frame
 * footholds by planted steps (no sliding); the pelvis and every other joint keep their blended values. */
function plantFeet(clip: Clip, def: RobotDef, a: number, hold: number, blend: number, vals: Record<string, number[]>) {
  const legs = legsOf(def)
  if (!legs.length || blend < 2) return // 전이 0 / 1 frame: a snap, nothing to plant
  const v = (n: string, k: number) => vals[n][k]
  const rootAt = (k: number) => rootMat(v('root.x', k), v('root.y', k), v('root.z', k), v('root.roll', k), v('root.pitch', k), v('root.yaw', k))
  const qAt = (k: number) => def.joints.map(j => v(j.name, k))
  const motionFeet = (f: number) => { // the clip's own feet at frame f
    const c = (n: string) => { const fb = n === 'root.z' ? def.standingHeight : 0, ch = clip.channels[n]; return ch ? evalCurve(ch, f, fb) : fb }
    const root = rootMat(c('root.x'), c('root.y'), c('root.z'), c('root.roll'), c('root.pitch'), c('root.yaw')), q = def.joints.map(j => c(j.name))
    return legs.map(l => footMat(l, root, q))
  }
  const to = motionFeet(a), next = a + 1 < clip.length ? motionFeet(a + 1) : to
  const vel = to.map((m, i) => [next[i][3] - m[3], next[i][7] - m[7], next[i][11] - m[11]]) // m per frame as the motion starts
  const plan = stepPlan(legs.map(l => footMat(l, rootAt(hold), qAt(hold))), to, legs[0].orient, vel, blend)
  const q = qAt(hold)
  const K0 = hold + 1, K1 = hold + blend // re-solved frames [K0, K1)
  const feetAt = Array.from({ length: K1 - K0 }, (_, i) => plan((K0 + i - hold) / blend))
  // pelvis: lower it where a foothold is out of the leg's reach from the blended height, by a smooth envelope of the needed drop
  // (widened, then averaged: no bobbing; tapered to 0 where the 전이 meets the hold and the motion), capped at MAX_DROP
  const W = 8, n = K1 - K0, zs = vals['root.z']
  const need = feetAt.map((feet, i) => Math.min(MAX_DROP, Math.max(0, ...legs.map((l, j) => reachDrop(l, rootAt(K0 + i), feet[j])))))
  const env = need.map((_, i) => Math.max(...need.slice(Math.max(0, i - W), Math.min(n, i + W + 1))))
  const avg = (x: number[]) => x.map((_, i) => { let t = 0, c = 0; for (let j = Math.max(0, i - W); j < Math.min(n, i + W + 1); j++) { t += x[j]; c++ } return t / c })
  const taper = (k: number) => smooth(Math.min(1, (k - hold) / (W + 1), (K1 - k) / (W + 1))) // eased: no kink in pelvis speed
  avg(avg(env)).forEach((d, i) => { zs[K0 + i] -= d * taper(K0 + i) })
  // legs of every frame, seeded with the blended angles (keeps the knee on its bending side)
  const solved: number[][] = def.joints.map(() => new Array<number>(n).fill(0)), legJoints = legs.flatMap(l => l.qis)
  for (let k = K0; k < K1; k++) {
    for (const qi of legJoints) q[qi] = vals[def.joints[qi].name][k]
    const root = rootAt(k)
    legs.forEach((l, i) => solveLeg(def, l, root, feetAt[k - K0][i], q))
    for (const qi of legJoints) solved[qi][k - K0] = q[qi]
  }
  for (const qi of legJoints) for (let k = K0; k < K1; k++) vals[def.joints[qi].name][k] = solved[qi][k - K0]
}

const TAIL_WIN = 240 // frames before the piece's end the 끝 기본자세 looks at (its 전이 and steps only need the last few)
const revCache = new WeakMap<Clip, Map<string, Clip>>()
/** The last min(b − a, TAIL_WIN) frames before clip frame b, played backwards (frame 0 = b − 1), sampled per frame. The 끝
 * 기본자세 is the 덧붙이기 lead-in of this reversed motion, played forwards: same 전이, same planted steps, no drift. Cached. */
function reversedEnd(clip: Clip, def: RobotDef, a: number, b: number): Clip {
  let m = revCache.get(clip)
  if (!m) revCache.set(clip, m = new Map())
  const k = `${a}:${b}`, hit = m.get(k)
  if (hit) return hit
  const W = Math.max(1, Math.min(b - a, TAIL_WIN)), channels: Record<string, Curve> = {}
  for (const n of [...ROOT, ...def.joints.map(j => j.name)]) {
    const orig = clip.channels[n] ?? { keys: [] }, fb = n === 'root.z' ? def.standingHeight : 0
    channels[n] = { keys: Array.from({ length: W }, (_, f) => makeKey(f, evalCurve(orig, b - 1 - f, fb), 'linear')) }
  }
  const r: Clip = { ...clip, id: `${clip.id}#rev`, length: W, channels }
  m.set(k, r)
  return r
}

/** 끝 기본자세 (set on both pieces of a cut): after the piece's last frame b − 1, a 전이 into the standing pose, then hold it
 * `hold` frames. The time-mirror of prependRestPose: the 전이 leaves the motion with its velocity, x/y/yaw stay at the last
 * frame's (no drift), the legs step by IK without sliding. Returns a new clip: frames up to b − 1 as before, then the
 * blend + hold tail frames (length b + blend + hold; frames after b of the original are dropped). */
export function appendRestPose(clip: Clip, def: RobotDef, a: number, b: number, hold = REST_HOLD, blend = REST_BLEND): Clip {
  const P = hold + blend, rev = prependRestPose(reversedEnd(clip, def, a, b), def, 0, hold, blend)
  const channels: Record<string, Curve> = { ...clip.channels }
  for (const n of [...ROOT, ...def.joints.map(j => j.name)]) {
    const orig = clip.channels[n] ?? { keys: [] }, fb = n === 'root.z' ? def.standingHeight : 0
    const ks = orig.keys.length ? orig.keys : [makeKey(0, fb, 'linear')]
    const left = split(ks, b - 1)[0]
    left[left.length - 1] = { ...left.at(-1)!, interp: 'linear' }
    const tail = Array.from({ length: P }, (_, k) => makeKey(b + k, evalCurve(rev.channels[n], P - 1 - k, fb), 'linear'))
    channels[n] = { keys: [...left, ...tail] }
  }
  return { ...clip, length: b + P, channels }
}

const tailCache = new WeakMap<Clip, Map<string, Clip>>()
export function tailClipFor(clip: Clip, def: RobotDef, a: number, b: number, hold: number, blend: number): Clip {
  let m = tailCache.get(clip)
  if (!m) tailCache.set(clip, m = new Map())
  const k = `${a}:${b}:${hold}:${blend}`
  let r = m.get(k)
  if (!r) m.set(k, r = appendRestPose(clip, def, a, b, hold, blend))
  return r
}

export interface Tail { hold: number; blend: number; tail: number; blendOver: boolean }
/** The 끝 기본자세 of an item: 전이 (auto, from the joint velocity limits like 덧붙이기 'auto') then 정지 0.5 s, in frames. */
export function tailOf(item: Item, clip: Clip, def: RobotDef): Tail {
  const ab = autoBlend(reversedEnd(clip, def, item.trimIn, item.trimOut), def, 0)
  return { hold: REST_HOLD, blend: ab.blend, tail: REST_HOLD + ab.blend, blendOver: ab.over }
}

/** 끝 기본자세 frames of an item in project `p` (null unless restTail). */
export function itemTail(p: Project, defs: RobotDefs, item: Item): Tail | null {
  const clip = item.restTail ? itemClip(p, defs, item) : undefined
  return clip ? tailOf(item, clip, defs[clip.robot]) : null
}

/** The clip a piece's preview and CSV play from: the piece as it plays (수정 층), with its 끝 기본자세 appended. */
export function tailedClip(p: Project, defs: RobotDefs, item: Item): Clip | undefined {
  const clip = itemClip(p, defs, item), tl = itemTail(p, defs, item)
  return clip && tl ? tailClipFor(clip, defs[clip.robot], item.trimIn, item.trimOut, tl.hold, tl.blend) : clip
}

export type RestMode = true | 'prepend' // true: overwrite [a, b) (no UI since 덮어쓰기 was removed; kept for the bake tests)

// Memoized bake: the same clip object, window and mode give the same derived clip (preview redraws every frame).
// Overwrite bakes [a, b); prepend inserts hold + blend frames before a (b unused).
const cache = new WeakMap<Clip, Map<string, Clip>>()
export function restClipFor(clip: Clip, def: RobotDef, a: number, b: number, mode: RestMode = true, hold = REST_HOLD, blend = REST_BLEND): Clip {
  if (mode === true && b - a < 3) return clip // too short to hold a pose
  let m = cache.get(clip)
  if (!m) cache.set(clip, m = new Map())
  const k = mode === 'prepend' ? `p${a}:${hold}:${blend}` : `${a}:${b}`
  let r = m.get(k)
  if (!r) m.set(k, r = mode === 'prepend' ? prependRestPose(clip, def, a, hold, blend) : applyRestPose(clip, def, a, b))
  return r
}

/** Shallow project copy where only `itemId` plays its overwrite rest-pose clip (temporary clip id); the input is untouched. */
export function withRestPose(p: Project, defs: RobotDefs, itemId: string): Project {
  const tracks = p.sequence.tracks.map(t => {
    const it = t.items.find(i => i.id === itemId)
    return it ? { t, it } : null
  }).find(Boolean)
  if (!tracks) return p
  const { it } = tracks, clip = itemClip(p, defs, it)!, id = `${clip.id}#rest:${itemId}`
  return {
    ...p, clips: { ...p.clips, [id]: { ...restClipFor(clip, defs[clip.robot], it.trimIn, it.trimOut), id } },
    sequence: { ...p.sequence, tracks: p.sequence.tracks.map(t => ({ ...t, items: t.items.map(i => i.id === itemId ? { ...i, refId: id } : i) })) },
  }
}

const clampI = (v: number, lo: number, hi: number) => Math.min(Math.max(Math.round(v), lo), hi)

const blendCache = new WeakMap<Clip, Map<number, { blend: number; over: boolean }>>()
/** Shortest transition (frames, AUTO_BLEND in steps of 6) from the standing pose into clip frame `a` with time for its steps (feet
 * under 1.2 m/s) and whose 전이 curve (easeInto) keeps
 * every joint at ≤ 50% of its URDF velocity limit; `over` when even the longest one does not. Cached per clip and frame. */
export function autoBlend(clip: Clip, def: RobotDef, a: number): { blend: number; over: boolean } {
  let m = blendCache.get(clip)
  if (!m) blendCache.set(clip, m = new Map())
  const hit = m.get(a)
  if (hit) return hit
  const js = def.joints.map((j, i) => {
    const c = clip.channels[j.name], T = c ? evalCurve(c, a, 0) : 0
    const v = !c ? 0 : a + 1 < clip.length ? evalCurve(c, a + 1, 0) - T : a > 0 ? T - evalCurve(c, a - 1, 0) : 0
    return { R: def.rest.q[i] ?? 0, T, v, lim: 0.5 * j.velocity / 60 } // rad per frame
  })
  const steps = stepLength(clip, def, a)
  const ok = (B: number) => stepSpeed(steps, B) <= STEP_OK && js.every(({ R, T, v, lim }) => {
    for (let k = 0; k < B; k++) { // per-frame change of the 전이 curve in prependRestPose
      if (Math.abs(easeInto(R, T, v, B, (k + 1) / B) - easeInto(R, T, v, B, k / B)) > lim) return false
    }
    return true
  })
  let r: { blend: number; over: boolean } = { blend: AUTO_BLEND[1], over: true }
  for (let B = AUTO_BLEND[0]; B <= AUTO_BLEND[1]; B += 6) if (ok(B)) { r = { blend: B, over: false }; break }
  m.set(a, r)
  return r
}

export interface Lead { hold: number; blend: number; inertia: number; lead: number; why: InertiaWhy | null; blendOver: boolean
  airborne: boolean // a foot is in the air where the lead-in joins the motion
  stepFast: boolean // the 전이 is too short for its steps (feet faster than 1.5 m/s)
}
/** The 덧붙이기 lead-in of an item: 차렷 정지 → 전이 → 관성 (original frames trimIn − inertia … trimIn − 1), in frames.
 * Missing fields are the defaults (hold 0.5 s, blend 1 s, 관성 auto); `why` is the auto reason, null when set by hand. */
export function leadOf(item: Item, clip: Clip, def: RobotDef): Lead {
  const hold = clampI(item.restHold ?? REST_HOLD, HOLD_RANGE[0], HOLD_RANGE[1])
  const auto = item.inertia === undefined ? autoInertia(clip, def, item.trimIn) : null
  const inertia = clampI(auto ? auto.len : item.inertia!, 0, Math.min(INERTIA_CAP, item.trimIn))
  const ab = item.restBlend === 'auto' ? autoBlend(clip, def, item.trimIn - inertia) : null
  const blend = ab ? ab.blend : clampI(typeof item.restBlend === 'number' ? item.restBlend : REST_BLEND, BLEND_RANGE[0], BLEND_RANGE[1])
  const fc = footContact(clip, def), join = Math.min(Math.max(item.trimIn - inertia, 0), clip.length - 1)
  return { hold, blend, inertia, lead: hold + blend + inertia, why: auto?.why ?? null, blendOver: !!ab?.over, airborne: !!fc && !fc.support[join],
    stepFast: stepSpeed(stepLength(clip, def, join), blend) > STEP_FAST }
}

/** Lead-in frames of an item in project `p` (0 unless 덧붙이기). */
export function itemLead(p: Project, defs: RobotDefs, item: Item): Lead | null {
  const clip = item.restPose === 'prepend' ? itemClip(p, defs, item) : undefined // the piece as it plays (with its 수정 층)
  return clip ? leadOf(item, clip, defs[clip.robot]) : null
}
