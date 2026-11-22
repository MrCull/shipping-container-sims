/**
 * Spec #106 / #115: the bay viewer popup's wiring in the real app. Fixture `rob-bays` (a feeder with 3 ROB bays of 7).
 * A click on the vessel in 3D opens it on the selected vessel, the Colour by menu reaches its key, the close button and
 * (after the inspector button) Escape close it. What the viewer draws (cross-sections, stepping bays, hover, the
 * Discharge plan | Load plan switch, cells going to done, the package list) is the component test
 * `tests/components/bay-viewer.test.ts` (#338). Screenshot: .screenshots/bay-viewer.png.
 * Run with `pnpm run test:smoke --project=dev --grep "bay viewer"`.
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

async function open(page: Page): Promise<void> {
  await openTwin(page, { scenario: 'rob-bays' })
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

/** A viewport point where a click picks the vessel itself (not a box on it, nor a crane). */
async function vesselPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate(
    (vid) => {
      const w = window.innerWidth
      const h = window.innerHeight
      for (let y = 80; y < h - 80; y += 12) for (let x = 20; x < w - 360; x += 12) if (window.__tt!.pickAt(x, y) === vid) return { x, y }
      throw new Error(`no point picks ${vid}`)
    },
    id,
  )
}

const viewer = (page: Page) => page.getByTestId('tt-bay-viewer')

test('bay viewer: a vessel click opens it, the Colour by menu reaches its key, the inspector button and Escape', { tag: '@vessel' }, async ({ page }) => {
  const errors = collectErrors(page)
  await open(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'VesselBerthed' }))
  await expect(viewer(page)).toBeHidden()

  // click the vessel in 3D: the inspector selects it and the viewer opens
  expect(await page.evaluate(() => window.__tt!.cameraTo('V001', 160))).toBe(true)
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  await page.waitForTimeout(400)
  const at = await vesselPoint(page, 'V001')
  await page.mouse.click(at.x, at.y)
  await expect(viewer(page)).toBeVisible()
  await expect(page.getByTestId('tt-bay-heading')).toContainText(/bay \d\d/i)
  await expect(page.getByTestId('tt-entity-heading')).toContainText('V001')
  await expect(page.locator('[data-testid=tt-bay-cell][data-status=planned-discharge]').first()).toBeVisible()

  // the Colour by menu (shared with the 3D view, #130) recolours the viewer: POD keys the ports
  await page.getByTestId('tt-colour-by').click()
  await page.getByTestId('tt-colour-by-select').selectOption('pod')
  await expect(page.getByTestId('tt-bay-legend')).toContainText(/[A-Z]{5}/)
  await page.getByTestId('tt-colour-by').click()
  await page.getByTestId('tt-colour-by-select').selectOption('default')
  await page.evaluate(() => window.__tt!.renderOnce()) // render is off: draw the frame the screenshot keeps
  await page.screenshot({ path: '.screenshots/bay-viewer.png' })

  await page.getByTestId('tt-bay-close').click()
  await expect(viewer(page)).toBeHidden()

  // the inspector's button opens it too, and Escape closes it
  await page.getByTestId('tt-open-bay-viewer').click()
  await expect(viewer(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toBeHidden()
  expect(errors).toEqual([])
})
