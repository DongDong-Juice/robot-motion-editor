import { useCallback, useEffect, useState } from 'react'

export interface Layout { left: number; right: number; bottom: number }
const KEY = 'motion-editor.layout'
export const MENUBAR_H = 32
const L = [160, 480], R = [220, 520], STAGE_MIN_W = 320, STAGE_MIN_H = 200, BOTTOM_MIN = 160
const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function clampLayout(l: Layout, w: number, h: number): Layout {
  let left = cl(l.left, L[0], L[1]), right = cl(l.right, R[0], R[1])
  const excess = left + right - (w - STAGE_MIN_W)
  const slackL = left - L[0], slackR = right - R[0], slack = slackL + slackR
  if (excess > 0 && slack > 0) {
    const cut = Math.min(excess, slack), cl_ = Math.round(cut * slackL / slack)
    left -= cl_; right -= cut - cl_
  }
  const bottom = Math.max(BOTTOM_MIN, cl(l.bottom, BOTTOM_MIN, h - MENUBAR_H - STAGE_MIN_H))
  return { left, right, bottom }
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
  const patch = useCallback((p: Partial<Layout>, persist = false) => {
    setLayout(l => {
      const n = clampLayout({ ...l, ...p }, window.innerWidth, window.innerHeight)
      if (persist) save(n)
      return n
    })
  }, [])
  const reset = useCallback((keys?: (keyof Layout)[]) => {
    const d = defaultLayout(window.innerHeight)
    patch(keys ? Object.fromEntries(keys.map(k => [k, d[k]])) : d, true)
  }, [patch])
  return [layout, patch, reset]
}
