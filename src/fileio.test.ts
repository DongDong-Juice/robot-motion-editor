import { afterEach, expect, test, vi } from 'vitest'
import { openFiles, openMediaFiles, openTextFiles } from './fileio'

const file = (name: string, text: string) => ({ name, text: async () => text })
const stub = (pick: unknown) => vi.stubGlobal('window', { showOpenFilePicker: pick })
afterEach(() => vi.unstubAllGlobals())

test('openFiles passes accept types and returns the files', async () => {
  const pick = vi.fn(async () => [{ getFile: async () => file('a.csv', 'x') }])
  stub(pick)
  expect(await openFiles('.csv', { 'text/plain': ['.csv'] }, true)).toHaveLength(1)
  expect(pick).toHaveBeenCalledWith({ multiple: true, types: [{ accept: { 'text/plain': ['.csv'] } }] })
})

test('AbortError returns []; other errors propagate', async () => {
  stub(async () => { throw new DOMException('x', 'AbortError') })
  expect(await openFiles('.csv', {}, false)).toEqual([])
  expect(await openMediaFiles(false)).toEqual([])
  expect(await openTextFiles('.csv', false)).toEqual([])
  stub(async () => { throw new Error('boom') })
  await expect(openFiles('.csv', {}, false)).rejects.toThrow('boom')
})

test('openTextFiles reads text; openMediaFiles asks for video/*', async () => {
  const pick = vi.fn(async () => [{ getFile: async () => file('a.csv', 'hello') }])
  stub(pick)
  expect(await openTextFiles('.csv,.txt', false)).toEqual([{ name: 'a.csv', text: 'hello' }])
  expect(pick).toHaveBeenLastCalledWith({ multiple: false, types: [{ accept: { 'text/plain': ['.csv', '.txt'] } }] })
  await openMediaFiles(true)
  expect(pick).toHaveBeenLastCalledWith({ multiple: true, types: [{ accept: { 'video/*': [] } }] })
})
