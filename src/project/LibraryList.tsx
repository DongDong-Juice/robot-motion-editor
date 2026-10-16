import { useRef, useState } from 'react'
import Go2BlockPanel, { cachedTemplate } from '../go2blocks/Go2BlockPanel'
import { GO2_BLOCKS } from '../go2blocks/blocks'
import { buildBlockClip } from '../go2blocks/build'
import { getEditor, useEditor } from '../store/store'
import { setDragged } from '../timeline/assetDrop'

const KIND = { fixed: '고정', meters: '거리', degrees: '각도' } as const
export const filterBlocks = (query: string) => { const q = query.trim().toLowerCase(); return GO2_BLOCKS.filter(b => b.label.toLowerCase().includes(q)) }

/** 라이브러리 tab: the GO2 blocks (flat, filtered by name); the picked block's input below. Fixed blocks drag to the timeline once loaded. */
export default function LibraryList({ query }: { query: string }) {
  const [sel, setSel] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const treeRef = useRef<HTMLDivElement>(null)
  // 대상: the selected actor if it is a GO2, else the first GO2, else null (a new GO2 on 추가)
  const target = useEditor(s => {
    const go2 = s.project.actors.filter(a => a.robot === 'go2')
    return (go2.find(a => a.id === s.sel.actorId) ?? go2[0])?.id ?? null
  })
  const rows = filterBlocks(query)
  const ids = rows.map(b => b.id)
  const tabStop = focus && ids.includes(focus) ? focus : ids[0]
  const pick = (id: string) => { setSel(id); setFocus(id); setMsg('') }

  const onKey = (e: React.KeyboardEvent, id: string) => {
    const d = ({ ArrowDown: 1, ArrowUp: -1 } as Record<string, number>)[e.key]
    const n = d && ids[ids.indexOf(id) + d]
    if (!n) return
    e.preventDefault(); e.stopPropagation()
    pick(n); treeRef.current?.querySelector<HTMLElement>(`[data-id="${n}"]`)?.focus()
  }

  return (
    <>
      <div className="pp-cols" aria-hidden="true"><span>이름</span><span className="pp-col-kind">종류</span></div>
      <div ref={treeRef} role="tree" aria-label="라이브러리" className="pp-tree">
        {rows.map(b => (
          <div key={b.id} role="treeitem" className="pp-row" data-kind="block" data-id={b.id} aria-selected={sel === b.id}
            tabIndex={b.id === tabStop ? 0 : -1} onClick={() => pick(b.id)} onKeyDown={e => onKey(e, b.id)}
            draggable={b.kind === 'fixed'}
            onDragStart={e => {
              const t = cachedTemplate(b.id)
              if (!t) { e.preventDefault(); return } // not loaded yet: picking the row loads it
              const clip = buildBlockClip(b, t.poses, t.fps, 0, getEditor().getState().defs)
              e.dataTransfer.setData('application/x-motion-block', b.id)
              e.dataTransfer.effectAllowed = 'copy'
              setDragged({ kind: 'clip', id: clip.id, clip })
            }}
            onDragEnd={() => setDragged(null)}>
            <span className="pp-name" title={b.label}>{b.label}</span>
            <span className="pp-col-kind">{KIND[b.kind === 'fixed' ? 'fixed' : b.param]}</span>
          </div>
        ))}
      </div>
      {sel && <div className="pp-blk">
        <Go2BlockPanel key={sel} actorId={target} blockId={sel} onAdded={(_, name) => setMsg(`추가했습니다: ${name}`)} />
        {msg && <p className="pp-msg" aria-live="polite">{msg}</p>}
      </div>}
    </>
  )
}
