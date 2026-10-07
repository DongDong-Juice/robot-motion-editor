import { test, expect } from '@playwright/test'

const row = Array.from({ length: 36 }, (_, i) => (i === 6 ? 1 : 0)).join(',')
const csv = Buffer.from([row, row, row].join('\n') + '\n')

test('CSV import: fps choice applies each time, bad file reported, one undo per batch', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible()
  const clips = () => page.evaluate(() => Object.values((window as any).__editor.getState().project.clips) as { name: string; length: number }[])
  const before = (await clips()).length
  const run = async (files: { name: string; mimeType: string; buffer: Buffer }[], fps: '30fps' | '60fps') => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'CSV 가져오기' }).click()])
    await fc.setFiles(files)
    await page.getByLabel(fps).check()
    await page.getByRole('button', { name: '가져오기', exact: true }).click()
  }
  await run([{ name: 'a.csv', mimeType: 'text/csv', buffer: csv }], '30fps')
  await run([{ name: 'b.csv', mimeType: 'text/csv', buffer: csv }, { name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('1,2,3\n') }], '60fps')
  await expect(page.locator('.pp-msg')).toContainText('bad.csv: 열 수가')
  const cs = await clips()
  expect(cs.find(c => c.name === 'a')!.length).toBe(5)
  expect(cs.find(c => c.name === 'b')!.length).toBe(3)
  expect(cs.length).toBe(before + 2)
  await run([{ name: 'a.csv', mimeType: 'text/csv', buffer: csv }], '30fps')
  expect((await clips()).some(c => c.name === 'a_2')).toBe(true)
  await page.evaluate(() => (window as any).__editor.getState().undo())
  expect((await clips()).length).toBe(before + 2)
})
