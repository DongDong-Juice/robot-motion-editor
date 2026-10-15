import fs from 'node:fs'
import { test, expect, type Download, type Page } from '@playwright/test'
import { unzip } from './unzip'

const menu = async (page: Page, name: string) => {
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}


test('load both robots, key, export CSV', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).showDirectoryPicker })
  const downloads: Download[] = []
  page.on('download', d => downloads.push(d))
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => {
    const s = (window as any).__editor.getState()
    s.addActor('g1'); s.addActor('go2') // the app starts empty
    const id = (window as any).__editor.getState().project.actors[0].id
    s.toggleAutoKey(); s.select(id, 'left_elbow_joint'); s.setFrame(30)
    s.setValue(id, 'left_elbow_joint', 1.0)
  })
  await menu(page, '내보내기')
  await page.getByLabel('물리 검증 건너뛰기').check() // keep CSV checks independent of physics load
  await page.getByRole('button', { name: /CSV 내보내기|무시하고 내보내기/ }).click()
  await expect.poll(() => downloads.length).toBe(1) // several files → one zip
  expect(downloads[0].suggestedFilename()).toBe('motion_export.zip')
  const texts = unzip(fs.readFileSync((await downloads[0].path())!)).map(f => f.text)
  const rows = (t: string) => t.trim().split('\n')
  // header + data rows, each with a trailing comma (empty last field)
  const widths = texts.map(t => [...new Set(rows(t).map(r => r.split(',').length))].join())
  expect(widths.sort()).toEqual(['24', '41'])
  const g1 = texts.find(t => rows(t)[0].split(',').length === 41)!
  expect(rows(g1)[0].startsWith('frequency(fps),RobotType,DOF Number,time(ms),position X(m),')).toBe(true)
  expect(rows(g1)).toHaveLength(121)
  expect(rows(g1)[31].split(',').slice(0, 4)).toEqual(['60', '0', '29', '500'])
  expect(Number(rows(g1)[31].split(',')[11 + 18])).toBeCloseTo(1.0, 5)
})
