import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { parseCsvPoses } from '../export/importCsv'
import type { Pose } from '../model/pose'
import { getEditor, trackLocked, useEditor } from '../store/store'
import { blockUrl, GO2_BLOCKS, type Block } from './blocks'
import { blockActual, buildBlockClip, emptyBlockClip } from './build'

type Template = { fps: number; poses: Pose[] }
// One fetch per block; a failed load is dropped so picking the block again retries.
const cache = new Map<string, Promise<Template>>()
function loadTemplate(id: string): Promise<Template> {
  let p = cache.get(id)
  if (!p) {
    p = fetch(blockUrl(id))
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text() })
      .then(text => parseCsvPoses(text, getEditor().getState().defs, undefined))
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return p
}


// Why the real value differs from the typed one: the clip is the real log's start + stop parts plus whole repeated steps.
// The values a loop block can really make (user: no 1 m / 100° in the list when the log cannot do it): whole steps n = 1..STEPS,
// per direction (Rotate: 좌 then 우). Each option's value lands exactly on its n (blockActual rounds to the nearest step).
const STEPS = 20
const stepOptions = (b: Block, poses: Template['poses']): { v: string; label: string }[] =>
  b.kind !== 'loop' ? [] : (b.param === 'degrees' ? [1, -1] : [1]).flatMap(sg => {
    const one = blockActual(b, poses, sg)!
    return Array.from({ length: STEPS }, (_, k) => {
      const v = sg * (Math.abs(one.base) + (k + 1) * Math.abs(one.per)), a = blockActual(b, poses, v)!
      return { v: String(v), label: b.param === 'meters' ? `${a.actual.toFixed(2)} m (${a.n}걸음)` : `${sg > 0 ? '좌' : '우'} ${Math.round(Math.abs(a.actual))}° (${a.n}걸음)` }
    })
  })

// The step list: a button and a list of at most ~8 rows that scrolls (a native <select> popup can't be sized and ran over the
// window, user). The list floats over the page (fixed, under the button or above it when there is no room): the dialog keeps its
// size and does not clip it. ↑/↓ change the value, Esc / a click outside closes the list.
function StepPicker({ options, value, onChange }: { options: { v: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false), [at, setAt] = useState<React.CSSProperties>({})
  const box = useRef<HTMLDivElement>(null), list = useRef<HTMLUListElement>(null)
  const place = () => { // under the button, or above it when the window has no room below
    const r = box.current!.getBoundingClientRect(), h = 216, below = innerHeight - r.bottom - 4 >= h
    setAt({ left: r.left, width: r.width, ...(below ? { top: r.bottom + 2 } : { bottom: innerHeight - r.top + 2 }) })
  }
  useEffect(() => {
    if (!open) return
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const close = (e: Event) => { if (!list.current?.contains(e.target as Node)) setOpen(false) } // a moved page: the fixed list would drift
    addEventListener('pointerdown', away); addEventListener('resize', close); addEventListener('scroll', close, true)
    return () => { removeEventListener('pointerdown', away); removeEventListener('resize', close); removeEventListener('scroll', close, true) }
  }, [open])
  const i = options.findIndex(o => o.v === value)
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (d && options.length) { e.preventDefault(); onChange(options[Math.min(Math.max(i + d, 0), options.length - 1)].v) }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false) } // not the dialog's Esc
    else if (e.key === 'Enter' && open) { e.preventDefault(); setOpen(false) }
  }
  return (
    <div className="step-pick" ref={box} onKeyDown={onKey}>
      <button type="button" aria-label="값" aria-haspopup="listbox" aria-expanded={open} disabled={!options.length} onClick={() => { if (!open) place(); setOpen(o => !o) }}>
        <span>{options[i]?.label ?? '불러오는 중…'}</span><i aria-hidden="true">▾</i>
      </button>
      {open && <ul ref={list} role="listbox" aria-label="값 목록" style={at}>
        {options.map(o => <li key={o.v} role="option" aria-selected={o.v === value} onClick={() => { onChange(o.v); setOpen(false) }}>{o.label}</li>)}
      </ul>}
    </div>
  )
}

const stepWhy = (a: { base: number; per: number }, unit: string) => {
  const f = (x: number) => unit === 'm' ? `${Math.abs(x).toFixed(2)}m` : `${Math.round(Math.abs(x))}°`
  return `실제 GO2 로그를 이어 붙여 만듭니다: 시작·멈춤 동작만으로 ${f(a.base)}, 한 걸음마다 ${f(a.per)}. 걸음은 1번 이상 통째로만 넣을 수 있어 가장 작은 값은 ${f(a.base + a.per)}이고, 그 뒤로 ${f(a.per)}씩 커집니다.`
}

// actorId null = a new GO2 actor on 추가 (the menu dialog), 'asset' = the clip into 목록 only; onAdded gets the actor the block went to
// (null for 목록 only), the clip name and whether an existing 목록 clip was used (same name: no new clip).
// `actions` = dialog layout: stacked fields, then a footer with those buttons and 추가 side by side (note above the footer).

