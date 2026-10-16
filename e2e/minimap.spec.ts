import { test, expect } from '@playwright/test'

// Sequence minimap (the strip under the lanes, where the horizontal scrollbar was): the whole sequence with the visible window boxed.
// Drag inside = scroll, drag the right edge = zoom (left edge fixed), click outside = centre there, double-click = fit everything.
test('minimap: always shown; drag scrolls, edge zooms, outside click centres, double-click fits; the playhead never moves', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => { const s = (window as any).__editor.getState(); s.addActor('g1'); s.setFrame(5) }) // a 120-frame clip
  const tv = () => page.evaluate(() => ({ ...(window as any).__tv }) as { scrollF: number; ppf: number })
  const frame = () => page.evaluate(() => (window as any).__editor.getState().frame as number)
  const seq = page.locator('.seq-canvas'), box = (await seq.boundingBox())!
  const y = box.y + box.height - 12, x0 = box.x + 160, x1 = box.x + box.width - 12 // strip: track area minus the row scrollbar
  const xAt = (f: number, t: { scrollF: number; ppf: number }) => { // frame → strip x, as minimap.ts lays it out
    const vis = (x1 - x0) / t.ppf, total = Math.max(120 + vis / 2, t.scrollF + vis, 1)
    return x0 + f / total * (x1 - x0)
  }

  await page.evaluate(() => { (window as any).__tv.ppf = 30; (window as any).__tv.scrollF = 0 }) // zoomed in: the window is a small box at the left
  await page.mouse.move(box.x + 600, box.y - 200)
  let t = await tv()
  const vis = (x1 - x0) / t.ppf
  // drag inside the window to the right: scrolls, zoom unchanged
  const mid = (xAt(0, t) + xAt(vis, t)) / 2
  await page.mouse.move(mid, y); await page.mouse.down(); await page.mouse.move(mid + 150, y, { steps: 5 }); await page.mouse.up()
  t = await tv()
  expect(t.scrollF).toBeGreaterThan(5)
  expect(t.ppf).toBe(30)

  // drag the right edge further right: zooms out, the left edge (scrollF) stays
  const s0 = t.scrollF, right = xAt(t.scrollF + vis, t)
  await page.mouse.move(right, y); await page.mouse.down(); await page.mouse.move(right + 120, y, { steps: 5 }); await page.mouse.up()
  t = await tv()
  expect(t.ppf).toBeLessThan(30)
  expect(t.scrollF).toBeCloseTo(s0, 5)

  // click outside the window, at the far left: the window jumps there
  await page.mouse.click(x0 + 2, y)
  expect((await tv()).scrollF).toBe(0)

  // double-click: the whole sequence fits (120 frames over the track area)
  await page.mouse.dblclick(box.x + 700, y)
  t = await tv()
  expect(t.scrollF).toBe(0)
  expect(t.ppf).toBeCloseTo((x1 - x0) / 120, 1)

  expect(await frame()).toBe(5) // the minimap is not the timeline
  expect(errors).toEqual([])
})
