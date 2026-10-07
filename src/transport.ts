import { getEditor } from './store/store'
import type { Project } from './model/types'

export function sequenceEnd(p: Project): number {
  let end = 0
  for (const t of p.sequence.tracks) for (const it of t.items) end = Math.max(end, it.start + it.trimOut - it.trimIn)
  return end
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

export function startTransport(): () => void {
  const ed = getEditor()
  let raf = 0, t0 = 0, f0 = 0, was = false, last = 0

  const tick = () => {
    const s = ed.getState()
    if (s.playing) {
      const end = sequenceEnd(s.project)
      const now = performance.now()
      if (!was || end <= 0 || s.frame !== last) { // start, or scrubbed during playback
        t0 = now; f0 = s.frame >= end ? 0 : s.frame }
      let f = f0 + Math.floor((now - t0) * 60 / 1000) // from start time, so no drift accumulates
      if (end > 0 && f >= end) { t0 = now; f0 = 0; f = 0 }
      if (f !== s.frame) s.setFrame(f)
      last = f
    }
    was = s.playing
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  const onKey = (e: KeyboardEvent) => {
    if (typing(e.target) || e.altKey) return
    const s = ed.getState()
    const step = (n: number) => {
      e.preventDefault()
      s.setFrame(Math.min(Math.max(s.frame + n, 0), sequenceEnd(s.project)))
    }
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase()
      if (k === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo() }
      else if (k === 'y') { e.preventDefault(); s.redo() }
      return
    }
    if (e.key === ' ') {
      e.preventDefault()
      if (e.target instanceof HTMLButtonElement) e.target.blur() // avoid a second toggle from the button's own click
      s.setPlaying(!s.playing)
    } else if (e.key === 'ArrowLeft') step(e.shiftKey ? -10 : -1)
    else if (e.key === 'ArrowRight') step(e.shiftKey ? 10 : 1)
    else if (e.key === 'Tab' && e.target instanceof Element && e.target.closest('#timeline')) {
      e.preventDefault(); s.setView(s.view === 'tracks' ? 'graph' : 'tracks')
      // the focused canvas is unmounted by the switch; refocus the new one so Tab keeps toggling
      requestAnimationFrame(() => document.querySelector<HTMLElement>('#timeline canvas')?.focus())
    }
  }
  window.addEventListener('keydown', onKey)
  return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey) }
}
