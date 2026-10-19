import { posesToClip } from '../export/importCsv'
import { rebasePose, type Pose, type RobotDefs } from '../model/pose'
import { quatMul, quatYaw, yawQuat } from '../model/rootMath'
import { applyXf, blendPose } from '../model/sequence'
import type { Clip } from '../model/types'
import { GO2_BLOCKS, type Block } from './blocks'
import { blockActual, blockPoses, SEAM } from './build'

export type Template = { fps: number; poses: Pose[] }
const MOVE = GO2_BLOCKS.find(b => b.id === 'move') as Extract<Block, { id: 'move' }>, ROT = GO2_BLOCKS.find(b => b.id === 'rotate') as Extract<Block, { id: 'rotate' }>
const HEAD = MOVE.spec.head[1] - MOVE.spec.head[0] // source frames the Move log takes to get going
const TURN_MIN = Math.PI / 3 // |θ| from here: turn in place (Rotate) first
const LO = 0.8, HI = 1.2 // Move stretch along its travel
/** Shortest walk (m): the 1-step Move log (1.77 m) squeezed to 0.8; the real log measures this (walkTo.test). */
export const MIN_WALK = 1.415

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const smooth = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
const turnBy = (p: Pose, a: number): Pose => ({ ...p, rootQuat: quatMul(yawQuat(a), p.rootQuat) })
const rebased = (ps: Pose[]) => ps.map(p => rebasePose(p, ps[0]))
// heading of every frame relative to the first, unwrapped
const yaws = (ps: Pose[]) => { let a = 0; return ps.map((p, i) => i ? a += wrap(quatYaw(p.rootQuat) - quatYaw(ps[i - 1].rootQuat)) : 0) }

// Move log from the origin (heading 0) bent and stretched to end at (x, y) facing h; null = too close.
function walk(move: Template, x: number, y: number, h: number): Pose[] | null {
  const D = Math.hypot(x, y), b = Math.atan2(y, x)
  const { base, per } = blockActual(MOVE, move.poses, 0)!
  let n = 0, best = Infinity // steps: nearest to D within the stretch range
  for (let k = 1; k <= 100; k++) {
    const a = blockActual(MOVE, move.poses, base + k * per)!.actual
    if (D / a >= LO && D / a <= HI && Math.abs(D - a) < best) { best = Math.abs(D - a); n = k }
    if (D / a < LO) break
  }
  if (!n) return null
  const ps = rebased(blockPoses(MOVE, move.poses, base + n * per))
  // heading offset psi eased in over the head plus c spread over the whole walk (straightens the log's bend); each frame's step
  // turns with it so the root goes where it faces. Solve psi, c so the walk ends on bearing b facing h.
  const last = ps.length - 1, steer = (psi: number, c: number) => {
    const out = [ps[0]]
    for (let i = 1; i <= last; i++) {
      const o = psi * smooth(i / HEAD) + c * i / last, co = Math.cos(o), so = Math.sin(o), [px, py] = out[i - 1].rootPos
      const dx = ps[i].rootPos[0] - ps[i - 1].rootPos[0], dy = ps[i].rootPos[1] - ps[i - 1].rootPos[1]
      out.push({ ...turnBy(ps[i], o), rootPos: [px + co * dx - so * dy, py + so * dx + co * dy, ps[i].rootPos[2]] })
    }
    return out
  }
  let psi = b, c = 0, w = steer(psi, c)
  for (let k = 0; k < 30; k++) {
    const end = w[last], ea = wrap(b - Math.atan2(end.rootPos[1], end.rootPos[0])), eh = wrap(h - quatYaw(end.rootQuat))
    if (Math.abs(ea) + Math.abs(eh) < 1e-7) break
    // psi moves bearing and heading alike, c moves the heading fully but the bearing about half
    psi += 2 * ea - eh; c += 2 * (eh - ea); w = steer(psi, c)
  }
  // stretch along the travel only (sideways sway kept)
  const [ex, ey] = w[last].rootPos, f = D / Math.hypot(ex, ey) - 1, u = [Math.cos(b), Math.sin(b)]
  return w.map(p => {
    const [px, py, pz] = p.rootPos, t = f * (px * u[0] + py * u[1])
    return { ...p, rootPos: [px + t * u[0], py + t * u[1], pz] }
  })
}

/** GO2 clip from the real Rotate/Move logs: from `start` (world x, y, yaw) to `target`, ending there facing it.
 *  d (m), theta (degrees, left +) = target in the start frame. */
export function walkToClip(rot: Template, move: Template, start: { x: number; y: number; yaw: number }, target: { x: number; y: number }, defs: RobotDefs): { clip: Clip; d: number; theta: number } | { error: string } {
  const c = Math.cos(start.yaw), s = Math.sin(start.yaw), wx = target.x - start.x, wy = target.y - start.y
  const x = c * wx + s * wy, y = -s * wx + c * wy, d = Math.hypot(x, y), th = Math.atan2(y, x), theta = th * 180 / Math.PI
  let poses: Pose[] | null
  if (Math.abs(th) < TURN_MIN - 1e-9) poses = walk(move, x, y, th)
  else {
    // turn in place, its heading scaled from the log's turn to exactly θ
    const r = rebased(blockPoses(ROT, rot.poses, theta)), ys = yaws(r), k = th / ys.at(-1)! - 1
    const turned = r.map((p, i) => turnBy(p, ys[i] * k)), end = turned.at(-1)!, [ex, ey] = end.rootPos
    const ca = Math.cos(th), sa = Math.sin(th)
    const w = walk(move, ca * (x - ex) + sa * (y - ey), -sa * (x - ex) + ca * (y - ey), 0)
    poses = w && [...turned, ...w.map((p, i) => {
      const q = applyXf(p, { x: ex, y: ey, yaw: th })
      return i < SEAM ? blendPose(end, q, (i + 1) / (SEAM + 1)) : q
    })]
  }
  if (!poses) return { error: `이 거리는 너무 가깝습니다 (최소 약 ${MIN_WALK.toFixed(1)} m)` }
  return { clip: posesToClip(poses, move.fps, 'go2', defs, `Walk_${d.toFixed(1)}m_${Math.round(theta)}deg`), d, theta }
}
