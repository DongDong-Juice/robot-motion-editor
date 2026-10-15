import { evalCurve } from './curve'
import type { Clip } from './types'
import type { RobotDef, Vec3 } from '../robot/types'

// Feet that stay planted during the 기본자세 전이 (user: "드리프트 하면 안된다"): the legs are solved by IK so each foot either
// stays where it stands or is lifted and set down at its new place, one foot at a time, instead of gliding over the floor.

type M = number[] // 4x4 row-major
const mul = (a: M, b: M): M => {
  const r = new Array<number>(16).fill(0)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j]
  return r
}
// URDF origin: translate(xyz) · Rz(yaw) Ry(pitch) Rx(roll); the root pose uses the same ZYX order (rootMath.eulerToQuat)
export function originMat([x, y, z]: Vec3, [r, p, w]: Vec3): M {
  const [cr, sr, cp, sp, cy, sy] = [Math.cos(r), Math.sin(r), Math.cos(p), Math.sin(p), Math.cos(w), Math.sin(w)]
  return [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, x, sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, y, -sp, cp * sr, cp * cr, z, 0, 0, 0, 1]
}
function axisMat([x, y, z]: Vec3, q: number): M {
  const c = Math.cos(q), s = Math.sin(q), t = 1 - c
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0, 0, 0, 0, 1]
}

interface Link { xyz: Vec3; rpy: Vec3; axis?: Vec3; qi?: number } // qi: index in def.joints (revolute)
export interface Leg { foot: string; chain: Link[]; qis: number[]; orient: boolean }

const FEET: Record<RobotDef['kind'], { feet: string[]; orient: boolean }> = {
  g1: { feet: ['left_ankle_roll_link', 'right_ankle_roll_link'], orient: true }, // 6-DoF legs: foot position and tilt
  go2: { feet: ['FL_foot', 'FR_foot', 'RL_foot', 'RR_foot'], orient: false }, // 3-DoF legs: foot point only
}

const legCache = new WeakMap<RobotDef, Leg[]>()
/** Joint chains from the root link down to each foot; [] when the model has no such feet. */
export function legsOf(def: RobotDef): Leg[] {
  const hit = legCache.get(def)
  if (hit) return hit
  const all = [...def.joints.map((j, i) => ({ ...j, qi: i as number | undefined })), ...def.fixedJoints.map(j => ({ ...j, qi: undefined }))]
  const legs: Leg[] = []
  for (const foot of FEET[def.kind].feet) {
    const chain: Link[] = []
    let link = foot
    while (link !== def.rootLink) {
      const j = all.find(x => x.child === link)
      if (!j) break
      chain.unshift(j.qi === undefined ? { xyz: j.xyz, rpy: j.rpy } : { xyz: j.xyz, rpy: j.rpy, axis: j.axis, qi: j.qi })
      link = j.parent
    }
    if (link === def.rootLink) legs.push({ foot, chain, qis: chain.flatMap(c => c.qi === undefined ? [] : [c.qi]), orient: FEET[def.kind].orient })
  }
  legCache.set(def, legs.length === FEET[def.kind].feet.length ? legs : [])
  return legCache.get(def)!
}

/** Root (pelvis) world matrix from x, y, z, roll, pitch, yaw. */
export const rootMat = (x: number, y: number, z: number, roll: number, pitch: number, yaw: number) => originMat([x, y, z], [roll, pitch, yaw])

/** World matrix of a foot for joint angles q (all joints, def order). */
export function footMat(leg: Leg, root: M, q: ArrayLike<number>): M {
  let m = root
  for (const c of leg.chain) { m = mul(m, originMat(c.xyz, c.rpy)); if (c.axis) m = mul(m, axisMat(c.axis, q[c.qi!])) }
  return m
}

const MAX_STEP = 0.1 // rad per IK iteration
const KNEE_SEED = 0.3 // rad
const ROT_W = 0.2 // a radian of foot tilt weighs like 0.2 m (about a foot length)
// pose error target − current: position, then (when orient) the rotation vector of Rt·Rcᵀ, both in world axes
function err(t: M, c: M, orient: boolean): number[] {
  const e = [t[3] - c[3], t[7] - c[7], t[11] - c[11]]
  if (!orient) return e
  const R = (i: number, j: number) => t[i * 4] * c[j * 4] + t[i * 4 + 1] * c[j * 4 + 1] + t[i * 4 + 2] * c[j * 4 + 2] // (Rt Rcᵀ)ij
  const tr = R(0, 0) + R(1, 1) + R(2, 2), ang = Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2)))
  const v = [R(2, 1) - R(1, 2), R(0, 2) - R(2, 0), R(1, 0) - R(0, 1)], s = Math.sin(ang)
  const k = ang < 1e-9 ? 0.5 : ang / (2 * s) // v = 2 sin(ang) · axis → axis · ang
  return [...e, ...v.map(x => x * k * ROT_W)]
}

