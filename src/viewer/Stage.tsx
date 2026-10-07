import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { evaluate } from '../model/evaluate'
import { quatMul, yawQuat } from '../model/rootMath'
import { getEditor } from '../store/store'
import { buildRobot, pivotAngle, type RobotRig } from './buildRobot'

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
const EXTENT = 5
const TARGET = new THREE.Vector3(0.75, 0, 0.6)
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

interface Entry { rig: RobotRig; trail: THREE.Line; dot: THREE.Points }

export default function Stage() {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current!
    const store = getEditor()
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
    camera.position.set(3.2, -3.4, 2)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    el.appendChild(renderer.domElement)
    const orbit = new OrbitControls(camera, renderer.domElement)
    orbit.target.copy(TARGET)
    orbit.update()
    const tc = new TransformControls(camera, renderer.domElement)
    tc.setSize(0.8)
    scene.add(tc.getHelper())

    let dirty = true, raf = 0
    const entries = new Map<string, Entry>()
    let rootMode: 'translate' | 'rotate' = 'translate'
    let last: number[] = []

    const applyAll = () => {
      const s = store.getState()
      for (const a of s.project.actors) {
        const e = entries.get(a.id)
        if (!e) continue
        const pose = evaluate(s.project, s.defs, a.id, s.frame)
        e.rig.applyPose(pose)
        e.dot.position.set(pose.rootPos[0], pose.rootPos[1], 0.002)
      }
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

    const syncActors = () => {
      const s = store.getState()
      const { project, defs } = s
      const ids = new Set(project.actors.map(a => a.id))
      for (const [id, e] of entries) if (!ids.has(id)) { disposeEntry(e); entries.delete(id) }
      for (const a of project.actors) {
        const color = new THREE.Color(a.color)
        let e = entries.get(a.id)
        if (!e) {
          const rig = buildRobot(defs[a.robot], a.color)
          const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color }))
          const dot = new THREE.Points(
            new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
            new THREE.PointsMaterial({ color, size: 8, sizeAttenuation: false }))
          scene.add(rig.root, trail, dot)
          e = { rig, trail, dot }
          entries.set(a.id, e)
        } else e.rig.setColor(a.color)
        // trail only depends on the project; frame changes just move the dot
        const item = project.sequence.tracks.find(t => t.kind === 'motion' && t.actorId === a.id)?.items[0]
        const pts: number[] = []
        if (item) {
          for (let f = item.start; f < item.start + item.trimOut - item.trimIn; f++) {
            const p = evaluate(project, defs, a.id, f).rootPos
            pts.push(p[0], p[1], 0.002)
          }
        }
        e.trail.geometry.dispose()
        e.trail.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      }
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
      tc.detach()
      if (e && ch === 'root') {
        tc.attach(e.rig.root)
        tc.setMode(rootMode)
        tc.setSpace(rootMode === 'rotate' ? 'local' : 'world')
        tc.showX = tc.showY = tc.showZ = true
      } else if (e && ch && e.rig.jointPivots[ch]) {
        const robot = s.project.actors.find(a => a.id === sel.actorId)!.robot
        const ax = s.defs[robot].joints.find(j => j.name === ch)!.axis
        tc.attach(e.rig.jointPivots[ch])
        tc.setMode('rotate')
        tc.setSpace('local')
        tc.showX = !!ax[0]; tc.showY = !!ax[1]; tc.showZ = !!ax[2]
      }
      dirty = true
    }

    // current gizmo values for the root, in clip (un-placed) space
    const rootValues = (): [string, number][] => {
      const s = store.getState(), actor = s.project.actors.find(a => a.id === s.sel.actorId)!
      const o = entries.get(actor.id)!.rig.root
      if (rootMode === 'translate') {
        const { x: px, y: py, yaw } = actor.placement
        const dx = o.position.x - px, dy = o.position.y - py, c = Math.cos(yaw), sn = Math.sin(yaw)
        return [['root.x', c * dx + sn * dy], ['root.y', -sn * dx + c * dy], ['root.z', o.position.z]]
      }
      const [x, y, z, w] = quatMul(yawQuat(-actor.placement.yaw), [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w])
      const eu = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(x, y, z, w), 'ZYX')
      return [['root.roll', eu.x], ['root.pitch', eu.y], ['root.yaw', eu.z]]
    }

    tc.addEventListener('dragging-changed', e => {
      orbit.enabled = !e.value
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
        const robot = s.project.actors.find(a => a.id === actorId)!.robot
        const ax = s.defs[robot].joints.find(j => j.name === channel)!.axis
        s.setValue(actorId, channel, pivotAngle(pivot, ax))
      }
      applyAll() // snaps back when autoKey is off or the value was clamped
    })
    orbit.addEventListener('change', () => { dirty = true })

    // click-to-select (ignore orbit drags and gizmo hits)
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
    let down: [number, number] | null = null
    const dom = renderer.domElement
    const onDown = (ev: PointerEvent) => { down = [ev.clientX, ev.clientY]; el.focus() }
    const onUp = (ev: PointerEvent) => {
      if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 4 || tc.axis) return
      const r = dom.getBoundingClientRect()
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      let best: { id: string; via: string; d: number } | null = null
      for (const [id, e] of entries) {
        const hit = ray.intersectObject(e.rig.root, true)[0]
        const via = hit && e.rig.linkToJoint.get(hit.object)
        if (via && (!best || hit.distance < best.d)) best = { id, via, d: hit.distance }
      }
      if (best) store.getState().select(best.id, best.via)
      else store.getState().select(null)
    }
    dom.addEventListener('pointerdown', onDown)
    dom.addEventListener('pointerup', onUp)

    const onKey = (ev: KeyboardEvent) => {
      const v = VIEWS[ev.key]
      if (v) {
        const d = camera.position.distanceTo(orbit.target)
        camera.position.copy(TARGET).add(new THREE.Vector3(...v).normalize().multiplyScalar(d))
        orbit.update()
      } else if (ev.key.toLowerCase() === 'r' && store.getState().sel.channel?.startsWith('root')) {
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

    syncActors(); applyAll(); syncSelection()
    const unsub = store.subscribe((s, prev) => {
      if (s.project !== prev.project) syncActors()
      applyAll()
      if (s.sel !== prev.sel || s.project.actors !== prev.project.actors) syncSelection()
    })

    const loop = () => {
      raf = requestAnimationFrame(loop)
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
      disposeObj(grid)
      tc.dispose(); orbit.dispose(); renderer.dispose()
      el.removeChild(dom)
    }
  }, [])

  return <div ref={host} tabIndex={0} style={{ width: '100%', height: '100%', outline: 'none' }} />
}
