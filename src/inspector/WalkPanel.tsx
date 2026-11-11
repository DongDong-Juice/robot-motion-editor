// 걷기 블록 설정 칸 (§20): the 라이브러리's 걷기 (가상) add panel and the inspector of a selected 걷기 piece share these fields —
// 도착 위치 (무대 기준), 방향, 시간 ⇄ 속도, 시간에 비해 거리가 짧을 때 — and the walk's state (초록 / 주황 / 빨강 with the reasons).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getEditor, trackLocked, useEditor, type AddWalkPlan, type WalkFix, type WalkPlan } from '../store/store'
import { walkOf, walkPreview } from '../model/itemClip'
import { bridgeFor, standBridgeAfter } from '../model/bridge'
import { sortedItems } from '../model/sequence'
import { describeTo, type WalkFace, type WalkReport, type WalkSlow, type WalkSpec } from '../model/walk'
import { applyXf } from '../model/sequence'
import type { Actor, Clip, Item } from '../model/types'
import { newActorX } from '../model/defaults'

const FACES: [WalkFace, string][] = [['travel', '진행 방향'], ['keep', '방향 유지'], ['audience', '객석 보기']]
const SLOWS: [WalkSlow, string][] = [['walk', '천천히 계속 걷기'], ['after', '걷고 나서 서 있기'], ['before', '서 있다가 걷기']]
const TONE: Record<WalkReport['tone'], string> = { ok: '정상', warn: '주의', bad: '한계 초과' }
export const WALK_DEFAULT_FRAMES = 120

const sec = (f: number) => (f / 60).toFixed(1)
const shown = (v: number | undefined) => v === undefined ? '' : String(+v.toFixed(3)) // what a box shows for a value
/** A number box that commits on blur / Enter — only a changed value (an empty box commits `undefined` when `optional`). */
export function Num({ label, value, unit, step, onCommit, disabled, optional, placeholder, chg }: { label: string; value: number | undefined; unit: string; step: number
  onCommit: (v: number | undefined) => void; disabled?: boolean; optional?: boolean; placeholder?: string; chg?: boolean /* §30: a value not applied yet */ }) {
  return (
    <span className={chg ? 'insp-unit wk-num wk-chg' : 'insp-unit wk-num'}><input type="number" aria-label={label} step={step} disabled={disabled} placeholder={placeholder}
      key={value === undefined ? 'none' : value.toFixed(4)} defaultValue={shown(value)}
      onBlur={e => {
        const t = e.target.value.trim(), v = t === '' ? undefined : e.target.valueAsNumber
        if (t === shown(value) || (v !== undefined && shown(v) === shown(value))) return // unchanged: nothing to do (a held walk would refuse it)
        if (v === undefined ? optional : Number.isFinite(v)) onCommit(v)
      }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /><i>{unit}</i></span>
  )
}

/** 도착 X · Y (§23): one change for both — moving between the two boxes commits nothing; leaving them (or Enter) commits the pair. */
function TargetXY({ to, disabled, onCommit, lab: lab0 = '도착', chg }: { to: [number, number]; disabled?: boolean; onCommit: (to: [number, number]) => void; lab?: string; chg?: boolean }) {
  const row = useRef<HTMLDivElement>(null), xr = useRef<HTMLInputElement>(null), yr = useRef<HTMLInputElement>(null)
  const commit = () => {
    const x = xr.current!.valueAsNumber, y = yr.current!.valueAsNumber
    if (!Number.isFinite(x) || !Number.isFinite(y)) { xr.current!.value = shown(to[0]); yr.current!.value = shown(to[1]); return }
    if (shown(x) !== shown(to[0]) || shown(y) !== shown(to[1])) onCommit([x, y])
  }
  const name = lab0
  const box = (lab: 'X' | 'Y', i: 0 | 1, r: typeof xr) => <>
    <span className="wk-dim" aria-hidden="true">{lab}</span>
    <span className={chg ? 'insp-unit wk-num wk-chg' : 'insp-unit wk-num'}><input ref={r} type="number" aria-label={`${name} ${lab}`} step={0.05} disabled={disabled} key={to[i].toFixed(4)} defaultValue={shown(to[i])}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} /><i>m</i></span>
  </>
  return (
    <div className="wk-row" ref={row} onBlur={e => { if (!row.current?.contains(e.relatedTarget as Node | null)) commit() }}>
      {box('X', 0, xr)}{box('Y', 1, yr)}
    </div>
  )
}

