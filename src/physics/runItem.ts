import { exportItemCsv } from '../export/csv'
import type { RobotDefs } from '../model/evaluate'
import type { Project } from '../model/types'
import { getEditor } from '../store/store'
import { onWorkerMessage, post } from './client'
import { csvRows } from './csvRows'
import { usePhysics, type ItemPhys } from './physicsStore'
import { cacheKey, withDefaults } from './settings'
import type { Robot } from './sim'

export function itemInput(p: Project, defs: RobotDefs, actorId: string, itemId: string): { robot: Robot; rows: Float64Array[]; key: string } {
  const robot = p.actors.find(a => a.id === actorId)!.robot
  const { text } = exportItemCsv(p, defs, actorId, itemId, 'local')
  return { robot, rows: csvRows(text), key: cacheKey(robot, text, withDefaults(p.physics)) }
}

let nextId = 1
const byId = new Map<number, string>() // live request id -> itemId (a replaced/cancelled id is absent, so its late messages are ignored)
const idOf = new Map<string, number>()
let total = 0, done = 0, label = ''
const setItem = (itemId: string, v: ItemPhys) => usePhysics.setState(s => ({ byItem: { ...s.byItem, [itemId]: v } }))
const showProgress = () => usePhysics.setState({ progress: total && done < total ? { done, total, label } : null })
function leave(id: number) { // request leaves the queue
  const item = byId.get(id)!
  byId.delete(id); idOf.delete(item)
  if (++done >= total) total = done = 0
  showProgress()
}

onWorkerMessage(m => {
  if (m.type === 'loading') return usePhysics.setState({ loading: true })
  const item = byId.get(m.id)
  if (item === undefined) return
  usePhysics.setState({ loading: false })
  const cur = usePhysics.getState().byItem[item]
  if (m.type === 'progress') { if (cur.status === 'queued') setItem(item, { ...cur, status: 'running' }); return }
  leave(m.id)
  setItem(item, m.type === 'result' ? { key: cur.key, status: 'done', metrics: m.metrics } : { key: cur.key, status: 'error', message: m.message })
})

/** Queues every item on the worker (it runs them in order). Re-requesting an item replaces its pending request. */
export async function runItems(list: { actorId: string; itemId: string }[]): Promise<void> {
  const ed = getEditor().getState()
  for (const { actorId, itemId } of list) {
    const old = idOf.get(itemId)
    if (old !== undefined) { post({ type: 'cancel', id: old }); byId.delete(old); total-- } // superseded: takes no progress slot
    const id = nextId++
    try {
      const { robot, rows, key } = itemInput(ed.project, ed.defs, actorId, itemId)
      byId.set(id, itemId); idOf.set(itemId, id); total++; label = itemId
      setItem(itemId, { key, status: 'queued' })
      showProgress()
      post({ type: 'run', id, robot, rows, settings: withDefaults(ed.project.physics) })
    } catch (e) {
      setItem(itemId, { key: usePhysics.getState().byItem[itemId]?.key ?? '', status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }
}

export function cancelAll() {
  for (const [id, item] of [...byId]) {
    post({ type: 'cancel', id })
    byId.delete(id); idOf.delete(item)
    usePhysics.setState(s => { const { [item]: _, ...rest } = s.byItem; return { byItem: rest } })
  }
  total = done = 0
  usePhysics.setState({ progress: null, loading: false })
}
