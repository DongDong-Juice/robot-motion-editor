import { test, expect, type Page } from '@playwright/test'

// 부위 얹기 1차 (§26): the inspector's 얹은 동작 칸 lays another block's movement on some legs of a piece (state, 해결 buttons, 빨강 =
// 적용 disabled); the bar shows a strip; a piece saved as a 사용자 블록 shows in 라이브러리 › 사용자 블록 (this browser) and goes on a track.
const boot = async (page: Page) => {
  await page.goto('/')
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
}
const piece = (page: Page) => page.evaluate(() => {
  const p = (window as any).__editor.getState().project, t = p.sequence.tracks.find((t: any) => t.kind === 'motion' && t.items.length)
  const it = t.items[0]
  return { actor: t.actorId as string, id: it.id as string, start: it.start as number, len: it.trimOut - it.trimIn, overlays: (it.overlays ?? []) as any[], n: t.items.length as number }
})

test('부위 얹기: lay 손 흔들기 (오른손) on 만세!, its state and strip; a 한계 초과 setting is not applied; 사용자 블록 save → library → track', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await boot(page)

  // 만세! on a new GO2 (라이브러리 › 일어서기_제스처)
  await page.getByRole('tab', { name: '라이브러리' }).click()
  const tree = page.getByRole('tree', { name: '라이브러리' })
  await expect(tree.locator('[data-kind=userdir] .pp-name')).toHaveText('사용자 블록') // always there (empty until one is saved)
  await tree.locator('[data-id="dir:일어서기_제스처"]').click()
  await tree.locator('.pp-row[data-kind=block]').filter({ has: page.locator('.pp-name', { hasText: /^만세!$/ }) }).click()
  await page.locator('.pp-blk').getByRole('button', { name: '추가', exact: true }).click()
  await expect(page.locator('.pp-msg')).toContainText('추가했습니다')
  const p0 = await piece(page)
  await page.evaluate(([a, id, f]) => { const s = (window as any).__editor.getState(); s.selectItem(id); s.select(a); s.setFrame(f) }, [p0.actor, p0.id, p0.start] as const)

  // + 부위 얹기: the source from the library (it goes into 목록 on 적용), 오른앞, 더하기
  const insp = page.locator('.insp'), sec = insp.locator('section.ov')
  await expect(sec.getByRole('heading', { name: '얹은 동작' })).toBeVisible()
  await sec.getByRole('button', { name: '+ 부위 얹기' }).click()
  const src = sec.getByRole('combobox', { name: '원본 블록' })
  const wave = await src.locator('option', { hasText: '손 흔들기 (오른손)' }).first().getAttribute('value')
  await src.selectOption(wave!)
  await expect(sec.getByRole('button', { name: '오른앞', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(sec.getByRole('button', { name: '더하기', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // from the source's first frame it rears up: 오른앞 허벅지 past its range → 빨강, 적용 disabled, the 세기 해결 button
  await expect(sec.locator('.wk-tone').last()).toContainText('한계 초과')
  await expect(sec.locator('.wk-why.bad').first()).toContainText('관절 한계 — 오른앞 허벅지')
  await expect(sec.getByRole('button', { name: '적용', exact: true })).toBeDisabled()
  const fix = sec.getByRole('button', { name: /^세기 \d+%로$/ })
  await expect(fix).toBeVisible()

  // the waving part only (0.83 – 1.83 s, repeated) over the whole 1.02 s piece from 0: 정상 / 주의 → 적용
  await sec.getByRole('spinbutton', { name: '원본 구간 시작' }).fill('0.83')
  await sec.getByRole('spinbutton', { name: '원본 구간 시작' }).press('Enter')
  await sec.getByRole('spinbutton', { name: '원본 구간 끝' }).fill('1.83')
  await sec.getByRole('spinbutton', { name: '원본 구간 끝' }).press('Enter')
  await sec.getByRole('checkbox', { name: '반복' }).check()
  await sec.getByRole('spinbutton', { name: '얹을 길이' }).fill('1')
  await sec.getByRole('spinbutton', { name: '얹을 길이' }).press('Enter')
  await expect(sec.locator('.wk-tone').last()).not.toContainText('한계 초과')
  await sec.getByRole('button', { name: '적용', exact: true }).click()
  await expect(sec.locator('.insp-hint[role=status]')).toContainText('적용했습니다')
  const p1 = await piece(page)
  expect(p1.overlays).toHaveLength(1)
  expect(p1.overlays[0]).toMatchObject({ parts: ['FR'], mode: 'add', srcA: 50, srcB: 110, at: 0, len: 60, loop: true })
  expect(await page.evaluate(id => (window as any).__editor.getState().project.clips[id]?.name, p1.overlays[0].src)).toBe('손 흔들기 (오른손)') // into 목록
  await expect(sec.locator('.ov-row')).toHaveCount(1)
  await expect(sec.locator('.ov-row b')).toHaveText('오른앞')
  await expect(sec.locator('.ov-row .ov-src')).toContainText('손 흔들기 (오른손)')

  // the bar's bottom strip: drawn in the state color (초록 / 주황; 빨강 = not played)
  const strip = await page.evaluate(() => {
    const c = document.querySelector('canvas.seq-canvas') as HTMLCanvasElement, g = c.getContext('2d')!, d = g.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if ((d[i] === 0x3F && d[i + 1] === 0xB9 && d[i + 2] === 0x50) || (d[i] === 0xF0 && d[i + 1] === 0x88 && d[i + 2] === 0x3E)) n++
    return n
  })
  expect(strip).toBeGreaterThan(20)

  // ✕ 빼기 and undo
  await sec.locator('.ov-row').click()
  await sec.getByRole('button', { name: '✕ 빼기' }).click()
  expect((await piece(page)).overlays).toHaveLength(0)
  await page.evaluate(() => (window as any).__editor.getState().undo())
  expect((await piece(page)).overlays).toHaveLength(1)

  // 사용자 블록으로 저장… (the piece's lane, right click): the name prompt → 라이브러리 › 사용자 블록
  const open = page.getByRole('button', { name: /클립 목록$/ }).first()
  if (await open.getAttribute('aria-expanded') !== 'true') await open.evaluate(b => (b as HTMLElement).click()) // (screen-reader button under the canvas)
  const cv = page.locator('.seq-canvas'), cb = (await cv.boundingBox())!
  page.once('dialog', d => d.accept('만세 흔들기'))
  await page.mouse.click(cb.x + 80, cb.y + 24 + 28 + 14, { button: 'right' })
  await expect(page.getByRole('menu', { name: '클립' })).toBeVisible()
  await page.getByRole('menuitem', { name: '사용자 블록으로 저장…' }).click()
  await expect(page.locator('.seq-msg')).toContainText('사용자 블록으로 저장했습니다: 만세 흔들기')

  const user = tree.locator('[data-id="dir:사용자 블록"]')
  if (await user.getAttribute('aria-expanded') !== 'true') await user.click()
  const urow = tree.locator('.pp-row[data-kind=user]')
  await expect(urow).toHaveCount(1)
  await expect(urow.locator('.pp-name')).toHaveText('만세 흔들기')
  await expect(urow.locator('.pp-col-kind')).toHaveText('사용자')
  await urow.click()
  const panel = page.locator('.pp-blk')
  await expect(panel).toContainText('이 브라우저에만 저장됩니다')
  await panel.getByRole('button', { name: '추가', exact: true }).click() // the selected GO2's track end
  await expect(panel.locator('.pp-msg')).toContainText('추가했습니다: 만세 흔들기')
  const after = await piece(page)
  expect(after.n).toBe(2)
  const frozen = await page.evaluate(() => {
    const s = (window as any).__editor.getState(), p = s.project, t = p.sequence.tracks.find((t: any) => t.kind === 'motion' && t.items.length === 2)
    const its = [...t.items].sort((a: any, b: any) => a.start - b.start)
    return { name: p.clips[its[1].refId].name, len: its[1].trimOut - its[1].trimIn, first: its[0].trimOut - its[0].trimIn, ov: its[1].overlays ?? null }
  })
  expect(frozen).toMatchObject({ name: '만세 흔들기', ov: null }) // frozen: the movement is in its frames, no overlay
  expect(frozen.len).toBe(frozen.first)

  // still there after a reload (IndexedDB)
  await page.reload()
  await expect(page.locator('#stage canvas')).toBeVisible({ timeout: 30000 })
  await page.getByRole('tab', { name: '라이브러리' }).click()
  const t2 = page.getByRole('tree', { name: '라이브러리' }), u2 = t2.locator('[data-id="dir:사용자 블록"]')
  await expect(u2.locator('.pp-count')).toHaveText('1')
  expect(errors).toEqual([])
})
