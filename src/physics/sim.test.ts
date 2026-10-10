import { existsSync, readFileSync } from 'node:fs'
import { beforeAll, expect, it, test } from 'vitest'
import loadMujoco from '@mujoco/mujoco'
import { loadModel, simulate, type Loaded } from './sim'
import { csvRows } from './csvRows'
import { DEFAULT_PHYSICS } from './settings'
import { loadDef } from '../test/defs'

const dir = new URL('../../public/physics/g1/', import.meta.url)
const read = (p: string) => new Uint8Array(readFileSync(new URL(p, dir)))
const def = loadDef('g1')
const S = DEFAULT_PHYSICS
let mj: any, L: Loaded

beforeAll(async () => {
  mj = await loadMujoco()
  const names: string[] = JSON.parse(readFileSync(new URL('files.json', dir), 'utf8'))
  L = await loadModel(mj, 'g1', { scene: read('scene.xml'), meshes: names.map(n => ({ name: n.replace('meshes/', ''), data: read(n) })) })
}, 60000)

const row = (z: number, q: number[]) => Float64Array.from([60, 0, 29, 0, 0, 0, z, 0, 0, 0, 1, ...q])

test('g1 model loads: 29 actuators in CSV joint order', () => {
  const { m } = L
  expect(m.nu).toBe(29)
  expect(m.nq).toBe(36)
  const act = Array.from({ length: m.nu }, (_, i) => mj.mj_id2name(m, mj.mjtObj.mjOBJ_ACTUATOR.value, i))
  expect(act).toEqual(def.joints.map(j => j.name))
})

test('csvRows skips header and trailing comma', () => {
  expect(csvRows('h,h,\n1,2,3,\n4,5,6,')).toEqual([Float64Array.of(1, 2, 3), Float64Array.of(4, 5, 6)])
})

test('n < 2 throws', () => {
  expect(() => simulate(L, [row(0.79, new Array(29).fill(0))], S)).toThrow('2프레임')
})

test('standstill: low assist', () => {
  const r = row(def.standingHeight, new Array(29).fill(0))
  const M = simulate(L, Array.from({ length: 120 }, () => r), S)
  console.log('standstill', M.meanPct, M.maxPct)
  expect(M.meanPct).toBeLessThan(10)
})

test('aggressive swing makes a warning segment', () => {
  const q = (s: number) => { const a = new Array(29).fill(0); for (const i of [0, 3, 6, 9]) a[i] = s * (i === 3 || i === 9 ? 2.5 : 2.8); return a }
  const rows = Array.from({ length: 120 }, (_, f) => (f < 60 ? row(def.standingHeight, new Array(29).fill(0)) : row(def.standingHeight, q(Math.floor((f - 60) / 3) % 2 ? 1 : -1))))
  const M = simulate(L, rows, S)
  console.log('aggressive', M.meanPct, M.maxPct, M.segments.length)
  expect(M.segments.length).toBeGreaterThanOrEqual(1)
})

it('deterministic', () => {
  const rows = Array.from({ length: 90 }, (_, f) => row(def.standingHeight, new Array(29).fill(0).map((_, i) => (i === 3 ? 0.5 * Math.sin(f / 10) : 0))))
  const a = simulate(L, rows, S), b = simulate(L, rows, S)
  expect(Buffer.from(a.pct.buffer).equals(Buffer.from(b.pct.buffer))).toBe(true)
  expect(Buffer.from(a.forceN.buffer).equals(Buffer.from(b.forceN.buffer))).toBe(true)
})

const csv = new URL('../../assets/data/Track1_원본_합본.csv', import.meta.url)
it.skipIf(!existsSync(csv))('Track1 first 600 rows: spike-like range', () => {
  const rows = csvRows(readFileSync(csv, 'utf8')).slice(0, 600)
  const t = Date.now()
  const M = simulate(L, rows, S)
  console.log('track1 600', M.meanPct, M.maxPct, 'ms', Date.now() - t)
  expect(M.maxPct).toBeGreaterThan(20)
  expect(M.maxPct).toBeLessThan(200)
}, 120000)
