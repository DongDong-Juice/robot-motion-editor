import { test, expect } from '@playwright/test'

// 3D 끌기 (spec 2026-10-19-pose-panel-design.md §3): drag a robot on the main view to move its 무대 X·Y at the frame;
// a click (no move) still selects the joint, empty-space drags stay the camera's.
test('drag the robot: body x/y moves, camera stays, Ctrl+Z restores; a click selects a joint', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/')
  const canvas = page.locator('#stage canvas')
  await expect(canvas).toBeVisible({ timeout: 30000 })
  const id = await page.evaluate(() => {
    const ed = (window as any).__editor
    ed.getState().addActor('g1')
    return ed.getState().project.actors.at(-1).id as string
  })
  const pelvis = async () => {
    await expect.poll(() => page.evaluate(id => !!(window as any).__stage.entries().get(id), id)).toBe(true)
    const [nx, ny] = await page.evaluate(id => {
      const st = (window as any).__stage, p = st.entries().get(id).rig.root.position.clone().project(st.camera)
      return [p.x, p.y]
    }, id)
    const b = (await canvas.boundingBox())!
    return [b.x + (nx + 1) / 2 * b.width, b.y + (1 - ny) / 2 * b.height] as const
  }
  const body = () => page.evaluate(id => { const b = (window as any).__editor.getState().poseAt(id).body; return [b.x, b.y] as number[] }, id)
  const cam = () => page.evaluate(() => (window as any).__stage.camTarget() as number[])

  const b0 = await body(), c0 = await cam()
  const [x, y] = await pelvis()
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 60, y, { steps: 5 })
  await page.mouse.up()
  const b1 = await body()
  expect(Math.max(Math.abs(b1[0] - b0[0]), Math.abs(b1[1] - b0[1]))).toBeGreaterThan(0.05)
  expect(await cam()).toEqual(c0)

  await page.keyboard.press('Control+z')
  await expect.poll(body).toEqual(b0)

  // click only: selects the link's joint, body unchanged
  await page.evaluate(() => (window as any).__editor.getState().select(null))
  const [x2, y2] = await pelvis()
  await page.mouse.click(x2, y2)
  const sel = await page.evaluate(() => (window as any).__editor.getState().sel)
  expect(sel.actorId).toBe(id)
  expect(sel.channel).toBeTruthy()
  expect(await body()).toEqual(b0)
  expect(errors).toEqual([])
})
