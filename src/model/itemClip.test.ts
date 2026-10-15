import { loadDef } from '../test/defs'
import { beforeEach, expect, test } from 'vitest'

import { evaluate, type RobotDefs } from './evaluate'
import { createEditorStore, gizmoLock, keyOwner } from '../store/store'
import { exportItemCsv } from '../export/csv'
import { parseProject, serializeProject } from './projectFile'
import { editedClip, itemClip, withUse } from './itemClip'
import { evaluateClip } from './pose'
import { csvKey } from '../physics/runItem'

const defs: RobotDefs = { g1: loadDef('g1'), go2: loadDef('go2') }
const ch = 'left_knee_joint', j = () => defs.g1.joints.findIndex(x => x.name === ch)

let st: ReturnType<typeof createEditorStore>
let actor: string, c: string
const s = () => st.getState()
const items = () => s().project.sequence.tracks.find(t => t.actorId === actor)!.items
const q = (f: number) => evaluate(s().project, defs, actor, f).q[j()]

beforeEach(() => {
  st = createEditorStore(defs)
  actor = s().project.actors[0].id
  c = items()[0].refId
  s().setLayer('clip'); s().setKey(c, ch, 0, 0.2); s().setKey(c, ch, 119, 0.6); s().setLayer('piece') // a linear-ish source motion
  s().setInterp(c, [{ channel: ch, f: 0 }], 'linear')
})

test('이 조각 수정 is the default layer and needs no 자동 키; the clip stays untouched', () => {
  expect(s().layer).toBe('piece')
  expect(s().autoKey).toBe(false)
  const clipBefore = s().project.clips[c]
  s().setFrame(60); s().setValue(actor, ch, 0.9)
  expect(s().project.clips[c]).toBe(clipBefore)
  const off = items()[0].offset![ch].keys
  expect(off).toHaveLength(1)
  expect(off[0].f).toBe(60)
  expect(off[0].v).toBeCloseTo(0.9 - 0.4) // delta from the clip's 0.4 at frame 60
  expect(q(60)).toBeCloseTo(0.9)
  expect(q(0)).toBeCloseTo(0.2 + 0.5) // one key holds its delta over the whole piece
  s().undo()
  expect(items()[0].offset).toBeUndefined()
  expect(q(60)).toBeCloseTo(0.4)
})

test('a 0 key on each side keeps the change local', () => {
  s().setFrame(30); s().setValue(actor, ch, 0.3) // clip 0.3 there: delta 0
  s().setFrame(90); s().setValue(actor, ch, 0.5) // clip 0.5: delta 0
  s().setFrame(60); s().setValue(actor, ch, 1.0)
  expect(q(10)).toBeCloseTo(evaluateClipAt(10))
  expect(q(100)).toBeCloseTo(evaluateClipAt(100))
  expect(q(60)).toBeCloseTo(1.0)
})
const evaluateClipAt = (f: number) => 0.2 + 0.4 * f / 119

test('pieces of one clip keep separate 수정 층; split copies it to the right piece', () => {
  s().setFrame(20); s().setValue(actor, ch, 1)
  expect(s().splitItem(items()[0].id, 60)).toBe(true)
  const [a, b] = [...items()].sort((x, y) => x.start - y.start)
  expect(a.refId).toBe(b.refId)
  expect(b.offset).toEqual(a.offset)
  s().setFrame(80); s().setValue(actor, ch, 0) // only the right piece
  const [a2, b2] = [...items()].sort((x, y) => x.start - y.start)
  expect(a2.offset![ch].keys).toHaveLength(1)
  expect(b2.offset![ch].keys).toHaveLength(2)
})

test('joint sums are clamped to the URDF limits', () => {
  const up = defs.g1.joints[j()].upper
  s().setValue(actor, ch, 99)
  expect(q(0)).toBeCloseTo(up)
  expect(q(119)).toBeLessThanOrEqual(up + 1e-9)
})

test('key actions on the item id edit the 수정 층; clearOffset drops it in one undo step', () => {
  const id = items()[0].id
  s().setKey(id, ch, 10, 0.1); s().setKey(id, ch, 50, -0.1)
  s().moveKeys(id, [{ channel: ch, f: 50 }], 10)
  expect(keyOwner(s().project, id)!.channels[ch].keys.map(k => k.f)).toEqual([10, 60])
  s().deleteKeys(id, [{ channel: ch, f: 10 }])
  expect(items()[0].offset![ch].keys).toHaveLength(1)
  expect(s().clearOffset(id)).toBe(true)
  expect(items()[0].offset).toBeUndefined()
  s().undo()
  expect(items()[0].offset![ch].keys).toHaveLength(1)
})

test('locked track: no 수정 층 edits', () => {
  const t = s().project.sequence.tracks.find(t => t.actorId === actor)!
  s().setTrackFlag(t.id, 'locked', true)
  s().setValue(actor, ch, 1); s().setKey(items()[0].id, ch, 3, 1)
  expect(items()[0].offset).toBeUndefined()
  expect(s().clearOffset(items()[0].id)).toBe(false)
})

test('원본 클립 수정 still edits the clip and needs 자동 키', () => {
  s().setLayer('clip'); s().setFrame(60); s().setValue(actor, ch, 0.9)
  expect(s().project.clips[c].channels[ch].keys).toHaveLength(2)
  s().toggleAutoKey(); s().setValue(actor, ch, 0.9)
  expect(s().project.clips[c].channels[ch].keys.find(k => k.f === 60)!.v).toBeCloseTo(0.9)
  expect(items()[0].offset).toBeUndefined()
})

