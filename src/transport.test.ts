import { loadDef } from './test/defs'
import { expect, test } from 'vitest'

import { createEditorStore } from './store/store'
import { splitAtPlayhead, splitTarget } from './transport'

const load = loadDef

// Two g1 actors with an item each at 0..; item ids [a1 (first actor), b1 (second actor)]
function setup() {
  const st = createEditorStore({ g1: load('g1'), go2: load('go2') }), s = () => st.getState()
  const a = s().project.actors[0].id
  const track = (id: string) => s().project.sequence.tracks.find(t => t.actorId === id)!
  const clip = track(a).items[0].refId
  s().addActor('g1')
  const b = s().project.actors[1].id
  s().addItem(b, clip, 0)
  return { st, s, a, b, a1: track(a).items[0].id, b1: track(b).items[0].id, track }
}

test('C splits the item under the playhead; nothing in clip view', () => {
  const { s, a, a1 } = setup()
  s().select(a); s().setFrame(50)
  expect(splitTarget(s())).toBe(a1)
  s().openItem(a1)
  expect(splitTarget(s())).toBe(null)
})

test('a selected item that is not under the playhead is ignored', () => {
  const { s, a, a1 } = setup()
  s().select(a)
  s().addItem(a, s().project.sequence.tracks.find(t => t.actorId === a)!.items[0].refId, 2000)
  const far = s().project.sequence.tracks.find(t => t.actorId === a)!.items[1].id
  s().selectItem(far); s().setFrame(50)
  expect(splitTarget(s())).toBe(a1)
})

test('tie-break: selected item track, then selected actor, then top-most track', () => {
  const { s, a, b, a1, b1 } = setup()
  s().setFrame(50)
  s().selectItem(b1); s().select(a)
  expect(splitTarget(s())).toBe(b1) // selection on the second track wins over the actor
  s().selectItem(null)
  expect(splitTarget(s())).toBe(a1) // actor a
  s().select(b)
  expect(splitTarget(s())).toBe(b1)
  s().select(null as never)
  expect(splitTarget(s())).toBe(a1) // top-most track
})

test('after a split the right piece is selected', () => {
  const { st, s, a, a1, track } = setup()
  s().select(a); s().setFrame(50)
  expect(splitAtPlayhead(st, a1)).toBe(true)
  const items = track(a).items
  expect(items).toHaveLength(2)
  const right = items.find(i => i.id !== a1)!
  expect(right.start).toBe(50)
  expect(s().selItem).toBe(right.id)
})
