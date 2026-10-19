import { test, expect, type Download } from '@playwright/test'

test('내보내기: G1 / GO2 내보내기 buttons export only that robot\'s checked items', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker; delete (window as any).showSaveFilePicker; delete (window as any).showDirectoryPicker })
  const downloads: Download[] = []
  page.on('download', d => downloads.push(d))
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => { const s = (window as any).__editor.getState(); s.addActor('g1'); s.addActor('go2') })

  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  await page.getByRole('menuitem', { name: '내보내기', exact: true }).click()
  const dlg = page.getByRole('dialog', { name: '내보내기' })
  await dlg.getByLabel('물리 검증 건너뛰기').check()

  await dlg.getByRole('button', { name: 'G1 내보내기', exact: true }).click()
  await expect(dlg.getByRole('status')).toHaveText('G1 CSV 1개를 내보냈습니다.')
  await expect.poll(() => downloads.length).toBe(1)
  expect(downloads[0].suggestedFilename()).toMatch(/G1.*\.csv$/)
  expect(downloads[0].suggestedFilename()).not.toMatch(/GO2/)

  await dlg.getByRole('button', { name: 'GO2 내보내기', exact: true }).click()
  await expect(dlg.getByRole('status')).toHaveText('GO2 CSV 1개를 내보냈습니다.')
  await expect.poll(() => downloads.length).toBe(2)
  expect(downloads[1].suggestedFilename()).toMatch(/GO2.*\.csv$/)

  // unchecking the only GO2 item disables its button
  await dlg.getByRole('group', { name: 'GO2' }).getByRole('checkbox').uncheck()
  await expect(dlg.getByRole('button', { name: 'GO2 내보내기', exact: true })).toBeDisabled()
  expect(errors).toEqual([])
})