test('CSV export plays clip + 수정 층', () => {
  s().setFrame(60); s().setValue(actor, ch, 0.9)
  const { text } = exportItemCsv(s().project, defs, actor, items()[0].id, 'world')
  const row = text.split('\n')[61].split(',')
  expect(+row[11 + j()]).toBeCloseTo(0.9, 5)
})

test('shortening the clip drops 수정 층 keys past the new end', () => {
  s().setValue(actor, ch, 1); s().setFrame(100); s().setValue(actor, ch, 1)
  expect(s().setClip(c, { length: 80 })).toBe(true)
  expect(items()[0].offset![ch].keys.map(k => k.f)).toEqual([0])
})

test('itemClip is memoized per edit and is the clip itself without a 수정 층', () => {
  const p = s().project, it = items()[0]
  expect(itemClip(p, defs, it)).toBe(p.clips[c])
  s().setValue(actor, ch, 1)
  const p2 = s().project, it2 = items()[0]
  expect(itemClip(p2, defs, it2)).toBe(itemClip(p2, defs, it2))
  expect(p2.clips[c].channels[ch].keys).toHaveLength(2)
})

test('project file keeps the 수정 층 and rejects unknown channels', () => {
  s().setFrame(60); s().setValue(actor, ch, 0.9)
  const back = parseProject(serializeProject(s().project), defs)
  const it = back.sequence.tracks.find(t => t.actorId === actor)!.items[0]
  expect(it.offset![ch].keys[0]).toMatchObject({ f: 60, interp: 'bezier' })
  expect(it.offset![ch].keys[0].v).toBeCloseTo(0.5)
  expect(evaluate(back, defs, actor, 60).q[j()]).toBeCloseTo(0.9)
  const bad = JSON.parse(serializeProject(s().project))
  bad.sequence.tracks.find((t: any) => t.actorId === actor).items[0].offset.nope = { k: [0, 1, 0, 0, 0, 0, 0] }
  expect(() => parseProject(JSON.stringify(bad), defs)).toThrow('채널 이름을 알 수 없습니다')
})

// 원본 · 수정본 분리 보기 (spec 2026-10-14-edit-compare-design.md)
const csvOf = () => exportItemCsv(s().project, defs, actor, items()[0].id, 'world').text

test('use: original plays and exports the clip, the 수정본 stays for the editors; one undo step', () => {
  const plain = csvOf()
  s().setFrame(60); s().setValue(actor, ch, 0.9)
  const edited = csvOf(), id = items()[0].id
  expect(edited).not.toBe(plain)
  expect(s().setItemUse(id, 'original')).toBe(true)
  expect(items()[0].use).toBe('original')
  expect(csvOf()).toBe(plain)
  expect(q(60)).toBeCloseTo(0.4)
  expect(itemClip(s().project, defs, items()[0])).toBe(s().project.clips[c])
  expect(evaluateClip(editedClip(s().project, defs, items()[0])!, defs.g1, 60).q[j()]).toBeCloseTo(0.9) // the editors still see the 수정본
  expect(csvKey(s().project, defs, actor, id).key).not.toBe(csvKey(withUse(s().project, id, null), defs, actor, id).key) // physics re-checks
  s().undo()
  expect(items()[0].use).toBeUndefined()
  expect(csvOf()).toBe(edited)
  expect(s().setItemUse(id, null)).toBe(true)
  expect(csvOf()).toBe(edited)
})

test('setItemUse refuses 원본 사용 without a 수정 층 and on a locked track', () => {
  const id = items()[0].id
  expect(s().setItemUse(id, 'original')).toBe(false)
  s().setValue(actor, ch, 0.9)
  s().setTrackFlag(s().project.sequence.tracks.find(t => t.actorId === actor)!.id, 'locked', true)
  expect(s().setItemUse(id, 'original')).toBe(false)
  expect(items()[0].use).toBeUndefined()
})

test('withUse copies only the one piece and is memoized per project', () => {
  s().setValue(actor, ch, 0.9)
  const p = s().project, id = items()[0].id
  const o = withUse(p, id, 'original')
  expect(withUse(p, id, 'original')).toBe(o)
  expect(o.sequence.tracks.find(t => t.actorId === actor)!.items[0].use).toBe('original')
  expect(items()[0].use).toBeUndefined()
  expect(o.clips).toBe(p.clips)
  expect(evaluate(o, defs, actor, 60).q[j()]).toBeCloseTo(0.4)
})

test('openEditCompare needs a 수정 층; it closes when the 수정 층 goes; the main gizmo is locked on that piece', () => {
  const id = items()[0].id
  s().openEditCompare(id)
  expect(s().previewEdit).toBe(false)
  s().setFrame(60); s().setValue(actor, ch, 0.9)
  s().openEditCompare(id)
  expect(s()).toMatchObject({ itemPreview: id, previewEdit: true })
  s().select(actor, ch)
  expect(gizmoLock(s())).toBe('compare')
  s().openItemPreview(id)
  expect(s().previewEdit).toBe(false)
  expect(gizmoLock(s())).toBe(null)
  s().openEditCompare(id)
  expect(s().clearOffset(id)).toBe(true)
  expect(s()).toMatchObject({ itemPreview: id, previewEdit: false })
})

test('project file keeps use: original and rejects other values', () => {
  s().setValue(actor, ch, 0.9); s().setItemUse(items()[0].id, 'original')
  const back = parseProject(serializeProject(s().project), defs)
  expect(back.sequence.tracks.find(t => t.actorId === actor)!.items[0].use).toBe('original')
  const bad = JSON.parse(serializeProject(s().project))
  bad.sequence.tracks.find((t: any) => t.actorId === actor).items[0].use = 'edited'
  expect(() => parseProject(JSON.stringify(bad), defs)).toThrow('.use')
})
