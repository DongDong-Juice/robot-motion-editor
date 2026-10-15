import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { pieceName } from '../model/sequence'
import { offsetKeyCount, withUse } from '../model/itemClip'
import { getEditor, useEditor } from '../store/store'
import type { Item, Project } from '../model/types'
import { itemLead, itemTail, type Lead } from '../model/restPose'
import { INERTIA_WHY } from '../model/inertia'
import Stage from './Stage'
import { videoTrack } from '../model/video'
import VideoOverlay from './VideoOverlay'
import { clampRatio, dockSide, equalRatios, moveDivider, paneRects, ROW_MIN, rowWidths, type Side } from './paneLayout'

interface Prefs { videoSide: Side; ratio: number }
const KEY = 'motion-editor.preview'
const SIDES: Side[] = ['left', 'right', 'top', 'bottom']
const OPPOSITE: Record<Side, Side> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }
const STEP = 0.02
const SEP = 6 // .pane-sep width, px
const TITLE = 24 // .pane-title height, px

// "<clip name> (<G1|GO2>)" of a compare pane
const useCompareLabel = (id: string) => useEditor(s => {
  const c = s.project.clips[id]
  return c ? `${c.name} (${c.robot.toUpperCase()})` : ''
})
function CompareTitle({ id }: { id: string }) {
  return (
    <div className="pane-title static">
      <span>비교 프리뷰 · {useCompareLabel(id)}</span>
      <button aria-label="비교 닫기" onClick={() => getEditor().getState().closeComparePane(id)}>✕</button>
    </div>
  )
}

const findItem = (p: Project, id: string) => {
  for (const t of p.sequence.tracks) { const it = t.items.find(i => i.id === id); if (it) return { t, it } }
  return null
}
// Hover help for the 기본자세 buttons (shown as the native tooltip).
const REST_TIP = {
  prepend: '조각 앞에 기본자세(차렷)에서 시작하는 리드인을 추가합니다.\n원래 모션은 그대로 두고 CSV가 리드인만큼 길어집니다.\n기본자세(차렷으로 정지, 기본 0.5초) → 전이(기본 1초) → 관성(자른 위치 앞 원본, 자동 판정) 순서이고, 켠 뒤 아래 설정 줄에서 조각마다 바꿀 수 있습니다.\n클립 프리뷰와 이 조각의 CSV에만 적용되고, 메인 타임라인은 원본 그대로입니다.',
  overwrite: '조각의 앞 1.5초를 기본자세(차렷)로 바꿉니다.\nCSV 길이는 그대로지만 원래 모션의 앞 1.5초가 사라집니다.\n0.5초 서 있다가 1초 동안 모션으로 넘어갑니다.\n클립 프리뷰와 이 조각의 CSV에만 적용되고, 메인 타임라인은 원본 그대로입니다.',
  off: '이 조각의 기본자세를 끕니다. CSV는 원래 모션 그대로 내보냅니다.',
}

