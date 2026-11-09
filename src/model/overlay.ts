// 부위 얹기 1차 (수정변동사항.md §26, spec docs/superpowers/specs/2026-11-09-part-overlay-design.md): another block's movement laid
// over some body parts of a piece — 덮어쓰기 (those joints take the source's values) or 더하기 (the source's movement from its first
// frame added) — joints only (the body / root stays the piece's), inside [at, at + len) of the piece's clip frames, faded in and out.
// A range (공중에 있는 부위): what lifts a supporting foot or changes the body tilt is B, only reported (사용자: 실기·시뮬 차이 —
// 막지 않음). Physical limits (관절 한계 · 속도 · 바닥 뚫림 · 부위 충돌 · hip 54°) are 빨강: an edit is refused, an overlay made red
// by another change is not played (the piece plays without it). Pure: clips / poses in, frames and a report out.
import { evaluateClip, type Pose } from './pose'
import { quatToEuler } from './rootMath'
import type { Clip } from './types'
import type { RobotDef } from '../robot/types'
import { feetOf, WALK } from './walk'
import { legsOf } from './legIk'
import { STEP } from './transition'
import { BODY_PAIRS, HAND_PAIR, GO2_LEG_PAIRS, pairDepths, pairName } from '../review/collide'

export type OverlayMode = 'replace' | 'add'
export interface Overlay {
  id: string
  src: string // clip id (same robot, this project's 목록)
  srcA: number; srcB: number // source clip frames [srcA, srcB)
  at: number; len: number // piece clip frames [at, at + len)
  parts: string[] // body part names (RobotDef.groups)
  mode: OverlayMode
  weight: number // 0 < weight ≤ 1
  fade: number // frames faded in at the start and out at the end (inside the range)
  loop?: true // repeat the source range to fill len (else its last frame is held)
}
export type OverlayTone = 'ok' | 'warn' | 'bad'
export interface OverlayReport {
  tone: OverlayTone
  reasons: { tone: Exclude<OverlayTone, 'ok'>; text: string; b?: true /* B 범위: 몸통 보정이 필요한 경우 — 표시만 */ }[]
  vel: number // × motor velocity limit, the most on the overlaid joints
  gap: number | null // mm between the closest checked parts (− = into each other); null = not checked
  ground: number | null // m the overlaid feet stay above the floor at least
  held?: true // (a piece) 빨강 by another change: not played
}

