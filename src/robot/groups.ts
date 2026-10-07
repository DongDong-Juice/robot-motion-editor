import type { RobotKind } from './types'

const SPECS: Record<RobotKind, [string, string[]][]> = {
  g1: [
    ['왼다리', ['left_hip', 'left_knee', 'left_ankle']],
    ['오른다리', ['right_hip', 'right_knee', 'right_ankle']],
    ['허리', ['waist_']],
    ['왼팔', ['left_shoulder', 'left_elbow', 'left_wrist']],
    ['오른팔', ['right_shoulder', 'right_elbow', 'right_wrist']],
  ],
  go2: [
    ['FL', ['FL_']],
    ['FR', ['FR_']],
    ['RL', ['RL_']],
    ['RR', ['RR_']],
  ],
}

export function buildGroups(kind: RobotKind, jointNames: string[]) {
  return SPECS[kind].map(([name, prefixes]) => ({
    name,
    joints: jointNames.filter(j => prefixes.some(p => j.startsWith(p))),
  }))
}
