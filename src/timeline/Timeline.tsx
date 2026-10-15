import { clipLocked, editingItem, getEditor, useEditor } from '../store/store'
import { useState } from 'react'
import { cutAtFrame, sequenceEnd } from '../transport'
import GraphCanvas from './GraphCanvas'
import { draggedAsset, dropAssetInClipView, isAssetDrag } from './assetDrop'
import SequenceCanvas from './SequenceCanvas'
import TrackCanvas from './TrackCanvas'
import { formatTimecode } from './timeScale'
import { usePhysics } from '../physics/physicsStore'
import { cancelAll } from '../physics/runItem'
import { PHYS_NOTE } from './physGraph'

// 자르기: type a sequence frame (starts at the playhead) and cut the piece there — same target rule as the C key.
function CutControl({ disabled }: { disabled: boolean }) {
  const [val, setVal] = useState<string | null>(null), [msg, setMsg] = useState('')
  const close = () => { setVal(null); setMsg('') }
  if (val === null) return (
    <button className="tl-cut" disabled={disabled} onClick={() => { setVal(String(getEditor().getState().frame)); setMsg('') }}
      title={disabled ? '시퀀스에서만 자를 수 있습니다' : '입력한 프레임에서 조각을 자릅니다 (C = 재생헤드에서 자르기)'}>자르기</button>
  )
  const cut = () => {
    const f = Number(val)
    if (!val.trim() || !Number.isInteger(f) || f < 0) { setMsg('0 이상의 정수 프레임을 입력하세요'); return }
    const why = cutAtFrame(getEditor(), f)
    if (why) setMsg(why); else close()
  }
  return (
    <form className="tl-cutform" role="group" aria-label="자르기" onSubmit={ev => { ev.preventDefault(); cut() }}>
      <input autoFocus aria-label="자를 프레임" inputMode="numeric" value={val} onChange={ev => { setVal(ev.target.value); setMsg('') }}
        onKeyDown={ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close() } }} onFocus={ev => ev.target.select()} />
      <button type="submit">자르기</button>
      <button type="button" aria-label="자르기 닫기" onClick={close}>✕</button>
      {msg && <span className="tl-cutmsg" role="status">{msg}</span>}
    </form>
  )
}

// Transport controls sit with the timeline they drive; the breadcrumb shows only in clip view.
function TimelineHeader() {
  const playing = useEditor(s => s.playing), frame = useEditor(s => s.frame)
  const end = useEditor(s => sequenceEnd(s.project))
  const autoKey = useEditor(s => s.autoKey), view = useEditor(s => s.view)
  const project = useEditor(s => s.project), editing = useEditor(s => s.editing)
  const st = getEditor().getState()
  const e = editing ? editingItem({ project, editing }) : null
  const actor = e && project.actors.find(a => a.id === e.actorId)
  const progress = usePhysics(s => s.progress), loading = usePhysics(s => s.loading)
  const anyDone = usePhysics(s => Object.values(s.byItem).some(v => v.status === 'done'))
  return (
    <div className="tl-head">
      <button className="tl-play" onClick={() => st.setPlaying(!playing)} aria-label={playing ? '정지' : '재생'} title="재생 / 정지 (Space)">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          {playing ? <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" /> : <path d="M3 1.2v9.6L10.6 6z" fill="currentColor" />}
        </svg>
      </button>
      <span className="tl-time"><b>{formatTimecode(frame)}</b><span className="tl-dim"> / {formatTimecode(end)}</span></span>
      <span className="tl-fps">60 fps</span>
      <span className="tl-sep" aria-hidden="true" />
      <button className="tl-auto" aria-pressed={autoKey} onClick={st.toggleAutoKey} title="켜면 원본 클립 수정에서 값을 바꿀 때 그 프레임에 키가 자동으로 들어갑니다"><i aria-hidden="true" />자동 키</button>
      <CutControl disabled={!!editing} />
      <span className="tl-seg" role="group" aria-label="클립 보기" title={editing ? '클립 보기 방식 (Tab)' : '클립을 열면 고를 수 있습니다'}>
        <button aria-pressed={view === 'tracks'} disabled={!editing} onClick={() => st.setView('tracks')}>트랙</button>
        <button aria-pressed={view === 'graph'} disabled={!editing} onClick={() => st.setView('graph')}>그래프</button>
      </span>
      {e && (
        <span className="tl-crumb">
          <button onClick={() => st.closeItem()}>시퀀스</button>
          <span> ▸ {actor?.name} / {e.clip.name}</span>
        </span>
      )}
      {(progress || loading) && (
        <span className="tl-phys" role="status">
          {loading ? '물리 엔진 불러오는 중…' : `물리 검증 ${progress!.done + 1}/${progress!.total} · ${Math.round(progress!.cur * 100)}%`}
          <button onClick={cancelAll}>취소</button>
        </span>
      )}
      {anyDone && !progress && !loading && <span className="tl-note" title="물리 검증 배지·그래프는 MuJoCo로 계산한 참고값입니다">ⓘ {PHYS_NOTE}</span>}
    </div>
  )
}

export default function Timeline() {
  const view = useEditor(s => s.view), editing = useEditor(s => s.editing)
  const project = useEditor(s => s.project)
  const e = editing ? editingItem({ project, editing }) : null
  return (
    <div className="tl-wrap">
      <TimelineHeader />
      {!editing ? <SequenceCanvas /> : (
        <div className="tl-body" onDragOver={ev => { if (isAssetDrag(ev.dataTransfer)) ev.preventDefault() }}
          onDrop={ev => { const a = draggedAsset(ev.dataTransfer); if (a) { ev.preventDefault(); dropAssetInClipView(a) } }}>
          {view === 'tracks' ? <TrackCanvas /> : <GraphCanvas />}
          {e && clipLocked(project, e.clip.id) && <div className="seq-msg" role="status" style={{ left: 164, top: 28 }}>잠긴 트랙입니다</div>}
        </div>
      )}
    </div>
  )
}
