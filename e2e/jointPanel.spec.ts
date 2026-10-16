import { test, expect } from '@playwright/test'
import { importSynthetic } from './synth'

// 관절 패널: clicking a joint on the main 3D view opens the panel with that joint's part (부위) as rows; clicking a row switches the
// selected joint; ↑/↓ walk the rows; 1F steps the frame; 보간 sets the key. It sits in the right sidebar (인스펙터).
test('3D joint click → part rows → switch rows', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await importSynthetic(page, 'jp')
  await page.evaluate(() => { const s = (window as any).__editor.getState(); if (!s.autoKey) s.toggleAutoKey() })
  await page.waitForTimeout(300)

  // screen point of the left shin (between the knee and ankle pivots) on the main pane
  const pt = await page.evaluate(() => {
    const w = window as any, st = w.__editor.getState(), hook = w.__stage
    const rig = hook.entries().get(st.project.actors[0].id).rig
    const a = rig.jointPivots.left_knee_joint, b = rig.jointPivots.left_ankle_pitch_joint
    const V = a.position.constructor, p = new V(), q = new V()
    a.getWorldPosition(p); b.getWorldPosition(q)
    p.lerp(q, 0.5).project(hook.camera)
    const r = hook.renderer.domElement.getBoundingClientRect()
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }
  })
  await page.mouse.click(pt.x, pt.y)
  const panel = page.getByRole('group', { name: '관절 패널' })
  await expect(panel).toBeVisible()
  const sel = () => page.evaluate(() => (window as any).__editor.getState().sel.channel as string)
  expect(await sel()).toBe('left_knee_joint')
  await expect(panel.locator('.jp-head')).toContainText('값 · 왼다리')
  await expect(panel.getByRole('slider')).toHaveCount(6) // hip pitch/roll/yaw, knee, ankle pitch/roll
  await expect(panel.locator('.jp-row.sel')).toContainText('left_knee')

  // click another row → that joint is selected (inspector follows)
  await panel.locator('.jp-row', { hasText: 'left_hip_roll' }).locator('.jp-name').click()
  expect(await sel()).toBe('left_hip_roll_joint')
  await expect(panel.locator('.jp-row.sel')).toContainText('left_hip_roll')

  // ↑/↓ walk the rows; ←/→ step the value
  await panel.focus(); await page.keyboard.press('ArrowDown')
  expect(await sel()).toBe('left_hip_yaw_joint')
  const v0 = await panel.getByRole('slider', { name: 'left_hip_yaw_joint 슬라이더' }).inputValue()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => +(await panel.getByRole('slider', { name: 'left_hip_yaw_joint 슬라이더' }).inputValue()) - +v0).toBeCloseTo(0.5 * Math.PI / 180, 3) // the slider shows steps of 0.001

  // ◀ 1F / 1F ▶ step the playhead one frame
  const fr = () => page.evaluate(() => (window as any).__editor.getState().frame as number)
  const f0 = await fr()
  await panel.getByRole('button', { name: '다음 프레임' }).click(); expect(await fr()).toBe(f0 + 1)
  await panel.getByRole('button', { name: '이전 프레임' }).click(); expect(await fr()).toBe(f0)

  // 보간 of the key under the playhead (이 조각 수정: the ←/→ step above keyed the piece's 수정 층 here)
  const interp = panel.getByRole('combobox', { name: '보간' })
  await expect(interp).toBeEnabled()
  await interp.selectOption('hold')
  expect(await page.evaluate(() => { const s = (window as any).__editor.getState(), it = s.project.sequence.tracks.find((t: any) => t.kind === 'motion').items[0]
    return it.offset.left_hip_yaw_joint.keys.find((k: any) => k.f === s.frame - it.start + it.trimIn).interp })).toBe('hold')

  // it lives in the right sidebar, never over the 3D view; a click on empty floor clears the selection and hides it
  await expect(page.locator('.insp .jp')).toHaveCount(1)
  // ...even mid slider drag: the drag still ends (no gesture left open to merge later edits into one undo step)
  const box = (await panel.getByRole('slider', { name: 'left_hip_yaw_joint 슬라이더' }).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  expect(await page.evaluate(() => (window as any).__editor.getState().inGesture)).toBe(true)
  await page.evaluate(() => (window as any).__editor.getState().select(null))
  await expect(panel).toHaveCount(0)
  await page.mouse.up()
  expect(await page.evaluate(() => (window as any).__editor.getState().inGesture)).toBe(false)
  expect(errors).toEqual([])
})
