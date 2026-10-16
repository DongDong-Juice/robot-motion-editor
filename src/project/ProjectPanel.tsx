import { useEffect, useReducer, useRef, useState } from 'react'
import { relinkMedia, setImportResult, useImportUi, importDroppedFiles } from '../importActions'
import { mediaUrl, subscribeMedia } from '../media/registry'
import { getEditor, useEditor } from '../store/store'
import { curveKeyCount } from '../model/itemClip'
import { videoTrack } from '../model/video'
import { setDragged } from '../timeline/assetDrop'

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

type Menu = { kind: 'clip' | 'media'; id: string; x: number; y: number; card: HTMLElement }

// Right-click menu of a card: focus moves in on open, back to the card on Esc; an outside click closes it.
function CardMenu({ menu, items, close }: { menu: Menu; items: [string, () => void][]; close: (refocus: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [menu])
  const onKey = (e: React.KeyboardEvent) => {
    const list = [...ref.current!.querySelectorAll<HTMLElement>('[role=menuitem]')], i = list.indexOf(document.activeElement as HTMLElement)
    const d = ({ ArrowDown: 1, ArrowUp: -1 } as Record<string, number>)[e.key]
    if (d) { e.preventDefault(); list[(i + d + list.length) % list.length]?.focus() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
    else if (e.key === 'Tab') close(true)
  }
  return (
    <div ref={ref} role="menu" aria-label="목록" className="tl-menu" style={{ left: menu.x, top: menu.y }} onKeyDown={onKey}>
      {items.map(([label, run]) => <button key={label} role="menuitem" tabIndex={-1} onClick={() => { close(false); run() }}>{label}</button>)}
    </div>
  )
}

// How the reference video on V1 is shown (viewer preference, not saved): over the robot view or split beside it, with opacity.
function VideoView() {
  const st = getEditor().getState(), mode = useEditor(s => s.videoMode), opacity = useEditor(s => s.videoOpacity)
  if (!useEditor(s => !!videoTrack(s.project)?.items.length)) return null
  return (
    <div role="group" aria-label="영상" className="pp-video">
      <span className="pp-meta">보기</span>
      {([['overlay', '오버레이'], ['split', '분할']] as const).map(([m, label]) =>
        <button key={m} aria-pressed={mode === m} onClick={() => st.setVideoMode(m)}>{label}</button>)}
      {mode === 'overlay' && <input type="range" aria-label="영상 투명도" title="영상 투명도" min={0} max={1} step={0.05} value={opacity} onChange={e => st.setVideoOpacity(+e.target.value)} />}
    </div>
  )
}

export default function ProjectPanel() {
  const ed = getEditor()
  const project = useEditor(s => s.project), clipEdit = useEditor(s => s.clipEdit)
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

  const [menu, setMenu] = useState<Menu | null>(null)
  const closeMenu = (refocus: boolean) => { if (refocus) menu?.card.focus(); setMenu(null) }
  const menuProps = (kind: Menu['kind'], id: string) => ({
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => { e.preventDefault(); setMenu({ kind, id, x: e.clientX, y: e.clientY, card: e.currentTarget }) },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault(); e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        setMenu({ kind, id, x: r.left + 8, y: r.top + 24, card: e.currentTarget })
      } else if (e.key === 'Delete') { e.stopPropagation(); if (kind === 'clip') del(id); else delMedia(id) }
      else if (e.key === 'Enter' && kind === 'clip') { e.stopPropagation(); setRenaming(id) }
    },
  })
  const sec = (f: number) => `${(f / 60).toFixed(2)}초`
  // CSV files dragged in from the desktop: highlight the panel and import on drop (asset cards dragged out are not files)
  const [over, setOver] = useState(false)
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
  const fileDrop = {
    onDragEnter: (e: React.DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setOver(true) } },
    onDragOver: (e: React.DragEvent) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true) } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false) },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault(); setOver(false)
      void importDroppedFiles(Array.from(e.dataTransfer.files))
    },
  }

  return (
    <div className={over ? 'pp drop' : 'pp'} {...fileDrop}>
      {over && <div className="pp-drop" aria-hidden="true">CSV를 놓으면 가져옵니다</div>}
      <h2>목록</h2>
      {!clips.length && !project.media.length && <p className="pp-dim">메뉴 ▸ CSV 가져오기 또는 CSV 파일을 여기로 끌어다 놓으세요</p>}
      {clips.length > 0 && <h3>모션 (CSV)</h3>}
      {clips.map(c => (
        <div key={c.id} className={clipEdit === c.id ? "pp-card editing" : "pp-card"} tabIndex={0} draggable={renaming !== c.id}
          onDragStart={e => { e.dataTransfer.setData('application/x-motion-clip', c.id); e.dataTransfer.effectAllowed = 'copy'; setDragged({ kind: 'clip', id: c.id }) }}
          onDragEnd={() => setDragged(null)}
          onDoubleClick={() => { if (renaming !== c.id) ed.getState().openClipEdit(c.id) }} {...menuProps('clip', c.id)}>
          <div className="pp-head">
            {renaming === c.id
              ? <RenameInput name={c.name} onDone={v => { if (v?.trim() && !ed.getState().setClip(c.id, { name: v })) setLmsg(performance.now()); setRenaming(null) }} />
              : <span className="pp-name" title={curveKeyCount(c.offset) ? `${c.name}
수정됨 · 수정 키 ${curveKeyCount(c.offset)}개` : `${c.name}
이름을 더블클릭하면 이름 변경`}
                  onDoubleClick={e => { e.stopPropagation(); setRenaming(c.id) }}>
                  {curveKeyCount(c.offset) > 0 && <span className="pp-mod" aria-label="수정됨">● </span>}{c.name}</span>}
            <span className="pp-tag">{c.robot.toUpperCase()}</span>
          </div>
          <div className="pp-box">
            <div className="pp-meta">{sec(c.length)} · {c.length} 프레임 · 사용 {uses(c.id)}</div>
            <button title="이 모션을 비교 프리뷰에 나란히 재생 (타임라인에는 추가하지 않음)" onClick={() => ed.getState().openComparePane(c.id)}>⇄ 비교</button>
          </div>
        </div>
      ))}
      {project.media.length > 0 && <h3>영상</h3>}
      <VideoView />
      {project.media.map(m => {
        const off = mediaUrl(m.id) == null
        return (
          <div key={m.id} className="pp-card pp-media" tabIndex={0} draggable
            onDragStart={e => { e.dataTransfer.setData('application/x-motion-media', m.id); e.dataTransfer.effectAllowed = 'copy'; setDragged({ kind: 'media', id: m.id }) }}
            onDragEnd={() => setDragged(null)}
            {...menuProps('media', m.id)}>
            <div className="pp-head"><span className="pp-name" title={m.name}>{m.name}</span></div>
            <div className="pp-box">
              <div className="pp-meta">{sec(m.durationF)}{off && <> · <span className="pp-off">오프라인</span></>}</div>
              {off && <button aria-label={`${m.name} 다시 연결`} onClick={() => relinkMedia(m)}>다시 연결</button>}
            </div>
          </div>
        )
      })}
      {menu && <CardMenu menu={menu} close={closeMenu} items={menu.kind === 'clip'
        ? [['클립 편집', () => ed.getState().openClipEdit(menu.id)], ['이름 변경', () => setRenaming(menu.id)], ['삭제', () => del(menu.id)]]
        : [['삭제', () => delMedia(menu.id)]]} />}
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
