import { test, expect } from '@playwright/test'
import { importSynthetic } from './synth'

// The piece open in the clip preview is edited there (no separate 수정본 pane): click a joint in the preview, turn its gizmo; the
// main view has no gizmo for that piece and shows the same edited pose.
test('clip preview: pick a joint and turn it there; the main view follows, without its own gizmo', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.setViewportSize({ width: 1600, height: 950 })
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await importSynthetic(page, 'ep')
  await page.evaluate(() => { const s = (window as any).__editor.getState(), t = s.project.sequence.tracks.find((t: any) => t.kind === 'motion')
    s.setFrame(100); s.openItemPreview(t.items[0].id); s.setPreviewFrame(100) })
  const pane = page.getByRole('region', { name: '클립 프리뷰' })
  await expect(pane.getByRole('button', { name: /^클립 프리뷰 ·/ })).toBeVisible()
  await expect(pane.getByRole('button', { name: '수정 비교' })).toHaveCount(0)
  await page.waitForTimeout(300)

  // click the left elbow in the clip preview
  const pt = await page.evaluate(() => {
    const hook = (window as any).__stages.preview, e = [...hook.entries().values()][0]
    const a = e.rig.jointPivots.left_elbow_joint, b = e.rig.jointPivots.left_wrist_roll_joint
    const V = a.position.constructor, p = new V(), q = new V()
    a.getWorldPosition(p); b.getWorldPosition(q); p.lerp(q, 0.5).project(hook.camera)
    const r = hook.renderer.domElement.getBoundingClientRect()
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }
  })
  await page.mouse.click(pt.x, pt.y)
  const sel = () => page.evaluate(() => { const s = (window as any).__editor.getState(); return [s.sel.actorId === s.project.actors[0].id, s.sel.channel] })
  await expect.poll(sel).toEqual([true, 'left_elbow_joint'])
  // the gizmo sits on that joint in the pane, not on the main view
  expect(await page.evaluate(() => { const w = window as any, e = [...w.__stages.preview.entries().values()][0] as any
    return [w.__stages.preview.tc.object === e.rig.jointPivots.left_elbow_joint, !!w.__stage.tc.object] })).toEqual([true, false])

  // turning it (as a gizmo drag does) keys the piece's 수정; the main view shows the same pose
  const angle = (k: string) => page.evaluate(k => { const w = window as any, e = k === 'main' ? w.__stage.entries().get(w.__editor.getState().project.actors[0].id) : [...w.__stages.preview.entries().values()][0]
    return e.rig.jointPivots.left_elbow_joint.quaternion.toArray().map((v: number) => +v.toFixed(4)) }, k)
  const before = await angle('main')
  await page.evaluate(() => { const tc = (window as any).__stages.preview.tc
    tc.dispatchEvent({ type: 'dragging-changed', value: true })
    tc.object.rotateOnAxis(new tc.object.position.constructor(0, 1, 0), 0.4)
    tc.dispatchEvent({ type: 'objectChange' })
    tc.dispatchEvent({ type: 'dragging-changed', value: false }) })
  await expect.poll(() => page.evaluate(() => { const it = (window as any).__editor.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion').items[0]
    return !!it.offset?.left_elbow_joint?.keys.length })).toBe(true)
  await page.waitForTimeout(200)
  await expect.poll(() => angle('main')).not.toEqual(before)
  expect(await angle('main')).toEqual(await angle('preview'))
  expect(errors).toEqual([])
})
