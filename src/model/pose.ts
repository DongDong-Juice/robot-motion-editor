import { evalCurve } from './curve'
import { eulerToQuat, quatMul, quatYaw, yawQuat, type Quat } from './rootMath'
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

// `p` in the frame of `origin`: origin x/y moved to 0 and its heading to yaw 0; z kept.
export function rebasePose(p: Pose, origin: Pose): Pose {
  const yaw0 = quatYaw(origin.rootQuat), c = Math.cos(-yaw0), s = Math.sin(-yaw0)
  const dx = p.rootPos[0] - origin.rootPos[0], dy = p.rootPos[1] - origin.rootPos[1]
  return { rootPos: [c * dx - s * dy, s * dx + c * dy, p.rootPos[2]], rootQuat: quatMul(yawQuat(-yaw0), p.rootQuat), q: p.q }
}

// Inverse of rebasePose: `p` given in the frame of `origin`, placed back into the world (x/y and heading; z kept).
export function placePose(p: Pose, origin: Pose): Pose {
  const yaw0 = quatYaw(origin.rootQuat), c = Math.cos(yaw0), s = Math.sin(yaw0)
  const [x, y] = p.rootPos
  return { rootPos: [origin.rootPos[0] + c * x - s * y, origin.rootPos[1] + s * x + c * y, p.rootPos[2]], rootQuat: quatMul(yawQuat(yaw0), p.rootQuat), q: p.q }
}
