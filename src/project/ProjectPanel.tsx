import { useEffect, useReducer, useRef, useState } from 'react'
import type { RobotKind } from '../robot/types'
import { csvToClip } from '../export/importCsv'
import { simplifyCurve, simplifyTolerance } from '../model/simplify'
import { objectUrl, openMediaFiles, openTextFiles, revokeUrl } from '../fileio'
import { mediaUrl, probeDuration, setMediaUrl, subscribeMedia } from '../media/registry'
import { getEditor, projectGeneration, useEditor } from '../store/store'

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
  const [fps, setFps] = useState<30 | 60>(30)
  const [simp, setSimp] = useState(true)
  useEffect(() => { if (result) { const t = setTimeout(() => setResult(null), 10000); return () => clearTimeout(t) } }, [result])
  useEffect(() => { if (pending && !dlg.current?.open) dlg.current?.showModal() }, [pending])
  const pick = async () => {
    setResult(null)
    const files = await openTextFiles('.csv', true)
    if (files.length) { setFps(30); setSimp(true); setPending(files) }
  }
  const doImport = () => {
    const files = pending!
    setPending(null)
    let n = 0
    const fails: string[] = []
    ed.getState().beginGesture() // one undo entry for the whole batch
    for (const f of files) {
      try {
        const clip = csvToClip(f.text, ed.getState().defs, fps, f.name.replace(/\.csv$/i, ''))
        if (simp) for (const ch of Object.keys(clip.channels)) clip.channels[ch] = simplifyCurve(clip.channels[ch], simplifyTolerance(ch, 0.001, 0.001))
        if (!ed.getState().importClipToActor(clip)) throw new Error('잠긴 트랙입니다')
        n++
      }
      catch (e) { fails.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`) }
    }
    ed.getState().endGesture()
    setResult({ n, fails })
  }

  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribeMedia(bump), []) // re-render when a url is (un)set
  const [mres, setMres] = useState<{ n?: number; lines: string[] } | null>(null)
  const [mmsg, setMmsg] = useState(0)
  const [lmsg, setLmsg] = useState(0)
  useEffect(() => { if (!lmsg) return; const t = setTimeout(() => setLmsg(0), 3000); return () => clearTimeout(t) }, [lmsg])
  useEffect(() => { if (mres) { const t = setTimeout(() => setMres(null), 10000); return () => clearTimeout(t) } }, [mres])
  useEffect(() => { if (!mmsg) return; const t = setTimeout(() => setMmsg(0), 3000); return () => clearTimeout(t) }, [mmsg])
  const probe = async (f: File) => {
    const url = objectUrl(f)
    try { return { url, durationF: await probeDuration(url) } } catch (e) { revokeUrl(url); throw e }
  }
  const importMedia = async () => {
    setMres(null)
    const files = await openMediaFiles(true)
    if (!files.length) return
    const gen = projectGeneration()
    const lines: string[] = []
    const ok: { name: string; url: string; durationF: number }[] = []
    for (const f of files) { // probe everything first so the gesture below has no awaits
      try { ok.push({ name: f.name.replace(/\.[^.]*$/, ''), ...(await probe(f)) }) }
      catch (e) { lines.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`) }
    }
    if (gen !== projectGeneration()) { ok.forEach(o => revokeUrl(o.url)); return } // another project was opened meanwhile
    const s = ed.getState()
    s.beginGesture() // one undo entry for the whole batch
    try { for (const o of ok) setMediaUrl(s.addMedia(o.name, o.durationF), o.url) }
    finally { s.endGesture() }
    setMres({ n: ok.length, lines })
  }
  const relink = async (m: { id: string; durationF: number }) => {
    setMres(null)
    const gen = projectGeneration()
    const [f] = await openMediaFiles(false)
    if (!f) return
    try {
      const { url, durationF } = await probe(f)
      if (gen !== projectGeneration() || !ed.getState().project.media.some(x => x.id === m.id)) { revokeUrl(url); return } // project changed or media deleted meanwhile
      setMediaUrl(m.id, url)
      if (Math.abs(durationF - m.durationF) > 1)
        setMres({ lines: [`길이가 다른 영상입니다(${(durationF / 60).toFixed(2)}초 ≠ ${(m.durationF / 60).toFixed(2)}초)`] })
    } catch (e) { setMres({ lines: [`${f.name}: ${e instanceof Error ? e.message : String(e)}`] }) }
  }
  const delMedia = (id: string) => { if (!ed.getState().deleteMedia(id)) setMmsg(performance.now()) }

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
                ? <RenameInput name={c.name} onDone={v => { if (v?.trim() && !ed.getState().setClip(c.id, { name: v })) setLmsg(performance.now()); setRenaming(null) }} />
                : <span className="pp-name">{c.name}</span>}
              <span className="pp-dim">{(c.length / 60).toFixed(2)}초 · {uses(c.id)}</span>
              <button aria-label={`${c.name} 삭제`} onClick={() => del(c.id)}>삭제</button>
            </div>
          ))}
        </div>
      ))}
      <h3>미디어</h3>
      {project.media.map(m => {
        const off = mediaUrl(m.id) == null
        return (
          <div key={m.id} className="pp-row pp-media" tabIndex={0} draggable
            onDragStart={e => { e.dataTransfer.setData('application/x-motion-media', m.id); e.dataTransfer.effectAllowed = 'copy' }}
            onKeyDown={e => { if (e.target === e.currentTarget && e.key === 'Delete') { e.stopPropagation(); delMedia(m.id) } }}>
            <span className="pp-name" title={m.name}>{m.name}</span>
            <span className="pp-sub">
              <span className="pp-dim">{(m.durationF / 60).toFixed(2)}초</span>
              {off && <span className="pp-off">오프라인</span>}
              {off && <button aria-label={`${m.name} 다시 연결`} onClick={() => relink(m)}>다시 연결</button>}
              <button aria-label={`${m.name} 삭제`} onClick={() => delMedia(m.id)}>삭제</button>
            </span>
          </div>
        )
      })}
      <div className="pp-btns">
        <button onClick={importMedia}>영상 가져오기</button>
      </div>
      <div className="pp-btns">
        {ROBOTS.map(([robot, label]) => <button key={robot} onClick={() => ed.getState().newClip(robot)}>새 {label} 클립</button>)}
        <button onClick={pick}>CSV 가져오기</button>
      </div>
      <dialog ref={dlg} className="pp-dlg" onKeyDown={e => e.stopPropagation()} onClose={() => setPending(null)}>
        <form method="dialog" onSubmit={e => { if ((e.nativeEvent as SubmitEvent).submitter?.id === 'pp-go') doImport() }}>
          <p>헤더 없는 CSV의 fps</p>
          {([30, 60] as const).map(v => (
            <label key={v}><input type="radio" name="fps" checked={fps === v} onChange={() => setFps(v)} />{v}fps</label>
          ))}
          <label><input type="checkbox" checked={simp} onChange={e => setSimp(e.target.checked)} />가져올 때 키 줄이기 (오차 0.001)</label>
          <div className="pp-btns"><button id="pp-go">가져오기</button><button value="cancel" type="submit" formNoValidate>취소</button></div>
        </form>
      </dialog>
      {result && (
        <div className="pp-msg" role="status">
          <p>클립 {result.n}개를 가져왔습니다</p>
          {result.fails.map(f => <p key={f}>{f}</p>)}
        </div>
      )}
      {mres && (
        <div className="pp-msg" role="status">
          {mres.n !== undefined && <p>영상 {mres.n}개를 가져왔습니다</p>}
          {mres.lines.map(f => <p key={f}>{f}</p>)}
        </div>
      )}
      {mmsg > 0 && <p className="pp-msg">시퀀스에서 쓰는 영상은 삭제할 수 없습니다</p>}
      {lmsg > 0 && <p className="pp-msg">잠긴 트랙입니다</p>}
      {msg > 0 && <p className="pp-msg">시퀀스에서 쓰는 클립은 삭제할 수 없습니다</p>}
    </div>
  )
}
