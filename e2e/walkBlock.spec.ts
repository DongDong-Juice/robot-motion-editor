import { test, expect, type Page } from '@playwright/test'

// GO2 걷기 블록 1차 (§20): 라이브러리 › 걷기 (가상) adds a made walk at the track end; the inspector of a selected 걷기 piece
// changes it (시간 ⇄ 속도, the later pieces move); the bar says what it does and its state; the stage shows path, ring and heading.
const boot = async (page: Page) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
}
// §29 고치는 중: the inspector's boxes, 찍기 and the rings change a draft; 적용 checks and applies it
const applyBtn = (page: Page) => page.locator('.insp').getByRole('button', { name: '적용', exact: true })
const draft = (page: Page) => page.evaluate(() => (window as any).__editor.getState().walkDraft)
const items = (page: Page, actor: string) => page.evaluate(id => {
  const p = (window as any).__editor.getState().project
  return p.sequence.tracks.find((t: any) => t.actorId === id).items.map((i: any) => ({ id: i.id, start: i.start, len: i.trimOut - i.trimIn, walk: i.walk ?? null }))
    .sort((a: any, b: any) => a.start - b.start)
}, actor)

test('걷기 (가상): add from the library, change it in the inspector, its state on the bar and the stage', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await boot(page) // the app starts empty: the walk makes a new GO2

  // library row under Empty, its panel
  await page.getByRole('tab', { name: '라이브러리' }).click()
  const row = page.locator('.pp-row[data-kind=walk]')
  await expect(row.locator('.pp-name')).toHaveText('걷기 (가상)')
  await row.click()
  const panel = page.locator('.pp-blk')
  await expect(panel.getByRole('combobox', { name: '붙일 로봇' }).locator('option')).toHaveText(['새 GO2 로봇 (0초부터)']) // no 목록에만 추가
  await panel.getByRole('spinbutton', { name: '도착 X' }).fill('1.5')
  await panel.getByRole('spinbutton', { name: '도착 Y' }).fill('0.5')
  await panel.getByRole('spinbutton', { name: '도착 Y' }).press('Enter')
  await panel.getByRole('spinbutton', { name: '시간' }).fill('3')
  await panel.getByRole('spinbutton', { name: '시간' }).press('Enter')
  await expect(panel.locator('.wk-tone')).toContainText('정상')
  await expect(panel.locator('[role=note]').filter({ hasText: '출발점에서' })).toBeVisible() // (a new GO2: also the §27 출발 위치 note)
  await panel.getByRole('button', { name: '추가', exact: true }).click()
  await expect(panel.locator('.pp-msg')).toContainText('걷기를 추가했습니다')
  const actor = await page.evaluate(() => (window as any).__editor.getState().project.actors.at(-1).id as string)
  await expect(panel.getByRole('combobox', { name: '붙일 로봇' }).locator('option')).toHaveCount(2) // now that GO2 (트랙 끝) too
  let its = await items(page, actor)
  expect(its).toHaveLength(1)
  expect(its[0]).toMatchObject({ start: 0, len: 180, walk: { to: [1.5, 0.5], face: 'keep' } })

  // the robot ends on the target (stage)
  const at = (f: number) => page.evaluate(([id, f]) => { const s = (window as any).__editor.getState(); s.setFrame(f); return (window as any).__stage.entries().get(id).dot.position.toArray() }, [actor, f] as const)
  const end = await at(179)
  expect(end[0]).toBeCloseTo(1.5, 2); expect(end[1]).toBeCloseTo(0.5, 2)

  // a piece after it: the walk's time in the inspector pushes it back; one undo
  await page.evaluate(id => { const s = (window as any).__editor.getState(); s.addWalk(id, { to: [2.5, 0.5], face: 'audience' }, 120) }, actor)
  its = await items(page, actor)
  await page.evaluate(([a, id]) => { const s = (window as any).__editor.getState(); s.selectItem(id); s.select(a); s.setFrame(0) }, [actor, its[0].id] as const)
  const insp = page.locator('.insp')
  await expect(insp.getByRole('heading', { name: '걷기 조각' })).toBeVisible()
  await insp.getByRole('spinbutton', { name: '시간' }).fill('4')
  await insp.getByRole('spinbutton', { name: '시간' }).press('Enter')
  // §29: a draft until 적용 — the project is as it was, the heading says so
  expect((await items(page, actor)).map(i => [i.start, i.len])).toEqual([[0, 180], [180, 120]])
  await expect(insp.locator('.wk-draft-tag')).toHaveText('고치는 중 · 적용 전')
  await applyBtn(page).click()
  await expect(insp.locator('.insp-hint[role=status]')).toContainText('뒤 조각이 1.0초 밀렸습니다')
  await expect(insp.locator('.wk-draft-tag')).toHaveCount(0)
  expect((await items(page, actor)).map(i => [i.start, i.len])).toEqual([[0, 240], [240, 120]])
  // speed instead of time: 0.5 m/s over the distance
  const dist = await page.evaluate(() => Math.hypot(1.5, 0.5))
  await insp.getByRole('spinbutton', { name: '속도' }).fill('0.5')
  await insp.getByRole('spinbutton', { name: '속도' }).press('Enter')
  await applyBtn(page).click()
  await expect.poll(async () => (await items(page, actor))[0].len).toBe(Math.round(dist / 0.5 * 60))
  await page.evaluate(() => { (window as any).__editor.getState().undo(); (window as any).__editor.getState().undo() })
  expect((await items(page, actor)).map(i => [i.start, i.len])).toEqual([[0, 180], [180, 120]])

  // too fast (§22 안정성 우선, §29 · §30): the value stays in its box, nothing is checked while it is a draft — the 바꿀 예정 box
  // says what would change; 적용 checks: not applied, what is wrong in one sentence; 최소 시간으로 하고 적용 does (the piece after it moves)
  await insp.getByRole('spinbutton', { name: '시간' }).fill('0.8')
  await insp.getByRole('spinbutton', { name: '시간' }).press('Enter')
  await expect(insp.getByRole('spinbutton', { name: '시간' })).toHaveValue('0.8') // kept, not snapped back
  const planBox = insp.getByRole('status', { name: '바꿀 예정' })
  await expect(planBox.locator('.wk-plan-row')).toHaveText(['시간3.0초→0.8초'])
  await expect(insp.locator('.wk-tone')).toHaveCount(0) // no verdict before 적용
  await expect(insp.getByRole('alert')).toHaveCount(0)
  await expect(insp.locator('.wk-num.wk-chg input')).toHaveAttribute('aria-label', '시간') // the changed box marked
  await applyBtn(page).click()
  const no = insp.getByRole('alert')
  await expect(no).toContainText('적용하지 않았습니다 — 이 걷기가 한계 초과입니다')
  await expect(no.locator('.wk-head').first()).toContainText(/출발 위치 \(0\.00, 0\.00\)에서 도착 위치 \(1\.50, 0\.50\)까지 1\.58 m를 0\.8초 안에 걸어갈 수 없습니다 — 이 거리는 최소 [\d.]+초가 필요합니다/)
  await expect(no.locator('details.wk-more').first()).not.toHaveAttribute('open', '') // the numbers folded away
  expect((await items(page, actor)).map(i => [i.start, i.len])).toEqual([[0, 180], [180, 120]])
  await expect(insp.getByRole('spinbutton', { name: '시간' })).toHaveValue('0.8')
  // another change: the refusal goes, a draft again (checked at the next 적용)
  await insp.getByRole('spinbutton', { name: '시간' }).fill('0.9'); await insp.getByRole('spinbutton', { name: '시간' }).press('Enter')
  await expect(insp.getByRole('alert')).toHaveCount(0)
  await applyBtn(page).click()
  const fix = insp.getByRole('button', { name: /^최소 시간 [\d.]+초로 하고 적용 — 뒤 조각 [\d.]+초 (밀림|당겨짐)$/ })
  const minF = Math.round(Number((await fix.textContent())!.match(/최소 시간 ([\d.]+)초/)![1]) * 60)
  expect(minF).toBeLessThan(180)
  await fix.click()
  await expect.poll(async () => (await items(page, actor)).map(i => [i.start, i.len])).toEqual([[0, minF], [minF, 120]])
  await expect(insp.locator('.wk-tone')).not.toContainText('한계 초과')
  await page.evaluate(() => (window as any).__editor.getState().undo())
  expect((await items(page, actor)).map(i => [i.start, i.len])).toEqual([[0, 180], [180, 120]])
  // 취소: the draft dropped, the boxes show the piece again
  await insp.getByRole('spinbutton', { name: '시간' }).fill('5'); await insp.getByRole('spinbutton', { name: '시간' }).press('Enter')
  await insp.getByRole('button', { name: '취소', exact: true }).click()
  await expect(insp.getByRole('spinbutton', { name: '시간' })).toHaveValue('3')
  expect(await draft(page)).toBeNull()

  // the bar: label and state in the lane help
  const open = page.getByRole('button', { name: /클립 목록$/ }).first()
  if (await open.getAttribute('aria-expanded') !== 'true') await open.click()
  const cv = page.locator('.seq-canvas'), box = (await cv.boundingBox())!
  await page.mouse.move(box.x + 80, box.y + 24 + 28 + 14)
  await expect.poll(() => cv.getAttribute('title')).toContain('걷기: 정상')

  // the stage: dashed path, target ring, heading arrow while it is selected (+ the 출발 고리, §27: it is the track's first piece)
  const guide = () => page.evaluate(() => { const g = (window as any).__stage.walkGuide(); return { on: g.visible, n: g.children.length } })
  await expect.poll(guide).toEqual({ on: true, n: 4 })
  await page.evaluate(() => (window as any).__editor.getState().selectItem(null))
  await expect.poll(async () => (await guide()).on).toBe(false)

  // made, not edited: no trim from the front, no cut, no 기본자세
  const refused = await page.evaluate(id => {
    const s = (window as any).__editor.getState()
    return [s.trimItem(id, 'in', 10), s.setRestPose(id, 'prepend'), s.setRestTail(id, true)]
  }, its[0].id)
  expect(refused).toEqual([false, false, false])
  expect(errors).toEqual([])
})

