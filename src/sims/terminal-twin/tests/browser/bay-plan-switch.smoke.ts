/**
 * #162: the bay viewer's Load plan | Discharge plan switch. Fixture `two-vessels-compete-for-berth` (two panamax calls,
 * each with discharge and load). The viewer opens on Load (planned-load cells only, plus ROB), the switch shows the
 * Discharge plan (planned-discharge cells only), the choice stays when another vessel is opened, and a new run (Reset)
 * goes back to Load. The state key lists only the plan's statuses plus ROB.
 * Run with `pnpm run test:smoke --project=dev --grep "bay plan switch"`.
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

const viewer = (page: Page) => page.getByTestId('tt-bay-viewer')
const plan = (page: Page) => page.getByTestId('tt-bay-plan')
const cells = (page: Page, status: string) => page.locator(`[data-testid=tt-bay-cell][data-status=${status}]`)

async function openViewer(page: Page, vesselId: string): Promise<void> {
  await page.evaluate((id) => window.__tt!.select(id), vesselId)
  await page.getByTestId('tt-open-bay-viewer').click()
  await expect(viewer(page)).toBeVisible()
  await expect(page.getByTestId('tt-bay-heading')).toContainText(/bay \d\d/i)
}

test('bay plan switch: opens on Load, shows one plan at a time, keeps the choice across vessels, Load again on a new run', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('two-vessels-compete-for-berth'))
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'VesselBerthed' }))

  // default: Load plan, planned-load cells and no planned-discharge cells
  await openViewer(page, 'V001')
  await expect(plan(page)).toHaveAttribute('data-plan', 'load')
  await expect(page.getByTestId('tt-bay-plan-load')).toHaveAttribute('aria-checked', 'true')
  await expect(cells(page, 'planned-load').first()).toBeVisible()
  await expect(cells(page, 'planned-discharge')).toHaveCount(0)
  const legend = page.getByTestId('tt-bay-legend')
  await expect(legend).toContainText('Planned load')
  await expect(legend).toContainText('Loaded')
  await expect(legend).toContainText('Remain on board')
  await expect(legend).not.toContainText('Planned discharge')
  await page.screenshot({ path: '.screenshots/bay-plan-load.png' })

  // Discharge plan: planned-discharge cells, no planned-load cells (the strip follows the plan)
  await page.getByTestId('tt-bay-plan-discharge').click()
  await expect(plan(page)).toHaveAttribute('data-plan', 'discharge')
  await page.locator('[data-testid^=tt-bay-strip-][data-state=idle]').first().click()
  await expect(cells(page, 'planned-discharge').first()).toBeVisible()
  await expect(cells(page, 'planned-load')).toHaveCount(0)
  await expect(legend).toContainText('Planned discharge')
  await expect(legend).toContainText('Discharged')
  await expect(legend).not.toContainText('Planned load')
  await page.screenshot({ path: '.screenshots/bay-plan-discharge.png' })

  // another vessel in the same run keeps the choice
  await page.getByTestId('tt-bay-close').click()
  await expect(viewer(page)).toBeHidden()
  await openViewer(page, 'V002')
  await expect(plan(page)).toHaveAttribute('data-plan', 'discharge')
  await page.getByTestId('tt-bay-close').click()

  // a new run (Reset) starts on Load again
  await page.evaluate(() => window.__tt!.reset())
  await openViewer(page, 'V001')
  await expect(plan(page)).toHaveAttribute('data-plan', 'load')
  expect(errors).toEqual([])
})
