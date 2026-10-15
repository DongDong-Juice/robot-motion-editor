import { test, expect, type Page } from '@playwright/test'

const items = (page: Page) => page.evaluate(() =>
  (window as any).__editor.getState().project.sequence.tracks.filter((t: any) => t.kind === 'motion')
    .map((t: any) => t.items.map((i: any) => [i.start, i.trimOut - i.trimIn]))) as Promise<number[][][]>

test('Ctrl+Z during a drag cancels only that drag; Ctrl+Z after it undoes as usual', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const joints = await page.evaluate(() => (window as any).__editor.getState().defs.g1.joints.map((j: { name: string }) => j.name) as string[])
  const head = ['frequency(fps)', 'RobotType', 'DOF Number', 'time(ms)', 'position X(m)', 'position Y(m)', 'position Z(m)',
    'quaternion X', 'quaternion Y', 'quaternion Z', 'quaternion W', ...joints].join(',') + ','
  const csv = Buffer.from([head, ...Array.from({ length: 60 }, (_, i) =>
    [60, 0, 29, Math.round(i * 1000 / 60), (0.01 * i).toFixed(6), '0.000000', '0.790000', '0', '0', '0', '1',
      ...joints.map((_, j) => (0.02 * Math.sin(i / 9 + j)).toFixed(6))].join(',') + ',')].join('\n') + '\n')
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'CSV 가져오기', exact: true }).click()])
  await fc.setFiles([{ name: 'a.csv', mimeType: 'text/csv', buffer: csv }])
  await expect(page.getByText('클립 1개를 가져왔습니다')).toBeVisible()
  await page.evaluate(() => { // second placement at frame 100: the last undoable action
    const s = (window as any).__editor.getState(), t = s.project.sequence.tracks.find((t: any) => t.kind === 'motion')
    s.addItem(t.actorId, t.items[0].refId, 100)
  })
  expect(await items(page)).toEqual([[[0, 60], [100, 60]]])

  const box = (await page.locator('.seq-canvas').boundingBox())!
  const y = box.y + 24 + 28 * 2 + 14, x = box.x + 160 + 120 * 4 // second piece's lane (two pieces open one lane each), inside its bar (4 px/frame, label 160)
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x + 80, y, { steps: 4 })
  await page.keyboard.press('Control+z')
  await page.mouse.move(x + 160, y, { steps: 4 })
  await page.mouse.up()
  expect(await items(page)).toEqual([[[0, 60], [100, 60]]]) // drag dropped, the placement kept

  await page.keyboard.press('Control+z')
  expect(await items(page)).toEqual([[[0, 60]]])

  await page.keyboard.press('Control+Shift+z')
  expect(await items(page)).toEqual([[[0, 60], [100, 60]]])
  await page.mouse.move(x, y); await page.mouse.down() // a plain drag still commits
  await page.mouse.move(x + 80, y, { steps: 4 }); await page.mouse.up()
  expect(await items(page)).toEqual([[[0, 60], [120, 60]]])
  expect(errors).toEqual([])
})
