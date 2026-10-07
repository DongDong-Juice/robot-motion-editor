export type Vec3 = [number, number, number]
export type RobotKind = 'g1' | 'go2'

export interface JointDef {
  name: string
  parent: string
  child: string
  xyz: Vec3
  rpy: Vec3
  axis: Vec3
  lower: number
  upper: number
  velocity: number
}
export interface LinkDef {
  name: string
  mesh: string | null
  xyz: Vec3
  rpy: Vec3
}
export interface MeshData {
  positions: Float32Array
  indices: Uint32Array
}
export interface RobotDef {
  kind: RobotKind
  rootLink: string
  links: Record<string, LinkDef>
  joints: JointDef[]
  fixedJoints: Omit<JointDef, 'lower' | 'upper' | 'velocity'>[]
  meshes: Record<string, MeshData>
  standingHeight: number
  groups: { name: string; joints: string[] }[]
}
