import { loadDef } from '../test/defs'
import { expect, test } from 'vitest'

import type { Project } from './types'
import type { RobotDefs } from './evaluate'
import { emptyProject, newProject } from './defaults'
import { makeKey } from './curve'
import { samplePoses } from '../export/csv'
import { validatePoses } from '../export/validate'
import { parseProject, serializeProject } from './projectFile'

const load = loadDef
const defs: RobotDefs = { g1: load('g1'), go2: load('go2') }
const mk = () => {
  const p = newProject()
  const c = Object.values(p.clips)[0]
  c.channels['root.x'] = { keys: [makeKey(0, 1), makeKey(10, 2)] }
  p.sequence.markers.push({ f: 5, name: 'm' })
  return p
}
const v1 = (p: Project) => JSON.stringify({ ...p, version: 1 }, null, 1) // legacy format
const bad = (fn: (p: any) => void, msg: string) => {
  const p: any = JSON.parse(v1(mk())); fn(p)
  expect(() => parseProject(JSON.stringify(p), defs)).toThrow(msg)
}

test('roundtrip preserves project', () => {
  const p = mk()
  expect(parseProject(serializeProject(p), defs)).toEqual(p)
})

test('item restPose round-trips; an old 덮어쓰기 (true) opens as off; others rejected; an old unknown clip owner is kept and ignored', () => {
  const p = mk(), it = p.sequence.tracks.flatMap(t => t.items)[0], c = Object.values(p.clips)[0]
  ;(it as any).restPose = true
  expect(parseProject(serializeProject(p), defs).sequence.tracks.flatMap(t => t.items)[0].restPose).toBeUndefined()
  it.restPose = 'prepend'
  expect(parseProject(serializeProject(p), defs).sequence.tracks.flatMap(t => t.items)[0].restPose).toBe('prepend')
  ;(it as any).restPose = false
  expect(() => parseProject(serializeProject(p), defs)).toThrow('restPose')
  delete it.restPose
  ;(c as any).owner = 'gone'
  expect(Object.keys(parseProject(serializeProject(p), defs).clips)).toEqual(Object.keys(p.clips))
})

test('item lead-in lengths (정지·전이·관성) round-trip; bad values are rejected', () => {
  const p = mk(), it = p.sequence.tracks.flatMap(t => t.items)[0], first = (q: typeof p) => q.sequence.tracks.flatMap(t => t.items)[0]
  Object.assign(it, { restPose: 'prepend', restHold: 12, restBlend: 'auto', inertia: 0 })
  expect(first(parseProject(serializeProject(p), defs))).toMatchObject({ restHold: 12, restBlend: 'auto', inertia: 0 })
  it.restBlend = 45
  expect(first(parseProject(serializeProject(p), defs)).restBlend).toBe(45)
  for (const [k, v] of [['restHold', -1], ['restBlend', -1], ['restBlend', 'fast'], ['inertia', 1.5]] as const) {
    const q = structuredClone(p); Object.assign(first(q), { [k]: v })
    expect(() => parseProject(serializeProject(q), defs)).toThrow(k)
  }
})

test('clip 수정 층 (Clip.offset) round-trips; an unknown channel is rejected', () => {
  const p = mk(), c = Object.values(p.clips)[0]
  c.offset = { left_knee_joint: { keys: [makeKey(3, 0.25), makeKey(9, -0.1)] } }
  const q = parseProject(serializeProject(p), defs)
  expect(q.clips[c.id].offset!.left_knee_joint.keys.map(k => [k.f, +k.v.toFixed(6)])).toEqual([[3, 0.25], [9, -0.1]])
  expect(q.clips[c.id].channels).toEqual(c.channels)
  c.offset = { not_a_joint: { keys: [makeKey(0, 1)] } }
  expect(() => parseProject(serializeProject(p), defs)).toThrow('offset')
})

test('item hidden (숨기기) round-trips; anything but true is rejected', () => {
  const p = mk(), it = p.sequence.tracks.flatMap(t => t.items)[0]
  it.hidden = true
  expect(parseProject(serializeProject(p), defs).sequence.tracks.flatMap(t => t.items)[0].hidden).toBe(true)
  ;(it as any).hidden = false
  expect(() => parseProject(serializeProject(p), defs)).toThrow('hidden')
})

test('item restTail (끝 기본자세) and track trail (경로 표시) round-trip; bad values are rejected', () => {
  const p = mk(), t = p.sequence.tracks.find(t => t.kind === 'motion')!, it = t.items[0]
  it.restTail = false; t.trail = true
  const q = parseProject(serializeProject(p), defs), qt = q.sequence.tracks.find(x => x.id === t.id)!
  expect(qt.items[0].restTail).toBe(false)
  expect(qt.trail).toBe(true)
  ;(it as any).restTail = 1
  expect(() => parseProject(serializeProject(p), defs)).toThrow('restTail')
  it.restTail = true; (t as any).trail = false
  expect(() => parseProject(serializeProject(p), defs)).toThrow('trail')
})

