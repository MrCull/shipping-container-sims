/**
 * Spec #106 / #115: the bay viewer popup. Fixture `rob-bays` (a feeder with 3 ROB bays of 7, hatch covers on).
 * Click the vessel in 3D (and, separately, use the inspector button), step between bays, hover a cell, see a cell go
 * from planned to in progress to done while the run proceeds. Screenshot: .screenshots/bay-viewer.png.
 * Run with `pnpm run test:smoke --project=dev --grep "bay viewer"`.
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

async function open(page: Page): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('rob-bays'))
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
const heading = (page: Page) => page.getByTestId('tt-bay-heading')

test('bay viewer: opens from a vessel click, steps between bays, shows ROB bays and a cell going planned to done', async ({ page }) => {
  test.slow()
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
  await expect(heading(page)).toContainText(/bay \d\d/i)
  await expect(page.getByTestId('tt-entity-heading')).toContainText('V001')
  // the viewer opens on the Load plan (#162); this test follows a discharge box, so show the Discharge plan and go to
  // the first bay with discharge work (the strip follows the plan)
  await expect(page.getByTestId('tt-bay-plan')).toHaveAttribute('data-plan', 'load')
  await page.getByTestId('tt-bay-plan-discharge').click()
  await page.locator('[data-testid^=tt-bay-strip-][data-state=idle]').first().click()

  // hold and deck cross-sections: 8 rows, 3 deck tiers and 4 hold tiers of cells (some are 20 ft halves)
  // two panels side by side: the 20 ft (odd) bays either side of the 40 ft bay, e.g. 01 and 03 under 02
  const fore = page.getByTestId('tt-bay-panel-fore')
  const aft = page.getByTestId('tt-bay-panel-aft')
  const deck = fore.getByTestId('tt-bay-deck')
  const hold = fore.getByTestId('tt-bay-hold')
  await expect(deck.locator('.tier')).toHaveCount(3)
  await expect(hold.locator('.tier')).toHaveCount(4)
  await expect(deck.locator('.tier').first().locator('.pos')).toHaveCount(8)
  await expect(aft.getByTestId('tt-bay-deck').locator('.tier').first().locator('.pos')).toHaveCount(8)
  const evenBay = Number((await heading(page).textContent())!.match(/bay (\d\d)/i)![1])
  expect(Number(await fore.getAttribute('data-bay-number'))).toBe(evenBay - 1)
  expect(Number(await aft.getAttribute('data-bay-number'))).toBe(evenBay + 1)
  await expect(fore.getByTestId('tt-bay-panel-title')).toHaveText(`Bay ${String(evenBay - 1).padStart(2, '0')}`)

  // opens on a bay with work: planned discharge and planned load cells
  const planned = page.locator('[data-testid=tt-bay-cell][data-status=planned-discharge]:not([data-continuation])')
  await expect(planned.first()).toBeVisible()
  // a 40 ft box spans both panels: its second half is a hatched continuation labelled "40′ ▸" in the aft panel
  const continuation = aft.locator('[data-testid=tt-bay-cell][data-continuation=true]')
  expect(await continuation.count()).toBeGreaterThan(0)
  await expect(continuation.first()).toHaveText('40′ ▸')
  expect(await fore.locator('[data-continuation=true]').count()).toBe(0)
  const bay0 = (await heading(page).textContent())!
  const slot = (await planned.first().getAttribute('data-slot'))!

  // hover shows the box's properties in the maritime notation
  await planned.first().hover()
  const tip = page.getByTestId('tt-bay-tooltip')
  await expect(tip).toBeVisible()
  await expect(tip).toContainText(/VESSEL\.V01\.\d\d\.\d\d\.\d\d/)
  await expect(tip).toContainText('Port of discharge (POD)')
  await expect(tip).toContainText('Planned discharge')
  await page.mouse.move(5, 5)

  // step to the neighbouring bays with the buttons and the strip
  const prev = page.getByTestId('tt-bay-prev')
  const next = page.getByTestId('tt-bay-next')
  const strip = page.getByTestId('tt-bay-strip').locator('button')
  expect(await strip.count()).toBe(7)
  const robStrip = page.locator('[data-testid^=tt-bay-strip-][data-state=rob]')
  expect(await robStrip.count()).toBe(3)
  await next.click()
  await expect(heading(page)).not.toHaveText(bay0)
  await prev.click()
  await expect(heading(page)).toHaveText(bay0)
  // the bow end has no previous bay
  await strip.first().click()
  await expect(prev).toBeDisabled()
  await strip.last().click()
  await expect(next).toBeDisabled()

  // a ROB bay: ROB cells only, no work packages
  await robStrip.first().click()
  await expect(page.getByTestId('tt-bay-rob-note')).toBeVisible()
  expect(await page.locator('[data-testid=tt-bay-cell][data-status=rob]').count()).toBeGreaterThan(10)
  expect(await page.locator('[data-testid=tt-bay-cell][data-rob=true]').count()).toBeGreaterThan(10)
  await expect(page.locator('[data-testid=tt-bay-cell][data-status=planned-discharge]')).toHaveCount(0)
  await expect(page.getByTestId('tt-bay-packages')).toBeHidden()

  // colour modes: POD colours the cells by port, and the key lists the ports
  // (the mode is the Colour by menu's, shared with the 3D view: #130)
  await page.getByTestId('tt-colour-by').click()
  await page.getByTestId('tt-colour-by-select').selectOption('pod')
  await expect(page.getByTestId('tt-bay-legend')).toContainText(/[A-Z]{5}/)
  await page.getByTestId('tt-colour-by-select').selectOption('default')
  await page.getByTestId('tt-colour-by').click()

  // back to the bay with work: the cell goes planned -> in progress -> done as the run proceeds
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'StsPicked' }))
  const cell = page.locator(`[data-testid=tt-bay-cell][data-slot="${slot}"]:not([data-continuation])`)
  // find the bay of the slot: walk the strip until the cell is on show
  const entries = await strip.count()
  for (let i = 0; i < entries && (await cell.count()) === 0; i++) await strip.nth(i).click()
  await expect(cell).toHaveCount(1)
  await page.screenshot({ path: '.screenshots/bay-viewer.png' })
  await page.evaluate(() => window.__tt!.runUntil({ vesselsCompleted: 1 }))
  // the viewer refreshes by itself while open
  await expect(cell).toHaveAttribute('data-status', 'done', { timeout: 10_000 })
  await expect(page.locator('[data-testid=tt-bay-cell][data-status=planned-discharge]')).toHaveCount(0)
  await expect(page.locator('[data-testid=tt-bay-cell][data-status=planned-load]')).toHaveCount(0)

  // close it
  await page.getByTestId('tt-bay-close').click()
  await expect(viewer(page)).toBeHidden()
  expect(errors).toEqual([])
})

test('bay viewer: the inspector opens it, the work package list follows the run, Escape closes it', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await open(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'StsPicked' })) // the crane has its packages once it starts work
  await page.evaluate(() => window.__tt!.select('V001'))
  await page.getByTestId('tt-open-bay-viewer').click()
  await expect(viewer(page)).toBeVisible()

  // the packages of the bay: states move on as the run goes (planned or released at first, complete at the end)
  const packages = page.getByTestId('tt-bay-packages').locator('.pkg')
  await expect(packages.first()).toBeVisible()
  const before = await packages.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.status))
  expect(before.every((s) => s !== 'complete')).toBe(true)
  await page.evaluate(() => window.__tt!.runUntil({ vesselsCompleted: 1 }))
  await expect.poll(async () => (await packages.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.status))).every((s) => s === 'complete'), { timeout: 10_000 }).toBe(true)

  await page.keyboard.press('Escape')
  await expect(viewer(page)).toBeHidden()
  expect(errors).toEqual([])
})
