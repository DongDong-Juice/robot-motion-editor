import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { getEditor, useEditor } from '../store/store'
import Stage from './Stage'
import VideoOverlay from './VideoOverlay'
import { clampRatio, dockSide, equalRatios, moveDivider, paneRects, ROW_MIN, rowWidths, type Side } from './paneLayout'

interface Prefs { videoSide: Side; ratio: number }
const KEY = 'motion-editor.preview'
const SIDES: Side[] = ['left', 'right', 'top', 'bottom']
const OPPOSITE: Record<Side, Side> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }
const STEP = 0.02
const SEP = 6 // .pane-sep width, px
const TITLE = 24 // .pane-title height, px

// "<actor name> / <clip name>" of a compare pane (first item on the actor's track)
const useCompareLabel = (id: string) => useEditor(s => {
  const a = s.project.actors.find(a => a.id === id)
  const it = s.project.sequence.tracks.find(t => t.kind === 'motion' && t.actorId === id)?.items[0]
  return `${a?.name ?? ''} / ${(it && s.project.clips[it.refId]?.name) ?? ''}`
})
function CompareTitle({ id }: { id: string }) {
  return (
    <div className="pane-title static">
      <span>비교 프리뷰 · {useCompareLabel(id)}</span>
      <button aria-label="비교 닫기" onClick={() => getEditor().getState().closeComparePane(id)}>✕</button>
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

  // robot row: [main | compare...]; equal widths whenever the pane set changes (not persisted)
  const compare = useEditor(s => s.comparePanes)
  const n = compare.length + 1, ids = compare.join()
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
        {mode === 'overlay' && <button className="ov-close" aria-label="영상 닫기" onClick={() => setMode('off')}>✕</button>}
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
          {titled && <div className={split ? 'pane-title' : 'pane-title static'} {...(split ? titleProps('robot') : {})}><span>로봇 프리뷰</span></div>}
          {robot}
        </section>
        {compare.map((id, i) => { // divider i sits between pane i and i+1
          return (
            <Fragment key={id}>
              <div className="pane-sep" role="separator" tabIndex={0} aria-label={`비교 프리뷰 분할 ${i + 1}`} aria-orientation="vertical"
                aria-valuenow={Math.round(ratios[i] * 100)} aria-valuemin={ROW_MIN * 100} aria-valuemax={Math.round((ratios[i] + ratios[i + 1] - ROW_MIN) * 100)}
                onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus(); setRowDrag(i) }}
                onPointerMove={e => rowMove(e, i)} onPointerUp={rowEnd} onPointerCancel={rowEnd}
                onDoubleClick={() => setRatios(equalRatios(n))} onKeyDown={e => rowKey(e, i)} />
              <section className="pane pane-robot" aria-label="비교 프리뷰" style={{ flex: `${ratios[i + 1]} 1 0` }}>
                <CompareTitle id={id} />
                <div className="stage-3d"><Stage pane={id} /></div>
              </section>
            </Fragment>
          )
        })}
      </div>
      {preview && <div className="dock-preview" style={{ left: `${preview.x * 100}%`, top: `${preview.y * 100}%`, width: `${preview.w * 100}%`, height: `${preview.h * 100}%` }} />}
    </div>
  )
}
