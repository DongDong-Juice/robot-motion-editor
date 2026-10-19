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

  useEffect(() => {
    if (!open || skip) return
    const todo = rows.filter(({ actor, item }) => needsRun(project, defs, actor.id, item.id, phys[item.id]))
    if (todo.length) void runItems(todo.map(({ actor, item }) => ({ actorId: actor.id, itemId: item.id })))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, defs, open, skip, phys])
  const busy = (rs: typeof rows) => open && !skip && rs.some(({ item }) => ['queued', 'running'].includes(phys[item.id]?.status))
  const running = busy(rows)

  const warnings = useMemo(() => open ? rows.flatMap(({ actor, item }) =>
    [...exportItemCsv(project, defs, actor.id, item.id, 'world').warnings, ...(skip ? [] : physicsWarnings(project, defs, item, phys[item.id]))]
      .map(w => ({ ...w, actorId: actor.id, actorName: actor.name }))) : [],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [project, defs, open, skip, phys])

  async function choose() {
    try { const d = await pickDirectory(); if (d) setDir(d) } catch (e) { setMsg(`폴더 선택 실패: ${e instanceof Error ? e.message : e}`) }
  }
  // every item, or one robot's (G1 / GO2 내보내기) / one item (row 내보내기): label prefixes the message, zipName names the zip
  async function doExport(rs = rows, zipName = 'motion_export.zip', label = '') {
    try {
      const taken = new Set<string>()
      const files = rs.map(({ actor, item }) => {
        const { name, text } = exportItemCsv(project, defs, actor.id, item.id, mode, taken, title)
        return { name, text }
      })
      // No folder picked and several files: one zip download instead of a download per file.
      if (!dir && files.length > 1) {
        downloadBlob(zipName, new Blob([zip(files)], { type: 'application/zip' }))
        setMsg(`${label}CSV ${files.length}개를 zip으로 내보냈습니다.`)
      } else {
        await writeTextFiles(dir, files)
        setMsg(`${label}CSV ${files.length}개를 내보냈습니다.`)
      }
    } catch (e) { setMsg(`내보내기 실패: ${e instanceof Error ? e.message : e}`) }
  }

  return (
    <dialog ref={ref} className="exp" onClose={onClose} aria-label="내보내기">
      <h2>내보내기</h2>
      <fieldset className="exp-items">
        <legend>항목</legend>
        {groups.map(g => {
          const R = g.robot.toUpperCase()
          return <div key={g.robot} role="group" aria-label={R}>
          <div className="exp-group">{R}
            <button disabled={busy(g.rows)} onClick={() => doExport(g.rows, `${g.robot}_export.zip`, `${R} `)}
              title={`${R} 항목을 모두 내보냅니다`}>{R} 내보내기</button>
          </div>
          {g.rows.map(r => {
          const { actor, item, t } = r, { from, to } = itemFrameRange(item)
          return (
            <div key={item.id} className="exp-row exp-item">
              <span>{actor.name} · {pieceName(t, item, project.clips[item.refId], title)}</span>
              <span className="exp-dim">{formatTimecode(from)}–{formatTimecode(to)} · {to - from}프레임</span>
              <button className="exp-one" disabled={busy([r])} onClick={() => doExport([r])} title="이 항목만 내보냅니다">내보내기</button>
            </div>
          )
        })}
        </div>})}
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
      {!skip && rows.map(({ actor, item }) => ({ actor, item, st: phys[item.id] })).filter(r => r.st?.status === 'error').map(({ actor, item, st }) => (
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
        <button onClick={() => doExport()} disabled={!rows.length || running}>
          {running ? '물리 검증 중…' : warnings.length ? `경고 ${warnings.length}개 무시하고 내보내기` : 'CSV 내보내기'}
        </button>
        {running && <span className="exp-dim">{loading ? '물리 엔진 불러오는 중…' : prog && `물리 검증 ${prog.done + 1}/${prog.total} · ${Math.round(prog.cur * 100)}%`}</span>}
        <button onClick={onClose}>닫기</button>
      </div>
      <p role="status" className="exp-dim">{msg}</p>
    </dialog>
  )
}
