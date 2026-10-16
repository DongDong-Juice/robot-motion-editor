import { expect, test } from 'vitest'
import { filterTree, type Row } from './binTree'

const bins = [{ id: 'w', name: 'Walk', tab: 'clip' as const }, { id: 'e', name: 'Empty', tab: 'clip' as const }]
const items = [{ id: 'a', name: 'walk_g1', bin: 'w' }, { id: 'b', name: 'Jump' }, { id: 'c', name: 'walk_turn', bin: 'w' }]
const shape = (r: { rows: Row[] }) => r.rows.map(x => x.kind === 'bin' ? `${x.open ? '▾' : '▸'}${x.bin.id}` : `${'  '.repeat(x.depth)}${x.id}`)

test('no query: folders first (collapsed unless open), empty folder shown, then top-level items', () => {
  expect(shape(filterTree(items, bins, '', new Set()))).toEqual(['▸w', '▸e', 'b'])
  expect(shape(filterTree(items, bins, '', new Set(['w'])))).toEqual(['▾w', '  a', '  c', '▸e', 'b'])
  expect(filterTree(items, bins, '', new Set()).count).toBe(3)
})
test('query: case-insensitive name match, matching folders auto-open, others and empty folders hidden', () => {
  const r = filterTree(items, bins, '  WALK ', new Set())
  expect(shape(r)).toEqual(['▾w', '  a', '  c'])
  expect(r.count).toBe(2)
  expect(shape(filterTree(items, bins, 'jump', new Set(['w'])))).toEqual(['b'])
})
test('folder names are not searched', () => {
  expect(filterTree(items, bins, 'empty', new Set()).rows).toEqual([])
})
