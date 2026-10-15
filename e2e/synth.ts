import { expect, type Page } from '@playwright/test'

/** Imports a synthetic 300-frame G1 CSV `<name>.csv` (메뉴 ▸ CSV 가져오기) and waits for its piece; returns the G1 joint names. */
export async function importSynthetic(page: Page, name: string) {
  const joints = await page.evaluate(() => (window as any).__editor.getState().defs.g1.joints.map((j: { name: string }) => j.name) as string[])
  const head = ['frequency(fps)', 'RobotType', 'DOF Number', 'time(ms)', 'position X(m)', 'position Y(m)', 'position Z(m)',
    'quaternion X', 'quaternion Y', 'quaternion Z', 'quaternion W', ...joints].join(',') + ','
  const knee = joints.indexOf('left_knee_joint')
  const csv = Buffer.from([head, ...Array.from({ length: 300 }, (_, i) =>
    [60, 0, 29, Math.round(i * 1000 / 60), (0.01 * i).toFixed(6), '0.000000', '0.790000', '0', '0', '0', '1',
      ...joints.map((_, j) => (0.3 * Math.sin(i / 15 + j) + (j === knee ? 0.6 : 0)).toFixed(6))].join(',') + ',')].join('\n'))
  await page.getByRole('button', { name: '메뉴', exact: true }).click()
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'CSV 가져오기', exact: true }).click()])
  await fc.setFiles([{ name: `${name}.csv`, mimeType: 'text/csv', buffer: csv }])
  await expect.poll(() => page.evaluate(() => (window as any).__editor.getState().project.sequence.tracks.some((t: any) => t.items.length))).toBe(true)
  return joints
}
