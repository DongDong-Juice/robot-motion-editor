import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../store/store'
import { formatTimecode } from '../timeline/timeScale'
import { downloadBlob, pickDirectory, writeTextFiles } from '../fileio'
import { zip } from './zip'
import { exportItemCsv, itemFrameRange } from './csv'
import { needsRun, physicsWarnings } from './physicsWarn'
import { usePhysics } from '../physics/physicsStore'
import { runItems } from '../physics/runItem'
import { pieceName, projectTitle } from '../model/sequence'
import { seqFocus } from '../timeline/viewState'

export default function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const project = useEditor(s => s.project), defs = useEditor(s => s.defs), title = useEditor(s => projectTitle(s.fileName))
  const setFrame = useEditor(s => s.setFrame), select = useEditor(s => s.select), selectItem = useEditor(s => s.selectItem)
  const openItemPreview = useEditor(s => s.openItemPreview), setPreviewFrame = useEditor(s => s.setPreviewFrame)
  const [msg, setMsg] = useState('')
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null) // 다운로드 폴더: kept while the app runs, null = the browser's
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
    [...exportItemCsv(project, defs, actor.id, item.id).warnings, ...(skip ? [] : physicsWarnings(project, defs, item, phys[item.id]))]
      .map(w => ({ ...w, actorId: actor.id, actorName: actor.name, itemId: item.id }))) : [],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [project, defs, open, skip, phys])

  async function choose() {
    try { const d = await pickDirectory(); if (d) setDir(d) } catch (e) { setMsg(`폴더 선택 실패: ${e instanceof Error ? e.message : e}`) }
  }
  // one robot's items (G1 / GO2 내보내기) or one item (row 내보내기) into the 다운로드 폴더: label prefixes the message, zipName names the zip
  async function doExport(rs: typeof rows, zipName = 'motion_export.zip', label = '') {
    try {
      const taken = new Set<string>()
      const files = rs.map(({ actor, item }) => {
        const { name, text } = exportItemCsv(project, defs, actor.id, item.id, taken, title)
        return { name, text }
      })
      // No folder picked and several files: one zip download instead of a download per file.
      if (!dir && files.length > 1) {
        downloadBlob(zipName, new Blob([zip(files)], { type: 'application/zip' }))
        setMsg(`${label}CSV ${files.length}개를 zip으로 내보냈습니다.`)
      } else {
        await writeTextFiles(dir, files)
        setMsg(`${label}CSV ${files.length}개를 ${dir ? `${dir.name} 폴더에 ` : ''}내보냈습니다.`)
      }
    } catch (e) { setMsg(`내보내기 실패: ${e instanceof Error ? e.message : e}`) }
  }

  return (
    <dialog ref={ref} className="exp" onClose={onClose} aria-label="내보내기">
      <h2>내보내기</h2>
      <div className="exp-row exp-opts">
        {/* a browser gives the folder's name only, never its full path */}
        <span className="exp-dim exp-dir" title={dir ? dir.name : '브라우저의 기본 다운로드 폴더'}>다운로드 폴더: {dir ? dir.name : '브라우저 기본 다운로드 폴더'}</span>
        <button onClick={choose}>다운로드 폴더 선택</button>
        {dir && <button onClick={() => setDir(null)} title="브라우저 기본 다운로드 폴더로 되돌립니다">기본으로</button>}
      </div>
      <div className="exp-items">
        {groups.map(g => {
          const R = g.robot.toUpperCase()
          return <fieldset key={g.robot} role="group" aria-label={R} className="exp-box">
          <legend className="exp-group">{R}</legend>
          {/* on the box's top line at its far end, like the legend at its start */}
          <button className="exp-all" disabled={busy(g.rows)} onClick={() => doExport(g.rows, `${g.robot}_export.zip`, `${R} `)}
            title={`${R} 항목을 모두 내보냅니다`}>{R} 내보내기</button>
          <div className="exp-list">
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
          </div>
        </fieldset>})}
      </div>
      <div className="exp-row exp-sub-row">
        <h3 className="exp-sub">물리 검증 목록</h3>
        <label className="exp-check"><input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} /> 물리 검증 건너뛰기</label>
      </div>
      {!skip && rows.map(({ actor, item }) => ({ actor, item, st: phys[item.id] })).filter(r => r.st?.status === 'error').map(({ actor, item, st }) => (
        <div key={item.id} className="exp-dim">물리 검증 생략: {actor.name} · {project.clips[item.refId]?.name} ({st?.message})</div>
      ))}
      {warnings.length > 0 && (
        <ul className="exp-warn" aria-label="경고">
          {warnings.map((w, i) => (
            <li key={i}><button onClick={() => { // that piece: selected, its clip preview looping from the warning's frame (user)
              setFrame(w.frame); select(w.actorId, w.channel); selectItem(w.itemId); openItemPreview(w.itemId, true); setPreviewFrame(w.frame); seqFocus.fn?.(w.itemId); onClose() }}>
              {w.actorName} · {w.kind} · {w.frame} · {w.channel} · {w.message}
            </button></li>
          ))}
        </ul>
      )}
      <div className="exp-row exp-foot">
        {running && <span className="exp-dim">{loading ? '물리 엔진 불러오는 중…' : prog && `물리 검증 ${prog.done + 1}/${prog.total} · ${Math.round(prog.cur * 100)}%`}</span>}
        <p role="status" className="exp-dim exp-msg">{msg}</p>
        <button className="exp-close" onClick={onClose}>닫기</button>
      </div>
    </dialog>
  )
}
