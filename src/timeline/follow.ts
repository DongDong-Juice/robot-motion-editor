import { tv } from './viewState'

const RIGHT = 0.85, LEFT = 0.15, JUMP_AT = 0.3, ANIM_MS = 200

// New scrollF that keeps the playhead in view, or null for no change. 'play' follows continuously (playhead pinned to the
// right margin); 'jump' re-centres a playhead that left the window (30% from the left). scrollF stays within [0, contentEnd - 0.85*visible].
export function followTarget(playF: number, scrollF: number, visibleF: number, contentEnd: number, mode: 'play' | 'jump'): number | null {
  const clamp = (t: number) => Math.min(Math.max(t, 0), Math.max(0, contentEnd - visibleF * RIGHT))
  let t: number | null = null
  if (mode === 'play') {
    if (playF > scrollF + visibleF * RIGHT) t = clamp(playF - visibleF * RIGHT)
    else if (playF < scrollF) t = clamp(playF - visibleF * LEFT)
  } else if (playF < scrollF || playF > scrollF + visibleF) t = clamp(playF - visibleF * JUMP_AT)
  return t === null || t === scrollF ? null : t
}

// One controller for the three canvases (only one is mounted): they call followStep() at the top of draw.
let userPaused = false, hovered = false, last = NaN, wasPlaying = false
let anim: { from: number; to: number; t0: number } | null = null

export const markUserScroll = () => { userPaused = true; anim = null } // wheel scroll/zoom suspends follow
export const markHover = () => { hovered = true } // call right before a hover-scrub setFrame
export const resetFollow = () => { last = NaN; anim = null } // a canvas mounted: re-check the playhead

export interface FollowGeom { frame: number; playF: number; playing: boolean; visibleF: number; contentEnd: number }
// Returns true while an animation needs more frames.
export function followStep(g: FollowGeom, now = performance.now()): boolean {
  if (g.playing && !wasPlaying) userPaused = false
  wasPlaying = g.playing
  let mode: 'play' | 'jump' | null = null
  if (g.frame !== last) {
    const d = g.frame - last
    last = g.frame
    if (hovered) hovered = false // hover scrubbing never scrolls
    else {
      if (!g.playing) userPaused = false
      mode = g.playing && d > 0 && d <= 10 ? 'play' : 'jump'
    }
  }
  if (userPaused) return false
  if (mode) {
    const t = followTarget(g.playF, tv.scrollF, g.visibleF, g.contentEnd, mode)
    if (t !== null) {
      if (mode === 'play') { tv.scrollF = t; anim = null }
      else anim = { from: tv.scrollF, to: t, t0: now }
    }
  }
  if (!anim) return false
  const p = Math.min((now - anim.t0) / ANIM_MS, 1)
  tv.scrollF = anim.from + (anim.to - anim.from) * (1 - (1 - p) ** 3)
  if (p >= 1) anim = null
  return anim !== null
}
