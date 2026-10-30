// 검수 목록's own small 3D view (수정변동사항.md §12): the frame being checked plus the frame before it as an orange ghost.
// Separate from the main Stage on purpose (nothing there changes); renders only when something changes; dispose() frees the
// WebGL context when the window closes.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Pose } from '../model/pose'
import type { RobotDef } from '../robot/types'
import { buildRobot, type RobotRig } from '../viewer/buildRobot'

export type ReviewAngle = '3/4' | '정면' | '측면'
export const GHOST = '#FF9628' // 직전 프레임
export const HIT = '#E5484D' // 자가충돌: 겹친 부위 (--warn)
const GHOST_OPACITY = 0.45
// camera direction in the robot's heading frame (x = facing, y = its left, z = up)
const DIRS: Record<ReviewAngle, [number, number, number]> = { '3/4': [1, -0.75, 0.35], 정면: [1, 0, 0.12], 측면: [0, -1, 0.12] }
const DIST = 2.6

function grid(): THREE.LineSegments {
  const pts: number[] = [], E = 4
  for (let i = -E * 2; i <= E * 2; i++) { const v = i / 2; pts.push(v, -E, 0, v, E, 0, -E, v, 0, E, v, 0) }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#3B424D' }))
}

export class ReviewView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50)
  private orbit: OrbitControls
  private rig: RobotRig | null = null
  private ghost: RobotRig | null = null
  private def: RobotDef | null = null
  private color = ''
  private lit: THREE.MeshStandardMaterial[] = [] // 자가충돌: materials painted red (§14)
  private ro: ResizeObserver
  private raf = 0
  private target = new THREE.Vector3()

  constructor(private el: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    el.appendChild(this.renderer.domElement)
    this.scene.background = new THREE.Color('#22262D')
    const hemi = new THREE.HemisphereLight(0xffffff, 0x4a505c, 1.4); hemi.position.set(0, 0, 1)
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, -3, 4)
    this.scene.add(grid(), hemi, sun)
    this.camera.up.set(0, 0, 1)
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.addEventListener('change', () => this.draw())
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(el)
    this.resize()
  }

  private resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%'
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix()
    this.draw()
  }

  /** Coalesce changes into one render on the next animation frame. */
  draw() {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.renderer.render(this.scene, this.camera) })
  }

  private dropRigs() {
    for (const r of [this.rig, this.ghost]) if (r) { this.scene.remove(r.root); dispose(r.root) }
    this.rig = this.ghost = null
  }

  /** Show `pose` (and `prev` as the ghost, or none). Rebuilds the robots when the robot type changes. */
  show(def: RobotDef, color: string, pose: Pose, prev: Pose | null) {
    if (def !== this.def) {
      this.dropRigs(); this.def = def; this.color = color; this.lit = []
      this.rig = buildRobot(def, color)
      this.ghost = buildRobot(def, GHOST); this.ghost.setGhost(true)
      this.ghost.root.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m) m.opacity = GHOST_OPACITY })
      this.scene.add(this.rig.root, this.ghost.root)
    }
    this.rig!.applyPose(pose)
    this.ghost!.root.visible = !!prev
    if (prev) this.ghost!.applyPose(prev)
    this.draw()
  }

  /** 자가충돌 (§14): paint these links (their own meshes, not their children) red; [] = none. */
  highlight(links: string[]) {
    for (const m of this.lit) m.color.set(this.color)
    this.lit = []
    if (!this.rig) return
    const want = new Set(links)
    this.rig.root.traverse(o => {
      if (!want.has(o.name)) return
      for (const c of o.children) { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if ((c as THREE.Mesh).isMesh && m) { m.color.set(HIT); this.lit.push(m) } }
    })
    this.draw()
  }

  /** Point the camera at the robot from `angle`, relative to the facing of `pose` (orbiting with the mouse still works). */
  aim(pose: Pose, angle: ReviewAngle) {
    const [x, y, z, w] = pose.rootQuat
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    const [a, b, c] = DIRS[angle], cy = Math.cos(yaw), sy = Math.sin(yaw)
    const d = new THREE.Vector3(a * cy - b * sy, a * sy + b * cy, c).normalize().multiplyScalar(DIST)
    this.target.set(pose.rootPos[0], pose.rootPos[1], Math.max(pose.rootPos[2] - 0.05, 0.3))
    this.orbit.target.copy(this.target)
    this.camera.position.copy(this.target).add(d)
    this.orbit.update()
    this.draw()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.orbit.dispose()
    this.dropRigs()
    this.scene.traverse(o => dispose(o))
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}

function dispose(o: THREE.Object3D) {
  o.traverse(c => {
    const m = c as THREE.Mesh
    m.geometry?.dispose()
    for (const x of [m.material].flat()) (x as THREE.Material | undefined)?.dispose()
  })
}
