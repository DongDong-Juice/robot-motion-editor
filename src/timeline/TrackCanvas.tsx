import { useEffect, useRef, useState } from 'react'
import { clampDf, editTarget, getEditor, type KeyRef } from '../store/store'
import type { Interp } from '../model/types'
import { tv } from './viewState'
import { buildRows, formatTimecode, frameToX, hitKey, rowKey, xToFrame, type TimeScale } from './timeScale'

const ROW_H = 20, LABEL_W = 160, RULER_H = 24, KEY = 7
const sameKey = (a: KeyRef, b: KeyRef) => a.channel === b.channel && a.f === b.f

// {channel, dfFromFirst, v, interp}[] - survives view switches
let clipboard: { channel: string; dfFromFirst: number; v: number; interp: Interp }[] = []

interface Ui {
  scrollY: number; expanded: Set<string>
  dragDf: number                          // key-drag preview offset (frames)
  box: { x0: number; y0: number; x1: number; y1: number } | null
}

export default function TrackCanvas() {
  const cv = useRef<HTMLCanvasElement>(null)
  const ui = useRef<Ui>({ scrollY: 0, expanded: new Set(), dragDf: 0, box: null })
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const canvas = cv.current!, ed = getEditor(), u = ui.current
    const css = getComputedStyle(document.documentElement)
    const col = (n: string) => css.getPropertyValue(n).trim()
    const C = { bg: col('--bg'), panel: col('--panel'), line: col('--line'), text: col('--text'), accent: col('--accent') }
    let W = 0, H = 0, raf = 0

    const scale = (): TimeScale => ({ x0: LABEL_W - tv.scrollF * tv.ppf, pxPerFrame: tv.ppf })
    const itemOf = (actorId: string) => {
      const s = ed.getState(), t = editTarget(s, actorId)
      const item = t && s.project.sequence.tracks.flatMap(tr => tr.items).find(i => i.id === t.itemId)
      return item ? { item, clip: s.project.clips[item.refId] } : null
    }
    // clip frame -> x for an actor, through its item placement
    const clipScale = (actorId: string): TimeScale | null => {
      const it = itemOf(actorId)
      if (!it) return null
      return { x0: scale().x0 + (it.item.start - it.item.trimIn) * tv.ppf, pxPerFrame: tv.ppf }
    }
    const rows = () => { const s = ed.getState(); return buildRows(s.project, s.defs, u.expanded) }
    const rowAt = (y: number) => Math.floor((y - RULER_H + u.scrollY) / ROW_H)
    const rowY = (i: number) => RULER_H + i * ROW_H - u.scrollY

    const draw = () => {
      raf = 0
      const s = ed.getState(), dpr = window.devicePixelRatio || 1
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H)
      ctx.font = '11px "IBM Plex Sans KR", sans-serif'; ctx.textBaseline = 'middle'
      const rs = rows(), sc = scale()

      ctx.save(); ctx.beginPath(); ctx.rect(0, RULER_H, W, H - RULER_H); ctx.clip()
      rs.forEach((r, i) => {
        const y = rowY(i)
        if (y + ROW_H < RULER_H || y > H) return
        const actor = s.project.actors.find(a => a.id === r.actorId)!
        const isActorRow = r.kind === 'group' && r.channels.length === 0
        ctx.fillStyle = isActorRow ? C.panel : C.bg; ctx.fillRect(0, y, W, ROW_H)
        ctx.fillStyle = C.line; ctx.fillRect(0, y + ROW_H - 1, W, 1)
        const cs = clipScale(r.actorId), it = itemOf(r.actorId)
        if (cs && it) {
          const frames = new Set<number>()
          for (const ch of r.channels) for (const k of it.clip.channels[ch]?.keys ?? []) frames.add(k.f)
          for (const f of frames) {
            const isSel = s.sel.actorId === r.actorId &&
              r.channels.some(ch => s.sel.keys.some(k => sameKey(k, { channel: ch, f })))
            const x = frameToX(cs, f + (isSel ? u.dragDf : 0)), cy = y + ROW_H / 2, h = KEY / 2 + 0.5
            if (x < LABEL_W - KEY || x > W + KEY) continue
            ctx.fillStyle = isSel ? C.accent : C.text
            ctx.beginPath()
            ctx.moveTo(x, cy - h); ctx.lineTo(x + h, cy); ctx.lineTo(x, cy + h); ctx.lineTo(x - h, cy); ctx.fill()
          }
        }
        // label column, drawn over keys scrolled beneath it
        ctx.fillStyle = isActorRow ? C.panel : C.bg; ctx.fillRect(0, y, LABEL_W, ROW_H - 1)
        const chSel = s.sel.actorId === r.actorId && r.kind === 'channel' && s.sel.channel === r.channels[0]
        ctx.fillStyle = isActorRow ? actor.color : chSel ? C.accent : C.text
        const indent = isActorRow ? 6 : r.kind === 'group' ? 8 : 30
        const mark = r.kind === 'group' && r.channels.length ? (r.expanded ? '▾ ' : '▸ ') : ''
        ctx.fillText(mark + r.label, indent, y + ROW_H / 2, LABEL_W - indent)
      })
      ctx.restore()

      // ruler: bold tick + timecode each second
      ctx.fillStyle = C.panel; ctx.fillRect(0, 0, W, RULER_H)
      ctx.fillStyle = C.line; ctx.fillRect(0, RULER_H - 1, W, 1)
      const fMin = Math.floor(tv.scrollF / 60) * 60, fMax = tv.scrollF + (W - LABEL_W) / tv.ppf
      ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, 0, W - LABEL_W, RULER_H); ctx.clip()
      const step = tv.ppf >= 3 ? 10 : tv.ppf >= 1 ? 30 : 60
      for (let f = fMin; f <= fMax; f += step) {
        const x = Math.round(frameToX(sc, f)) + 0.5, big = f % 60 === 0
        ctx.fillStyle = big ? C.text : C.line
        ctx.fillRect(x, big ? 10 : 16, 1, big ? 14 : 8)
        if (big) { ctx.fillStyle = C.text; ctx.fillText(formatTimecode(f), x + 3, 6) }
      }
      ctx.restore()

      if (u.box) {
        const b = u.box
        ctx.strokeStyle = C.accent; ctx.lineWidth = 1
        ctx.strokeRect(Math.min(b.x0, b.x1) + 0.5, Math.min(b.y0, b.y1) + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0))
      }
      const px = Math.round(frameToX(sc, s.frame)) + 0.5
      if (px >= LABEL_W) { ctx.fillStyle = C.accent; ctx.fillRect(px - 0.5, 0, 1, H) }
      ctx.fillStyle = C.line; ctx.fillRect(LABEL_W - 1, 0, 1, H)
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw) }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect()
      W = r.width; H = r.height
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
      schedule()
    }
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize()
    const unsub = ed.subscribe(schedule)

    // ---- mouse ----
    const pos = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    const frameAtX = (x: number) => Math.max(0, xToFrame(scale(), x))
    const drag = (mv: (e: MouseEvent) => void, up: (e: MouseEvent) => void) => {
      const end = (e: MouseEvent) => { removeEventListener('mousemove', mv); removeEventListener('mouseup', end); up(e) }
      addEventListener('mousemove', mv); addEventListener('mouseup', end)
    }

    // key under the cursor, with the owning actor's clip
    const keyAt = (x: number, y: number) => {
      const r = rows()[rowAt(y)]
      if (!r || y < RULER_H || x < LABEL_W) return null
      const cs = clipScale(r.actorId), it = itemOf(r.actorId)
      if (!cs || !it) return null
      const hit = hitKey([r], it.clip, cs, ROW_H, x, ROW_H / 2)
      return hit && { actorId: r.actorId, clipId: it.clip.id, hit, channel: r.kind === 'channel' ? r.channels[0] : null }
    }
    const selected = (hit: KeyRef[]) => hit.every(h => ed.getState().sel.keys.some(q => sameKey(q, h)))

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      setMenu(null); canvas.focus()
      const { x, y } = pos(e), s = ed.getState()
      if (y < RULER_H) { // ruler scrub
        s.setFrame(frameAtX(x))
        drag(m => s.setFrame(frameAtX(pos(m).x)), () => {})
        return
      }
      if (x < LABEL_W) { // label column
        const r = rows()[rowAt(y)]
        if (!r) return
        if (r.kind === 'group' && r.channels.length) {
          const k = rowKey(r.actorId, r.label)
          if (u.expanded.has(k)) u.expanded.delete(k); else u.expanded.add(k)
          s.select(r.actorId, `group:${r.label}`)
        } else s.select(r.actorId, r.kind === 'channel' ? r.channels[0] : null)
        schedule(); return
      }
      const k = keyAt(x, y)
      if (k) {
        if (s.sel.actorId !== k.actorId) s.select(k.actorId, k.channel)
        if (e.shiftKey) {
          if (selected(k.hit)) s.selectKeys(ed.getState().sel.keys.filter(q => !k.hit.some(h => sameKey(q, h))), false)
          else s.selectKeys(k.hit, true)
        } else if (!selected(k.hit)) s.selectKeys(k.hit, false)
        const clipLen = ed.getState().project.clips[k.clipId].length
        drag(m => { u.dragDf = clampDf(clipLen, ed.getState().sel.keys, (pos(m).x - x) / tv.ppf); schedule() }, m => {
          const df = Math.round((pos(m).x - x) / tv.ppf), st = ed.getState()
          u.dragDf = 0
          if (df !== 0 && st.sel.keys.length) st.moveKeys(k.clipId, st.sel.keys, df)
          schedule()
        })
        return
      }
      // empty: click = setFrame, drag = box select
      let moved = false
      drag(m => {
        const p = pos(m)
        if (!moved && Math.hypot(p.x - x, p.y - y) < 3) return
        moved = true; u.box = { x0: x, y0: y, x1: p.x, y1: p.y }; schedule()
      }, () => {
        const st = ed.getState()
        if (!moved) {
          st.setFrame(frameAtX(x))
          if (!e.shiftKey) st.selectKeys([], false)
          return
        }
        const b = u.box!; u.box = null
        const bx0 = Math.min(b.x0, b.x1), bx1 = Math.max(b.x0, b.x1)
        const r0 = rowAt(Math.min(b.y0, b.y1)), r1 = rowAt(Math.max(b.y0, b.y1))
        const rs = rows(), found: KeyRef[] = []
        let actorId: string | null = null // selection stays within one actor
        for (let i = Math.max(r0, 0); i <= r1 && i < rs.length; i++) {
          const r = rs[i], cs = clipScale(r.actorId), it = itemOf(r.actorId)
          if (!cs || !it || (actorId && r.actorId !== actorId)) continue
          for (const ch of r.channels) for (const key of it.clip.channels[ch]?.keys ?? []) {
            const kx = frameToX(cs, key.f)
            if (kx >= bx0 && kx <= bx1 && kx >= LABEL_W) { actorId = r.actorId; found.push({ channel: ch, f: key.f }) }
          }
        }
        const additive = e.shiftKey && st.sel.actorId === actorId
        if (actorId && st.sel.actorId !== actorId) st.select(actorId)
        st.selectKeys(found, additive)
        schedule()
      })
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey) {
        const { x } = pos(e), fAt = tv.scrollF + (x - LABEL_W) / tv.ppf
        tv.ppf = Math.min(Math.max(tv.ppf * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.5), 40)
        tv.scrollF = Math.max(0, fAt - (x - LABEL_W) / tv.ppf)
      } else if (e.shiftKey) { // vertical scroll
        const max = Math.max(0, rows().length * ROW_H - (H - RULER_H))
        u.scrollY = Math.min(Math.max(u.scrollY + (e.deltaY || e.deltaX), 0), max)
      } else tv.scrollF = Math.max(0, tv.scrollF + (e.deltaY + e.deltaX) / tv.ppf)
      schedule()
    }

    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      const { x, y } = pos(e), k = keyAt(x, y), s = ed.getState()
      if (!k) return
      if (s.sel.actorId !== k.actorId) s.select(k.actorId, k.channel)
      if (!selected(k.hit)) s.selectKeys(k.hit, false)
      setMenu({ x: e.clientX, y: e.clientY })
    }

    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      const s = ed.getState()
      if (s.view !== 'tracks' || !s.sel.actorId || e.altKey) return
      const target = editTarget(s, s.sel.actorId)
      if (!target) return
      const { clipId, f } = target
      const keys = s.sel.keys, mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase()
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (keys.length) { e.preventDefault(); s.deleteKeys(clipId, keys) }
      } else if (mod && k === 'c') {
        const clip = s.project.clips[clipId]
        const items = keys.flatMap(r => {
          const key = clip.channels[r.channel]?.keys.find(q => q.f === r.f)
          return key ? [{ channel: r.channel, f: key.f, v: key.v, interp: key.interp }] : []
        })
        if (!items.length) return
        e.preventDefault()
        const first = Math.min(...items.map(i => i.f))
        clipboard = items.map(i => ({ channel: i.channel, dfFromFirst: i.f - first, v: i.v, interp: i.interp }))
      } else if (mod && k === 'v') {
        if (!clipboard.length) return
        e.preventDefault()
        s.beginGesture()
        for (const c of clipboard) s.setKey(clipId, c.channel, f + c.dfFromFirst, c.v)
        for (const interp of ['linear', 'bezier', 'hold'] as const) {
          const ks = clipboard.filter(c => c.interp === interp).map(c => ({ channel: c.channel, f: f + c.dfFromFirst }))
          if (ks.length) s.setInterp(clipId, ks, interp)
        }
        s.endGesture()
      }
    }

    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContext)
    window.addEventListener('keydown', onKey)
    return () => {
      ro.disconnect(); unsub(); cancelAnimationFrame(raf)
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContext)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // context menu closes on Escape / outside click
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    addEventListener('mousedown', close); addEventListener('keydown', esc)
    return () => { removeEventListener('mousedown', close); removeEventListener('keydown', esc) }
  }, [menu])

  const apply = (interp: Interp) => {
    const s = getEditor().getState()
    const t = s.sel.actorId && s.sel.keys.length ? editTarget(s, s.sel.actorId) : null
    if (t) s.setInterp(t.clipId, s.sel.keys, interp)
    setMenu(null)
  }
  return (
    <>
      <canvas ref={cv} tabIndex={0} className="track-canvas" />
      {menu && (
        <div className="tl-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={e => e.stopPropagation()}>
          {([['선형', 'linear'], ['이즈', 'bezier'], ['홀드', 'hold']] as const).map(([l, i]) =>
            <button key={i} onClick={() => apply(i)}>{l}</button>)}
        </div>
      )}
    </>
  )
}