function solve(A: number[][], b: number[]): number[] { // Gaussian elimination, small dense
  const n = b.length, M2 = A.map((r, i) => [...r, b[i]])
  for (let i = 0; i < n; i++) {
    let p = i
    for (let r = i + 1; r < n; r++) if (Math.abs(M2[r][i]) > Math.abs(M2[p][i])) p = r
    ;[M2[i], M2[p]] = [M2[p], M2[i]]
    for (let r = i + 1; r < n; r++) { const f = M2[r][i] / M2[i][i]; for (let c = i; c <= n; c++) M2[r][c] -= f * M2[i][c] }
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) { let s = M2[i][n]; for (let c = i + 1; c < n; c++) s -= M2[i][c] * x[c]; x[i] = s / M2[i][i] }
  return x
}

/** Damped least-squares IK: moves this leg's joints in `q` (in place) so the foot reaches `target`; joint limits kept. */
export function solveLeg(def: RobotDef, leg: Leg, root: M, target: M, q: number[], iters = 60) {
  const lam2 = 1e-3
  // a straight knee is singular (it cannot tell up from down): start from a slightly bent one so the solver bends it forwards
  for (const i of leg.qis) if (/knee/.test(def.joints[i].name) && q[i] < KNEE_SEED) q[i] = KNEE_SEED
  for (let it = 0; it < iters; it++) {
    const e = err(target, footMat(leg, root, q), leg.orient)
    if (Math.hypot(...e) < 1e-7) return
    const J = leg.qis.map(i => { // numeric Jacobian columns
      const d = 1e-6, s = q[i]; q[i] = s + d
      const ej = err(target, footMat(leg, root, q), leg.orient); q[i] = s
      return e.map((v, r) => (v - ej[r]) / d)
    })
    const m = e.length, JJt = Array.from({ length: m }, (_, r) => Array.from({ length: m }, (_, c) => J.reduce((s, col) => s + col[r] * col[c], 0) + (r === c ? lam2 : 0)))
    const y = solve(JJt, e), dq = J.map(col => col.reduce((s, v, r) => s + v * y[r], 0))
    const sc = Math.min(1, MAX_STEP / (Math.max(...dq.map(Math.abs)) || 1)) // small steps: no jump to another leg branch near a straight knee
    leg.qis.forEach((i, ci) => {
      const j = def.joints[i]
      q[i] = Math.min(Math.max(q[i] + dq[ci] * sc, j.lower), j.upper)
    })
  }
}

// --- foot path: stay planted, or lift and set down within its own window of the transition ---
const quatOf = (m: M): [number, number, number, number] => { // rotation part → xyzw
  const t = m[0] + m[5] + m[10]
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; return [(m[9] - m[6]) / s, (m[2] - m[8]) / s, (m[4] - m[1]) / s, 0.25 * s] }
  if (m[0] > m[5] && m[0] > m[10]) { const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2; return [0.25 * s, (m[1] + m[4]) / s, (m[2] + m[8]) / s, (m[9] - m[6]) / s] }
  if (m[5] > m[10]) { const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2; return [(m[1] + m[4]) / s, 0.25 * s, (m[6] + m[9]) / s, (m[2] - m[8]) / s] }
  const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2; return [(m[2] + m[8]) / s, (m[6] + m[9]) / s, 0.25 * s, (m[4] - m[1]) / s]
}
function slerp(a: number[], b: number[], t: number) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const bb = d < 0 ? b.map(v => -v) : b; d = Math.abs(d)
  if (d > 0.9995) { const r = a.map((v, i) => v + (bb[i] - v) * t), n = Math.hypot(...r); return r.map(v => v / n) }
  const th = Math.acos(d), s = Math.sin(th)
  return a.map((v, i) => (Math.sin((1 - t) * th) * v + Math.sin(t * th) * bb[i]) / s)
}
const matOf = ([x, y, z, w]: number[], p: number[]): M => [
  1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), p[0], 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), p[1],
  2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), p[2], 0, 0, 0, 1]
const smooth = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)

const LIFT_FIRST = 0.15
export const STEP_LIFT = 0.05 // m the swinging foot rises at most (mid-swing) above the path between its two places
const lift = (d: number) => Math.min(STEP_LIFT, Math.max(0.02, 0.3 * d)) // a short step lifts less (2 cm at least)
const STILL = { pos: 0.01, rot: 0.05 } // a foot that moves less than this just eases in place