export type Changed = 'start' | 'startYaw' | 'to' | 'face' | 'yaw' | 'time' | 'slow'
/** The fields. `spec` + `frames` are the values shown; `start` (stage) is where the walk starts (for the distance and the speed). */
export function WalkFields({ pickKey, spec, frames, start, dist, report, onSpec, onFrames, disabled, fix, place, onPlace, headline, changed }: { pickKey: string; spec: WalkSpec; frames: number
  start: Parameters<typeof describeTo>[0] | null; dist: number; report: WalkReport | null; disabled?: boolean
  onSpec: (patch: Partial<WalkSpec>) => void; onFrames: (frames: number) => void; fix?: ReactNode /* 해결 버튼 under the state */
  place?: Actor['placement'] | null /* §27 출발 위치: the walk is the track's first piece — the robot's 배치 (else it starts where the piece before ends) */
  onPlace?: (pl: Partial<Actor['placement']>) => void; headline?: string /* §29: what is wrong, in one sentence (한계 초과) */
  changed?: Changed[] /* §30: the fields whose value is 바꿀 예정 (not applied) — marked */ }) {
  const chg = (k: Changed) => !!changed?.includes(k)
  const secs = frames / 60, speed = dist / Math.max(secs, 1e-6)
  // 무대에서 찍기 (§21): the next click on the main stage's floor sets 도착 위치 (the latest onSpec, through a ref)
  const picking = useEditor(s => s.walkPick?.key === pickKey)
  const onSpecRef = useRef(onSpec)
  onSpecRef.current = onSpec
  const from: [number, number] | null = start ? [start.rootPos[0], start.rootPos[1]] : null
  const pick = () => getEditor().getState().setWalkPick(picking || !from ? null : { key: pickKey, from, apply: to => onSpecRef.current({ to }) })
  const off = disabled || !from
  useEffect(() => { if (off && picking) getEditor().getState().setWalkPick(null) }, [off, picking])
  // 출발 위치 찍기 (§27): the same, for the robot's 배치 (the line from the target)
  const startKey = `${pickKey}:start`, pickingStart = useEditor(s => s.walkPick?.key === startKey)
  const onPlaceRef = useRef(onPlace)
  onPlaceRef.current = onPlace
  const pickStart = () => getEditor().getState().setWalkPick(pickingStart ? null : { key: startKey, from: spec.to, label: '도착점까지', apply: to => onPlaceRef.current?.({ x: to[0], y: to[1] }) })
  const offStart = disabled || !place
  useEffect(() => { if (offStart && pickingStart) getEditor().getState().setWalkPick(null) }, [offStart, pickingStart])
  useEffect(() => () => { const s = getEditor().getState(); if (s.walkPick?.key === pickKey || s.walkPick?.key === startKey) s.setWalkPick(null) }, [pickKey, startKey]) // panel closed
  return (
    <div className="wk">
      {place ? <div className="insp-field"><span className="insp-lab">출발 위치 (무대 기준)
        <button type="button" className="wk-pick" aria-pressed={pickingStart} disabled={offStart} onClick={pickStart}
          title="무대 바닥을 클릭해 로봇이 서 있다가 출발할 위치를 정합니다 — 로봇 배치가 바뀝니다 (Esc · 우클릭: 취소)">{pickingStart ? '찍는 중… (Esc 취소)' : '무대에서 찍기'}</button></span>
        <TargetXY lab="출발" to={[place.x, place.y]} disabled={disabled} chg={chg('start')} onCommit={([x, y]) => onPlace?.({ x, y })} />
        <label className="insp-field"><span className="insp-lab">출발 방향 <span>로봇이 처음 보는 방향</span></span>
          <Num label="출발 방향" value={place.yaw * 180 / Math.PI} unit="°" step={5} disabled={disabled} chg={chg('startYaw')} onCommit={v => onPlace?.({ yaw: v! * Math.PI / 180 })} /></label>
        <span className="wk-dim" role="note">트랙의 첫 조각이라 로봇 배치에서 출발합니다 (바꾸면 로봇 배치가 바뀜)</span>
      </div> : place === null && <div className="insp-field"><span className="insp-lab">출발 위치</span>
        <span className="wk-dim" role="note">앞 조각이 끝나는 자리 · 자세에서 출발합니다</span></div>}
      <div className="insp-field"><span className="insp-lab">도착 위치 (무대 기준)
        <button type="button" className="wk-pick" aria-pressed={picking} disabled={off} onClick={pick}
          title="무대 바닥을 클릭해 도착 위치를 정합니다 (Esc · 우클릭: 취소)">{picking ? '찍는 중… (Esc 취소)' : '무대에서 찍기'}</button></span>
        <TargetXY to={spec.to} disabled={disabled} chg={chg('to')} onCommit={to => onSpec({ to })} />
        {start && <span className="wk-dim" role="note">{describeTo(start, spec.to)}</span>}
      </div>
      <div className="insp-field"><span className="insp-lab">방향</span>
        <div className={chg('face') ? 'wk-seg wk-chg' : 'wk-seg'} role="group" aria-label="방향">
          {FACES.map(([f, lab]) => <button key={f} type="button" aria-pressed={spec.face === f} disabled={disabled} className={spec.face === f ? 'on' : ''}
            onClick={() => onSpec({ face: f })}>{lab}</button>)}
        </div>
        {spec.face === 'travel' && <label className="insp-field"><span className="insp-lab">도착 방향 <span>비우면 걸어온 방향</span></span>
          <Num label="도착 방향" value={spec.yaw === undefined ? undefined : spec.yaw * 180 / Math.PI} unit="°" step={5} optional placeholder="진행 방향" disabled={disabled} chg={chg('yaw')}
            onCommit={v => onSpec({ yaw: v === undefined ? undefined : v * Math.PI / 180 })} /></label>}
      </div>
      <div className="insp-field"><span className="insp-lab">시간 / 속도</span>
        <div className="wk-row">
          <Num label="시간" value={secs} unit="초" step={0.1} disabled={disabled} chg={chg('time')} onCommit={v => onFrames(Math.round(v! * 60))} />
          <span className="wk-dim" aria-hidden="true">⇄</span>
          <Num label="속도" value={speed} unit="m/s" step={0.05} disabled={disabled || dist < 0.01} onCommit={v => { if (v! > 0) onFrames(Math.round(dist / v! * 60)) }} />
        </div>
      </div>
      <label className="insp-field"><span className="insp-lab">시간에 비해 거리가 짧을 때</span>
        <select aria-label="시간에 비해 거리가 짧을 때" className={chg('slow') ? 'wk-chg' : undefined} value={spec.slow ?? 'walk'} disabled={disabled} onChange={e => onSpec({ slow: e.target.value as WalkSlow })}>
          {SLOWS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
        </select>
      </label>
      {report && <WalkState report={report} headline={headline}>{fix}</WalkState>}
    </div>
  )
}

/** §29: what is wrong with a 한계 초과 walk in one sentence — who, from where to where, in what time, and what would do. */
export function walkWhy(report: WalkReport, start: [number, number] | null, to: [number, number], frames: number, minFrames: number | null): string {
  if (report.tone !== 'bad') return ''
  if (report.startBad) return '출발 자세 때문에 이 걷기를 출발할 수 없습니다 (앞 조각이 서 있지 않은 자세로 끝남) — 기본서기 경유가 필요합니다'
  const xy = (p: [number, number]) => `(${p[0].toFixed(2)}, ${p[1].toFixed(2)})`
  const d = start ? Math.hypot(to[0] - start[0], to[1] - start[1]) : report.dist
  const what = `${start ? `출발 위치 ${xy(start)}에서 ` : ''}도착 위치 ${xy(to)}까지 ${d.toFixed(2)} m를 ${sec(frames)}초 안에 걸어갈 수 없습니다`
  return minFrames && minFrames > frames ? `${what} — 이 거리는 최소 ${sec(minFrames)}초가 필요합니다` : `${what} — 시간을 늘려도 만들 수 없습니다 (자세한 이유를 보세요)`
}
/** The same for a walk another edit would break (its report's own distance and time). */
export const laterWhy = (who: string, r: WalkReport, minFrames?: number) =>
  `${who}가 ${r.dist.toFixed(2)} m를 ${r.secs.toFixed(1)}초 안에 걸어갈 수 없게 됩니다${minFrames ? ` — 최소 ${sec(minFrames)}초가 필요합니다` : ' — 시간을 늘려도 고칠 수 없습니다'}`

export function WalkState({ report, children, headline }: { report: WalkReport; children?: ReactNode; headline?: string }) {
  const bad = report.reasons.filter(r => r.tone === 'bad'), rest = report.reasons.filter(r => r.tone !== 'bad')
  return (
    <div className="wk-state" role="status">
      <div><span className={`wk-tone ${report.tone}`}>● {TONE[report.tone]}</span>{' '}
        <span className="wk-dim">평균 {report.speed.toFixed(2)} m/s · {report.halfSteps}걸음 · 한 걸음 {(report.stride * 100).toFixed(0)} cm · 관절 속도 {report.vel.toFixed(2)}배</span></div>
      {headline && <div className="wk-why bad wk-head">{headline}</div>}
      {headline && bad.length > 0 ? <details className="wk-more"><summary>자세한 이유 ({bad.length})</summary>{bad.map((r, i) => <div key={i} className="wk-why bad">{r.text}</div>)}</details>
        : bad.map((r, i) => <div key={i} className="wk-why bad">{r.text}</div>)}
      {rest.map((r, i) => <div key={i} className={`wk-why ${r.tone}`}>{r.text}</div>)}
      {report.slowFix && <div className="wk-dim">→ {report.slowFix}</div>}
      {report.held ? <div className="wk-why bad">자세가 무너지지 않게 걷지 않고 출발 자세로 서 있습니다 · 고치기 전에는 내보내지 않습니다</div>
        : report.tone === 'bad' && <div className="wk-dim">한계 초과 — 이대로는 만들지 않습니다 (시간은 자동으로 늘리지 않음)</div>}
      {children && <div className="wk-fix">{children}</div>}
    </div>
  )
}

type Patch = Partial<WalkSpec> & { frames?: number }

/** Inspector: the selected 걷기 piece, 고치는 중 방식 (§29 · §30, 사용자: 고치는 도중에 막히지 않게 · 확정 전에는 검사하지 않게): what
 * is changed in the boxes, by 찍기 or by the rings on the stage is kept as a draft (the store's walkDraft: 출발 위치 = the robot's 배치,
 * 도착, 방향, 시간). While it is a draft nothing is checked — the 바꿀 예정 box lists what would change (원래 값 → 새 값), the changed
 * boxes are marked and the stage names the planned spots. 적용 checks it once (§22 — a 한계 초과 walk is never made) and applies all
 * of it in one undo; 한계 초과 → not applied, the draft stays, the reason in one sentence with 최소 시간으로 하고 적용 (this walk and the
 * walks it would break, §23) — gone again at the next change. 취소 drops the draft; so does picking another piece. */
export function WalkInspector({ item }: { item: Item }) {
  const project = useEditor(s => s.project), defs = useEditor(s => s.defs)
  const dr = useEditor(s => s.walkDraft?.itemId === item.id ? s.walkDraft : null)
  const track = project.sequence.tracks.find(t => t.items.some(i => i.id === item.id)), actor = project.actors.find(a => a.id === track?.actorId)
  const w = walkOf(project, defs, item)
  const [msg, setMsg] = useState('')
  const [checked, setChecked] = useState<{ plan: WalkPlan | null } | null>(null) // 적용 pressed on a draft that did not pass: what the check said
  useEffect(() => () => getEditor().getState().clearWalkDraft(item.id), [item.id]) // another piece shown: the draft goes
  if (!w || !actor) return null
  const locked = trackLocked(project, actor.id), act = getEditor().getState(), len = item.trimOut - item.trimIn
  const first = !!track && sortedItems(track)[0]?.id === item.id
  // what the boxes show: the piece's values with the draft's on top
  const { frames: dFrames, ...dSpec } = dr?.patch ?? {}
  const spec: WalkSpec = { ...item.walk!, ...dSpec }, frames = dFrames ?? len, place = { ...actor.placement, ...dr?.place }
  const start0 = applyXf(w.start, actor.placement), start = applyXf(w.start, place) // (a first walk starts at the 배치: the draft's)
  const dist0 = Math.hypot(item.walk!.to[0] - start0.rootPos[0], item.walk!.to[1] - start0.rootPos[1])
  const dist = Math.hypot(spec.to[0] - start.rootPos[0], spec.to[1] - start.rootPos[1])
  const plan = dr ? checked?.plan ?? null : null, refused = !!dr && !!checked
  const report: WalkReport | null = dr ? (plan ? { ...plan.report, held: undefined } : null) : w.report // a draft: no verdict until 적용
  const hasAfter = !!track && track.items.some(i => i.start > item.start) // (nothing after it: nothing moves)
  const moved = (d: number) => d && hasAfter ? ` · 뒤 조각이 ${sec(Math.abs(d))}초 ${d > 0 ? '밀렸습니다' : '당겨졌습니다'}` : ''
  const shift = (fix: WalkFix[]) => (fix.find(x => x.itemId === item.id)?.frames ?? frames) - len + fix.filter(x => x.itemId !== item.id).reduce((t, x) => t + x.d, 0)
  const later = track ? sortedItems(track).filter(i => i.walk && i.id !== item.id).map(i => i.id) : []
  const name = (id: string) => { const k = later.indexOf(id), n = track ? sortedItems(track).filter(i => i.walk && i.start > item.start).findIndex(i => i.id === id) : -1
    return id === item.id ? '이 걷기' : n === 0 ? '다음 걷기' : n > 0 ? `${n + 1}번째 뒤 걷기` : `다른 걷기 ${k + 1}` }
  const edit = (patch?: Patch, pl?: Partial<Actor['placement']>) => { setChecked(null); setMsg(''); act.patchWalkDraft(item.id, patch, pl) }
  const blocked = plan?.blocked ?? []
  const apply = (fix: WalkFix[] = []) => {
    if (!dr) return
    if (act.setWalk(item.id, dr.patch, fix, dr.place)) {
      act.clearWalkDraft(item.id); setChecked(null)
      setMsg(`적용했습니다${Object.keys(dr.place).length ? ' (출발 위치 = 로봇 배치)' : ''}${moved(shift(fix))}`)
      return
    }
    const pv = act.previewWalk(item.id, dr.patch, dr.place) // the check, now: why it was not applied
    setChecked({ plan: pv })
    setMsg(pv?.blocked.length ? '' : !pv ? '적용할 수 없는 값입니다 (시간이 너무 짧거나 길거나, 다른 조각과 겹침)' : locked ? '잠긴 트랙입니다' : '적용할 수 없습니다')
  }
  const cancel = () => { act.clearWalkDraft(item.id); setChecked(null); setMsg('') }
  // 바꿀 예정 (§30): what the draft would change, 원래 값 → 새 값 (no verdict)
  const xy = (x: number, y: number) => `(${x.toFixed(2)}, ${y.toFixed(2)})`, dg = (r: number) => `${+(r * 180 / Math.PI).toFixed(1)}°`
  const FACE = Object.fromEntries(FACES), SLOW = Object.fromEntries(SLOWS), pl0 = actor.placement, w0 = item.walk!
  const rows: [Changed | 'dist', string, string, string][] = []
  if (dr) {
    if (dr.place.x !== undefined || dr.place.y !== undefined) rows.push(['start', '출발 위치', xy(pl0.x, pl0.y), xy(place.x, place.y)])
    if (dr.place.yaw !== undefined) rows.push(['startYaw', '출발 방향', dg(pl0.yaw), dg(place.yaw)])
    if (dr.patch.to) rows.push(['to', '도착 위치', xy(w0.to[0], w0.to[1]), xy(spec.to[0], spec.to[1])])
    if (dr.patch.face) rows.push(['face', '방향', FACE[w0.face], FACE[spec.face]])
    if ('yaw' in dr.patch) rows.push(['yaw', '도착 방향', w0.yaw === undefined ? '진행 방향' : dg(w0.yaw), spec.yaw === undefined ? '진행 방향' : dg(spec.yaw)])
    if (dr.patch.frames !== undefined) rows.push(['time', '시간', `${sec(len)}초`, `${sec(frames)}초`])
    if (dr.patch.slow) rows.push(['slow', '느릴 때', SLOW[w0.slow ?? 'walk'], SLOW[spec.slow ?? 'walk']])
    if (Math.abs(dist - dist0) >= 0.005) rows.push(['dist', '거리', `${dist0.toFixed(2)} m`, `${dist.toFixed(2)} m`])
  }
  // 한계 초과: what is wrong, in one sentence — this walk (after 적용 on a draft, or as it is now), then the walks the draft would break
  const own = blocked.find(b => b.itemId === item.id), ownMin = plan ? plan.fix?.find(x => x.itemId === item.id)?.frames ?? plan.minFrames : null
  const now = !dr && w.report.tone === 'bad' && !locked ? act.previewWalk(item.id, {}) : null // held (another change, or a file opened)
  const headline = report?.tone === 'bad' ? walkWhy(report, [start.rootPos[0], start.rootPos[1]], spec.to, frames, dr ? ownMin : now?.minFrames ?? null) : undefined
  const others = blocked.filter(b => b.itemId !== item.id)
  const fixText = (fix: WalkFix[], andApply: boolean) => {
    const d = shift(fix), only = fix.length === 1 && fix[0].itemId === item.id, how = andApply ? ' 하고 적용' : ''
    return `${only ? `최소 시간 ${sec(fix[0].frames)}초로${how}` : `최소 시간으로${how} — ${fix.map(x => `${name(x.itemId)} ${sec(x.frames)}초`).join(' · ')}`}${d && hasAfter ? ` — 뒤 조각 ${sec(Math.abs(d))}초 ${d > 0 ? '밀림' : '당겨짐'}` : ''}`
  }
  const draftFix = dr && plan?.fix?.length ? <button onClick={() => apply(plan.fix!)} title="한계 안에 드는 가장 짧은 시간으로 하고 지금 값을 적용합니다 (0.1초 단위, 실행취소 한 번)">{fixText(plan.fix, true)}</button> : null
  const nowFix = now?.fix?.length ? <button onClick={() => { if (act.setWalk(item.id, {}, now.fix!)) setMsg(`최소 시간으로 바꿨습니다${moved(shift(now.fix!))}`) }}
    title="한계 안에 드는 가장 짧은 시간으로 바꿉니다 (0.1초 단위, 실행취소 한 번)">{fixText(now.fix, false)}</button> : null
  const stand = report?.startBad && !locked && !dr ? bridgeFor(project, defs, item.id, 'stand') : null
  const standBtn = stand && 'clip' in stand ? <button onClick={() => { if (act.insertBridge(item.id, stand.clip)) setMsg(`기본서기 경유 ${sec(stand.clip.length)}초를 넣었습니다${moved(stand.clip.length)}`) }}
    title="앞 조각 끝 자세에서 기본서기로 서는 전이 조각을 이 걷기 앞에 넣습니다 (시간이 늘어남, 실행취소 한 번)">기본서기 경유 넣기 — 뒤 조각 {sec(stand.clip.length)}초 밀림</button> : null
  return (
    <section className="insp-sec">
      <h3 className="insp-sec-t">걷기 조각{dr && <span className="wk-draft-tag">고치는 중 · 적용 전</span>}</h3>
      <WalkFields pickKey={item.id} spec={spec} frames={frames} start={start} dist={dist} report={dr ? null : report} disabled={locked} headline={headline}
        fix={!dr && report?.tone === 'bad' && (nowFix || standBtn) ? <>{nowFix}{standBtn}</> : null}
        changed={rows.flatMap(r => r[0] === 'dist' ? [] : [r[0]])}
        onSpec={patch => edit(patch)} onFrames={n => { if (n >= 2) edit({ frames: n }) }}
        place={first ? place : null} onPlace={pl => edit(undefined, pl)} />
      {dr && <div className="wk-plan" role="status" aria-label="바꿀 예정">
        <div className="wk-plan-t">바꿀 예정 (적용 전)</div>
        {rows.map(([k, lab, a, b]) => <div key={k} className="wk-plan-row"><span>{lab}</span><span><span className="wk-old">{a}</span><span className="wk-arrow" aria-hidden="true">→</span><span className="wk-new">{b}</span></span></div>)}
        <div className="wk-dim">적용을 누르면 검사하고 바꿉니다 · 취소하면 원래 값으로 돌아갑니다</div>
      </div>}
      {refused && <div className="wk-refused" role="alert">
        <b>적용하지 않았습니다{blocked.length ? ` — ${own ? '이 걷기가 한계 초과입니다' : '다른 걷기가 한계 초과가 됩니다'}` : ''} (값은 그대로 두었습니다)</b>
        {report && own && <WalkState report={report} headline={headline}>{draftFix}</WalkState>}
        {others.length > 0 && <div className="wk-state" role="group" aria-label="다른 걷기">
          <b className="wk-why bad wk-head">이 값을 적용하면 다른 걷기가 한계 초과가 됩니다</b>
          {others.map(b => <div key={b.itemId}>
            <div className="wk-why bad">{laterWhy(name(b.itemId), b.report, plan?.fix?.find(x => x.itemId === b.itemId)?.frames)}</div>
            <details className="wk-more"><summary>자세한 이유 ({b.report.reasons.filter(r => r.tone === 'bad').length})</summary>
              {b.report.reasons.filter(r => r.tone === 'bad').map((r, i) => <div key={i} className="wk-why bad">{r.text}</div>)}</details>
          </div>)}
          {!own && draftFix && <div className="wk-fix">{draftFix}</div>}
        </div>}
        {!blocked.length && <div className="wk-why warn">{msg || '적용할 수 없는 값입니다'}</div>}
        <div className="wk-dim">값을 고치면 이 안내는 사라집니다</div>
      </div>}
      {dr && <div className="pp-tools ov-btns wk-apply">
        <button onClick={cancel} title="고치던 값을 버리고 조각의 원래 값으로 되돌립니다">취소</button>
        <button disabled={locked} onClick={() => apply()} title="지금 값을 검사하고 조각에 적용합니다 (출발 위치 · 도착 위치 · 시간 한 번에, 실행취소 한 번) — 한계 초과면 적용하지 않습니다">적용</button>
      </div>}
      <ul className="wk-notes">
        <li>값을 바꾸거나 무대에서 찍어도 바로 바뀌지 않음 — 적용을 눌러야 검사하고 조각이 바뀜 (다른 조각을 고르면 고치던 값은 버림)</li>
        <li>첫 걸음: 앞 조각 끝의 발 위치에서 출발 (트랙의 첫 조각이면 로봇 배치 = 출발 위치)</li>
        <li>마지막 걸음: 다음 조각 첫 자세의 발 위치에 딛음 (없거나 서 있지 않으면 기본서기)</li>
        <li>앞 조각이 바뀌어도 도착점은 그대로 — 뒤 조각 위치 유지</li>
        <li>걷기는 순수 이동 — 관절 수정·자르기 없음 (길이는 막대 끝을 끌어서)</li>
        <li>한계를 넘는 걷기는 만들지 않음 — 시간은 버튼을 눌렀을 때만 늘어남</li>
      </ul>
      {locked && <p className="insp-hint" role="status">잠긴 트랙입니다</p>}
      {msg && !refused && <p className="insp-hint" role="status">{msg}</p>}
    </section>
  )
}

/** 라이브러리 › 걷기 (가상): a new 걷기 piece at the end of `actorId`'s track (null = a new GO2 robot). */
export function WalkAddPanel({ actorId, onAdded }: { actorId: string | null; onAdded: (actorId: string, text: string) => void }) {
  const project = useEditor(s => s.project), defs = useEditor(s => s.defs)
  const locked = !!actorId && trackLocked(project, actorId)
  const [spec, setSpec] = useState<WalkSpec | null>(null), [frames, setFrames] = useState(WALK_DEFAULT_FRAMES)
  // 출발 위치 (§27): a new robot, or one with no piece yet, stands where it is put (its 배치, set with the walk in one undo)
  const actor = actorId ? project.actors.find(a => a.id === actorId) : null
  const empty = !actorId || !project.sequence.tracks.find(t => t.kind === 'motion' && t.actorId === actorId)?.items.length
  const [placeFor, setPlaceFor] = useState<{ key: string; pl: Actor['placement'] } | null>(null)
  const place = !empty ? undefined : placeFor?.key === (actorId ?? 'new') ? placeFor.pl : (actor?.placement ?? { x: newActorX(project), y: 0, yaw: 0 })
  const setPlace = (pl: Partial<Actor['placement']>) => { const v = { ...place!, ...pl }; if ([v.x, v.y, v.yaw].every(Number.isFinite)) setPlaceFor({ key: actorId ?? 'new', pl: v }) }
  // 붙일 자리 (§28): the track end, or right after a piece in the middle (the store's walkAfter — the timeline outlines it)
  const track = actorId ? project.sequence.tracks.find(t => t.kind === 'motion' && t.actorId === actorId) : undefined
  const order = track ? sortedItems(track) : [], last = order.at(-1)
  const wa = useEditor(s => s.walkAfter)
  const afterIt = wa && wa.actorId === actorId ? order.slice(0, -1).find(i => i.id === wa.itemId) : undefined // the last piece = the track end
  const after = afterIt?.id
  const prev = afterIt ?? last // the piece it starts after
  // the preview: the same edit on a copy when it goes in the middle (its end pose is the next piece's), else the track-end preview
  const preview = (sp: WalkSpec, via: boolean, bridge?: Clip): AddWalkPlan | null => after
    ? getEditor().getState().previewAddWalk(actorId, sp, frames, bridge, { after })
    : (r => r && { ...r, blocked: [], fix: [], shift: 0 })(walkPreview(project, defs, actorId, sp, frames, via, place))
  // until something is typed: 1 m ahead of where the robot will be
  const base = preview({ to: [0, 0], face: 'keep' }, false)
  if (!base) return null
  const h = Math.atan2(2 * (base.start.rootQuat[3] * base.start.rootQuat[2] + base.start.rootQuat[0] * base.start.rootQuat[1]), 1 - 2 * (base.start.rootQuat[1] ** 2 + base.start.rootQuat[2] ** 2))
  const cur: WalkSpec = spec ?? { to: [+(base.start.rootPos[0] + Math.cos(h)).toFixed(2), +(base.start.rootPos[1] + Math.sin(h)).toFixed(2)], face: 'keep' }
  // the piece before ends in a pose it cannot walk off from (앉기 …): 기본서기 경유 goes in first — only with the button that says so (§22)
  const pv0 = preview(cur, false)!
  const via = !!pv0.report.startBad && !!prev
  const bridge = via ? standBridgeAfter(project, defs, prev!) : null, bridgeClip = bridge && 'clip' in bridge ? bridge.clip : null
  const pv = via ? (after ? (bridgeClip && preview(cur, true, bridgeClip)) || pv0 : preview(cur, true)!) : pv0
  const later = pv.blocked.length > 0 // a walk after it would be 한계 초과 (its start moves to this walk's target)
  const bad = pv.report.tone === 'bad' || (via && !bridgeClip) || later
  const dist = Math.hypot(cur.to[0] - pv.start.rootPos[0], cur.to[1] - pv.start.rootPos[1])
  const walkName = (id: string) => { const k = order.filter(i => i.walk && i.start > (prev?.start ?? -1)).findIndex(i => i.id === id); return k === 0 ? '다음 걷기' : `${k + 1}번째 뒤 걷기` }
  const add = (fix?: WalkFix[]) => {
    if (bad && !fix) return
    const st = getEditor().getState(), id = st.addWalk(actorId, cur, frames, bridgeClip ?? undefined, { place, after, fix })
    if (!id) return
    setPlaceFor(null) // (the next new robot gets its own default spot)
    const a = getEditor().getState().project.sequence.tracks.find(t => t.items.some(i => i.id === id))?.actorId
    const moved = pv.shift + (fix ?? []).reduce((t, x) => t + x.d, 0)
    if (a) onAdded(a, `걷기를 추가했습니다 (${dist.toFixed(2)} m · ${(frames / 60).toFixed(1)}초${bridgeClip ? ` · 앞에 기본서기 경유 ${sec(bridgeClip.length)}초` : ''}${moved ? ` · 뒤 조각 ${sec(moved)}초 밀림` : ''})`)
    if (after) getEditor().getState().setWalkAfter({ actorId: a!, itemId: id }) // a next walk goes after this one
  }
  const pieceName = (it: Item) => it.walk ? '걷기' : project.clips[it.refId]?.name ?? '조각'
  const span = (it: Item) => `${sec(it.start)}–${sec(it.start + it.trimOut - it.trimIn)}초`
  return (
    <>
      <h3 className="pp-blk-t">걷기 (가상)</h3>
      {actorId && order.length > 1 && <label className="pp-blk-field"><span>붙일 자리</span>
        <select aria-label="붙일 자리" value={after ?? 'end'} disabled={locked}
          onChange={e => getEditor().getState().setWalkAfter(e.target.value === 'end' ? null : { actorId, itemId: e.target.value })}>
          <option value="end">트랙 끝 (마지막 조각 뒤)</option>
          {order.slice(0, -1).map((it, k) => <option key={it.id} value={it.id}>{k + 1}번째 조각 뒤 — {pieceName(it)} ({span(it)})</option>)}
        </select>
      </label>}
      <WalkFields pickKey="add" spec={cur} frames={frames} start={pv.start} dist={dist} report={pv.report} disabled={locked}
        headline={pv.report.tone === 'bad' ? walkWhy(pv.report, [pv.start.rootPos[0], pv.start.rootPos[1]], cur.to, frames, pv.minFrames) : undefined}
        fix={pv.report.tone === 'bad' && pv.minFrames ? <button onClick={() => setFrames(pv.minFrames!)} title="한계 안에 드는 가장 짧은 시간 (0.1초 단위)">최소 시간 {sec(pv.minFrames)}초로</button> : null}
        onSpec={patch => setSpec(s => ({ ...(s ?? cur), ...patch }))} onFrames={n => { if (n >= 2) setFrames(n) }}
        place={place ?? null} onPlace={setPlace} />
      {via && <p className="pp-dim pp-why wk-via" role="note">{bridgeClip ? `앞 조각이 서 있지 않은 자세로 끝납니다 → 기본서기 경유 ${sec(bridgeClip.length)}초를 먼저 넣고 걷기를 붙입니다 (시간이 늘어남)`
        : '앞 조각이 서 있지 않은 자세로 끝나고, 기본서기 경유도 만들 수 없어 걷기를 붙일 수 없습니다'}</p>}
      {later && <div className="wk-refused" role="alert">
        <b>이 자리에 넣으면 뒤 걷기가 한계 초과가 됩니다 — 그 걷기의 출발점이 이 걷기의 도착점으로 바뀜</b>
        {pv.blocked.map(b => <div key={b.itemId}><div className="wk-who">{walkName(b.itemId)}</div>
          {b.report.reasons.filter(r => r.tone === 'bad').map((r, i) => <div key={i} className="wk-why bad">{r.text}</div>)}</div>)}
        {pv.report.tone !== 'bad' && pv.fix?.length ? <div className="wk-fix"><button onClick={() => add(pv.fix!)} title="뒤 걷기를 한계 안에 드는 가장 짧은 시간으로 늘리고 추가합니다 (0.1초 단위, 실행취소 한 번)">
          뒤 걷기 최소 시간으로 하고 추가 — {pv.fix.map(x => `${walkName(x.itemId)} ${sec(x.frames)}초`).join(' · ')}</button></div>
          : <div className="wk-dim">{pv.report.tone === 'bad' ? '이 걷기부터 고치세요' : '뒤 걷기 시간을 늘려서는 고칠 수 없습니다'}</div>}
      </div>}
      <p className="pp-dim pp-why">{after ? `${order.indexOf(afterIt!) + 1}번째 조각 뒤에 넣습니다 — 그 조각이 끝나는 자리 · 자세에서 출발하고, 뒤 조각은 그만큼 늦게 시작합니다` : `트랙 끝에 붙습니다${place ? ' (첫 조각: 출발 위치에 로봇을 두고 시작)' : ''}`}. 걸음은 계산으로 만들고(트로트), 다음에 붙는 조각의 첫 자세로 끝납니다. 한계를 넘는 걷기는 만들지 않습니다.</p>
      <div className="pp-tools"><span className="pp-gap" /><button disabled={locked || bad} onClick={() => add()}
        title={bad ? '한계 초과라 추가할 수 없습니다 — 위의 이유와 해결 버튼을 보세요' : undefined}>{bridgeClip ? '기본서기 경유 넣고 추가' : '추가'}{pv.shift ? ` — 뒤 조각 ${sec(pv.shift)}초 밀림` : ''}</button></div>
    </>
  )
}
