import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../store/store'
import { formatTimecode } from '../timeline/timeScale'
import { downloadBlob, pickDirectory, writeTextFiles } from '../fileio'
import { zip } from './zip'
import { exportItemCsv, itemFrameRange, type RootMode } from './csv'
import { needsRun, physicsWarnings } from './physicsWarn'
import { usePhysics } from '../physics/physicsStore'
import { runItems } from '../physics/runItem'
import { pieceName, projectTitle } from '../model/sequence'

export default function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const project = useEditor(s => s.project), defs = useEditor(s => s.defs), title = useEditor(s => projectTitle(s.fileName))
  const setFrame = useEditor(s => s.setFrame), select = useEditor(s => s.select)
  const [off, setOff] = useState<Set<string>>(new Set()) // unchecked item ids (default: all checked)
  const [mode, setMode] = useState<RootMode>('local')
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null)
  const [msg, setMsg] = useState('')
  const [skip, setSkip] = useState(false) // 물리 검증 건너뛰기 (dialog state only)
  const phys = usePhysics(s => s.byItem), prog = usePhysics(s => s.progress), loading = usePhysics(s => s.loading)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) { setMsg(''); d.showModal() }
    if (!open && d.open) d.close()
  }, [open])

  const rows = useMemo(() => project.sequence.tracks.flatMap(t => {
    const actor = project.actors.find(a => a.id === t.actorId)
    return actor && t.kind === 'motion' ? t.items.map(item => ({ actor, item, t })) : []
  }), [project])
  const groups = (['g1', 'go2'] as const).map(robot => ({ robot, rows: rows.filter(r => r.actor.robot === robot) })).filter(g => g.rows.length)
  const checked = rows.filter(r => !off.has(r.item.id))

  useEffect(() => {
    if (!open || skip) return
    const todo = checked.filter(({ actor, item }) => needsRun(project, defs, actor.id, item.id, phys[item.id]))
    if (todo.length) void runItems(todo.map(({ actor, item }) => ({ actorId: actor.id, itemId: item.id })))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, defs, off, open, skip, phys])
  const running = open && !skip && checked.some(({ item }) => ['queued', 'running'].includes(phys[item.id]?.status))

  const warnings = useMemo(() => open ? checked.flatMap(({ actor, item }) =>
    [...exportItemCsv(project, defs, actor.id, item.id, 'world').warnings, ...(skip ? [] : physicsWarnings(project, defs, item, phys[item.id]))]
      .map(w => ({ ...w, actorId: actor.id, actorName: actor.name }))) : [],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [project, defs, off, open, skip, phys])

  async function choose() {
    try { const d = await pickDirectory(); if (d) setDir(d) } catch (e) { setMsg(`폴더 선택 실패: ${e instanceof Error ? e.message : e}`) }
  }
  async function doExport() {
    try {
      const taken = new Set<string>()
      const files = checked.map(({ actor, item }) => {
        const { name, text } = exportItemCsv(project, defs, actor.id, item.id, mode, taken, title)
        return { name, text }
      })
      // No folder picked and several files: one zip download instead of a download per file.
      if (!dir && files.length > 1) {
        downloadBlob('motion_export.zip', new Blob([zip(files)], { type: 'application/zip' }))
        setMsg(`CSV ${files.length}개를 zip으로 내보냈습니다.`)
      } else {
        await writeTextFiles(dir, files)
        setMsg(`CSV ${files.length}개를 내보냈습니다.`)
      }
    } catch (e) { setMsg(`내보내기 실패: ${e instanceof Error ? e.message : e}`) }
  }

  return (
    <dialog ref={ref} className="exp" onClose={onClose} aria-label="내보내기">
      <h2>내보내기</h2>
      <fieldset>
        <legend>항목</legend>
        {groups.map(g => <div key={g.robot} role="group" aria-label={g.robot.toUpperCase()}>
          <div className="exp-group">{g.robot.toUpperCase()}</div>
          {g.rows.map(({ actor, item, t }) => {
          const { from, to } = itemFrameRange(item)
          return (
            <label key={item.id} className="exp-row">
              <input type="checkbox" checked={!off.has(item.id)} onChange={e => setOff(o => {
                const n = new Set(o); if (e.target.checked) n.delete(item.id); else n.add(item.id); return n
              })} />
              <span>{actor.name} · {pieceName(t, item, project.clips[item.refId], title)}</span>
              <span className="exp-dim">{formatTimecode(from)}–{formatTimecode(to)} · {to - from}프레임</span>
            </label>
          )
        })}
        </div>)}
      </fieldset>
      <fieldset>
        <legend>루트</legend>
        <label><input type="radio" name="root" checked={mode === 'local'} onChange={() => setMode('local')} /> 로컬</label>
        <label><input type="radio" name="root" checked={mode === 'world'} onChange={() => setMode('world')} /> 월드</label>
      </fieldset>
      <label className="exp-row"><input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} /> 물리 검증 건너뛰기</label>
      <div className="exp-row">
        <button onClick={choose}>폴더 선택</button>
        <span className="exp-dim">{dir ? dir.name : '다운로드 폴더'}</span>
      </div>
      {!skip && checked.map(({ actor, item }) => ({ actor, item, st: phys[item.id] })).filter(r => r.st?.status === 'error').map(({ actor, item, st }) => (
        <div key={item.id} className="exp-dim">물리 검증 생략: {actor.name} · {project.clips[item.refId]?.name} ({st?.message})</div>
      ))}
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
        <button onClick={doExport} disabled={!checked.length || running}>
          {running ? '물리 검증 중…' : warnings.length ? `경고 ${warnings.length}개 무시하고 내보내기` : 'CSV 내보내기'}
        </button>
        {running && <span className="exp-dim">{loading ? '물리 엔진 불러오는 중…' : prog && `물리 검증 ${prog.done + 1}/${prog.total} · ${Math.round(prog.cur * 100)}%`}</span>}
        <button onClick={onClose}>닫기</button>
      </div>
      <p role="status" className="exp-dim">{msg}</p>
    </dialog>
  )
}
