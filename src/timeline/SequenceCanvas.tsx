import { useEffect, useRef, useState } from 'react'
import { trackDrag } from './drag'
import { getEditor, useEditor } from '../store/store'
import { itemLen, sortedItems, pieceName, pieceTag } from '../model/sequence'
import { itemLead, itemTail, REST_BLEND, REST_HOLD } from '../model/restPose'
import type { Item, Track } from '../model/types'
import { offsetKeyCount, withUse } from '../model/itemClip'
import { seqFlash, tv } from './viewState'
import { followStep, markHover, markUserScroll, resetFollow } from './follow'
import { sequenceEnd } from '../transport'
import { drawRuler, hitMarker, LABEL_W, RULER_H } from './ruler'
import { dropPlacement } from '../model/dropPlacement'
import { COLOR } from '../model/defaults'
import { draggedAsset, dropAsset, isAssetDrag } from './assetDrop'
import { mediaUrl, subscribeMedia } from '../media/registry'
import { exportOne } from '../export/exportOne'
import { formatTimecode, frameToX, hoverFrame, hoverScrub, xToFrame, type TimeScale } from './timeScale'
import { usePhysics } from '../physics/physicsStore'
import { runItems, stale } from '../physics/runItem'
import { withDefaults } from '../physics/settings'
import { badge, drawAssist, segmentAt, seqFrameOf, treeSuffix, treeTag, WARN_RED } from './physGraph'
import { drawHScrollbar, drawScrollbar, pressScrollbar, SB_W, sbGeom } from './vscroll'

const ROW_H = 28, EDGE = 6
const DENY = '이 위치에 놓을 수 없습니다'
const LOCKED = '잠긴 트랙입니다'
const ICON_HIT = 18 // hit area; icons are drawn 14px: (motion) path, eye, padlock at the label column's right edge
const TRAIL_X = LABEL_W - 56, EYE_X = LABEL_W - 36, LOCK_X = LABEL_W - 16
const TRI_W = 18, NAME_X = 20, CHILD_X = NAME_X + 16 // disclosure triangle hit width; track / child label x
const USE_X = NAME_X + 6 // ● (the side that plays and exports) in front of a lane / 수정 row label; its hit spans [NAME_X, CHILD_X)

