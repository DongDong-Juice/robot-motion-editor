import { useEffect, useState } from 'react'
import { fetchRobotDef } from './robot/loadRobot'
import { initEditor, useEditor } from './store/store'
import Inspector from './inspector/Inspector'
import Stage from './viewer/Stage'
import Timeline from './timeline/Timeline'
import { formatTimecode } from './timeline/timeScale'
import { sequenceEnd, startTransport } from './transport'

function Menubar() {
  const playing = useEditor(s => s.playing), frame = useEditor(s => s.frame)
  const end = useEditor(s => sequenceEnd(s.project))
  const autoKey = useEditor(s => s.autoKey), view = useEditor(s => s.view)
  const st = useEditor(s => s)
  return (
    <>
      <span className="mb-title">Motion Editor</span>
      <button onClick={() => st.setPlaying(!playing)} aria-label={playing ? '정지' : '재생'}>{playing ? '■' : '▶'}</button>
      <span className="mb-time">{formatTimecode(frame)} / {formatTimecode(end)} · 60fps</span>
      <button aria-pressed={autoKey} onClick={st.toggleAutoKey}>자동 키</button>
      <button onClick={() => st.setView(view === 'tracks' ? 'graph' : 'tracks')}>{view === 'tracks' ? '트랙' : '그래프'}</button>
    </>
  )
}

export default function App() {
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    Promise.all([fetchRobotDef('g1'), fetchRobotDef('go2')])
      .then(([g1, go2]) => { initEditor({ g1, go2 }); setStatus('ready') })
      .catch(e => setStatus(`로봇 불러오기 실패: ${e instanceof Error ? e.message : e}`))
  }, [])

  useEffect(() => (status === 'ready' ? startTransport() : undefined), [status])

  return (
    <div id="app">
      <header id="menubar">{status === 'ready' ? <Menubar /> : 'Motion Editor'}</header>
      <aside id="project">Project</aside>
      <main id="stage">
        {status === 'ready' ? <Stage /> : status === 'loading' ? '로봇 불러오는 중…' : status}
      </main>
      <aside id="inspector">{status === "ready" && <Inspector />}</aside>
      <section id="timeline">{status === 'ready' && <Timeline />}</section>
    </div>
  )
}
