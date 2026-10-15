// Window-level mouse drag for the timeline canvases. A drag given `cancel` can be aborted by Ctrl+Z
// (cancelDrag): listeners go away, `up` never runs, `cancel` drops the in-progress preview or gesture.
let active: (() => void) | null = null

export function trackDrag(mv: (e: MouseEvent) => void, up: (e: MouseEvent) => void, cancel?: () => void) {
  const stop = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', end); if (active === abort) active = null }
  const end = (e: MouseEvent) => { stop(); up(e) }
  const abort = () => { stop(); cancel?.() }
  if (cancel) active = abort
  addEventListener('mousemove', mv); addEventListener('mouseup', end)
}

// True when a cancellable drag was in progress (and is now cancelled).
export function cancelDrag(): boolean {
  if (!active) return false
  active()
  return true
}

export const dragActive = () => active !== null
