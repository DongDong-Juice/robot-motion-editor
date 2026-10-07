import { useEffect, useRef } from 'react'
import { mediaUrl, subscribeMedia } from '../media/registry'
import { videoTimeAt } from '../model/video'
import { getEditor, useEditor } from '../store/store'
import { syncAction } from './videoSync'

// Single muted <video> kept on the playhead's media time. Visible only via CSS class (mode); hidden + paused when no target.
export default function VideoOverlay() {
  const ref = useRef<HTMLVideoElement>(null)
  const mode = useEditor(s => s.videoMode), opacity = useEditor(s => s.videoOpacity)

  useEffect(() => {
    const v = ref.current!, store = getEditor()
    const run = () => {
      const s = store.getState()
      const t = s.videoMode === 'off' ? null : videoTimeAt(s.project, s.frame)
      const url = t && mediaUrl(t.mediaId)
      if (!t || !url) { v.style.display = 'none'; v.pause(); return }
      v.style.display = ''
      if (v.getAttribute('src') !== url) { v.src = url; return } // loadedmetadata re-runs sync
      if (v.readyState < 1) return
      const a = syncAction(t, v, s.playing)
      if (a.kind === 'hide') return
      if (a.kind === 'seek') v.currentTime = a.t
      if (a.play) { if (v.paused) v.play().catch(() => {}) } else if (!v.paused) v.pause()
    }
    run()
    v.addEventListener('loadedmetadata', run)
    const un1 = store.subscribe((s, p) => {
      if (s.frame !== p.frame || s.playing !== p.playing || s.project !== p.project || s.editing !== p.editing || s.videoMode !== p.videoMode) run()
    })
    const un2 = subscribeMedia(run)
    return () => { v.removeEventListener('loadedmetadata', run); un1(); un2() }
  }, [])

  return <video ref={ref} muted playsInline preload="auto" className={mode === 'off' ? '' : mode} style={mode === 'overlay' ? { opacity } : undefined} />
}