test('도착 위치를 무대에서: 찍기 (라이브러리 · 인스펙터, Esc 취소) and the selected walk\'s ring dragged (one undo)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await boot(page)
  const at = (x: number, y: number) => page.evaluate(([x, y]) => (window as any).__stage.screenOf(x, y) as [number, number], [x, y] as const)

  // 라이브러리: 찍기, the floor clicked → 도착 X / Y; the button turns off
  await page.getByRole('tab', { name: '라이브러리' }).click()
  await page.locator('.pp-row[data-kind=walk]').click()
  const panel = page.locator('.pp-blk'), btn = panel.getByTitle(/도착 위치를 정합니다/) // (§27: the 출발 위치 has its own 찍기)
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  let [x, y] = await at(0.8, 0.4)
  await page.mouse.move(x - 20, y); await page.mouse.move(x, y)
  await expect.poll(() => page.evaluate(() => (window as any).__stage.walkPickShown())).toBe(true)
  await expect(page.locator('.wk-pick-tag')).toContainText(/^X 0\.(79|80|81) · Y 0\.(39|40|41) m · 출발점에서/)
  await page.mouse.click(x, y)
  await expect.poll(async () => Math.hypot(Number(await panel.getByRole('spinbutton', { name: '도착 X' }).inputValue()) - 0.8,
    Number(await panel.getByRole('spinbutton', { name: '도착 Y' }).inputValue()) - 0.4)).toBeLessThanOrEqual(0.03) // whole pixels: ±1 cm
  const picked = [Number(await panel.getByRole('spinbutton', { name: '도착 X' }).inputValue()), Number(await panel.getByRole('spinbutton', { name: '도착 Y' }).inputValue())]
  await expect(btn).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => (window as any).__stage.walkPickShown())).toBe(false)
  // Esc cancels without a change
  await btn.click(); [x, y] = await at(0.2, -0.6); await page.mouse.move(x, y)
  await page.keyboard.press('Escape')
  await expect(btn).toHaveAttribute('aria-pressed', 'false')
  await page.mouse.click(x, y)
  await expect(panel.getByRole('spinbutton', { name: '도착 X' })).toHaveValue(String(picked[0]))
  await panel.getByRole('button', { name: '추가', exact: true }).click()
  const actor = await page.evaluate(() => (window as any).__editor.getState().project.actors.at(-1).id as string)
  const walkOfIt = () => page.evaluate(() => { const p = (window as any).__editor.getState().project; return p.sequence.tracks.flatMap((t: any) => t.items).find((i: any) => i.walk) })
  const id = (await walkOfIt()).id
  expect((await walkOfIt()).walk.to).toEqual(picked)

  // 인스펙터: 찍기 on the selected piece — a draft (§29) shown on the stage; 적용 sets it, one undo back
  await page.evaluate(([a, id]) => { const s = (window as any).__editor.getState(); s.selectItem(id); s.select(a); s.setFrame(0) }, [actor, id] as const)
  const insp = page.locator('.insp')
  await insp.getByTitle(/도착 위치를 정합니다/).click();
  [x, y] = await at(1.2, -0.3)
  await page.mouse.move(x, y); await page.mouse.click(x, y)
  await expect.poll(async () => { const t = (await draft(page))?.patch.to; return !!t && Math.hypot(t[0] - 1.2, t[1] + 0.3) <= 0.03 }).toBe(true)
  expect((await walkOfIt()).walk.to).toEqual(picked) // not applied yet
  await expect.poll(() => page.evaluate(() => (window as any).__stage.walkDraftGuide().visible)).toBe(true)
  expect(await page.evaluate(() => (window as any).__stage.walkDraftGuide().children.map((c: any) => c.userData.text).filter(Boolean))).toEqual(['도착 (예정)', '지금 도착']) // §30: named
  await expect(insp.getByRole('status', { name: '바꿀 예정' })).toContainText('도착 위치')
  expect(await page.evaluate(() => (window as any).__editor.getState().sel.actorId)).toBe(actor) // the click did not deselect
  await applyBtn(page).click()
  await expect.poll(async () => { const t = (await walkOfIt()).walk.to; return Math.hypot(t[0] - 1.2, t[1] + 0.3) <= 0.03 }).toBe(true)
  expect(await draft(page)).toBeNull()
  await expect.poll(() => page.evaluate(() => (window as any).__stage.walkDraftGuide().visible)).toBe(false)
  await page.evaluate(() => (window as any).__editor.getState().undo())
  expect((await walkOfIt()).walk.to).toEqual(picked)

  // the ring of the selected walk dragged: the draft on release (the camera did not move); 적용, one undo
  await expect.poll(() => page.evaluate(() => (window as any).__stage.walkGuide().visible)).toBe(true)
  const cam0 = await page.evaluate(() => (window as any).__stage.camera.position.toArray())
  const [rx, ry] = await at(picked[0], picked[1]), [tx, ty] = await at(1.1, 0.3)
  await page.mouse.move(rx, ry); await page.mouse.down()
  await page.mouse.move((rx + tx) / 2, (ry + ty) / 2); await page.mouse.move(tx, ty)
  expect(await draft(page)).toBeNull() // nothing until release
  await page.mouse.up()
  await expect.poll(async () => { const t = (await draft(page))?.patch.to; return !!t && Math.hypot(t[0] - 1.1, t[1] - 0.3) <= 0.03 }).toBe(true) // (mouse on whole pixels: a cm or two at this zoom)
  expect((await walkOfIt()).walk.to).toEqual(picked)
  expect(await page.evaluate(() => (window as any).__stage.camera.position.toArray())).toEqual(cam0)
  await applyBtn(page).click()
  await expect.poll(async () => { const t = (await walkOfIt()).walk.to; return Math.hypot(t[0] - 1.1, t[1] - 0.3) <= 0.03 }).toBe(true)
  await page.evaluate(() => (window as any).__editor.getState().undo())
  expect((await walkOfIt()).walk.to).toEqual(picked)
  expect(errors).toEqual([])
})