// Eye (slashed when the track is hidden) and padlock (shackle open when unlocked); `on` = accent, off = line.
function drawEye(ctx: CanvasRenderingContext2D, cx: number, cy: number, on: boolean, col: string) {
  ctx.save(); ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.ellipse(cx, cy, 7, 4.5, 0, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill()
  if (on) { ctx.beginPath(); ctx.moveTo(cx - 6, cy + 6); ctx.lineTo(cx + 6, cy - 6); ctx.stroke() }
  ctx.restore()
}
// 경로 표시: a floor path (S curve) ending in the root dot
function drawTrail(ctx: CanvasRenderingContext2D, cx: number, cy: number, col: string) {
  ctx.save(); ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(cx - 6, cy + 5); ctx.bezierCurveTo(cx + 6, cy + 5, cx - 6, cy - 4, cx + 4, cy - 4); ctx.stroke()
  ctx.beginPath(); ctx.arc(cx + 5, cy - 4, 2, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}
function drawLock(ctx: CanvasRenderingContext2D, cx: number, cy: number, on: boolean, col: string) {
  ctx.save(); ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 1.5
  ctx.fillRect(cx - 5, cy - 1, 10, 7)
  ctx.beginPath(); ctx.moveTo(cx - 3, cy - 1); ctx.lineTo(cx - 3, cy - 4); ctx.arc(cx, cy - 4, 3, Math.PI, 0)
  ctx.lineTo(cx + 3, on ? cy - 1 : cy - 5); ctx.stroke()
  ctx.restore()
}
const isVideo = (t: Track) => t.kind === 'video'
// "<start>–<end> · <clip name>" of a child row (sequence frames); time first since split pieces share a clip name
const OVERWRITE = REST_HOLD + REST_BLEND // 덮어쓰기 replaces up to the first 1.5 s
const restTag = (it: Item) => it.restPose === 'prepend' ? '기본자세 덧붙임' : '기본자세'
const childLabel = (t: Track, it: Item, name: string) => `${pieceTag(t, it).split(' · ')[0]}${pieceTag(t, it) ? ' · ' : ''}${formatTimecode(it.start)}–${formatTimecode(it.start + itemLen(it))} · ${name}${it.restPose ? ` · ${restTag(it)}` : ''}`
// short lane label: "#n · m:ss" of the piece start ("m:ss" alone for a clip's only piece); exact times are in the hover text
const mss = (f: number) => { const t = Math.floor(f / 60); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` }
const laneLabel = (t: Track, it: Item) => `${pieceTag(t, it).split(' · ')[0]}${pieceTag(t, it) ? ' · ' : ''}${mss(it.start)}`
// text cut to `w` px with an ellipsis
function fit(ctx: CanvasRenderingContext2D, text: string, w: number) {
  if (ctx.measureText(text).width <= w) return text
  let n = text.length
  while (n > 0 && ctx.measureText(text.slice(0, n) + '…').width > w) n--
  return text.slice(0, n) + '…'
}
// Label column rows: one per track, plus (expanded motion tracks) one child per item in time order, and under a piece with a
// 수정 층 its 수정 row (`edit`); y is canvas px.
interface Row { t: Track; it?: Item; y: number; h: number; edit?: boolean }
const hasEdit = (it: Item) => offsetKeyCount(it) > 0
const editLabel = (it: Item) => `수정 · 키 ${offsetKeyCount(it)}개`
// a piece's 수정본 by the piece's name: '#2 · F1200–1441 수정본' (a cut follows: the name changes with the piece)
const editName = (t: Track, it: Item, clipName: string) => `${pieceTag(t, it) || clipName} 수정본`

// In-progress drag preview; the store is untouched until mouseup.
interface Drag { itemId: string; mode: 'move' | 'in' | 'out'; df: number }
interface Msg { text: string; left: number; top: number }
interface Ctx { x: number; y: number; actorId: string; trackId: string; itemId: string | null } // itemId null: track label menu
interface Rename { index: number; left: number; value: string }

export default function SequenceCanvas() {
  const cv = useRef<HTMLCanvasElement>(null)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [rename, setRename] = useState<Rename | null>(null)
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const cancel = useRef(false)
  const renaming = useRef(false)
  renaming.current = !!rename
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set()) // track ids with their item list open (UI only, not saved)
  const exp = useRef(expanded)
  exp.current = expanded
  const redraw = useRef<() => void>(() => {})
  useEffect(() => redraw.current(), [expanded])
  const toggle = (id: string) => setExpanded(e => { const n = new Set(e); if (!n.delete(id)) n.add(id); return n })
  // a motion track that gains a piece (a cut, a drop) and has several opens its staircase of piece rows
  // (or whose piece gains a 수정 층: its 수정 row sits under the piece's lane)
  const tracks = useEditor(s => s.project.sequence.tracks), counts = useRef(new Map<string, number>()), edits = useRef(new Map<string, number>())
  useEffect(() => {
    const nEdit = (t: Track) => t.items.filter(hasEdit).length
    const grown = tracks.filter(t => !isVideo(t) && ((t.items.length >= 2 && t.items.length > (counts.current.get(t.id) ?? 0))
      || nEdit(t) > (edits.current.get(t.id) ?? 0))).map(t => t.id)
    counts.current = new Map(tracks.map(t => [t.id, t.items.length]))
    edits.current = new Map(tracks.map(t => [t.id, nEdit(t)]))
    if (grown.some(id => !exp.current.has(id))) setExpanded(e => new Set([...e, ...grown]))
  }, [tracks])

  useEffect(() => {
    const canvas = cv.current!, ed = getEditor()
    const css = getComputedStyle(document.documentElement)
    const col = (n: string) => css.getPropertyValue(n).trim()
    const C = { bg: col('--bg'), panel: col('--panel'), line: col('--line'), text: col('--text'), accent: col('--accent'), rest: col('--rest'), piece: col('--piece'), inertia: col('--inertia'), blend: col('--blend') }
    let W = 0, H = 0, raf = 0, drag: Drag | null = null, ghost: { y: number; start: number; len: number; color: string } | null = null, timer = 0, scrollY = 0, scrollTo = 0 // rows: shown offset, and where the wheel is easing it to
    let sbHover = false, sbDrag = false, hbHover = false, hbDrag = false

    const scale = (): TimeScale => ({ x0: LABEL_W - tv.scrollF * tv.ppf, pxPerFrame: tv.ppf })
    // V1 (always first) only shows once the project has media
    const tracks = () => { const p = ed.getState().project; return p.sequence.tracks.filter(t => t.kind === 'motion' || (isVideo(t) && p.media.length > 0)) }
    const refLen = (it: Item) => { const p = ed.getState().project; return p.clips[it.refId]?.length ?? p.media.find(m => m.id === it.refId)?.durationF ?? 0 }
    const refName = (it: Item) => { const p = ed.getState().project; return p.clips[it.refId]?.name ?? p.media.find(m => m.id === it.refId)?.name ?? '' }
    // items of a track with the drag preview applied
    const shown = (t: Track): Item[] => t.items.map(it => {
      if (!drag || drag.itemId !== it.id) return it
      const clipLen = refLen(it), d = drag.df
      if (drag.mode === 'move') return { ...it, start: Math.max(0, it.start + d) }
      if (drag.mode === 'in') { const k = Math.min(Math.max(d, -it.trimIn), itemLen(it) - 1); return { ...it, start: it.start + k, trimIn: it.trimIn + k } }
      return { ...it, trimOut: it.trimOut + Math.min(Math.max(d, 1 - itemLen(it)), clipLen - it.trimOut) }
    })
    const stairs = (t: Track) => !isVideo(t) && exp.current.has(t.id) // pieces laid out one per lane below the track row
    const layout = (): Row[] => {
      const out: Row[] = []
      let y = RULER_H - scrollY
      for (const t of tracks()) {
        out.push({ t, y, h: ROW_H }); y += ROW_H
        if (stairs(t)) for (const it of sortedItems(t)) { // one lane per piece, going down; a 수정 row under a piece with a 수정 층
          out.push({ t, it, y, h: ROW_H }); y += ROW_H
          if (hasEdit(it) && !it.noOriginal) { out.push({ t, it, y, h: ROW_H, edit: true }); y += ROW_H } // 원본 삭제: the lane is the 수정본
        }
      }
      return out
    }
    // horizontal scrollbar under the lanes (px along x): the sequence plus half a screen of room after its end; null when it all fits
    const hbar = () => {
      const vis = (W - SB_W - LABEL_W) / tv.ppf, end = sequenceEnd(ed.getState().project) + vis / 2
      return sbGeom(LABEL_W, W - SB_W, Math.max(end, tv.scrollF + vis) * tv.ppf, tv.scrollF * tv.ppf)
    }
    const hbH = () => hbar() ? SB_W : 0 // rows end above it
    const maxScroll = () => Math.max(0, layout().reduce((a, r) => a + r.h, 0) - (H - hbH() - RULER_H)) // 0 when the rows fit
    const sbar = () => sbGeom(RULER_H, H - hbH(), layout().reduce((a, r) => a + r.h, 0), scrollY) // vertical scrollbar, null when the rows fit
    const flash = (text: string, row: number) => {
      const r = layout()[row]
      if (!r) return
      setMsg({ text, left: LABEL_W + 4, top: r.y + r.h + 2 })
      clearTimeout(timer); timer = window.setTimeout(() => setMsg(null), 2000)
    }

    // stored assist result of a motion item, and whether the current project would export a different CSV
    const phys = (t: Track, it: Item) => {
      const s = ed.getState(), st = usePhysics.getState().byItem[it.id]
      return { st, old: !!t.actorId && stale(s.project, s.defs, t.actorId, it.id) }
    }
    const GRAPH = 0.6 // graph fills the bar's bottom 40%
    // lead-in / tail lengths walk the whole clip (foot contact, motion amount): during a slider or gizmo drag the lanes keep the
    // lengths from the drag start and catch up when it ends
    const leads = new Map<string, ReturnType<typeof itemLead>>(), tails = new Map<string, ReturnType<typeof itemTail>>()
    // `side`: from the original or the 수정본 (each row draws its own; the settings are the piece's, shared); none = the side in use
    type Side = 'original' | 'edit' | undefined
    const sided = (it: Item, side: Side) => { const s = ed.getState(); if (!side) return { p: s.project, it }
      const use = side === 'original' ? 'original' as const : null, n = { ...it }; if (use) n.use = use; else delete n.use
      return { p: withUse(s.project, it.id, use), it: n } }
    const leadOf = (it: Item, side?: Side) => { const s = ed.getState(), k = `${it.id}:${side ?? ''}`
      if (!s.inGesture || !leads.has(k)) { const v = sided(it, side); leads.set(k, itemLead(v.p, s.defs, v.it)) } return leads.get(k)! }
    const tailOf = (it: Item, side?: Side) => { const s = ed.getState(), k = `${it.id}:${side ?? ''}`
      if (!s.inGesture || !tails.has(k)) { const v = sided(it, side); tails.set(k, itemTail(v.p, s.defs, v.it)) } return tails.get(k)! }
    // a lane of a piece with a 수정본 shows the original (its 수정 row the 수정본); a 수정본-only lane and a collapsed row: the side in use
    const laneSide = (it: Item, lane: boolean): Side => lane && offsetKeyCount(it) > 0 && !it.noOriginal ? 'original' : undefined
    seqFlash.fn = (text, itemId) => flash(text, layout().findIndex(r => !r.it && r.t.items.some(i => i.id === itemId)))

    const draw = () => {
      raf = 0
      const s = ed.getState(), dpr = window.devicePixelRatio || 1
      if (followStep({ frame: s.frame, playF: s.frame, playing: s.playing, visibleF: (W - LABEL_W) / tv.ppf, contentEnd: sequenceEnd(s.project) })) schedule()
      const sc = scale()
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H)
      ctx.font = '11px "IBM Plex Sans KR", sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
      const hatch = (a: number, b: number, y: number, alpha: number) => {
        ctx.save(); ctx.beginPath(); ctx.rect(a, y + 2, b - a, ROW_H - 5); ctx.clip()
        ctx.strokeStyle = C.text; ctx.globalAlpha = alpha; ctx.lineWidth = 1; ctx.beginPath()
        for (let hx = a - ROW_H; hx < b + ROW_H; hx += 6) {
          ctx.moveTo(hx, y + ROW_H - 3); ctx.lineTo(hx + ROW_H - 5, y + 2)
          ctx.moveTo(hx, y + 2); ctx.lineTo(hx + ROW_H - 5, y + ROW_H - 3)
        }
        ctx.stroke(); ctx.restore()
      }
      // rows: clamp first (rows collapsed or the panel grew), then ease toward the wheel target; laid out only after that, so a frame
      // never shows the rows shifted past the end (that one-frame jump was the flicker)
      const maxY = maxScroll()
      scrollTo = Math.min(Math.max(scrollTo, 0), maxY)
      if (scrollY > maxY) scrollY = maxY
      if (scrollY !== scrollTo) { scrollY = Math.abs(scrollTo - scrollY) < 0.5 ? scrollTo : scrollY + (scrollTo - scrollY) * 0.35; schedule() }
      const rows = layout()
      // 기본자세 blocks of one piece on a lane row at y (덮어쓰기: the first 1.5 s; 덧붙이기: 기본자세 · 전이 · 관성 before the bar;
      // 끝 기본자세: 전이 · 기본자세 after it), each labelled where the word fits. Used by the 수정 row (the lanes draw theirs in bars()).
      const restBlocks = (it: Item, ld: ReturnType<typeof itemLead>, tl: ReturnType<typeof itemTail>, y: number, ga: number) => {
        const x = frameToX(sc, it.start), w = itemLen(it) * tv.ppf, by = y + 2, bh = ROW_H - 5, spans: [string, number, number][] = []
        const put = (label: string, c: string, x0: number, n: number) => { ctx.fillStyle = c; ctx.fillRect(x0, by, n * tv.ppf, bh); spans.push([label, x0, x0 + n * tv.ppf]); return x0 + n * tv.ppf }
        ctx.globalAlpha = 0.55 * ga
        if (it.restPose === true) put('기본자세', C.rest, x, Math.min(OVERWRITE, itemLen(it)))
        else if (it.restPose === 'prepend' && ld) { let xs = x - ld.lead * tv.ppf; xs = put('기본자세', C.rest, xs, ld.hold); xs = put('전이', C.blend, xs, ld.blend); put('관성', C.inertia, xs, ld.inertia) }
        if (tl) put('기본자세', C.rest, put('전이', C.blend, x + w, tl.blend), tl.hold)
        ctx.globalAlpha = ga; ctx.fillStyle = C.text
        for (const [t, a0, a1] of spans) { const a = Math.max(a0, LABEL_W); if (a1 - a >= ctx.measureText(t).width + 8) ctx.fillText(t, a + 4, y + ROW_H / 2) }
      }
      // Bars of `items` in one row at y: fill, 기본자세 section, outline, assist graph, crossfade hatch over `xfade`, labels.
      const bars = (t: Track, items: Item[], y: number, color: string, lane: boolean, xfade: [number, number][]) => {
        const video = isVideo(t), actor = s.project.actors.find(a => a.id === t.actorId)
        ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, y, W - LABEL_W, ROW_H); ctx.clip()
        const unused = lane && !!items[0] && items[0].use !== 'original' && hasEdit(items[0]) && !items[0].noOriginal // the piece plays its 수정본: the original lane is the unused side
        const ga = (t.locked ? 0.5 : 1) * (lane && items[0]?.hidden ? 0.4 : 1) * (unused ? 0.45 : 1) // locked: half transparent, no hatch; hidden / unused: faded
        ctx.globalAlpha = ga
        for (const it of items) {
          const x = frameToX(sc, it.start), w = itemLen(it) * tv.ppf, by = y + 2, bh = ROW_H - 5
          if (video) { ctx.fillStyle = C.panel; ctx.fillRect(x, by, w, bh) }
          else { ctx.fillStyle = color; ctx.globalAlpha = 0.18 * ga; ctx.fillRect(x, by, w, bh); ctx.globalAlpha = ga }
          if (it.restPose) { // 기본자세 section in its own colour: 덮어쓰기 = the first 1.5 s; 덧붙이기 = the lead-in played before the piece
            ctx.fillStyle = C.rest; ctx.globalAlpha = 0.55 * ga
            const ld = leadOf(it, laneSide(it, lane))
            if (!ld) ctx.fillRect(x, by, Math.min(OVERWRITE, itemLen(it)) * tv.ppf, bh)
            else { // 기본자세 (정지) · 전이 · 관성 (original frames), each in its own colour; one row: a strip, so the piece before stays visible
              let xs = x - ld.lead * tv.ppf
              for (const [n, c] of [[ld.hold, C.rest], [ld.blend, C.blend], [ld.inertia, C.inertia]] as const) {
                ctx.fillStyle = c; ctx.fillRect(xs, by, n * tv.ppf, lane ? bh : 4); xs += n * tv.ppf
              }
            }
            ctx.globalAlpha = ga
          }
          const tl = tailOf(it, laneSide(it, lane))
          if (tl) { // 끝 기본자세 after the piece's end: 전이 then 기본자세 (정지); one row: a strip, so the next piece stays visible
            ctx.globalAlpha = 0.55 * ga
            let xs = x + w
            for (const [n, c] of [[tl.blend, C.blend], [tl.hold, C.rest]] as const) { ctx.fillStyle = c; ctx.fillRect(xs, by, n * tv.ppf, lane ? bh : 4); xs += n * tv.ppf }
            ctx.globalAlpha = ga
          }
          if (it.offset && !lane) { // 수정 층 keys (collapsed row; a lane has its 수정 row): ticks along the bar's bottom edge (clip frames inside the trim)
            ctx.fillStyle = C.piece; ctx.globalAlpha = ga
            const fs = new Set(Object.values(it.offset).flatMap(c => c.keys.map(k => k.f)).filter(f => f >= it.trimIn && f < it.trimOut))
            for (const f of fs) ctx.fillRect(Math.round(frameToX(sc, it.start + f - it.trimIn)) - 1, by + bh - 4, 2, 4)
          }
          if (video && !mediaUrl(it.refId)) hatch(x, x + w, y, 0.25) // offline
          ctx.strokeStyle = it.id === s.selItem && !(lane && s.selEdit) ? C.accent : it.noOriginal ? C.piece : video ? C.line : color; ctx.lineWidth = 1
          ctx.strokeRect(x + 0.5, by + 0.5, w - 1, bh - 1)
          if (it.id === s.itemPreview && !(lane && s.previewEdit)) { // the piece open in the clip preview: a light dashed frame inside the bar (수정 비교: on its 수정 row)
            ctx.save(); ctx.strokeStyle = C.text; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3])
            ctx.strokeRect(x + 2.5, by + 2.5, w - 5, bh - 5); ctx.restore()
          }
          const { st, old } = video ? { st: undefined, old: false } : phys(t, it)
          if (st?.metrics && actor) drawAssist(ctx, st.metrics.pct, st.metrics.segments, seqFrameOf(s.project, s.defs, it, 0), sc, Math.max(x, LABEL_W), x + w,
            by + bh * GRAPH, bh * (1 - GRAPH), color, withDefaults(s.project.physics)[actor.robot].warnPct, old)
        }
        for (const [a, b] of xfade) hatch(frameToX(sc, a), frameToX(sc, b), y, 0.5) // crossfade, hatched both ways
        ctx.fillStyle = C.text
        for (const it of items) {
          // 기본자세 section label: only where the whole word fits inside the coloured block (덧붙이기 only in a lane)
          const ld = it.restPose === 'prepend' ? leadOf(it, laneSide(it, lane)) : null
          const rb = it.restPose === true ? [frameToX(sc, it.start), Math.min(OVERWRITE, itemLen(it)) * tv.ppf]
            : ld && lane ? [frameToX(sc, it.start) - ld.lead * tv.ppf, ld.hold * tv.ppf] : null
          const tag = (text: string, x0: number, x1: number) => { // a section label, only where the whole word fits inside its block
            const a = Math.max(x0, LABEL_W)
            if (x1 - a >= ctx.measureText(text).width + 8) ctx.fillText(text, a + 4, y + ROW_H / 2)
          }
          if (rb) tag('기본자세', rb[0], rb[0] + rb[1])
          if (rb && ld) {
            const b0 = rb[0] + rb[1], b1 = b0 + ld.blend * tv.ppf
            tag('전이', b0, b1)
            tag('관성', b1, b1 + ld.inertia * tv.ppf)
          }
          const tl = lane ? tailOf(it, laneSide(it, lane)) : null
          if (tl) { const e0 = frameToX(sc, it.start + itemLen(it)), e1 = e0 + tl.blend * tv.ppf; tag('전이', e0, e1); tag('기본자세', e1, e1 + tl.hold * tv.ppf) }
          const x = Math.max(frameToX(sc, it.start) + (it.restPose === true && rb ? rb[1] : 0), LABEL_W) + 4, right = frameToX(sc, it.start + itemLen(it)) - 4 // 덮어쓰기: the name after the block
          const { st, old } = video ? { st: undefined, old: false } : phys(t, it), b = badge(st, old)
          const ty = st?.metrics ? y + 9 : y + ROW_H / 2 // above the graph
          const br = Math.min(right, W - 4), bw = b && br - x >= ctx.measureText(b).width ? ctx.measureText(b).width + 8 : 0
          if (b && bw) { // badge at the bar's (visible) right end
            ctx.fillStyle = b.startsWith('⚠') || st?.status === 'error' ? WARN_RED : old ? '#8d96a3' : C.text
            ctx.fillText(b, br - bw + 8, ty); ctx.fillStyle = C.text
          }
          const nr = bw ? br - bw : right
          if (nr > x) ctx.fillText((video ? refName(it) : it.noOriginal ? editName(t, it, refName(it)) : pieceName(t, it, refName(it))) + (video && !mediaUrl(it.refId) ? ' (오프라인)' : ''), x, ty, nr - x)
        }
        ctx.restore()
      }
      // overlaps of neighbouring items (crossfades) as frame ranges
      const overlaps = (items: Item[]) => items.slice(1).map((n, k) => [n.start, items[k].start + itemLen(items[k])] as [number, number]).filter(([a, b]) => b > a)
      rows.forEach(r => {
        const { t, y } = r, actor = s.project.actors.find(a => a.id === t.actorId), video = isVideo(t)
        const color = actor?.color ?? C.text
        const items = sortedItems({ ...t, items: shown(t) })
        ctx.fillStyle = C.line; ctx.fillRect(0, y + ROW_H - 1, W, 1)
        const useMark = (it: Item, mine: boolean) => { // ● on the side that plays and exports, ○ on the other (click to switch)
          if (!hasEdit(it)) return
          ctx.save(); ctx.strokeStyle = ctx.fillStyle = mine ? C.piece : C.line; ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.arc(USE_X, y + ROW_H / 2, 3.5, 0, Math.PI * 2); if (mine) ctx.fill(); else ctx.stroke(); ctx.restore()
        }
        if (r.edit && r.it) { // 수정 row: the piece's 수정본, the frames its 수정 keys span strong; moves and trims with the piece
          const it = items.find(i => i.id === r.it!.id) ?? r.it, used = it.use !== 'original'
          ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, y, W - LABEL_W, ROW_H); ctx.clip()
          const ga = (t.locked ? 0.5 : 1) * (used ? 1 : 0.45), x = frameToX(sc, it.start), w = itemLen(it) * tv.ppf, by = y + 2, bh = ROW_H - 5
          ctx.globalAlpha = 0.18 * ga; ctx.fillStyle = C.piece; ctx.fillRect(x, by, w, bh)
          restBlocks(it, leadOf(it, 'edit'), tailOf(it, 'edit'), y, ga) // 기본자세 · 전이 · 관성 / 끝 기본자세 of the 수정본
          const fs = Object.values(it.offset ?? {}).flatMap(c => c.keys.map(k => k.f))
          const a = Math.max(Math.min(...fs), it.trimIn), b = Math.min(Math.max(...fs) + 1, it.trimOut)
          if (b > a) { ctx.globalAlpha = 0.5 * ga; ctx.fillRect(frameToX(sc, it.start + a - it.trimIn), by, (b - a) * tv.ppf, bh) }
          ctx.globalAlpha = ga
          for (const f of new Set(fs)) if (f >= it.trimIn && f < it.trimOut) ctx.fillRect(Math.round(frameToX(sc, it.start + f - it.trimIn)) - 1, by + bh - 4, 2, 4)
          ctx.strokeStyle = it.id === s.selItem && s.selEdit ? C.accent : C.piece; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, by + 0.5, w - 1, bh - 1)
          if (it.id === s.itemPreview && s.previewEdit) { // open in the 수정본 pane: the dashed frame
            ctx.save(); ctx.strokeStyle = C.text; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.strokeRect(x + 2.5, by + 2.5, w - 5, bh - 5); ctx.restore()
          }
          ctx.fillStyle = C.text
          const tx = Math.max(x + (it.restPose === true ? Math.min(OVERWRITE, itemLen(it)) * tv.ppf : 0), LABEL_W) + 4 // 덮어쓰기: after its block
          if (x + w - 4 > tx) ctx.fillText(editName(t, it, refName(it)), tx, y + ROW_H / 2, x + w - 4 - tx)
          ctx.restore()
          ctx.fillStyle = C.bg; ctx.fillRect(0, y, LABEL_W - 1, ROW_H - 1)
          useMark(it, used)
          ctx.font = '10px "IBM Plex Sans KR", sans-serif'; ctx.fillStyle = it.id === s.selItem && s.selEdit ? C.accent : C.piece
          ctx.fillText(fit(ctx, (it.id === s.itemPreview && s.previewEdit ? '▶ ' : '') + `${laneLabel(t, it)} 수정본`, LABEL_W - 8 - CHILD_X), CHILD_X, y + ROW_H / 2)
          ctx.font = '11px "IBM Plex Sans KR", sans-serif'
          return
        }
        if (r.it) { // piece lane (staircase): that piece's bar, with the crossfades it takes part in
          const it = items.find(i => i.id === r.it!.id) ?? r.it
          bars(t, [it], y, color, true, overlaps(items).filter(([a, b]) => a < it.start + itemLen(it) && b > it.start))
          ctx.fillStyle = C.bg; ctx.fillRect(0, y, LABEL_W - 1, ROW_H - 1)
          if (!it.noOriginal) useMark(it, it.use === 'original')
          drawEye(ctx, EYE_X, y + ROW_H / 2, !!it.hidden, it.hidden ? C.accent : C.line)
          ctx.font = '10px "IBM Plex Sans KR", sans-serif'
          ctx.fillStyle = it.id === s.selItem && !s.selEdit ? C.accent : it.noOriginal ? C.piece : C.text
          // the column is narrow: "#n · start" (the bar shows the clip name), a short physics tag on the right; the full text on hover
          const { st, old } = phys(t, r.it), tag = treeTag(st, old), right = EYE_X - ICON_HIT / 2 - 4, tw = tag.text ? ctx.measureText(tag.text).width + 6 : 0
          if (tag.text) {
            ctx.save(); ctx.textAlign = 'right'; ctx.fillStyle = tag.warn ? WARN_RED : '#8d96a3'; ctx.fillText(tag.text, right, y + ROW_H / 2); ctx.restore()
          }
          const warn = (it.id === s.itemPreview && !s.previewEdit ? '▶ ' : '') + (it.restPose === 'prepend' && leadOf(it, laneSide(it, true))?.why === 'review' ? '⚠ ' : '') // 관성 검토 필요, in front so it is never cut
          ctx.fillText(fit(ctx, warn + laneLabel(t, it) + (it.noOriginal ? ' 수정본' : ''), right - CHILD_X - tw), CHILD_X, y + ROW_H / 2)
          ctx.font = '11px "IBM Plex Sans KR", sans-serif'
          return
        }
        if (!stairs(t)) bars(t, items, y, color, false, overlaps(items)) // expanded: the bars are in the lanes below
        ctx.fillStyle = C.bg; ctx.fillRect(0, y, LABEL_W, ROW_H - 1)
        ctx.globalAlpha = t.hidden ? 0.4 : 1
        if (!video) { ctx.fillStyle = C.text; ctx.fillText(exp.current.has(t.id) ? '▾' : '▸', 6, y + ROW_H / 2) }
        ctx.fillStyle = color; ctx.fillText(video ? 'V1 참조영상' : actor?.name ?? '', video ? 8 : NAME_X, y + ROW_H / 2, (video ? EYE_X - 8 : TRAIL_X - NAME_X) - 9)
        ctx.globalAlpha = 1
        drawEye(ctx, EYE_X, y + ROW_H / 2, t.hidden, t.hidden ? C.accent : C.line)
        drawLock(ctx, LOCK_X, y + ROW_H / 2, t.locked, t.locked ? C.accent : C.line)
        if (!video) drawTrail(ctx, TRAIL_X, y + ROW_H / 2, t.trail ? C.accent : C.line)
      })
      if (ghost) {
        ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, RULER_H, W - LABEL_W, H - RULER_H); ctx.clip()
        const gx = frameToX(sc, ghost.start), gw = ghost.len * tv.ppf
        ctx.globalAlpha = 0.3; ctx.fillStyle = ghost.color; ctx.fillRect(gx, ghost.y + 2, gw, ROW_H - 5)
        ctx.globalAlpha = 1; ctx.strokeStyle = ghost.color; ctx.strokeRect(gx + 0.5, ghost.y + 2.5, gw - 1, ROW_H - 6)
        ctx.restore()
      }
      drawRuler(ctx, sc, W, RULER_H, s.project.sequence, s.frame, C, true)
      const px = Math.round(frameToX(sc, s.frame)) + 0.5
      if (px >= LABEL_W) { ctx.fillStyle = C.accent; ctx.fillRect(px - 0.5, RULER_H, 1, H - RULER_H) }
      ctx.fillStyle = C.line; ctx.fillRect(LABEL_W - 1, 0, 1, H)
      const sb = sbar()
      if (sb) drawScrollbar(ctx, W, sb, sbHover, sbDrag, C)
      const hb = hbar()
      if (hb) drawHScrollbar(ctx, H, hb, hbHover, hbDrag, C)
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw) }
    redraw.current = schedule

    const resize = () => {
      const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect()
      W = r.width; H = r.height
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
      schedule()
    }
    resetFollow()
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize()
    const unsub = ed.subscribe(schedule), unsubMedia = subscribeMedia(schedule), unsubPhys = usePhysics.subscribe(schedule)
    document.fonts?.addEventListener('loadingdone', schedule) // labels drawn in the fallback font before IBM Plex arrived

    // ---- mouse ----
    const pos = (e: { clientX: number; clientY: number }) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    const frameAt = (x: number) => Math.max(0, xToFrame(scale(), x))
    const track = trackDrag
    const rowAt = (y: number) => y < RULER_H ? -1 : layout().findIndex(r => y >= r.y && y < r.y + r.h)
    // topmost item under (x, y) with the zone of the hit: a lane holds its piece, a collapsed track row all of them
    const itemAt = (x: number, y: number) => {
      const r = layout()[rowAt(y)], t = r?.t
      if (!t || y < RULER_H || x < LABEL_W || (!r.it && stairs(t)) || r.edit) return null // a 수정 row is not moved or trimmed
      const sc = scale()
      const items = r.it ? t.items.filter(i => i.id === r.it!.id) : sortedItems(t).reverse() // later item wins
      const span = (i: Item) => { const x0 = frameToX(sc, i.start), x1 = frameToX(sc, i.start + itemLen(i)); return { x0, x1, edge: Math.min(EDGE, (x1 - x0) / 3) } }
      for (const it of items) { // edges of every item first, so a crossfade tail stays trimmable
        const { x0, x1, edge } = span(it)
        if (x >= x0 && x - x0 < edge) return { t, it, mode: 'in' as Drag['mode'] }
        if (x <= x1 && x1 - x < edge) return { t, it, mode: 'out' as Drag['mode'] }
      }
      const it = items.find(i => { const { x0, x1 } = span(i); return x >= x0 && x <= x1 })
      return it ? { t, it, mode: 'move' as Drag['mode'] } : null
    }

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      canvas.focus()
      const { x, y } = pos(e), s = ed.getState(), row = rowAt(y)
      if (y < RULER_H) {
        const mi = hitMarker(s.project.sequence, scale(), x)
        if (mi !== null) { s.setFrame(s.project.sequence.markers[mi].f); return }
        s.setFrame(frameAt(x)); track(m => s.setFrame(frameAt(pos(m).x)), () => {})
        return
      }
      const sb = sbar()
      if (sb && x >= W - SB_W) { pressScrollbar(sb, y, scrollY, v => { scrollY = scrollTo = v; schedule() }, on => { sbDrag = on; schedule() }, track, m => pos(m).y); return }
      const hb = hbar()
      if (hb && y >= H - SB_W && x >= LABEL_W) {
        pressScrollbar(hb, x, tv.scrollF * tv.ppf, v => { markUserScroll(); tv.scrollF = v / tv.ppf; schedule() }, on => { hbDrag = on; schedule() }, track, m => pos(m).x)
        return
      }
      const r = layout()[row]
      if (r?.it && hasEdit(r.it) && !r.it.noOriginal && x >= NAME_X && x < CHILD_X) { // ●: this row's side plays and exports
        if (!s.setItemUse(r.it.id, r.edit ? null : 'original')) flash(r.t.locked ? LOCKED : DENY, row)
        return
      }
      if (r?.edit && r.it) { // 수정 row (label or bar): select the piece and open 수정 비교; empty time: seek
        const it = r.it, x0 = frameToX(scale(), it.start), x1 = frameToX(scale(), it.start + itemLen(it))
        if (x >= LABEL_W && (x < x0 || x > x1)) { s.selectItem(null); s.setFrame(frameAt(x)); track(m => s.setFrame(frameAt(pos(m).x)), () => {}); return }
        s.selectItem(it.id, true) // the 수정본 itself: Delete removes only it
        if (r.t.actorId) s.select(r.t.actorId)
        s.openEditCompare(it.id)
        return
      }
      if (r?.it && x < LABEL_W && Math.abs(x - EYE_X) <= ICON_HIT / 2) { s.setItemHidden(r.it.id, !r.it.hidden); return } // the piece's 숨기기
      if (r?.it && x < LABEL_W) { // lane label: select the piece and preview it
        s.selectItem(r.it.id)
        if (r.t.actorId) s.select(r.t.actorId)
        s.openItemPreview(r.it.id)
        return
      }
      if (x < LABEL_W) {
        const t = r?.t
        if (!t) return
        if (!isVideo(t) && x < TRI_W) setExpanded(e => { const n = new Set(e); if (!n.delete(t.id)) n.add(t.id); return n })
        else if (!isVideo(t) && Math.abs(x - TRAIL_X) <= ICON_HIT / 2) s.setTrackFlag(t.id, 'trail', !t.trail)
        else if (Math.abs(x - EYE_X) <= ICON_HIT / 2) s.setTrackFlag(t.id, 'hidden', !t.hidden)
        else if (Math.abs(x - LOCK_X) <= ICON_HIT / 2) s.setTrackFlag(t.id, 'locked', !t.locked)
        else if (t.actorId) s.select(t.actorId)
        return
      }
      const hit = itemAt(x, y)
      if (!hit) {
        s.selectItem(null); s.setFrame(frameAt(x))
        track(m => s.setFrame(frameAt(pos(m).x)), () => {})
        return
      }
      const { t, it, mode } = hit
      const m = usePhysics.getState().byItem[it.id]?.metrics, ry = layout()[row].y
      if (m && t.actorId && mode === 'move' && y >= ry + 2 + (ROW_H - 5) * GRAPH && !stale(s.project, s.defs, t.actorId, it.id)) {
        const seg = segmentAt(m.segments, xToFrame(scale(), x) - seqFrameOf(s.project, s.defs, it, 0)) // red span: jump to its start
        if (seg) { hover.stop(); s.selectItem(it.id); s.setFrame(Math.max(it.start, seqFrameOf(s.project, s.defs, it, seg.from))); return } // drop the pending hover scrub
      }
      s.selectItem(it.id)
      if (t.actorId) s.select(t.actorId)
      track(m => {
        const df = Math.round((pos(m).x - x) / tv.ppf)
        if (df !== (drag?.df ?? 0)) { drag = { itemId: it.id, mode, df }; schedule() }
      }, m => {
        const df = Math.round((pos(m).x - x) / tv.ppf), st = ed.getState()
        drag = null
        if (df === 0 && r?.it) st.openItemPreview(it.id) // a click on a lane bar also previews that piece
        if (df !== 0) {
          const ok = mode === 'move' ? st.moveItem(it.id, Math.max(0, it.start + df)) : st.trimItem(it.id, mode, df)
          if (!ok) flash(t.locked ? LOCKED : DENY, row)
        }
        schedule()
      }, () => { drag = null; schedule() })
    }

    const onDbl = (e: MouseEvent) => {
      const { x, y } = pos(e), s = ed.getState()
      if (y < RULER_H) {
        const mi = hitMarker(s.project.sequence, scale(), x)
        if (mi !== null) { cancel.current = false; setRename({ index: mi, left: Math.max(LABEL_W, x - 55), value: s.project.sequence.markers[mi].name }) }
        return
      }
      const hit = itemAt(x, y)
      if (hit && !isVideo(hit.t)) s.openItem(hit.it.id)
    }

    const onContext = (e: MouseEvent) => {
      const { x, y } = pos(e), s = ed.getState()
      if (y >= RULER_H) { // motion item (bar or child row): item menu; motion track label: track menu
        const r = layout()[rowAt(y)]
        if (r && !r.it && x < LABEL_W && r.t.actorId && !isVideo(r.t)) { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, actorId: r.t.actorId, trackId: r.t.id, itemId: null }); return }
        const hit = r?.it ? { t: r.t, it: r.it } : itemAt(x, y)
        if (hit && hit.t.actorId && !isVideo(hit.t)) { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, actorId: hit.t.actorId, trackId: hit.t.id, itemId: hit.it.id }) }
        return
      }
      e.preventDefault()
      const mi = hitMarker(s.project.sequence, scale(), x)
      if (mi !== null) s.deleteMarker(mi)
    }

    const hover = hoverScrub(() => ed.getState().frame, f => { markHover(); ed.getState().setFrame(f) })
    const onMove = (e: MouseEvent) => {
      const { x, y } = pos(e), over = y >= RULER_H && x >= W - SB_W && !!sbar()
      const overH = !over && y >= H - SB_W && x >= LABEL_W && !!hbar()
      if (over !== sbHover) { sbHover = over; schedule() }
      if (overH !== hbHover) { hbHover = overH; schedule() }
      if (over || overH) { canvas.style.cursor = ''; return }
      const h = itemAt(x, y)
      canvas.style.cursor = h && h.mode !== 'move' ? 'ew-resize' : ''
      // hover help for the track label icons
      const r = x < LABEL_W && y >= RULER_H ? layout()[rowAt(y)] : undefined, near = (ix: number) => Math.abs(x - ix) <= ICON_HIT / 2
      const onUse = x >= NAME_X && x < CHILD_X, useTip = (mine: boolean, side: string) => mine ? '재생·CSV에 이쪽을 씁니다' : `누르면 재생·CSV에 ${side}을 씁니다`
      const tip = !r ? '' : r.edit && r.it ? (onUse ? useTip(r.it.use !== 'original', '수정본')
          : `${editName(r.t, r.it, refName(r.it))} · ${editLabel(r.it).replace('수정 · ', '')}\nDelete: 수정본만 지움 (조각은 원본으로 남음)\n재생·CSV: ${r.it.use === 'original' ? '원본' : '수정본'}\n누르면 수정 비교 (메인 = 원본, 오른쪽 = 수정본)`)
        : r.it ? (hasEdit(r.it) && !r.it.noOriginal && onUse ? useTip(r.it.use === 'original', '원본') : near(EYE_X) ? '이 조각 숨기기' : laneTip(r.t, r.it))
        : !isVideo(r.t) && near(TRAIL_X) ? '경로 표시: 이 로봇의 골반이 지나간 바닥 경로를 메인 화면에 선으로 보여 줍니다'
        : near(EYE_X) ? '숨기기' : near(LOCK_X) ? '잠그기' : ''
      if (canvas.title !== tip) canvas.title = tip
      const f = hoverFrame(x, LABEL_W, scale(), e.buttons !== 0 || ed.getState().playing || renaming.current)
      if (f !== null) hover.push(Math.max(0, f))
    }

    // full text of a lane label (hover): piece, time range, clip, 기본자세, physics
    const laneTip = (t: Track, it: Item) => {
      const s = ed.getState(), { st, old } = phys(t, it), ld = it.restPose === 'prepend' ? leadOf(it) : null
      return childLabel(t, it, s.project.clips[it.refId]?.name ?? '') + treeSuffix(st, old).replace(/^ · /, '\n물리 검증: ')
        + (ld?.why === 'review' ? '\n관성 검토 필요' : '') + (it.restTail ? '\n끝 기본자세 (전이 · 정지 0.5초)' : '') +(it.noOriginal ? '\n원본 삭제됨 · 수정본만 재생·CSV' : hasEdit(it) ? `\n재생·CSV: ${it.use === 'original' ? '원본' : '수정본'}\nDelete: 원본만 지움 (수정본은 남음)` : '')
        + (it.id === s.itemPreview ? (s.previewEdit ? '\n수정 비교 중' : '\n클립 프리뷰에서 보는 중') : '')
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      markUserScroll()
      if (e.ctrlKey) {
        const { x } = pos(e), fAt = tv.scrollF + (x - LABEL_W) / tv.ppf
        tv.ppf = Math.min(Math.max(tv.ppf * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.5), 40)
        tv.scrollF = Math.max(0, fAt - (x - LABEL_W) / tv.ppf)
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { // time: Shift + wheel, or a sideways trackpad swipe
        tv.scrollF = Math.max(0, tv.scrollF + (e.shiftKey ? e.deltaY || e.deltaX : e.deltaX) / tv.ppf)
      } else scrollTo = Math.min(Math.max(scrollTo + (e.deltaMode === 1 ? e.deltaY * ROW_H : e.deltaY), 0), maxScroll()) // plain wheel: rows only, eased in draw (nothing moves when they fit)
      schedule()
    }

    // ---- asset drag from the project panel: the ghost bar and the drop use the same dropPlacement ----
    const setGhost = (g: typeof ghost) => { ghost = g; schedule() }
    const dropAt = (e: DragEvent) => { const { x, y } = pos(e); return { row: layout()[rowAt(y)], frame: frameAt(x) } } // a child row drops onto its track
    const onDragOver = (e: DragEvent) => {
      if (!isAssetDrag(e.dataTransfer ?? null)) return
      e.preventDefault()
      const asset = draggedAsset(null)
      if (!asset) return
      const { row, frame } = dropAt(e), p = ed.getState().project, pl = dropPlacement(p, asset, row?.t.id ?? null, frame)
      if (pl.kind === 'reject') return setGhost(null)
      const rows = layout(), last = rows.at(-1), bottom = last ? last.y + last.h : RULER_H - scrollY
      if (pl.kind === 'newActor') setGhost({ y: bottom, start: pl.start, len: p.clips[asset.id].length, color: COLOR[pl.robot] })
      else {
        const t = pl.kind === 'video' ? rows.find(r => !r.it && isVideo(r.t)) : rows.find(r => !r.it && r.t.id === pl.trackId)
        const actor = p.actors.find(a => a.id === t?.t.actorId)
        setGhost(t ? { y: t.y, start: pl.start, len: asset.kind === 'clip' ? p.clips[asset.id].length : p.media.find(m => m.id === asset.id)!.durationF, color: actor?.color ?? C.accent } : null)
      }
    }
    const onDrop = (e: DragEvent) => {
      setGhost(null)
      const asset = draggedAsset(e.dataTransfer ?? null)
      if (!asset) return
      e.preventDefault()
      const { row, frame } = dropAt(e), reason = dropAsset(asset, row?.t.id ?? null, frame)
      if (reason) flash(reason, Math.max(0, layout().findIndex(r => r === row)))
    }
    const clearGhost = () => { if (ghost) setGhost(null) }

    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('mousemove', onMove)
    const onLeave = () => { if (sbHover || hbHover) { sbHover = hbHover = false; schedule() } }
    canvas.addEventListener('mouseleave', onLeave)
    canvas.addEventListener('dblclick', onDbl)
    canvas.addEventListener('contextmenu', onContext)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dragover', onDragOver)
    canvas.addEventListener('drop', onDrop)
    canvas.addEventListener('dragleave', clearGhost)
    addEventListener('dragend', clearGhost)
    return () => {
      seqFlash.fn = null
      ro.disconnect(); document.fonts?.removeEventListener('loadingdone', schedule); unsub(); unsubMedia(); unsubPhys(); hover.stop(); cancelAnimationFrame(raf); clearTimeout(timer)
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
      canvas.removeEventListener('dblclick', onDbl)
      canvas.removeEventListener('contextmenu', onContext)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dragover', onDragOver)
      canvas.removeEventListener('drop', onDrop)
      canvas.removeEventListener('dragleave', clearGhost)
      removeEventListener('dragend', clearGhost)
    }
  }, [])

  const commit = () => {
    if (rename && !cancel.current) {
      const name = rename.value.trim()
      if (name) getEditor().getState().renameMarker(rename.index, name)
    }
    setRename(null)
  }
  const closeCtx = (refocus: boolean) => { setCtx(null); if (refocus) cv.current?.focus() }
  useEffect(() => {
    if (!ctx) return
    menuRef.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const away = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setCtx(null) }
    document.addEventListener('pointerdown', away); document.addEventListener('wheel', away, true); document.addEventListener('scroll', away, true)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('wheel', away, true); document.removeEventListener('scroll', away, true) }
  }, [ctx])
  const runExport = async (c: Ctx) => {
    const st = getEditor().getState(), m = await exportOne(st.project, st.defs, c.actorId, c.itemId!)
    if (m) seqFlash.fn?.(m, c.itemId!)
  }
  const project = useEditor(s => s.project), byItem = usePhysics(s => s.byItem)
  // a robot is known to have no physics model once one of its items came back 미지원
  const robotOf = (actorId?: string) => project.actors.find(a => a.id === actorId)?.robot
  const noModel = !!ctx && project.sequence.tracks.some(t => robotOf(t.actorId) === robotOf(ctx.actorId) && t.items.some(i => byItem[i.id]?.message === '미지원'))
  const runPhys = (c: Ctx) => {
    const t = project.sequence.tracks.find(t => t.id === c.trackId)
    if (t) void runItems((c.itemId ? [c.itemId] : sortedItems(t).map(i => i.id)).map(itemId => ({ actorId: c.actorId, itemId })))
  }
  const ctxItem = ctx?.itemId ? project.sequence.tracks.find(t => t.id === ctx.trackId)?.items.find(i => i.id === ctx.itemId) ?? null : null
  const rows = project.sequence.tracks.filter(t => t.kind === 'motion' || (isVideo(t) && project.media.length > 0))
  return (
    <div className="tl-body">
      <canvas ref={cv} tabIndex={0} className="track-canvas seq-canvas" />
      <div className="sr-only">
        {rows.map(t => {
          const name = isVideo(t) ? 'V1 참조영상' : project.actors.find(a => a.id === t.actorId)?.name ?? ''
          const flag = (f: 'hidden' | 'locked' | 'trail', label: string) =>
            <button aria-pressed={!!t[f]} onClick={() => getEditor().getState().setTrackFlag(t.id, f, !t[f])}>{name} {label}</button>
          const open = !isVideo(t) && expanded.has(t.id)
          return (
            <span key={t.id}>
              {!isVideo(t) && <button aria-expanded={open} onClick={() => toggle(t.id)}>{name} 클립 목록</button>}
              {!isVideo(t) && flag('trail', '경로 표시')}{flag('hidden', '숨기기')}{flag('locked', '잠그기')}
              {open && sortedItems(t).map(it => (
                <button key={it.id} onClick={() => { const s = getEditor().getState(); s.selectItem(it.id); s.openItemPreview(it.id) }}>
                  {childLabel(t, it, project.clips[it.refId]?.name ?? '')} 클립 프리뷰
                </button>
              ))}
              {open && sortedItems(t).map(it => (
                <button key={`h${it.id}`} aria-pressed={!!it.hidden} onClick={() => getEditor().getState().setItemHidden(it.id, !it.hidden)}>
                  {childLabel(t, it, project.clips[it.refId]?.name ?? '')} 숨기기
                </button>
              ))}
              {open && sortedItems(t).filter(it => hasEdit(it) && !it.noOriginal).map(it => {
                const l = childLabel(t, it, project.clips[it.refId]?.name ?? ''), s = () => getEditor().getState()
                return (
                  <span key={`e${it.id}`}>
                    <button aria-pressed={it.use !== 'original'} onClick={() => s().setItemUse(it.id, null)}>{l} 수정본 사용</button>
                    <button aria-pressed={it.use === 'original'} onClick={() => s().setItemUse(it.id, 'original')}>{l} 원본 사용</button>
                    <button onClick={() => { s().selectItem(it.id); s().openEditCompare(it.id) }}>{l} 수정 비교</button>
                  </span>
                )
              })}
            </span>
          )
        })}
      </div>
      {!rows.length && <div className="seq-empty">CSV 가져오기로 모션을 불러오세요</div>}
      {ctx && (
        <div ref={menuRef} role="menu" aria-label="클립" className="tl-menu" style={{ left: ctx.x, top: ctx.y }}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCtx(true) } else if (e.key === 'Tab') closeCtx(true)
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const its = [...menuRef.current!.querySelectorAll<HTMLElement>('[role=menuitem]')], i = its.indexOf(document.activeElement as HTMLElement)
              its[(i + (e.key === 'ArrowDown' ? 1 : its.length - 1)) % its.length]?.focus()
            }
          }}>
          {ctx.itemId && <button role="menuitem" tabIndex={-1} onClick={() => { closeCtx(false); void runExport(ctx) }}>export하기</button>}
          {ctxItem && hasEdit(ctxItem) && !ctxItem.noOriginal && (['수정본 사용', '원본 사용'] as const).map(l => {
            const use = l === '원본 사용' ? 'original' : null, on = (ctxItem.use ?? null) === use
            return <button key={l} role="menuitem" tabIndex={-1} aria-disabled={on} title={on ? '지금 재생·CSV에 쓰는 쪽입니다' : undefined}
              onClick={() => { if (on) return; closeCtx(false); if (!getEditor().getState().setItemUse(ctxItem.id, use)) seqFlash.fn?.(LOCKED, ctxItem.id) }}>{on ? '● ' : ''}{l}</button>
          })}
          {ctxItem && hasEdit(ctxItem) && !ctxItem.noOriginal && <button role="menuitem" tabIndex={-1} onClick={() => { closeCtx(false); getEditor().getState().openEditCompare(ctxItem.id) }}>수정 비교</button>}
          {ctxItem && hasEdit(ctxItem) && <button role="menuitem" tabIndex={-1} title="수정본을 새 클립으로 목록에 넣고 이 조각이 그 클립을 씁니다"
            onClick={() => { closeCtx(false); if (!getEditor().getState().bakeEdit(ctxItem.id)) seqFlash.fn?.(LOCKED, ctxItem.id) }}>수정 완료 (새 클립으로)</button>}
          {ctxItem && hasEdit(ctxItem) && <button role="menuitem" tabIndex={-1} title="수정본만 지웁니다 (조각은 남음)"
            onClick={() => { closeCtx(false); if (!getEditor().getState().removePiece(ctxItem.id, 'edit')) seqFlash.fn?.(LOCKED, ctxItem.id) }}>수정본 삭제</button>}
          {ctxItem && hasEdit(ctxItem) && !ctxItem.noOriginal && <button role="menuitem" tabIndex={-1} title="원본 조각만 지웁니다 (수정본은 남음)"
            onClick={() => { closeCtx(false); if (!getEditor().getState().removePiece(ctxItem.id, 'piece')) seqFlash.fn?.(LOCKED, ctxItem.id) }}>원본 삭제</button>}
          <button role="menuitem" tabIndex={-1} aria-disabled={noModel} title={noModel ? '미지원' : undefined}
            onClick={() => { if (noModel) return; closeCtx(false); runPhys(ctx) }}>{ctx.itemId ? '물리 검증' : '트랙 물리 검증'}</button>
        </div>
      )}
      {msg && <div className="seq-msg" style={{ left: msg.left, top: msg.top }}>{msg.text}</div>}
      {rename && (
        <input className="seq-rename" autoFocus value={rename.value} style={{ left: rename.left }}
          onChange={e => setRename({ ...rename, value: e.target.value })} onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') { cancel.current = true; e.currentTarget.blur() }
          }} />
      )}
    </div>
  )
}
