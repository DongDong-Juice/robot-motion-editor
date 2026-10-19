import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'

// [robot, clip name, start] of every piece, track by track
const pieces = (page: Page) => page.evaluate(() => {
  const p = (window as any).__editor.getState().project
  return p.sequence.tracks.filter((t: any) => t.kind === 'motion').flatMap((t: any) => [...t.items].sort((a: any, b: any) => a.start - b.start)
    .map((i: any) => [p.clips[i.refId].robot, p.clips[i.refId].name, i.start]))
}) as Promise<[string, string, number][]>

test('폴더 가져오기 → a 목록 folder only; folder or multi-selection dragged to the timeline = one piece per clip, end to end per robot', async ({ page }, info) => {
  const dir = info.outputPath('moves')
  fs.mkdirSync(dir, { recursive: true })
  for (const f of ['g1_walk.csv', 'g1_wave.csv', 'go2_trot.csv']) fs.copyFileSync(path.join('assets/examples', f), path.join(dir, f))
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a csv')
  await page.addInitScript(() => { delete (window as any).showDirectoryPicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })

  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '폴더 가져오기' }).click()])
  await fc.setFiles(dir)
  await expect(page.getByText('클립 3개를 가져왔습니다')).toBeVisible()
  expect(await pieces(page)).toEqual([]) // list only
  const bin = page.locator('.pp-row[data-kind=bin]', { hasText: 'moves' })
  await expect(bin).toBeVisible()

  const seq = page.locator('.seq-canvas')
  await bin.dragTo(seq, { targetPosition: { x: 300, y: 60 } })
  const len = (n: string) => page.evaluate(n => (Object.values((window as any).__editor.getState().project.clips) as any[]).find(c => c.name === n).length, n)
  expect(await pieces(page)).toEqual([['g1', 'g1_walk', 0], ['g1', 'g1_wave', await len('g1_walk')], ['go2', 'go2_trot', 0]])

  await page.keyboard.press('Control+z') // one undo takes the whole drop back
  expect(await pieces(page)).toEqual([])

  await bin.locator('.pp-twisty').click()
  await page.locator('.pp-row[data-kind=clip]', { hasText: 'g1_wave' }).click()
  await page.locator('.pp-row[data-kind=clip]', { hasText: 'g1_walk' }).click({ modifiers: ['Control'] })
  await page.locator('.pp-row[data-kind=clip]', { hasText: 'g1_walk' }).dragTo(seq, { targetPosition: { x: 300, y: 60 } })
  expect(await pieces(page)).toEqual([['g1', 'g1_walk', 0], ['g1', 'g1_wave', await len('g1_walk')]]) // list order, not click order
})
