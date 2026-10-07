import { evalCurve } from './curve'
import { eulerToQuat, type Quat } from './rootMath'
import { applyXf, blendPose, itemLen, resolve, sortedItems, stitchTransforms } from './sequence'
import type { Actor, Clip, Item, Project, Track } from './types'
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

function trackPose(p: Project, defs: RobotDefs, track: Track, robot: RobotKind, frame: number): Pose {
  const def = defs[robot]
  const xfs = stitchTransforms(p, defs, track)
  const at = (it: Item, cf: number): Pose | null => {
    const clip = p.clips[it.refId]
    return clip ? applyXf(evaluateClip(clip, def, cf), xfs.get(it.id)!) : null
  }
  const items = sortedItems(track)
  for (let i = 0; i + 1 < items.length; i++) {
    const a = items[i], b = items[i + 1]
    const s = b.start, e = a.start + itemLen(a)
    if (s < e && frame >= s && frame < e) {
      const pa = at(a, frame - a.start + a.trimIn), pb = at(b, frame - b.start + b.trimIn)
      if (pa && pb) return blendPose(pa, pb, (frame - s + 1) / (e - s + 1))
    }
  }
  const hit = resolve(items, frame)
  return (hit && at(hit.item, hit.cf)) || evaluateClip(emptyClip(robot), def, 0)
}

function place(pose: Pose, placement: Actor['placement']): Pose {
  return applyXf(pose, placement)
}

export function evaluate(p: Project, defs: RobotDefs, actorId: string, frame: number): Pose {
  const actor = p.actors.find(a => a.id === actorId)
  if (!actor) throw new Error(`unknown actor ${actorId}`)
  const track = p.sequence.tracks.find(t => t.kind === 'motion' && t.actorId === actorId)
  const pose = track ? trackPose(p, defs, track, actor.robot, frame) : evaluateClip(emptyClip(actor.robot), defs[actor.robot], 0)
  return place(pose, actor.placement)
}

// World pose of an item at a raw clip frame (trims ignored, clamped to the clip).
export function evaluateItem(p: Project, defs: RobotDefs, itemId: string, clipFrame: number): Pose {
  const track = p.sequence.tracks.find(t => t.items.some(i => i.id === itemId))
  const item = track?.items.find(i => i.id === itemId)
  const actor = p.actors.find(a => a.id === track?.actorId)
  const clip = item && p.clips[item.refId]
  if (!track || !item || !actor || !clip) throw new Error(`unknown item ${itemId}`)
  const cf = Math.min(Math.max(clipFrame, 0), clip.length - 1)
  const pose = applyXf(evaluateClip(clip, defs[actor.robot], cf), stitchTransforms(p, defs, track).get(itemId)!)
  return place(pose, actor.placement)
}
