import { test, expect } from '@playwright/test'
import { importSynthetic } from './synth'

// A cut piece carries its own 수정 (no separate 수정본 row): its lane is marked 수정됨; right-click 수정 지우기;
// Delete removes the piece with its 수정.
test('수정됨 on the piece lane; 수정 지우기, Delete', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await importSynthetic(page, 'pe')
  await page.evaluate(() => (window as any).__editor.getState().setFrame(150))
  const cv = page.locator('.seq-canvas')
  await cv.focus(); await page.keyboard.press('c')
  const edit = () => page.evaluate(() => { // a 수정 on piece #2
    const s = (window as any).__editor.getState(), t = s.project.sequence.tracks.find((t: any) => t.kind === 'motion')
    s.setFrame(200); s.select(t.actorId, 'left_knee_joint'); s.setValue(t.actorId, 'left_knee_joint', 1.4)
  })
  const state = () => page.evaluate(() => {
    const s = (window as any).__editor.getState(), t = s.project.sequence.tracks.find((t: any) => t.kind === 'motion')
    return [...(t?.items ?? [])].sort((a: any, b: any) => a.start - b.start).map((i: any) => ({ edited: !!i.offset && Object.keys(i.offset).length > 0, clip: s.project.clips[i.refId].name }))
  })
  await edit()
  // rows: ruler 24 · track 28 · lane #1 · lane #2 — and nothing under them (no 수정본 row)
  const box = (await cv.boundingBox())!, rowY = (n: number) => box.y + 24 + 28 * n + 14
  await page.mouse.move(box.x + 80, rowY(2))
  await expect.poll(() => cv.getAttribute('title')).toContain('수정됨 · 수정 키')
  await page.mouse.move(box.x + 80, rowY(3))
  await expect.poll(() => cv.getAttribute('title')).toBe('')

  // right-click 수정 지우기: the piece is the original again
  await page.mouse.click(box.x + 80, rowY(2), { button: 'right' })
  await expect(page.getByRole('menuitem', { name: '수정본 사용' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: '수정 지우기' }).click()
  await expect.poll(state).toEqual([{ edited: false, clip: 'pe' }, { edited: false, clip: 'pe' }])

  // Delete on a 수정됨 lane removes the piece with its 수정
  await edit()
  await page.evaluate(() => (window as any).__editor.getState().setFrame(0))
  await page.mouse.click(box.x + 80, rowY(2))
  await page.keyboard.press('Delete')
  await expect.poll(state).toEqual([{ edited: false, clip: 'pe' }])
  expect(errors).toEqual([])
})
