import { create } from 'zustand'
import type { Metrics } from './sim'

export type ItemPhys = { key: string; status: 'queued' | 'running' | 'done' | 'error'; metrics?: Metrics; message?: string }
interface PhysState {
  byItem: Record<string, ItemPhys>
  progress: { done: number; total: number; label: string; cur: number } | null
  loading: boolean
}

export const usePhysics = create<PhysState>(() => ({ byItem: {}, progress: null, loading: false }))

export const isStale = (itemId: string, currentKey: string) => usePhysics.getState().byItem[itemId]?.key !== currentKey
