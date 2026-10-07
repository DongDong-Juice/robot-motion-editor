import { readFileSync } from 'node:fs'
import { loadRobotDef } from '../robot/loadRobot'
import type { RobotDef, RobotKind } from '../robot/types'

// Parsing the 9MB meshes.json is slow: do it once per vitest worker.
const cache: Partial<Record<RobotKind, RobotDef>> = {}
export const loadDef = (k: RobotKind): RobotDef => {
  const r = (f: string) => JSON.parse(readFileSync(new URL(`../../public/robots/${k}/${f}`, import.meta.url), 'utf8'))
  return (cache[k] ??= loadRobotDef(k, r('model.json'), r('meshes.json')))
}
