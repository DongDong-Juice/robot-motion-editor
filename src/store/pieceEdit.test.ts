import { loadDef } from '../test/defs'
import { beforeEach, expect, test } from 'vitest'
import { evaluate, type RobotDefs } from '../model/evaluate'
import { sortedItems } from '../model/sequence'
import { createEditorStore } from './store'

// A cut piece carries its own 수정 (no separate 수정본, user): it is marked 수정됨, deleting the piece takes its 수정 with it,
// 수정 지우기 makes it the original again, a cut copies it to both pieces.
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
  s().setFrame(60); s().setValue(actor, ch, 1.0) // the piece is 수정됨: 1.0 at frame 60
})

test('수정 지우기 makes the piece the original again; deleting a 수정됨 piece removes it with its 수정; one undo each', () => {
  const id = items()[0].id
  expect(s().clearOffset(id)).toBe(true)
  expect(items()[0].offset).toBeUndefined()
  expect(q(60)).not.toBeCloseTo(1.0)
  s().undo()
  expect(q(60)).toBeCloseTo(1.0)
  expect(s().splitItem(id, 30)).toBe(true)
  const [a, b] = items()
  expect(b.offset).toEqual(a.offset) // a cut copies the 수정 to both pieces (clip frames: each keeps its part)
  expect(s().deleteItem(b.id)).toBe(true)
  expect(items().map(i => i.id)).toEqual([a.id])
  s().undo()
  expect(items().map(i => i.id)).toEqual([a.id, b.id])
})
