// 검수 목록 1단계 (수정변동사항.md §12, docs/superpowers/specs/2026-10-29-review-list-design.md): suspect joint jumps in a motion.
// Only the frames BEFORE a frame are used to judge it (a jumped value stays, so what follows says little). Two rules, either flags:
//  - 로봇 한계 초과: joint speed between neighbouring frames > that joint's URDF velocity limit (model.json) — the robot cannot do it,
//    whatever the choreography.
//  - 파일 기준 급변: the change is far off what the previous two frames predict (constant speed), measured against the same joint's
//    own spread in this motion (95th percentile), and still fast (≥ 70 % of the limit) — adapts to calm vs. fierce choreography.
// Plus 첫 프레임 튐: an imported CSV whose row 1 is a fixed rest pose jumps at frame 0→1.
// Pure: no store, no three.js. Validated on 12 mocap CSVs + their hand-cleaned versions (all > 50 rad/s jumps found, no flags on cleaned data).
import type { Pose } from '../model/evaluate'
import type { RobotDef } from '../robot/types'

export const FPS = 60
export const REL_SCORE = 8 // 파일 기준 급변: residual / the joint's 95th-percentile residual
export const REL_MIN_SPEED = 0.7 // … and speed ≥ this × the velocity limit
export const GROUP_GAP = 15 // flagged frames this close (0.25 s) form one item
export const START_JOINT = 1.0 // rad: 첫 프레임 튐 (RL team: a joint jump > 1 rad is cut)
export const START_ROOT = 0.05 // m
export const CONTEXT = 12 // frames shown either side of an item (구간 지표)

export type SuspectKind = 'limit' | 'rel' | 'start'
export interface Suspect {
  kind: SuspectKind
  from: number; to: number // frames (inclusive) of the target, 0-based
  worst: number // the frame with the highest speed / limit
  joints: string[] // involved joints, worst first
  parts: string[] // 부위: 왼팔, 오른다리, 허리…
  speed: number // rad/s at the worst frame (worst joint)
  ratio: number // speed / that joint's velocity limit
  jump: number // rad, the worst joint's change at the worst frame
}

const PART_GO2: Record<string, string> = { FL: '앞왼다리', FR: '앞오른다리', RL: '뒤왼다리', RR: '뒤오른다리' }
/** 부위 of a joint name (G1: left/right arm·leg, waist; GO2: FL/FR/RL/RR). */
export function partOf(name: string): string {
  if (name.startsWith('waist')) return '허리'
  const go2 = PART_GO2[name.slice(0, 2)]
  if (go2 && name[2] === '_') return go2
  const side = name.startsWith('left') ? '왼' : name.startsWith('right') ? '오른' : ''
  return side + (/hip|knee|ankle/.test(name) ? '다리' : '팔')
}

const p95 = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1)))]
}

/** Per-frame flags and speed / limit ratios for every joint. `skip0` = frame 1 belongs to a 첫 프레임 튐 item (not judged here). */
function frameFlags(poses: Pose[], def: RobotDef, skip0: boolean) {
  const n = poses.length, J = def.joints.length
  const ratio: number[][] = poses.map(() => new Array(J).fill(0))
  const flag: boolean[][] = poses.map(() => new Array(J).fill(false))
  const resid: number[][] = Array.from({ length: J }, () => [])
  const t0 = skip0 ? 2 : 1
  for (let t = t0; t < n; t++) for (let j = 0; j < J; j++) {
    const lim = def.joints[j].velocity
    ratio[t][j] = lim > 0 ? Math.abs(poses[t].q[j] - poses[t - 1].q[j]) * FPS / lim : 0
    if (t >= t0 + 1) resid[j].push(Math.abs(poses[t].q[j] - 2 * poses[t - 1].q[j] + poses[t - 2].q[j]))
  }
  const scale = resid.map(r => Math.max(p95(r), 1e-4))
  for (let t = t0; t < n; t++) for (let j = 0; j < J; j++) {
    if (ratio[t][j] > 1) { flag[t][j] = true; continue }
    if (t < t0 + 1 || ratio[t][j] < REL_MIN_SPEED) continue
    const r = Math.abs(poses[t].q[j] - 2 * poses[t - 1].q[j] + poses[t - 2].q[j])
    if (r / scale[j] > REL_SCORE) flag[t][j] = true
  }
  return { ratio, flag }
}

