import { clipLocked, editingItem, getEditor, useEditor } from '../store/store'
import GraphCanvas from './GraphCanvas'
import SequenceCanvas from './SequenceCanvas'
import TrackCanvas from './TrackCanvas'

export default function Timeline() {
  const view = useEditor(s => s.view), editing = useEditor(s => s.editing)
  const project = useEditor(s => s.project)
  if (!editing) return <SequenceCanvas />
  const e = editingItem({ project, editing }), actor = project.actors.find(a => a.id === e?.actorId)
  return (
    <div className="tl-wrap">
      <div className="tl-crumb">
        <button onClick={() => getEditor().getState().closeItem()}>시퀀스</button>
        <span> ▸ {actor?.name} / {e?.clip.name}</span>
      </div>
      <div className="tl-body">
        {view === 'tracks' ? <TrackCanvas /> : <GraphCanvas />}
        {e && clipLocked(project, e.clip.id) && <div className="seq-msg" role="status" style={{ left: 164, top: 28 }}>잠긴 트랙입니다</div>}
      </div>
    </div>
  )
}
