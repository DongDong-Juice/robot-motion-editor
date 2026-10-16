import type { Bin } from '../model/types'

export interface TreeItem { id: string; name: string; bin?: string }
export type Row = { kind: 'bin'; bin: Bin; open: boolean; depth: 0 } | { kind: 'item'; id: string; depth: 0 | 1 }

export function filterTree(items: TreeItem[], bins: Bin[], query: string, open: ReadonlySet<string>): { rows: Row[]; count: number } {
  const q = query.trim().toLowerCase()
  const shown = items.filter(it => !q || it.name.toLowerCase().includes(q))
  const rows: Row[] = []
  for (const bin of bins) {
    const kids = shown.filter(it => it.bin === bin.id)
    if (q && kids.length === 0) continue
    const isOpen = q ? true : open.has(bin.id)
    rows.push({ kind: 'bin', bin, open: isOpen, depth: 0 })
    if (isOpen) for (const it of kids) rows.push({ kind: 'item', id: it.id, depth: 1 })
  }
  for (const it of shown) if (!it.bin) rows.push({ kind: 'item', id: it.id, depth: 0 })
  return { rows, count: shown.length }
}