// Clip preview: one item's [trimIn, trimOut) (plus the 기본자세 lead-in), following the main playhead from the item start; 기본자세 flags the item to start from the standing pose here and in its CSV export only.
function ItemPreview({ id }: { id: string }) {
  const item = useEditor(s => findItem(s.project, id)?.it ?? null)
  const label = useEditor(s => {
    const f = findItem(s.project, id)
    return f ? pieceName(f.t, f.it, s.project.clips[f.it.refId]?.name ?? '') : ''
  })
  const actorId = useEditor(s => findItem(s.project, id)?.t.actorId ?? null)
  const actor = useEditor(s => s.project.actors.find(a => a.id === actorId) ?? null)
  const selected = useEditor(s => s.selItem === id)
  const pick = () => { const s = getEditor().getState(); s.selectItem(id); if (actorId) s.select(actorId) } // inspector follows the preview
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const leadNow = () => { const t = getEditor().getState(), f = findItem(t.project, id); return f ? itemLead(t.project, t.defs, f.it)?.lead ?? 0 : 0 } // after the change
  const rest = (mode: Item['restPose'] | null) => {
    const s = getEditor().getState(), ok = s.setRestPose(id, mode)
    setMsg(!ok ? (findItem(s.project, id)?.t.locked ? '잠긴 트랙입니다' : '기본자세를 바꿀 수 없습니다')
      : mode === 'prepend' ? `기본자세 덧붙이기를 켰습니다 (앞에 ${sec(leadNow())}초 추가 · 프리뷰·내보내기에만 적용)`
      : mode ? '기본자세 덮어쓰기를 켰습니다 (앞 1.5초를 바꿈 · 프리뷰·내보내기에만 적용)' : '기본자세를 껐습니다')
    clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(null), 3000)
  }
  const say = (text: string) => { setMsg(text); clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(null), 3000) }
  const restTail = (on: boolean) => {
    const s = getEditor().getState(), ok = s.setRestTail(id, on)
    setMsg(!ok ? (findItem(s.project, id)?.t.locked ? '잠긴 트랙입니다' : '끝 기본자세를 바꿀 수 없습니다')
      : on ? '끝 기본자세를 켰습니다 (끝에 전이 + 0.5초 · 프리뷰·내보내기에만 적용)' : '끝 기본자세를 껐습니다')
    clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(null), 3000)
  }
  const project = useEditor(s => s.project), defs = useEditor(s => s.defs)
  const edit = useEditor(s => s.previewEdit), overlayOn = useEditor(s => s.compareOverlay)
  if (!item) return null
  const hasEdit = offsetKeyCount(item) > 0
  // 수정본 창: the piece as clip + 수정 층 whichever side it uses, so its range and lead-in come from that 수정본
  const shown = edit ? findItem(withUse(project, id, null), id)!.it : item
  const ld = itemLead(edit ? withUse(project, id, null) : project, defs, shown)
  const tail = itemTail(edit ? withUse(project, id, null) : project, defs, shown)?.tail ?? 0 // 끝 기본자세 frames after trimOut
  const range: [number, number] = ld ? [item.trimIn - ld.inertia, item.trimOut + ld.hold + ld.blend + tail] : [item.trimIn, item.trimOut + tail]
  const s = () => getEditor().getState()
  // 기본자세 settings belong to the piece: the same buttons on the clip preview and the 수정본 (each plays its own side)
  const restButtons = <>
    {item.restPose === true
      ? <button className="pv-btn" onClick={() => rest(null)} title={REST_TIP.off}>기본자세 해제</button>
      : <button className="pv-btn" onClick={() => rest(true)} title={REST_TIP.overwrite}>기본자세 덮어쓰기</button>}
    <button className="pv-btn" aria-pressed={!!item.restTail} onClick={() => restTail(!item.restTail)}
      title="조각 끝에 전이 후 기본자세 0.5초를 덧붙입니다 (자르면 자동으로 켜짐 · 프리뷰·내보내기에만 적용)">끝 기본자세</button>
  </>
  return (
    <>
      <div className="pane-title static">
        <button className={selected ? 'pv-title sel' : 'pv-title'} onClick={pick} title="타임라인에서 이 조각을 선택합니다 (오른쪽 패널도 이 로봇으로 바뀜)">
          {edit ? '수정본' : '클립 프리뷰'} · {actor && <span className="pv-sw" style={{ background: actor.color }} aria-hidden="true" />}<b>{actor?.name ?? ''}</b> / {label}
        </button>
        <button aria-label={edit ? '수정본 닫기' : '클립 프리뷰 닫기'} onClick={() => s().closeItemPreview()}>✕</button>
      </div>
      <div className="stage-3d">
        {edit
          ? <Stage compareClipId={item.refId} range={range} itemId={id} edited>
              {restButtons}
              <button className="pv-btn" aria-pressed={overlayOn} onClick={() => s().setCompareOverlay(!overlayOn)}
                title="메인 로봇 프리뷰에 수정본을 반투명으로 겹쳐 그립니다">겹쳐 보기</button>
              <button className="pv-btn" onClick={() => s().openItemPreview(id)} title="수정 비교를 끝내고 이 조각의 클립 프리뷰로 돌아갑니다">클립 프리뷰로</button>
              <button className="pv-btn" onClick={() => { if (s().bakeEdit(id)) { s().openItemPreview(id); say('수정본을 새 클립으로 만들었습니다 (목록에 추가 · 이 조각이 그 클립을 씀)') } else say('잠긴 트랙입니다') }}
                title="수정본을 새 클립으로 굳혀 목록에 넣고, 이 조각이 그 클립을 쓰게 합니다 (원본 클립은 그대로)">수정 완료</button>
            </Stage>
          : <Stage compareClipId={item.refId} range={range} itemId={id}>
              {restButtons}
              {item.noOriginal && <button className="pv-btn" onClick={() => say(s().bakeEdit(id) ? '수정본을 새 클립으로 만들었습니다 (목록에 추가 · 이 조각이 그 클립을 씀)' : '잠긴 트랙입니다')}
                title="수정본을 새 클립으로 굳혀 목록에 넣고, 이 조각이 그 클립을 쓰게 합니다 (원본 클립은 그대로)">수정 완료</button>}
              {hasEdit && !item.noOriginal && <button className="pv-btn" onClick={() => s().openEditCompare(id)}
                title="메인 로봇 프리뷰에 원본, 이 자리에 수정본을 나란히 보여 줍니다">수정 비교</button>}
            </Stage>}
        <LeadRow id={id} item={item} ld={ld ?? itemLead(edit ? withUse(project, id, null) : project, defs, { ...shown, restPose: 'prepend' })!} on={!!ld}
          toggle={() => rest(ld ? null : 'prepend')} />
        {msg && <div className="pv-msg" role="status">{msg}</div>}
      </div>
    </>
  )
}

