import { loadDef } from '../test/defs'
import { beforeEach, expect, test } from 'vitest'
import { evaluate, type RobotDefs } from '../model/evaluate'
import { editedClip, itemClip } from '../model/itemClip'
import { parseProject, serializeProject } from '../model/projectFile'
import { sortedItems } from '../model/sequence'
import { createEditorStore } from './store'

// 원본 조각 and 수정본 handled apart (user): deleting the 수정본 keeps the piece; deleting the piece keeps its 수정본; a cut cuts both;
// 수정 완료 bakes the 수정본 into a new clip.
const defs: RobotDefs = { g1: loadDef('g1'), go2: loadDef('go2') }
const ch = 'left_knee_joint', j = () => defs.g1.joints.findIndex(x => x.name === ch)
let st: ReturnType<typeof createEditorStore>
let actor: string, c: string
const s = () => st.getState()
const track = () => s().project.sequence.tracks.find(t => t.actorId === actor)!
const items = () => sortedItems(track())
const q = (f: number) => evaluate(s().project, defs, actor, f).q[j()]

beforeEach(() => {
  st = createEditorStore(defs)
  actor = s().project.actors[0].id
  c = items()[0].refId
  s().setLayer('clip'); s().toggleAutoKey(); s().setKey(c, ch, 0, 0.2); s().setKey(c, ch, 119, 0.6); s().toggleAutoKey(); s().setLayer('piece')
  s().setFrame(60); s().setValue(actor, ch, 1.0) // the piece's 수정본: 1.0 at frame 60
})

test('수정본 삭제 (Delete on the 수정 row): only the 수정 층 goes, the piece stays as the original; one undo', () => {
  const id = items()[0].id
  s().selectItem(id, true)
  expect(s().selEdit).toBe(true)
  expect(s().removePiece(id, 'edit')).toBe(true)
  expect(items()).toHaveLength(1)
  expect(items()[0].offset).toBeUndefined()
  expect(q(60)).not.toBeCloseTo(1.0)
  s().undo()
  expect(q(60)).toBeCloseTo(1.0)
})

test('원본 삭제 (Delete on the piece): the 수정본 stays where it was and plays; no 원본 사용 / 수정 비교; Delete again removes it', () => {
  const id = items()[0].id
  s().setItemUse(id, 'original') // even when the original was the side in use
  expect(s().removePiece(id, 'piece')).toBe(true)
  const it = items()[0]
  expect([it.id, it.noOriginal, it.use]).toEqual([id, true, undefined])
  expect(itemClip(s().project, defs, it)).toBe(editedClip(s().project, defs, it))
  expect(q(60)).toBeCloseTo(1.0)
  expect(s().setItemUse(id, 'original')).toBe(false)
  s().openEditCompare(id); expect(s().previewEdit).toBe(false)
  expect(s().clearOffset(id)).toBe(false) // a 수정본-only piece is not turned back into the original
  expect(s().removePiece(id, 'edit')).toBe(true) // deleting the 수정본 now leaves nothing: the piece (and its robot) go
  expect(s().project.actors.some(a => a.id === actor)).toBe(false)
  s().undo()
  expect(items()[0].noOriginal).toBe(true)
  expect(s().removePiece(id, 'piece')).toBe(true) // the lane of a 수정본-only piece is the 수정본
  expect(s().project.actors.some(a => a.id === actor)).toBe(false)
})

test('a piece without a 수정본 is deleted as before; a cut copies the 수정본 (and 원본 삭제) to both pieces', () => {
  const id = items()[0].id
  expect(s().splitItem(id, 30)).toBe(true)
  const [a, b] = items()
  expect(b.offset).toEqual(a.offset)
  expect(s().removePiece(a.id, 'edit')).toBe(true) // a has no 수정본 left
  expect(s().removePiece(a.id, 'piece')).toBe(true)
  expect(items().map(i => i.id)).toEqual([b.id])
  expect(s().removePiece(b.id, 'piece')).toBe(true)
  expect(s().splitItem(b.id, 90)).toBe(true)
  expect(items().map(i => i.noOriginal)).toEqual([true, true])
})

test('수정 완료: a new clip "<clip> #n 수정본" plays exactly the 수정본; the old clip and other pieces are untouched; saved', () => {
  const id = items()[0].id
  expect(s().splitItem(id, 100)).toBe(true)
  const before = [10, 60, 99].map(q), oldClip = s().project.clips[c]
  expect(s().bakeEdit(id)).toBe(true)
  const it = items()[0], clip = s().project.clips[it.refId]
  expect(it.refId).not.toBe(c)
  expect(clip.name).toBe(`${oldClip.name} #1 수정본`)
  expect([it.offset, it.use, it.noOriginal, clip.offset]).toEqual([undefined, undefined, undefined, undefined])
  for (const [i, f] of [10, 60, 99].entries()) expect(q(f)).toBeCloseTo(before[i], 9)
  expect(s().project.clips[c]).toBe(oldClip)
  expect(items()[1].refId).toBe(c)
  expect(s().bakeEdit(it.id)).toBe(false) // nothing left to bake
  s().undo()
  expect(items()[0].refId).toBe(c)
  expect(s().project.clips[clip.id]).toBeUndefined()
})

test('noOriginal is saved and read back; anything but true is rejected', () => {
  s().removePiece(items()[0].id, 'piece')
  expect(parseProject(serializeProject(s().project), defs).sequence.tracks.find(t => t.actorId === actor)!.items[0].noOriginal).toBe(true)
  const bad = JSON.parse(serializeProject(s().project))
  bad.sequence.tracks.find((t: any) => t.actorId === actor).items[0].noOriginal = false
  expect(() => parseProject(JSON.stringify(bad), defs)).toThrow('noOriginal')
})
