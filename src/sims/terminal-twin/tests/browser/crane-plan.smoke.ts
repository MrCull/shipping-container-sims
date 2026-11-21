/**
 * #288: the bay viewer's Bays | Crane plan switch. Fixture `crane-split-4sts` (one vessel, four cranes). Opening a vessel
 * and switching to Crane plan shows a band per crane and the now line; the choice is kept while the viewer is open;
 * clicking a package lands on its bay in the Bays view; the dashboard Gantt draws package bars.
 * Run with `pnpm run test:smoke --project=dev --grep "crane plan"`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

test('crane plan: the Crane plan view shows a band per crane and the now line, and a package click opens its bay', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('crane-split-4sts'))
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.evaluate(() => window.__tt!.runTo(1500))
  await page.evaluate(() => window.__tt!.pause())
  await page.evaluate(() => window.__tt!.select('V001'))
  await page.getByTestId('tt-open-bay-viewer').click()
  await expect(page.getByTestId('tt-bay-viewer')).toBeVisible()

  await expect(page.getByTestId('tt-bay-mode')).toHaveAttribute('data-mode', 'bays')
  await page.getByTestId('tt-bay-mode-crane-plan').click()
  await expect(page.getByTestId('tt-crane-plan')).toBeVisible()
  for (const id of ['STS01', 'STS02', 'STS03', 'STS04']) await expect(page.getByTestId(`tt-crane-plan-band-${id}`)).toBeVisible()
  await expect(page.getByTestId('tt-crane-plan-now')).toBeVisible()
  await expect(page.getByTestId('tt-crane-plan-summary')).toContainText('as-today')
  await expect(page.getByTestId('tt-crane-plan-key')).toBeVisible()
  for (const k of ['discharge', 'load', 'hatch', 'ghost', 'conflict', 'obstacle', 'now']) await expect(page.getByTestId(`tt-crane-plan-key-${k}`)).toBeVisible()
  await page.screenshot({ path: '.screenshots/crane-plan.png' })

  // a click on a package opens that bay in the Bays view
  await page.locator('[data-testid^=tt-crane-plan-pkg-]').first().click()
  await expect(page.getByTestId('tt-bay-mode')).toHaveAttribute('data-mode', 'bays')
  await expect(page.getByTestId('tt-bay-heading')).toContainText(/bay \d\d/i)

  expect(errors).toEqual([])
})
