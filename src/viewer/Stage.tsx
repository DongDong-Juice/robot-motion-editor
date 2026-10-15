import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { evalCurve } from '../model/curve'
import { COLOR } from '../model/defaults'
import { evaluate, evaluateClip, evaluateItem, evaluateRoot } from '../model/evaluate'
import { rebasePose } from '../model/pose'
import { itemLead, restClipFor, tailedClip } from '../model/restPose'
import { baseClip, editedClip, withUse } from '../model/itemClip'
import { nearestAngle } from '../model/rootMath'
import { hiddenAt, stitchTransforms, worldToClipRoot } from '../model/sequence'
import type { Clip, Project } from '../model/types'
import { actorOf, CLIP_ACTOR, clipLocked, editingItem, editTarget, getEditor, gizmoLock, trackLocked } from '../store/store'
import { sequenceEnd } from '../transport'
import { buildRobot, pivotAngle, type RobotRig } from './buildRobot'
import type { RobotDef } from '../robot/types'
import { followStep } from './follow'

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
const EXTENT = 5
const TARGET = new THREE.Vector3(0.75, 0, 0.6)
const EYE = new THREE.Vector3(3.2, -3.4, 2).sub(TARGET) // initial camera offset from the target
// unit directions from target: front (+x), side (-y), top (tiny y offset avoids up-vector degeneracy)
const VIEWS: Record<string, [number, number, number]> = { '1': [1, 0, 0.15], '3': [0, -1, 0.15], '7': [0, -0.001, 1] }

function makeGrid(): THREE.LineSegments {
  const fine: number[] = [], bold: number[] = []
  for (let i = -EXTENT * 2; i <= EXTENT * 2; i++) {
    const v = i / 2, out = i % 2 === 0 ? bold : fine
    out.push(v, -EXTENT, 0, v, EXTENT, 0, -EXTENT, v, 0, EXTENT, v, 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([...fine, ...bold], 3))
  const col = new THREE.Color(css('--line') || '#3B424D'), hi = col.clone().multiplyScalar(1.8)
  const colors: number[] = []
  for (let i = 0; i < fine.length / 3; i++) colors.push(col.r, col.g, col.b)
  for (let i = 0; i < bold.length / 3; i++) colors.push(hi.r, hi.g, hi.b)
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }))
}

const OVERLAY = '#6ED3A3' // 겹쳐 보기 ghost: the 조각 수정 층 colour (--piece)

// trailKey/trailClips: what the cached trail was built from (items + placement serialized, clips by identity)
interface Entry { rig: RobotRig; trail: THREE.Line; dot: THREE.Points; ghost: boolean; trailKey?: string; trailClips?: (Clip | undefined)[] }

/** One 3D view. `compareClipId` = a view-only compare pane: one robot at the origin driven by that clip from sequence frame 0 (no gizmo, picking or actors). Omitted = the main pane (every actor).
 * With `itemId` + `range`, an item with 기본자세 덧붙이기 plays its lead-in clip instead (preview only).
 * With `range` = [from, to) clip frames, the compare robot shows that range, root re-based so frame `from` sits at the origin: with `itemId` it follows
 * the main playhead (item start = `from`), else it loops on its own 60 fps clock. */
