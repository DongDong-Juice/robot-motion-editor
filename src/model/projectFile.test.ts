import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { loadRobotDef } from '../robot/loadRobot'
import type { RobotKind } from '../robot/types'
import type { RobotDefs } from './evaluate'
import { newProject } from './defaults'
import { makeKey } from './curve'
import { parseProject, serializeProject } from './projectFile'

const load = (k: RobotKind) => {
  const r = (f: string) => JSON.parse(readFileSync(new URL(`../../public/robots/${k}/${f}`, import.meta.url), 'utf8'))
  return loadRobotDef(k, r('model.json'), r('meshes.json'))
}
const defs: RobotDefs = { g1: load('g1'), go2: load('go2') }
const mk = () => {
  const p = newProject()
  const c = Object.values(p.clips)[0]
  c.channels['root.x'] = { keys: [makeKey(0, 1), makeKey(10, 2)] }
  p.sequence.markers.push({ f: 5, name: 'm' })
  return p
}
const bad = (fn: (p: any) => void, msg: string) => {
  const p: any = JSON.parse(serializeProject(mk())); fn(p)
  expect(() => parseProject(JSON.stringify(p), defs)).toThrow(msg)
}

test('roundtrip preserves project', () => {
  const p = mk()
  expect(parseProject(serializeProject(p), defs)).toEqual(p)
})

test('rejects bad json / version / fps', () => {
  expect(() => parseProject('{', defs)).toThrow('읽을 수 없습니다')
  expect(() => parseProject('[]', defs)).toThrow('읽을 수 없습니다')
  bad(p => { p.version = 2 }, '지원하지 않는 버전입니다: 2')
  bad(p => { p.fps = 30 }, 'fps')
})

test('rejects structural problems with the path', () => {
  bad(p => { p.actors = 1 }, 'actors')
  bad(p => { p.actors[0].robot = 'x' }, 'actors.0.robot')
  bad(p => { p.actors[0].placement.x = 'a' }, 'actors.0.placement')
  bad(p => { const c: any = Object.values(p.clips)[0]; c.channels = [] }, '.channels')
  bad(p => { const c: any = Object.values(p.clips)[0]; c.channels['root.x'].keys[0].interp = 'zz' }, 'interp')
  bad(p => { const c: any = Object.values(p.clips)[0]; c.length = 0 }, '.length')
  bad(p => { p.sequence.tracks[0].items[0].refId = 'nope' }, 'refId')
  bad(p => { p.sequence.tracks[0].actorId = 'nope' }, 'actorId')
  bad(p => { p.sequence.markers = [{ f: 'a' }] }, 'markers')
  bad(p => { p.sequence.inF = 'a' }, 'inF')
  bad(p => { const t = p.sequence.tracks[0]; t.items.push({ ...t.items[0], id: 'z' }) }, '겹')
})

test('keeps unknown extra fields', () => {
  const p: any = JSON.parse(serializeProject(mk())); p.extra = { a: 1 }
  expect((parseProject(JSON.stringify(p), defs) as any).extra).toEqual({ a: 1 })
})
