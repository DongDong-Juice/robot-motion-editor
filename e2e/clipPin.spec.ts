import { test, expect, type Page } from '@playwright/test'

// 재생헤드 고정 in 클립 편집 (§24): the ruler / empty space right-click menu of the 트랙 and 그래프 timelines, the same switch as the
// sequence's — a pin set in the sequence can be released here; Esc closes the menu, not 클립 편집.
const boot = async (page: Page) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  return page.evaluate(async () => {
    const { parseCsvPoses, posesToClip } = await import('/src/export/importCsv.ts')
    const s = (window as any).__editor.getState()
    const text = await (await fetch('/go2-blocks/' + encodeURI('앉기_엎드리기/011_앉기.csv'))).text()
    const { robot, fps, poses } = parseCsvPoses(text, s.defs, 60)
    const clip = { ...posesToClip(poses, fps, robot, s.defs, '앉기'), id: crypto.randomUUID() }
    s.appendClip(null, clip)
    return clip.id as string
  })
}
const st = (page: Page) => page.evaluate(() => { const s = (window as any).__editor.getState(); return { pinned: s.playheadPinned, frame: s.frame, clipEdit: s.clipEdit, view: s.view } })

test('클립 편집: 재생헤드 고정 / 고정 해제 from the ruler menu (트랙 · 그래프); a sequence pin is released here; Esc keeps 클립 편집', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  const clipId = await boot(page)
  await page.evaluate(() => (window as any).__editor.getState().setPlayheadPinned(true)) // pinned in the sequence
  await page.evaluate(id => (window as any).__editor.getState().openClipEdit(id), clipId)
  const cv = page.locator('canvas.track-canvas:not(.seq-canvas)'), menu = page.getByRole('menu', { name: '재생헤드' })
  await expect(cv).toBeVisible()
  const box = (await cv.boundingBox())!
  // the pin carried over: the menu offers 고정 해제
  await page.mouse.click(box.x + 260, box.y + 10, { button: 'right' })
  await expect(menu.getByRole('menuitem')).toHaveText('고정 해제')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  expect(await st(page)).toMatchObject({ pinned: true, clipEdit: clipId }) // Esc closed the menu only
  await page.mouse.click(box.x + 260, box.y + 10, { button: 'right' })
  await menu.getByRole('menuitem', { name: '고정 해제' }).click()
  expect((await st(page)).pinned).toBe(false)
  // unpinned: the playhead follows the pointer; pinned from here: it stays
  await page.mouse.move(box.x + 220, box.y + 40); await page.mouse.move(box.x + 300, box.y + 40)
  await expect.poll(async () => (await st(page)).frame).toBeGreaterThan(0)
  await page.mouse.click(box.x + 300, box.y + 60, { button: 'right' }) // empty track space
  await menu.getByRole('menuitem', { name: '재생헤드 고정' }).click()
  const f0 = (await st(page)).frame
  await page.mouse.move(box.x + 200, box.y + 40); await page.mouse.move(box.x + 240, box.y + 40)
  await page.waitForTimeout(200)
  expect((await st(page)).frame).toBe(f0)
  // 그래프 view: the same menu
  await page.evaluate(() => (window as any).__editor.getState().setView('graph'))
  const g = page.locator('canvas.track-canvas:not(.seq-canvas)'), gb = (await g.boundingBox())!
  await page.mouse.click(gb.x + 260, gb.y + 80, { button: 'right' })
  await menu.getByRole('menuitem', { name: '고정 해제' }).click()
  expect(await st(page)).toMatchObject({ pinned: false, clipEdit: clipId, view: 'graph' })
  expect(errors).toEqual([])
})
