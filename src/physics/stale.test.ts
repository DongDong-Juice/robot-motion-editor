import { expect, test, vi } from 'vitest'
import { newProject } from '../model/defaults'
import { loadDef } from '../test/defs'
import { initEditor } from '../store/store'
import { usePhysics } from './physicsStore'
import { itemInput, stale } from './runItem'

const calls = vi.hoisted(() => ({ n: 0 }))
vi.mock('../export/csv', async orig => {
  const m = await orig<typeof import('../export/csv')>()
  return { ...m, exportItemCsv: (...a: Parameters<typeof m.exportItemCsv>) => { calls.n++; return m.exportItemCsv(...a) } }
})

const defs = { g1: loadDef('g1'), go2: loadDef('go2') } // parsed once per file, outside any test's timeout (a full parallel run can take >20 s per parse)

test('stale re-exports only when the item\'s own inputs change', () => {
  const ed = initEditor(defs)
  ed.getState().loadProject(newProject(), null)
  const p0 = ed.getState().project, [g1, go2] = p0.actors
  const item = p0.sequence.tracks.find(t => t.actorId === g1.id)!.items[0]
  const clipOf = (actorId: string) => p0.sequence.tracks.find(t => t.actorId === actorId)!.items[0].refId
  usePhysics.setState({ byItem: { [item.id]: { key: itemInput(p0, defs, g1.id, item.id).key, status: 'done' } } })
  const check = () => stale(ed.getState().project, defs, g1.id, item.id)

  calls.n = 0
  expect(check()).toBe(false); expect(calls.n).toBe(1)
  expect(check()).toBe(false); expect(calls.n).toBe(1) // same project

  ed.getState().setKey(clipOf(go2.id), 'root.x', 10, 0.5) // other actor's track and clip
  expect(ed.getState().project).not.toBe(p0)
  expect(check()).toBe(false); expect(calls.n).toBe(1)

  ed.getState().setKey(clipOf(g1.id), defs.g1.joints[0].name, 10, 0.5) // the item's own clip (a joint: local mode rebases root x)
  expect(check()).toBe(true); expect(calls.n).toBe(2)
  expect(check()).toBe(true); expect(calls.n).toBe(2)
})
