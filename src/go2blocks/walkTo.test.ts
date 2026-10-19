import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import { parseCsvPoses } from '../export/importCsv'
import { evaluateClip, type RobotDefs } from '../model/pose'
import { quatYaw } from '../model/rootMath'
import { loadDef } from '../test/defs'
import { blockFile, GO2_BLOCKS } from './blocks'
import { blockActual } from './build'
import { MIN_WALK, walkToClip, type Template } from './walkTo'

const defs = { go2: loadDef('go2') } as RobotDefs, def = defs.go2
const tpl = (id: string): Template => parseCsvPoses(readFileSync(new URL(`../../public/go2-blocks/${blockFile(id)}.csv`, import.meta.url), 'utf8'), defs, undefined)
const rot = tpl('rotate'), move = tpl('move')
const start = { x: 1, y: -2, yaw: 0.7 }
const wrapDeg = (a: number) => Math.atan2(Math.sin(a), Math.cos(a)) * 180 / Math.PI

test.each([[2, 0], [3, 45], [2.5, -90], [4, 180], [3, 60], [3, -60], [2, -179]])('d %s m, θ %s°: lands on the target facing it', (d, deg) => {
  const th = deg * Math.PI / 180, a = start.yaw + th
  const r = walkToClip(rot, move, start, { x: start.x + d * Math.cos(a), y: start.y + d * Math.sin(a) }, defs)
  if ('error' in r) throw new Error(r.error)
  const c = r.clip, p0 = evaluateClip(c, def, 0), pe = evaluateClip(c, def, c.length - 1)
  expect(c.robot).toBe('go2')
  expect(c.name).toMatch(/^Walk_\d+\.\dm_-?\d+deg$/)
  expect(Math.hypot(p0.rootPos[0], p0.rootPos[1])).toBeLessThan(1e-6)
  expect(Math.abs(quatYaw(p0.rootQuat))).toBeLessThan(1e-6)
  expect(Math.hypot(pe.rootPos[0] - d * Math.cos(th), pe.rootPos[1] - d * Math.sin(th))).toBeLessThan(0.01)
  expect(Math.abs(wrapDeg(quatYaw(pe.rootQuat) - th))).toBeLessThan(2)
  for (let f = 0; f < c.length; f++) evaluateClip(c, def, f).q.forEach((v, i) => {
    expect(v).toBeGreaterThanOrEqual(def.joints[i].lower - 1e-9); expect(v).toBeLessThanOrEqual(def.joints[i].upper + 1e-9)
  })
})

test('too close → error with the minimum distance; MIN_WALK = 0.8 × shortest Move', () => {
  const r = walkToClip(rot, move, start, { x: start.x + 0.3 * Math.cos(start.yaw), y: start.y + 0.3 * Math.sin(start.yaw) }, defs)
  expect(r).toEqual({ error: `이 거리는 너무 가깝습니다 (최소 약 ${MIN_WALK.toFixed(1)} m)` })
  const mv = GO2_BLOCKS.find(b => b.id === 'move')!
  expect(MIN_WALK).toBeCloseTo(0.8 * blockActual(mv, move.poses, 0)!.actual, 2)
})
