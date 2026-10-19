import { useEffect, useRef, useState } from 'react'
import { hubList, type HubEntry } from './fileio'
import { badTitle, newHubProject, newLocalProject, openHubProject, openProject } from './projectActions'
import { projectTitle } from './model/sequence'

const rtf = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' })
const UNITS = [['minute', 60, 60], ['hour', 3600, 24], ['day', 86400, 30]] as const // [unit, seconds, up to]
// "방금", "5분 전", "3시간 전", "어제"…; a date after 30 days
function ago(ms: number) {
  const s = (ms - Date.now()) / 1000
  if (Math.abs(s) < 60) return '방금'
  for (const [u, k, n] of UNITS) if (Math.abs(s) < k * n) return rtf.format(Math.round(s / k), u)
  return new Date(ms).toLocaleDateString('ko-KR')
}

// First screen (project hub): projects in the server folder, open one from this PC, or create one by name. Cannot be dismissed.
export default function StartScreen({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [list, setList] = useState<HubEntry[] | null | undefined>(undefined) // undefined = loading, null = no hub server
  const [query, setQuery] = useState(''), [asc, setAsc] = useState(false)
  const [adding, setAdding] = useState(false), [title, setTitle] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
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
  const rows = (list ?? []).filter(p => projectTitle(p.name).toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => asc ? a.mtime - b.mtime : b.mtime - a.mtime)

  return (
    <dialog ref={ref} className="hub" aria-label="프로젝트 시작" onCancel={e => e.preventDefault()}>
      <header className="hub-head">
        <h1>프로젝트</h1>
        <input type="search" className="hub-search" aria-label="검색" placeholder="검색" value={query} onChange={e => setQuery(e.target.value)} />
        <button onClick={() => run(openProject)} disabled={busy}>이 PC에서 열기</button>
        <button className="hub-primary" onClick={() => { setAdding(true); setErr('') }} disabled={busy}>+ 새 프로젝트</button>
      </header>
      <div className="hub-table" role="list" aria-label="서버 프로젝트">
        <div className="hub-row hub-cols">
          <span>이름</span>
          <button className="hub-sort" onClick={() => setAsc(a => !a)} aria-label={`수정한 시각 ${asc ? '오래된 순' : '최근 순'}`}>수정한 시각 {asc ? '↑' : '↓'}</button>
        </div>
        {adding && (
          <div className="hub-row hub-new">
            <div>
              <div className="hub-new-in">
                <input aria-label="프로젝트 이름" placeholder="새 프로젝트 이름" value={title} autoFocus
                  onChange={e => { setTitle(e.target.value); setErr('') }}
                  onKeyDown={e => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setAdding(false) }} />
                <button className="hub-primary" onClick={create} disabled={busy}>만들기</button>
                <button onClick={() => setAdding(false)}>취소</button>
              </div>
              <div className={err ? 'hub-err' : 'hub-dim'} role={err ? 'alert' : undefined}>
                {err || (list === null ? '서버에 연결할 수 없어 저장은 이 PC에 합니다' : '서버 폴더에 <이름>.motion.json으로 만듭니다')}
              </div>
            </div>
          </div>
        )}
        {list === undefined ? <div className="hub-empty">불러오는 중…</div>
          : list === null ? <div className="hub-empty">서버에 연결할 수 없습니다</div>
          : !rows.length ? <div className="hub-empty">{list.length ? '검색 결과가 없습니다' : '아직 프로젝트가 없습니다'}</div>
          : rows.map(p => (
            <button key={p.name} role="listitem" className="hub-row hub-item" disabled={busy} onClick={() => run(() => openHubProject(p.name))}>
              <span><b>{projectTitle(p.name)}</b><span className="hub-dim">{p.name}</span></span>
              <span title={new Date(p.mtime).toLocaleString('ko-KR')}>{ago(p.mtime)}</span>
            </button>))}
      </div>
    </dialog>
  )
}
