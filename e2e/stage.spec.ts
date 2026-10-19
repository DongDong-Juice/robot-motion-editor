import { test, expect } from '@playwright/test'

test('무대: on by default, size from the inspector, off hides stage and section', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const pane = page.getByRole('region', { name: '로봇 프리뷰' })
  const btn = pane.getByRole('button', { name: '무대', exact: true })
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  const w = page.getByRole('spinbutton', { name: '무대 가로' }), d = page.getByRole('spinbutton', { name: '무대 깊이' })
  await expect(w).toHaveValue('10'); await expect(d).toHaveValue('6')
  await d.fill('4'); await d.blur()
  const size = () => page.evaluate(() => {
    const p = (window as any).__stage.stage()?.getObjectByName('floor').geometry.parameters
    return p ? [p.width, p.height] : null
  })
  await expect.poll(size).toEqual([4, 10]) // PlaneGeometry(depth(X), width(Y))
  await w.fill('100'); await w.blur(); await expect(w).toHaveValue('30')
  await w.fill(''); await w.blur(); await expect(w).toHaveValue('30')
  expect(await page.evaluate(() => (window as any).__stage.stage().parent.children.filter((c: any) => c.name === 'stage').length)).toBe(1)
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'false')
  await expect(w).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__stage.stage())).toBeNull()
  expect(errors).toEqual([])
})

test('무대: clip preview pane keeps its own stage when the main one is off', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => {
    const e = (window as any).__editor
    e.getState().addActor('g1')
    const t = e.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion')
    e.getState().openItemPreview(t.items[0].id, true)
  })
  await page.getByRole('region', { name: '로봇 프리뷰' }).getByRole('button', { name: '무대', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__stage.stage())).toBeNull()
  await expect.poll(() => page.evaluate(() => (window as any).__stages.preview?.stage() != null)).toBe(true)
})
