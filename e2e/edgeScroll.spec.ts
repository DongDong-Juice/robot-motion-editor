import { test, expect } from '@playwright/test'
import { importSynthetic } from './synth'

// While the playhead follows the pointer (hover scrub), past 90% of the track area the sequence scrolls right, before 10% left (user).
test('hover near the edges scrolls the sequence; the playhead keeps following', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await importSynthetic(page, 'es')
  await page.evaluate(() => { const w = window as any; w.__tv.ppf = 12; w.__tv.scrollF = 0 }) // zoomed in: 300 frames run past the view
  const cv = page.locator('.seq-canvas'), box = (await cv.boundingBox())!
  const view = () => page.evaluate(() => { const w = window as any; return { scroll: w.__tv.scrollF, frame: w.__editor.getState().frame } })
  const y = box.y + 24 + 14, left = box.x + 160, right = box.x + box.width - 12 // track area (minus the row scrollbar)

  await page.mouse.move(left + (right - left) * 0.5, y)
  await page.mouse.move(left + (right - left) * 0.97, y, { steps: 3 }) // into the right 10%
  await expect.poll(async () => (await view()).scroll, { timeout: 5000 }).toBeGreaterThan(20)
  const a = await view()
  expect(a.frame).toBeGreaterThan(a.scroll) // the playhead stays under the pointer, inside the scrolled view

  await page.mouse.move(left + (right - left) * 0.5, y, { steps: 3 }) // middle: scrolling stops
  const mid = (await view()).scroll
  await page.waitForTimeout(300)
  expect((await view()).scroll).toBe(mid)

  await page.mouse.move(left + (right - left) * 0.02, y, { steps: 3 }) // left 10%: back towards 0
  await expect.poll(async () => (await view()).scroll, { timeout: 5000 }).toBeLessThan(mid)
  expect(errors).toEqual([])
})
