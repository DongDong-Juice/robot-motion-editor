import { evalCurve, makeKey } from './curve'
import type { RobotDefs } from './pose'
import type { Clip, Curve, Item, Key, Project } from './types'
import type { RobotDef } from '../robot/types'

// 조각 수정 층: Item.offset holds per-channel delta curves in clip frames (joints rad, root m/rad). The piece plays
// clip + offset; the shared clip is never touched. Spec docs/superpowers/specs/2026-10-13-piece-offset-design.md.

export const offsetKeyCount = (it: Item) => Object.values(it.offset ?? {}).reduce((n, c) => n + c.keys.length, 0)

/** The clip with `offset` added on its channels: one linear key per frame on the offset channels (joints clamped to the
 * URDF limits), every other channel shared with `clip`. Evaluated at integer frames it equals base + offset exactly. */
export function bakeOffset(clip: Clip, def: RobotDef, offset: Record<string, Curve>): Clip {
  const channels = { ...clip.channels }
  for (const [n, oc] of Object.entries(offset)) {
    if (!oc.keys.length) continue
    const base = clip.channels[n] ?? { keys: [] }, fb = n === 'root.z' ? def.standingHeight : 0
    const j = def.joints.find(j => j.name === n)
    const keys: Key[] = []
    for (let f = 0; f < clip.length; f++) {
      const v = evalCurve(base, f, fb) + evalCurve(oc, f, 0)
      keys.push(makeKey(f, j ? Math.min(Math.max(v, j.lower), j.upper) : v, 'linear'))
    }
    channels[n] = { keys }
  }
  return { ...clip, channels }
}

// Memo per offset object and clip: a project is immutable per edit, so the bake is redone only after an edit.
const cache = new WeakMap<Record<string, Curve>, WeakMap<Clip, Clip>>()

/** The clip a motion item plays: its clip, plus the item's 수정 층 when it has one (unless set to 원본 사용). undefined for an
 * unknown clip. Playback, CSV, physics and the lead-in all use this, so what plays is what exports. */
export function itemClip(p: Project, defs: RobotDefs, it: Item): Clip | undefined {
  return it.use === 'original' ? p.clips[it.refId] : editedClip(p, defs, it)
}

/** The piece's 수정본 (clip + 수정 층) whichever side it uses: what the editors (inspector, graph, gizmo) and the 수정본 pane show. */
export function editedClip(p: Project, defs: RobotDefs, it: Item): Clip | undefined {
  const clip = p.clips[it.refId]
  if (!clip || !it.offset || !offsetKeyCount(it)) return clip
  let m = cache.get(it.offset)
  if (!m) cache.set(it.offset, m = new WeakMap())
  let r = m.get(clip)
  if (!r) m.set(clip, r = bakeOffset(clip, defs[clip.robot], it.offset))
  return r
}

// Shallow project copy where one item uses the given side ('original' or the 수정본); memoized per project, so a view can
// evaluate "this piece as the original" every frame without copying again. The stored project is never touched.
const useCache = new WeakMap<Project, Map<string, Project>>()
export function withUse(p: Project, itemId: string, use: Item['use'] | null): Project {
  let m = useCache.get(p)
  if (!m) useCache.set(p, m = new Map())
  const k = `${itemId}:${use ?? ''}`
  let r = m.get(k)
  if (!r) m.set(k, r = { ...p, sequence: { ...p.sequence, tracks: p.sequence.tracks.map(t => t.items.some(i => i.id === itemId)
    ? { ...t, items: t.items.map(i => { if (i.id !== itemId) return i; const n = { ...i }; if (use) n.use = use; else delete n.use; return n }) } : t) } })
  return r
}
