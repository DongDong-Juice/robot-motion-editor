import { test, expect } from '@playwright/test'

// Sequence: slim horizontal scrollbar under the lanes once the sequence is wider than the view; drag scrolls, groove pages.
test('sequence horizontal scrollbar: hidden when it all fits, drag and groove click scroll the time view', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => { const s = (window as any).__editor.getState(); s.addActor('g1') })
  const scrollF = () => page.evaluate(() => (window as any).__tv.scrollF as number)
  const seq = page.locator('.seq-canvas'), box = (await seq.boundingBox())!
  const barY = box.y + box.height - 6

  // 120 frames at the default zoom fit: no bar, a press there is a plain timeline click
  await page.evaluate(() => { (window as any).__tv.ppf = 4; (window as any).__tv.scrollF = 0; (window as any).__editor.getState().setFrame(1) })
  await page.mouse.click(box.x + 600, barY)
  expect(await scrollF()).toBe(0)
  await page.mouse.move(box.x + 600, box.y - 200) // leave the timeline: no hover scrub from that click lands later
  await page.waitForTimeout(200)

  // zoomed in: the thumb sits at the left; dragging it right scrolls
  await page.evaluate(() => { (window as any).__tv.ppf = 30; (window as any).__editor.getState().setFrame(0) })
  await page.mouse.move(box.x + 200, barY)
  const f0 = await page.evaluate(() => (window as any).__editor.getState().frame)
  await page.mouse.down(); await page.mouse.move(box.x + 500, barY, { steps: 5 }); await page.mouse.up()
  const afterDrag = await scrollF()
  expect(afterDrag).toBeGreaterThan(5)
  expect(await page.evaluate(() => (window as any).__editor.getState().frame)).toBe(f0) // the bar is not the timeline

  // a click on the groove to the left pages back toward the start
  await page.mouse.click(box.x + 165, barY)
  expect(await scrollF()).toBeLessThan(afterDrag)
  if (process.env.SHOT) { await page.mouse.move(box.x + 400, barY - 60); await page.waitForTimeout(300); await page.screenshot({ path: process.env.SHOT }) }
  expect(errors).toEqual([])
})
