import { test, expect, type Page } from '@playwright/test'

// Lane blocks of a cut piece: dragging the outer edge of 전이 (lead-in, leftwards) and of 끝 기본자세 (rightwards) sets that length,
// one undo step each (user: 드래그로 전이, 관성, 기본자세 조절, 끝 부분도).
const items = (page: Page) => page.evaluate(() => {
  const tr = (window as any).__editor.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion')
  return [...tr.items].sort((a: any, b: any) => a.start - b.start)
})

test('drag a lead-in 전이 edge and a 끝 기본자세 edge in the lanes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker })
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  const joints = await page.evaluate(() => (window as any).__editor.getState().defs.g1.joints.map((j: { name: string }) => j.name) as string[])
  const head = ['frequency(fps)', 'RobotType', 'DOF Number', 'time(ms)', 'position X(m)', 'position Y(m)', 'position Z(m)',
    'quaternion X', 'quaternion Y', 'quaternion Z', 'quaternion W', ...joints].join(',') + ','
  const csv = Buffer.from([head, ...Array.from({ length: 300 }, (_, i) =>
    [60, 0, 29, Math.round(i * 1000 / 60), '0.000000', '0.000000', '0.790000', '0', '0', '0', '1',
      ...joints.map((_, j) => (i < 120 ? 0 : 0.4 * Math.sin((i - 120) / 8 + j) - 0.4 * Math.sin(j)).toFixed(6))].join(',') + ',')].join('\n'))
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'CSV 가져오기', exact: true }).click()])
  await fc.setFiles([{ name: 'swing.csv', mimeType: 'text/csv', buffer: csv }])
  await expect.poll(async () => (await items(page)).length).toBe(1)
  await page.evaluate(() => (window as any).__editor.getState().setFrame(135))
  await page.locator('.seq-canvas').focus(); await page.keyboard.press('c') // 2 pieces: lanes, 덧붙이기 + 끝 기본자세 on
  await expect.poll(async () => (await items(page)).length).toBe(2)
  await page.evaluate(() => { const tv = (window as any).__tv; tv.ppf = 2; tv.scrollF = 0; (window as any).__editor.getState().setFrame(0) })

  const canvas = page.locator('.seq-canvas'), box = (await canvas.boundingBox())!
  const geo = () => page.evaluate(async () => {
    const { itemLead, itemTail } = await import(/* @vite-ignore */ '/src/model/restPose.ts')
    const st = (window as any).__editor.getState(), tr = st.project.sequence.tracks.find((t: any) => t.kind === 'motion')
    const [a, b] = [...tr.items].sort((x: any, y: any) => x.start - y.start)
    return { a, b, tail: itemTail(st.project, st.defs, a), lead: itemLead(st.project, st.defs, b) }
  })
  const xOf = (f: number) => box.x + 160 + f * 2 // LABEL_W + frame × ppf (scrollF 0)
  // the lane row whose edge at x answers with this hover help
  const laneY = async (x: number, tip: RegExp) => {
    for (let y = box.y + 30; y < box.y + box.height - 4; y += 4) {
      await page.mouse.move(x, y)
      if (tip.test(await canvas.getAttribute('title') ?? '')) return y
    }
    throw new Error(`no edge ${tip} at x ${x}`)
  }

  // lead-in 전이: its left edge, dragged 10 frames to the left = 10 frames longer
  const g = await geo(), blendX = xOf(g.b.start - g.lead!.lead + g.lead!.hold)
  const y1 = await laneY(blendX, /^끌어서 전이 길이 조절/)
  await page.mouse.down(); await page.mouse.move(blendX - 10, y1, { steps: 3 }); await page.mouse.move(blendX - 20, y1, { steps: 3 }); await page.mouse.up()
  await expect.poll(async () => (await items(page))[1].restBlend).toBe(g.lead!.blend + 10)
  await page.evaluate(() => (window as any).__editor.getState().undo())
  await expect.poll(async () => (await items(page))[1].restBlend).toBe(g.b.restBlend)

  // 끝 기본자세 (정지): its right edge, dragged 10 frames to the right
  const holdX = xOf(g.a.start + g.a.trimOut - g.a.trimIn + g.tail!.tail)
  const y2 = await laneY(holdX, /^끌어서 끝 기본자세 길이 조절/)
  await page.mouse.down(); await page.mouse.move(holdX + 20, y2, { steps: 4 }); await page.mouse.up()
  await expect.poll(async () => (await items(page))[0].tailHold).toBe(g.tail!.hold + 10)
  expect((await geo()).tail!.tail).toBe(g.tail!.tail + 10)
  expect(errors).toEqual([])
})

