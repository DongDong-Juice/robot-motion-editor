import * as THREE from 'three'
import type { Pose } from '../model/evaluate'
import type { RobotDef, Vec3 } from '../robot/types'

export interface RobotRig {
  root: THREE.Group
  jointPivots: Record<string, THREE.Object3D>
  linkToJoint: Map<THREE.Object3D, string>
  applyPose(pose: Pose): void
  setGhost(on: boolean): void
  setColor(hex: string): void
}

const origin = (g: THREE.Object3D, xyz: Vec3, rpy: Vec3) => {
  g.position.set(...xyz)
  g.setRotationFromEuler(new THREE.Euler(rpy[0], rpy[1], rpy[2], 'ZYX'))
}

export function buildRobot(def: RobotDef, color: string): RobotRig {
  const mats: THREE.MeshStandardMaterial[] = []
  const jointPivots: Record<string, THREE.Object3D> = {}
  const linkToJoint = new Map<THREE.Object3D, string>()
  const axes: Record<string, THREE.Vector3> = {}

  const edges = [...def.joints, ...def.fixedJoints]
  const revolute = new Set(def.joints.map(j => j.name))

  const buildLink = (name: string, via: string): THREE.Group => {
    const g = new THREE.Group()
    g.name = name
    linkToJoint.set(g, via)
    const l = def.links[name]
    const md = l.mesh ? def.meshes[l.mesh] : null
    if (md) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(md.positions, 3))
      geo.setIndex(new THREE.BufferAttribute(md.indices, 1))
      geo.computeVertexNormals()
      const mat = new THREE.MeshStandardMaterial({ color })
      mats.push(mat)
      const mesh = new THREE.Mesh(geo, mat)
      origin(mesh, l.xyz, l.rpy)
      linkToJoint.set(mesh, via)
      g.add(mesh)
    }
    for (const j of edges.filter(e => e.parent === name)) {
      const o = new THREE.Group()
      origin(o, j.xyz, j.rpy)
      g.add(o)
      if (revolute.has(j.name)) {
        const pivot = new THREE.Group()
        o.add(pivot)
        jointPivots[j.name] = pivot
        axes[j.name] = new THREE.Vector3(...j.axis).normalize()
        pivot.add(buildLink(j.child, j.name))
      } else o.add(buildLink(j.child, via))
    }
    return g
  }

  const root = new THREE.Group()
  root.add(buildLink(def.rootLink, 'root'))

  return {
    root, jointPivots, linkToJoint,
    applyPose(pose) {
      root.position.set(...pose.rootPos)
      root.quaternion.set(...pose.rootQuat)
      def.joints.forEach((j, i) => jointPivots[j.name].quaternion.setFromAxisAngle(axes[j.name], pose.q[i]))
      root.updateMatrixWorld(true)
    },
    setGhost(on) {
      for (const m of mats) { m.transparent = on; m.opacity = on ? 0.25 : 1; m.depthWrite = !on; m.needsUpdate = true }
    },
    setColor(hex) { for (const m of mats) m.color.set(hex) },
  }
}

// signed rotation of pivot about unit `axis` (pivot is only ever rotated about it)
export function pivotAngle(pivot: THREE.Object3D, axis: Vec3): number {
  const a = new THREE.Vector3(...axis).normalize()
  const q = pivot.quaternion
  let ang = 2 * Math.atan2(a.x * q.x + a.y * q.y + a.z * q.z, q.w)
  if (ang > Math.PI) ang -= 2 * Math.PI
  else if (ang < -Math.PI) ang += 2 * Math.PI
  return ang
}
