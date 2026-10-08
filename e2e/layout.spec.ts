import { test, expect } from '@playwright/test'

test('resize handle: arrows resize without stepping the frame; drag leaves no focus', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => (window as any).__editor.getState().addActor('g1')) // frames only step within the sequence
  const frame = () => page.evaluate(() => (window as any).__editor.getState().frame)
  const f0 = await frame()
  const h = page.getByRole('separator', { name: '프로젝트 패널 너비' })
  const w0 = Number(await h.getAttribute('aria-valuenow'))
  await h.focus()
  await page.keyboard.press('ArrowRight')
  expect(Number(await h.getAttribute('aria-valuenow'))).toBe(w0 + 16)
  expect(await frame()).toBe(f0)
  const inF = () => page.evaluate(() => (window as any).__editor.getState().project.sequence.inF)
  await page.evaluate(() => (window as any).__editor.getState().setIn(7))
  expect(await inF()).toBe(7)
  await page.keyboard.press('Control+z') // undo still works while a handle is focused
  expect(await inF()).toBeNull()
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  const bb = (await h.boundingBox())!
  await page.mouse.move(bb.x + 3, bb.y + 100); await page.mouse.down(); await page.mouse.move(bb.x + 40, bb.y + 100); await page.mouse.up()
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).not.toBe('separator')
  await page.keyboard.press('ArrowRight')
  expect(await frame()).toBe(f0 + 1)
})
