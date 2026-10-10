import { exportItemCsv } from '../export/csv'
import type { RobotDefs } from '../model/evaluate'
import type { Project } from '../model/types'
import { getEditor } from '../store/store'
import { onWorkerError, onWorkerMessage, post, terminateWorker, type ToWorker } from './client'
import { csvRows } from './csvRows'
import { usePhysics, type ItemPhys } from './physicsStore'
import { cacheKey, withDefaults } from './settings'
import type { Robot } from './sim'

export function csvKey(p: Project, defs: RobotDefs, actorId: string, itemId: string) {
  const robot = p.actors.find(a => a.id === actorId)!.robot
  const { text } = exportItemCsv(p, defs, actorId, itemId, 'local')
  return { robot, text, key: cacheKey(robot, text, withDefaults(p.physics)) }
}
export function itemInput(p: Project, defs: RobotDefs, actorId: string, itemId: string): { robot: Robot; rows: Float64Array[]; key: string } {
  const { robot, text, key } = csvKey(p, defs, actorId, itemId)
  return { robot, rows: csvRows(text), key }
}

// The item's CSV reads only its track (neighbours: crossfade, root stitching), the clips of that track, the actor and defs;
// the key adds p.physics. Clips are structurally shared (same object when untouched); every edit structuredClones
// actors and sequence, so track and actor are compared by value.
// ponytail: editing the item's own clip still re-exports once per gesture tick (~290 ms for 210 s); defer during gestures if it hitches
const keys = new Map<string, { deps: unknown[]; key: string }>()
const sameDeps = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => v === b[i])
/** True when the item's stored result was computed from a different CSV/settings than the current project gives. */
export function stale(p: Project, defs: RobotDefs, actorId: string, itemId: string): boolean {
  const st = usePhysics.getState().byItem[itemId]
  if (st?.status !== 'done') return false
  const track = p.sequence.tracks.find(t => t.items.some(i => i.id === itemId))
  const deps = [JSON.stringify(track), JSON.stringify(p.actors.find(a => a.id === actorId)), p.physics, defs, ...(track?.items.map(i => p.clips[i.refId]) ?? [])]
  let c = keys.get(itemId)
  if (!c || !sameDeps(c.deps, deps)) keys.set(itemId, c = { deps, key: csvKey(p, defs, actorId, itemId).key })
  return c.key !== st.key
}

let nextId = 1
const byId = new Map<number, string>() // live request id -> itemId (a replaced/cancelled id is absent, so its late messages are ignored)
const idOf = new Map<string, number>()
const msgs = new Map<number, ToWorker>() // live run requests, to re-post after a worker restart
let total = 0, done = 0, cur = 0, label = ''
const setItem = (itemId: string, v: ItemPhys) => usePhysics.setState(s => ({ byItem: { ...s.byItem, [itemId]: v } }))
const waiters = new Map<string, (() => void)[]>() // runItems callers waiting for an item to leave the queue
const settle = (item: string) => { waiters.get(item)?.forEach(r => r()); waiters.delete(item) }
const showProgress = () => usePhysics.setState({ progress: total && done < total ? { done, total, label, cur } : null })
function leave(id: number) { // request leaves the queue
  const item = byId.get(id)!
  byId.delete(id); idOf.delete(item); msgs.delete(id); cur = 0
  settle(item)
  if (++done >= total) total = done = 0
  showProgress()
}

onWorkerMessage(m => {
  if (m.type === 'loading') return byId.size ? usePhysics.setState({ loading: true }) : undefined
  const item = byId.get(m.id)
  if (item === undefined) return
  usePhysics.setState({ loading: false })
  const st = usePhysics.getState().byItem[item]
  if (m.type === 'progress') {
    if (st.status === 'queued') setItem(item, { ...st, status: 'running' })
    cur = m.total ? m.done / m.total : 0
    return showProgress()
  }
  leave(m.id)
  setItem(item, m.type === 'result' ? { key: st.key, status: 'done', metrics: m.metrics } : { key: st.key, status: 'error', message: m.message })
})

// A crashed worker never answers: fail every live request so no waiter hangs (the next run creates a new worker).
onWorkerError(() => {
  for (const [id, item] of [...byId]) {
    const st = usePhysics.getState().byItem[item]
    leave(id)
    setItem(item, { key: st?.key ?? '', status: 'error', message: '물리 엔진 오류' })
  }
  usePhysics.setState({ loading: false })
})

/** Resolves once the item has no live request (done, errored, cancelled); a replacement keeps earlier waiters until it settles too. */
export const whenSettled = (itemId: string): Promise<void> =>
  idOf.has(itemId) ? new Promise(r => waiters.set(itemId, [...(waiters.get(itemId) ?? []), r])) : Promise.resolve()

/** Queues every item on the worker (it runs them in order). Re-requesting an item replaces its pending request.
 *  Resolves once every listed item is done, errored or cancelled (a replaced request's waiters wait for its replacement). */
export function runItems(list: { actorId: string; itemId: string }[]): Promise<void> {
  const ed = getEditor().getState()
  const waits: Promise<void>[] = []
  for (const { actorId, itemId } of list) {
    const old = idOf.get(itemId)
    if (old !== undefined) { // superseded: takes no progress slot
      const running = usePhysics.getState().byItem[itemId]?.status === 'running'
      byId.delete(old); msgs.delete(old); total--; cur = running ? 0 : cur
      if (running) restart()
      else post({ type: 'cancel', id: old })
    }
    const id = nextId++
    try {
      const { robot, rows, key } = itemInput(ed.project, ed.defs, actorId, itemId)
      byId.set(id, itemId); idOf.set(itemId, id); total++; label = itemId
      setItem(itemId, { key, status: 'queued' })
      showProgress()
      const run: ToWorker = { type: 'run', id, robot, rows, settings: withDefaults(ed.project.physics) }
      msgs.set(id, run)
      post(run)
      waits.push(new Promise(r => waiters.set(itemId, [...(waiters.get(itemId) ?? []), r])))
    } catch (e) {
      setItem(itemId, { key: usePhysics.getState().byItem[itemId]?.key ?? '', status: 'error', message: e instanceof Error ? e.message : String(e) })
      settle(itemId) // superseded request is gone and no replacement queued
      if (done >= total) total = done = 0
      showProgress()
    }
  }
  return Promise.all(waits).then(() => {})
}

/** Terminates the worker (aborting the running sim) and re-posts the still-live requests to a fresh one. */
function restart() {
  terminateWorker()
  for (const m of msgs.values()) post(m)
}

export function cancelAll() {
  terminateWorker()
  for (const [id, item] of [...byId]) {
    byId.delete(id); idOf.delete(item); msgs.delete(id)
    usePhysics.setState(s => { const { [item]: _, ...rest } = s.byItem; return { byItem: rest } })
    settle(item)
  }
  total = done = cur = 0
  usePhysics.setState({ progress: null, loading: false })
}
