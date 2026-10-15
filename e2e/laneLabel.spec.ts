import { test, expect } from '@playwright/test'

// Piece lanes: the narrow label shows "#n · m:ss" (cut with … if still too long) and a short physics tag on the right ("⚠3" / "87%");
// hovering the label shows the full text.
test('lane label: short text + physics tag; full text on hover', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const ids = await page.evaluate(async () => {
    const { csvKey } = await import(/* @vite-ignore */ '/src/physics/runItem.ts')
    const ed = (window as any).__editor
    ed.getState().addActor('g1')
    const tr = () => ed.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion')
    const clip = Object.values(ed.getState().project.clips)[0] as any
    if (!tr().items.length) ed.getState().importClipToActor(clip)
    ed.getState().splitItem(tr().items[0].id, 60)
    const items = [...tr().items].sort((a: any, b: any) => a.start - b.start)
    const { usePhysics } = (window as any).__physics
    const metrics = (maxPct: number, n: number) => ({ meanPct: 20, maxPct, segments: Array.from({ length: n }, (_, i) => ({ from: i, to: i + 1, maxPct, maxTorque: 1 })), pct: new Float32Array(10) })
    const st = ed.getState(), key = (id: string) => csvKey(st.project, st.defs, tr().actorId, id).key
    usePhysics.setState({ byItem: { [items[0].id]: { key: key(items[0].id), status: 'done', metrics: metrics(116, 19) }, [items[1].id]: { key: key(items[1].id), status: 'done', metrics: metrics(35, 0) } } })
    return items.map((i: any) => i.id)
  })
  expect(ids.length).toBe(2)
  await page.waitForTimeout(300)
  const canvas = page.locator('.seq-canvas'), box = (await canvas.boundingBox())!
  await page.screenshot({ path: test.info().outputPath('lanes.png'), clip: { x: box.x, y: box.y, width: 420, height: 140 } })
  // hover the first lane's label (rows: ruler, track, lane 1, lane 2)
  const laneY = await page.evaluate(() => { const c = document.querySelector('.seq-canvas')!; return c.getBoundingClientRect().top })
  let tip = ''
  for (let y = 20; y < 140 && !tip.includes('물리 검증'); y += 6) {
    await page.mouse.move(box.x + 50, laneY + y)
    tip = await canvas.evaluate(c => (c as HTMLCanvasElement).title)
  }
  expect(tip).toMatch(/#1 · .*–.*\n물리 검증: 최대 116% ⚠19/)
  expect(errors).toEqual([])
})
