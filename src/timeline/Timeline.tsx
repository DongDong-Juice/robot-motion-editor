import { useEditor } from '../store/store'
import GraphCanvas from './GraphCanvas'
import TrackCanvas from './TrackCanvas'

export default function Timeline() {
  const view = useEditor(s => s.view)
  return view === 'tracks' ? <TrackCanvas /> : <GraphCanvas />
}
