import { test, expect } from '@playwright/test'
import { importSynthetic } from './synth'

// 원본 겹쳐 보기: on a cut piece with a 수정 층 under the playhead, the main robot preview draws the edit (what plays and exports)
// with the piece's original as a ghost (user: see the joint edit against G1 #1). Default on; the header button toggles it.
test('original ghost over an edited piece on the main view; toggles; none on an unedited piece', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await importSynthetic(page, 'og')
  await page.evaluate(() => (window as any).__editor.getState().setFrame(150))
  await page.locator('.seq-canvas').focus(); await page.keyboard.press('c')
  const ghosts = () => page.evaluate(() => (window as any).__stage.overlays().size as number)
  const btn = page.getByRole('button', { name: '원본 겹쳐 보기' })
  await expect(btn).toHaveCount(0) // no 수정 yet
  expect(await ghosts()).toBe(0)

  // edit the knee of piece #2 (sequence view: the piece's 수정 층) at frame 220
  const knee = await page.evaluate(() => {
    const s = (window as any).__editor.getState(), a = s.project.actors[0].id
    s.setFrame(220); s.setValue(a, 'left_knee_joint', 1.2)
    const q = (r: any) => { const o = r.jointPivots.left_knee_joint.quaternion; return [o.x, o.y, o.z, o.w] }
    const st = (window as any).__stage
    return { main: q(st.entries().get(a).rig), ghost: st.overlays().size ? q(st.overlay()) : null }
  })
  expect(knee.ghost).not.toBeNull()
  expect(knee.ghost).not.toEqual(knee.main) // the ghost is the original, the solid robot the edit
  await expect(btn).toHaveAttribute('aria-pressed', 'true')

  await btn.click(); expect(await ghosts()).toBe(0)
  await btn.click(); expect(await ghosts()).toBe(1)
  await page.evaluate(() => (window as any).__editor.getState().setFrame(60)) // piece #1: no 수정 → no ghost
  expect(await ghosts()).toBe(0)
  expect(errors).toEqual([])
})
