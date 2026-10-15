import { test, expect } from '@playwright/test'

test('physics assist: run → stale on edit/settings → export re-runs and warns', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker; delete (window as any).showSaveFilePicker })
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
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'CSV 가져오기', exact: true }).click()])
  await fc.setFiles([{ name: 'a.csv', mimeType: 'text/csv', buffer: csv }])
  await expect.poll(() => page.evaluate(() => (window as any).__editor.getState().project.sequence.tracks.some((t: any) => t.items.length))).toBe(true)

  // badge is canvas-drawn: observe the physics store + stale() via the dev hook
  const phys = () => page.evaluate(() => {
    const ed = (window as any).__editor.getState(), P = (window as any).__physics
    const t = ed.project.sequence.tracks.find((t: any) => t.items.length), it = t.items[0]
    return { status: P.usePhysics.getState().byItem[it.id]?.status as string | undefined, stale: P.stale(ed.project, ed.defs, t.actorId, it.id) as boolean }
  })

  const box = (await page.locator('.seq-canvas').boundingBox())!
  await page.mouse.click(box.x + 300, box.y + 24 + 14, { button: 'right' })
  await page.getByRole('menuitem', { name: '물리 검증', exact: true }).click()
  await expect.poll(async () => (await phys()).status, { timeout: 60_000 }).toBe('done')
  expect((await phys()).stale).toBe(false)

  // edit one key -> 오래됨
  await page.evaluate(() => {
    const ed = (window as any).__editor.getState(), t = ed.project.sequence.tracks.find((t: any) => t.items.length)
    ed.setKey(t.items[0].refId, 'root.z', 30, 0.9)
  })
  await expect.poll(async () => (await phys()).stale).toBe(true)

  const setWarn = async (v: string) => {
    await page.getByRole('button', { name: '메뉴', exact: true }).click()
    await page.getByRole('menuitem', { name: '물리 설정…', exact: true }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByRole('spinbutton', { name: '경고 기준' }).fill(v)
    await dlg.getByRole('button', { name: '적용', exact: true }).click()
    await expect(dlg).toHaveCount(0)
  }
  await setWarn('10') // 물리 설정 경고 기준 10%

  // export dialog re-runs the check and lists 물리 보조력 warnings
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  await page.getByRole('menuitem', { name: /내보내기/ }).first().click()
  const exp = page.getByRole('dialog', { name: '내보내기' })
  await expect(exp.getByRole('list', { name: '경고' })).toContainText('물리 보조력', { timeout: 90_000 })
  expect((await phys()).stale).toBe(false)
  await exp.getByRole('button', { name: '닫기' }).click()
  await expect(exp).toHaveCount(0)

  // settings alone (no edit) make a fresh result stale
  await setWarn('11')
  expect((await phys()).stale).toBe(true)
  expect(errors).toEqual([])
})
