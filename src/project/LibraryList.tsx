import { useEffect, useRef, useState } from 'react'
import Go2BlockPanel, { cachedTemplate, loadTemplate } from '../go2blocks/Go2BlockPanel'
import { GO2_BLOCKS } from '../go2blocks/blocks'
import { buildBlockClip } from '../go2blocks/build'
import { getEditor, useEditor } from '../store/store'
import { setDragged } from '../timeline/assetDrop'

const KIND = { fixed: '고정', meters: '거리', degrees: '각도', empty: '길이' } as const
export const filterBlocks = (query: string) => { const q = query.trim().toLowerCase(); return GO2_BLOCKS.filter(b => b.label.toLowerCase().includes(q)) }

/** 라이브러리 tab: the GO2 blocks (flat, filtered by name); the picked block's input below. Fixed blocks drag to the timeline once loaded. */
export default function LibraryList({ query }: { query: string }) {
  const [sel, setSel] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const treeRef = useRef<HTMLDivElement>(null)
  // 붙일 로봇: picked here (a GO2's track end / 'new' = a new GO2 / 'asset' = 목록에만 추가); by default the selected GO2, else the first
  const go2s = useEditor(s => s.project.actors).filter(a => a.robot === 'go2')
  const selGo2 = useEditor(s => s.sel.actorId)
  const [choice, setChoice] = useState<string | null>(null)
  const fallback = (go2s.find(a => a.id === selGo2) ?? go2s[0])?.id ?? 'new'
  const t = choice === 'new' || choice === 'asset' || go2s.some(a => a.id === choice) ? choice! : fallback // a vanished actor falls back
  const target = t === 'new' ? null : t
  useEffect(() => { for (const b of GO2_BLOCKS) if (b.kind === 'fixed') loadTemplate(b.id).catch(() => {}) }, []) // a drag fires no click, so load up front
  const rows = filterBlocks(query)
  const ids = rows.map(b => b.id)
  const tabStop = focus && ids.includes(focus) ? focus : ids[0]
  const pick = (id: string) => { setSel(id); setFocus(id); setMsg('') }

  const onKey = (e: React.KeyboardEvent, id: string) => {
    const d = ({ ArrowDown: 1, ArrowUp: -1 } as Record<string, number>)[e.key]
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation()
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
              const st = getEditor().getState(), clip = buildBlockClip(b, t.poses, t.fps, 0, st.defs)
              const have = Object.values(st.project.clips).find(c => c.robot === 'go2' && c.name === clip.name) // same block in 목록: reuse it
              e.dataTransfer.setData('application/x-motion-block', b.id)
              e.dataTransfer.effectAllowed = 'copy'
              setDragged(have ? { kind: 'clip', id: have.id } : { kind: 'clip', id: clip.id, clip })
            }}
            onDragEnd={() => setDragged(null)}>
            <span className="pp-name" title={b.label}>{b.label}</span>
            <span className="pp-col-kind">{KIND[b.kind === 'loop' ? b.param : b.kind]}</span>
          </div>
        ))}
      </div>
      {sel && <div className="pp-blk">
        <label className="pp-blk-field"><span>붙일 로봇</span>
          <select aria-label="붙일 로봇" value={t} onChange={e => { setChoice(e.target.value); setMsg('') }}>
            {go2s.map(a => <option key={a.id} value={a.id}>{a.name} (트랙 끝에 붙임)</option>)}
            <option value="new">새 GO2 로봇 (0초부터)</option>
            <option value="asset">목록에만 추가 (시퀀스에 놓지 않음)</option>
          </select>
        </label>
        <Go2BlockPanel key={sel} target={target} blockId={sel} onAdded={(actorId, name, reused) => {
          if (actorId) { setChoice(actorId); setMsg(reused ? `목록에 있는 ${name}을(를) 붙였습니다` : `추가했습니다: ${name}`) }
          else setMsg(reused ? `이미 목록에 있습니다: ${name} (새로 만들지 않음)` : `목록에 추가했습니다: ${name}`)
        }} />
        {msg && <p className="pp-msg" aria-live="polite">{msg}</p>}
      </div>}
    </>
  )
}
