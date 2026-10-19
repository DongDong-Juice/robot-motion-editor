import { test, expect, type Download } from '@playwright/test'

test('내보내기: G1 / GO2 내보내기 buttons export one robot, each row 내보내기 exports one item', async ({ page }) => {
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

test('다운로드 폴더: picked once above the boxes, shown by name, used by every 내보내기; 기본으로 goes back to downloads', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any
    w.__written = []; w.__picks = 0
    w.showDirectoryPicker = async () => { w.__picks++; return { name: 'out', getFileHandle: async (name: string) => ({ createWritable: async () => ({ write: async () => { w.__written.push(name) }, close: async () => {} }) }) } }
  })
  const downloads: Download[] = []
  page.on('download', d => downloads.push(d))
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => { const s = (window as any).__editor.getState(); s.addActor('g1') })
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  await page.getByRole('menuitem', { name: '내보내기', exact: true }).click()
  const dlg = page.getByRole('dialog', { name: '내보내기' })
  await dlg.getByLabel('물리 검증 건너뛰기').check()
  await expect(dlg.locator('.exp-dir')).toHaveText('다운로드 폴더: 브라우저 기본 다운로드 폴더')
  const opts = (await dlg.locator('.exp-opts').boundingBox())!, box = (await dlg.getByRole('group', { name: 'G1' }).boundingBox())!
  expect(opts.y + opts.height).toBeLessThanOrEqual(box.y + 1) // above the boxes
  await dlg.getByRole('button', { name: '다운로드 폴더 선택' }).click()
  await expect(dlg.locator('.exp-dir')).toHaveText('다운로드 폴더: out')
  await dlg.getByRole('button', { name: 'G1 내보내기', exact: true }).click()
  await expect(dlg.getByRole('status')).toHaveText('G1 CSV 1개를 out 폴더에 내보냈습니다.')
  await dlg.getByRole('button', { name: 'G1 내보내기', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__written.length)).toBe(2)
  expect(await page.evaluate(() => (window as any).__picks)).toBe(1) // not asked again
  expect(downloads).toHaveLength(0)
  await dlg.getByRole('button', { name: '기본으로' }).click()
  await expect(dlg.locator('.exp-dir')).toHaveText('다운로드 폴더: 브라우저 기본 다운로드 폴더')
  await dlg.getByRole('button', { name: 'G1 내보내기', exact: true }).click()
  await expect.poll(() => downloads.length).toBe(1)
})

test('물리 검증 목록: a warning selects its piece and plays it in the clip preview from that frame', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => { const s = (window as any).__editor.getState(); s.addActor('go2') }) // its default clip breaks the calf limits
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  await page.getByRole('menuitem', { name: '내보내기', exact: true }).click()
  const dlg = page.getByRole('dialog', { name: '내보내기' })
  await dlg.getByLabel('물리 검증 건너뛰기').check()
  const w = dlg.getByRole('list', { name: '경고' }).getByRole('button').first()
  await w.click()
  await expect(dlg).toBeHidden()
  const st = await page.evaluate(() => { const s = (window as any).__editor.getState(), it = s.project.sequence.tracks.find((t: any) => t.kind === 'motion').items[0]; return { sel: s.selItem === it.id, prev: s.itemPreview === it.id, playing: s.previewPlaying } })
  expect(st).toEqual({ sel: true, prev: true, playing: true })
})
