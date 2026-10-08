import { test, expect } from '@playwright/test'

// Regression: each preview pane used to keep its WebGL context after closing, so opening/switching
// clip previews ~16 times made the browser drop the oldest context (the main robot preview went white).
test('opening and switching clip previews never loses the main robot preview context', async ({ page }) => {
  test.setTimeout(180000) // each preview builds a WebGL scene; slow under software GL
  const warnings: string[] = []
  page.on('console', m => { if (/Too many active WebGL contexts|Context Lost/i.test(m.text())) warnings.push(m.text()) })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => {
    const e = (window as any).__editor
    e.getState().addActor('g1')
    const t = () => e.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion')
    e.getState().splitItem(t().items[0].id, 40)
    e.getState().splitItem(t().items.find((i: any) => i.start === 40).id, 80)
  })
  for (let i = 0; i < 24; i++) { // well past the browser's ~16 live-context limit
    await page.evaluate(i => {
      const s = (window as any).__editor.getState()
      const items = s.project.sequence.tracks.find((t: any) => t.kind === 'motion').items
      s.openItemPreview(items[i % items.length].id)
      if (i % 5 === 4) s.closeItemPreview()
    }, i)
    await page.waitForTimeout(60)
  }
  const alive = await page.evaluate(() => [...document.querySelectorAll('#stage canvas')].map(c =>
    !((c as HTMLCanvasElement).getContext('webgl2') ?? (c as HTMLCanvasElement).getContext('webgl'))!.isContextLost()))
  expect(alive.length).toBeGreaterThan(0)
  expect(alive.every(Boolean)).toBe(true)
  expect(warnings).toEqual([])
})