export default function Stage({ compareClipId: cid, range, itemId, children }: { compareClipId?: string; range?: [number, number]; itemId?: string; children?: ReactNode }) {
  const [lo, hi] = range ?? [0, 0]
  const host = useRef<HTMLDivElement>(null)
  // 로봇 따라가기: per-pane local UI state, read by the render loop through a ref
  const [follow, setFollow] = useState(false)
  const followRef = useRef(false)
  followRef.current = follow
  // 경로 표시 of a compare/clip pane (its one robot), off by default; the main pane follows each track's 경로 표시 (Track.trail, sequence)
  const [trail, setTrail] = useState(false)
  const trailRef = useRef(false)
  trailRef.current = trail

  useEffect(() => {
    const el = host.current!
    const ranged = hi > lo
    const store = getEditor()
    const target = TARGET.clone()
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(css('--bg') || '#22262D')
    const grid = makeGrid()
    scene.add(grid)
    const hemi = new THREE.HemisphereLight(0xffffff, 0x4a505c, 1.4)
    hemi.position.set(0, 0, 1)
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(2, -3, 4)
    scene.add(hemi, sun)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100)
    camera.up.set(0, 0, 1)
    camera.position.copy(target).add(EYE)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    el.appendChild(renderer.domElement)
    const orbit = new OrbitControls(camera, renderer.domElement)
    orbit.target.copy(target)
    orbit.update()
    const tc = new TransformControls(camera, renderer.domElement)
    tc.setSize(0.8)
    // the clip preview edits the piece it shows: joints picked and turned here (user: edit in the clip preview); its robot is keyed
    // by the piece's actor so selection, gizmo and setValue work as on the main view. Root: panel numbers (the pane is re-based).
    const editPane = !!(cid && itemId && hi > lo)
    const paneActor = editPane ? store.getState().project.sequence.tracks.find(t => t.items.some(i => i.id === itemId))?.actorId : undefined
    const paneKey = paneActor ?? cid
    if (!cid || editPane) scene.add(tc.getHelper())
    // dev/e2e hook
    // dev/e2e hook: __stage = main pane, __stages = every pane by key ('main' or the compare clip id)
    const hook = { camera, tc, entries: () => entries, renderer, camTarget: () => orbit.target.toArray(), overlay: () => overlay?.rig ?? null }
    const hookKey = ranged ? 'preview' : cid ?? 'main'
    if (import.meta.env.DEV) {
      const w = window as any
      ;(w.__stages ??= {})[hookKey] = hook
      if (!cid) w.__stage = hook
    }

    let dirty = true, raf = 0
    const t0 = performance.now()
    let shownF = -1
    // compare-pane pose at clip frame f (re-based to the range start when looping a range)
    const clipPose = (clip: Clip, def: RobotDef, f: number) =>
      ranged ? rebasePose(evaluateClip(clip, def, f), evaluateClip(clip, def, lo)) : evaluateClip(clip, def, f)
    const entries = new Map<string, Entry>()
    let rootMode: 'translate' | 'rotate' = 'translate'
    let last: number[] = []

    // hidden track: stage-only (rig, trail, dot, picking, gizmo); evaluation and export are untouched
    const isHidden = (p: Project, id: string) => !!p.sequence.tracks.find(t => t.kind === 'motion' && t.actorId === id)?.hidden
    // main pane: that track's 경로 표시 on and the track shown
    const showTrail = (p: Project, id: string) => { const t = p.sequence.tracks.find(t => t.kind === 'motion' && t.actorId === id); return !!t?.trail && !t.hidden }
    // track hidden, or (sequence view) the piece under the playhead hidden
    const offStage = (s: { project: Project; frame: number; editing: string | null }, id: string) => {
      const t = s.project.sequence.tracks.find(t => t.kind === 'motion' && t.actorId === id)
      return !!t && (t.hidden || (!s.editing && hiddenAt(t, s.frame)))
    }
    // 원본 | 수정본 비교: the compared piece is drawn as its original here (the 수정본 is in the preview pane, or ghosted)
    const viewProject = (s: ReturnType<typeof store.getState>) => s.previewEdit && s.itemPreview ? withUse(s.project, s.itemPreview, 'original') : s.project
    // the actors drawn here: the project's, or (클립 편집 모드) the virtual one for the open clip
    const viewActors = (s: ReturnType<typeof store.getState>) => s.clipEdit ? [actorOf(s, CLIP_ACTOR)].filter(a => !!a) : s.project.actors
    // 클립 편집: the clip as edited (baseClip), or while 원본 보기 is held the original
    const clipEditPose = (s: ReturnType<typeof store.getState>, original: boolean) => {
      const clip = original ? s.project.clips[s.clipEdit!] : baseClip(s.project, s.defs, s.clipEdit!)!
      return evaluateClip(clip, s.defs[clip.robot], Math.min(Math.max(Math.round(s.frame), 0), clip.length - 1))
    }
    let overlay: { robot: string; rig: RobotRig } | null = null
    const applyOverlay = (s: ReturnType<typeof store.getState>) => {
      // 겹쳐 보기: 수정 비교 = the 수정본 over the piece's original; 클립 편집 = the original over the clip as edited
      const actorId = s.clipEdit ? (s.compareOverlay && !s.clipPeek ? CLIP_ACTOR : undefined)
        : s.previewEdit && s.compareOverlay && s.itemPreview ? s.project.sequence.tracks.find(t => t.items.some(i => i.id === s.itemPreview))?.actorId : undefined
      const a = actorId ? actorOf(s, actorId) : undefined
      if (overlay && (!a || overlay.robot !== a.robot)) { scene.remove(overlay.rig.root); disposeObj(overlay.rig.root); overlay = null }
      if (!a || offStage(s, a.id)) return
      if (!overlay) { overlay = { robot: a.robot, rig: buildRobot(s.defs[a.robot], OVERLAY) }; overlay.rig.setGhost(true); scene.add(overlay.rig.root) }
      if (s.clipEdit) { overlay.rig.applyPose(clipEditPose(s, true)); return }
      const ep = withUse(s.project, s.itemPreview!, null), ei = editingItem(s), t = ei && ei.actorId === a.id ? editTarget(s, a.id) : null
      overlay.rig.applyPose(t ? evaluateItem(ep, s.defs, t.itemId, t.f) : evaluate(ep, s.defs, a.id, s.frame))
    }
    const applyAll = () => {
      const s = store.getState(), vp = viewProject(s)
      const ei = editingItem(s)
      for (const a of viewActors(s)) {
        const e = entries.get(a.id)
        if (!e) continue
        if (s.clipEdit) { // the open clip at the origin
          e.rig.root.visible = e.dot.visible = true; e.trail.visible = false
          if (e.ghost) { e.ghost = false; e.rig.setGhost(false) }
          const pose = clipEditPose(s, s.clipPeek)
          e.rig.applyPose(pose); e.dot.position.set(pose.rootPos[0], pose.rootPos[1], 0.002)
          continue
        }
        const hid = offStage(s, a.id)
        e.rig.root.visible = e.dot.visible = !hid
        e.trail.visible = showTrail(s.project, a.id)
        if (hid) continue
        const ghost = !!ei && ei.actorId !== a.id
        if (e.ghost !== ghost) { e.ghost = ghost; e.rig.setGhost(ghost) }
        const t = ei && !ghost ? editTarget(s, a.id) : null
        const pose = t ? evaluateItem(vp, s.defs, t.itemId, t.f) : evaluate(vp, s.defs, a.id, s.frame)
        e.rig.applyPose(pose)
        e.dot.position.set(pose.rootPos[0], pose.rootPos[1], 0.002)
      }
      if (!cid) applyOverlay(s)
      dirty = true
    }

    const disposeObj = (o: THREE.Object3D) =>
      o.traverse(c => {
        const m = c as THREE.Mesh
        m.geometry?.dispose()
        for (const x of [m.material].flat()) x?.dispose()
      })
    const disposeEntry = (e: Entry) => {
      scene.remove(e.rig.root, e.trail, e.dot)
      for (const o of [e.rig.root, e.trail, e.dot]) disposeObj(o)
    }

    // the clip a compare pane shows: the original, or (item preview) the piece's clip with its 수정 층 and rest-pose bake
    const shownClip = () => {
      const { defs } = store.getState(), project = paneProject(), clip = cid ? project.clips[cid] : undefined
      if (!clip || !ranged || !itemId) return clip
      const it = project.sequence.tracks.flatMap(t => t.items).find(i => i.id === itemId)
      const base = (it && tailedClip(project, defs, it)) || clip // with its 끝 기본자세 after trimOut
      const ld = it ? itemLead(project, defs, it) : null // prepend: range = [trimIn − 관성, trimOut + 정지 + 전이), the derived clip's frames
      return ld ? restClipFor(base, defs[clip.robot], lo, hi, 'prepend', ld.hold, ld.blend) : base
    }
    const paneProject = () => store.getState().project
    // compare pane: one rig for the clip at the origin; trail rebuilt only when the clip object changes
    const syncClip = () => {
      const { project, defs } = store.getState()
      const clip = shownClip()
      if (!clip) return
      let e = entries.get(paneKey!)
      if (!e) {
        // item preview: the piece's actor colour, like that robot on the main stage; compare pane: the robot type colour
        const actor = itemId ? project.actors.find(a => a.id === project.sequence.tracks.find(t => t.items.some(i => i.id === itemId))?.actorId) : undefined
        const hex = actor?.color ?? COLOR[clip.robot], color = new THREE.Color(hex)
        const rig = buildRobot(defs[clip.robot], hex)
        const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color }))
        trail.visible = trailRef.current
        const dot = new THREE.Points(
          new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
          new THREE.PointsMaterial({ color, size: 8, sizeAttenuation: false }))
        scene.add(rig.root, trail, dot)
        e = { rig, trail, dot, ghost: false }
        entries.set(paneKey!, e)
      }
      if (e.trailClips?.[0] === clip) return
      e.trailClips = [clip]
      const noJoints = { ...defs[clip.robot], joints: [] }, pts: number[] = []
      for (let f = ranged ? lo : 0, end = ranged ? Math.min(hi, clip.length) : clip.length; f < end; f++) { const p = clipPose(clip, noJoints, f).rootPos; pts.push(p[0], p[1], 0.002) }
      e.trail.geometry.dispose()
      e.trail.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    }
    const applyClip = () => {
      const st0 = store.getState(), s = { ...st0, project: paneProject(), frame: st0.clipEdit ? st0.clipEditReturn?.frame ?? 0 : st0.frame }, clip = shownClip(), e = entries.get(cid!)
      if (!clip || !e) return
      // item preview follows the main playhead: range frame lo shows at the item start, or (기본자세 덧붙이기) 1.5 s before it,
      // where the timeline draws the lead-in, so preview, lane, physics graph and CSV rows line up; clamped to the range outside it
      const it = itemId ? s.project.sequence.tracks.flatMap(t => t.items).find(i => i.id === itemId) : undefined
      const f = !ranged ? s.frame
        : it ? lo + Math.min(Math.max(s.frame - it.start + (itemLead(s.project, s.defs, it)?.lead ?? 0), 0), hi - lo - 1)
        : lo + Math.floor((performance.now() - t0) * 60 / 1000) % Math.max(hi - lo, 1)
      if (ranged && f === shownF) return
      shownF = f
      const pose = clipPose(clip, s.defs[clip.robot], Math.min(Math.max(f, 0), clip.length - 1))
      e.rig.applyPose(pose)
      e.dot.position.set(pose.rootPos[0], pose.rootPos[1], 0.002)
      dirty = true
    }

    const syncActors = () => {
      const s = store.getState()
      const { project, defs } = s
      const actors = viewActors(s), ids = new Set(actors.map(a => a.id))
      for (const [id, e] of entries) if (!ids.has(id)) { disposeEntry(e); entries.delete(id) }
      for (const a of actors) {
        if (!ids.has(a.id)) continue
        const color = new THREE.Color(a.color)
        let e = entries.get(a.id)
        if (!e) {
          const rig = buildRobot(defs[a.robot], a.color)
          const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color }))
          trail.visible = false
          const dot = new THREE.Points(
            new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
            new THREE.PointsMaterial({ color, size: 8, sizeAttenuation: false }))
          scene.add(rig.root, trail, dot)
          e = { rig, trail, dot, ghost: false }
          entries.set(a.id, e)
        } else e.rig.setColor(a.color)
        if (!showTrail(project, a.id)) continue // built only while shown; rebuilt on show if anything changed meanwhile (trailKey)
        // trail covers the whole sequence; rebuilt only when this actor's items, placement or clips change
        const track = project.sequence.tracks.find(t => t.kind === 'motion' && t.actorId === a.id)
        const clips = track?.items.map(i => project.clips[i.refId]) ?? []
        const key = JSON.stringify([track?.items, a.placement])
        if (e.trailKey === key && e.trailClips && clips.length === e.trailClips.length && clips.every((c, i) => c === e.trailClips![i])) continue
        e.trailKey = key; e.trailClips = clips
        const pts: number[] = []
        if (track?.items.length) {
          for (let f = 0, end = sequenceEnd(project); f < end; f++) {
            const p = evaluateRoot(project, defs, a.id, f).rootPos
            pts.push(p[0], p[1], 0.002)
          }
        }
        e.trail.geometry.dispose()
        e.trail.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      }
    }

    // crossfade (displayed pose is a blend, not invertible) or stitched first frame (root x/y/yaw pinned): no gizmo
    const locked = () => {
      const s = store.getState(), id = s.sel.actorId
      const t = id ? editTarget(s, id) : null
      return gizmoLock(s) !== null || (!!id && (offStage(s, id) || trackLocked(s.project, id) || (!!t && clipLocked(s.project, t.clipId))))
    }
    const syncSelection = () => {
      const s = store.getState()
      const { sel } = s
      const ch = sel.channel?.startsWith('root') ? 'root' : sel.channel
      const accent = new THREE.Color(css('--accent') || '#F0A43A').multiplyScalar(0.5)
      for (const [id, e] of entries)
        for (const [obj, via] of e.rig.linkToJoint) {
          const m = obj as THREE.Mesh
          if (!m.isMesh) continue
          ;(m.material as THREE.MeshStandardMaterial).emissive.set(id === sel.actorId && via === ch ? accent : 0x000000)
        }
      const e = sel.actorId ? entries.get(sel.actorId) : undefined
      // re-attaching mid-drag would reset TransformControls' axis and kill the drag
      const target = !e || locked() ? null : ch === 'root' ? e.rig.root : ch ? e.rig.jointPivots[ch] ?? null : null
      if (!tc.dragging && tc.object !== (target ?? undefined)) {
        tc.detach()
        if (target) tc.attach(target)
      }
      if (e && ch === 'root') {
        if (!tc.object) { dirty = true; return }
        tc.setMode(rootMode)
        tc.setSpace(rootMode === 'rotate' ? 'local' : 'world')
        tc.showX = tc.showY = tc.showZ = true
      } else if (e && ch && e.rig.jointPivots[ch] && tc.object) {
        const robot = actorOf(s, sel.actorId)!.robot
        const ax = s.defs[robot].joints.find(j => j.name === ch)!.axis
        tc.setMode('rotate')
        tc.setSpace('local')
        tc.showX = !!ax[0]; tc.showY = !!ax[1]; tc.showZ = !!ax[2]
      }
      dirty = true
    }

    // current gizmo values for the root, in clip-local channels: undo placement, then the item's stitch transform
    const rootValues = (): [string, number][] => {
      const s = store.getState(), actor = actorOf(s, s.sel.actorId)!
      const target = editTarget(s, actor.id)
      const track = s.project.sequence.tracks.find(t => t.items.some(i => i.id === target?.itemId))
      const xf = (track && target && stitchTransforms(s.project, s.defs, track).get(target.itemId)) || { x: 0, y: 0, yaw: 0 }
      const o = entries.get(actor.id)!.rig.root
      const r = worldToClipRoot({ pos: [o.position.x, o.position.y, o.position.z], quat: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w] }, actor.placement, xf)
      if (rootMode === 'translate') return [['root.x', r.x], ['root.y', r.y], ['root.z', r.z]]
      // euler read-back wraps to (-pi, pi]; keep each angle continuous with the stored channel value
      if (!target) return [['root.roll', r.roll], ['root.pitch', r.pitch], ['root.yaw', r.yaw]]
      const it = track?.items.find(i => i.id === target.itemId), clip = (it && editedClip(s.project, s.defs, it)) || s.project.clips[target.clipId]
      const cur = (ch: string) => evalCurve(clip.channels[ch] ?? { keys: [] }, target.f, 0)
      return [['root.roll', nearestAngle(r.roll, cur('root.roll'))], ['root.pitch', nearestAngle(r.pitch, cur('root.pitch'))], ['root.yaw', nearestAngle(r.yaw, cur('root.yaw'))]]
    }

    tc.addEventListener('dragging-changed', e => {
      orbit.enabled = !e.value
      if (e.value) store.getState().beginGesture()
      else store.getState().endGesture()
      if (e.value && store.getState().sel.channel?.startsWith('root')) last = rootValues().map(v => v[1])
    })
    tc.addEventListener('change', () => { dirty = true })
    tc.addEventListener('objectChange', () => {
      const s = store.getState(), { actorId, channel } = s.sel
      if (!actorId || !channel) return
      if (channel.startsWith('root')) {
        rootValues().forEach(([ch, v], i) => {
          if (Math.abs(v - last[i]) > 1e-6) { last[i] = v; s.setValue(actorId, ch, v) }
        })
      } else {
        const pivot = entries.get(actorId)!.rig.jointPivots[channel]
        const robot = actorOf(s, actorId)!.robot
        const ax = s.defs[robot].joints.find(j => j.name === channel)!.axis
        s.setValue(actorId, channel, pivotAngle(pivot, ax))
      }
      if (editPane) { shownF = -1; applyClip() } else applyAll() // snaps back when the value was clamped
    })
    orbit.addEventListener('change', () => { dirty = true })

    // click-to-select (ignore orbit drags and gizmo hits)
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
    let down: [number, number] | null = null, onGizmo = false
    const dom = renderer.domElement
    const onDown = (ev: PointerEvent) => { down = [ev.clientX, ev.clientY]; onGizmo = tc.axis !== null; el.focus() }
    const onUp = (ev: PointerEvent) => {
      if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 4 || onGizmo) return
      const r = dom.getBoundingClientRect()
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      let best: { id: string; via: string; d: number } | null = null
      for (const [id, e] of entries) {
        if (e.ghost || !e.rig.root.visible) continue
        const hit = ray.intersectObject(e.rig.root, true)[0]
        const via = hit && e.rig.linkToJoint.get(hit.object)
        if (via && (!best || hit.distance < best.d)) best = { id, via, d: hit.distance }
      }
      if (best) store.getState().select(best.id, best.via)
      else store.getState().select(null)
    }
    if (!cid || editPane) { dom.addEventListener('pointerdown', onDown); dom.addEventListener('pointerup', onUp) }

    const onKey = (ev: KeyboardEvent) => {
      const v = VIEWS[ev.key]
      if (v) {
        const d = camera.position.distanceTo(orbit.target)
        camera.position.copy(followRef.current ? orbit.target : target).add(new THREE.Vector3(...v).normalize().multiplyScalar(d))
        orbit.update()
      } else if (!cid && ev.key.toLowerCase() === 'r' && store.getState().sel.channel?.startsWith('root')) {
        rootMode = rootMode === 'translate' ? 'rotate' : 'translate'
        syncSelection()
      }
    }
    el.addEventListener('keydown', onKey)

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      dirty = true
    })
    ro.observe(el)

    let wasLocked = false
    if (cid) { syncClip(); applyClip(); if (editPane) syncSelection() } else { syncActors(); applyAll(); syncSelection() }
    const unsub = store.subscribe((s, prev) => {
      if (cid) {
        if (s.project !== prev.project) { syncClip(); shownF = -1 }
        applyClip()
        if (editPane) { const lk = locked(); if (s.sel !== prev.sel || lk !== wasLocked) syncSelection(); wasLocked = lk }
        return
      }
      if (s.project !== prev.project || s.clipEdit !== prev.clipEdit) syncActors()
      applyAll()
      const key = (p: typeof s.project) => p.actors.map(a => a.id + a.robot).join() + (s.clipEdit ?? '')
      const lk = locked()
      if (s.sel !== prev.sel || key(s.project) !== key(prev.project) || lk !== wasLocked) syncSelection()
      wasLocked = lk
    })

    // tracked robot: compare/clip pane = its one robot; main = selected actor if shown, else the first shown one
    const tracked = () => {
      if (cid) return entries.get(paneKey!)
      const s = store.getState(), sel = s.sel.actorId && entries.get(s.sel.actorId)
      if (sel && sel.rig.root.visible) return sel
      return viewActors(s).map(a => entries.get(a.id)).find(e => e?.rig.root.visible)
    }
    const pos = new THREE.Vector3()
    let wasFollowing = false
    const followCam = () => {
      const on = followRef.current, e = on ? tracked() : undefined
      if (!e) { wasFollowing = false; return }
      e.rig.root.getWorldPosition(pos)
      const r = followStep(orbit.target.toArray(), camera.position.toArray(), pos.toArray(), wasFollowing ? 0.15 : 1)
      wasFollowing = true
      const moved = Math.abs(r.target[0] - orbit.target.x) + Math.abs(r.target[1] - orbit.target.y) + Math.abs(r.target[2] - orbit.target.z) > 1e-6
      orbit.target.fromArray(r.target); camera.position.fromArray(r.camera)
      if (moved) { orbit.update(); dirty = true }
    }
    let shownTrail = trailRef.current
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (trailRef.current !== shownTrail) { // 경로 표시 toggled
        shownTrail = trailRef.current
        if (cid) for (const e of entries.values()) e.trail.visible = shownTrail
        dirty = true
      }
      if (ranged) applyClip()
      followCam()
      if (!dirty) return
      dirty = false
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      unsub(); ro.disconnect()
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('pointerup', onUp)
      el.removeEventListener('keydown', onKey)
      for (const e of entries.values()) disposeEntry(e)
      if (overlay) disposeObj(overlay.rig.root)
      disposeObj(grid)
      tc.dispose(); orbit.dispose()
      // dispose() alone keeps the WebGL context alive until GC; release it now so opening/closing
      // preview panes never hits the browser's context limit (which kills the oldest pane's context)
      renderer.forceContextLoss(); renderer.dispose()
      el.removeChild(dom)
      if (import.meta.env.DEV) {
        const w = window as any
        if (w.__stages?.[hookKey] === hook) delete w.__stages[hookKey]
        if (w.__stage === hook) delete w.__stage
      }
    }
  }, [cid, lo, hi, itemId])

  return (
    <>
      <div ref={host} tabIndex={0} style={{ width: '100%', height: '100%', outline: 'none' }} />
      <div className="pv-tools">
        <button className="pv-btn" aria-pressed={follow} onClick={() => setFollow(f => !f)}>로봇 따라가기</button>
        {cid && <button className="pv-btn" aria-pressed={trail} onClick={() => setTrail(v => !v)} title="로봇 골반이 지나간 바닥 경로를 선으로 보여 줍니다">경로 표시</button>}
        {children}
      </div>
    </>
  )
}