/** Planned foot matrices for transition progress u ∈ [0, 1]: from `from` (standing pose) to `to` (motion start).
 * Feet that must move are lifted and set down one after another (farthest first, a foot whose target is in the air last),
 * each in a share of [0.1, 1] as long as its step (the last one ends as the motion starts). A foot whose place is in the air ends
 * its swing with `toVel` (the motion's foot velocity there, m per frame; `frames` = transition length), so it carries on without a
 * stop; a foot on the floor lands straight down and stands still. */
export function stepPlan(from: M[], to: M[], orient: boolean, toVel: number[][] = to.map(() => [0, 0, 0]), frames = 1): (u: number) => M[] {
  const dist = from.map((f, i) => Math.hypot(to[i][3] - f[3], to[i][7] - f[7], to[i][11] - f[11]))
  const rot = from.map((f, i) => { const a = quatOf(f), b = quatOf(to[i]); return 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) })
  const air = (i: number) => to[i][11] > from[i][11] + CONTACT.up ? 1 : 0 // target in the air: swing it last, arriving as the motion starts
  const moving = from.map((_, i) => i).filter(i => dist[i] > STILL.pos || (orient && rot[i] > STILL.rot)).sort((a, b) => air(a) - air(b) || dist[b] - dist[a])
  // windows one after another over [0.1, 1], each as long as its foot has to travel (a long step gets more time); the last one
  // runs into the motion: no pause before it, arriving with its speed
  const share = moving.map(i => Math.max(dist[i], 0.1)), total = share.reduce((x, y) => x + y, 0)
  let at = 0.1
  const win = new Map(moving.map((i, k) => { const w = [at, at + 0.9 * share[k] / total]; at = w[1]; return [i, w] }))
  return u => from.map((f, i) => {
    const w = win.get(i), t = w ? (u - w[0]) / (w[1] - w[0]) : u, s = smooth(t)
    // cubic Hermite: still at the start, at the end the motion's own foot velocity (m per frame → per window)
    // a swinging foot lifts before it travels and stops travelling before it sets down (LIFT_FIRST of its window each), so it never
    // scrapes the floor; only a foot that is in the air where the motion starts swings on into it, with the motion's own speed
    const moves = air(i) === 1, t0 = w ? LIFT_FIRST : 0, t1 = w && !moves ? 1 - LIFT_FIRST : 1, v = moves ? toVel[i] : [0, 0, 0]
    const tc = Math.min(Math.max((t - t0) / (t1 - t0), 0), 1)
    const h01 = tc * tc * (3 - 2 * tc), h11 = tc ** 3 - tc * tc, span = (w ? w[1] - w[0] : 1) * (t1 - t0) * frames
    const p = [0, 1, 2].map(c => f[c * 4 + 3] + (to[i][c * 4 + 3] - f[c * 4 + 3]) * h01 + h11 * span * v[c])
    if (w && t > 0 && t < 1) p[2] += lift(dist[i]) * Math.sin(Math.PI * t) ** 2 // lift and set down softly (no vertical speed at either end)
    p[2] = Math.max(p[2], Math.min(f[11], to[i][11])) // never below its lower foothold (the speed term can dip under the floor)
    return matOf(slerp(quatOf(f), quatOf(to[i]), s), p)
  })
}

// --- foot contact in a clip: which frames have every foot on the floor (a place a lead-in may join the motion) ---
export const CONTACT = { up: 0.04, speed: 0.002 } // ankle up to 4 cm above the clip's floor (heel may be up), foot speed under 0.12 m/s

const contactCache = new WeakMap<Clip, { z: Float64Array[]; ground: number; support: Uint8Array } | null>()
/** Per frame: each foot's height, the clip's floor (ankle height when standing: a low percentile of every foot height),
 * and `support` = 1 where every foot is on the floor and not sliding, standing (pelvis at least half the 차렷 height: not sitting
 * or lying on the floor, which a lead-in from 차렷 cannot step into). null when the robot has no feet model. Cached per clip. */
