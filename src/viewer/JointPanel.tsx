import { evalCurve } from '../model/curve'
import type { Interp } from '../model/types'
import { baseClip, editedClip } from '../model/itemClip'
import { evaluateClip } from '../model/pose'
import { actorOf, assetOwner, clipLocked, editLock, editTarget, getEditor, keyOwner, targetItem, trackLocked, useEditor, type EditorState } from '../store/store'
import { playRange } from '../transport'

// 관절 패널 (spec 2026-10-15-clip-edit-mode-design.md §2), the inspector's 값 section: the part (부위) of the selected joint with
// one slider row per channel, frame/key tools, 보간 and the 구간 row (setValue, gestures, locks, 자동 키). It sat on the 3D view
// first; moved into the sidebar so it never covers the robot (user request).

const ROOT = ['root.x', 'root.y', 'root.z', 'root.roll', 'root.pitch', 'root.yaw']
const ROOT_RANGE: Record<string, [number, number]> = {
  'root.x': [-5, 5], 'root.y': [-5, 5], 'root.z': [0, 2],
  'root.roll': [-Math.PI, Math.PI], 'root.pitch': [-Math.PI, Math.PI], 'root.yaw': [-Math.PI, Math.PI],
}
const isAngle = (ch: string, joint: boolean) => joint || /roll|pitch|yaw/.test(ch)
const INTERPS: [Interp, string][] = [['linear', '선형'], ['bezier', '이즈'], ['hold', '홀드']]
// A slider drag ends on the next release anywhere: the slider may be disabled or unmounted mid-drag (selection cleared,
// lock), and a gesture left open would merge every later edit into one undo step.
const endOnRelease = () => {
  const end = () => { getEditor().getState().endGesture(); removeEventListener('pointerup', end); removeEventListener('pointercancel', end) }
  addEventListener('pointerup', end); addEventListener('pointercancel', end)
}

/** What the panel (and the inspector's 값) edit for the current selection; null when nothing editable is selected. */
export function editView(s: EditorState) {
  const actor = actorOf(s, s.sel.actorId)
  if (!actor || !s.sel.channel) return null
  const def = s.defs[actor.robot], t = editTarget(s, actor.id)
  const item = t && targetItem(s, t.itemId)
  if (!t || !item) return null
  const clip = s.project.clips[t.clipId], clipMode = !!s.clipEdit
  const shown = (clipMode ? baseClip(s.project, s.defs, clip.id) : editedClip(s.project, s.defs, item)) ?? clip
  const piece = s.layer === 'piece' && !clipMode, asset = s.layer === 'asset' && clipMode
  const owner = asset ? assetOwner(clip.id) : piece ? item.id : clip.id
  const lockedAll = asset ? false : trackLocked(s.project, actor.id) || clipLocked(s.project, clip.id)
  const ch = s.sel.channel
  const group = ch.startsWith('group:') ? ch.slice(6) : ch.startsWith('root') ? '루트' : def.groups.find(g => g.joints.includes(ch))?.name ?? null
  const channels = group === '루트' ? ROOT : def.groups.find(g => g.name === group)?.joints ?? []
  const pose = evaluateClip(shown, def, t.f)
  const value = (c: string) => {
    const j = def.joints.findIndex(x => x.name === c)
    if (j >= 0) return { joint: true, v: pose.q[j], lo: def.joints[j].lower, hi: def.joints[j].upper }
    const [lo, hi] = ROOT_RANGE[c] ?? [0, 0]
    return { joint: false, v: evalCurve(shown.channels[c] ?? { keys: [] }, t.f, c === 'root.z' ? def.standingHeight : 0), lo, hi }
  }
  return {
    actor, def, f: t.f, item, owner, group, channels, value, offset: piece || asset,
    canEdit: piece || asset || s.autoKey, locked: (c: string) => lockedAll || !!editLock(s, actor.id, c),
    curves: keyOwner(s.project, owner)?.channels ?? {},
  }
}

