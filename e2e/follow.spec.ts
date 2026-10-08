import { test, expect } from '@playwright/test'

test('로봇 따라가기: camera target tracks the robot while on, stays put when off', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const last = await page.evaluate(() => {
    const s = (window as any).__editor.getState()
    s.addActor('g1')
    const clip = (() => { const p = (window as any).__editor.getState().project; const it = p.sequence.tracks.find((t: any) => t.kind === 'motion').items[0]; return p.clips[it.refId] })()
    const end = clip.length - 1
    const st = () => (window as any).__editor.getState()
    st().setKey(clip.id, 'root.x', 0, 0)
    st().setKey(clip.id, 'root.x', end, 2)
    return end
  })
  const btn = page.getByRole('region', { name: '로봇 프리뷰' }).getByRole('button', { name: '로봇 따라가기' })
  await expect(btn).toHaveAttribute('aria-pressed', 'false')
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(f => (window as any).__editor.getState().setFrame(f), last)
  const read = () => page.evaluate(() => {
    const h = (window as any).__stage
    return { t: h.camTarget() as number[], x: [...h.entries().values()][0].rig.root.position.x as number }
  })
  await expect.poll(async () => { const r = await read(); return Math.abs(r.t[0] - r.x) }).toBeLessThan(0.05)
  expect((await read()).x).toBeGreaterThan(1.5)

  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'false')
  const before = (await read()).t
  await page.evaluate(() => (window as any).__editor.getState().setFrame(0))
  await page.waitForTimeout(300)
  const after = await read()
  expect(after.x).toBeLessThan(0.5)
  expect(after.t).toEqual(before)
  expect(errors).toEqual([])
})
