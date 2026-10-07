import { evaluate, type Pose, type RobotDefs } from '../model/evaluate'
import { quatMul, quatYaw, yawQuat, type Quat } from '../model/rootMath'
import type { Item, Project } from '../model/types'

export type RootMode = 'local' | 'world'

const LABEL = { g1: 'G1', go2: 'GO2' } as const

export const itemFrameRange = (item: Item) => ({ from: item.start, to: item.start + (item.trimOut - item.trimIn) })

function findItem(p: Project, itemId: string): Item {
  for (const t of p.sequence.tracks) for (const it of t.items) if (it.id === itemId) return it
  throw new Error(`unknown item ${itemId}`)
}

export function samplePoses(p: Project, defs: RobotDefs, actorId: string, itemId: string, mode: RootMode): Pose[] {
  const { from, to } = itemFrameRange(findItem(p, itemId))
  const out: Pose[] = []
  for (let f = from; f < to; f++) {
    const src = evaluate(p, defs, actorId, f)
    const n = Math.hypot(...src.rootQuat) || 1
    let q = src.rootQuat.map(v => v / n) as Quat
    const prev = out[out.length - 1]
    if (prev && prev.rootQuat.reduce((s, v, i) => s + v * q[i], 0) < 0) q = q.map(v => -v) as Quat
    out.push({ rootPos: [...src.rootPos], rootQuat: q, q: [...src.q] })
  }
  if (mode === 'local' && out.length) {
    const [x0, y0] = out[0].rootPos
    const yaw0 = quatYaw(out[0].rootQuat)
    const c = Math.cos(-yaw0), s = Math.sin(-yaw0), yq = yawQuat(-yaw0)
    // Pre-multiplying by a constant quat keeps the sign continuity established above.
    for (const o of out) {
      const dx = o.rootPos[0] - x0, dy = o.rootPos[1] - y0
      o.rootPos = [c * dx - s * dy, s * dx + c * dy, o.rootPos[2]]
      o.rootQuat = quatMul(yq, o.rootQuat)
    }
  }
  return out
}

const fmt = (v: number) => {
  const s = v.toFixed(6)
  return s === '-0.000000' ? '0.000000' : s
}

export const posesToCsv = (poses: Pose[]): string =>
  poses.map(p => [...p.rootPos, ...p.rootQuat, ...p.q].map(fmt).join(',') + '\n').join('')

export function csvFileName(p: Project, actorId: string, itemId: string, taken: Set<string>): string {
  const actor = p.actors.find(a => a.id === actorId)
  if (!actor) throw new Error(`unknown actor ${actorId}`)
  const clip = p.clips[findItem(p, itemId).refId]
  const shared = p.actors.filter(a => a.robot === actor.robot).length > 1
  const clean = (s: string) => s.replace(/[/\\:*?"<>|#\s]/g, '_')
  const base = `${clean(shared ? actor.name : LABEL[actor.robot])}_${clean(clip?.name ?? 'clip')}`
  let name = `${base}.csv`
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}.csv`
  taken.add(name)
  return name
}
