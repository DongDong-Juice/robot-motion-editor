import { useEffect, useState } from 'react'
import { setImportResult, useImportUi, importDroppedFiles } from '../importActions'
import { getEditor, useEditor } from '../store/store'
import { videoTrack } from '../model/video'
import AssetList from './AssetList'
import { filterTree } from './binTree'

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
  const project = useEditor(s => s.project)
  const [tab, setTab] = useState<'clip' | 'media'>('clip')
  const [query, setQuery] = useState('')
  const res = useImportUi(s => s.res)
  useEffect(() => { if (res) { const t = setTimeout(() => setImportResult(null), 10000); return () => clearTimeout(t) } }, [res])
  const count = filterTree(tab === 'clip' ? Object.values(project.clips) : project.media, [], query, new Set()).count

  // CSV files dragged in from the desktop: highlight the panel and import on drop (rows dragged out are not files)
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
  const tabs = [['clip', '모션(CSV)'], ['media', '영상']] as const

  return (
    <div className={over ? 'pp drop' : 'pp'} {...fileDrop}>
      {over && <div className="pp-drop" aria-hidden="true">CSV를 놓으면 가져옵니다</div>}
      <h2>목록</h2>
      <div role="tablist" aria-label="목록" className="pp-tabs">
        {tabs.map(([t, label]) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{label}</button>)}
      </div>
      <div className="pp-filter">
        <input type="search" aria-label="필터" placeholder="필터" value={query} onChange={e => setQuery(e.target.value)} />
        <span className="pp-count">{count} 항목</span>
      </div>
      {tab === 'media' && <VideoView />}
      {/* both lists stay mounted so each keeps its open folders and selection across tab switches */}
      {tabs.map(([t]) => <div key={t} className={`pp-list ${t}`} hidden={tab !== t}><AssetList tab={t} query={query} /></div>)}
      {res && (
        <div className="pp-msg" role="status">
          {res.head && <p>{res.head}</p>}
          {res.lines.map(f => <p key={f}>{f}</p>)}
        </div>
      )}
    </div>
  )
}
