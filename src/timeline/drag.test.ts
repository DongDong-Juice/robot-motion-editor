import { afterEach, expect, test, vi } from 'vitest'
import { cancelDrag, dragActive, trackDrag } from './drag'

const listeners = new Map<string, Set<(e: MouseEvent) => void>>()
vi.stubGlobal('addEventListener', (t: string, f: (e: MouseEvent) => void) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t)!.add(f) })
vi.stubGlobal('removeEventListener', (t: string, f: (e: MouseEvent) => void) => listeners.get(t)?.delete(f))
const fire = (t: string) => [...listeners.get(t) ?? []].forEach(f => f({} as MouseEvent))
afterEach(() => { cancelDrag(); listeners.clear() })

test('mouseup ends a drag normally; nothing left to cancel', () => {
  const up = vi.fn(), cancel = vi.fn()
  trackDrag(() => {}, up, cancel)
  expect(dragActive()).toBe(true)
  fire('mouseup')
  expect(up).toHaveBeenCalledOnce()
  expect(dragActive()).toBe(false)
  expect(cancelDrag()).toBe(false)
  expect(cancel).not.toHaveBeenCalled()
})

test('cancelDrag aborts: cancel runs, up never does, listeners removed', () => {
  const mv = vi.fn(), up = vi.fn(), cancel = vi.fn()
  trackDrag(mv, up, cancel)
  expect(cancelDrag()).toBe(true)
  expect(cancel).toHaveBeenCalledOnce()
  fire('mousemove'); fire('mouseup')
  expect(mv).not.toHaveBeenCalled()
  expect(up).not.toHaveBeenCalled()
  expect(dragActive()).toBe(false)
})

test('a drag without cancel (scrub) is not cancellable, so Ctrl+Z undoes as usual', () => {
  const up = vi.fn()
  trackDrag(() => {}, up)
  expect(dragActive()).toBe(false)
  expect(cancelDrag()).toBe(false)
  fire('mouseup')
  expect(up).toHaveBeenCalledOnce()
})
