/**
 * #162: the bay viewer's Discharge plan | Load plan switch. Fixture `rob-bays` (it has a yard, so the Load plan has
 * planned-load cells: V001 discharges 16 and loads 6, V002 loads 4; the ROB bays are drawn too). The viewer opens on
 * Discharge (planned-discharge cells only, plus ROB), the switch shows the Load plan (planned-load cells only), the
 * choice stays when another vessel is opened, and a new run (Reset) goes back to Discharge. The state key lists only the
 * plan's statuses plus ROB.
 * Run with `pnpm run test:smoke --project=dev --grep "bay plan switch"`.
 */
import { type Page } from '@playwright/test'
import { expect, test } from './twinTest'
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'

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

test('bay plan switch: opens on Discharge, shows one plan at a time, keeps the choice across vessels, Discharge again on a new run', { tag: '@vessel' }, async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await openTwin(page, { scenario: 'rob-bays' })
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'VesselBerthed' }))

  // default: Discharge plan (first in the switch), planned-discharge cells and no planned-load cells
  await openViewer(page, 'V001')
  await expect(plan(page)).toHaveAttribute('data-plan', 'discharge')
  await expect(page.getByTestId('tt-bay-plan-discharge')).toHaveAttribute('aria-checked', 'true')
  await expect(plan(page).getByRole('radio').first()).toHaveAttribute('data-testid', 'tt-bay-plan-discharge')
  await expect(cells(page, 'planned-discharge').first()).toBeVisible()
  await expect(cells(page, 'planned-load')).toHaveCount(0)
  // each plan's button ends with the boxes still to move over the whole vessel (V001 at berthing: 16 to discharge, 6 to
  // load; the run may have moved a box since, so match the shape and an upper bound)
  const count = async (p: string): Promise<number> => Number((await page.getByTestId(`tt-bay-plan-count-${p}`).innerText()).replace(/[()]/g, ''))
  await expect(page.getByTestId('tt-bay-plan-discharge')).toHaveText(/^Discharge plan \(\d+\)$/)
  await expect(page.getByTestId('tt-bay-plan-load')).toHaveText(/^Load plan \(\d+\)$/)
  expect(await count('discharge')).toBeGreaterThan(0)
  expect(await count('discharge')).toBeLessThanOrEqual(16)
  expect(await count('load')).toBeLessThanOrEqual(6)
  const legend = page.getByTestId('tt-bay-legend')
  await expect(legend).toContainText('Planned discharge')
  await expect(legend).toContainText('Discharged')
  await expect(legend).toContainText('Remain on board')
  await expect(legend).not.toContainText('Planned load')
  await page.evaluate(() => window.__tt!.renderOnce()) // render is off: draw the frame the screenshot keeps
  await page.screenshot({ path: '.screenshots/bay-plan-discharge.png' })

  // Load plan: planned-load cells, no planned-discharge cells (the strip follows the plan)
  await page.getByTestId('tt-bay-plan-load').click()
  await expect(plan(page)).toHaveAttribute('data-plan', 'load')
  await page.locator('[data-testid^=tt-bay-strip-][data-state=idle]').first().click()
  await expect(cells(page, 'planned-load').first()).toBeVisible()
  await expect(cells(page, 'planned-discharge')).toHaveCount(0)
  await expect(legend).toContainText('Planned load')
  await expect(legend).toContainText('Loaded')
  await expect(legend).not.toContainText('Planned discharge')
  await page.evaluate(() => window.__tt!.renderOnce()) // render is off: draw the frame the screenshot keeps
  await page.screenshot({ path: '.screenshots/bay-plan-load.png' })

  // another vessel in the same run keeps the choice
  await page.getByTestId('tt-bay-close').click()
  await expect(viewer(page)).toBeHidden()
  await openViewer(page, 'V002')
  await expect(plan(page)).toHaveAttribute('data-plan', 'load')
  await page.getByTestId('tt-bay-close').click()

  // a new run (Reset) starts on Discharge again
  await page.evaluate(() => window.__tt!.reset())
  await openViewer(page, 'V001')
  await expect(plan(page)).toHaveAttribute('data-plan', 'discharge')
  expect(errors).toEqual([])
})
