import { beforeEach, expect, test } from 'vitest'
import { initEditor } from '../store/store'
import { loadDef } from '../test/defs'
import { dropAsset } from './assetDrop'

let ed: ReturnType<typeof initEditor>
const s = () => ed.getState()
const defs = { g1: loadDef('g1'), go2: loadDef('go2') } // parse the meshes once per file, not inside the hook (10 s hook timeout under a full parallel run)
beforeEach(() => { ed = initEditor(defs) })

test('a new block clip dropped on empty space makes a GO2 actor; one undo removes clip and actor', () => {
  const clip = { id: 'blk', name: 'Stretch', robot: 'go2' as const, length: 30, channels: {} }
  expect(dropAsset({ kind: 'clip', id: clip.id, clip }, null, 0)).toBeNull()
  expect(s().project.clips.blk).toBeDefined()
  expect(s().project.actors.some(a => a.robot === 'go2')).toBe(true)
  s().undo()
  expect(s().project.clips.blk).toBeUndefined()
  expect(s().project.actors.some(a => a.robot === 'go2')).toBe(false)
})
test('a new block clip dropped on a locked GO2 track is rejected and adds nothing', () => {
  s().addActor('go2')
  const t = s().project.sequence.tracks.find(t => t.actorId === s().project.actors.at(-1)!.id)!
  s().setTrackFlag(t.id, 'locked', true)
  const clip = { id: 'blk', name: 'Stretch', robot: 'go2' as const, length: 30, channels: {} }
  expect(dropAsset({ kind: 'clip', id: clip.id, clip }, t.id, 0)).toBe('잠긴 트랙입니다')
  expect(s().project.clips.blk).toBeUndefined()
})