export default function Go2BlockPanel({ actorId, onAdded, actions, note }: { actorId: string | null | 'asset'; onAdded?: (actorId: string | null, name: string, reused: boolean) => void; actions?: ReactNode; note?: ReactNode }) {
  const locked = useEditor(s => !!actorId && actorId !== 'asset' && trackLocked(s.project, actorId))
  const [id, setId] = useState(GO2_BLOCKS[0].id)
  const [value, setValue] = useState('') // a loop block's chosen step value (the first reachable one once its template loads)
  const [frames, setFrames] = useState('30') // the Empty block's length (60fps frames)
  const [tpl, setTpl] = useState<{ id: string; t?: Template; err?: string } | null>(null)
  const block = GO2_BLOCKS.find(b => b.id === id)!

  useEffect(() => {
    let live = true
    setTpl(null)
    if (id === 'empty') return // no log to load
    loadTemplate(id).then(t => live && setTpl({ id, t }), (e: Error) => live && setTpl({ id, err: e.message }))
    return () => { live = false }
  }, [id])

  const pick = (next: string) => { setId(next); setValue('') }

  const t = tpl?.id === id ? tpl.t : undefined
  const options = useMemo(() => t ? stepOptions(block, t.poses) : [], [t, block])
  useEffect(() => { if (options.length && !options.some(o => o.v === value)) setValue(options[0].v) }, [options, value]) // the smallest by default
  const v = block.kind === 'loop' ? (value.trim() === '' ? NaN : Number(value)) : 0
  const n = Number(frames), empty = block.kind === 'empty'
  const valid = empty ? Number.isInteger(n) && n >= 1 : Number.isFinite(v) && (block.kind !== 'loop' || options.some(o => o.v === value))
  const ready = empty || !!t
  const actual = t && valid ? blockActual(block, t.poses, v) : null
  const unit = block.kind === 'loop' && block.param === 'meters' ? 'm' : '°'

  const add = () => {
    if (!ready || !valid) return
    const st = getEditor().getState(), built = empty ? emptyBlockClip(n, st.defs) : buildBlockClip(block, t!.poses, t!.fps, v, st.defs)
    // the same block (same name: Rotate_168deg, Hello…) already in 목록: no new clip (user) — a robot gets that one appended
    const have = Object.values(st.project.clips).find(c => c.robot === 'go2' && c.name === built.name), clip = have ?? built
    if (actorId === 'asset') { // 목록에만 추가
      if (have) { onAdded?.(null, have.name, true); return }
      const name = st.addClipAsset(clip); if (name) onAdded?.(null, name, false); return
    }
    const itemId = st.appendClip(actorId, clip)
    const p = getEditor().getState().project, track = itemId ? p.sequence.tracks.find(tr => tr.items.some(i => i.id === itemId)) : null
    if (itemId && track?.actorId) onAdded?.(track.actorId, p.clips[clip.id]?.name ?? clip.name, !!have)
  }

  const loopLabel = block.kind === 'loop' ? (block.param === 'meters' ? '거리' : '각도') : ''
  const status = <>
    {actual && <p className="ps-dim" role="status">→ 실제 {+actual.actual.toFixed(unit === 'm' ? 2 : 0)}{unit} ({actual.n}회)</p>}
    {actual && <p className="ps-dim ps-why">{stepWhy(actual, unit)}</p>}
    {tpl?.id === id && tpl.err && <p className="ps-dim" role="alert">템플릿을 불러오지 못했습니다: {tpl.err}</p>}
  </>
  if (actions) return (
    <>
      <label className="ps-field"><span>블럭</span>
        <select aria-label="블럭" value={id} onChange={e => pick(e.target.value)}>
          {GO2_BLOCKS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </label>
      {block.kind === 'loop' && (
        <div className="ps-field"><span>{loopLabel}<span className="ps-dim"> · 실제로 갈 수 있는 값만</span></span>{/* a div: a label would re-click the button */}
          <StepPicker options={options} value={value} onChange={setValue} />
        </div>
      )}
      {empty && (
        <label className="ps-field"><span>길이<span className="ps-dim"> · 프레임 (기본자세로 서 있음)</span></span>
          <input type="number" aria-label="길이" min={1} step={1} value={frames} onChange={e => setFrames(e.target.value)} />
        </label>
      )}
      {(actual || (tpl?.id === id && tpl.err)) && <div className="ps-status">{status}</div>}
      {note}
      <footer className="ps-foot">
        <span className="ps-gap" />
        {actions}
        <button type="button" className="ps-primary" disabled={!ready || !valid || locked} onClick={add}>추가</button>
      </footer>
    </>
  )

  return (
    <section className="insp go2-blocks">
      <h3 className="insp-sec-t">GO2 블럭 추가</h3>
      <label className="insp-field"><span className="insp-lab">블럭</span>
        <select aria-label="블럭" value={id} onChange={e => pick(e.target.value)}>
          {GO2_BLOCKS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </label>
      {block.kind === 'loop' && (
        <div className="insp-field"><span className="insp-lab">{loopLabel}</span>
          <StepPicker options={options} value={value} onChange={setValue} />
        </div>
      )}
      {empty && (
        <label className="insp-field"><span className="insp-lab">길이(F)</span>
          <input type="number" aria-label="길이" min={1} step={1} value={frames} onChange={e => setFrames(e.target.value)} />
        </label>
      )}
      <div className="insp-addrow">
        <span className="insp-addstat">{status}</span>
        <button disabled={!ready || !valid || locked} onClick={add}>추가</button>
      </div>
    </section>
  )
}
