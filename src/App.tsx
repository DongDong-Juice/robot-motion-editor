import { useEffect, useState } from 'react'
import { fetchRobotDef } from './robot/loadRobot'
import { getEditor, gizmoLock, initEditor, useEditor } from './store/store'
import Inspector from './inspector/Inspector'
import Stage from './viewer/Stage'
import ProjectPanel from './project/ProjectPanel'
import Timeline from './timeline/Timeline'
import { formatTimecode } from './timeline/timeScale'
import ExportDialog from './export/ExportDialog'
import { sequenceEnd, startTransport } from './transport'
import { newProjectFile, onMessage, openProject, saveProject } from './projectActions'

function AutoKeyHint() {
  const off = useEditor(s => !s.autoKey && !!s.sel.channel && !s.sel.channel.startsWith('group:'))
  return off ? <div className="stage-hint">자동 키 꺼짐: 기즈모 변경은 저장되지 않습니다</div> : null
}

export function CrossfadeHint() {
  const lock = useEditor(gizmoLock)
  return lock === 'crossfade' ? <div className="stage-hint hi">크로스페이드 구간에서는 클립 보기에서 루트를 편집하세요</div>
    : lock === 'stitch' ? <div className="stage-hint hi">이 프레임의 루트 위치·방향은 앞 클립 끝에 맞춰집니다</div> : null
}

function Menubar() {
  const playing = useEditor(s => s.playing), frame = useEditor(s => s.frame)
  const end = useEditor(s => sequenceEnd(s.project))
  const autoKey = useEditor(s => s.autoKey), view = useEditor(s => s.view), editing = useEditor(s => s.editing !== null)
  const st = useEditor(s => s)
  const [exporting, setExporting] = useState(false)
  const name = useEditor(s => s.fileName ?? '새 프로젝트'), dirty = useEditor(s => s.dirty)
  const [msg, setMsg] = useState('')
  const title = name + (dirty ? ' •' : '')
  useEffect(() => { document.title = title }, [title])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => {
    let t: number | undefined
    const off = onMessage(m => { setMsg(m); clearTimeout(t); t = window.setTimeout(() => setMsg(''), 3000) })
    return () => { off(); clearTimeout(t) }
  }, [])
  return (
    <>
      <span role="group" aria-label="파일" className="mb-group">
        <button onClick={newProjectFile}>새 프로젝트</button>
        <button onClick={openProject}>열기</button>
        <button onClick={() => saveProject()}>저장</button>
        <button onClick={() => saveProject(true)}>다른 이름으로 저장</button>
      </span>
      <span className="mb-title">{title}</span>
      {msg && <span role="status" className="mb-msg">{msg}</span>}
      <button onClick={() => st.setPlaying(!playing)} aria-label={playing ? '정지' : '재생'}>{playing ? '■' : '▶'}</button>
      <span className="mb-time">{formatTimecode(frame)} / {formatTimecode(end)} · 60fps</span>
      <button aria-pressed={autoKey} onClick={st.toggleAutoKey}>자동 키</button>
      <button disabled={!editing} onClick={() => st.setView(view === 'tracks' ? 'graph' : 'tracks')}>{view === 'tracks' ? '트랙' : '그래프'}</button>
      <span role="group" aria-label="액터+" className="mb-group">
        <span>액터+</span>
        <button onClick={() => st.addActor('g1')}>G1 추가</button>
        <button onClick={() => st.addActor('go2')}>GO2 추가</button>
      </span>
      <button onClick={() => setExporting(true)}>내보내기</button>
      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
    </>
  )
}

export default function App() {
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    Promise.all([fetchRobotDef('g1'), fetchRobotDef('go2')])
      .then(([g1, go2]) => { initEditor({ g1, go2 }); if (import.meta.env.DEV) (window as any).__editor = getEditor(); setStatus('ready') })
      .catch(e => setStatus(`로봇 불러오기 실패: ${e instanceof Error ? e.message : e}`))
  }, [])

  useEffect(() => (status === 'ready' ? startTransport() : undefined), [status])

  return (
    <div id="app">
      <header id="menubar">{status === 'ready' ? <Menubar /> : 'Motion Editor'}</header>
      <aside id="project">{status === 'ready' && <ProjectPanel />}</aside>
      <main id="stage">
        {status === 'ready' && <AutoKeyHint />}
        {status === 'ready' && <CrossfadeHint />}
        {status === 'ready' ? <Stage /> : status === 'loading' ? '로봇 불러오는 중…' : status}
      </main>
      <aside id="inspector">{status === "ready" && <Inspector />}</aside>
      <section id="timeline">{status === 'ready' && <Timeline />}</section>
    </div>
  )
}
