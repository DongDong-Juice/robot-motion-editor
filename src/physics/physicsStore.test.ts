import { beforeEach, expect, test, vi } from 'vitest'
import { exportOne } from '../export/exportOne'
import { needsRun } from '../export/physicsWarn'
import { newProject } from '../model/defaults'
import { loadDef } from '../test/defs'
import { initEditor } from '../store/store'
import { setWorkerFactory, type FromWorker, type ToWorker } from './client'
import { isStale, usePhysics } from './physicsStore'
import { cancelAll, itemInput, runItems, whenSettled } from './runItem'

vi.mock('../fileio', () => ({ saveCsvFile: async () => true }))
const defs = { g1: loadDef('g1'), go2: loadDef('go2') }
const ed = initEditor(defs)
ed.getState().loadProject(newProject(), null)
const p = ed.getState().project
const actor = p.actors[0]
const item = p.sequence.tracks.find(t => t.actorId === actor.id)!.items[0]
const target = { actorId: actor.id, itemId: item.id }

let sent: ToWorker[] = []
let reply: (m: FromWorker) => void
let crash: () => void
let made = 0, terminated = 0
const metrics = { n: 2 } as any

beforeEach(() => {
  cancelAll()
  usePhysics.setState({ byItem: {}, progress: null, loading: false })
  sent = []; made = 0; terminated = 0
  setWorkerFactory(() => {
    made++
    const w: any = { postMessage: (m: ToWorker) => sent.push(m), onmessage: null, terminate: () => { terminated++ } }
    crash = () => w.onerror?.({})
    reply = data => w.onmessage?.({ data })
    return w
  })
})
const runs = () => sent.filter((m): m is Extract<ToWorker, { type: 'run' }> => m.type === 'run')

test('replacing an item ignores the old id\'s late result', async () => {
  void runItems([target]); void runItems([target])
  const [a, b] = runs()
  expect(b.id).not.toBe(a.id)
  reply({ type: 'result', id: a.id, metrics })
  expect(usePhysics.getState().byItem[item.id].status).toBe('queued')
  reply({ type: 'result', id: b.id, metrics })
  expect(usePhysics.getState().byItem[item.id].status).toBe('done')
  expect(usePhysics.getState().progress).toBeNull()
})

test('cancelAll clears pending state and ignores late results', async () => {
  void runItems([target])
  const { id } = runs()[0]
  reply({ type: 'progress', id, done: 60, total: 120 })
  expect(usePhysics.getState().byItem[item.id].status).toBe('running')
  cancelAll()
  expect(terminated).toBe(1)
  reply({ type: 'result', id, metrics })
  reply({ type: 'loading' })
  expect(usePhysics.getState().loading).toBe(false)
  void runItems([target])
  expect(made).toBe(2)
  expect(usePhysics.getState().byItem[item.id].status).toBe('queued')
  cancelAll()
  expect(usePhysics.getState().byItem).toEqual({})
  expect(usePhysics.getState().progress).toBeNull()
})

test('replacing the running item restarts the worker and re-posts the others', async () => {
  const other = p.actors[1], oi = p.sequence.tracks.find(t => t.actorId === other.id)!.items[0]
  void runItems([target, { actorId: other.id, itemId: oi.id }])
  reply({ type: 'progress', id: runs()[0].id, done: 60, total: 120 })
  expect(usePhysics.getState().progress).toMatchObject({ done: 0, total: 2, cur: 0.5 })
  void runItems([target])
  expect(terminated).toBe(1)
  expect(made).toBe(2)
  expect(runs().slice(2).map(r => r.id)).toEqual([runs()[1].id, runs()[3].id])
  expect(usePhysics.getState().progress).toMatchObject({ total: 2, cur: 0 })
})

test('error -> status error with message', async () => {
  void runItems([target])
  reply({ type: 'error', id: runs()[0].id, message: '미지원' })
  expect(usePhysics.getState().byItem[item.id]).toMatchObject({ status: 'error', message: '미지원' })
})

test('isStale compares result key with the current key', async () => {
  const { key } = itemInput(p, defs, actor.id, item.id)
  void runItems([target])
  reply({ type: 'result', id: runs()[0].id, metrics })
  expect(isStale(item.id, key)).toBe(false)
  expect(isStale(item.id, key + 'x')).toBe(true)
})

test('progress counts finished items over the whole queue', async () => {
  const other = p.actors[1], oi = p.sequence.tracks.find(t => t.actorId === other.id)!.items[0]
  void runItems([target, { actorId: other.id, itemId: oi.id }])
  expect(usePhysics.getState().progress).toMatchObject({ done: 0, total: 2 })
  reply({ type: 'result', id: runs()[0].id, metrics })
  expect(usePhysics.getState().progress).toMatchObject({ done: 1, total: 2 })
  reply({ type: 'loading' })
  expect(usePhysics.getState().loading).toBe(true)
  reply({ type: 'result', id: runs()[1].id, metrics })
  expect(usePhysics.getState().progress).toBeNull()
  expect(usePhysics.getState().loading).toBe(false)
})

test('runItems resolves only after the result message, and on cancelAll', async () => {
  let n = 0
  const p1 = runItems([target]).then(() => n++)
  await Promise.resolve(); await Promise.resolve()
  expect(n).toBe(0)
  reply({ type: 'result', id: runs()[0].id, metrics })
  await p1
  expect(n).toBe(1)
  const p2 = runItems([target])
  cancelAll()
  await p2
})

test('worker crash errors every pending item and settles waiters; next run makes a new worker', async () => {
  const p1 = runItems([target])
  crash()
  await p1
  expect(usePhysics.getState().byItem[item.id]).toMatchObject({ status: 'error', message: '물리 엔진 오류' })
  expect(usePhysics.getState().progress).toBeNull()
  void runItems([target])
  expect(made).toBe(2)
})

test('replacement keeps the earlier waiter until the new request settles', async () => {
  let n = 0
  const p1 = runItems([target]).then(() => n++)
  void runItems([target])
  await Promise.resolve(); await Promise.resolve()
  expect(n).toBe(0)
  reply({ type: 'result', id: runs()[1].id, metrics })
  await p1
  expect(n).toBe(1)
})

test('exportOne waits for an item that is already queued, then reports its skip note', async () => {
  void runItems([target])
  let msg: string | null = null
  const e = exportOne(p, defs, actor.id, item.id, () => true).then(m => (msg = m))
  await new Promise(r => setTimeout(r, 10))
  expect(msg).toBeNull()
  reply({ type: 'error', id: runs()[0].id, message: '미지원' })
  await e
  expect(msg).toContain('물리 검증 생략: 미지원')
  await whenSettled(item.id)
})

test('needsRun retries an error only when the key changed (미지원 never)', () => {
  const { key } = itemInput(p, defs, actor.id, item.id)
  expect(needsRun(p, defs, actor.id, item.id, { key, status: 'error', message: 'x' })).toBe(false)
  expect(needsRun(p, defs, actor.id, item.id, { key: key + 'x', status: 'error', message: 'x' })).toBe(true)
  expect(needsRun(p, defs, actor.id, item.id, { key: key + 'x', status: 'error', message: '미지원' })).toBe(false)
})
