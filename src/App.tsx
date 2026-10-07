import { useEffect, useState } from 'react'
import { fetchRobotDef } from './robot/loadRobot'
import { initEditor } from './store/store'
import Stage from './viewer/Stage'

export default function App() {
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    Promise.all([fetchRobotDef('g1'), fetchRobotDef('go2')])
      .then(([g1, go2]) => { initEditor({ g1, go2 }); setStatus('ready') })
      .catch(e => setStatus(`로봇 불러오기 실패: ${e instanceof Error ? e.message : e}`))
  }, [])

  return (
    <div id="app">
      <header id="menubar">Motion Editor</header>
      <aside id="project">Project</aside>
      <main id="stage">
        {status === 'ready' ? <Stage /> : status === 'loading' ? '로봇 불러오는 중…' : status}
      </main>
      <aside id="inspector">Inspector</aside>
      <section id="timeline">Timeline</section>
    </div>
  )
}
