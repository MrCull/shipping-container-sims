/**
 * #288: the bay viewer's Bays | Crane plan switch. Fixture `crane-split-4sts` (one vessel, four cranes). Opening a vessel
 * and switching to Crane plan shows a band per crane and the now line; the choice is kept while the viewer is open;
 * clicking a package lands on its bay in the Bays view; the dashboard Gantt draws package bars.
 * Run with `pnpm run test:smoke --project=dev --grep "crane plan"`.
 */
import { expect, test, type Page } from '@playwright/test'
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

test('crane plan: the Crane plan view shows a band per crane and the now line, and a package click opens its bay', { tag: '@vessel' }, async ({ page }) => {
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
  for (const id of ['STS01', 'STS02', 'STS03', 'STS04']) await expect(page.getByTestId(`tt-crane-plan-band-${id}`)).toBeVisible()
  await expect(page.getByTestId('tt-crane-plan-now')).toBeVisible()
  await expect(page.getByTestId('tt-crane-plan-summary')).toContainText('as-today')
  await expect(page.getByTestId('tt-crane-plan-key')).toBeVisible()
  for (const k of ['discharge', 'load', 'hatch', 'ghost', 'conflict', 'obstacle', 'now']) await expect(page.getByTestId(`tt-crane-plan-key-${k}`)).toBeVisible()
  // every bay column names its crane; hovering a crane in the key dims the other cranes' packages
  const colSts = await page.locator('[data-testid^=tt-crane-plan-col-]').first().getAttribute('data-sts')
  expect(colSts).toMatch(/^STS\d+$/)
  await expect(page.getByTestId('tt-crane-plan-key-crane-STS01')).toBeVisible()
  await page.getByTestId('tt-crane-plan-key-crane-STS01').hover()
  await expect(page.locator('[data-testid^=tt-crane-plan-pkg-][data-sts=STS02]').first()).toHaveClass(/dim/)
  await expect(page.locator('[data-testid^=tt-crane-plan-pkg-][data-sts=STS01]').first()).not.toHaveClass(/dim/)
  await page.mouse.move(0, 0)
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
