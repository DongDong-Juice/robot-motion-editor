import { useEditor } from '../store/store'
import TrackCanvas from './TrackCanvas'

export default function Timeline() {
  const view = useEditor(s => s.view)
  return view === 'tracks' ? <TrackCanvas /> : <div className="tl-placeholder">그래프 보기 (Task 11)</div>
}
