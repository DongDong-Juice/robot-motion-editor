import loadMujoco from '@mujoco/mujoco'
import type { FromWorker, ToWorker } from './client'
import { loadModel, simulate, type Loaded, type Metrics, type Robot } from './sim'

const send = (m: FromWorker, transfer: Transferable[] = []) => (self as any).postMessage(m, transfer)
const get = async (u: string) => {
  const r = await fetch(u)
  if (!r.ok) throw new Error('미지원')
  return new Uint8Array(await r.arrayBuffer())
}

let mj: any
const models = new Map<Robot, Promise<Loaded>>()
function model(robot: Robot) {
  let p = models.get(robot)
  if (!p) {
    p = (async () => {
      send({ type: 'loading' })
      const base = `${import.meta.env.BASE_URL}physics/${robot}/`
      const names: string[] = JSON.parse(new TextDecoder().decode(await get(base + 'files.json')))
      mj ??= await loadMujoco()
      return loadModel(mj, robot, {
        scene: await get(base + 'scene.xml'),
        meshes: await Promise.all(names.map(async n => ({ name: n.replace('meshes/', ''), data: await get(base + n) }))),
      })
    })()
    models.set(robot, p)
    p.catch(() => models.delete(robot)) // retry on the next request
  }
  return p
}

const cancelled = new Set<number>()
class Cancel extends Error {}
let chain = Promise.resolve()

async function run(m: Extract<ToWorker, { type: 'run' }>) {
  const { id } = m
  try {
    if (cancelled.has(id)) return
    const L = await model(m.robot)
    if (cancelled.has(id)) return
    const metrics = simulate(L, m.rows, m.settings, (done, total) => {
      if (cancelled.has(id)) throw new Cancel()
      send({ type: 'progress', id, done, total })
    })
    const bufs = (['forceN', 'torqueNm', 'pct', 'pelvisZ', 'trackErrMax', 'satJoints'] as (keyof Metrics)[]).map(k => (metrics[k] as Float32Array).buffer)
    send({ type: 'result', id, metrics }, bufs)
  } catch (e) {
    if (!(e instanceof Cancel)) send({ type: 'error', id, message: e instanceof Error ? e.message : String(e) })
  } finally { cancelled.delete(id) }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  // ponytail: a sim already running is a sync loop and never sees this message, so cancel only stops queued runs; terminate the worker if mid-run abort matters
  if (m.type === 'cancel') cancelled.add(m.id)
  else chain = chain.then(() => run(m))
}
