import { test, expect } from '@playwright/test'
import { importSynthetic } from './synth'

// 원본 조각 and 수정본 apart: the 수정 row is named after its piece ('#2 · F150–300 수정본'); Delete on the 수정 row removes only the
// 수정본, Delete on the piece lane removes only the original (the 수정본 stays); 수정 완료 bakes the 수정본 into a new clip.
test('수정본 / 원본 delete separately; 수정 완료 makes a new clip', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await importSynthetic(page, 'pe')
  await page.evaluate(() => (window as any).__editor.getState().setFrame(150))
  const cv = page.locator('.seq-canvas')
  await cv.focus(); await page.keyboard.press('c')
  const edit = () => page.evaluate(() => { // a 수정 on piece #2 (이 조각 수정 is the default)
    const s = (window as any).__editor.getState(), t = s.project.sequence.tracks.find((t: any) => t.kind === 'motion')
    s.setFrame(200); s.select(t.actorId, 'left_knee_joint'); s.setValue(t.actorId, 'left_knee_joint', 1.4)
  })
  const state = () => page.evaluate(() => {
    const s = (window as any).__editor.getState(), t = s.project.sequence.tracks.find((t: any) => t.kind === 'motion')
    return [...t.items].sort((a: any, b: any) => a.start - b.start).map((i: any) => ({ edited: !!i.offset && Object.keys(i.offset).length > 0, noOriginal: !!i.noOriginal, clip: s.project.clips[i.refId].name }))
  })
  await edit()
  // rows: ruler 24 · track 28 · lane #1 · lane #2 · 수정 row of #2
  const box = (await cv.boundingBox())!, rowY = (n: number) => box.y + 24 + 28 * n + 14
  await page.mouse.move(box.x + 80, rowY(3))
  await expect.poll(() => cv.getAttribute('title')).toContain('#2 · F150–300 수정본')

  // Delete on the 수정 row: the 수정본 goes, piece #2 stays as the original
  await page.mouse.click(box.x + 80, rowY(3))
  await page.keyboard.press('Delete')
  await expect.poll(state).toEqual([{ edited: false, noOriginal: false, clip: 'pe' }, { edited: false, noOriginal: false, clip: 'pe' }])

  // Delete on the piece lane: the original goes, the 수정본 stays (now the lane itself)
  await edit()
  await page.mouse.click(box.x + 80, rowY(2))
  await page.keyboard.press('Delete')
  await expect.poll(state).toEqual([{ edited: false, noOriginal: false, clip: 'pe' }, { edited: true, noOriginal: true, clip: 'pe' }])
  await page.mouse.move(box.x + 80, rowY(2) + 1)
  await expect.poll(() => cv.getAttribute('title')).toContain('원본 삭제됨')

  // 수정 완료 from the right-click menu: a new clip in 목록, the piece plays it
  await page.mouse.click(box.x + 80, rowY(2), { button: 'right' })
  await page.getByRole('menuitem', { name: '수정 완료 (새 클립으로)' }).click()
  await expect.poll(state).toEqual([{ edited: false, noOriginal: false, clip: 'pe' }, { edited: false, noOriginal: false, clip: 'pe #2 수정본' }])
  await expect(page.locator('.pp-card', { hasText: 'pe #2 수정본' })).toBeVisible()
  expect(errors).toEqual([])
})