export const OVERLAY = {
  limit: 1e-3, // rad over a joint limit = 빨강
  ground: 0.01, // m under the floor = 빨강
  contact: 0.012, // m: a foot this close to the floor is down
  collide: 5, // mm into each other = 빨강 (the 검수 목록's 기준)
  tilt: 15 * Math.PI / 180, // rad of body tilt between source and piece (덮어쓰기): B
  hip: WALK.hip, // GO2 hip: 48° warn, 54° bad
}
export const GO2_PART: Record<string, string> = { FL: '왼앞', FR: '오른앞', RL: '왼뒤', RR: '오른뒤' }
export const partLabel = (def: RobotDef, part: string) => def.kind === 'go2' ? GO2_PART[part] ?? part : part
const JOINT_KO: Record<string, string> = { hip: '고관절', thigh: '허벅지', calf: '무릎' }
export const jointLabel = (def: RobotDef, name: string) => {
  if (def.kind === 'go2') { const [leg, k] = name.split('_'); return `${GO2_PART[leg] ?? leg} ${JOINT_KO[k] ?? k}` }
  return name.replace(/_joint$/, '')
}
/** The joint indices of these parts. */
export function partJoints(def: RobotDef, parts: string[]): number[] {
  const names = new Set(def.groups.filter(g => parts.includes(g.name)).flatMap(g => g.joints))
  return def.joints.flatMap((j, i) => names.has(j.name) ? [i] : [])
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
/** The overlay's weight at piece clip frame f (0 outside [at, at + len)). */
export function weightAt(ov: Overlay, f: number): number {
  const k = f - ov.at
  if (k < 0 || k >= ov.len) return 0
  const fd = Math.min(ov.fade, Math.floor(ov.len / 2))
  const w = fd > 0 ? Math.min(smooth((k + 1) / (fd + 1)), smooth((ov.len - k) / (fd + 1))) : 1
  return w * ov.weight
}
/** The source frame played at piece clip frame f. */
export function srcFrameAt(ov: Overlay, f: number): number {
  const n = Math.max(ov.srcB - ov.srcA, 1), k = Math.max(f - ov.at, 0)
  return ov.loop ? ov.srcA + (k % n) : ov.srcA + Math.min(k, n - 1)
}

/** The frames the overlay changes (piece clip frames, inside [lo, hi)). */
export const overlayFrames = (ov: Overlay, lo: number, hi: number): [number, number] => [Math.max(lo, ov.at), Math.min(hi, ov.at + ov.len)]

/** The overlay laid on `under` (the piece's clip as it is under it) over the piece's clip frames [lo, hi): the joints it sets per
 * frame (clamped to the limits) and its report. `src` = the source clip as it plays (its 클립 수정 층 included). */
export function overlayResult(def: RobotDef, under: Clip, src: Clip, ov: Overlay, lo: number, hi: number): { frames: Map<number, number[]>; report: OverlayReport } {
  const frames = new Map<number, number[]>(), reasons: OverlayReport['reasons'] = []
  const idx = partJoints(def, ov.parts), [a, b] = overlayFrames(ov, lo, hi)
  if (!idx.length || b <= a) return { frames, report: { tone: 'warn', reasons: [{ tone: 'warn', text: b <= a ? '얹을 곳이 조각 밖이라 쓰이지 않음' : '부위를 고르세요' }], vel: 0, gap: null, ground: null } }
  // the frames judged: the range and one frame either side (its first / last step)
  const e0 = Math.max(lo, a - 1), e1 = Math.min(hi - 1, b)
  const base: Pose[] = [], out: Pose[] = [], raw: number[][] = []
  const s0 = evaluateClip(src, def, ov.srcA).q
  for (let f = e0; f <= e1; f++) {
    const p = evaluateClip(under, def, f), w = weightAt(ov, f), q = [...p.q], r = [...p.q]
    if (w > 0) {
      const s = evaluateClip(src, def, srcFrameAt(ov, f)).q
      for (const i of idx) {
        r[i] = ov.mode === 'replace' ? p.q[i] + w * (s[i] - p.q[i]) : p.q[i] + w * (s[i] - s0[i])
        q[i] = Math.min(Math.max(r[i], def.joints[i].lower), def.joints[i].upper)
      }
      frames.set(f, q)
    }
    base.push(p); out.push({ ...p, q }); raw.push(r)
  }
  const sec = (k: number) => `${((e0 + k) / 60).toFixed(1)}초`
  // 관절 한계
  let lim: { i: number; v: number; k: number } | null = null
  raw.forEach((r, k) => idx.forEach(i => {
    const j = def.joints[i], over = Math.max(j.lower - r[i], r[i] - j.upper)
    if (over > OVERLAY.limit && (!lim || over > Math.abs(lim.v))) lim = { i, v: over, k }
  }))
  if (lim) { const { i, k } = lim as { i: number; v: number; k: number }, j = def.joints[i], d = (x: number) => (x * 180 / Math.PI).toFixed(0)
    reasons.push({ tone: 'bad', text: `관절 한계 — ${jointLabel(def, j.name)} ${d(raw[k][i])}° (범위 ${d(j.lower)}~${d(j.upper)}°, ${sec(k)})` }) }
  // 관절 속도 · 가속 (only what the overlay adds over the piece's own)
  let vel = 0, velAt: { i: number; k: number } | null = null, acc = 0
  for (let k = 1; k < out.length; k++) for (const i of idx) {
    const j = def.joints[i], v = Math.abs(out[k].q[i] - out[k - 1].q[i]) * 60 / j.velocity, vb = Math.abs(base[k].q[i] - base[k - 1].q[i]) * 60 / j.velocity
    if (v > vb + 1e-6 && v > vel) { vel = v; velAt = { i, k } }
    if (def.kind === 'go2' && k + 1 < out.length) {
      const lim2 = WALK.acc[j.name.split('_')[1]]
      if (lim2) {
        const x = Math.abs(out[k + 1].q[i] - 2 * out[k].q[i] + out[k - 1].q[i]) * 3600 / lim2, xb = Math.abs(base[k + 1].q[i] - 2 * base[k].q[i] + base[k - 1].q[i]) * 3600 / lim2
        if (x > xb + 1e-6) acc = Math.max(acc, x)
      }
    }
  }
  if (velAt) {
    const name = jointLabel(def, def.joints[velAt.i].name), why = ov.fade < 12 ? ` (섞임 ${ov.fade}프레임이 짧음)` : ''
    if (vel > 1) reasons.push({ tone: 'bad', text: `관절 속도 — ${name} 모터 한계의 ${vel.toFixed(2)}배${why} (${sec(velAt.k)})` })
    else if (vel > STEP.vel) reasons.push({ tone: 'warn', text: `관절 속도 — ${name} 모터 한계의 ${vel.toFixed(2)}배 (권장 ${STEP.vel}배 이하)` })
  }
  if (acc > 1) reasons.push({ tone: 'warn', text: `관절 가속 — 실기 녹화 최대치의 ${acc.toFixed(1)}배` })
  // GO2 hip (new_rl 기준)
  if (def.kind === 'go2') {
    let hip = 0
    out.forEach((p, k) => idx.forEach(i => { if (/_hip_joint$/.test(def.joints[i].name) && Math.abs(p.q[i]) > Math.abs(base[k].q[i]) + 1e-6) hip = Math.max(hip, Math.abs(p.q[i])) }))
    if (hip > OVERLAY.hip[1]) reasons.push({ tone: 'bad', text: `hip ${(hip * 180 / Math.PI).toFixed(0)}° — new_rl 기준 54° 초과` })
    else if (hip > OVERLAY.hip[0]) reasons.push({ tone: 'warn', text: `hip ${(hip * 180 / Math.PI).toFixed(0)}° — new_rl 기준 48° 초과` })
  }
  // 바닥 · 받침 (the feet of the overlaid legs; the floor = the piece's lowest foot over these frames)
  const fb = base.map(p => feetOf(def, p).feet), fo = out.map(p => feetOf(def, p).feet)
  const floor = Math.min(...fb.flatMap(fs => fs.map(x => x[2])))
  let ground: number | null = null
  legsOf(def).forEach((leg, l) => { // feetOf order
    if (!leg.qis.some(qi => idx.includes(qi))) return // not an overlaid leg
    const part = def.groups.find(g => leg.qis.some(qi => g.joints.includes(def.joints[qi]?.name)))?.name ?? leg.foot
    let low = Infinity, lowK = 0, flip = -1
    for (let k = 0; k < fo.length; k++) {
      const z = fo[k][l][2] - floor
      if (z < low) { low = z; lowK = k }
      const db = fb[k][l][2] - floor < OVERLAY.contact, dn = z < OVERLAY.contact
      if (db !== dn && flip < 0) flip = k
    }
    ground = Math.min(ground ?? Infinity, low)
    const who = partLabel(def, part)
    if (low < -OVERLAY.ground) reasons.push({ tone: 'bad', text: `바닥 뚫림 — ${who} 발이 바닥 아래 ${(-low * 100).toFixed(1)} cm (${sec(lowK)})` })
    if (flip >= 0) reasons.push({ tone: 'warn', b: true, text: `B 범위 — ${who}이 ${sec(flip)}에 바닥에 ${fb[flip][l][2] - floor < OVERLAY.contact ? '서 있다가 뜸' : '닿음'} → 받침이 바뀜 · 몸통 보정 없음, 막지 않음` })
  })
  // 원본과 바탕의 몸 기울기 (덮어쓰기: the leg / arm points another way in the room)
  if (ov.mode === 'replace') {
    let d = 0, n = 0
    for (let k = 0; k < out.length; k++) {
      const f = e0 + k
      if (weightAt(ov, f) <= 0) continue
      const [r1, p1] = quatToEuler(evaluateClip(src, def, srcFrameAt(ov, f)).rootQuat), [r0, p0] = quatToEuler(base[k].rootQuat)
      d += Math.max(Math.abs(p1 - p0), Math.abs(r1 - r0)); n++
    }
    if (n && d / n > OVERLAY.tilt) reasons.push({ tone: 'warn', b: true, text: `B 범위 — 원본과 바탕의 몸 기울기 차이 ${(d / n * 180 / Math.PI).toFixed(0)}° → 부위 방향이 원본과 다름 · 보정 없음, 막지 않음` })
  }
  // 부위끼리 충돌 (pairs with an overlaid part; only what the overlay makes deeper than the piece already is)
  const pairs = collidePairs(def, ov.parts)
  let gap: number | null = null
  if (pairs.length) {
    const step = out.length > 120 ? 2 : 1, pick = <T,>(xs: T[]) => xs.filter((_, k) => k % step === 0)
    const dOut = pairDepths(pick(out), def, pairs.map(p => p.pair), -50), dBase = pairDepths(pick(base), def, pairs.map(p => p.pair), -50)
    if (dOut && dBase) {
      let worst: { d: number; k: number; c: number } | null = null
      dOut.forEach((row, k) => row.forEach((d, c) => {
        gap = Math.min(gap ?? Infinity, -d)
        if (d > OVERLAY.collide && d > dBase[k][c] + 1 && (!worst || d > worst.d)) worst = { d, k: k * step, c }
      }))
      if (worst) { const { d, k, c } = worst as { d: number; k: number; c: number }
        reasons.push({ tone: pairs[c].soft ? 'warn' : 'bad', text: `부위끼리 ${pairs[c].soft ? '맞닿음' : '충돌'} — ${pairName(pairs[c].pair)} ${d.toFixed(0)} mm 겹침 (${sec(k)})` }) }
    }
  }
  const tone: OverlayTone = reasons.some(r => r.tone === 'bad') ? 'bad' : reasons.length ? 'warn' : 'ok'
  return { frames, report: { tone, reasons, vel, gap, ground } }
}

/** The part pairs checked for an overlay on `parts` (soft = 손 × 손: often meant, a clap). */
function collidePairs(def: RobotDef, parts: string[]): { pair: [string, string]; soft?: true }[] {
  if (def.kind === 'go2') return GO2_LEG_PAIRS.filter(([a, b]) => parts.includes(a.split('_')[0]) || parts.includes(b.split('_')[0])).map(pair => ({ pair }))
  const of = (n: string) => n.startsWith('L_') ? '왼팔' : n.startsWith('R_') ? '오른팔' : '허리'
  const all = [...BODY_PAIRS.map(pair => ({ pair })), { pair: HAND_PAIR, soft: true as const }]
  return all.filter(({ pair: [a, b] }) => parts.includes(of(a)) || parts.includes(of(b)))
}
