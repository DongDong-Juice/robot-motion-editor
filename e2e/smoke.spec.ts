import fs from 'node:fs'
import { test, expect, type Download } from '@playwright/test'

test('load both robots, key, export CSV', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).showDirectoryPicker })
  const downloads: Download[] = []
  page.on('download', d => downloads.push(d))
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => {
    const s = (window as any).__editor.getState()
    const id = s.project.actors[0].id
    s.toggleAutoKey(); s.select(id, 'left_elbow_joint'); s.setFrame(30)
    s.setValue(id, 'left_elbow_joint', 1.0)
  })
  await page.getByRole('button', { name: '내보내기' }).click()
  await page.getByRole('button', { name: /CSV 내보내기|무시하고 내보내기/ }).click()
  await expect.poll(() => downloads.length).toBe(2)
  const texts = await Promise.all(downloads.map(async d => fs.readFileSync((await d.path())!, 'utf8')))
  const rows = (t: string) => t.trim().split('\n')
  const cols = texts.map(t => rows(t)[0].split(',').length).sort((a, b) => a - b)
  expect(cols).toEqual([19, 36])
  const g1 = texts.find(t => rows(t)[0].split(',').length === 36)!
  expect(rows(g1)).toHaveLength(120)
  expect(Number(rows(g1)[30].split(',')[7 + 18])).toBeCloseTo(1.0, 5)
})
