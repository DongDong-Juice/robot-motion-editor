import type { RobotKind } from '../robot/types'
import { itemLen, validTrack } from './sequence'
import type { Clip, Item, Project } from './types'
import { validVideoTrack, videoTrack } from './video'

// `clip` = a new clip not yet in the project (id === clip.id): a GO2 block dragged from the library.
export interface Asset { kind: 'clip' | 'media'; id: string; clip?: Clip }
export type Placement =
  | { kind: 'existing'; trackId: string; start: number }
  | { kind: 'newActor'; robot: RobotKind; start: number }
  | { kind: 'video'; start: number }
  | { kind: 'reject'; reason: string }

const end = (it: Item) => it.start + itemLen(it)

// First valid start among: the drop frame, the end of the items it would overlap, the end of the track. Never overlaps an item (no crossfade).
function snap(items: Item[], refId: string, len: number, frame: number, ok: (items: Item[]) => boolean): number | null {
  const hit = items.filter(i => i.start < frame + len && frame < end(i))
  const cands = [frame, hit.length ? Math.max(...hit.map(end)) : frame, Math.max(0, ...items.map(end))]
  const free = (s: number) => items.every(i => s + len <= i.start || end(i) <= s)
  return cands.find(start => free(start) && ok([...items, { id: '', refId, start, trimIn: 0, trimOut: len }])) ?? null
}

/** Where a dragged asset lands for a drop at `frame` over the track `rowTrackId` (null = not over a track row). Pure; used by the ghost and the drop. */
export function dropPlacement(p: Project, asset: Asset, rowTrackId: string | null, frame: number): Placement {
  const f = Math.max(0, Math.round(frame))
  if (asset.kind === 'media') {
    const m = p.media.find(m => m.id === asset.id), t = videoTrack(p)
    if (!m) return { kind: 'reject', reason: '알 수 없는 영상입니다' }
    if (t?.locked) return { kind: 'reject', reason: '잠긴 트랙입니다' }
    const media = Object.fromEntries(p.media.map(m => [m.id, m]))
    const start = snap(t?.items ?? [], m.id, m.durationF, f, items => validVideoTrack(items, media))
    return start === null ? { kind: 'reject', reason: '이 위치에 놓을 수 없습니다' } : { kind: 'video', start }
  }
  const clip = asset.clip ?? p.clips[asset.id]
  if (!clip) return { kind: 'reject', reason: '알 수 없는 클립입니다' }
  const t = p.sequence.tracks.find(t => t.id === rowTrackId)
  const actor = t?.kind === 'motion' ? p.actors.find(a => a.id === t.actorId) : undefined
  if (t && actor?.robot === clip.robot) {
    if (t.locked) return { kind: 'reject', reason: '잠긴 트랙입니다' }
    const start = snap(t.items, clip.id, clip.length, f, validTrack)
    return start === null ? { kind: 'reject', reason: '이 위치에 놓을 수 없습니다' } : { kind: 'existing', trackId: t.id, start }
  }
  const empty = p.sequence.tracks.every(t => !t.items.length)
  return { kind: 'newActor', robot: clip.robot, start: empty ? 0 : f }
}
