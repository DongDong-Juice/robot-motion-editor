import { readFileSync } from 'node:fs'
import { loadRobotDef } from '../robot/loadRobot'
import type { RobotDef, RobotKind } from '../robot/types'

// Shared across tests in a worker, so freeze (not meshes: typed arrays can't be frozen) to make a mutating test fail loudly.
const freezeDef = (d: RobotDef) => {
  for (const list of [d.joints, d.fixedJoints, d.groups, Object.values(d.links)]) { list.forEach(x => Object.freeze(x)); Object.freeze(list) }
  Object.freeze(d.links)
  return Object.freeze(d)
}

// Parsing the 9MB meshes.json is slow: do it once per vitest worker.
const cache: Partial<Record<RobotKind, RobotDef>> = {}
export const loadDef = (k: RobotKind): RobotDef => {
  const r = (f: string) => JSON.parse(readFileSync(new URL(`../../public/robots/${k}/${f}`, import.meta.url), 'utf8'))
  return (cache[k] ??= freezeDef(loadRobotDef(k, r('model.json'), r('meshes.json'))))
}
