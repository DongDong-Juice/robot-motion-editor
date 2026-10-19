import { test, expect, type Page } from '@playwright/test'

// 배치 이동 토글 (spec 2026-10-20-go2-walk-to-design.md §2): with it on, dragging a GO2 appends a walk clip ending where it was dropped.
const boot = async (page: Page) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
}
const addActor = (page: Page, robot: string) => page.evaluate(robot => {
  const ed = (window as any).__editor
  ed.getState().addActor(robot)
  const a = ed.getState().project.actors.at(-1)
  ed.getState().select(a.id)
  return a.id as string
}, robot)
const items = (page: Page, id: string) => page.evaluate(id => {
  const p = (window as any).__editor.getState().project
  return p.sequence.tracks.find((t: any) => t.actorId === id).items
    .map((i: any) => ({ start: i.start, end: i.start + i.trimOut - i.trimIn, name: p.clips[i.refId].name }))
    .sort((a: any, b: any) => a.start - b.start) as { start: number; end: number; name: string }[]
}, id)
// the robot's root on screen
const body = async (page: Page, id: string) => {
  await expect.poll(() => page.evaluate(id => !!(window as any).__stage.entries().get(id), id)).toBe(true)
  const [nx, ny] = await page.evaluate(id => {
    const st = (window as any).__stage, p = st.entries().get(id).rig.root.position.clone().project(st.camera)
    return [p.x, p.y]
  }, id)
  const b = (await page.locator('#stage canvas').boundingBox())!
  return [b.x + (nx + 1) / 2 * b.width, b.y + (1 - ny) / 2 * b.height] as const
}
// the floor (z = 0) point under a screen position
const floorAt = async (page: Page, x: number, y: number) => {
  const b = (await page.locator('#stage canvas').boundingBox())!
  return page.evaluate(([nx, ny]) => {
    const cam = (window as any).__stage.camera, o = cam.position.clone(), d = cam.position.clone().set(nx, ny, 0.5).unproject(cam).sub(o)
    const t = -o.z / d.z
    return [o.x + t * d.x, o.y + t * d.y]
  }, [(x - b.x) / b.width * 2 - 1, 1 - (y - b.y) / b.height * 2])
}
const drag = async (page: Page, [x, y]: readonly [number, number], dx: number, dy: number, mid?: () => Promise<void>) => {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 6 })
  await mid?.()
  await page.mouse.up()
}
const toggle = (page: Page) => page.getByRole('button', { name: '배치 이동' })

test('배치 이동 on: dragging a GO2 appends a walk clip ending at the drop point; Ctrl+Z removes it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await boot(page)
  const id = await addActor(page, 'go2')
  const n0 = (await items(page, id)).length
  await page.getByRole('tab', { name: '라이브러리' }).click()
  const tree = page.getByRole('tree', { name: '라이브러리' }), real = tree.locator('[data-id="dir:리얼데이터"]')
  if (await real.getAttribute('aria-expanded') !== 'true') await real.click()
  await page.locator('.pp-row[data-kind=block]').filter({ has: page.locator('.pp-name', { hasText: /^Stretch$/ }) }).click()
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await expect.poll(async () => (await items(page, id)).length).toBe(n0 + 1)
  const before = await items(page, id), n = before.length, end = before.at(-1)!.end

  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
  await toggle(page).click()
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => (window as any).__editor.getState().frame)).toBe(end - 1)

  const at = await body(page, id), drop = [at[0] + 200, at[1]] as const
  const want = await floorAt(page, ...drop)
  await drag(page, at, 200, 0)
  await expect.poll(async () => (await items(page, id)).length, { timeout: 15000 }).toBe(n + 1)
  const walk = (await items(page, id))[n]
  expect(walk.name).toMatch(/^Walk_/)
  expect(walk.start).toBe(end)
  await expect.poll(() => page.evaluate(() => (window as any).__editor.getState().frame)).toBe(walk.end - 1)
  // the main view shows the evaluated pose at the playhead (preview = CSV)
  await expect.poll(() => page.evaluate(([id, x, y]) => {
    const p = (window as any).__stage.entries().get(id).rig.root.position
    return Math.hypot(p.x - x, p.y - y)
  }, [id, ...want] as const)).toBeLessThan(0.05)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await items(page, id)).length).toBe(n)

  // too close: nothing made, a notice
  await drag(page, await body(page, id), 20, 0)
  await expect(page.getByRole('status').filter({ hasText: '너무 가깝습니다' })).toBeVisible()
  expect((await items(page, id)).length).toBe(n)

  // Ctrl+Z mid-drag: released, nothing made
  await drag(page, await body(page, id), 200, 0, () => page.keyboard.press('Control+z'))
  await page.waitForTimeout(500)
  expect((await items(page, id)).length).toBe(n)
  expect(errors).toEqual([])
})

test('배치 이동 on: dragging a G1 still moves its placement', async ({ page }) => {
  await boot(page)
  const id = await addActor(page, 'g1')
  await toggle(page).click()
  const pl = () => page.evaluate(id => { const p = (window as any).__editor.getState().project.actors.find((a: any) => a.id === id).placement; return [p.x, p.y] }, id)
  const p0 = await pl()
  await drag(page, await body(page, id), 60, 0)
  const p1 = await pl()
  expect(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])).toBeGreaterThan(0.05)
})
