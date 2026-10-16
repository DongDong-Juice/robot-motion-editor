import { useEffect, useState } from 'react'
import { parseCsvPoses } from '../export/importCsv'
import type { Pose } from '../model/pose'
import { getEditor, trackLocked, useEditor } from '../store/store'
import { blockUrl, GO2_BLOCKS } from './blocks'
import { blockActual, buildBlockClip } from './build'

type Template = { fps: number; poses: Pose[] }
// One fetch per block; a failed load is dropped so picking the block again retries.
const cache = new Map<string, Promise<Template>>()
const loaded = new Map<string, Template>()
/** The template if it has already loaded (a library row dragged to the timeline needs it synchronously). */
export const cachedTemplate = (id: string) => loaded.get(id)
export function loadTemplate(id: string): Promise<Template> {
  let p = cache.get(id)
  if (!p) {
    p = fetch(blockUrl(id))
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text() })
      .then(text => parseCsvPoses(text, getEditor().getState().defs, undefined))
    p.then(t => loaded.set(id, t), () => cache.delete(id))
    cache.set(id, p)
  }
  return p
}

const DEFAULT = { meters: 1.0, degrees: 90 }

// The 라이브러리 tab's input for the picked block. actorId null = a new GO2 actor on 추가; onAdded gets the clip name.
export default function Go2BlockPanel({ actorId, blockId, onAdded }: { actorId: string | null; blockId: string; onAdded?: (name: string) => void }) {
  const locked = useEditor(s => !!actorId && trackLocked(s.project, actorId))
  const target = useEditor(s => s.project.actors.find(a => a.id === actorId)?.name)
  const block = GO2_BLOCKS.find(b => b.id === blockId)!
  const [value, setValue] = useState(block.kind === 'loop' ? String(DEFAULT[block.param]) : '')
  const [tpl, setTpl] = useState<{ id: string; t?: Template; err?: string } | null>(null)

  useEffect(() => {
    let live = true
    setTpl(null)
    loadTemplate(blockId).then(t => live && setTpl({ id: blockId, t }), (e: Error) => live && setTpl({ id: blockId, err: e.message }))
    return () => { live = false }
  }, [blockId])

  const t = tpl?.id === blockId ? tpl.t : undefined
  const v = block.kind === 'loop' ? (value.trim() === '' ? NaN : Number(value)) : 0
  const valid = Number.isFinite(v) && (block.kind !== 'loop' || block.param !== 'meters' || v >= 0.1)
  const actual = t && valid ? blockActual(block, t.poses, v) : null
  const unit = block.kind === 'loop' && block.param === 'meters' ? 'm' : '°'

  const add = () => {
    if (!t || !valid) return
    const st = getEditor().getState(), clip = buildBlockClip(block, t.poses, t.fps, v, st.defs)
    const itemId = st.appendClip(actorId, clip)
    const p = getEditor().getState().project, track = itemId ? p.sequence.tracks.find(tr => tr.items.some(i => i.id === itemId)) : null
    if (itemId && track?.actorId) onAdded?.(p.clips[clip.id]?.name ?? clip.name)
  }

  return (
    <>
      <h3 className="pp-blk-t">{block.label}</h3>
      {block.kind === 'loop' && (
        <label className="pp-blk-field"><span>{block.param === 'meters' ? '거리' : '각도'}{block.param === 'degrees' && <span className="pp-dim"> · 음수 = 우회전</span>}</span>
          <span className="ps-unit">
            <input type="number" aria-label="값" value={value}
              step={block.param === 'meters' ? 0.1 : 1} min={block.param === 'meters' ? 0.1 : undefined}
              onChange={e => setValue(e.target.value)} /><i>{unit}</i>
          </span>
        </label>
      )}
      {actual && <p className="pp-dim" role="status">→ 실제 {+actual.actual.toFixed(unit === 'm' ? 2 : 0)}{unit} ({actual.n}회)</p>}
      {tpl?.id === blockId && tpl.err && <p className="pp-msg" role="alert" style={{ color: 'var(--warn)' }}>템플릿을 불러오지 못했습니다: {tpl.err}</p>}
      <div className="pp-tools">
        <span className="pp-dim pp-name">대상: {target ?? '새 GO2 로봇'}</span>
        <button disabled={!t || !valid || locked} onClick={add}>추가</button>
      </div>
    </>
  )
}
