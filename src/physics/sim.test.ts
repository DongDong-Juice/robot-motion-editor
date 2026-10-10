import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import loadMujoco from '@mujoco/mujoco'
import { loadModel } from './sim'
import { loadDef } from '../test/defs'

const dir = new URL('../../public/physics/g1/', import.meta.url)
const read = (p: string) => new Uint8Array(readFileSync(new URL(p, dir)))

test('g1 model loads: 29 actuators in CSV joint order', async () => {
  const mj = await loadMujoco()
  const names: string[] = JSON.parse(readFileSync(new URL('files.json', dir), 'utf8'))
  const { m } = await loadModel(mj, 'g1', {
    scene: read('scene.xml'),
    meshes: names.map(n => ({ name: n.replace('meshes/', ''), data: read(n) })),
  })
  expect(m.nu).toBe(29)
  expect(m.nq).toBe(36)
  const act = Array.from({ length: m.nu }, (_, i) => mj.mj_id2name(m, mj.mjtObj.mjOBJ_ACTUATOR.value, i))
  expect(act).toEqual(loadDef('g1').joints.map(j => j.name))
}, 60000)
