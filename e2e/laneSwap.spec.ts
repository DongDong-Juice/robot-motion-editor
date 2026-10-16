import { test, expect } from '@playwright/test'
import { importSynthetic } from './synth'

// A lane bar dragged up / down onto another piece's lane of the same track trades places with that piece (user).
test('drag a piece onto another lane: the two pieces trade places', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await importSynthetic(page, 'sw')
  const cv = page.locator('.seq-canvas')
  for (const f of [100, 200]) { await page.evaluate(f => (window as any).__editor.getState().setFrame(f), f); await cv.focus(); await page.keyboard.press('c') }
  const order = () => page.evaluate(() => { const t = (window as any).__editor.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion')
    return [...t.items].sort((a: any, b: any) => a.start - b.start).map((i: any) => i.trimIn) })
  expect(await order()).toEqual([0, 100, 200])

  // rows below the ruler: track (n 0), lane #1 (1), #2 (2), #3 (3); grab piece #3's bar (frame 250) and drop it on lane #1
  const box = (await cv.boundingBox())!, rowY = (n: number) => box.y + 24 + 28 * n + 14
  const x = await page.evaluate(() => { const tv = (window as any).__tv; return 160 + (250 - tv.scrollF) * tv.ppf })
  await page.mouse.move(box.x + x, rowY(3)); await page.mouse.down()
  await page.mouse.move(box.x + x, rowY(2), { steps: 3 }); await page.mouse.move(box.x + x, rowY(1), { steps: 3 })
  await page.mouse.up()
  await expect.poll(order).toEqual([200, 100, 0]) // #3 now plays first, #1 last
  await page.keyboard.press('Control+z')
  await expect.poll(order).toEqual([0, 100, 200])
  expect(errors).toEqual([])
})