export default function JointPanel() {
  const s = useEditor(st => st)
  const v = editView(s)
  if (!v || !v.group) return null
  const ed = getEditor(), act = ed.getState()
  const sel = s.sel.channel!.startsWith('group:') || s.sel.channel === 'root' ? v.channels[0] : s.sel.channel!
  const deg = s.degrees, num = (x: number, d: boolean) => (d ? (x * 180) / Math.PI : x).toFixed(d ? 1 : 3)
  const set = (c: string, x: number) => act.setValue(v.actor.id, c, x)
  const clipView = !!(s.editing || s.clipEdit), r = clipView ? s.range : null
  const outside = !!r && (v.f < r.a || v.f > r.b)
  // clip view on the piece's lead-in / 끝 기본자세: those frames are not the piece's own
  const offPiece = !!s.editing && !s.clipEdit && (s.frame < v.item.start || s.frame >= v.item.start + v.item.trimOut - v.item.trimIn)
  const blocked = (c: string) => !v.canEdit || v.locked(c) || outside || offPiece
  const curve = v.curves[sel]
  const keyHere = curve?.keys.find(k => k.f === v.f), atKey = !!keyHere
  // the piece open in the clip preview is edited on the preview's own playhead (kept on the piece, paused)
  const onPreview = !s.editing && !s.clipEdit && s.itemPreview === v.item.id
  const go = (nf: number) => {
    const st = ed.getState()
    if (onPreview) { st.setPreviewPlaying(false); st.setPreviewFrame(Math.min(Math.max(nf, v.item.start), v.item.start + v.item.trimOut - v.item.trimIn - 1)) }
    else if (st.editing || st.clipEdit) { const [lo, hi] = playRange(st); st.setFrame(Math.min(Math.max(nf, lo), hi - 1)) } else st.setFrame(Math.max(nf, 0))
  }
  const jump = (dir: 1 | -1) => {
    const fs = (curve?.keys ?? []).map(k => k.f), to = dir > 0 ? Math.min(...fs.filter(k => k > v.f)) : Math.max(...fs.filter(k => k < v.f))
    if (Number.isFinite(to)) go(to - v.item.trimIn + v.item.start)
  }
  const step = (d: 1 | -1) => go((onPreview ? ed.getState().previewFrame : ed.getState().frame) + d) // one frame, inside the clip view's range like the transport arrows
  const addKey = () => { const x = v.value(sel).v; if (v.offset) act.setKey(v.owner, sel, v.f, evalCurve(curve ?? { keys: [] }, v.f, 0)); else act.setKey(v.owner, sel, v.f, x) }
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'number') return
    const i = v.channels.indexOf(sel)
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation()
      const n = v.channels[Math.min(Math.max(i + (e.key === 'ArrowUp' ? -1 : 1), 0), v.channels.length - 1)]
      act.select(v.actor.id, n)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation()
      if (blocked(sel)) return
      const { joint, v: x, lo, hi } = v.value(sel), step = (isAngle(sel, joint) ? 0.5 * Math.PI / 180 : 0.005) * (e.shiftKey ? 10 : 1)
      const nx = x + (e.key === 'ArrowRight' ? step : -step)
      set(sel, joint ? Math.min(Math.max(nx, lo), hi) : nx)
    }
  }
  return (
    <section className="jp" role="group" aria-label="관절 패널" tabIndex={-1} onKeyDown={onKey}>
      <h3 className="jp-head">
        <span>값 · {v.group}</span>
        <span className="jp-f">{s.clipEdit ? '클립' : onPreview ? '클립 프리뷰' : '시퀀스'} F{v.f}</span>
      </h3>
      <>
        {outside && <p className="jp-hint warn">재생헤드를 구간 안으로 옮기세요</p>}
        {offPiece && <p className="jp-hint warn">기본자세·전이·관성 구간입니다 · 조각 안에서 고치세요</p>}
        <div className="jp-rows">
          {v.channels.map(c => {
            const { joint, v: x, lo, hi } = v.value(c), d = deg && isAngle(c, joint)
            const near = joint && (x - lo < 0.1 * (hi - lo) || hi - x < 0.1 * (hi - lo))
            return (
              <div key={c} className={c === sel ? 'jp-row sel' : 'jp-row'} onPointerDown={() => { if (c !== sel) act.select(v.actor.id, c) }}>
                <span className="jp-name" title={c}>{c.replace(/_joint$/, '').replace(/^root\./, '')}</span>
                <input type="range" className={near ? 'near' : ''} min={lo} max={hi} step={0.001} value={x} disabled={blocked(c)} aria-label={`${c} 슬라이더`}
                  onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); act.beginGesture(); endOnRelease() }}
                  onChange={e => set(c, +e.target.value)} />
                <span className="jp-val">
                  <input type="number" key={`${v.f}-${x}-${d}`} defaultValue={num(x, d)} step={d ? 1 : 0.001} disabled={blocked(c)} aria-label={`${c} 숫자`}
                    onBlur={e => { const n = e.target.valueAsNumber; if (!Number.isFinite(n)) return; const a = d ? n * Math.PI / 180 : n; set(c, joint ? Math.min(Math.max(a, lo), hi) : a) }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                  <i>{d ? '°' : isAngle(c, joint) ? 'rad' : 'm'}</i>
                </span>
              </div>
            )
          })}
        </div>
        <div className="jp-tools">
          <button aria-label="이전 프레임" title="1프레임 뒤로" onClick={() => step(-1)}>◀ 1F</button>
          <button aria-label="다음 프레임" title="1프레임 앞으로" onClick={() => step(1)}>1F ▶</button>
          <span className="jp-gap" />
          <button aria-label="이전 키" title="이 관절의 이전 키(◆)로" onClick={() => jump(-1)}>◀ 키</button>
          <button aria-label="다음 키" title="이 관절의 다음 키(◆)로" onClick={() => jump(1)}>키 ▶</button>
        </div>
        <div className="jp-tools">
          <button disabled={blocked(sel)} onClick={addKey}>키 추가</button>
          <button disabled={!atKey || blocked(sel)} onClick={() => act.deleteKeys(v.owner, [{ channel: sel, f: v.f }])}>키 삭제</button>
          <select aria-label="보간" title="이 키의 보간" disabled={!atKey || blocked(sel)} value={keyHere?.interp ?? ''}
            onChange={e => act.setInterp(v.owner, [{ channel: sel, f: v.f }], e.target.value as Interp)}>
            {!atKey && <option value="" />}
            {INTERPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <span className="jp-gap" />
          <button className="jp-unit" aria-pressed={deg} onClick={() => act.setDegrees(!deg)} title="각도 단위 (도 / rad)">{deg ? '도' : 'rad'}</button>
        </div>
        {clipView && <RangeRow />}
      </>
    </section>
  )
}

// 구간 줄: a – b (clip frames), 가감 frames, 해제; picked by Shift+drag on the clip-view ruler.
function RangeRow() {
  const r = useEditor(s => s.range), act = getEditor().getState()
  if (!r) return <div className="jp-range"><span className="jp-hint">구간: 눈금자를 Shift+드래그로 선택</span></div>
  const field = (label: string, key: 'a' | 'b' | 'fade', value: number) => (
    <label className="jp-rf">{label}<input type="number" aria-label={`구간 ${label}`} key={`${key}-${value}`} defaultValue={value} step={1} min={0}
      onBlur={e => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) act.setRange({ ...r, [key]: n }) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></label>
  )
  return (
    <div className="jp-range" role="group" aria-label="구간">
      <span>구간</span>{field('시작', 'a', r.a)}<span>–</span>{field('끝', 'b', r.b)}{field('가감', 'fade', r.fade)}
      <button aria-label="구간 해제" title="구간 해제" onClick={() => act.setRange(null)}>✕</button>
    </div>
  )
}