// Main pane title while comparing: " · 원본 (<piece>)" — the main view draws that piece as its original.
function useMainSuffix() {
  return useEditor(s => {
    if (!s.previewEdit || !s.itemPreview) return ''
    const f = findItem(s.project, s.itemPreview)
    return f ? ` · 원본 (${pieceName(f.t, f.it, s.project.clips[f.it.refId]?.name ?? '')})` : ''
  })
}

const sec = (f: number) => (f / 60).toFixed(2)
const WHY_TIP = '관성 자동 판정: 자른 위치에서 최대 1.5초(없으면 3초) 거슬러 올라가, 두 발이 바닥을 딛고 서 있으면서 몸이 가장 덜 움직이는 지점부터 원본을 씁니다.'

// One lead-in length in seconds; commits on Enter / blur, Esc reverts.
function LeadField({ label, part, frames, set, auto, extra, off }: { label: string; part: 'hold' | 'blend' | 'inertia'; frames: number; set: (f: number) => boolean;
  auto?: { on: boolean; click: () => void }; extra?: ReactNode; off: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const v = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(v)) set(v * 60)
    setDraft(null)
  }
  return (
    <div className={`pv-lead-f ${part}`}>
      <span className="pv-lead-n">{label}</span>
      <span className="pv-lead-v"><input type="number" step={0.05} min={0} disabled={off} aria-label={`${label} (초)`} value={draft ?? sec(frames)}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setDraft(null) }} />초</span>
      {auto ? <button className="pv-btn" aria-label={`${label} 자동`} aria-pressed={auto.on} disabled={off} onClick={auto.click}>자동</button> : <span />}
      <button className="pv-btn pv-x" aria-label={`${label} 없애기`} title={`${label}을(를) 0초로 (없애기)`} disabled={off || frames === 0} onClick={() => set(0)}>✕</button>
      <span className="pv-lead-x">{extra}</span>
    </div>
  )
}

