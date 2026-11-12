/** Even playback pacing (#251): the top bar shows the achieved speed when the engine cannot supply the chosen one. */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

test('at the top speed on the TTI preset the achieved speed shows next to the chosen one and the clock keeps moving', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('TTI Algeciras baseline'))
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.getByRole('button', { name: '×3600', exact: true }).click()
  const readout = page.getByTestId('tt-achieved-speed')
  await expect(readout).toBeVisible({ timeout: 120_000 })
  const clock = await page.evaluate(() => window.__tt!.clock())
  expect(clock.speed).toBe(3600)
  expect(clock.achievedSpeed).toBeLessThan(3600 * 0.9)
  expect(clock.achievedSpeed).toBeGreaterThan(0)
  await expect(readout).toContainText('×')
  // presence and ratios only: the display never passes the engine horizon and keeps advancing
  const t0 = (await page.evaluate(() => window.__tt!.clock())).displayTime
  await page.waitForTimeout(3000)
  const after = await page.evaluate(() => window.__tt!.clock())
  expect(after.displayTime).toBeGreaterThan(t0)
  expect(after.displayTime).toBeLessThanOrEqual(after.engine!.now)
  // pausing hides the readout on the next frame
  await page.evaluate(() => window.__tt!.pause())
  await expect(readout).toBeHidden()
})
