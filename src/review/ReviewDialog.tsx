// 검수 목록 (수정변동사항.md §12 · §13): suspect joint jumps of one target in a list, the frame vs. the frame before it in 3D, the
// speed / limit around it, and a verdict. The motion is never changed; verdicts are saved in the project (Project.review, undoable).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, getEditor } from '../store/store'
import { projectTitle } from '../model/sequence'
import { COLOR } from '../model/defaults'
import type { Pose } from '../model/pose'
import type { ReviewVerdict } from '../model/types'
import { seqFocus } from '../timeline/viewState'
import { saveCsvFile } from '../fileio'
import { CONTEXT, detectSuspects, itemSeries, type Suspect, type SuspectKind } from './detect'
import { reviewTargets, targetPoses, type ReviewTarget } from './targets'
import { clipRange, recordCsv, resolvedBad, targetClipId, verdictOf } from './verdicts'
import { noteCheck } from './reviewState'
import { ReviewView, type ReviewAngle } from './ReviewView'

const KIND: Record<SuspectKind, string> = { limit: '로봇 한계 초과', rel: '파일 기준 급변', start: '첫 프레임 튐' }
const FILTERS: { key: 'all' | SuspectKind; label: string }[] = [{ key: 'all', label: '전체' }, { key: 'limit', label: KIND.limit }, { key: 'rel', label: KIND.rel }, { key: 'start', label: KIND.start }]
const ANGLES: ReviewAngle[] = ['3/4', '정면', '측면']
const JOINT = (n: string) => n.replace(/_joint$/, '')
const sec = (f: number) => (f / 60).toFixed(1)
type Group = 'open' | 'bad' | 'ok'
const GROUP: Record<Group, string> = { open: '미처리', bad: '문제 있음 (미해결)', ok: '안무로 둔 지점' }

