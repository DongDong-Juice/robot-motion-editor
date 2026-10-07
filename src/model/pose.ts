import { evalCurve } from './curve'
import { eulerToQuat, type Quat } from './rootMath'
import type { Clip } from './types'
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
