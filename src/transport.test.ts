import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { loadRobotDef } from './robot/loadRobot'
import type { RobotKind } from './robot/types'
import { createEditorStore } from './store/store'
import { splitTarget } from './transport'

const load = (k: RobotKind) => {
  const r = (f: string) => JSON.parse(readFileSync(new URL(`../public/robots/${k}/${f}`, import.meta.url), 'utf8'))
  return loadRobotDef(k, r('model.json'), r('meshes.json'))
}

test('C splits the selected item, else the item under the playhead; nothing in clip view', () => {
  const st = createEditorStore({ g1: load('g1'), go2: load('go2') }), s = () => st.getState()
  const actor = s().project.actors[0].id
  const items = () => s().project.sequence.tracks.find(t => t.actorId === actor)!.items
  const first = items()[0].id
  s().select(actor); s().setFrame(50)
  expect(splitTarget(s())).toBe(first)
  s().addItem(actor, items()[0].refId, 200)
  const second = items()[1].id
  s().selectItem(second)
  expect(splitTarget(s())).toBe(second)
  s().deleteItem(second); s().selectItem(second) // stale selection
  expect(splitTarget(s())).toBe(first)
  s().openItem(first)
  expect(splitTarget(s())).toBe(null)
})
