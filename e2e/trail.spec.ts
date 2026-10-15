import { test, expect } from '@playwright/test'

// 경로 표시 is per track (sequence label icon), not one switch for every robot on the main stage.
test('track 경로 표시: only that robot draws its floor path on the main stage', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => { const s = (window as any).__editor.getState(); s.addActor('g1'); s.addActor('go2') }) // the app starts empty
  const shown = () => page.evaluate(() => {
    const s = (window as any).__editor.getState(), st = (window as any).__stage
    return s.project.actors.map((a: any) => st.entries().get(a.id)?.trail.visible ?? null)
  })
  await expect.poll(shown).toEqual([false, false])
  // the main pane has no global switch any more
  await expect(page.getByRole('button', { name: '경로 표시', exact: true })).toHaveCount(0)

  const btn = page.getByRole('button', { name: /경로 표시$/ })
  await expect(btn).toHaveCount(2)
  await btn.nth(1).dispatchEvent('click') // second track only
  await expect(btn.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(shown).toEqual([false, true])
  const pts = await page.evaluate(() => {
    const s = (window as any).__editor.getState(), a = s.project.actors[1]
    return (window as any).__stage.entries().get(a.id).trail.geometry.getAttribute('position')?.count ?? 0
  })
  expect(pts).toBeGreaterThan(0)

  // the path icon on the first track's label row toggles it with the mouse
  const box = (await page.locator('.seq-canvas').boundingBox())!
  await page.mouse.move(box.x + 160 - 56, box.y + 24 + 14)
  await expect(page.locator('.seq-canvas')).toHaveAttribute('title', /^경로 표시/)
  await page.mouse.click(box.x + 160 - 56, box.y + 24 + 14)
  await expect.poll(shown).toEqual([true, true])

  // hiding the track hides its path too
  await page.getByRole('button', { name: /숨기기$/ }).first().dispatchEvent('click')
  await expect.poll(shown).toEqual([false, true])
  expect(errors).toEqual([])
})
