import { buildGroups } from './groups'
import type { JointDef, LinkDef, MeshData, RobotDef, RobotKind, Vec3 } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mat = number[] // 4x4 row-major

const mul = (a: Mat, b: Mat): Mat => {
  const r = new Array<number>(16).fill(0)
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j]
  return r
}

// URDF: translate(xyz) * Rz(yaw) Ry(pitch) Rx(roll)
function originMat([x, y, z]: Vec3, [r, p, w]: Vec3): Mat {
  const [cr, sr, cp, sp, cy, sy] = [Math.cos(r), Math.sin(r), Math.cos(p), Math.sin(p), Math.cos(w), Math.sin(w)]
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, x,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, y,
    -sp, cp * sr, cp * cr, z,
    0, 0, 0, 1,
  ]
}

function decode(b64: string): ArrayBuffer {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer
}

export function loadRobotDef(kind: RobotKind, model: any, meshesJson: any): RobotDef {
  const links: Record<string, LinkDef> = {}
  const scales: Record<string, Vec3> = {}
  for (const [name, l] of Object.entries<any>(model.links)) {
    links[name] = { name, mesh: l.mesh ?? null, xyz: l.xyz, rpy: l.rpy }
    scales[name] = l.scale ?? [1, 1, 1]
  }

  const joints: JointDef[] = []
  const fixedJoints: RobotDef['fixedJoints'] = []
  const rawJoints: any[] = []
  for (const j of model.joints) {
    const base = { name: j.name, parent: j.parent, child: j.child, xyz: j.xyz, rpy: j.rpy, axis: j.axis }
    if (j.type === 'revolute') {
      joints.push({ ...base, lower: j.lower ?? 0, upper: j.upper ?? 0, velocity: j.velocity ?? 0 })
      rawJoints.push(j)
    } else if (j.type === 'fixed') {
      fixedJoints.push(base)
      rawJoints.push(j)
    }
  }

  const children = new Set(model.joints.map((j: any) => j.child))
  const rootLink = Object.keys(links).find(n => !children.has(n))
  if (!rootLink) throw new Error('no root link')

  const meshes: Record<string, MeshData> = {}
  for (const [name, m] of Object.entries<any>(meshesJson))
    meshes[name] = { positions: new Float32Array(decode(m.pos)), indices: new Uint32Array(decode(m.idx)) }

  // FK at zero pose (revolute joints contribute no rotation), root origin as reference
  const world: Record<string, Mat> = { [rootLink]: originMat([0, 0, 0], [0, 0, 0]) }
  const pending = [...rawJoints]
  while (pending.length) {
    const before = pending.length
    for (let i = pending.length - 1; i >= 0; i--) {
      const j = pending[i]
      if (!world[j.parent]) continue
      world[j.child] = mul(world[j.parent], originMat(j.xyz, j.rpy))
      pending.splice(i, 1)
    }
    if (pending.length === before) break // unreachable joints (ignored types) -> stop
  }

  let minZ = Infinity
  for (const [name, link] of Object.entries(links)) {
    const mesh = link.mesh && meshes[link.mesh]
    const w = world[name]
    if (!mesh || !w) continue
    const m = mul(w, originMat(link.xyz, link.rpy))
    const s = scales[name]
    const p = mesh.positions
    for (let i = 0; i < p.length; i += 3) {
      const z = m[8] * p[i] * s[0] + m[9] * p[i + 1] * s[1] + m[10] * p[i + 2] * s[2] + m[11]
      if (z < minZ) minZ = z
    }
  }

  return {
    kind, rootLink, links, joints, fixedJoints, meshes,
    standingHeight: -minZ,
    groups: buildGroups(kind, joints.map(j => j.name)),
  }
}

export async function fetchRobotDef(kind: RobotKind): Promise<RobotDef> {
  const [model, meshes] = await Promise.all(
    ['model', 'meshes'].map(f => fetch(`/robots/${kind}/${f}.json`).then(r => r.json())),
  )
  return loadRobotDef(kind, model, meshes)
}
