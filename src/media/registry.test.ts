import { afterEach, expect, test, vi } from 'vitest'
import { clearMedia, mediaUrl, setMediaUrl, subscribeMedia } from './registry'

afterEach(() => { clearMedia(); vi.restoreAllMocks() })

test('set/get; replacing revokes the previous url', () => {
  const rev = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  expect(mediaUrl('a')).toBeNull()
  setMediaUrl('a', 'blob:1')
  expect(mediaUrl('a')).toBe('blob:1')
  setMediaUrl('a', 'blob:2')
  expect(rev).toHaveBeenCalledWith('blob:1')
  expect(mediaUrl('a')).toBe('blob:2')
})

test('subscribe notifies on set and clear; unsubscribe stops it', () => {
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const fn = vi.fn()
  const off = subscribeMedia(fn)
  setMediaUrl('a', 'blob:1')
  clearMedia()
  expect(fn).toHaveBeenCalledTimes(2)
  off()
  setMediaUrl('a', 'blob:3')
  expect(fn).toHaveBeenCalledTimes(2)
})

test('clearMedia revokes everything', () => {
  const rev = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  setMediaUrl('a', 'blob:1'); setMediaUrl('b', 'blob:2')
  clearMedia()
  expect(rev).toHaveBeenCalledWith('blob:1')
  expect(rev).toHaveBeenCalledWith('blob:2')
  expect(mediaUrl('a')).toBeNull()
})
