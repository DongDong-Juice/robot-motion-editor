import fs from 'node:fs'
import { test, expect, type Download } from '@playwright/test'

test('right-click an item bar or tree child row → export하기 saves exactly that item', async ({ page }) => {
  test.setTimeout(120_000) // export waits for the physics check, slow under parallel load
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker; delete (window as any).showSaveFilePicker })
  const downloads: Download[] = []
  page.on('download', d => downloads.push(d))
  page.on('dialog', d => d.accept())
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const joints = await page.evaluate(() => (window as any).__editor.getState().defs.g1.joints.map((j: { name: string }) => j.name) as string[])
  const head = ['frequency(fps)', 'RobotType', 'DOF Number', 'time(ms)', 'position X(m)', 'position Y(m)', 'position Z(m)',
    'quaternion X', 'quaternion Y', 'quaternion Z', 'quaternion W', ...joints].join(',') + ','
  const csv = Buffer.from([head, ...Array.from({ length: 120 }, (_, i) =>
    [60, 0, 29, Math.round(i * 1000 / 60), (0.01 * i).toFixed(6), '0.000000', '0.790000', '0', '0', '0', '1',
      ...joints.map((_, j) => (0.02 * Math.sin(i / 9 + j)).toFixed(6))].join(',') + ',')].join('\n') + '\n')
  await page.getByRole('button', { name: '파일', exact: true }).click()
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'CSV 가져오기', exact: true }).click()])
  await fc.setFiles([{ name: 'a.csv', mimeType: 'text/csv', buffer: csv }])
  const seq = page.locator('.seq-canvas')
  await expect.poll(() => page.evaluate(() => (window as any).__editor.getState().project.sequence.tracks.some((t: any) => t.items.length))).toBe(true)
  await page.evaluate(() => (window as any).__editor.getState().setFrame(60))
  await seq.focus(); await page.keyboard.press('c')
  await expect.poll(() => page.evaluate(() => (window as any).__editor.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion').items.length)).toBe(2)

  const box = (await seq.boundingBox())!
  const menu = page.getByRole('menu', { name: '클립' })
  await page.mouse.click(box.x + 400, box.y + 24 + 14, { button: 'right' }) // second bar (frames 60-120 at 4 px/frame, label 160)
  await expect(menu.getByRole('menuitem')).toHaveText(['export하기', '물리 검증'])
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await page.mouse.click(box.x + 400, box.y + 24 + 14, { button: 'right' })
  await page.mouse.click(box.x + 20, box.y + 24 + 14 + 100) // outside
  await expect(menu).toHaveCount(0)

  await page.mouse.click(box.x + 400, box.y + 24 + 14, { button: 'right' })
  await page.keyboard.press('Enter')
  await expect(page.locator('.seq-msg')).toContainText('G1_a.csv 을(를) 내보냈습니다', { timeout: 45_000 }) // waits for the physics check
  await expect.poll(() => downloads.length).toBe(1)
  expect(downloads[0].suggestedFilename()).toBe('G1_a.csv')
  const lines = fs.readFileSync((await downloads[0].path())!, 'utf8').split('\n')
  expect(lines[0]).toBe(head)
  expect(lines).toHaveLength(61)
  lines.slice(1).forEach(l => expect(l.split(',')).toHaveLength(41))

  await page.mouse.click(box.x + 8, box.y + 24 + 14) // expand the track
  await page.mouse.click(box.x + 60, box.y + 24 + 28 + 22 + 11, { button: 'right' }) // second child row
  await expect(menu.getByRole('menuitem', { name: 'export하기' })).toBeVisible()
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})
