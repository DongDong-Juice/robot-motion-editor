import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { loadRobotDef } from '../robot/loadRobot'
import type { RobotKind } from '../robot/types'
import { addActor, newProject } from '../model/defaults'
import { makeKey } from '../model/curve'
import { eulerToQuat, quatYaw } from '../model/rootMath'
import type { RobotDefs } from '../model/evaluate'
import type { Project } from '../model/types'
import { csvFileName, itemFrameRange, posesToCsv, samplePoses } from './csv'

const load = (k: RobotKind) => {
  const r = (f: string) => JSON.parse(readFileSync(new URL(`../../public/robots/${k}/${f}`, import.meta.url), 'utf8'))
  return loadRobotDef(k, r('model.json'), r('meshes.json'))
}
const defs: RobotDefs = { g1: load('g1'), go2: load('go2') }

const proj = newProject()
const [g1, go2] = proj.actors
const itemOf = (p: Project, actorId: string) => p.sequence.tracks.find(t => t.actorId === actorId)!.items[0]
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0)

test('g1 csv: 36 cols, rows = item length, 6 decimals, no header', () => {
  const rows = posesToCsv(samplePoses(proj, defs, g1.id, itemOf(proj, g1.id).id, 'world')).trimEnd().split('\n')
  expect(rows).toHaveLength(120)
  expect(rows[0].split(',')).toHaveLength(36)
  expect(rows[0].split(',')[0]).toMatch(/^-?\d+\.\d{6}$/)
})

test('go2 csv: 19 cols', () => {
  const csv = posesToCsv(samplePoses(proj, defs, go2.id, itemOf(proj, go2.id).id, 'world'))
  expect(csv.endsWith('\n')).toBe(true)
  expect(csv.split('\n')[0].split(',')).toHaveLength(19)
})

test('itemFrameRange', () => {
  expect(itemFrameRange({ id: '', refId: '', start: 10, trimIn: 5, trimOut: 25 })).toEqual({ from: 10, to: 30 })
})

test('negative zero written as 0.000000', () => {
  expect(posesToCsv([{ rootPos: [-0, -1e-9, 0], rootQuat: [0, 0, 0, 1], q: [] }]))
    .toBe('0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,1.000000\n')
})

test('local mode: first row x=y=0, yaw=0', () => {
  const p = structuredClone(proj)
  p.actors[0].placement = { x: 3, y: -2, yaw: 1.2 }
  const poses = samplePoses(p, defs, g1.id, itemOf(p, g1.id).id, 'local')
  expect(poses[0].rootPos[0]).toBeCloseTo(0)
  expect(poses[0].rootPos[1]).toBeCloseTo(0)
  expect(quatYaw(poses[0].rootQuat)).toBeCloseTo(0)
})

test('quat sign continuous when yaw jumps by 2pi (raw quat negates)', () => {
  const p = structuredClone(proj)
  const clip = p.clips[itemOf(p, g1.id).refId]
  const k0 = makeKey(0, 0.1, 'hold'), k1 = makeKey(60, 0.1 + 2 * Math.PI, 'hold')
  clip.channels['root.yaw'] = { keys: [k0, k1] }
  const poses = samplePoses(p, defs, g1.id, itemOf(p, g1.id).id, 'world')
  for (let k = 1; k < poses.length; k++) expect(dot(poses[k - 1].rootQuat, poses[k].rootQuat)).toBeGreaterThan(0)
})

test('local mode over time: motion along local +x, pitch preserved, yaw 0', () => {
  const p = structuredClone(proj)
  p.actors[0].placement = { x: 3, y: -2, yaw: 1.2 }
  const clip = p.clips[itemOf(p, g1.id).refId]
  clip.channels['root.x'] = { keys: [makeKey(0, 0, 'linear'), makeKey(119, 1, 'linear')] }
  clip.channels['root.pitch'] = { keys: [makeKey(0, 0.3, 'hold')] }
  const poses = samplePoses(p, defs, g1.id, itemOf(p, g1.id).id, 'local')
  const last = poses[poses.length - 1]
  expect(last.rootPos[0]).toBeCloseTo(1)
  expect(last.rootPos[1]).toBeCloseTo(0)
  expect(last.rootPos[2]).toBeCloseTo(poses[0].rootPos[2])
  expect(quatYaw(last.rootQuat)).toBeCloseTo(0)
  expect(Math.abs(dot(last.rootQuat, eulerToQuat(0, 0.3, 0)))).toBeCloseTo(1)
})

test('file names: sanitize and dedupe', () => {
  const p = structuredClone(proj)
  p.clips[itemOf(p, g1.id).refId].name = 'walk/01'
  const taken = new Set<string>()
  const id = itemOf(p, g1.id).id
  expect(csvFileName(p, g1.id, id, taken)).toBe('G1_walk_01.csv')
  expect(csvFileName(p, g1.id, id, taken)).toBe('G1_walk_01_2.csv')
  expect(csvFileName(p, go2.id, itemOf(p, go2.id).id, new Set())).toBe('GO2_clip_01.csv')
})

test('file name uses actor name when robot shared', () => {
  const p = addActor(proj, 'g1')
  expect(csvFileName(p, p.actors[2].id, itemOf(p, p.actors[2].id).id, new Set())).toBe('G1_#2_clip_01.csv')
})
