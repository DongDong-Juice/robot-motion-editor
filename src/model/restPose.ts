import { makeKey } from './curve'
import type { Pose } from './pose'
import { quatToEuler } from './rootMath'
import type { Clip, Curve } from './types'
import type { RobotDef } from '../robot/types'

export const REST_HOLD = 30 // frames held at the rest pose (0.5 s)
export const REST_BLEND = 60 // frames easing into the item's first pose (1 s)
export const REST_LEN = REST_HOLD + REST_BLEND

// rest value held 0..HOLD (linear), then a flat-tangent ease to the target at L-1
const ease = (rest: number, target: number): Curve =>
  ({ keys: [makeKey(0, rest, 'linear'), makeKey(REST_HOLD, rest), makeKey(REST_LEN - 1, target)] })
const pin = (v: number): Curve => ({ keys: [makeKey(0, v, 'linear'), makeKey(REST_LEN - 1, v, 'linear')] })

/** Rest-pose lead-in for an item whose first frame is `first` (clip-local): joints 0 and standing height, then ease into `first`.
 * Root x/y/yaw stay at the first pose's values so the sequence stitch pins the item's start to this clip's end. */
export function restPoseClip(def: RobotDef, first: Pose, name: string): Clip {
  const [roll, pitch, yaw] = quatToEuler(first.rootQuat)
  const channels: Record<string, Curve> = {
    'root.x': pin(first.rootPos[0]), 'root.y': pin(first.rootPos[1]), 'root.yaw': pin(yaw),
    'root.z': ease(def.standingHeight, first.rootPos[2]), 'root.roll': ease(0, roll), 'root.pitch': ease(0, pitch),
  }
  def.joints.forEach((j, i) => { channels[j.name] = ease(0, first.q[i]) })
  return { id: crypto.randomUUID(), name, robot: def.kind, length: REST_LEN, channels }
}
