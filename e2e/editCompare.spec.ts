import { test, expect } from '@playwright/test'

// 원본 · 수정본 분리 보기: a piece's 수정 층 gets its own 수정 row with ● on the side that plays and exports; 수정 비교 shows the
// original on the main view and the 수정본 in the preview pane. Spec docs/superpowers/specs/2026-10-14-edit-compare-design.md.
test('수정 비교: main = 원본, pane = 수정본; 원본 사용 plays the original; closing shows the used side again', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const ch = 'FL_thigh_joint'
  await page.evaluate(ch => {
    const s = (window as any).__editor.getState()
    s.addActor('go2')
    const a = (window as any).__editor.getState().project.actors.at(-1)
    s.select(a.id, ch); s.setFrame(30)
  }, ch)
  // angle (deg) between the joint's pivot in two rigs at the current frame: main vs the preview pane, or main vs the original
  const rigs = () => page.evaluate(async ch => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const w = window as any, a = w.__editor.getState().project.actors.at(-1)
    const deg = (q: any) => +(2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI).toFixed(1)
    const main = w.__stage.entries().get(a.id).rig.jointPivots[ch].quaternion
    const pv = w.__stages.preview ? [...w.__stages.preview.entries().values()][0].rig.jointPivots[ch].quaternion : null
    return { main: deg(main), pv: pv ? deg(pv) : null }
  }, ch)
  const before = (await rigs()).main

  // the first 수정 key opens 수정 비교 by itself
  const num = page.getByLabel(`${ch} 숫자`)
  await num.fill('40'); await num.press('Enter')
  const pane = page.getByRole('region', { name: '클립 프리뷰' })
  await expect(pane.getByRole('button', { name: /^수정본 ·/ })).toBeVisible()
  await expect(page.getByRole('region', { name: '로봇 프리뷰' })).toContainText('로봇 프리뷰 · 원본 (')
  await expect.poll(async () => { const r = await rigs(); return [r.main, r.pv] }).toEqual([before, 40])

  // the track opened its 수정 row; ● is on the 수정본
  const useEdited = page.getByRole('button', { name: /수정본 사용$/ }), useOriginal = page.getByRole('button', { name: /원본 사용$/ })
  await expect(useEdited).toHaveAttribute('aria-pressed', 'true')
  await expect(useOriginal).toHaveAttribute('aria-pressed', 'false')

  // 겹쳐 보기: the 수정본 as a ghost on the main view
  await pane.getByRole('button', { name: '겹쳐 보기' }).click()
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage.overlay())).toBe(true)
  await pane.getByRole('button', { name: '겹쳐 보기' }).click()
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage.overlay())).toBe(false)

  // 원본 사용 by the ● of the piece's own lane (rows below the ruler: GO2 track, its piece lane, its 수정 row): playback (and CSV,
  // unit-tested) use the clip; the pane still shows the 수정본
  const box = (await page.locator('.seq-canvas').boundingBox())!
  await page.mouse.click(box.x + 26, box.y + 24 + 28 + 14)
  await expect(useOriginal).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => (window as any).__editor.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion').items[0].use)).toBe('original')
  await expect.poll(async () => (await rigs()).pv).toBe(40)

  // closing the pane: the main view draws the used side (원본 now, then the 수정본 after 수정본 사용)
  await pane.getByRole('button', { name: '수정본 닫기' }).click()
  await expect(page.getByRole('region', { name: '클립 프리뷰' })).toHaveCount(0)
  await expect.poll(async () => (await rigs()).main).toBe(before)
  await useEdited.dispatchEvent('click') // the screen-reader button (the canvas covers it)
  await expect(useEdited).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await rigs()).main).toBe(40)

  // the 수정 비교 button opens it again; 클립 프리뷰로 goes back
  await page.mouse.click(box.x + 80, box.y + 24 + 28 * 2 + 14) // the 수정 row's label
  await expect(pane.getByRole('button', { name: /^수정본 ·/ })).toBeVisible()
  await pane.getByRole('button', { name: '클립 프리뷰로' }).click()
  await expect(pane.getByRole('button', { name: /^클립 프리뷰 ·/ })).toBeVisible()
  await expect(pane.getByRole('button', { name: '수정 비교' })).toBeVisible()
})
