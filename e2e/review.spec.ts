import { test, expect } from '@playwright/test'

// 검수 목록 (§12): a CSV whose right wrist flips 2.5 rad at frame 150 (and stays) shows one 로봇 한계 초과 item; a verdict hides it;
// 타임라인에서 보기 moves the playhead there. Nothing in the project changes.
test('검수 목록 finds a held joint flip, takes a verdict and jumps to it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker }) // the <input type=file> path, so Playwright gets the chooser
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const joints = await page.evaluate(() => (window as any).__editor.getState().defs.g1.joints.map((j: { name: string }) => j.name) as string[])
  const head = ['frequency(fps)', 'RobotType', 'DOF Number', 'time(ms)', 'position X(m)', 'position Y(m)', 'position Z(m)',
    'quaternion X', 'quaternion Y', 'quaternion Z', 'quaternion W', ...joints].join(',') + ','
  const wrist = joints.indexOf('right_wrist_roll_joint')
  const csv = Buffer.from([head, ...Array.from({ length: 300 }, (_, i) =>
    [60, 0, 29, Math.round(i * 1000 / 60), (0.002 * i).toFixed(6), '0.000000', '0.780000', '0', '0', '0', '1',
      ...joints.map((_, j) => (0.3 * Math.sin(i / 40 + j) + (j === wrist && i >= 150 ? 1.25 : j === wrist ? -1.25 : 0)).toFixed(6))].join(',') + ',')].join('\n'))
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'CSV 가져오기', exact: true }).click()])
  await fc.setFiles([{ name: 'flip.csv', mimeType: 'text/csv', buffer: csv }])
  await expect.poll(() => page.evaluate(() => (window as any).__editor.getState().project.sequence.tracks.some((t: any) => t.items.length))).toBe(true)
  const before = await page.evaluate(() => JSON.stringify((window as any).__editor.getState().project))

  await page.getByRole('button', { name: '⚠ 검수 목록' }).click()
  const dlg = page.getByRole('dialog', { name: '검수 목록' })
  await expect(dlg).toBeVisible()
  const items = dlg.locator('.rv-item')
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText('로봇 한계 초과')
  await expect(items.first()).toContainText('오른팔')
  await expect(items.first()).toContainText('f150')
  await expect(dlg.locator('.rv-title')).toContainText('f150')
  await expect(dlg.locator('.rv-title')).toContainText('CSV 151행')
  await expect(dlg.locator('.rv-chart rect')).toHaveCount(25) // 앞뒤 12프레임
  await expect(dlg.locator('.rv-view canvas')).toHaveCount(1)

  await dlg.getByRole('button', { name: '◀ 1' }).click()
  await expect(dlg.locator('.rv-title')).toContainText('f149')
  await dlg.getByRole('button', { name: '최악 프레임' }).click()
  await expect(dlg.locator('.rv-title')).toContainText('f150')

  await dlg.getByRole('button', { name: '문제 있음' }).click()
  await expect(dlg.locator('.rv-empty')).toHaveText('남은 항목이 없습니다')
  await expect(dlg).toContainText('미처리 0 / 전체 1')
  await dlg.getByText('처리한 것도 보기').click()
  await expect(items.first()).toContainText('문제 있음')

  await dlg.getByRole('button', { name: '타임라인에서 보기' }).click()
  await expect(dlg).toBeHidden()
  expect(await page.evaluate(() => (window as any).__editor.getState().frame)).toBe(150)
  expect(await page.evaluate(() => JSON.stringify((window as any).__editor.getState().project))).toBe(before) // read-only

  await page.getByRole('button', { name: '⚠ 검수 목록' }).click() // reopen: the verdict is kept, the 3D view comes back
  await expect(dlg.locator('.rv-view canvas')).toHaveCount(1)
  await expect(dlg).toContainText('미처리 0 / 전체 1')
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
  expect(await dlg.locator('.rv-view canvas').count()).toBe(0) // the window's own 3D view is freed on close
  expect(errors).toEqual([])
})
