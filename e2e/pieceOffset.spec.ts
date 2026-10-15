import { test, expect } from '@playwright/test'

// 조각 수정 층: the inspector always edits the piece's offset (no 편집 대상 choice, no 자동 키), the shared clip stays as it was.
test('edits go to the piece: clip untouched; no 편집 대상 / 자동 키 controls; 수정 지우기 restores', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const ch = 'FL_thigh_joint'
  await page.evaluate(ch => {
    const s = (window as any).__editor.getState()
    s.addActor('go2')
    const a = (window as any).__editor.getState().project.actors.at(-1)
    s.select(a.id, ch); s.setFrame(30)
  }, ch)
  const state = () => page.evaluate(ch => {
    const p = (window as any).__editor.getState().project, it = p.sequence.tracks.find((t: any) => t.kind === 'motion').items[0]
    return { clipKeys: p.clips[it.refId].channels[ch]?.keys.length ?? 0, offset: it.offset?.[ch]?.keys.map((k: any) => [k.f, +k.v.toFixed(4)]) ?? null }
  }, ch)

  await expect(page.getByRole('button', { name: '원본 클립 수정' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '자동 키' })).toHaveCount(0)
  await expect(page.getByRole('slider', { name: `${ch} 슬라이더` })).toBeEnabled()
  const num = page.getByLabel(`${ch} 숫자`)
  await num.fill('40'); await num.press('Enter')
  await expect.poll(state).toEqual({ clipKeys: 0, offset: [[15, 0], [30, +(40 * Math.PI / 180 - 0).toFixed(4)], [45, 0]] }) // eased back around the edit
  await expect(page.getByText('이 조각의 수정 키 3개')).toBeVisible()

  await page.getByRole('button', { name: '수정 지우기' }).click()
  await expect.poll(state).toEqual({ clipKeys: 0, offset: null })
})
