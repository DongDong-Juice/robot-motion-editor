import loadMujoco from '@mujoco/mujoco'
import { loadModel } from './sim'

const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer())

// temporary: Task 4 replaces this with the run protocol
self.onmessage = async () => {
  let t = performance.now()
  const mj = await loadMujoco()
  const base = '/physics/g1/'
  const names: string[] = await (await fetch(base + 'files.json')).json()
  const { m, d } = await loadModel(mj, 'g1', {
    scene: await get(base + 'scene.xml'),
    meshes: await Promise.all(names.map(async n => ({ name: n.replace('meshes/', ''), data: await get(base + n) }))),
  })
  const loadMs = performance.now() - t
  t = performance.now()
  for (let i = 0; i < 30000; i++) mj.mj_step(m, d)
  self.postMessage({ loadMs, simMs: performance.now() - t, nu: m.nu })
}
