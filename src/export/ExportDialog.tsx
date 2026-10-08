import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../store/store'
import { formatTimecode } from '../timeline/timeScale'
import { pickDirectory, writeTextFiles } from '../fileio'
import { exportItemCsv, itemFrameRange, type RootMode } from './csv'

export default function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const project = useEditor(s => s.project), defs = useEditor(s => s.defs)
  const setFrame = useEditor(s => s.setFrame), select = useEditor(s => s.select)
  const [off, setOff] = useState<Set<string>>(new Set()) // unchecked item ids (default: all checked)
  const [mode, setMode] = useState<RootMode>('local')
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) { setMsg(''); d.showModal() }
    if (!open && d.open) d.close()
  }, [open])

  const rows = useMemo(() => project.sequence.tracks.flatMap(t => {
    const actor = project.actors.find(a => a.id === t.actorId)
    return actor && t.kind === 'motion' ? t.items.map(item => ({ actor, item })) : []
  }), [project])
  const checked = rows.filter(r => !off.has(r.item.id))

  const warnings = useMemo(() => open ? checked.flatMap(({ actor, item }) =>
    exportItemCsv(project, defs, actor.id, item.id, 'world').warnings
      .map(w => ({ ...w, actorId: actor.id, actorName: actor.name }))) : [],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [project, defs, off, open])

  async function choose() {
    try { const d = await pickDirectory(); if (d) setDir(d) } catch (e) { setMsg(`폴더 선택 실패: ${e instanceof Error ? e.message : e}`) }
  }
  async function doExport() {
    try {
      const taken = new Set<string>()
      const files = checked.map(({ actor, item }) => {
        const { name, text } = exportItemCsv(project, defs, actor.id, item.id, mode, taken)
        return { name, text }
      })
      await writeTextFiles(dir, files)
      setMsg(`CSV ${files.length}개를 내보냈습니다.`)
    } catch (e) { setMsg(`내보내기 실패: ${e instanceof Error ? e.message : e}`) }
  }

  return (
    <dialog ref={ref} className="exp" onClose={onClose} aria-label="내보내기">
      <h2>내보내기</h2>
      <fieldset>
        <legend>항목</legend>
        {rows.map(({ actor, item }) => {
          const { from, to } = itemFrameRange(item)
          return (
            <label key={item.id} className="exp-row">
              <input type="checkbox" checked={!off.has(item.id)} onChange={e => setOff(o => {
                const n = new Set(o); if (e.target.checked) n.delete(item.id); else n.add(item.id); return n
              })} />
              <span>{actor.name} · {project.clips[item.refId]?.name}</span>
              <span className="exp-dim">{formatTimecode(from)}–{formatTimecode(to)} · {to - from}프레임</span>
            </label>
          )
        })}
      </fieldset>
      <fieldset>
        <legend>루트</legend>
        <label><input type="radio" name="root" checked={mode === 'local'} onChange={() => setMode('local')} /> 로컬</label>
        <label><input type="radio" name="root" checked={mode === 'world'} onChange={() => setMode('world')} /> 월드</label>
      </fieldset>
      <div className="exp-row">
        <button onClick={choose}>폴더 선택</button>
        <span className="exp-dim">{dir ? dir.name : '다운로드 폴더'}</span>
      </div>
      {warnings.length > 0 && (
        <ul className="exp-warn" aria-label="경고">
          {warnings.map((w, i) => (
            <li key={i}><button onClick={() => { setFrame(w.frame); select(w.actorId, w.channel); onClose() }}>
              {w.actorName} · {w.kind} · {w.frame} · {w.channel} · {w.message}
            </button></li>
          ))}
        </ul>
      )}
      <div className="exp-row">
        <button onClick={doExport} disabled={!checked.length}>
          {warnings.length ? `경고 ${warnings.length}개 무시하고 내보내기` : 'CSV 내보내기'}
        </button>
        <button onClick={onClose}>닫기</button>
      </div>
      <p role="status" className="exp-dim">{msg}</p>
    </dialog>
  )
}