export function footContact(clip: Clip, def: RobotDef) {
  if (contactCache.has(clip)) return contactCache.get(clip)!
  const legs = legsOf(def)
  if (!legs.length) { contactCache.set(clip, null); return null }
  const N = Math.max(clip.length, 1)
  const ch = (n: string, fb = 0) => { const c = clip.channels[n], o = new Float64Array(N); for (let f = 0; f < N; f++) o[f] = c ? evalCurve(c, f, fb) : fb; return o }
  const r = ['root.x', 'root.y', 'root.z', 'root.roll', 'root.pitch', 'root.yaw'].map(n => ch(n, n === 'root.z' ? def.standingHeight : 0))
  const used = new Set(legs.flatMap(l => l.qis)), qs = def.joints.map((j, i) => used.has(i) ? ch(j.name) : null)
  const pos = legs.map(() => ({ x: new Float64Array(N), y: new Float64Array(N), z: new Float64Array(N) }))
  const q = new Array<number>(def.joints.length).fill(0)
  for (let f = 0; f < N; f++) {
    qs.forEach((s, i) => { if (s) q[i] = s[f] })
    const root = rootMat(r[0][f], r[1][f], r[2][f], r[3][f], r[4][f], r[5][f])
    legs.forEach((l, i) => { const m = footMat(l, root, q); pos[i].x[f] = m[3]; pos[i].y[f] = m[7]; pos[i].z[f] = m[11] })
  }
  const all = Float64Array.from(pos.flatMap(p => Array.from(p.z))).sort(), ground = all[Math.floor(0.02 * (all.length - 1))]
  const support = new Uint8Array(N)
  for (let f = 0; f < N; f++) {
    const a = Math.max(0, f - 2), b = Math.min(N - 1, f + 2)
    support[f] = r[2][f] >= 0.5 * def.rest.z && pos.every(p => p.z[f] < ground + CONTACT.up && Math.hypot(p.x[b] - p.x[a], p.y[b] - p.y[a], p.z[b] - p.z[a]) / Math.max(b - a, 1) < CONTACT.speed) ? 1 : 0
  }
  const res = { z: pos.map(p => p.z), ground, support }
  contactCache.set(clip, res)
  return res
}

// --- reach: how much lower the pelvis must be for a leg to reach a foothold (the leg length, hip to ankle, stretched) ---
const reachCache = new WeakMap<Leg, number>()
const hipOf = (leg: Leg, root: M) => mul(root, originMat(leg.chain[0].xyz, leg.chain[0].rpy)) // the first leg joint
/** Pelvis drop (m, ≥ 0) that brings `foot` within this leg's reach (with a margin, so the knee stays a little bent); 0 when it
 * already is, and when lowering cannot help (the foothold is sideways out of reach). */
export function reachDrop(leg: Leg, root: M, foot: M): number {
  let L = reachCache.get(leg)
  if (L === undefined) { // hip → ankle at every joint 0 (legs straight), from an identity root
    const id = originMat([0, 0, 0], [0, 0, 0]), h = hipOf(leg, id), f = footMat(leg, id, new Array(64).fill(0))
    reachCache.set(leg, L = 0.995 * Math.hypot(f[3] - h[3], f[7] - h[7], f[11] - h[11]))
  }
  const h = hipOf(leg, root), dx = foot[3] - h[3], dy = foot[7] - h[7], dz = h[11] - foot[11], side = Math.hypot(dx, dy)
  if (Math.hypot(side, dz) <= L || side >= L) return 0
  return dz - Math.sqrt(L * L - side * side)
}

// --- step speed: how fast the planned steps go for a 전이 of `blend` frames joining clip frame a ---
export const STEP_FAST = 0.025 // m per frame (1.5 m/s): above this the 전이 is too short for its steps (warned)
export const STEP_OK = 0.02 // m per frame (1.2 m/s): 전이 자동 leaves at least this much time for the steps
const stepCache = new WeakMap<Clip, Map<number, number>>()
/** Total step length (each moving foot, at least 0.1 m: its share of the 전이) from the 차렷 footholds under the pelvis at frame a
 * to the clip's own footholds at a; 0 for robots without a feet model. Cached per clip and frame. */
export function stepLength(clip: Clip, def: RobotDef, a: number): number {
  const legs = legsOf(def)
  if (!legs.length) return 0
  let m = stepCache.get(clip)
  if (!m) stepCache.set(clip, m = new Map())
  const hit = m.get(a)
  if (hit !== undefined) return hit
  const c = (n: string) => { const fb = n === 'root.z' ? def.standingHeight : 0, ch = clip.channels[n]; return ch ? evalCurve(ch, a, fb) : fb }
  const from = legs.map(l => footMat(l, rootMat(c('root.x'), c('root.y'), def.rest.z, 0, 0, c('root.yaw')), def.rest.q))
  const to = legs.map(l => footMat(l, rootMat(c('root.x'), c('root.y'), c('root.z'), c('root.roll'), c('root.pitch'), c('root.yaw')), def.joints.map(j => c(j.name))))
  const d = from.map((f, i) => Math.hypot(to[i][3] - f[3], to[i][7] - f[7], to[i][11] - f[11])).filter(x => x > STILL.pos)
  const r = d.reduce((s, x) => s + Math.max(x, 0.1), 0)
  m.set(a, r)
  return r
}
/** Peak planned foot speed (m per frame) of a `blend`-frame 전이 whose steps total `len` (smoothstep peak = 1.5 × average). */
export const stepSpeed = (len: number, blend: number) => blend > 0 ? 1.5 * len / (0.9 * (1 - 2 * LIFT_FIRST) * blend) : len > 0 ? Infinity : 0
