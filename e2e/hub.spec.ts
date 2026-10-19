import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } }) // show the start screen

test('start screen: create on the hub, save, reopen from the list, conflict asks before overwriting', async ({ page }) => {
  const name = `e2e-${Date.now()}`, file = `${name}.motion.json`
  await page.goto('/')
  const start = page.getByRole('dialog', { name: '프로젝트' })
  await expect(start).toBeVisible({ timeout: 30000 })
  await page.keyboard.press('Escape')
  await expect(start).toBeVisible() // must pick one

  await start.getByRole('button', { name: '+ 새 프로젝트' }).click()
  await start.getByLabel('프로젝트 이름').fill('a/b')
  await start.getByRole('button', { name: '만들기' }).click()
  await expect(start.getByRole('alert')).toContainText('쓸 수 없습니다')
  await start.getByLabel('프로젝트 이름').fill(name)
  await start.getByRole('button', { name: '만들기' }).click()
  await expect(start).toHaveCount(0)
  await expect(page.locator('.mb-title')).toHaveText(file)

  // edit + Ctrl+S → written on the hub
  await page.evaluate(() => (window as any).__editor.getState().addActor('g1'))
  await page.locator('#stage').click()
  await page.keyboard.press('Control+s')
  await expect(page.locator('.mb-msg')).toHaveText('서버에 저장했습니다')
  const saved = await (await page.request.get(`/api/projects/${encodeURIComponent(file)}`)).json()
  expect(saved.actors).toHaveLength(1)

  // someone else saves → our save asks first
  await page.request.put(`/api/projects/${encodeURIComponent(file)}`, { data: { ...saved, other: 1 } })
  await page.evaluate(() => (window as any).__editor.getState().addActor('go2'))
  const asked: string[] = []
  page.once('dialog', d => { asked.push(d.message()); void d.accept() })
  await page.keyboard.press('Control+s')
  await expect.poll(() => asked[0]).toContain('다른 사람이')
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${encodeURIComponent(file)}`)).json()).actors.length).toBe(2)

  // reload: the hub list opens it; the same name cannot be created twice
  await page.reload()
  await expect(start).toBeVisible({ timeout: 30000 })
  await start.getByRole('button', { name: '+ 새 프로젝트' }).click()
  await start.getByLabel('프로젝트 이름').fill(name)
  await start.getByRole('button', { name: '만들기' }).click()
  await expect(start.getByRole('alert')).toHaveText('이미 있는 이름입니다')
  await start.getByLabel('검색').fill(name)
  await start.getByRole('listitem').filter({ hasText: file }).click()
  await expect(start).toHaveCount(0)
  await expect(page.locator('.mb-title')).toHaveText(file)
  expect(await page.evaluate(() => (window as any).__editor.getState().project.actors.length)).toBe(2)

  // 메뉴 ▸ 열기 / Ctrl+O = the same popup, closable this time
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  await page.getByRole('menuitem', { name: '열기', exact: true }).click()
  await expect(start.getByLabel('프로젝트 이름')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(start).toHaveCount(0)
  await page.keyboard.press('Control+o')
  await start.getByRole('button', { name: '닫기' }).click()
  await expect(start).toHaveCount(0)
})
