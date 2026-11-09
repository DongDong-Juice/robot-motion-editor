// 재생헤드 고정 menu for the clip view / 클립 편집 timelines (트랙 · 그래프, §24): the same switch as the sequence's ruler menu
// (store.playheadPinned, one setting for every view) — only the pointer-follow stops; ruler clicks, arrow keys and playback still
// move the playhead. Esc closes it before the app's own Esc (which would leave 클립 편집).
import { useLayoutEffect, useRef } from 'react'
import { getEditor, useEditor } from '../store/store'

export default function PinMenu({ at, close, refocus }: { at: { x: number; y: number }; close: () => void; refocus?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useEditor(s => s.playheadPinned)
  const done = (focusBack: boolean) => { close(); if (focusBack) refocus?.() }
  useLayoutEffect(() => {
    const m = ref.current
    if (m) { // inside the window
      const r = m.getBoundingClientRect()
      if (r.bottom > window.innerHeight - 4) m.style.top = `${Math.max(4, window.innerHeight - 4 - r.height)}px`
      if (r.right > window.innerWidth - 4) m.style.left = `${Math.max(4, window.innerWidth - 4 - r.width)}px`
    }
    m?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) close() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(true) } }
    document.addEventListener('pointerdown', away); document.addEventListener('wheel', away, true); document.addEventListener('scroll', away, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('pointerdown', away); document.removeEventListener('wheel', away, true); document.removeEventListener('scroll', away, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [at]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} role="menu" aria-label="재생헤드" className="tl-menu" style={{ left: at.x, top: at.y }}
      onKeyDown={e => { if (e.key === 'Tab') done(true) }}>
      <button role="menuitem" tabIndex={-1} title={pinned ? '재생헤드가 다시 마우스를 따라갑니다' : '마우스를 움직여도 재생헤드가 이 프레임에 머뭅니다'}
        onClick={() => { done(true); getEditor().getState().setPlayheadPinned(!pinned) }}>{pinned ? '고정 해제' : '재생헤드 고정'}</button>
    </div>
  )
}
