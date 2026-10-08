import { dropPlacement, type Asset } from '../model/dropPlacement'
import { getEditor } from '../store/store'

const CLIP = 'application/x-motion-clip', MEDIA = 'application/x-motion-media'

// The asset card being dragged: getData is unreadable during dragover, so the card reports it here (dragstart / dragend).
let dragged: Asset | null = null
export const setDragged = (a: Asset | null) => { dragged = a }

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
  if (pl.kind === 'newActor') {
    const r = s.placeClipAsNewActor(asset.id, pl.start)
    if (!r) return '이 위치에 놓을 수 없습니다'
    s.selectItem(r.itemId); s.select(r.actorId)
    return null
  }
  const track = () => getEditor().getState().project.sequence.tracks.find(t => pl.kind === 'video' ? t.kind === 'video' : t.id === pl.trackId)
  const ok = pl.kind === 'video' ? s.addVideoItem(asset.id, pl.start) : s.addItem(s.project.actors.find(a => a.id === track()?.actorId)!.id, asset.id, pl.start)
  if (!ok) return '이 위치에 놓을 수 없습니다'
  const t = track()!
  getEditor().getState().selectItem(t.items.at(-1)!.id)
  if (t.actorId) getEditor().getState().select(t.actorId)
  return null
}

/** Drop in clip view: close it, then place at the playhead; a clip goes to the first track of its robot (snapping), a video to V1. */
export function dropAssetInClipView(asset: Asset): string | null {
  const s = getEditor().getState()
  s.closeItem()
  const p = s.project, robot = asset.kind === 'clip' ? p.clips[asset.id]?.robot : undefined
  const row = p.sequence.tracks.find(t => t.kind === 'motion' && p.actors.find(a => a.id === t.actorId)?.robot === robot)
  return dropAsset(asset, row?.id ?? null, s.frame)
}
