import { test, expect } from '@playwright/test'
import { importSynthetic } from './synth'

// Piece lane play button (left of the eye): plays that piece's loop in the clip preview; on the playing piece it pauses / resumes.
test('lane play button: play, pause, resume; another piece switches the preview', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await importSynthetic(page, 'lp')
  await page.evaluate(() => (window as any).__editor.getState().setFrame(150))
  const cv = page.locator('.seq-canvas')
  await cv.focus(); await page.keyboard.press('c') // two pieces → lanes (rows: ruler 24 · track 28 · lane #1 · lane #2)
  const ids = await page.evaluate(() => [...(window as any).__editor.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion').items]
    .sort((a: any, b: any) => a.start - b.start).map((i: any) => i.id))
  const box = (await cv.boundingBox())!, play = (lane: number) => page.mouse.click(box.x + 160 - 56, box.y + 24 + 28 * lane + 14) // PLAY_X
  const st = () => page.evaluate(() => { const s = (window as any).__editor.getState(); return { id: s.itemPreview, pv: s.previewPlaying, hidden: s.project.sequence.tracks.find((t: any) => t.kind === 'motion').items.some((i: any) => i.hidden) } })

  await play(2)
  await expect(page.getByRole('region', { name: '클립 프리뷰' })).toBeVisible()
  expect(await st()).toEqual({ id: ids[1], pv: true, hidden: false })
  await play(2); expect(await st()).toMatchObject({ id: ids[1], pv: false }) // pause
  const pf = await page.evaluate(() => (window as any).__editor.getState().previewFrame)
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => (window as any).__editor.getState().previewFrame)).toBe(pf) // stays put while paused
  await play(2); expect(await st()).toMatchObject({ id: ids[1], pv: true }) // resume
  await play(1); expect(await st()).toEqual({ id: ids[0], pv: true, hidden: false }) // another piece
  expect(errors).toEqual([])
})