/** True when frame 0 → 1 is a 첫 프레임 튐 (an imported rest-pose row 1). */
export function startJump(poses: Pose[]): boolean {
  if (poses.length < 2) return false
  const [a, b] = poses
  const dq = Math.max(0, ...a.q.map((v, i) => Math.abs(b.q[i] - v)))
  const dr = Math.hypot(b.rootPos[0] - a.rootPos[0], b.rootPos[1] - a.rootPos[1], b.rootPos[2] - a.rootPos[2])
  return dq > START_JOINT || dr > START_ROOT
}

/** The suspect items of a motion, most severe first (첫 프레임 튐 first of all). */
export function detectSuspects(poses: Pose[], def: RobotDef): Suspect[] {
  const out: Suspect[] = []
  const start = startJump(poses)
  if (start) {
    const [a, b] = poses
    const dq = a.q.map((v, i) => Math.abs(b.q[i] - v)), k = dq.indexOf(Math.max(...dq))
    const joints = def.joints.map((j, i) => [j.name, dq[i]] as const).filter(([, d]) => d > 0.3).sort((x, y) => y[1] - x[1]).map(([n]) => n)
    const lim = def.joints[k].velocity
    out.push({ kind: 'start', from: 0, to: 1, worst: 1, joints, parts: [...new Set(joints.map(partOf))], speed: dq[k] * FPS, ratio: lim > 0 ? dq[k] * FPS / lim : 0, jump: dq[k] })
  }
  const { ratio, flag } = frameFlags(poses, def, start)
  const frames = flag.map((row, t) => (row.some(Boolean) ? t : -1)).filter(t => t >= 0)
  const groups: number[][] = []
  for (const t of frames) {
    const g = groups[groups.length - 1]
    if (g && t - g[g.length - 1] <= GROUP_GAP) g.push(t)
    else groups.push([t])
  }
  for (const g of groups) {
    let worst = g[0], wj = 0, best = -1
    const hit = new Map<number, number>() // joint -> its highest ratio in the item
    let limit = false
    for (const t of g) flag[t].forEach((f, j) => {
      if (!f) return
      if (ratio[t][j] > 1) limit = true
      hit.set(j, Math.max(hit.get(j) ?? 0, ratio[t][j]))
      if (ratio[t][j] > best) { best = ratio[t][j]; worst = t; wj = j }
    })
    const joints = [...hit].sort((a, b) => b[1] - a[1]).map(([j]) => def.joints[j].name)
    out.push({ kind: limit ? 'limit' : 'rel', from: g[0], to: g[g.length - 1], worst, joints, parts: [...new Set(joints.map(partOf))],
      speed: best * def.joints[wj].velocity, ratio: best, jump: Math.abs(poses[worst].q[wj] - poses[worst - 1].q[wj]) })
  }
  return out.sort((a, b) => (a.kind === 'start' ? -1 : b.kind === 'start' ? 1 : b.ratio - a.ratio))
}

/** 구간 지표: frames [from − CONTEXT, to + CONTEXT] clamped, value = the highest speed / limit of the item's joints at each frame. */
export function itemSeries(poses: Pose[], def: RobotDef, s: Suspect): { from: number; values: number[] } {
  const from = Math.max(1, s.from - CONTEXT), to = Math.min(poses.length - 1, s.to + CONTEXT)
  const idx = s.joints.map(n => def.joints.findIndex(j => j.name === n)).filter(i => i >= 0)
  const values: number[] = []
  for (let t = from; t <= to; t++) values.push(Math.max(0, ...idx.map(j => {
    const lim = def.joints[j].velocity
    return lim > 0 ? Math.abs(poses[t].q[j] - poses[t - 1].q[j]) * FPS / lim : 0
  })))
  return { from, values }
}
