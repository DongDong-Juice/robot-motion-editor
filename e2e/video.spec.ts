import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { test, expect, type Download, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const dir = path.resolve('test-results')
const file = path.join(dir, 'ref-test.mp4')

test.beforeAll(() => {
  fs.mkdirSync(dir, { recursive: true })
  try {
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-t', '2', '-pix_fmt', 'yuv420p', file], { stdio: 'ignore' })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') test.skip(true, 'ffmpeg 없음')
    else throw e
  }
})

const init = () => {
  const w = window as any
  delete w.showDirectoryPicker; delete w.showOpenFilePicker; delete w.showSaveFilePicker
}

const open = async (page: Page) => {
  await page.addInitScript(init)
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
}

const importVideo = async (page: Page) => {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '영상 가져오기' }).click()])
  await fc.setFiles(file)
  await expect(page.locator('.pp-media')).toHaveCount(1)
}

test('import video, place on V1, scrub syncs', async ({ page }) => {
  await open(page)
  await importVideo(page)
  await page.evaluate(() => {
    const e = (window as any).__editor, s = e.getState()
    s.addVideoItem(s.project.media[0].id, 60)
    e.getState().setFrame(90)
  })
  const video = page.locator('#stage video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => Math.abs(v.currentTime - 0.5) <= 1 / 60), { timeout: 5000 }).toBe(true)
  await page.evaluate(() => (window as any).__editor.getState().setFrame(30))
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => getComputedStyle(v).display)).toBe('none')
})

test('save/reopen marks media offline, relink restores', async ({ page }) => {
  const errors: string[] = []
  page.on('console', m => { if (m.type() === 'error' && !m.location().url.includes('favicon')) errors.push(m.text()) })
  page.on('dialog', d => d.accept())
  const downloads: Download[] = []
  page.on('download', d => downloads.push(d))
  await open(page)
  await importVideo(page)

  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect.poll(() => downloads.length).toBe(1)
  const saved = fs.readFileSync((await downloads[0].path())!)
  const name = downloads[0].suggestedFilename()

  await page.getByRole('button', { name: '새 프로젝트' }).click()
  await expect(page.locator('.pp-media')).toHaveCount(0)
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '열기' }).click()])
  await fc.setFiles([{ name, mimeType: 'application/json', buffer: saved }])
  await expect(page.getByText('오프라인').first()).toBeVisible()

  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /다시 연결/ }).click()])
  await fc2.setFiles(file)
  await expect(page.getByText('오프라인')).toHaveCount(0)
  expect(errors).toEqual([])
})
