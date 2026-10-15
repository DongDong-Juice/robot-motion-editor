import { test, expect } from '@playwright/test'
import { importSynthetic } from './synth'

// 구간 수정: Shift+drag on the clip-view ruler picks a 구간; a value change inside it adds the same difference over the whole range,
// eased over 가감 frames each side, nothing outside; 구간 해제 clears it.
test('Shift+drag range → value change spreads over the range with fades', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await importSynthetic(page, 'jp')
  const ch = 'left_knee_joint'
  const clipId = await page.evaluate(() => { const s = (window as any).__editor.getState(); return s.project.sequence.tracks.find((t: any) => t.kind === 'motion').items[0].refId as string })
  await page.locator('.pp-card').first().dblclick({ position: { x: 150, y: 50 } })
  await expect(page.getByRole('group', { name: '클립 편집' })).toBeVisible()
  await page.evaluate(ch => { const w = window as any, s = w.__editor.getState(); s.setFrame(60); s.select('__clip_actor__', ch); w.__tv.ppf = 4; w.__tv.scrollF = 0 }, ch)
  await page.getByRole('button', { name: '그래프' }).click()
  await page.waitForTimeout(200)

  const box = (await page.locator('#timeline canvas').first().boundingBox())!
  const xOf = (f: number) => box.x + 160 + f * 4 + 1
  await page.keyboard.down('Shift')
  await page.mouse.move(xOf(40), box.y + 10); await page.mouse.down(); await page.mouse.move(xOf(80), box.y + 10, { steps: 6 }); await page.mouse.up()
  await page.keyboard.up('Shift')
  const r = await page.evaluate(() => (window as any).__editor.getState().range)
  expect(r).toEqual({ a: 40, b: 80, fade: 15 })
  const panel = page.getByRole('group', { name: '관절 패널' })
  await expect(panel.getByRole('group', { name: '구간' })).toBeVisible()
  await expect(panel.getByRole('spinbutton', { name: '구간 시작' })).toHaveValue('40')

  const val = (fs: number[]) => page.evaluate(async ({ fs, ch, clipId }) => {
    const s = (window as any).__editor.getState()
    const { baseClip } = await import(/* @vite-ignore */ '/src/model/itemClip.ts')
    const { evaluateClip } = await import(/* @vite-ignore */ '/src/model/pose.ts')
    const j = s.defs.g1.joints.findIndex((x: any) => x.name === ch), c = baseClip(s.project, s.defs, clipId)
    return fs.map(f => evaluateClip(c, s.defs.g1, f).q[j] as number)
  }, { fs, ch, clipId })
  const F = [10, 24, 32, 40, 60, 80, 88, 96, 120]
  await page.evaluate(() => (window as any).__editor.getState().setFrame(60))
  const before = await val(F)
  const num = panel.getByRole('spinbutton', { name: `${ch} 숫자` })
  await num.fill(String(((before[4] + 0.2) * 180 / Math.PI).toFixed(4))); await num.press('Enter')
  const after = await val(F), d = after.map((v, i) => v - before[i])
  for (const i of [3, 4, 5]) expect(d[i]).toBeCloseTo(0.2, 4) // inside: same difference
  for (const i of [2, 6]) { expect(d[i]).toBeGreaterThan(0.001); expect(d[i]).toBeLessThan(0.199) } // 가감: eased
  for (const i of [0, 1, 7, 8]) expect(Math.abs(d[i])).toBeLessThan(1e-6) // outside: untouched

  // playhead outside: the panel says so and the fields are disabled
  await page.evaluate(() => (window as any).__editor.getState().setFrame(150))
  await expect(panel.getByText('재생헤드를 구간 안으로 옮기세요')).toBeVisible()
  await expect(num).toBeDisabled()

  await panel.getByRole('button', { name: '구간 해제' }).click()
  expect(await page.evaluate(() => (window as any).__editor.getState().range)).toBeNull()
  await expect(num).toBeEnabled()
  expect(errors).toEqual([])
})
