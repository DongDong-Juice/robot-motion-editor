import type { RobotDef } from '../robot/types'
import { footMat, legsOf, rootMat, solveLeg } from './legIk'

export type Body = { x: number; y: number; z: number; roll: number; pitch: number; yaw: number }
export const bodyMat = (b: Body) => rootMat(b.x, b.y, b.z, b.roll, b.pitch, b.yaw)

const lowest = (def: RobotDef, q: ArrayLike<number>, b: Body) => Math.min(...legsOf(def).map(l => footMat(l, bodyMat(b), q)[11]))
const restCache = new WeakMap<RobotDef, number>()
/** Height of the lowest foot in the 차렷 pose. */
export function restFootZ(def: RobotDef): number {
  let z = restCache.get(def)
  if (z === undefined) restCache.set(def, z = lowest(def, def.rest.q, { x: 0, y: 0, z: def.rest.z, roll: 0, pitch: 0, yaw: 0 }))
  return z
}
/** Root z that puts the lowest foot at the 차렷 foot height (other body values as given). */
export const groundZ = (def: RobotDef, q: ArrayLike<number>, b: Body) => restFootZ(def) - lowest(def, q, { ...b, z: 0 })
export const standQ = (def: RobotDef) => [...def.rest.q]

/** q with every leg re-solved so each foot keeps its pose from body `from` when the body is at `to`; null if a foot is off by > 1 cm. */
export function lockFeet(def: RobotDef, q: number[], from: Body, to: Body): number[] | null {
  const out = [...q], A = bodyMat(from), B = bodyMat(to)
  for (const leg of legsOf(def)) {
    const t = footMat(leg, A, q)
    solveLeg(def, leg, B, t, out)
    const c = footMat(leg, B, out)
    if (Math.hypot(t[3] - c[3], t[7] - c[7], t[11] - c[11]) > 0.01) return null
  }
  return out
}