// 덧붙이기 lead-in settings of one piece: 기본자세 (차렷 정지) → 전이 → 관성 (spec 2026-10-14-inertia-lead-in-design.md). Always shown;
// the switch turns 덧붙이기 on, and the lengths are editable only while it is on (off: the values it would use, greyed).
function LeadRow({ id, item, ld, on, toggle }: { id: string; item: Item; ld: Lead; on: boolean; toggle: () => void }) {
  const set = (patch: { restHold?: number | null; restBlend?: number | 'auto' | null; inertia?: number | null }) =>
    getEditor().getState().setRestLead(id, patch)
  const review = ld.why === 'review' || ld.why === 'air'
  return (
    <div className={on ? 'pv-lead' : 'pv-lead off'} role="group" aria-label="리드인 설정">
      <button className="pv-switch" role="switch" aria-checked={on} onClick={toggle} title={on ? REST_TIP.off : REST_TIP.prepend}>
        <span className="pv-switch-t" aria-hidden="true" />기본자세 덧붙이기
      </button>
      <LeadField label="기본자세" part="hold" off={!on} frames={ld.hold} set={f => set({ restHold: f })}
        auto={{ on: item.restHold === undefined, click: () => set({ restHold: null }) }} />
      <LeadField label="전이" part="blend" off={!on} frames={ld.blend} set={f => set({ restBlend: f })}
        auto={{ on: item.restBlend === 'auto', click: () => set({ restBlend: item.restBlend === 'auto' ? null : 'auto' }) }}
        extra={ld.blendOver ? <span className="pv-chip warn" title="3초로도 관절 속도 한계의 50% 안에 들지 않습니다">⚠ 속도 한계 초과</span>
          : ld.blend === 0 ? <span className="pv-chip warn" title="차렷에서 모션 자세로 한 프레임에 바뀝니다. 내보내기에서 관절 속도 경고가 납니다">⚠ 순간 전환</span>
          : ld.stepFast ? <span className="pv-chip warn" title="이 길이로는 발을 옮기는 걸음이 1.5 m/s보다 빠릅니다. 전이를 늘리거나 전이 자동을 누르세요">⚠ 걸음이 빠름</span> : null} />
      <LeadField label="관성" part="inertia" off={!on} frames={ld.inertia} set={f => set({ inertia: f })}
        auto={{ on: item.inertia === undefined, click: () => set({ inertia: null }) }}
        extra={ld.why ? <span className={review ? 'pv-chip warn' : 'pv-chip'} title={WHY_TIP}>{review ? '⚠ ' : ''}{INERTIA_WHY[ld.why]}</span>
          : ld.airborne ? <span className="pv-chip warn" title="관성이 시작되는 프레임에서 발이 바닥에 있지 않습니다. 관성 자동을 누르거나 두 발이 딛고 있는 곳까지 늘리세요">⚠ 발이 떠 있음</span> : null} />
    </div>
  )
}

function load(): Prefs {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (SIDES.includes(o?.videoSide) && typeof o.ratio === 'number' && isFinite(o.ratio)) return { videoSide: o.videoSide, ratio: clampRatio(o.ratio) }
  } catch { /* unavailable or corrupt: use defaults */ }
  return { videoSide: 'left', ratio: 0.5 }
}
function save(p: Prefs) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* storage unavailable */ } }

/** Video + robot area: dock the video to any side by dragging a title bar; the divider resizes. `robot` is the main 3D view;
 * compare panes sit to its right in the robot area, each with its own divider. */
