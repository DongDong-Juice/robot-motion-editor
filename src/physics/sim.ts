export type Robot = 'g1' | 'go2'
export interface ModelFiles { scene: Uint8Array; meshes: { name: string; data: Uint8Array }[] }
export interface Loaded { mj: any; m: any; d: any; robot: Robot }

// FS.writeFile, not MjVFS.addBuffer (per-byte Embind copy: tens of seconds for 19 MB)
export async function loadModel(mj: any, robot: Robot, files: ModelFiles): Promise<Loaded> {
  mj.FS.mkdirTree(`/${robot}/meshes`)
  for (const f of files.meshes) mj.FS.writeFile(`/${robot}/meshes/${f.name}`, f.data)
  mj.FS.writeFile(`/${robot}/scene.xml`, files.scene)
  const m = mj.MjModel.from_xml_path(`/${robot}/scene.xml`)
  m.opt.timestep = 0.002
  return { mj, m, d: new mj.MjData(m), robot }
}
