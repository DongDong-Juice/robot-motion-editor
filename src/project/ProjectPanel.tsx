import { useEffect, useRef, useState } from 'react'
import type { RobotKind } from '../robot/types'
import { csvToClip } from '../export/importCsv'
import { openTextFiles } from '../fileio'
import { getEditor, useEditor } from '../store/store'

type Files = { name: string; text: string }[]
const ROBOTS: [RobotKind, string][] = [['g1', 'G1'], ['go2', 'GO2']]

function RenameInput({ name, onDone }: { name: string; onDone: (v: string | null) => void }) {
  const cancelled = useRef(false)
  return (
    <input autoFocus defaultValue={name} aria-label="클립 이름 변경"
      onFocus={e => e.currentTarget.select()}
      onBlur={e => onDone(cancelled.current ? null : e.currentTarget.value)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur() }
      }} />
  )
}

export default function ProjectPanel() {
  const ed = getEditor()
  const project = useEditor(s => s.project), sel = useEditor(s => s.sel.actorId)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [msg, setMsg] = useState(0) // timestamp of the last rejection; a new value restarts the 3 s timer
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(0), 3000); return () => clearTimeout(t) }, [msg])

  const [pending, setPending] = useState<Files | null>(null) // picked files awaiting an fps choice
  const [result, setResult] = useState<{ n: number; fails: string[] } | null>(null)
  const dlg = useRef<HTMLDialogElement>(null)
  const fps = useRef<30 | 60>(30)
  useEffect(() => { if (result) { const t = setTimeout(() => setResult(null), 10000); return () => clearTimeout(t) } }, [result])
  useEffect(() => { if (pending && !dlg.current?.open) dlg.current?.showModal() }, [pending])
  const pick = async () => {
    setResult(null)
    const files = await openTextFiles('.csv', true)
    if (files.length) { fps.current = 30; setPending(files) }
  }
  const doImport = () => {
    const files = pending!
    setPending(null)
    let n = 0
    const fails: string[] = []
    for (const f of files) {
      try { ed.getState().importClip(csvToClip(f.text, ed.getState().defs, fps.current, f.name.replace(/\.csv$/i, ''))); n++ }
      catch (e) { fails.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`) }
    }
    setResult({ n, fails })
  }

  const uses = (id: string) => project.sequence.tracks.reduce((n, t) => n + t.items.filter(i => i.refId === id).length, 0)
  const del = (id: string) => { if (!ed.getState().deleteClip(id)) setMsg(performance.now()) }

  return (
    <div className="pp">
      <h3>액터</h3>
      {project.actors.map(a => (
        <div key={a.id} className="pp-row" tabIndex={0} onClick={() => ed.getState().select(a.id)}
          role="option" aria-selected={sel === a.id} onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); ed.getState().select(a.id) } }}>
          <span className="pp-dot" style={{ background: a.color }} />
          <span className="pp-name">{a.name}</span>
        </div>
      ))}
      <h3>클립</h3>
      {ROBOTS.map(([robot, label]) => (
        <div key={robot}>
          <h3>{label}</h3>
          {Object.values(project.clips).filter(c => c.robot === robot).map(c => (
            <div key={c.id} className="pp-row" tabIndex={0} draggable={renaming !== c.id}
              onDragStart={e => { e.dataTransfer.setData('application/x-motion-clip', c.id); e.dataTransfer.effectAllowed = 'copy' }}
              onDoubleClick={() => setRenaming(c.id)}
              onKeyDown={e => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter') { e.stopPropagation(); setRenaming(c.id) }
                else if (e.key === 'Delete') { e.stopPropagation(); del(c.id) }
              }}>
              {renaming === c.id
                ? <RenameInput name={c.name} onDone={v => { if (v?.trim()) ed.getState().setClip(c.id, { name: v }); setRenaming(null) }} />
                : <span className="pp-name">{c.name}</span>}
              <span className="pp-dim">{(c.length / 60).toFixed(2)}초 · {uses(c.id)}</span>
              <button aria-label={`${c.name} 삭제`} onClick={() => del(c.id)}>삭제</button>
            </div>
          ))}
        </div>
      ))}
      <div className="pp-btns">
        {ROBOTS.map(([robot, label]) => <button key={robot} onClick={() => ed.getState().newClip(robot)}>새 {label} 클립</button>)}
        <button onClick={pick}>CSV 가져오기</button>
      </div>
      <dialog ref={dlg} className="pp-dlg" onKeyDown={e => e.stopPropagation()} onClose={() => setPending(null)}>
        <form method="dialog" onSubmit={e => { if ((e.nativeEvent as SubmitEvent).submitter?.id === 'pp-go') doImport() }}>
          <p>원본 프레임레이트</p>
          {([30, 60] as const).map(v => (
            <label key={v}><input type="radio" name="fps" defaultChecked={v === 30} onChange={() => { fps.current = v }} />{v}fps</label>
          ))}
          <div className="pp-btns"><button id="pp-go">가져오기</button><button value="cancel" type="submit" formNoValidate>취소</button></div>
        </form>
      </dialog>
      {result && (
        <div className="pp-msg" role="status">
          <p>클립 {result.n}개를 가져왔습니다</p>
          {result.fails.map(f => <p key={f}>{f}</p>)}
        </div>
      )}
      {msg > 0 && <p className="pp-msg">시퀀스에서 쓰는 클립은 삭제할 수 없습니다</p>}
    </div>
  )
}
