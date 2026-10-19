import { dropPlacement, type Asset, type Placement } from '../model/dropPlacement'
import { getEditor } from '../store/store'
import { itemLen } from '../model/sequence'
import type { RobotKind } from '../robot/types'

const CLIP = 'application/x-motion-clip', MEDIA = 'application/x-motion-media'

// The asset card being dragged: getData is unreadable during dragover, so the card reports it here (dragstart / dragend).
let dragged: Asset | null = null
let draggedIds: string[] = [] // several clips dragged together (a 목록 folder or a multi-selection), in list order
export const setDragged = (a: Asset | null, many: string[] = []) => { dragged = a; draggedIds = many }
export const draggedClips = () => draggedIds

export const isAssetDrag = (dt: DataTransfer | null) => !!dragged || !!dt?.types.includes(CLIP) || !!dt?.types.includes(MEDIA)
export const draggedAsset = (dt: DataTransfer | null): Asset | null => {
  if (dragged) return dragged
  const clip = dt?.getData(CLIP), media = dt?.getData(MEDIA)
  return clip ? { kind: 'clip', id: clip } : media ? { kind: 'media', id: media } : null
}

/** Drop `asset` per dropPlacement and select the new item. Returns the rejection reason, or null on success. */
export function dropAsset(asset: Asset, rowTrackId: string | null, frame: number): string | null {
  const s = getEditor().getState(), pl = dropPlacement(s.project, asset, rowTrackId, frame)
  if (pl.kind === 'reject') return pl.reason
  if (!asset.clip) return place(asset, pl)
  s.beginGesture() // the new clip and its placement are one undo entry
  try {
    s.addClip(asset.clip)
    const r = place({ kind: 'clip', id: asset.clip.id }, pl)
    if (r) getEditor().getState().cancelGesture() // placement failed: drop the clip too
    return r
  } finally { s.endGesture() }
}

function place(asset: Asset, pl: Exclude<Placement, { kind: 'reject' }>): string | null {
  const s = getEditor().getState()
  if (pl.kind === 'newActor') {
    const r = s.placeClipAsNewActor(asset.id, pl.start)
    if (!r) return '이 위치에 놓을 수 없습니다'
    s.selectItem(r.itemId); s.select(r.actorId)
    return null
  }
  const track = () => getEditor().getState().project.sequence.tracks.find(t => pl.kind === 'video' ? t.kind === 'video' : t.id === pl.trackId)
  const ok = pl.kind === 'video' ? s.addVideoItem(asset.id, pl.start) : s.addItem(s.project.actors.find(a => a.id === track()?.actorId)!.id, asset.id, pl.start, pl.shift)
  if (!ok) return '이 위치에 놓을 수 없습니다'
  const t = track()!
  getEditor().getState().selectItem(t.items.at(-1)!.id)
  if (t.actorId) getEditor().getState().select(t.actorId)
  return null
}

/** Several clips at once: one piece per clip, laid end to end in list order from the drop point; G1 and GO2 clips each go on their
 * own robot's track (the row's track when it matches, else the first of that robot, else a new one). One undo entry; all or nothing. */
export function dropClips(ids: string[], rowTrackId: string | null, frame: number): string | null {
  const ed = getEditor(), at = new Map<RobotKind, { row: string | null; frame: number }>()
  if (ed.getState().project.sequence.tracks.every(t => !t.items.length)) frame = 0 // like a single drop on an empty timeline, for every robot
  ed.getState().beginGesture()
  try {
    for (const id of ids) {
      const p = ed.getState().project, robot = p.clips[id]?.robot
      if (!robot) continue
      const robotOf = (trackId: string | null) => p.actors.find(a => a.id === p.sequence.tracks.find(t => t.id === trackId)?.actorId)?.robot
      const c = at.get(robot) ?? { frame, row: robotOf(rowTrackId) === robot ? rowTrackId
        : p.sequence.tracks.find(t => t.kind === 'motion' && robotOf(t.id) === robot)?.id ?? null }
      const r = dropAsset({ kind: 'clip', id }, c.row, c.frame)
      if (r) { ed.getState().cancelGesture(); return r }
      const s = ed.getState(), t = s.project.sequence.tracks.find(t => t.items.some(i => i.id === s.selItem))!, it = t.items.find(i => i.id === s.selItem)!
      at.set(robot, { row: t.id, frame: it.start + itemLen(it) })
    }
    return null
  } finally { ed.getState().endGesture() }
}

/** Drop in clip view: close it, then place at the playhead; a clip goes to the first track of its robot (snapping), a video to V1. */
export function dropAssetInClipView(asset: Asset): string | null {
  const s = getEditor().getState()
  s.closeItem()
  const p = s.project, robot = asset.kind === 'clip' ? (asset.clip ?? p.clips[asset.id])?.robot : undefined
  const row = p.sequence.tracks.find(t => t.kind === 'motion' && p.actors.find(a => a.id === t.actorId)?.robot === robot)
  return draggedIds.length > 1 ? dropClips(draggedIds, row?.id ?? null, s.frame) : dropAsset(asset, row?.id ?? null, s.frame)
}
