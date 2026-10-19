import { beforeEach, expect, test, vi } from 'vitest'
import { newProject } from '../model/defaults'
import { loadDef } from '../test/defs'
import { itemInput, runItems } from '../physics/runItem'
import { usePhysics } from '../physics/physicsStore'
import { exportItemCsv } from './csv'
import { exportOne } from './exportOne'

const saved = vi.hoisted(() => ({ text: '' as string }))
vi.mock('../fileio', () => ({ saveCsvFile: async (_n: string, t: string) => { saved.text = t; return true } }))
vi.mock('../physics/runItem', async orig => ({ ...await orig<typeof import('../physics/runItem')>(), runItems: vi.fn() }))

const defs = { g1: loadDef('g1'), go2: loadDef('go2') }
const p = newProject(), g1 = p.actors[0]
const item = p.sequence.tracks.find(t => t.actorId === g1.id)!.items[0]
const key = itemInput(p, defs, g1.id, item.id).key
const base = exportItemCsv(p, defs, g1.id, item.id)
const seg = (from: number) => ({ from, to: from + 4, maxPct: 99.4, maxTorque: 1 })
const done = { key, status: 'done' as const, metrics: { segments: [seg(10), seg(30)] } as never }
const fake = (v: { byItem: Record<string, typeof done> }) => vi.mocked(runItems).mockImplementation(async () => { // like the real one: queued now, result later
  usePhysics.setState({ byItem: { [item.id]: { key, status: 'queued' } } })
  await new Promise(r => setTimeout(r, 5)); usePhysics.setState(v)
})

beforeEach(() => { usePhysics.setState({ byItem: {} }); vi.mocked(runItems).mockReset(); saved.text = '' })

test('runs missing result and adds segments to the warning count; csv unchanged', async () => {
  fake({ byItem: { [item.id]: done } })
  const asked: string[] = []
  await exportOne(p, defs, g1.id, item.id, m => (asked.push(m), true))
  expect(runItems).toHaveBeenCalledTimes(1)
  expect(asked[0]).toContain(`경고 ${base.warnings.length + 2}개가 있습니다 (관절 한계·속도·루트·물리 보조력)`)
  expect(saved.text).toBe(base.text)
})

test('fresh result is not re-run; 미지원 proceeds with a skip note', async () => {
  usePhysics.setState({ byItem: { [item.id]: done } })
  await exportOne(p, defs, g1.id, item.id, () => true)
  expect(runItems).not.toHaveBeenCalled()
  usePhysics.setState({ byItem: { [item.id]: { key, status: 'error', message: '미지원' } } })
  const msg = await exportOne(p, defs, g1.id, item.id, () => true)
  expect(runItems).not.toHaveBeenCalled()
  expect(msg).toContain('(물리 검증 생략: 미지원)')
  expect(saved.text).toBe(base.text)
})
