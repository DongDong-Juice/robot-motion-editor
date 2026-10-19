import { test, expect, type Download } from '@playwright/test'

test('내보내기: G1 / GO2 내보내기 buttons export one robot, a row's 내보내기 exports one item', async ({ page }) => {
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

  // G1 | GO2 side by side, no item checkboxes; each item row has its own 내보내기, shown on hover at the far right
  const g1 = dlg.getByRole('group', { name: 'G1' }), go2 = dlg.getByRole('group', { name: 'GO2' })
  const [b1, b2] = [(await g1.boundingBox())!, (await go2.boundingBox())!]
  expect(b2.x).toBeGreaterThan(b1.x + b1.width - 1)
  expect(Math.abs(b2.y - b1.y)).toBeLessThan(2)
  await expect(dlg.getByRole('group', { name: /G1|GO2/ }).getByRole('checkbox')).toHaveCount(0)
  const row = go2.locator('.exp-item').first(), one = row.getByRole('button', { name: '내보내기', exact: true })
  await expect(one).toBeHidden()
  await row.hover()
  await expect(one).toBeVisible()
  const rb = (await row.boundingBox())!, ob = (await one.boundingBox())!
  expect(rb.x + rb.width - (ob.x + ob.width)).toBeLessThan(12)
  await one.click()
  await expect(dlg.getByRole('status')).toHaveText('CSV 1개를 내보냈습니다.')
  await expect.poll(() => downloads.length).toBe(3)
  expect(downloads[2].suggestedFilename()).toMatch(/GO2.*\.csv$/)
  expect(errors).toEqual([])
})
