import { makeKey } from '../model/curve'
import type { RobotDefs } from '../model/pose'
import { nearestAngle, quatToEuler, type Quat } from '../model/rootMath'
import { slerp } from '../model/sequence'
import type { Clip } from '../model/types'

const ROBOT_BY_COLS = { 36: 'g1', 19: 'go2' } as const

// Unitree RL reference CSV (x,y,z,qx,qy,qz,qw,q1..qN, no header) -> editable clip with a linear key on every channel/frame.
export function csvToClip(text: string, defs: RobotDefs, srcFps: 30 | 60, name: string): Clip {
  const rows: number[][] = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return
    const cells = line.split(',').map(s => s.trim())
    const nums = cells.map(s => (s === '' ? NaN : Number(s)))
    if (nums.some(Number.isNaN)) throw new Error(`${i + 1}행에 숫자가 아닌 값이 있습니다`)
    rows.push(nums)
  })
  if (!rows.length) throw new Error('데이터가 없습니다')
  const cols = rows[0].length
  const robot = (ROBOT_BY_COLS as Record<number, 'g1' | 'go2'>)[cols]
  if (!robot) throw new Error(`열 수가 36(G1) 또는 19(GO2)가 아닙니다: ${cols}`)
  const bad = rows.findIndex(r => r.length !== cols)
  if (bad >= 0) throw new Error(`열 수가 36(G1) 또는 19(GO2)가 아닙니다: ${rows[bad].length}`)

  let frames = rows
  if (srcFps === 30) {
    frames = []
    rows.forEach((r, i) => {
      frames.push(r)
      const n = rows[i + 1]
      if (!n) return
      const q = slerp(r.slice(3, 7) as Quat, n.slice(3, 7) as Quat, 0.5)
      frames.push(r.map((v, j) => (j >= 3 && j < 7 ? q[j - 3] : (v + n[j]) / 2)))
    })
  }

  const names = ['root.x', 'root.y', 'root.z', 'root.roll', 'root.pitch', 'root.yaw', ...defs[robot].joints.map(j => j.name)]
  const vals: number[][] = names.map(() => [])
  let prev: number[] | null = null
  for (const r of frames) {
    const e = quatToEuler(r.slice(3, 7) as Quat)
    const u: number[] = prev ? e.map((v, i) => nearestAngle(v, prev![i])) : e
    prev = u
    ;[r[0], r[1], r[2], ...u, ...r.slice(7)].forEach((v, i) => vals[i].push(v))
  }
  const channels: Clip['channels'] = {}
  names.forEach((n, i) => { channels[n] = { keys: vals[i].map((v, f) => makeKey(f, v, 'linear')) } })
  return { id: crypto.randomUUID(), name, robot, length: frames.length, channels }
}