test('§23 도착 X · Y entered together (no half change); 추천 수정 with the next walk: one button, one undo; an unchanged box commits nothing', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await boot(page)
  const ids = await page.evaluate(async () => {
    const { parseCsvPoses, posesToClip } = await import('/src/export/importCsv.ts')
    const s = (window as any).__editor.getState()
    const text = await (await fetch('/go2-blocks/' + encodeURI('기본 자세/003_기본_서기.csv'))).text()
    const { robot, fps, poses } = parseCsvPoses(text, s.defs, 60), last = { ...poses[poses.length - 1], rootQuat: [0, 0, 0, 1] }
    s.appendClip(null, { ...posesToClip(Array.from({ length: 90 }, () => structuredClone(last)), fps, robot, s.defs, 'a'), id: 'a' })
    const ed = (window as any).__editor, a = ed.getState().project.actors.at(-1).id
    const w1 = ed.getState().addWalk(a, { to: [0.5, 0], face: 'keep' }, 120), w2 = ed.getState().addWalk(a, { to: [1.2, 0], face: 'keep' }, 120)
    ed.getState().selectItem(w1); ed.getState().select(a)
    return { a, w1, w2 }
  })
  const walks = () => page.evaluate(({ w1, w2 }) => { const its = (window as any).__editor.getState().project.sequence.tracks.flatMap((t: any) => t.items)
    const g = (id: string) => its.find((i: any) => i.id === id); return [g(w1).walk.to, g(w1).trimOut, g(w2).trimOut] }, ids)
  const mark = () => page.evaluate(() => { (window as any).__p0 = (window as any).__editor.getState().project })
  const same = () => page.evaluate(() => (window as any).__editor.getState().project === (window as any).__p0) // nothing committed since mark()
  const insp = page.locator('.insp')
  // X then Y: nothing applied while moving between the two boxes; the pair applies on Enter
  await mark()
  await insp.getByRole('spinbutton', { name: '도착 X' }).fill('-1.5')
  await insp.getByRole('spinbutton', { name: '도착 Y' }).click()
  expect(await same()).toBe(true)
  await expect(insp.getByRole('spinbutton', { name: '도착 Y' })).toBeFocused()
  await insp.getByRole('spinbutton', { name: '도착 Y' }).fill('0.2')
  await insp.getByRole('spinbutton', { name: '도착 Y' }).press('Enter')
  // the pair (-1.5, 0.2) is a draft (§29 · §30): nothing applied, nothing checked — 바꿀 예정 lists it
  expect(await same()).toBe(true)
  expect((await draft(page)).patch.to).toEqual([-1.5, 0.2])
  await expect(insp.getByRole('status', { name: '바꿀 예정' }).locator('.wk-plan-row').first()).toHaveText('도착 위치(0.50, 0.00)→(-1.50, 0.20)')
  await expect(insp.locator('.wk-tone')).toHaveCount(0)
  await applyBtn(page).click() // checked here: not applied, the values stay; this walk and the next one, a sentence each
  const no = insp.getByRole('alert')
  await expect(no).toContainText('적용하지 않았습니다')
  await expect(no.locator('.wk-head').first()).toContainText('도착 위치 (-1.50, 0.20)까지')
  await expect(no).toContainText(/다음 걷기가 [\d.]+ m를 2\.0초 안에 걸어갈 수 없게 됩니다 — 최소 [\d.]+초가 필요합니다/)
  expect(await same()).toBe(true)
  await expect(insp.getByRole('spinbutton', { name: '도착 X' })).toHaveValue('-1.5')
  // one button for both walks
  const btn = insp.getByRole('button', { name: /^최소 시간으로 하고 적용 — 이 걷기 [\d.]+초 · 다음 걷기 [\d.]+초 — 뒤 조각 [\d.]+초 밀림$/ })
  await expect(btn).toBeVisible()
  await btn.click()
  await expect(insp.getByRole('alert')).toHaveCount(0)
  expect(await draft(page)).toBeNull()
  const [to, f1, f2] = await walks()
  expect(to).toEqual([-1.5, 0.2])
  expect(f1).toBeGreaterThan(120); expect(f2).toBeGreaterThan(120)
  await page.evaluate(() => (window as any).__editor.getState().undo()) // one undo takes all of it back
  expect(await walks()).toEqual([[0.5, 0], 120, 120])
  // tabbing through unchanged boxes commits nothing
  await mark()
  await insp.getByRole('spinbutton', { name: '도착 X' }).focus()
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
  await insp.getByRole('spinbutton', { name: '시간' }).focus(); await insp.getByRole('spinbutton', { name: '속도' }).focus()
  await page.locator('.insp-sec-t').first().click()
  expect(await same()).toBe(true)
  expect(await draft(page)).toBeNull()
  await expect(insp.getByRole('alert')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('§27 출발 위치: a first walk sets where the robot starts (library and inspector); a spot that makes it 한계 초과 is refused with 최소 시간', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await boot(page)
  await page.getByRole('tab', { name: '라이브러리' }).click()
  await page.locator('.pp-row[data-kind=walk]').click()
  const panel = page.locator('.pp-blk')
  // a new GO2: 출발 위치 boxes (its 배치), the default 1 m ahead follows it
  const sx = panel.getByRole('spinbutton', { name: '출발 X' }), sy = panel.getByRole('spinbutton', { name: '출발 Y' })
  await expect(sx).toHaveValue('0')
  await sx.fill('-1'); await sy.fill('0.5'); await sy.press('Enter')
  await expect(panel.getByRole('spinbutton', { name: '도착 X' })).toHaveValue('0')
  await expect(panel.getByRole('spinbutton', { name: '도착 Y' })).toHaveValue('0.5')
  await panel.getByRole('button', { name: '추가', exact: true }).click()
  await expect(panel.locator('.pp-msg')).toContainText('걷기를 추가했습니다')
  const a = await page.evaluate(() => (window as any).__editor.getState().project.actors[0])
  expect(a.placement).toMatchObject({ x: -1, y: 0.5 })

  // inspector of that walk (the track's first piece): 출발 위치 shown; a far spot is refused → 최소 시간 … 하고 옮기기
  const its = await items(page, a.id)
  await page.evaluate(([actor, id]) => { const s = (window as any).__editor.getState(); s.selectItem(id); s.select(actor); s.setFrame(0) }, [a.id, its[0].id] as const)
  const insp = page.locator('.insp')
  const ix = insp.getByRole('spinbutton', { name: '출발 X' })
  await expect(ix).toHaveValue('-1')
  await ix.fill('-4'); await ix.press('Enter')
  // §29 · §30: kept as a draft — the robot stays, the box keeps -4, 바꿀 예정 says from where to where; no check until 적용
  await expect(ix).toHaveValue('-4')
  expect((await page.evaluate(() => (window as any).__editor.getState().project.actors[0].placement.x))).toBe(-1)
  await expect(insp.getByRole('status', { name: '바꿀 예정' }).locator('.wk-plan-row')).toHaveText(['출발 위치(-1.00, 0.50)→(-4.00, 0.50)', '거리1.00 m→4.00 m'])
  await expect(insp.locator('.wk-tone')).toHaveCount(0)
  await applyBtn(page).click()
  await expect(insp.getByRole('alert')).toContainText('적용하지 않았습니다')
  await expect(insp.getByRole('alert').locator('.wk-head').first()).toContainText(/출발 위치 \(-4\.00, 0\.50\)에서 도착 위치 \(0\.00, 0\.50\)까지 4\.00 m를 2\.0초 안에 걸어갈 수 없습니다 — 이 거리는 최소 [\d.]+초가 필요합니다/)
  expect((await page.evaluate(() => (window as any).__editor.getState().project.actors[0].placement.x))).toBe(-1)
  await insp.getByRole('button', { name: /^최소 시간 [\d.]+초로 하고 적용/ }).click()
  await expect(insp.locator('.insp-hint[role=status]')).toContainText('적용했습니다 (출발 위치 = 로봇 배치)')
  expect((await page.evaluate(() => (window as any).__editor.getState().project.actors[0].placement.x))).toBe(-4)

  // 출발 and 도착 changed together, far from where they were: fine as a pair — one 적용, one undo (each alone would be 한계 초과)
  await page.evaluate(() => (window as any).__editor.getState().undo()) // back to (-1, 0.5) → (0, 0.5), 2 s
  await ix.fill('3'); await ix.press('Enter') // (3, 0.5) → (0, 0.5) in 2 s would not pass: not checked, not stopped
  await expect(insp.getByRole('alert')).toHaveCount(0)
  await insp.getByRole('spinbutton', { name: '도착 X' }).fill('4'); await insp.getByRole('spinbutton', { name: '도착 X' }).press('Enter')
  await expect(insp.getByRole('status', { name: '바꿀 예정' }).locator('.wk-plan-row')).toHaveText(['출발 위치(-1.00, 0.50)→(3.00, 0.50)', '도착 위치(0.00, 0.50)→(4.00, 0.50)'])
  await applyBtn(page).click()
  await expect(insp.getByRole('alert')).toHaveCount(0)
  const after = await page.evaluate(() => { const p = (window as any).__editor.getState().project; return [p.actors[0].placement.x, p.sequence.tracks.flatMap((t: any) => t.items)[0].walk.to] })
  expect(after).toEqual([3, [4, 0.5]])
  await page.evaluate(() => (window as any).__editor.getState().undo())
  expect((await page.evaluate(() => (window as any).__editor.getState().project.actors[0].placement))).toMatchObject({ x: -1, y: 0.5 })

  // the 출발 고리 on the stage dragged: the draft on release; 적용 = the robot's 배치, one undo
  await expect.poll(() => page.evaluate(() => { const g = (window as any).__stage.walkGuide(); return g.visible && g.children.length })).toBe(4)
  const at = (x: number, y: number) => page.evaluate(([x, y]) => (window as any).__stage.screenOf(x, y) as [number, number], [x, y] as const)
  const [rx, ry] = await at(-1, 0.5), [tx, ty] = await at(-0.6, 0.3)
  await page.mouse.move(rx, ry); await page.mouse.down()
  await page.mouse.move((rx + tx) / 2, (ry + ty) / 2); await page.mouse.move(tx, ty)
  await expect(page.locator('.wk-pick-tag')).toContainText('도착점까지')
  await page.mouse.up()
  await expect.poll(async () => { const p = (await draft(page))?.place; return !!p && Math.hypot(p.x + 0.6, p.y - 0.3) <= 0.03 }).toBe(true)
  expect((await page.evaluate(() => (window as any).__editor.getState().project.actors[0].placement))).toMatchObject({ x: -1, y: 0.5 })
  await applyBtn(page).click()
  await expect.poll(() => page.evaluate(() => { const p = (window as any).__editor.getState().project.actors[0].placement; return Math.hypot(p.x + 0.6, p.y - 0.3) <= 0.03 })).toBe(true)
  await page.evaluate(() => (window as any).__editor.getState().undo())
  expect((await page.evaluate(() => (window as any).__editor.getState().project.actors[0].placement))).toMatchObject({ x: -1, y: 0.5 })

  // a draft left unapplied goes when another piece is picked
  await ix.fill('-2'); await ix.press('Enter')
  expect((await draft(page)).place).toEqual({ x: -2 })
  // a second walk starts where the first ends: no 출발 boxes there
  await page.evaluate(id => (window as any).__editor.getState().addWalk(id, { to: [1, 1], face: 'keep' }, 240), a.id)
  const two = await items(page, a.id)
  await page.evaluate(([actor, id]) => { const s = (window as any).__editor.getState(); s.selectItem(id); s.select(actor) }, [a.id, two[1].id] as const)
  await expect(insp.getByRole('spinbutton', { name: '출발 X' })).toHaveCount(0)
  expect(await draft(page)).toBeNull()
  await expect(insp.getByRole('note').filter({ hasText: '앞 조각이 끝나는 자리' })).toBeVisible()
  expect(errors).toEqual([])
})

test('§28 붙일 자리: 이 조각 뒤에 걷기 넣기… opens the 걷기 panel on that piece; added in the middle, the later pieces later; a later walk made 한계 초과 is refused with its 최소 시간', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await boot(page)
  const actor = await page.evaluate(() => {
    const ed = (window as any).__editor
    ed.getState().addWalk(null, { to: [1, 0], face: 'keep' }, 120)
    const a = ed.getState().project.actors.at(-1).id
    ;(window as any).__editor.getState().addWalk(a, { to: [2, 0], face: 'keep' }, 120)
    return a as string
  })
  const [w1, w2] = (await items(page, actor)).map(i => i.id)
  // the first walk's lane: right click → 이 조각 뒤에 걷기 넣기…
  const open = page.getByRole('button', { name: /클립 목록$/ }).first()
  if (await open.getAttribute('aria-expanded') !== 'true') await open.evaluate(b => (b as HTMLElement).click())
  const cv = page.locator('.seq-canvas'), cb = (await cv.boundingBox())!
  await page.mouse.click(cb.x + 80, cb.y + 24 + 28 + 14, { button: 'right' })
  await page.getByRole('menuitem', { name: '이 조각 뒤에 걷기 넣기…' }).click()
  const panel = page.locator('.pp-blk')
  await expect(page.getByRole('tab', { name: '라이브러리' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByRole('combobox', { name: '붙일 자리' })).toHaveValue(w1)
  expect(await page.evaluate(() => (window as any).__editor.getState().walkAfter?.itemId)).toBe(w1) // the timeline outlines it
  // starts where the first walk ends: the default target is 1 m ahead of (1, 0)
  await expect(panel.getByRole('spinbutton', { name: '도착 X' })).toHaveValue('2')
  await panel.getByRole('spinbutton', { name: '도착 X' }).fill('1.3'); await panel.getByRole('spinbutton', { name: '도착 Y' }).fill('0.2')
  await panel.getByRole('spinbutton', { name: '도착 Y' }).press('Enter')
  const add = panel.getByRole('button', { name: /^추가 — 뒤 조각 2\.0초 밀림$/ })
  await add.click()
  await expect(panel.locator('.pp-msg')).toContainText('뒤 조각 2.0초 밀림')
  let its = await items(page, actor)
  expect(its.map(i => [i.id === w1 ? 'w1' : i.id === w2 ? 'w2' : 'new', i.start])).toEqual([['w1', 0], ['new', 120], ['w2', 240]])
  expect(its[1].walk.to).toEqual([1.3, 0.2])

  // after the new walk (the panel moved on to it): far back — the next walk would have 2.5 m in 2 s → refused, its 최소 시간 offered
  await expect(panel.getByRole('combobox', { name: '붙일 자리' })).toHaveValue(its[1].id)
  await panel.getByRole('spinbutton', { name: '도착 X' }).fill('-0.5'); await panel.getByRole('spinbutton', { name: '도착 Y' }).fill('0')
  await panel.getByRole('spinbutton', { name: '도착 Y' }).press('Enter')
  await panel.getByRole('spinbutton', { name: '시간' }).fill('6'); await panel.getByRole('spinbutton', { name: '시간' }).press('Enter')
  const box = panel.getByRole('alert')
  await expect(box).toContainText('뒤 걷기가 한계 초과가 됩니다')
  await expect(panel.getByRole('button', { name: /^추가/ })).toBeDisabled()
  await box.getByRole('button', { name: /^뒤 걷기 최소 시간으로 하고 추가 — 다음 걷기 \d+\.\d초$/ }).click()
  its = await items(page, actor)
  expect(its).toHaveLength(4)
  expect(its[3].id).toBe(w2)
  expect(its[3].len).toBeGreaterThan(120) // the next walk made longer
  await page.evaluate(() => (window as any).__editor.getState().undo())
  expect(await items(page, actor)).toHaveLength(3)
  expect(errors).toEqual([])
})

test('§31 the planned marks stay on the stage while a walk is being changed, whether or not its piece is the selected one', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await boot(page)
  // a walk shown in the inspector by the playhead only (the robot picked, no piece selected)
  await page.evaluate(() => { const ed = (window as any).__editor; ed.getState().addWalk(null, { to: [1, 0], face: 'keep' }, 120); ed.getState().select(ed.getState().project.actors.at(-1).id); ed.getState().setFrame(10) })
  const at = (x: number, y: number) => page.evaluate(([x, y]) => (window as any).__stage.screenOf(x, y) as [number, number], [x, y] as const)
  const tags = () => page.evaluate(() => { const g = (window as any).__stage.walkDraftGuide(); return g.visible ? g.children.map((c: any) => c.userData.text).filter(Boolean) : null })
  const insp = page.locator('.insp')
  expect(await page.evaluate(() => (window as any).__editor.getState().selItem)).toBeNull()
  await insp.getByTitle(/출발할 위치를 정합니다/).click()
  let [x, y] = await at(-1, 0.5)
  await page.mouse.move(x - 10, y); await page.mouse.move(x, y); await page.mouse.click(x, y)
  await expect.poll(tags).toEqual(['출발 (예정)', '지금 출발'])
  await expect.poll(() => page.evaluate(() => (window as any).__stage.walkGuide().visible)).toBe(true) // the walk as it is, under them
  // a plain click on the empty floor (the piece selection goes): the marks stay, the inspector still has the draft
  ;[x, y] = await at(2.5, -1.5)
  await page.mouse.click(x, y)
  await expect(insp.getByRole('status', { name: '바꿀 예정' })).toContainText('출발 위치')
  expect(await tags()).toEqual(['출발 (예정)', '지금 출발'])
  // 취소: gone
  await insp.getByRole('button', { name: '취소', exact: true }).click()
  await expect.poll(tags).toBeNull()
  expect(errors).toEqual([])
})
