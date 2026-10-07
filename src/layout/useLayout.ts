import { useCallback, useEffect, useRef, useState } from 'react'

export interface Layout { left: number; right: number; bottom: number }
const KEY = 'motion-editor.layout'
export const MENUBAR_H = 32
const L = [160, 480], R = [220, 520], STAGE_MIN_W = 320, STAGE_MIN_H = 200, BOTTOM_MIN = 160
const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** prefer: the side being dragged; it absorbs the stage-minimum overflow first. Without it (window resize) both shrink proportionally. */
export function clampLayout(l: Layout, w: number, h: number, prefer?: 'left' | 'right'): Layout {
  let left = cl(l.left, L[0], L[1]), right = cl(l.right, R[0], R[1])
  const excess = left + right - (w - STAGE_MIN_W)
  const slackL = left - L[0], slackR = right - R[0], slack = slackL + slackR
  if (excess > 0 && slack > 0 && prefer) {
    if (prefer === 'left') { const c = Math.min(excess, slackL); left -= c; right -= Math.min(excess - c, slackR) }
    else { const c = Math.min(excess, slackR); right -= c; left -= Math.min(excess - c, slackL) }
  } else if (excess > 0 && slack > 0) {
    const cut = Math.min(excess, slack), cl_ = Math.round(cut * slackL / slack)
    left -= cl_; right -= cut - cl_
  }
  const bottom = Math.max(BOTTOM_MIN, cl(l.bottom, BOTTOM_MIN, h - MENUBAR_H - STAGE_MIN_H))
  return { left, right, bottom }
}

/** Arrow keys on a focused resize handle belong to the handle; global key handlers must ignore them. */
export const onHandleArrow = (e: KeyboardEvent) =>
  e.key.startsWith('Arrow') && e.target instanceof Element && !!e.target.closest('[role=separator]')

/** [min, max] each handle can take at the current window, given the other dimensions. */
export function layoutBounds(l: Layout, w: number, h: number): Record<keyof Layout, [number, number]> {
  return {
    left: [L[0], Math.max(L[0], Math.min(L[1], w - STAGE_MIN_W - l.right))],
    right: [R[0], Math.max(R[0], Math.min(R[1], w - STAGE_MIN_W - l.left))],
    bottom: [BOTTOM_MIN, Math.max(BOTTOM_MIN, h - MENUBAR_H - STAGE_MIN_H)],
  }
}

export const defaultLayout = (h: number): Layout => ({ left: 220, right: 280, bottom: Math.round(0.4 * (h - MENUBAR_H)) })

function load(): Partial<Layout> {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    const ok = (k: keyof Layout) => typeof o?.[k] === 'number' && isFinite(o[k])
    return o && ok('left') && ok('right') && ok('bottom') ? o : {}
  } catch { return {} }
}
function save(l: Layout) { try { localStorage.setItem(KEY, JSON.stringify(l)) } catch { /* storage unavailable */ } }

/** patch(p, true) also persists (drag end / keyboard); plain patch is in-memory only. reset restores defaults. */
export function useLayout(): [Layout, (patch: Partial<Layout>, persist?: boolean) => void, (keys?: (keyof Layout)[]) => void] {
  const [layout, setLayout] = useState<Layout>(() =>
    clampLayout({ ...defaultLayout(window.innerHeight), ...load() }, window.innerWidth, window.innerHeight))
  useEffect(() => {
    const onResize = () => setLayout(l => clampLayout(l, window.innerWidth, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const ref = useRef(layout)
  ref.current = layout
  const patch = useCallback((p: Partial<Layout>, persist = false) => {
    const prefer = 'left' in p ? 'left' : 'right' in p ? 'right' : undefined
    const n = clampLayout({ ...ref.current, ...p }, window.innerWidth, window.innerHeight, prefer)
    ref.current = n // successive patches before a render still compose
    setLayout(n)
    if (persist) save(n)
  }, [])
  const reset = useCallback((keys?: (keyof Layout)[]) => {
    const d = defaultLayout(window.innerHeight)
    patch(keys ? Object.fromEntries(keys.map(k => [k, d[k]])) : d, true)
  }, [patch])
  return [layout, patch, reset]
}
