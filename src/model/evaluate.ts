import { evalCurve } from './curve'
import { eulerToQuat, quatMul, yawQuat, type Quat } from './rootMath'
import type { Clip, Item, Project } from './types'
import type { RobotDef, RobotKind, Vec3 } from '../robot/types'

export interface Pose { rootPos: Vec3; rootQuat: Quat; q: number[] }
export type RobotDefs = Record<RobotKind, RobotDef>

export function evaluateClip(clip: Clip, def: RobotDef, f: number): Pose {
  const ch = (n: string, fb: number) => {
    const c = clip.channels[n]
    return c ? evalCurve(c, f, fb) : fb
  }
  return {
    rootPos: [ch('root.x', 0), ch('root.y', 0), ch('root.z', def.standingHeight)],
    rootQuat: eulerToQuat(ch('root.roll', 0), ch('root.pitch', 0), ch('root.yaw', 0)),
    q: def.joints.map(j => ch(j.name, 0)),
  }
}

const emptyClip = (robot: RobotKind): Clip => ({ id: '', name: '', robot, length: 0, channels: {} })

// Item + clip frame for a stage frame: before first item -> its trimIn; gap/after -> previous item's last frame.
function resolve(items: Item[], frame: number): { item: Item; cf: number } | null {
  const sorted = [...items].sort((a, b) => a.start - b.start)
  let prev: Item | null = null
  for (const it of sorted) {
    if (frame < it.start) return prev ? { item: prev, cf: prev.trimOut - 1 } : { item: it, cf: it.trimIn }
    if (frame < it.start + (it.trimOut - it.trimIn)) return { item: it, cf: frame - it.start + it.trimIn }
    prev = it
  }
  return prev ? { item: prev, cf: prev.trimOut - 1 } : null
}

export function evaluate(p: Project, defs: RobotDefs, actorId: string, frame: number): Pose {
  const actor = p.actors.find(a => a.id === actorId)
  if (!actor) throw new Error(`unknown actor ${actorId}`)
  const def = defs[actor.robot]
  const track = p.sequence.tracks.find(t => t.kind === 'motion' && t.actorId === actorId)
  const hit = track && resolve(track.items, frame)
  const clip = hit && p.clips[hit.item.refId]
  const pose = clip ? evaluateClip(clip, def, hit.cf) : evaluateClip(emptyClip(actor.robot), def, 0)
  const { x: px, y: py, yaw } = actor.placement
  const [x, y, z] = pose.rootPos
  const c = Math.cos(yaw), s = Math.sin(yaw)
  return {
    rootPos: [c * x - s * y + px, s * x + c * y + py, z],
    rootQuat: quatMul(yawQuat(yaw), pose.rootQuat),
    q: pose.q,
  }
}
