import type { Metrics, Robot } from './sim'
import type { PhysicsSettings } from './settings'

export type ToWorker = { type: 'run'; id: number; robot: Robot; rows: Float64Array[]; settings: PhysicsSettings } | { type: 'cancel'; id: number }
export type FromWorker = { type: 'loading' } | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; metrics: Metrics } | { type: 'error'; id: number; message: string }

export interface WorkerLike { postMessage(m: ToWorker): void; onmessage: ((e: { data: FromWorker }) => void) | null }

let make = (): WorkerLike => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike
let w: WorkerLike | null = null
let sink: (m: FromWorker) => void = () => {}

/** Tests inject a fake worker here (also drops the current one). */
export function setWorkerFactory(f: () => WorkerLike) { make = f; w = null }
export const onWorkerMessage = (f: (m: FromWorker) => void) => { sink = f }
export function post(m: ToWorker) {
  if (!w) { w = make(); w.onmessage = e => sink(e.data) }
  w.postMessage(m)
}