test('GO2 이음 block: two pieces end to start, its right edge drags the seam length (one undo)', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(async () => {
    const { emptyBlockClip } = await import(/* @vite-ignore */ '/src/go2blocks/build.ts')
    const s = (window as any).__editor.getState, a = emptyBlockClip(120, s().defs), b = { ...emptyBlockClip(120, s().defs), id: 'b2', name: 'B', hold: undefined }
    b.channels = { ...b.channels, RL_thigh_joint: { keys: [{ f: 0, v: 0.72, interp: 'linear', inTan: { df: 0, dv: 0 }, outTan: { df: 0, dv: 0 } }] } }
    s().appendClip(null, a); s().appendClip(s().project.actors.at(-1).id, b)
    const tv = (window as any).__tv; tv.ppf = 3; tv.scrollF = 0; s().setFrame(0)
  })
  const second = async () => page.evaluate(() => { const s = (window as any).__editor.getState(); return [...s.project.sequence.tracks.find((t: any) => t.kind === 'motion').items].sort((a: any, b: any) => b.start - a.start)[0] })
  const b = await second()
  expect(b.start).toBe(120)
  const canvas = page.locator('.seq-canvas'), box = (await canvas.boundingBox())!
  const x = box.x + 160 + (120 + 20) * 3 // the 이음 block's right edge: piece start + 20 frames
  let y = 0
  for (let yy = box.y + 30; yy < box.y + box.height - 4 && !y; yy += 4) {
    await page.mouse.move(x, yy)
    if (/^끌어서 이음 길이 조절 \(20프레임\)/.test(await canvas.getAttribute('title') ?? '')) y = yy
  }
  expect(y).toBeGreaterThan(0)
  await page.mouse.down(); await page.mouse.move(x + 15, y, { steps: 3 }); await page.mouse.move(x + 30, y, { steps: 3 }); await page.mouse.up()
  await expect.poll(async () => (await second()).seam).toBe(30)
  await page.evaluate(() => (window as any).__editor.getState().undo())
  await expect.poll(async () => (await second()).seam).toBeUndefined()
})

test('lane play button: a piece far off the view scrolls into it (and is selected, previewing)', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.evaluate(async () => {
    const { emptyBlockClip } = await import(/* @vite-ignore */ '/src/go2blocks/build.ts')
    const s = (window as any).__editor.getState, c = emptyBlockClip(30, s().defs)
    s().appendClip(null, c); const a = s().project.actors.at(-1).id
    s().appendClip(a, c); s().moveItem([...s().project.sequence.tracks.find((t: any) => t.kind === 'motion').items].sort((x: any, y: any) => y.start - x.start)[0].id, 6000) // 100 s away
    const tv = (window as any).__tv; tv.ppf = 4; tv.scrollF = 0; s().setFrame(0)
  })
  const canvas = page.locator('.seq-canvas'), box = (await canvas.boundingBox())!, x = box.x + 104 // PLAY_X
  const far = await page.evaluate(() => [...(window as any).__editor.getState().project.sequence.tracks.find((t: any) => t.kind === 'motion').items].sort((a: any, b: any) => b.start - a.start)[0].id)
  let y = 0 // the far piece's lane: the lower of the two play buttons
  for (let yy = box.y + 30; yy < box.y + box.height - 4; yy += 4) {
    await page.mouse.move(x, yy)
    if ((await canvas.getAttribute('title') ?? '').startsWith('재생')) y = yy
  }
  expect(y).toBeGreaterThan(0)
  await page.mouse.click(x, y)
  const st = await page.evaluate(id => { const s = (window as any).__editor.getState(), tv = (window as any).__tv; return { sel: s.selItem === id, prev: s.itemPreview === id, scrolled: tv.scrollF > 5000 } }, far)
  expect(st).toEqual({ sel: true, prev: true, scrolled: true })
})
