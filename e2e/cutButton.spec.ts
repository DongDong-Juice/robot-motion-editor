import { test, expect } from '@playwright/test'

// 자르기 button: type a sequence frame (prefilled with the playhead) and the piece there is cut; same target rule as the C key.
test('자르기 button: cuts the piece at the typed frame; no piece → message; Esc closes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => { const s = (window as any).__editor.getState(); s.addActor('g1'); s.setFrame(10) })
  const items = () => page.evaluate(() => (window as any).__editor.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion').items
    .map((i: any) => [i.start, i.trimIn, i.trimOut]).sort((a: number[], b: number[]) => a[0] - b[0]))
  const len = (await items())[0][2]

  await page.getByRole('button', { name: '자르기', exact: true }).click()
  const input = page.getByLabel('자를 프레임')
  await expect(input).toHaveValue('10') // starts at the playhead

  await input.fill(String(len + 50)); await input.press('Enter') // past the clip
  await expect(page.getByRole('group', { name: '자르기' }).getByRole('status')).toHaveText('그 프레임에 자를 조각이 없습니다')

  await input.fill('45'); await input.press('Enter')
  await expect(input).toHaveCount(0) // closes after cutting
  expect(await items()).toEqual([[0, 0, 45], [45, 45, len]])
  const s = await page.evaluate(() => { const s = (window as any).__editor.getState(); return { frame: s.frame, sel: s.project.sequence.tracks.find((t: any) => t.kind === 'motion').items.find((i: any) => i.id === s.selItem)?.start } })
  expect(s).toEqual({ frame: 45, sel: 45 }) // playhead moved there, right piece selected
  expect(await page.evaluate(() => (window as any).__editor.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion').items
    .map((i: any) => i.restTail))).toEqual([true, true]) // 끝 기본자세 on both pieces

  await page.getByRole('button', { name: '자르기', exact: true }).click()
  await page.getByLabel('자를 프레임').press('Escape')
  await expect(page.getByLabel('자를 프레임')).toHaveCount(0)
  expect((await items()).length).toBe(2)
})
