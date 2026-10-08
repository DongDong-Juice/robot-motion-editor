import { useEffect, useReducer, useRef, useState } from 'react'
import { relinkMedia, setImportResult, useImportUi } from '../importActions'
import { mediaUrl, subscribeMedia } from '../media/registry'
import { getEditor, useEditor } from '../store/store'

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
  const project = useEditor(s => s.project)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [msg, setMsg] = useState(0) // timestamp of the last rejection; a new value restarts the 3 s timer
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(0), 3000); return () => clearTimeout(t) }, [msg])

  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribeMedia(bump), []) // re-render when a url is (un)set
  const res = useImportUi(s => s.res)
  useEffect(() => { if (res) { const t = setTimeout(() => setImportResult(null), 10000); return () => clearTimeout(t) } }, [res])
  const [mmsg, setMmsg] = useState(0)
  const [lmsg, setLmsg] = useState(0)
  useEffect(() => { if (!lmsg) return; const t = setTimeout(() => setLmsg(0), 3000); return () => clearTimeout(t) }, [lmsg])
  useEffect(() => { if (!mmsg) return; const t = setTimeout(() => setMmsg(0), 3000); return () => clearTimeout(t) }, [mmsg])
  const delMedia = (id: string) => { if (!ed.getState().deleteMedia(id)) setMmsg(performance.now()) }

  const uses = (id: string) => project.sequence.tracks.reduce((n, t) => n + t.items.filter(i => i.refId === id).length, 0)
  const del = (id: string) => { if (!ed.getState().deleteClip(id)) setMsg(performance.now()) }
  const clips = Object.values(project.clips)

  return (
    <div className="pp">
      <h2>에셋</h2>
      {!clips.length && !project.media.length && <p className="pp-dim">파일 ▸ CSV 가져오기로 모션을 불러오세요</p>}
      {clips.length > 0 && <h3>모션 (CSV)</h3>}
      {clips.map(c => (
        <div key={c.id} className="pp-row" tabIndex={0} draggable={renaming !== c.id}
          onDragStart={e => { e.dataTransfer.setData('application/x-motion-clip', c.id); e.dataTransfer.effectAllowed = 'copy' }}
          onDoubleClick={() => setRenaming(c.id)}
          onKeyDown={e => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter') { e.stopPropagation(); setRenaming(c.id) }
            else if (e.key === 'Delete') { e.stopPropagation(); del(c.id) }
          }}>
          <span className="pp-tag">{c.robot.toUpperCase()}</span>
          {renaming === c.id
            ? <RenameInput name={c.name} onDone={v => { if (v?.trim() && !ed.getState().setClip(c.id, { name: v })) setLmsg(performance.now()); setRenaming(null) }} />
            : <span className="pp-name">{c.name}</span>}
          <span className="pp-dim">{(c.length / 60).toFixed(2)}초 · {uses(c.id)}</span>
          <button aria-label={`${c.name} 삭제`} onClick={() => del(c.id)}>삭제</button>
        </div>
      ))}
      {project.media.length > 0 && <h3>영상</h3>}
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
              {off && <button aria-label={`${m.name} 다시 연결`} onClick={() => relinkMedia(m)}>다시 연결</button>}
              <button aria-label={`${m.name} 삭제`} onClick={() => delMedia(m.id)}>삭제</button>
            </span>
          </div>
        )
      })}
      {res && (
        <div className="pp-msg" role="status">
          {res.head && <p>{res.head}</p>}
          {res.lines.map(f => <p key={f}>{f}</p>)}
        </div>
      )}
      {mmsg > 0 && <p className="pp-msg">시퀀스에서 쓰는 영상은 삭제할 수 없습니다</p>}
      {lmsg > 0 && <p className="pp-msg">잠긴 트랙입니다</p>}
      {msg > 0 && <p className="pp-msg">시퀀스에서 쓰는 클립은 삭제할 수 없습니다</p>}
    </div>
  )
}
