import { test, expect } from '@playwright/test'

// CSV files dragged from the desktop onto the 목록 panel import like 메뉴 ▸ CSV 가져오기; other files are listed as skipped.
test('drop CSV files on the 목록 panel to import them', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const joints = await page.evaluate(() => (window as any).__editor.getState().defs.g1.joints.map((j: { name: string }) => j.name) as string[])
  const head = ['frequency(fps)', 'RobotType', 'DOF Number', 'time(ms)', 'position X(m)', 'position Y(m)', 'position Z(m)',
    'quaternion X', 'quaternion Y', 'quaternion Z', 'quaternion W', ...joints].join(',') + ','
  const csv = [head, ...Array.from({ length: 90 }, (_, i) =>
    [60, 0, 29, Math.round(i * 1000 / 60), (0.01 * i).toFixed(6), '0.000000', '0.790000', '0', '0', '0', '1',
      ...joints.map((_, j) => (0.1 * Math.sin(i / 9 + j)).toFixed(6))].join(',') + ',')].join('\n')
  const panel = page.locator('.pp')
  await expect(panel).toContainText('끌어다 놓으세요') // empty-state hint

  const drop = (files: { name: string; text: string }[], only?: 'over') => page.evaluate(([files, only]) => {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(new File([f.text], f.name, { type: 'text/csv' }))
    const el = document.querySelector('.pp')!
    el.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }))
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
    if (!only) el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, [files, only] as const)

  await drop([{ name: 'a.csv', text: csv }], 'over')
  await expect(page.locator('.pp-drop')).toHaveText('CSV를 놓으면 가져옵니다') // highlighted while a file is over it
  await drop([{ name: 'walk.csv', text: csv }, { name: 'note.txt', text: 'x' }])
  await expect(page.locator('.pp-drop')).toHaveCount(0)
  await expect(panel).toContainText('클립 1개를 가져왔습니다')
  await expect(panel).toContainText('note.txt: CSV 파일만 끌어다 놓을 수 있습니다')
  await expect(panel.locator('.pp-row[data-kind=clip] .pp-name')).toHaveText(['walk'])
  expect(await page.evaluate(() => (window as any).__editor.getState().project.sequence.tracks.some((t: any) => t.items.length))).toBe(true)

  await drop([{ name: 'x.txt', text: 'x' }]) // nothing importable: only the skip line
  await expect(panel).toContainText('x.txt: CSV 파일만 끌어다 놓을 수 있습니다')
  expect(await page.evaluate(() => Object.keys((window as any).__editor.getState().project.clips).length)).toBe(1)
  expect(errors).toEqual([])
})