export default function ReviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), viewEl = useRef<HTMLDivElement>(null), view = useRef<ReviewView | null>(null)
  const project = useEditor(s => s.project), defs = useEditor(s => s.defs), title = useEditor(s => projectTitle(s.fileName))
  const setVerdict = useEditor(s => s.setReviewVerdict)
  const targets = useMemo(() => (open ? reviewTargets(project, title) : []), [open, project, title])
  const [tKey, setTKey] = useState('')
  const target = targets.find(t => t.key === tKey) ?? null
  const clipId = target ? targetClipId(project, target) : undefined
  const [run, setRun] = useState(0) // 다시 검사
  const [res, setRes] = useState<{ key: string; poses: Pose[]; items: Suspect[] } | null>(null)
  const [filter, setFilter] = useState<'all' | SuspectKind>('all')
  const [showResolved, setShowResolved] = useState(false)
  const [sel, setSel] = useState(0), [cur, setCur] = useState(0)
  const [angle, setAngle] = useState<ReviewAngle>('3/4'), [ghost, setGhost] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      const s = getEditor().getState(), ts = reviewTargets(s.project, projectTitle(s.fileName))
      const want = s.selItem ? `item:${s.selItem}` : s.clipEdit ? `clip:${s.clipEdit}` : ''
      setTKey(ts.find(t => t.key === want)?.key ?? ts[0]?.key ?? ''); setRes(null); setSel(0); setMsg('')
      d.showModal()
    }
    if (!open && d.open) d.close()
  }, [open])

  // run the check for the chosen target (after the dialog paints: a long motion takes a moment)
  useEffect(() => {
    if (!open || !target) return
    let live = true
    const id = setTimeout(() => {
      const s = getEditor().getState(), poses = targetPoses(s.project, s.defs, target)
      if (!live) return
      const items = poses ? detectSuspects(poses, s.defs[target.robot]) : []
      setRes({ key: target.key, poses: poses ?? [], items })
      setSel(0)
      const cid = targetClipId(s.project, target)
      if (cid && poses) { // 해결됨: 문제 있음 verdicts in this range that the check no longer finds (the timeline greys them)
        const inRange = (s.project.review ?? []).filter(v => v.clipId === cid && v.verdict === 'bad' && v.to >= target.clipFrom && v.from < target.clipFrom + poses.length)
        noteCheck(inRange, resolvedBad(s.project.review, cid, items, target.clipFrom, poses.length))
      }
    }, 0)
    return () => { live = false; clearTimeout(id) }
  }, [open, tKey, run]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !!res && !!target && res.key === target.key
  const all = ready ? res!.items : []
  const vOf = (s: Suspect): ReviewVerdict | undefined => (clipId && target ? verdictOf(project.review, clipId, s, target.clipFrom) : undefined)
  const groupOf = (s: Suspect): Group => vOf(s)?.verdict ?? 'open'
  const filtered = all.filter(s => filter === 'all' || s.kind === filter)
  const groups = (['open', 'bad', 'ok'] as Group[]).map(g => ({ g, items: filtered.filter(s => groupOf(s) === g) }))
  const flat = groups.flatMap(x => x.items) // selection order: 미처리, 문제 있음, 안무 (안무 always last, user)
  const item = flat[Math.min(sel, flat.length - 1)] ?? null
  const counts = (k: 'all' | SuspectKind) => all.filter(s => k === 'all' || s.kind === k).length
  const n = (g: Group) => all.filter(s => groupOf(s) === g).length
  const resolved = ready && clipId ? resolvedBad(project.review, clipId, all, target!.clipFrom, res!.poses.length) : []

  useEffect(() => { if (item) setCur(item.worst) }, [item?.from, item?.to, item?.kind, res]) // eslint-disable-line react-hooks/exhaustive-deps

  // the 3D view lives while the dialog is open
  useEffect(() => {
    if (!open || !viewEl.current) return
    const v = new ReviewView(viewEl.current); view.current = v
    return () => { v.dispose(); view.current = null }
  }, [open])
  const poses = ready ? res!.poses : []
  const def = target ? defs[target.robot] : null
  useEffect(() => {
    const v = view.current
    if (!v || !def || !item || !poses[cur]) return
    v.show(def, COLOR[target!.robot], poses[cur], ghost && cur > 0 ? poses[cur - 1] : null)
  }, [item, cur, ghost, poses, def]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const v = view.current; if (v && item && poses[item.worst]) v.aim(poses[item.worst], angle) }, [item, angle, poses])

  const series = item && def ? itemSeries(poses, def, item) : null
  const step = (d: number) => { if (series) setCur(c => Math.min(Math.max(c + d, series.from), series.from + series.values.length - 1)) }
  // a verdict is saved on the clip's frames (undoable); the same button again clears it. The item moves to its group, the
  // selection stays at the same place in the list (= the next 미처리 one after judging one)
  const judge = (v: ReviewVerdict['verdict']) => {
    if (!item || !target || !clipId) return
    setVerdict({ clipId, kind: item.kind, ...clipRange(item, target.clipFrom) }, vOf(item)?.verdict === v ? null : v)
  }
  const clearResolved = (v: ReviewVerdict) => setVerdict({ clipId: v.clipId, from: v.from, to: v.to, kind: v.kind }, null)
  const goTimeline = () => {
    if (!target) return
    const s = getEditor().getState()
    onClose()
    if (target.kind === 'item') {
      if (s.clipEdit) s.closeClipEdit()
      getEditor().getState().setFrame(target.firstFrame + cur)
      getEditor().getState().selectItem(target.id)
      seqFocus.fn?.(target.id)
    } else {
      s.openClipEdit(target.id)
      getEditor().getState().setFrame(cur)
    }
  }
  const exportRecord = async () => {
    if (!target || !clipId || !ready) return
    const name = project.clips[clipId]?.name ?? 'clip'
    try {
      const ok = await saveCsvFile(`${name.replace(/[/\\:*?"<>|#\s]/g, '_')}_검수기록.csv`, recordCsv(name, target, all, project.review, clipId))
      if (ok) setMsg(`판정 기록 ${all.length}건을 내보냈습니다`)
    } catch (e) { setMsg(`판정 기록 내보내기 실패: ${e instanceof Error ? e.message : e}`) }
  }

  const csvRow = (f: number) => (target ? target.clipFrom + f + 1 : f + 1)
  const title1 = (s: Suspect) => s.kind === 'start' ? `첫 프레임 튐 · ${s.parts.join('·') || '전신'} ${s.jump.toFixed(2)} rad`
    : `${s.parts.join('·')} ${Math.round(s.speed)} rad/s · 로봇 한계 ${s.ratio.toFixed(1)}배`
  const sub1 = (s: Suspect) => `f${s.from}${s.to > s.from ? `~f${s.to}` : ''} · ${sec(s.from)}초 · ${s.to - s.from + 1}프레임 · ${s.joints.length}개 관절`
  const max = series ? Math.max(1.2, ...series.values) : 1
  const H = 100, y = (v: number) => H - 6 - Math.sqrt(v / max) * (H - 14) // sqrt: small values stay visible next to a big jump
  const itemV = item ? vOf(item)?.verdict : undefined

  return (
    <dialog ref={ref} className="rv" onClose={onClose} aria-label="검수 목록"
      onKeyDown={e => { // keys stay in the window (not the editor's shortcuts); ← → step a frame
        e.stopPropagation()
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target instanceof HTMLSelectElement)) { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1) }
      }}>
      <div className="rv-head">
        <h2>⚠ 검수 목록</h2>
        <span className="rv-dim">튀는 관절을 찾아 직전 프레임과 비교하고 판정합니다 (모션은 바꾸지 않음 · 판정은 프로젝트에 저장)</span>
        {msg && <span role="status" className="rv-msg">{msg}</span>}
        <button className="rv-close" onClick={onClose}>닫기</button>
      </div>
      <div className="rv-bar">
        <label className="rv-dim">대상 <select aria-label="검수 대상" value={tKey} onChange={e => { setTKey(e.target.value); setSel(0) }}>
          {targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select></label>
        <div className="rv-filters" role="group" aria-label="종류">
          {FILTERS.map(f => <button key={f.key} aria-pressed={filter === f.key} onClick={() => { setFilter(f.key); setSel(0) }}>{f.label} {counts(f.key)}</button>)}
        </div>
        <span className="rv-dim rv-count">미처리 {n('open')} · 문제 {n('bad')} · 안무 {n('ok')} / 전체 {all.length}</span>
        <label className="rv-check"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} />해결된 것도 보기 {resolved.length}</label>
        <span className="rv-tools">
        <button className="rv-again" onClick={() => setRun(k => k + 1)} title="지금 상태(수정 층 포함)로 다시 검사합니다. 문제 있음으로 둔 지점에서 튐이 사라졌으면 해결됨이 됩니다">다시 검사</button>
        <button onClick={exportRecord} disabled={!ready} title="이 대상의 검출 항목을 측정값·판정과 함께 CSV로 저장합니다 (기준 다듬기용)">판정 기록 내보내기</button>
        </span>
      </div>
      <div className="rv-body">
        <ul className="rv-list" aria-label="의심 지점">
          {!targets.length && <li className="rv-empty">검사할 모션이 없습니다</li>}
          {targets.length > 0 && !ready && <li className="rv-empty">검사 중…</li>}
          {ready && !all.length && <li className="rv-empty">의심 지점이 없습니다</li>}
          {ready && all.length > 0 && !n('open') && <li className="rv-empty">미처리 항목이 없습니다</li>}
          {groups.map(({ g, items }) => items.length > 0 && [
            g !== 'open' && <li key={`h-${g}`} className={`rv-group ${g}`}>{GROUP[g]} {items.length}</li>,
            ...items.map(s => {
              const i = flat.indexOf(s), v = vOf(s)
              return (
                <li key={`${g}-${s.kind}-${s.from}-${s.to}`}>
                  <button className="rv-item" aria-current={s === item} onClick={() => setSel(i)}>
                    <span className={`rv-chip ${s.kind}`}>{KIND[s.kind]}</span>
                    <b>{title1(s)}</b>{v && <span className={`rv-v ${v.verdict}`}>{v.verdict === 'bad' ? '문제 있음' : '안무여서 놔둠'}</span>}
                    <span className="rv-sub">{sub1(s)}</span>
                  </button>
                </li>
              )
            }),
          ])}
          {showResolved && resolved.length > 0 && [
            <li key="h-res" className="rv-group res">해결됨 {resolved.length}</li>,
            ...resolved.map(v => (
              <li key={`res-${v.from}-${v.to}-${v.at}`} className="rv-res">
                <span className="rv-chip res">해결됨</span>
                <span>{KIND[v.kind]} · 클립 f{v.from}{v.to > v.from ? `~f${v.to}` : ''} · 문제 있음으로 판정했던 지점, 지금은 튐 없음</span>
                <button onClick={() => clearResolved(v)} title="해결된 판정을 지웁니다">판정 지우기</button>
              </li>
            )),
          ]}
        </ul>
        <div className="rv-main">
          <div className="rv-title">
            {item ? <><b>f{cur} · {sec(cur)}초</b><span className="rv-dim">CSV {csvRow(cur)}행{target!.kind === 'item' ? ` · 시퀀스 F${target!.firstFrame + cur}` : ''} · {KIND[item.kind]} · {item.joints.map(JOINT).join(', ')}</span></> : <span className="rv-dim">항목을 고르세요</span>}
          </div>
          <div className="rv-view" ref={viewEl}>
            <div className="rv-legend"><i className="g" />주황 = 직전 f{Math.max(cur - 1, 0)} <i className="c" />지금 f{cur}</div>
            <div className="rv-angles">
              <button aria-pressed={ghost} onClick={() => setGhost(g => !g)}>겹쳐 보기</button>
              {ANGLES.map(a => <button key={a} aria-pressed={angle === a} onClick={() => setAngle(a)}>{a}</button>)}
            </div>
          </div>
          <div className="rv-chart-head"><b>구간 지표</b>{series && <span className="rv-dim">f{series.from}~f{series.from + series.values.length - 1} (앞뒤 {CONTEXT}프레임) · 관련 관절 속도 / 로봇 한계 · 최대 {Math.max(...series.values).toFixed(1)}배</span>}</div>
          <svg className="rv-chart" viewBox={`0 0 ${series?.values.length ?? 1} ${H}`} preserveAspectRatio="none" role="img" aria-label="구간 지표">
            {series?.values.map((v, i) => {
              const f = series.from + i, inItem = item && f >= item.from && f <= item.to
              return <rect key={i} x={i + 0.12} width={0.76} y={y(v)} height={H - 6 - y(v)} className={f === cur ? 'cur' : v > 1 ? 'over' : inItem ? 'in' : ''} onClick={() => setCur(f)} />
            })}
            {series && <line x1={0} x2={series.values.length} y1={y(1)} y2={y(1)} className="lim" />}
          </svg>
          <div className="rv-legend2 rv-dim">회색 = 앞뒤 여유 · 밝은 회색 = 의심 구간 · 주황 = 로봇 한계 초과 · 흰색 = 보고 있는 프레임 · 빨간 점선 = 한계(1.0배) · 막대를 누르면 그 프레임</div>
          <div className="rv-actions">
            <button disabled={!item} onClick={() => step(-1)}>◀ 1</button>
            <button disabled={!item} onClick={() => step(1)}>1 ▶</button>
            <button disabled={!item} onClick={() => item && setCur(item.worst)}>최악 프레임</button>
            <button disabled={!item} onClick={goTimeline}>타임라인에서 보기</button>
            <span className="rv-gap" />
            <button disabled={!item || !clipId} className="bad" aria-pressed={itemV === 'bad'} onClick={() => judge('bad')} title="미해결 문제로 남깁니다 (타임라인 빨간 표시 · 내보낼 때 경고). 다시 누르면 판정을 지웁니다">문제 있음</button>
            <button disabled={!item || !clipId} className="ok" aria-pressed={itemV === 'ok'} onClick={() => judge('ok')} title="문제로 세지 않고 '안무로 둔 지점'으로 남깁니다 (내보내기 경고에서 빠지고 따로 표시). 다시 누르면 판정을 지웁니다">안무여서 놔둠</button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
