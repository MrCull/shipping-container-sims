/**
 * TT-16 production-build check: ECharts is a lazy chunk that is not fetched when
 * the sim opens, only when the dashboard first opens (served by `vite preview`).
 */
import { expect, test } from '@playwright/test'

test('ECharts is not in the initial load and is fetched when the dashboard first opens', async ({ page }) => {
  const scripts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(r.url())
  })
  await page.goto('/sim/terminal-twin')
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeVisible()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.waitForTimeout(800)
  expect(scripts.filter((u) => /chartLib|echarts|DashboardTab/i.test(u))).toEqual([])

  await page.keyboard.press('b')
  await expect(page.getByTestId('tt-dashboard')).toBeVisible()
  await expect.poll(() => scripts.some((u) => /chartLib/i.test(u))).toBe(true)
  // none of the initially loaded scripts contain the library
  const initial = scripts.filter((u) => !/chartLib|DashboardTab/i.test(u))
  for (const url of initial) {
    const body = await (await page.request.get(url)).text()
    expect(body, url).not.toContain('echarts')
  }
})
