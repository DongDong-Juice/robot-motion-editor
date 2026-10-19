import { useEffect, useRef, useState } from 'react'
import { hubList, type HubEntry } from './fileio'
import { badTitle, newHubProject, newLocalProject, openHubProject, openProject } from './projectActions'
import { projectTitle } from './model/sequence'

// First screen: pick a project on the hub server, open one from this PC, or create one by name. Cannot be dismissed.
export default function StartScreen({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [list, setList] = useState<HubEntry[] | null | undefined>(undefined) // undefined = loading, null = no hub server
  const [title, setTitle] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal(); void hubList().then(setList) }, [])

  const run = async (f: () => Promise<boolean>) => { setBusy(true); try { if (await f()) onDone() } finally { setBusy(false) } }
  const create = () => run(async () => {
    const bad = badTitle(title)
    if (bad) { setErr(bad); return false }
    if (list === null) { newLocalProject(title); return true }
    const r = await newHubProject(title)
    if (r === 'exists') setErr('이미 있는 이름입니다')
    return r === true
  })

  return (
    <dialog ref={ref} className="exp start" aria-label="프로젝트 시작" onCancel={e => e.preventDefault()}>
      <h2>프로젝트</h2>
      <fieldset>
        <legend>서버 프로젝트</legend>
        {list === undefined ? <div className="exp-dim">불러오는 중…</div>
          : list === null ? <div className="exp-dim">서버에 연결할 수 없습니다</div>
          : !list.length ? <div className="exp-dim">아직 프로젝트가 없습니다</div>
          : <ul className="start-list">{list.map(p => (
            <li key={p.name}><button disabled={busy} onClick={() => run(() => openHubProject(p.name))}>
              <span>{projectTitle(p.name)}</span><span className="exp-dim">{new Date(p.mtime).toLocaleString('ko-KR')}</span>
            </button></li>))}</ul>}
      </fieldset>
      <fieldset>
        <legend>새 프로젝트</legend>
        <div className="exp-row">
          <input aria-label="프로젝트 이름" placeholder="이름" value={title} autoFocus
            onChange={e => { setTitle(e.target.value); setErr('') }} onKeyDown={e => { if (e.key === 'Enter') void create() }} />
          <button onClick={create} disabled={busy}>만들기</button>
        </div>
        {err && <div className="start-err" role="alert">{err}</div>}
        {list === null && <div className="exp-dim">저장은 이 PC에 합니다</div>}
      </fieldset>
      <div className="exp-row"><button onClick={() => run(openProject)} disabled={busy}>이 PC에서 열기</button></div>
    </dialog>
  )
}
