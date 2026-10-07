import { loadDef } from '../test/defs'
import { beforeEach, expect, test } from 'vitest'
import type { RobotDefs } from '../model/evaluate'
import { createEditorStore, trackLocked } from './store'
import { samplePoses } from '../export/csv'

const defs: RobotDefs = { g1: loadDef('g1'), go2: loadDef('go2') }
let st: ReturnType<typeof createEditorStore>
let c: string, actor: string, trackId: string, itemId: string
const s = () => st.getState()
const ch = 'left_knee_joint'

beforeEach(() => {
  st = createEditorStore(defs)
  actor = s().project.actors[0].id
  const t = s().project.sequence.tracks.find(t => t.actorId === actor)!
  trackId = t.id; itemId = t.items[0].id; c = t.items[0].refId
})

test('setTrackFlag toggles, is one undo, dirty, works while locked', () => {
  s().markSaved('x')
  s().setTrackFlag(trackId, 'locked', true)
  expect(s().dirty).toBe(true)
  expect(trackLocked(s().project, actor)).toBe(true)
  s().setTrackFlag(trackId, 'locked', false) // unlock while locked
  expect(trackLocked(s().project, actor)).toBe(false)
  s().undo()
  expect(trackLocked(s().project, actor)).toBe(true)
  s().undo()
  expect(trackLocked(s().project, actor)).toBe(false)
})

test('locked track rejects every edit action with project unchanged', () => {
  s().setKey(c, ch, 3, 0.2); s().setKey(c, ch, 6, 0.4)
  s().addMedia('a.mp4', 100)
  const m = s().project.media[0].id
  s().selectItem(itemId)
  s().setTrackFlag(trackId, 'locked', true)
  s().setTrackFlag(s().project.sequence.tracks.find(t => t.kind === 'video')!.id, 'locked', true)
  const k = [{ channel: ch, f: 3 }]
  const table: [string, () => unknown][] = [
    ['addItem', () => s().addItem(actor, c, 500)],
    ['addVideoItem', () => s().addVideoItem(m, 0)],
    ['moveItem', () => s().moveItem(itemId, 10)],
    ['trimItem', () => s().trimItem(itemId, 'out', -5)],
    ['splitItem', () => s().splitItem(itemId, 30)],
    ['deleteItem', () => s().deleteItem(itemId)],
    ['setKey', () => s().setKey(c, ch, 9, 1)],
    ['deleteKeys', () => s().deleteKeys(c, k)],
    ['moveKeys', () => s().moveKeys(c, k, 1)],
    ['setInterp', () => s().setInterp(c, k, 'hold')],
    ['setTangent', () => s().setTangent(c, ch, 3, 'out', { df: 1, dv: 1 }, false)],
    ['setValue', () => { s().toggleAutoKey(); s().setValue(actor, ch, 0.9); s().toggleAutoKey() }],
    ['keyGroup', () => s().keyGroup(actor, '루트')],
    ['simplifyClip', () => s().simplifyClip(c)],
    ['setClip name', () => s().setClip(c, { name: 'zzz' })],
    ['setClip length', () => s().setClip(c, { length: 50 })],
  ]
  for (const [name, fn] of table) {
    const before = s().project
    const r = fn()
    expect(s().project, name).toBe(before)
    if (typeof r === 'boolean') expect(r, name).toBe(false)
  }
})

test('lock on one track locks a clip shared with another track', () => {
  s().addActor(s().project.actors[0].robot)
  const a2 = s().project.actors.at(-1)!.id
  expect(s().addItem(a2, c, 500)).toBe(true)
  s().setTrackFlag(trackId, 'locked', true)
  const before = s().project
  s().setKey(c, ch, 9, 1)
  expect(s().project).toBe(before)
})

test('hidden does not affect evaluate/CSV', () => {
  const a = samplePoses(s().project, defs, actor, itemId, 'local')
  s().setTrackFlag(trackId, 'hidden', true)
  expect(s().project.sequence.tracks.find(t => t.id === trackId)!.hidden).toBe(true)
  expect(samplePoses(s().project, defs, actor, itemId, 'local')).toEqual(a)
})
