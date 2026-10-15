import { test, expect } from '@playwright/test'

// Sequence wheel: a plain wheel never moves time (it scrolls the rows only when they overflow); Shift + wheel or a sideways
// trackpad swipe scrolls time; Ctrl + wheel zooms.
test('sequence wheel: rows only; Shift or sideways for time', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => { const s = (window as any).__editor.getState(); s.addActor('g1'); (window as any).__tv.scrollF = 100 })
  const box = (await page.locator('.seq-canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5)
  const f = () => page.evaluate(() => (window as any).__tv.scrollF as number)
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(100)
  expect(await f()).toBe(100) // plain wheel: time stays
  await page.keyboard.down('Shift'); await page.mouse.wheel(0, 400); await page.keyboard.up('Shift')
  await expect.poll(f).toBeGreaterThan(100)
  const before = await f()
  await page.mouse.wheel(300, 0) // sideways swipe
  await expect.poll(f).toBeGreaterThan(before)
})

// Rows that fit must not move at all on the wheel — not even for one frame (the old code drew them shifted, then snapped back:
// flicker); rows that overflow ease to the end and stop there.
test('sequence wheel: no one-frame shift when the rows fit; eased scroll that stops at the end', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => (window as any).__editor.getState().addActor('g1'))
  const frames = (dy: number, n = 8) => page.evaluate(async ([dy, n]) => {
    const c = document.querySelector<HTMLCanvasElement>('.seq-canvas')!, r = c.getBoundingClientRect(), out: string[] = []
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)))
    out.push(c.toDataURL())
    c.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, clientX: r.left + r.width * 0.6, clientY: r.top + r.height * 0.6, bubbles: true, cancelable: true }))
    for (let i = 0; i < n; i++) { await new Promise(res => requestAnimationFrame(res)); out.push(c.toDataURL()) }
    return out
  }, [dy, n] as const)
  await page.evaluate(() => document.fonts.ready) // the canvas redraws once IBM Plex arrives: not a wheel effect
  const fit = await frames(120)
  expect(new Set(fit).size).toBe(1) // nothing moved in any frame

  await page.evaluate(() => { const s = (window as any).__editor.getState(); for (let i = 0; i < 12; i++) s.addActor(i % 2 ? 'go2' : 'g1') }) // rows overflow
  const down = await frames(100000, 40) // far past the end
  expect(new Set(down).size).toBeGreaterThan(2) // eased over several frames
  expect(down.at(-1)).toBe(down.at(-2)) // and settled
  const again = await frames(500, 6) // already at the end: no frame changes
  expect(new Set(again).size).toBe(1)
})