test('v2: roundtrip within 1e-6, v1 opens as v2', () => {
  const p = mk()
  const k = { f: 3, v: 0.1234567891, interp: 'bezier' as const, inTan: { df: -2, dv: -0.00000049 }, outTan: { df: 2.5, dv: 1 / 3 } }
  Object.values(p.clips)[0].channels['root.y'] = { keys: [k] }
  const text = serializeProject(p)
  expect(JSON.parse(text).version).toBe(2)
  expect(text).not.toContain('\n')
  const q = Object.values(parseProject(text, defs).clips)[0].channels['root.y'].keys[0]
  expect(q).toMatchObject({ f: 3, interp: 'bezier' })
  expect(q.v).toBeCloseTo(k.v, 6); expect(q.outTan.dv).toBeCloseTo(1 / 3, 6)
  expect(Object.is(q.inTan.dv, 0)).toBe(true) // rounds to 0, never -0
  const old = parseProject(v1(mk()), defs)
  expect(old.version).toBe(2)
  expect(parseProject(serializeProject(old), defs)).toEqual(old)
})

test('v2: compact (<30% of v1 indent-1 size) at 5000x36 keys', () => {
  const p = newProject(), c = Object.values(p.clips)[0]
  for (let ch = 0; ch < 36; ch++) c.channels[`j${ch}`] = { keys: Array.from({ length: 5000 }, (_, i) => makeKey(i, Math.sin(i * 0.01 + ch))) }
  c.length = 5000
  const ratio = serializeProject(p).length / v1(p).length
  expect(ratio).toBeLessThan(0.3)
})

test('v2: key at joint limit stays within limit after save/open and exports without warnings', () => {
  const p = mk(), c = Object.values(p.clips)[0]
  const j = defs.g1.joints.find(j => j.name === 'left_wrist_pitch_joint')!
  c.channels[j.name] = { keys: [makeKey(0, j.upper), makeKey(10, j.lower)] }
  const q = Object.values(parseProject(serializeProject(p), defs).clips)[0]
  expect(q.channels[j.name].keys[0].v).toBeLessThanOrEqual(j.upper)
  expect(q.channels[j.name].keys[1].v).toBeGreaterThanOrEqual(j.lower)
  const p2 = parseProject(serializeProject(p), defs)
  const poses = samplePoses(p2, defs, p2.actors[0].id, p2.sequence.tracks.find(t => t.actorId === p2.actors[0].id)!.items[0].id, 'world')
  expect(validatePoses(poses, defs.g1, 0).filter(w => w.kind === 'jointLimit')).toEqual([])
})

test('v2: rejects malformed k', () => {
  const k = (arr: any[]) => {
    const p: any = JSON.parse(serializeProject(mk()))
    Object.values<any>(p.clips)[0].channels['root.x'] = { k: arr }
    return () => parseProject(JSON.stringify(p), defs)
  }
  const a = [0, 1, 0, 0, 0, 0, 0], b = [10, 2, 0, 0, 0, 0, 0]
  expect(k([...a, ...b])).not.toThrow()
  expect(k([...a, 1])).toThrow('.k')
  expect(k([0, null, 0, 0, 0, 0, 0])).toThrow('.k') // JSON for NaN
  expect(k([0, 1, 3, 0, 0, 0, 0])).toThrow('.k')
  expect(k([0.5, 1, 0, 0, 0, 0, 0])).toThrow('keys.0')
  expect(k([...b, ...a])).toThrow('keys.1.f')
  expect(k([...a, ...a])).toThrow('keys.1.f')
})

test('rejects bad json / version / fps', () => {
  expect(() => parseProject('{', defs)).toThrow('읽을 수 없습니다')
  expect(() => parseProject('[]', defs)).toThrow('읽을 수 없습니다')
  bad(p => { p.version = 3 }, '지원하지 않는 버전입니다: 3')
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
  const p: any = JSON.parse(v1(mk())); p.extra = { a: 1 }
  expect((parseProject(JSON.stringify(p), defs) as any).extra).toEqual({ a: 1 })
})

test('rejects unordered keys, robot mismatch, duplicate ids and tracks', () => {
  bad(p => { const c: any = Object.values(p.clips)[0]; c.channels['root.x'].keys[1].f = 0 }, 'keys.1.f')
  bad(p => { p.sequence.tracks[0].items[0].refId = Object.keys(p.clips)[1] }, '로봇')
  bad(p => { p.actors[1].id = p.actors[0].id }, '중복')
  bad(p => { p.sequence.tracks[1].items[0].id = p.sequence.tracks[0].items[0].id }, '중복')
  bad(p => { p.sequence.tracks[1].actorId = p.sequence.tracks[0].actorId }, '중복')
})

test('inherited names are not robots or clips', () => {
  bad(p => { p.actors[0].robot = 'toString' }, 'actors.0.robot')
  bad(p => { const c: any = Object.values(p.clips)[0]; c.robot = 'constructor' }, '.robot')
  bad(p => { p.sequence.tracks[0].items[0].refId = 'toString' }, 'refId')
})

