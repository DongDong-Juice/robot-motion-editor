import { clipLocked, editingItem, getEditor, useEditor } from '../store/store'
import { sequenceEnd } from '../transport'
import GraphCanvas from './GraphCanvas'
import { draggedAsset, dropAssetInClipView, isAssetDrag } from './assetDrop'
import SequenceCanvas from './SequenceCanvas'
import TrackCanvas from './TrackCanvas'
import { formatTimecode } from './timeScale'
import { usePhysics } from '../physics/physicsStore'
import { cancelAll } from '../physics/runItem'
import { PHYS_NOTE } from './physGraph'

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
      <button onClick={() => st.setPlaying(!playing)} aria-label={playing ? '정지' : '재생'}>{playing ? '■' : '▶'}</button>
      <span className="mb-time">{formatTimecode(frame)} / {formatTimecode(end)} · 60fps</span>
      <button aria-pressed={autoKey} onClick={st.toggleAutoKey}>자동 키</button>
      <button disabled={!editing} onClick={() => st.setView(view === 'tracks' ? 'graph' : 'tracks')}>{view === 'tracks' ? '트랙' : '그래프'}</button>
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
      {anyDone && !progress && !loading && <span className="tl-phys mb-hint">{PHYS_NOTE}</span>}
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
