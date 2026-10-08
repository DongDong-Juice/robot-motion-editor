import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditor } from '../store/store'
import VideoOverlay from './VideoOverlay'
import { clampRatio, dockSide, paneRects, type Side } from './paneLayout'

interface Prefs { videoSide: Side; ratio: number }
const KEY = 'motion-editor.preview'
const SIDES: Side[] = ['left', 'right', 'top', 'bottom']
const OPPOSITE: Record<Side, Side> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }
const STEP = 0.02

function load(): Prefs {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (SIDES.includes(o?.videoSide) && typeof o.ratio === 'number' && isFinite(o.ratio)) return { videoSide: o.videoSide, ratio: clampRatio(o.ratio) }
  } catch { /* unavailable or corrupt: use defaults */ }
  return { videoSide: 'left', ratio: 0.5 }
}
function save(p: Prefs) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* storage unavailable */ } }

/** Video + robot panes: dock the video to any side by dragging a title bar; the divider resizes. `robot` is the 3D view. */
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
  useEffect(() => {
    if (!dragging) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); dragRef.current = null; setDrag(null) } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [dragging])
  const titleProps = (pane: 'video' | 'robot') => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || (e.target as Element).closest('button')) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const p = local(e)
      const d = { pane, side: dockSide(p.x, p.y, p.w, p.h) }
      dragRef.current = d; setDrag(d)
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return
      const p = local(e), side = dockSide(p.x, p.y, p.w, p.h)
      if (side !== dragRef.current.side) { const d = { pane, side }; dragRef.current = d; setDrag(d) }
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current
      dragRef.current = null; setDrag(null)
      if (d) apply({ ...pr.current, videoSide: pane === 'video' ? d.side : OPPOSITE[d.side] }, true)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    },
    onPointerCancel: () => { dragRef.current = null; setDrag(null) },
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

  const split = mode === 'split'
  const preview = drag && paneRects(drag.side, 0.5, 1, 1).video
  return (
    <div ref={ref} className={`panes ${mode} ${videoSide}${dragging || sepDrag ? ' dragging' : ''}`}>
      <section className="pane pane-video" aria-label="영상 프리뷰" style={split ? { flexBasis: `${ratio * 100}%` } : undefined}>
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
          onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setSepDrag(true) }}
          onPointerMove={sepMove} onPointerUp={sepEnd} onPointerCancel={sepEnd}
          onDoubleClick={() => apply({ ...prefs, ratio: 0.5 }, true)} onKeyDown={sepKey} />
      )}
      <section className="pane pane-robot" aria-label="로봇 프리뷰">
        {split && <div className="pane-title" {...titleProps('robot')}><span>로봇 프리뷰</span></div>}
        {robot}
      </section>
      {preview && <div className="dock-preview" style={{ left: `${preview.x * 100}%`, top: `${preview.y * 100}%`, width: `${preview.w * 100}%`, height: `${preview.h * 100}%` }} />}
    </div>
  )
}
