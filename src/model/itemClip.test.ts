import { loadDef } from '../test/defs'
import { beforeEach, expect, test } from 'vitest'

import { evaluate, type RobotDefs } from './evaluate'
import { assetOwner, createEditorStore, editTarget, gizmoLock, keyOwner } from '../store/store'
import { exportItemCsv } from '../export/csv'
import { parseProject, serializeProject } from './projectFile'
import { baseClip, editedClip, itemClip, withUse } from './itemClip'
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
  expect(off.map(k => [k.f, k.v === 0 ? 0 : 'd'])).toEqual([[45, 0], [60, 'd'], [75, 0]]) // eased back to 0 over OFFSET_EASE frames each side
  expect(off[1].v).toBeCloseTo(0.9 - 0.4) // delta from the clip's 0.4 at frame 60
  expect(q(60)).toBeCloseTo(0.9)
  expect(q(0)).toBeCloseTo(0.2); expect(q(119)).toBeCloseTo(0.6) // away from the edit the clip plays as before
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
  expect(a2.offset![ch].keys.map(k => k.f)).toEqual([5, 20, 35])
  expect(b2.offset![ch].keys.map(k => k.f)).toEqual([5, 20, 35, 65, 80, 95])
})

test('a value edit changes only its neighbourhood: eases in and out over OFFSET_EASE frames, keeps earlier edits', () => {
  const at = (f: number) => evaluateClip(s().project.clips[c], defs.g1, f).q[j()] // the clip without 수정 층
  s().setFrame(5); s().setValue(actor, ch, at(5) + 0.4) // a small change at frame 5
  expect(q(5)).toBeCloseTo(at(5) + 0.4)
  for (const f of [20, 40, 80, 119]) expect(q(f)).toBeCloseTo(at(f), 9) // back to the motion after OFFSET_EASE frames
  expect(q(12) - at(12)).toBeGreaterThan(0); expect(q(12) - at(12)).toBeLessThan(0.4) // easing
  s().setFrame(60); s().setValue(actor, ch, at(60) - 0.2) // a second edit elsewhere leaves the first one
  expect(q(5)).toBeCloseTo(at(5) + 0.4); expect(q(60)).toBeCloseTo(at(60) - 0.2)
  for (const f of [30, 90]) expect(q(f)).toBeCloseTo(at(f), 9)
  s().beginGesture(); for (const d of [0.1, 0.2, 0.3]) s().setValue(actor, ch, at(60) + d); s().endGesture() // a drag at one frame
  expect(items()[0].offset![ch].keys.map(k => k.f)).toEqual([0, 5, 20, 45, 60, 75])
  expect(q(60)).toBeCloseTo(at(60) + 0.3)
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
  expect(items()[0].offset![ch].keys.map(k => k.f)).toEqual([0, 15, 85, 100, 115])
  expect(s().setClip(c, { length: 80 })).toBe(true)
  expect(items()[0].offset![ch].keys.map(k => k.f)).toEqual([0, 15])
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
  expect(it.offset![ch].keys[1]).toMatchObject({ f: 60, interp: 'bezier' })
  expect(it.offset![ch].keys[1].v).toBeCloseTo(0.5)
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

test('the piece open in the clip preview is edited there: the main gizmo is locked on it; closing the preview unlocks', () => {
  const id = items()[0].id
  s().setFrame(60); s().select(actor, ch)
  expect(gizmoLock(s())).toBe(null)
  s().openItemPreview(id)
  expect(gizmoLock(s())).toBe('compare')
  s().closeItemPreview()
  expect(gizmoLock(s())).toBe(null)
})

test('the clip preview has its own playhead: opening (and playing) it leaves the main one; edits of that piece go to the preview frame', () => {
  const id = items()[0].id
  s().setFrame(70)
  s().openItemPreview(id, true)
  expect([s().frame, s().playing, s().previewPlaying, s().previewFrame]).toEqual([70, false, true, items()[0].start])
  s().setPreviewFrame(20)
  expect(editTarget(s(), actor)).toMatchObject({ itemId: id, f: 20 - items()[0].start + items()[0].trimIn })
  s().setValue(actor, ch, 1.1)
  expect(evaluate(s().project, defs, actor, 20).q[j()]).toBeCloseTo(1.1, 6) // keyed at the preview frame, not the main one (70)
  s().closeItemPreview()
  expect(s().previewPlaying).toBe(false)
  expect(editTarget(s(), actor)!.f).toBe(70 - items()[0].start + items()[0].trimIn)
})

test('project file keeps use: original and rejects other values', () => {
  s().setValue(actor, ch, 0.9); s().setItemUse(items()[0].id, 'original')
  const back = parseProject(serializeProject(s().project), defs)
  expect(back.sequence.tracks.find(t => t.actorId === actor)!.items[0].use).toBe('original')
  const bad = JSON.parse(serializeProject(s().project))
  bad.sequence.tracks.find((t: any) => t.actorId === actor).items[0].use = 'edited'
  expect(() => parseProject(JSON.stringify(bad), defs)).toThrow('.use')
})

// ---- 클립 수정 층 (Clip.offset, asset:<clipId>) ----
test('클립 수정 층: baseClip = original + delta (clamped); every piece plays it under its own 수정 층; the original channels stay', () => {
  const orig = s().project.clips[c]
  expect(baseClip(s().project, defs, c)).toBe(orig) // no 수정 층: the clip itself
  s().setKey(assetOwner(c), ch, 60, 0.3)
  const p = s().project, clip = p.clips[c]
  expect(clip.channels[ch]).toBe(orig.channels[ch]) // original curves untouched (shared)
  const base = baseClip(p, defs, c)!
  expect(base.offset).toBeUndefined()
  expect(evaluateClip(base, defs.g1, 60).q[j()]).toBeCloseTo(evaluateClip(orig, defs.g1, 60).q[j()] + 0.3, 6)
  expect(baseClip(p, defs, c)).toBe(base) // memo
  expect(q(60)).toBeCloseTo(evaluateClip(base, defs.g1, 60).q[j()], 6) // the sequence plays it
  s().setKey(items()[0].id, ch, 60, 0.1) // a piece adds its own 수정 층 on top
  expect(q(60)).toBeCloseTo(evaluateClip(base, defs.g1, 60).q[j()] + 0.1, 6)
  s().setItemUse(items()[0].id, 'original') // 원본 사용 drops only the piece's 수정 층
  expect(q(60)).toBeCloseTo(evaluateClip(base, defs.g1, 60).q[j()], 6)
  s().setKey(assetOwner(c), ch, 60, 50) // the sum is clamped to the URDF limit
  expect(evaluateClip(baseClip(s().project, defs, c)!, defs.g1, 60).q[j()]).toBeCloseTo(defs.g1.joints[j()].upper, 6)
  expect(keyOwner(s().project, assetOwner(c))).toMatchObject({ offset: true, robot: 'g1' })
})

test('클립 수정 층: one undo per edit, saved and read back, cut by a shorter clip, untouched by 키 줄이기', () => {
  s().setKey(assetOwner(c), ch, 10, 0.2); s().setKey(assetOwner(c), ch, 110, -0.1)
  expect(s().project.clips[c].offset![ch].keys.map(k => k.f)).toEqual([10, 110])
  s().undo(); expect(s().project.clips[c].offset![ch].keys).toHaveLength(1)
  s().redo()
  const back = parseProject(serializeProject(s().project), defs)
  expect(back.clips[c].offset![ch].keys.map(k => [k.f, k.v])).toEqual([[10, 0.2], [110, -0.1]])
  const bad = JSON.parse(serializeProject(s().project)); bad.clips[c].offset = { nope: { k: [0, 1, 0, 0, 0, 0, 0] } }
  expect(() => parseProject(JSON.stringify(bad), defs)).toThrow('offset')
  s().simplifyClip(c)
  expect(s().project.clips[c].offset![ch].keys).toHaveLength(2)
  expect(s().setClip(c, { length: 100 })).toBe(true)
  expect(s().project.clips[c].offset![ch].keys.map(k => k.f)).toEqual([10])
  s().deleteKeys(assetOwner(c), [{ channel: ch, f: 10 }])
  expect(s().project.clips[c].offset).toBeUndefined() // emptied 수정 층 dropped
})
