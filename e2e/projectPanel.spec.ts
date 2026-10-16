import { test, expect, type Page } from '@playwright/test'
import { importSynthetic } from './synth'

// 목록 패널 (spec 2026-10-16-project-panel-design.md §1–4): tabs, filter, bins, drag to the timeline, double-click = 클립 편집.
const st = (page: Page) => page.evaluate(() => {
  const s = (window as any).__editor.getState()
  return { bins: s.project.bins ?? [], clips: Object.values(s.project.clips).map((c: any) => ({ id: c.id, name: c.name, bin: c.bin })), clipEdit: s.clipEdit,
    items: s.project.sequence.tracks.reduce((n: number, t: any) => n + t.items.length, 0) }
}) as Promise<{ bins: { id: string; name: string }[]; clips: { id: string; name: string; bin?: string }[]; clipEdit: string | null; items: number }>

async function boot(page: Page) {
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker; delete (window as any).showDirectoryPicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await importSynthetic(page, 'alpha')
  await importSynthetic(page, 'beta_walk')
  await expect(page.locator('.pp-row[data-kind=clip]')).toHaveCount(2)
}

test('탭·필터', async ({ page }) => {
  await boot(page)
  await expect(page.getByRole('tab', { name: '모션(CSV)' })).toHaveAttribute('aria-selected', 'true')
  const filter = page.getByLabel('필터')
  await filter.fill('walk')
  await expect(page.locator('.pp-row[data-kind=clip]')).toHaveCount(1)
  await expect(page.locator('.pp-count')).toHaveText('1 항목')
  await page.getByRole('tab', { name: '영상' }).click()
  await expect(page.getByRole('tree', { name: '영상 목록' })).toBeVisible()
  await page.getByRole('tab', { name: '모션(CSV)' }).click()
  await expect(filter).toHaveValue('walk')
  await expect(page.locator('.pp-row[data-kind=clip]')).toHaveCount(1)
})

test('폴더', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: '새 폴더' }).click()
  const input = page.getByRole('textbox', { name: '이름 변경' })
  await expect(input).toHaveValue('폴더 1')
  await input.fill('Walk'); await input.press('Enter')
  expect((await st(page)).bins.map(b => b.name)).toEqual(['Walk'])
  const bin = page.locator('.pp-row[data-kind=bin]')
  await expect(bin.locator('.pp-name')).toHaveText('Walk')

  const { clips } = await st(page)
  await page.locator(`.pp-row[data-id="${clips[0].id}"]`).dragTo(bin)
  let s = await st(page)
  expect(s.clips[0].bin).toBe(s.bins[0].id)
  await page.evaluate(() => (window as any).__editor.getState().undo())
  expect((await st(page)).clips[0].bin).toBeUndefined()
  await page.evaluate(() => (window as any).__editor.getState().redo())
  expect((await st(page)).clips[0].bin).toBe(s.bins[0].id)

  // save → open keeps the folder and its member
  await page.evaluate(async () => {
    const { serializeProject, parseProject } = await import(/* @vite-ignore */ '/src/model/projectFile.ts')
    const ed = (window as any).__editor, s = ed.getState()
    s.loadProject(parseProject(serializeProject(s.project), s.defs), 'x.motion.json')
  })
  s = await st(page)
  expect(s.bins.map(b => b.name)).toEqual(['Walk'])
  expect(s.clips[0].bin).toBe(s.bins[0].id)
  await expect(bin.locator('.pp-name')).toHaveText('Walk')
  if (await bin.getAttribute('aria-expanded') !== 'true') await bin.locator('.pp-name').dblclick()
  await expect(page.locator(`.pp-row[data-id="${clips[0].id}"]`)).toHaveAttribute('aria-level', '2')

  await bin.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '삭제' }).click()
  await expect(bin).toHaveCount(0)
  await expect(page.locator(`.pp-row[data-id="${clips[0].id}"]`)).toHaveAttribute('aria-level', '1')
  expect((await st(page)).clips[0].bin).toBeUndefined()
})

test('끌기·편집', async ({ page }) => {
  await boot(page)
  const before = (await st(page)).items
  const row = page.locator('.pp-row[data-kind=clip]').nth(1)
  const seq = page.locator('.seq-canvas'), box = (await seq.boundingBox())!
  await row.dragTo(seq, { targetPosition: { x: 500, y: box.height - 20 } })
  expect((await st(page)).items).toBe(before + 1)

  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '폴더로 이동' }).click()
  await expect(page.getByRole('menu', { name: '폴더로 이동' }).getByRole('menuitem', { name: '(최상위)' })).toBeVisible()
  await page.keyboard.press('Escape') // back to the menu
  await expect(page.getByRole('menu', { name: '폴더로 이동' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: '목록' })).toHaveCount(0)

  const id = await row.getAttribute('data-id')
  await row.dblclick()
  expect((await st(page)).clipEdit).toBe(id)
})
