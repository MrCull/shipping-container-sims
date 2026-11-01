/**
 * TT-16 production-build check: ECharts is a lazy chunk that is not fetched when
 * the sim opens, only when the dashboard first opens (served by `vite preview`).
 */
import { expect, test } from '@playwright/test'
import { pickScenario } from './scenarioPicker'

/** A fresh load selects the TTI baseline (#156); these checks run on the small tracer fixture. */
const TRACER = 'tracer-1sts-10-boxes'

test('ECharts is not in the initial load and is fetched when the dashboard first opens', async ({ page }) => {
  const scripts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(r.url())
  })
  await page.goto('/sim/terminal-twin')
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeVisible()
  await pickScenario(page, TRACER)
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

test('the Dashboard button opens the dashboard with its charts in the production build', async ({ page }) => {
  await page.goto('/sim/terminal-twin')
  await pickScenario(page, TRACER)
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.getByTestId('tt-dashboard-button').click()
  await expect(page.getByTestId('tt-dashboard')).toBeVisible()
  await expect(page.getByTestId('tt-dashboard-charts')).toBeVisible()
  await expect(page.getByTestId('tt-dashboard-gantt').locator('canvas').first()).toBeVisible()
})

test('a failed dashboard chunk load shows an error in the production build', async ({ page }) => {
  await page.goto('/sim/terminal-twin')
  await pickScenario(page, TRACER)
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.route(/DashboardTab/, (route) => route.abort())
  await page.getByTestId('tt-dashboard-button').click()
  await expect(page.getByTestId('tt-dashboard-error')).toBeVisible()
})
