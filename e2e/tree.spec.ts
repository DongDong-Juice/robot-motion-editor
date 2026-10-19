import { test, expect } from '@playwright/test'

const items = (page: import('@playwright/test').Page) => page.evaluate(() =>
  ((window as any).__editor.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion')?.items.length ?? 0) as number) // 0 until the import lands

test('tree: a cut opens the piece rows, click a child row → clip preview; 덧붙이기 only flags the item', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker; delete (window as any).showDirectoryPicker })
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
  await expect.poll(() => items(page)).toBe(1)

  const seq = page.locator('.seq-canvas')
  await page.evaluate(() => (window as any).__editor.getState().setFrame(40))
  await seq.focus(); await page.keyboard.press('c')
  await page.evaluate(() => { const s = (window as any).__editor.getState(); for (const t of s.project.sequence.tracks) for (const i of t.items) if (i.restPose) s.setRestPose(i.id, null) }) // start with 덧붙이기 off (a cut turns it on)
  expect(await items(page)).toBe(2)

  const box = (await seq.boundingBox())!
  // the cut opens the staircase of piece rows by itself; ▸ folds and unfolds it
  const list = page.getByRole('button', { name: /클립 목록$/ })
  await expect(list).toHaveAttribute('aria-expanded', 'true')
  await page.mouse.click(box.x + 8, box.y + 24 + 14) // ▸ of the G1 row
  await expect(list).toHaveAttribute('aria-expanded', 'false')
  await page.mouse.click(box.x + 8, box.y + 24 + 14)
  await expect(list).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: /클립 프리뷰$/ })).toHaveCount(2)
  await page.mouse.click(box.x + 60, box.y + 24 + 28 + 22 + 11) // second child row
  const pane = page.getByRole('region', { name: '클립 프리뷰' })
  await expect(pane).toContainText('클립 프리뷰 · G1 #1 / Untitled-G1-2') // cut pieces: <project>-<robot>-<order>
  await expect.poll(() => pane.locator('canvas').evaluate(c => c.getBoundingClientRect().width), { timeout: 15000 }).toBeGreaterThan(0)

  const snap = () => page.evaluate(async () => {
    const { evaluate } = await import(/* @vite-ignore */ '/src/model/evaluate.ts'), { restLead } = await import(/* @vite-ignore */ '/src/export/csv.ts')
    const ed = (window as any).__editor, st = ed.getState(), p = st.project
    const tr = p.sequence.tracks.find((t: any) => t.kind === 'motion'), it = tr.items[1]
    return { clips: Object.keys(p.clips).length, flag: it.restPose ?? null, pose: JSON.stringify(evaluate(p, st.defs, tr.actorId, it.start)), lead: restLead(p, st.defs, it) as number }
  })
  const before = await snap()
  expect(before.flag).toBeNull() // a cut sets no 기본자세
  const rows = () => page.evaluate(async () => {
    const { exportItemCsv } = await import(/* @vite-ignore */ '/src/export/csv.ts')
    const st = (window as any).__editor.getState(), tr = st.project.sequence.tracks.find((t: any) => t.kind === 'motion')
    return exportItemCsv(st.project, st.defs, tr.actorId, tr.items[1].id).text.split('\n').length
  })
  const plainRows = await rows()
  const sw = pane.getByRole('switch', { name: '기본자세 덧붙이기' }) // the switch in the lead-in box (덮어쓰기 was removed)
  await expect(pane.getByRole('button', { name: '기본자세 덮어쓰기' })).toHaveCount(0)
  for (const [button, flag, extra] of [['기본자세 덧붙이기', 'prepend', 90]] as const) {
    await sw.click(); await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(pane.getByRole('status')).toContainText(`${button}를 켰습니다`)
    const after = await snap()
    expect(after.clips).toBe(before.clips) // no clip added or baked
    expect(after.flag).toBe(flag)
    expect(after.pose).toBe(before.pose) // sequence evaluation at the item start is unchanged
    expect(after.lead).toBeGreaterThanOrEqual(extra)
    expect(await rows()).toBe(plainRows + after.lead) // 덧붙이기 adds its lead-in (정지 + 전이 + 관성, ≥ 1.5 s) to that piece's CSV
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    expect((await snap()).flag).toBeNull()
  }
  await pane.getByRole('button', { name: '클립 프리뷰 닫기' }).click()
  await expect(pane).toHaveCount(0)
  expect(errors).toEqual([])
})