test('media id __proto__ is a plain id: duplicates and bounds still checked', () => {
  const v = (items: any[]) => ({ id: 'v', kind: 'video', hidden: false, locked: false, items })
  const m = { id: '__proto__', name: 'a', durationF: 600 }
  const it = (trimOut: number) => ({ id: 'a', refId: '__proto__', start: 0, trimIn: 0, trimOut })
  const run = (fn: (p: any) => void) => { const p: any = JSON.parse(v1(mk())); fn(p); return parseProject(JSON.stringify(p), defs) }
  expect(run(p => { p.media = [m]; p.sequence.tracks.unshift(v([it(100)])) }).media).toHaveLength(1)
  expect(() => run(p => { p.media = [m]; p.sequence.tracks.unshift(v([it(601)])) })).toThrow('trimOut')
  expect(() => run(p => { p.media = [m, m] })).toThrow('media.1.id')
})

test('video: old file opens; media/V1 problems rejected', () => {
  const ok = (fn: (p: any) => void) => { const p: any = JSON.parse(v1(mk())); fn(p); return parseProject(JSON.stringify(p), defs) }
  const v = (items: any[] = []) => ({ id: 'v', kind: 'video', hidden: false, locked: false, items })
  const m = { id: 'm', name: 'a', durationF: 600 }
  const i = (id: string, start: number, trimOut: number, refId = 'm') => ({ id, refId, start, trimIn: 0, trimOut })
  expect(parseProject(serializeProject(mk()), defs).media).toEqual([])
  ok(p => { p.media = [m]; p.sequence.tracks.unshift(v([i('a', 0, 100)])) })
  bad(p => { p.media = [{ ...m, durationF: 0 }] }, 'media.0.durationF')
  bad(p => { p.media = [{ ...m, durationF: 1.5 }] }, 'media.0.durationF')
  bad(p => { p.media = [m, m] }, 'media.1.id')
  bad(p => { p.media = [m]; p.sequence.tracks.unshift(v([i('a', 0, 100, 'zz')])) }, 'refId')
  bad(p => { p.media = [m]; p.sequence.tracks.unshift(v([i('a', 0, 601)])) }, 'trimOut')
  bad(p => { p.media = [m]; p.sequence.tracks.unshift(v([i('a', 0, 100), i('b', 50, 100)])) }, '겹침')
  bad(p => { p.media = [m]; p.sequence.tracks.unshift(v(), { ...v(), id: 'v2' }) }, '영상 트랙')
  bad(p => { p.media = [m]; p.sequence.tracks.unshift({ ...v(), actorId: 'x' }) }, 'actorId')
})

test('empty project saves and reopens', () => {
  const p = emptyProject()
  expect(parseProject(serializeProject(p), defs)).toEqual(p)
})

test('physics round-trips as-is; absent stays absent; non-object is dropped', () => {
  const p = mk()
  expect('physics' in parseProject(serializeProject(p), defs)).toBe(false)
  p.physics = { assist: { kpF: 1, kdF: 2, kpT: 3, kdT: 4 } }
  expect(parseProject(serializeProject(p), defs).physics).toEqual(p.physics)
  for (const v of [5, 'x', [1], null]) {
    const o = JSON.parse(serializeProject(p)); o.physics = v
    expect('physics' in parseProject(JSON.stringify(o), defs)).toBe(false)
  }
})

test('bins round-trip; clip/media bin kept', () => {
  const p = mk(), c = Object.values(p.clips)[0]
  p.bins = [{ id: 'b1', name: 'Walk', tab: 'clip' }, { id: 'b2', name: 'Ref', tab: 'media' }]
  c.bin = 'b1'
  const q = parseProject(serializeProject(p), defs)
  expect(q.bins).toEqual(p.bins)
  expect(q.clips[c.id].bin).toBe('b1')
})
test('a bin that is missing or of the other tab is dropped (item goes to the top level), the file still opens', () => {
  const p = mk(), c = Object.values(p.clips)[0]
  p.bins = [{ id: 'm', name: 'Ref', tab: 'media' }]
  c.bin = 'gone'
  expect(parseProject(serializeProject(p), defs).clips[c.id].bin).toBeUndefined()
  c.bin = 'm'
  expect(parseProject(serializeProject(p), defs).clips[c.id].bin).toBeUndefined()
})
test('an old file without bins opens with every item at the top level', () => {
  const q = parseProject(v1(mk()), defs)
  expect(q.bins).toBeUndefined()
  expect(Object.values(q.clips).every(c => c.bin === undefined)).toBe(true)
})
test('malformed bins are rejected', () => {
  bad(p => { p.bins = {} }, 'bins')
  bad(p => { p.bins = [{ id: 'b', name: 'x', tab: 'block' }] }, 'bins.0')
  bad(p => { p.bins = [{ id: 'b', name: 'x', tab: 'clip' }, { id: 'b', name: 'y', tab: 'clip' }] }, '중복된 ID')
})