export default function StagePanes({ robot }: { robot: ReactNode }) {
  const mode = useEditor(s => s.videoMode), setMode = useEditor(s => s.setVideoMode)
  const hasVideo = useEditor(s => !!videoTrack(s.project)?.items.length)
  const [prefs, setPrefs] = useState(load)
  const ref = useRef<HTMLDivElement>(null)
  const pr = useRef(prefs)
  pr.current = prefs
  const apply = (p: Prefs, persist: boolean) => { pr.current = p; setPrefs(p); if (persist) save(p) }

  // drag-to-dock: which pane is dragged, and the side it currently hovers
  const [drag, setDrag] = useState<{ pane: 'video' | 'robot'; side: Side } | null>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag
  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }
  }
  const dragging = !!drag
  const pending = useRef<{ x: number; y: number } | null>(null) // pointerdown point; a drag starts after 4px of movement
  useEffect(() => {
    if (!dragging) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); dragRef.current = null; setDrag(null) } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [dragging])
  useEffect(() => { pending.current = null; dragRef.current = null; setDrag(null); setSepDrag(false) }, [mode])
  const titleProps = (pane: 'video' | 'robot') => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || (e.target as Element).closest('button')) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      pending.current = { x: e.clientX, y: e.clientY }
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) {
        const q = pending.current
        if (!q || Math.hypot(e.clientX - q.x, e.clientY - q.y) < 4) return
        pending.current = null
        const p = local(e), d = { pane, side: dockSide(p.x, p.y, p.w, p.h) }
        dragRef.current = d; setDrag(d)
        return
      }
      const p = local(e), side = dockSide(p.x, p.y, p.w, p.h)
      if (side !== dragRef.current.side) { const d = { pane, side }; dragRef.current = d; setDrag(d) }
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current
      pending.current = null; dragRef.current = null; setDrag(null)
      if (d) apply({ ...pr.current, videoSide: pane === 'video' ? d.side : OPPOSITE[d.side] }, true)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    },
    onPointerCancel: () => { pending.current = null; dragRef.current = null; setDrag(null) },
  })

  // divider
  const { videoSide, ratio } = prefs
  const horiz = videoSide === 'left' || videoSide === 'right'
  const first = videoSide === 'left' || videoSide === 'top' // video sits before the divider
  const [sepDrag, setSepDrag] = useState(false)
  const sepKey = (e: React.KeyboardEvent) => {
    const k = (horiz ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowDown: 1, ArrowUp: -1 } as Record<string, number>)[e.key]
    if (k === undefined) return
    e.preventDefault(); e.stopPropagation()
    apply({ ...prefs, ratio: clampRatio(ratio + (first ? k : -k) * STEP) }, true) // divider follows the arrow
  }
  const sepMove = (e: React.PointerEvent) => {
    if (!sepDrag) return
    const p = local(e), pos = horiz ? p.x / p.w : p.y / p.h
    apply({ ...pr.current, ratio: clampRatio(first ? pos : 1 - pos) }, false)
  }
  const sepEnd = (e: React.PointerEvent) => {
    if (!sepDrag) return
    setSepDrag(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    save(pr.current)
  }

  // robot row: [main | clip preview? | compare...]; equal widths whenever the pane set changes (not persisted)
  const compare = useEditor(s => s.comparePanes), itemPreview = useEditor(s => s.itemPreview)
  const extra = [...(itemPreview ? [{ preview: true, id: itemPreview }] : []), ...compare.map(id => ({ preview: false, id }))]
  const n = extra.length + 1, ids = extra.map(e => e.id).join()
  const [row, setRow] = useState({ ids, r: [1] })
  const ratios = row.ids === ids && row.r.length === n ? row.r : equalRatios(n)
  const rowEl = useRef<HTMLDivElement>(null)
  const [rowDrag, setRowDrag] = useState<number | null>(null)
  const setRatios = (r: number[]) => setRow({ ids, r })
  const rowMove = (e: React.PointerEvent, i: number) => {
    if (rowDrag !== i) return
    const b = rowEl.current!.getBoundingClientRect(), w = rowWidths(ratios, b.width, SEP)
    const left = w.slice(0, i).reduce((a, x) => a + x, 0) + i * SEP
    setRatios(moveDivider(ratios, i, (e.clientX - b.left - SEP / 2 - left) / (b.width - SEP * (n - 1)) - ratios[i]))
  }
  const rowEnd = (e: React.PointerEvent) => {
    setRowDrag(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const rowKey = (e: React.KeyboardEvent, i: number) => {
    const k = ({ ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[e.key]
    if (k === undefined) return
    e.preventDefault(); e.stopPropagation()
    setRatios(moveDivider(ratios, i, k * STEP))
  }

  const mainSuffix = useMainSuffix()
  const split = mode === 'split'
  const titled = split || n > 1
  // overlay covers only the main robot pane (below its title)
  const overlay = mode === 'overlay' && n > 1 ? { right: 'auto', top: TITLE, width: `calc((100% - ${SEP * (n - 1)}px) * ${ratios[0]})` } : undefined
  const preview = drag && paneRects(drag.side, drag.pane === 'video' ? ratio : 1 - ratio, 1, 1).video
  return (
    <div ref={ref} className={`panes ${mode} ${videoSide}${dragging || sepDrag || rowDrag !== null ? ' dragging' : ''}`}>
      <section className="pane pane-video" aria-label="영상 프리뷰" style={split ? { flexBasis: `${ratio * 100}%` } : overlay}>
        {split && (
          <div className="pane-title" {...titleProps('video')}>
            <span>영상 프리뷰</span>
            <button aria-label="영상 닫기" onClick={() => setMode('off')}>✕</button>
          </div>
        )}
        {mode === 'overlay' && hasVideo && <button className="ov-close" aria-label="영상 닫기" onClick={() => setMode('off')}>✕</button>}
        <div className="pane-body"><VideoOverlay /></div>
      </section>
      {split && (
        <div className="pane-sep" role="separator" tabIndex={0} aria-label="영상/로봇 프리뷰 분할"
          aria-orientation={horiz ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(ratio * 100)} aria-valuemin={20} aria-valuemax={80}
          onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus(); setSepDrag(true) }}
          onPointerMove={sepMove} onPointerUp={sepEnd} onPointerCancel={sepEnd}
          onDoubleClick={() => apply({ ...prefs, ratio: 0.5 }, true)} onKeyDown={sepKey} />
      )}
      <div ref={rowEl} className="pane-robots">
        <section className="pane pane-robot" aria-label="로봇 프리뷰" style={{ flex: `${ratios[0]} 1 0` }}>
          {titled && <div className={split ? 'pane-title' : 'pane-title static'} {...(split ? titleProps('robot') : {})}><span>로봇 프리뷰{mainSuffix}</span></div>}
          {robot}
        </section>
        {extra.map(({ preview: pv, id }, i) => { // divider i sits between pane i and i+1
          return (
            <Fragment key={(pv ? 'pv:' : 'cmp:') + id}>
              <div className="pane-sep" role="separator" tabIndex={0} aria-label={pv ? '클립 프리뷰 분할' : `비교 프리뷰 분할 ${i + 1 - (itemPreview ? 1 : 0)}`} aria-orientation="vertical"
                aria-valuenow={Math.round(ratios[i] * 100)} aria-valuemin={ROW_MIN * 100} aria-valuemax={Math.round((ratios[i] + ratios[i + 1] - ROW_MIN) * 100)}
                onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus(); setRowDrag(i) }}
                onPointerMove={e => rowMove(e, i)} onPointerUp={rowEnd} onPointerCancel={rowEnd}
                onDoubleClick={() => setRatios(equalRatios(n))} onKeyDown={e => rowKey(e, i)} />
              <section className="pane pane-robot" aria-label={pv ? '클립 프리뷰' : '비교 프리뷰'} style={{ flex: `${ratios[i + 1]} 1 0` }}>
                {pv ? <ItemPreview id={id} /> : <><CompareTitle id={id} /><div className="stage-3d"><Stage compareClipId={id} /></div></>}
              </section>
            </Fragment>
          )
        })}
      </div>
      {preview && <div className="dock-preview" style={{ left: `${preview.x * 100}%`, top: `${preview.y * 100}%`, width: `${preview.w * 100}%`, height: `${preview.h * 100}%` }} />}
    </div>
  )
}
