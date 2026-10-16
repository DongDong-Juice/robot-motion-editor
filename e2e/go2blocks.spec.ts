import { test, expect, type Page } from '@playwright/test'

// GO2 blocks live in the 목록 panel's 라이브러리 tab (spec 2026-10-16-project-panel-design.md §5).
const boot = async (page: Page) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
}
const addGo2 = (page: Page) => page.evaluate(() => {
  const ed = (window as any).__editor
  ed.getState().addActor('go2') // the app starts empty
  const a = ed.getState().project.actors.at(-1)
  ed.getState().select(a.id)
  return a.id as string
})
const trackItems = (page: Page, actorId: string) => page.evaluate(id => {
  const p = (window as any).__editor.getState().project
  return p.sequence.tracks.find((t: any) => t.actorId === id).items
    .map((i: any) => ({ start: i.start, len: i.trimOut - i.trimIn, name: p.clips[i.refId].name }))
    .sort((a: any, b: any) => a.start - b.start)
}, actorId)
const clipCount = (page: Page) => page.evaluate(() => Object.keys((window as any).__editor.getState().project.clips).length)
const actors = (page: Page) => page.evaluate(() => (window as any).__editor.getState().project.actors.map((a: any) => ({ id: a.id, robot: a.robot })))
const library = async (page: Page) => {
  await page.getByRole('tab', { name: '라이브러리' }).click()
  return page.getByRole('tree', { name: '라이브러리' })
}
const row = (page: Page, label: string) => page.locator('.pp-row[data-kind=block]').filter({ has: page.locator('.pp-name', { hasText: new RegExp(`^${label}$`) }) })
const add = (page: Page) => page.getByRole('button', { name: '추가', exact: true })

test('GO2 selected → 라이브러리 adds Move then Stretch at the track end', async ({ page }) => {
  await boot(page)
  const id = await addGo2(page)
  const before = await trackItems(page, id), end0 = Math.max(0, ...before.map(i => i.start + i.len))
  const tree = await library(page)
  await expect(tree.locator('.pp-row')).toHaveCount(15)
  await expect(row(page, 'Move forward').locator('.pp-col-kind')).toHaveText('거리')
  await expect(row(page, 'Rotate').locator('.pp-col-kind')).toHaveText('각도')
  await expect(row(page, 'Stretch').locator('.pp-col-kind')).toHaveText('고정')

  await row(page, 'Move forward').click()
  await expect(page.locator('.pp-blk')).toContainText('대상: ')
  await page.getByLabel('값').fill('1.8')
  await expect(page.getByText(/실제 .*m \(\d+회\)/)).toBeVisible()
  await add(page).click()
  await expect.poll(async () => (await trackItems(page, id)).length).toBe(before.length + 1)
  const move = (await trackItems(page, id)).at(-1)!
  expect(move.start).toBe(end0)
  expect(move.name).toMatch(/^Move_/)

  await row(page, 'Stretch').click()
  await expect(page.getByLabel('값')).toHaveCount(0)
  await add(page).click()
  await expect.poll(async () => (await trackItems(page, id)).length).toBe(before.length + 2)
  expect((await trackItems(page, id)).at(-1)).toMatchObject({ start: move.start + move.len, name: 'Stretch' })

  // the made clips are in the 모션 tab
  await page.getByRole('tab', { name: '모션(CSV)' }).click()
  await expect(page.locator('.pp-row[data-kind=clip] .pp-name', { hasText: 'Stretch' })).toBeVisible()
  await expect(page.locator('.pp-row[data-kind=clip] .pp-name', { hasText: /^Move_/ })).toBeVisible()
})

test('no GO2: 추가 makes one at 0 s, the next appends to it', async ({ page }) => {
  await boot(page)
  await library(page)
  await row(page, 'Stretch').click()
  await expect(page.locator('.pp-blk')).toContainText('대상: 새 GO2 로봇')
  await add(page).click()
  await expect(page.locator('.pp-blk')).toContainText('추가했습니다: Stretch')
  await expect.poll(async () => (await actors(page)).map(a => a.robot)).toEqual(['go2'])
  const id = (await actors(page))[0].id
  await row(page, 'Sit').click()
  await expect(add(page)).toBeEnabled()
  await add(page).click()
  await expect.poll(async () => (await trackItems(page, id)).map(i => i.name)).toEqual(['Stretch', 'Sit'])
  const [a, b] = await trackItems(page, id)
  expect(a.start).toBe(0)
  expect(b.start).toBe(a.len)
  expect((await actors(page)).length).toBe(1)
})

test('empty value disables 추가; the filter narrows the list', async ({ page }) => {
  await boot(page)
  await addGo2(page)
  await library(page)
  await row(page, 'Rotate').click()
  await expect(add(page)).toBeEnabled()
  await page.getByLabel('값').fill('')
  await expect(add(page)).toBeDisabled()
  await page.getByLabel('필터').fill('flip')
  await expect(page.locator('.pp-row[data-kind=block]')).toHaveCount(4)
  await expect(page.locator('.pp-count')).toHaveText('4 항목')
})

test('template 404 shows error, project unchanged', async ({ page }) => {
  await page.route('**/go2-blocks/stretch.csv', r => r.fulfill({ status: 404, body: '' }))
  await boot(page)
  await addGo2(page)
  const n = await clipCount(page)
  await library(page)
  await row(page, 'Stretch').click()
  await expect(page.getByRole('alert')).toContainText('템플릿을 불러오지 못했습니다')
  await expect(add(page)).toBeDisabled()
  expect(await clipCount(page)).toBe(n)
})

test('a fixed block dragged to empty timeline space makes a GO2 actor and clip', async ({ page }) => {
  await boot(page)
  await library(page)
  await row(page, 'Stretch').click() // loads the template
  await expect(add(page)).toBeEnabled()
  const seq = page.locator('.seq-canvas'), box = (await seq.boundingBox())!
  await row(page, 'Stretch').dragTo(seq, { targetPosition: { x: 300, y: box.height - 20 } })
  await expect.poll(async () => (await actors(page)).map(a => a.robot)).toEqual(['go2'])
  const items = await trackItems(page, (await actors(page))[0].id)
  expect(items.map(i => i.name)).toEqual(['Stretch'])
  expect(await clipCount(page)).toBe(1)
  await expect(row(page, 'Move forward')).not.toHaveAttribute('draggable', 'true')
})

test('a fixed block drags to the timeline without picking its row first', async ({ page }) => {
  await boot(page)
  await library(page)
  const seq = page.locator('.seq-canvas'), box = (await seq.boundingBox())!
  // the template preloads in the background: retry the drag until it takes
  await expect(async () => {
    await row(page, 'Stretch').dragTo(seq, { targetPosition: { x: 300, y: box.height - 20 } })
    expect((await actors(page)).map(a => a.robot)).toEqual(['go2'])
  }).toPass()
  expect(await clipCount(page)).toBe(1)
})
