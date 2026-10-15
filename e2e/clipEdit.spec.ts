import fs from 'node:fs'
import { test, expect, type Download } from '@playwright/test'
import { importSynthetic } from './synth'

// 클립 편집 모드 (spec 2026-10-15-clip-edit-mode-design.md): double-click a 목록 card, edit a joint in the joint panel, CSV 저장 =
// the pose on the main view; the clip's original curves stay; the sequence piece plays the change; 시퀀스로 restores the playhead.
test('클립 편집: joint panel edit → 수정 층, CSV 저장 = main pose, original kept, sequence piece follows', async ({ page }) => {
  const errors: string[] = [], downloads: Download[] = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('download', d => downloads.push(d))
  const dialogs: string[] = []
  page.on('dialog', d => { dialogs.push(d.message()); void d.accept() }) // 경고 confirm, if any
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker; delete (window as any).showSaveFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const joints = await importSynthetic(page, 'ce')
  const ch = 'left_knee_joint', j = joints.indexOf(ch)
  const before = await page.evaluate(() => { const s = (window as any).__editor.getState(); s.setFrame(40); return JSON.stringify(Object.values(s.project.clips)[0]) })

  await page.locator('.pp-card', { hasText: 'ce' }).dblclick({ position: { x: 150, y: 50 } })
  const bar = page.getByRole('group', { name: '클립 편집' })
  await expect(bar).toBeVisible()
  await page.evaluate(ch => { const s = (window as any).__editor.getState(); s.setFrame(100); s.select('__clip_actor__', ch) }, ch)
  const num = page.getByRole('group', { name: '관절 패널' }).getByRole('spinbutton', { name: `${ch} 숫자` })
  await num.fill('80'); await num.press('Enter')
  const rad = 80 * Math.PI / 180

  // into the clip's 수정 층; the original curves untouched; the ● marker on the card
  const st = await page.evaluate(async ({ ch, before }) => {
    const s = (window as any).__editor.getState(), clip: any = Object.values(s.project.clips)[0]
    const { baseClip, editedClip } = await import(/* @vite-ignore */ '/src/model/itemClip.ts')
    const { evaluateClip } = await import(/* @vite-ignore */ '/src/model/pose.ts')
    const j = s.defs.g1.joints.findIndex((x: any) => x.name === ch)
    const b = JSON.parse(before), item = s.project.sequence.tracks.find((t: any) => t.kind === 'motion').items[0]
    return {
      sameOrig: JSON.stringify(clip.channels[ch]) === JSON.stringify(b.channels[ch]),
      offsetKeys: clip.offset?.[ch]?.keys.length ?? 0,
      base: evaluateClip(baseClip(s.project, s.defs, clip.id), s.defs.g1, 100).q[j],
      piece: evaluateClip(editedClip(s.project, s.defs, item), s.defs.g1, 100).q[j],
    }
  }, { ch, before })
  expect(st.sameOrig).toBe(true)
  expect(st.offsetKeys).toBeGreaterThan(0)
  expect(st.base).toBeCloseTo(rad, 3)
  expect(st.piece).toBeCloseTo(rad, 3) // every piece of the clip plays the change
  await expect(page.locator('.pp-card .pp-mod')).toBeVisible()

  // CSV 저장: the row at frame 100 has the edited value
  await bar.getByRole('button', { name: 'CSV 저장' }).click()
  await expect.poll(() => downloads.length).toBe(1)
  expect(downloads[0].suggestedFilename()).toBe('G1_ce.csv')
  const rows = fs.readFileSync((await downloads[0].path())!, 'utf8').split('\n')
  expect(rows).toHaveLength(301)
  expect(+rows[101].split(',')[11 + j]).toBeCloseTo(rad, 5)
  await expect(bar.getByRole('status')).toHaveText('CSV를 저장했습니다')

  // 시퀀스로: back to the sequence at the frame it left
  await bar.getByRole('button', { name: '시퀀스로' }).click()
  expect(await page.evaluate(() => { const s = (window as any).__editor.getState(); return [s.clipEdit, s.frame] })).toEqual([null, 40])
  expect(errors).toEqual([])
})
