import { test, expect } from '@playwright/test'

// 기본자세 덧붙이기: the clip preview plays the lead-in (정지 + 전이 + 관성) where the lane draws it (before the piece), so at any playhead it
// shows the same pose as the piece's exported CSV re-imported and placed at the start of that 기본자세 section.
test('덧붙이기 preview lines up with its exported CSV placed at the 기본자세 section', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const joints = await page.evaluate(() => (window as any).__editor.getState().defs.g1.joints.map((j: { name: string }) => j.name) as string[])
  const head = ['frequency(fps)', 'RobotType', 'DOF Number', 'time(ms)', 'position X(m)', 'position Y(m)', 'position Z(m)',
    'quaternion X', 'quaternion Y', 'quaternion Z', 'quaternion W', ...joints].join(',') + ','
  const csv = Buffer.from([head, ...Array.from({ length: 300 }, (_, i) =>
    [60, 0, 29, Math.round(i * 1000 / 60), (0.01 * i).toFixed(6), '0.000000', '0.790000', '0', '0', '0', '1',
      ...joints.map((_, j) => (0.3 * Math.sin(i / 15 + j)).toFixed(6))].join(',') + ',')].join('\n'))
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'CSV 가져오기', exact: true }).click()])
  await fc.setFiles([{ name: 'test.csv', mimeType: 'text/csv', buffer: csv }])
  await expect.poll(() => page.evaluate(() => (window as any).__editor.getState().project.sequence.tracks.some((t: any) => t.items.length))).toBe(true)
  await page.evaluate(() => (window as any).__editor.getState().setFrame(150))
  await page.locator('.seq-canvas').focus(); await page.keyboard.press('c')
  await page.evaluate(() => { const s = (window as any).__editor.getState(); for (const t of s.project.sequence.tracks) for (const i of t.items) if (i.restPose) s.setRestPose(i.id, null) }) // start with 덧붙이기 off (a cut turns it on)
  await page.getByRole('button', { name: /클립 프리뷰$/ }).nth(1).dispatchEvent('click')
  const pane = page.getByRole('region', { name: '클립 프리뷰' })
  await pane.getByRole('switch', { name: '기본자세 덧붙이기' }).click()

  // export that piece and place the CSV's clip on a new actor at the start of the 기본자세 section (piece start − lead-in)
  await page.evaluate(async () => {
    const { exportItemCsv, restLead, restTailRows } = await import(/* @vite-ignore */ '/src/export/csv.ts')
    const st = (window as any).__editor.getState(), tr = st.project.sequence.tracks.find((t: any) => t.kind === 'motion')
    const it = [...tr.items].sort((a: any, b: any) => a.start - b.start)[1]
    ;(window as any).__piece = it
    ;(window as any).__lead = restLead(st.project, st.defs, it)
    ;(window as any).__tail = restTailRows(st.project, st.defs, it) // the cut's 끝 기본자세 after the piece
    ;(window as any).__text = exportItemCsv(st.project, st.defs, tr.actorId, it.id, 'world').text
  })
  const text = await page.evaluate(() => (window as any).__text as string)
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'CSV 가져오기', exact: true }).click()])
  await fc2.setFiles([{ name: 'test_2.csv', mimeType: 'text/csv', buffer: Buffer.from(text) }])
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).__editor.getState().project.clips).length)).toBe(2)
  await page.evaluate(() => { // a G1 import lands on the G1 track; put the clip on its own actor at the 기본자세 section instead
    const s = (window as any).__editor.getState(), c = Object.values(s.project.clips).find((c: any) => c.length === 150 + (window as any).__lead + (window as any).__tail) as any
    expect_(!!c); s.placeClipAsNewActor(c.id, (window as any).__piece.start - (window as any).__lead)
    function expect_(ok: boolean) { if (!ok) throw new Error('exported clip not 150 + lead-in + 끝 기본자세 frames') }
  })
  await expect.poll(() => page.evaluate(() => (window as any).__editor.getState().project.actors.length)).toBe(2)

  // compare joint pivots: clip preview robot vs the re-imported robot on the main stage
  const diff = (f: number) => page.evaluate(async f => {
    const ed = (window as any).__editor
    ed.getState().setFrame(f); ed.getState().setPreviewPlaying(false); ed.getState().setPreviewFrame(f) // the preview has its own playhead
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const w = window as any, s = ed.getState(), a = s.project.actors[1]
    const prev = [...w.__stages.preview.entries().values()][0].rig, main = w.__stage.entries().get(a.id).rig
    let m = 0
    for (const n of Object.keys(prev.jointPivots)) m = Math.max(m, prev.jointPivots[n].quaternion.angleTo(main.jointPivots[n].quaternion))
    return m
  }, f)
  const start = await page.evaluate(() => (window as any).__piece.start as number), L = await page.evaluate(() => (window as any).__lead as number)
  expect(L).toBeGreaterThanOrEqual(90) // 정지 30 + 전이 60 + auto 관성
  for (const f of [start - L, start - L + 20, start - L + 45, start - L + 89, start - 20, start - 1, start, start + 30, start + 100]) {
    expect(await diff(f), `frame ${f}`).toBeLessThan(1e-3)
  }
  expect(errors).toEqual([])
})
