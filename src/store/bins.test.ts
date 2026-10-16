import { beforeEach, expect, test } from 'vitest'
import { loadDef } from '../test/defs'
import type { RobotDefs } from '../model/evaluate'
import { createEditorStore } from './store'

const defs: RobotDefs = { g1: loadDef('g1'), go2: loadDef('go2') }
let st: ReturnType<typeof createEditorStore>
const s = () => st.getState()
beforeEach(() => { st = createEditorStore(defs) })

test('addBin names 폴더 1, 폴더 2 and takes the given items; one undo each', () => {
  const c = s().newClip('g1')
  const b1 = s().addBin('clip', [c]), b2 = s().addBin('clip')
  expect(s().project.bins!.map(b => b.name)).toEqual(['폴더 1', '폴더 2'])
  expect(s().project.clips[c].bin).toBe(b1)
  s().undo(); expect(s().project.bins!.map(b => b.id)).toEqual([b1])
  void b2
})
test('renameBin ignores a blank name', () => {
  const b = s().addBin('clip')
  expect(s().renameBin(b, '  ')).toBe(false)
  expect(s().renameBin(b, ' Walk ')).toBe(true)
  expect(s().project.bins![0].name).toBe('Walk')
})
test('renameBin to the same name is a no-op with no undo entry', () => {
  const b = s().addBin('clip')
  expect(s().renameBin(b, ' 폴더 1 ')).toBe(false)
  s().undo()
  expect(s().project.bins ?? []).toEqual([])
})
test('deleteBin keeps its items at the top level', () => {
  const c = s().newClip('g1'), b = s().addBin('clip', [c])
  s().deleteBin(b)
  expect(s().project.bins).toEqual([])
  expect(s().project.clips[c]).toBeDefined()
  expect(s().project.clips[c].bin).toBeUndefined()
})
test('moveToBin: into a folder, back to the top, other-tab items skipped, no-op is false', () => {
  const c = s().newClip('g1'), b = s().addBin('clip'), m = s().addMedia('ref', 60), mb = s().addBin('media')
  const ch = s().project.clips[c].channels
  expect(s().moveToBin([c, m], b)).toBe(true)
  expect(s().project.clips[c].bin).toBe(b)
  expect(s().project.media.find(x => x.id === m)!.bin).toBeUndefined()
  expect(s().project.clips[c].channels).toBe(ch) // channels shared, no re-bake
  expect(s().moveToBin([c], b)).toBe(false)
  expect(s().moveToBin([m], mb)).toBe(true)
  expect(s().moveToBin([c], null)).toBe(true)
  expect(s().project.clips[c].bin).toBeUndefined()
})
test('addClip adds at the top level with a unique name', () => {
  const a = s().newClip('g1'), name = s().project.clips[a].name
  const id = s().addClip({ id: crypto.randomUUID(), name, robot: 'g1', length: 10, channels: {} })
  expect(s().project.clips[id].name).toBe(`${name}_2`)
})
