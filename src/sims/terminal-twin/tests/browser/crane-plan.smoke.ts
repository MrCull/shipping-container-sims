/**
 * #288: the bay viewer's Bays | Crane plan switch in the real app. Fixture `crane-split-4sts` (one vessel, four cranes).
 * Switching to Crane plan shows the chart with the key beside it in a wide panel; the floating panel drags and resizes
 * and remembers its geometry; a package click lands on its bay. What the chart draws (a band per crane, the now line,
 * the key and labels, hover dimming) is the component test `tests/components/crane-plan-view.test.ts` (#338).
 * Run with `pnpm run test:smoke --project=dev --grep "crane plan"`.
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

test('crane plan: the Crane plan view opens beside its key, drags and resizes, and a package click opens its bay', { tag: '@vessel' }, async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await page.setViewportSize({ width: 1500, height: 960 })
  await openTwin(page, { scenario: 'crane-split-4sts' })
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.evaluate(() => window.__tt!.runTo(1500))
  await page.evaluate(() => window.__tt!.pause())
  await page.evaluate(() => window.__tt!.select('V001'))
  await page.getByTestId('tt-open-bay-viewer').click()
  await expect(page.getByTestId('tt-bay-viewer')).toBeVisible()

  await expect(page.getByTestId('tt-bay-mode')).toHaveAttribute('data-mode', 'bays')
  await page.getByTestId('tt-bay-mode-crane-plan').click()
  await expect(page.getByTestId('tt-crane-plan')).toBeVisible()
  // the bands, now line, key and labels, the hover dimming and the package click: tests/components/crane-plan-view.test.ts (#338)
  await expect(page.getByTestId('tt-crane-plan-band-STS01')).toBeVisible()
  // wide panel: the key sits right of the chart, not under it
  const chartBox = await page.locator('.crane-plan .scroll').boundingBox()
  const keyBox = await page.getByTestId('tt-crane-plan-key').boundingBox()
  expect(keyBox!.x).toBeGreaterThanOrEqual(chartBox!.x + chartBox!.width - 2)
  await page.evaluate(() => window.__tt!.renderOnce()) // render is off: draw the frame the screenshot keeps
  await page.screenshot({ path: '.screenshots/crane-plan.png' })
  // drag the header, resize from the corner, and the geometry is remembered
  const viewer = page.getByTestId('tt-bay-viewer')
  const before = await viewer.boundingBox()
  const head = (await page.getByTestId('tt-bay-head').boundingBox())!
  await page.mouse.move(head.x + 150, head.y + 10)
  await page.mouse.down()
  await page.mouse.move(head.x + 250, head.y + 60, { steps: 5 })
  await page.mouse.up()
  const moved = await viewer.boundingBox()
  expect(moved!.x).toBeGreaterThan(before!.x + 50)
  expect(moved!.y).toBeGreaterThan(before!.y + 30)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tt.cranePlan.panel') ?? 'null'))
  expect(stored).toMatchObject({ left: expect.any(Number), top: expect.any(Number) })
  // resize from the corner handle
  const box = (await viewer.boundingBox())!
  const grip = (await page.getByTestId('tt-bay-resize').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width + 120, box.y + box.height + 80, { steps: 5 })
  await page.mouse.up()
  const grown = await viewer.boundingBox()
  expect(grown!.width).toBeGreaterThan(box.width + 60)
  expect(grown!.height).toBeGreaterThan(box.height + 40)
  const stored2 = await page.evaluate(() => JSON.parse(localStorage.getItem('tt.cranePlan.panel') ?? 'null'))
  expect(stored2.width).toBeGreaterThan(box.width + 60)

  // a click on a package opens that bay in the Bays view
  await page.locator('[data-testid^=tt-crane-plan-pkg-]').first().click()
  await expect(page.getByTestId('tt-bay-mode')).toHaveAttribute('data-mode', 'bays')
  await expect(page.getByTestId('tt-bay-heading')).toContainText(/bay \d\d/i)

  expect(errors).toEqual([])
})
