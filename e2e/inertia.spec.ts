import { test, expect } from '@playwright/test'

// 관성 구간 리드인: a 덧붙이기 piece shows its lead-in settings (기본자세 · 전이 · 관성) in the clip preview; 관성 is auto-judged by
// default (reason chip), editable per piece, and the CSV grows by exactly 정지 + 전이 + 관성.
test('lead-in settings: auto 관성 reason, hand-set lengths change the CSV, 자동 restores', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const joints = await page.evaluate(() => (window as any).__editor.getState().defs.g1.joints.map((j: { name: string }) => j.name) as string[])
  const head = ['frequency(fps)', 'RobotType', 'DOF Number', 'time(ms)', 'position X(m)', 'position Y(m)', 'position Z(m)',
    'quaternion X', 'quaternion Y', 'quaternion Z', 'quaternion W', ...joints].join(',') + ','
  // still for 2 s, then swinging: a cut 0.25 s into the swing finds the still part behind it
  const csv = Buffer.from([head, ...Array.from({ length: 300 }, (_, i) =>
    [60, 0, 29, Math.round(i * 1000 / 60), '0.000000', '0.000000', '0.790000', '0', '0', '0', '1',
      ...joints.map((_, j) => (i < 120 ? 0 : 0.4 * Math.sin((i - 120) / 8 + j) - 0.4 * Math.sin(j)).toFixed(6))].join(',') + ',')].join('\n'))
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'CSV 가져오기', exact: true }).click()])
  await fc.setFiles([{ name: 'swing.csv', mimeType: 'text/csv', buffer: csv }])
  await expect.poll(() => page.evaluate(() => (window as any).__editor.getState().project.sequence.tracks.some((t: any) => t.items.length))).toBe(true)
  await page.evaluate(() => (window as any).__editor.getState().setFrame(135))
  await page.locator('.seq-canvas').focus(); await page.keyboard.press('c')
  await page.evaluate(() => { const s = (window as any).__editor.getState(); for (const t of s.project.sequence.tracks) for (const i of t.items) if (i.restPose) s.setRestPose(i.id, null) }) // start with 덧붙이기 off (a cut turns it on)
  await page.getByRole('button', { name: /클립 프리뷰$/ }).nth(1).dispatchEvent('click')
  const pane = page.getByRole('region', { name: '클립 프리뷰' })
  const row = pane.getByRole('group', { name: '리드인 설정' }), sw = row.getByRole('switch', { name: '기본자세 덧붙이기' })
  await expect(row).toBeVisible() // always shown; greyed until the switch is on
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await expect(row.getByRole('spinbutton', { name: '관성 (초)' })).toBeDisabled()
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await expect(row.getByRole('spinbutton', { name: '관성 (초)' })).toBeEnabled()
  await expect(pane.getByRole('status')).toContainText(/앞에 1\.\d\d초 추가/) // the lead-in after the switch, not before
  await expect(row).toContainText('조용한 지점')

  const state = () => page.evaluate(async () => {
    const { exportItemCsv, restLead, restTailRows } = await import(/* @vite-ignore */ '/src/export/csv.ts')
    const st = (window as any).__editor.getState(), tr = st.project.sequence.tracks.find((t: any) => t.kind === 'motion')
    const it = [...tr.items].sort((a: any, b: any) => a.start - b.start)[1]
    // rows up to the piece's end: the cut also adds its 끝 기본자세 after it (restTailRows), not counted here
    return { rows: exportItemCsv(st.project, st.defs, tr.actorId, it.id).text.split('\n').length - 1 - restTailRows(st.project, st.defs, it), len: it.trimOut - it.trimIn,
      lead: restLead(st.project, st.defs, it) as number, hold: it.restHold, blend: it.restBlend, inertia: it.inertia }
  })
  const auto = await state()
  expect(auto.inertia).toBeUndefined()
  expect(auto.lead).toBeGreaterThan(90 + 5); expect(auto.lead).toBeLessThanOrEqual(90 + 20) // 관성 ≈ 15 frames back to the still part
  expect(auto.rows).toBe(auto.len + auto.lead)

  const field = (n: string) => row.getByRole('spinbutton', { name: `${n} (초)` })
  await field('관성').fill('0.25'); await field('관성').press('Enter')
  await field('기본자세').fill('1'); await field('기본자세').press('Enter')
  await field('전이').fill('0.5'); await field('전이').press('Enter')
  await expect.poll(async () => { const s = await state(); return [s.hold, s.blend, s.inertia] }).toEqual([60, 30, 15])
  const set = await state()
  expect(set.lead).toBe(60 + 30 + 15)
  expect(set.rows).toBe(set.len + 105)
  await expect(row).not.toContainText('조용한 지점') // hand-set: no auto reason

  await row.getByRole('button', { name: '관성 자동' }).click()
  await row.getByRole('button', { name: '전이 자동' }).click()
  const back = await state()
  expect(back.inertia).toBeUndefined(); expect(back.blend).toBe('auto')
  await expect(row).toContainText('조용한 지점')
  await expect(row.getByRole('button', { name: '전이 자동' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Control+z') // one undo per change
  expect((await state()).blend).toBe(30)

  // ✕ (없애기) sets a part to 0 s; disabled once it is 0; 전이 0 warns
  for (const n of ['기본자세', '전이', '관성']) await row.getByRole('button', { name: `${n} 없애기` }).click()
  await expect.poll(async () => { const s = await state(); return [s.hold, s.blend, s.inertia, s.lead] }).toEqual([0, 0, 0, 0])
  expect((await state()).rows).toBe(auto.len)
  await expect(row.getByRole('button', { name: '관성 없애기' })).toBeDisabled()
  await expect(row).toContainText('순간 전환')

  // 기본자세 자동 = back to the default 0.5 s
  await expect(row.getByRole('button', { name: '기본자세 자동' })).toHaveAttribute('aria-pressed', 'false')
  await row.getByRole('button', { name: '기본자세 자동' }).click()
  await expect.poll(async () => (await state()).hold).toBeUndefined()
  await expect(field('기본자세')).toHaveValue('0.50')
  await expect(row.getByRole('button', { name: '기본자세 자동' })).toHaveAttribute('aria-pressed', 'true')
  expect((await state()).lead).toBe(30)

  // switch off: no lead-in, values kept for the next time it is turned on
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  expect((await state()).lead).toBe(0)
  await expect(row.getByRole('button', { name: '기본자세 자동' })).toBeDisabled()
  expect(errors).toEqual([])
})
