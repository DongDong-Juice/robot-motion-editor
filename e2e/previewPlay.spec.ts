import { test, expect } from '@playwright/test'
import { importSynthetic } from './synth'

// The clip preview has its own playhead (user: the robot preview and the clip preview must not share it). A click on a cut piece
// opens its preview and plays it there, looping over the piece (lead-in, piece, 끝 기본자세); the main playhead does not move.
// A double-click opens the piece on the main view for editing (clip view) instead.
test('clicking a cut piece plays its clip preview on its own playhead; the main one stays', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await importSynthetic(page, 'pp')
  await page.evaluate(() => (window as any).__editor.getState().setFrame(150))
  const cv = page.locator('.seq-canvas')
  await cv.focus(); await page.keyboard.press('c')
  await page.evaluate(() => (window as any).__editor.getState().setFrame(40))
  const [lo, hi] = await page.evaluate(async () => {
    const { previewRange } = await import(/* @vite-ignore */ '/src/model/restPose.ts')
    const s = (window as any).__editor.getState(), t = s.project.sequence.tracks.find((t: any) => t.kind === 'motion')
    const b = [...t.items].sort((x: any, y: any) => x.start - y.start)[1]
    return previewRange(s.project, s.defs, b.id) as [number, number]
  })

  // lane label of piece #2 (rows: ruler 24 · track 28 · lane #1 · lane #2)
  const box = (await cv.boundingBox())!
  await page.mouse.click(box.x + 60, box.y + 24 + 28 * 2 + 14)
  const pane = page.getByRole('region', { name: '클립 프리뷰' })
  await expect(pane).toBeVisible()
  const st = () => page.evaluate(() => { const s = (window as any).__editor.getState(); return { playing: s.playing, frame: s.frame, pv: s.previewPlaying, pf: s.previewFrame } })
  expect(await st()).toMatchObject({ playing: false, frame: 40, pv: true })
  const seen: number[] = []
  for (let i = 0; i < 40; i++) { seen.push((await st()).pf); await page.waitForTimeout(250) } // longer than the range (lead-in on by default)
  expect(seen.every(f => f >= lo && f < hi)).toBe(true)
  expect(seen.some((f, i) => i > 0 && f < seen[i - 1])).toBe(true) // looped back to the start
  expect((await st()).frame).toBe(40) // the main playhead never moved

  // no play controls in the pane (it just loops); Space drives the main playhead only
  await expect(pane.getByRole('slider', { name: '클립 프리뷰 위치' })).toHaveCount(0)
  await cv.focus(); await page.keyboard.press(' ')
  await expect.poll(async () => (await st()).playing).toBe(true)
  await page.keyboard.press(' ')

  // double-click the piece: it opens on the main view for editing (clip view), the preview closes, its gizmo is free
  const bx = await page.evaluate(() => { const tv = (window as any).__tv; return 160 + (220 - tv.scrollF) * tv.ppf }) // frame 220, inside piece #2
  await page.mouse.dblclick(box.x + bx, box.y + 24 + 28 * 2 + 14)
  await expect.poll(() => page.evaluate(() => { const s = (window as any).__editor.getState(); return [!!s.editing, s.itemPreview] })).toEqual([true, null])
  await expect(page.getByRole('region', { name: '클립 프리뷰' })).toHaveCount(0)
  // the clip view shows just that piece (#2 = clip frames 150–300) with its lead-in / 끝 기본자세, and plays only them
  expect(await page.evaluate(async () => { const { playRange } = await import(/* @vite-ignore */ '/src/transport.ts'); const w = window as any
    return { scroll: w.__tv.scrollF, range: playRange(w.__editor.getState()) } })).toEqual({ scroll: 150 - (150 - lo), range: [lo, hi] }) // with its lead-in / 끝 기본자세
  expect(await page.evaluate(async () => { const { gizmoLock } = await import(/* @vite-ignore */ '/src/store/store.ts'); const s = (window as any).__editor.getState()
    s.select(s.project.actors[0].id, 'left_knee_joint'); return gizmoLock(s) })).toBeNull()
  expect(errors).toEqual([])
})
