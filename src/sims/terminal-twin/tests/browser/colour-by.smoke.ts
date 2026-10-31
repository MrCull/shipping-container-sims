/**
 * Spec #116 / #130: the Colour by menu and Hide ROB. Fixture `rob-bays` (a feeder with 3 ROB bays of 7).
 * The mode is changed through the menu: the 3D boxes (`sceneState().liveries[id].tint`) and the bay viewer cells change
 * colour, the legend follows. Hide ROB removes the ROB boxes from the vessel in 3D but not from the bay viewer. The
 * mode survives a reload. The last test (`@load`, never in CI) checks that switching modes on the full TTI yard does not
 * cost frame time. Screenshot: .screenshots/colour-by.png.
 * Run with `pnpm run test:smoke --project=dev --grep "colour by"`.
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

async function open(page: Page, scenario = 'rob-bays'): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), scenario)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
}

const select = (page: Page) => page.getByTestId('tt-colour-by-select')

async function openMenu(page: Page): Promise<void> {
  if (!(await page.getByTestId('tt-colour-by-panel').isVisible())) await page.getByTestId('tt-colour-by').click()
  await expect(page.getByTestId('tt-colour-by-panel')).toBeVisible()
}

async function setMode(page: Page, mode: string): Promise<void> {
  await openMenu(page)
  await select(page).selectOption(mode)
  await expect(page.getByTestId('tt-colour-by-legend')).toHaveAttribute('data-mode', mode)
}

/** The tints drawn this frame, per container (-1 = livery). */
async function tints(page: Page): Promise<Record<string, number>> {
  const frames = await page.evaluate(() => window.__tt!.scene()!.frames)
  await page.waitForFunction((f) => window.__tt!.scene()!.frames > f + 2, frames)
  return page.evaluate(() => Object.fromEntries(Object.entries(window.__tt!.sceneState()!.liveries).map(([id, l]) => [id, l.tint])))
}

test('colour by: the menu recolours the 3D boxes and the bay viewer, with a legend', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await open(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'VesselBerthed' }))

  // default: line livery, no tint
  const before = await tints(page)
  expect(Object.keys(before).length).toBeGreaterThan(10)
  expect(Object.values(before).every((v) => v === -1)).toBe(true)

  await openMenu(page)
  await expect(select(page)).toHaveValue('default')
  await expect(page.getByTestId('tt-colour-by-legend').locator('li').first()).toBeVisible()

  // POD: boxes take one colour per port, the legend lists the ports
  await setMode(page, 'pod')
  await expect.poll(async () => new Set(Object.values(await tints(page)).filter((v) => v >= 0)).size).toBeGreaterThan(1)
  await expect(page.getByTestId('tt-colour-by-legend')).toContainText(/[A-Z]{5}/)
  const pod = await tints(page)
  expect(Object.values(pod).every((v) => v >= 0)).toBe(true)

  // weight class: another set of colours for the same boxes
  await setMode(page, 'weight')
  await expect.poll(async () => JSON.stringify(await tints(page))).not.toBe(JSON.stringify(pod))
  await expect(page.getByTestId('tt-colour-by-legend')).toContainText('Heavy')

  // the bay viewer uses the same mode and legend
  await page.evaluate(() => window.__tt!.select('V001'))
  await page.getByTestId('tt-open-bay-viewer').click()
  await expect(page.getByTestId('tt-bay-viewer')).toBeVisible()
  await expect(page.getByTestId('tt-bay-colour-mode')).toContainText('Weight class')
  const cells = page.locator('[data-testid=tt-bay-cell]:not([data-continuation])[data-key]:not([data-key=""])')
  await expect(cells.first()).toBeVisible()
  const keys = new Set(await cells.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key)))
  expect([...keys].every((k) => ['LIGHT', 'MEDIUM', 'HEAVY'].includes(k!))).toBe(true)
  const fill = (key: string) =>
    page.locator(`[data-testid=tt-bay-cell][data-key=${key}]:not([data-continuation])`).first().evaluate((e) => getComputedStyle(e).backgroundColor)
  const weights = [...keys] as string[]
  expect(weights.length).toBeGreaterThan(0)
  const fills = await Promise.all(weights.map((k) => fill(k)))
  expect(new Set(fills).size).toBe(fills.length) // one fill per class
  await expect(page.getByTestId('tt-bay-legend')).toContainText('Heavy')

  // changing the mode in the menu recolours the viewer: POD cells carry ports
  await setMode(page, 'pod')
  await expect(page.getByTestId('tt-bay-colour-mode')).toContainText('POD')
  await expect.poll(async () => (await cells.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key))).some((k) => /^[A-Z]{5}$/.test(k ?? ''))).toBe(true)
  await page.screenshot({ path: '.screenshots/colour-by.png' })

  // default again: the bay viewer shows the state of each cell and 3D goes back to the livery
  await setMode(page, 'default')
  await expect(page.getByTestId('tt-bay-colour-mode')).toContainText('State')
  await expect.poll(async () => Object.values(await tints(page)).every((v) => v === -1)).toBe(true)
  expect(errors).toEqual([])
})

test('colour by: time-based modes follow the sim clock', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await open(page)
  await setMode(page, 'transit')
  await expect.poll(async () => Object.values(await tints(page)).some((v) => v >= 0)).toBe(true)
  const early = await tints(page)
  await page.evaluate(() => window.__tt!.runUntil({ vesselsCompleted: 1 }))
  await expect.poll(async () => JSON.stringify(await tints(page))).not.toBe(JSON.stringify(early))
  expect(errors).toEqual([])
})

test('colour by: Hide ROB removes the ROB boxes from the vessel in 3D and keeps them, hatched, in the bay viewer', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await open(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'VesselBerthed' }))
  const hull = () => page.evaluate(() => window.__tt!.sceneState()!.vesselHulls.V001)
  expect((await hull()).robBoxes).toBeGreaterThan(30)

  await page.evaluate(() => window.__tt!.select('V001'))
  await page.getByTestId('tt-open-bay-viewer').click()
  await expect(page.getByTestId('tt-bay-viewer')).toBeVisible()
  await page.locator('[data-testid^=tt-bay-strip-][data-state=rob]').first().click()
  const robCells = page.locator('[data-testid=tt-bay-cell][data-status=rob]')
  const shown = await robCells.count()
  expect(shown).toBeGreaterThan(10)

  await openMenu(page)
  await page.getByTestId('tt-hide-rob').check()
  await expect.poll(async () => (await hull()).robBoxes).toBe(0)
  expect((await hull()).robHidden).toBe(true)
  // the bay viewer keeps them
  await expect(robCells).toHaveCount(shown)
  expect(await robCells.first().evaluate((e) => getComputedStyle(e).backgroundImage)).toContain('repeating-linear-gradient')

  await page.getByTestId('tt-hide-rob').uncheck()
  await expect.poll(async () => (await hull()).robBoxes).toBeGreaterThan(30)
  expect(errors).toEqual([])
})

test('colour by: the mode and Hide ROB survive a reload', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await open(page)
  await setMode(page, 'flow')
  await page.getByTestId('tt-hide-rob').check()
  await page.reload()
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('rob-bays'))
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  await openMenu(page)
  await expect(select(page)).toHaveValue('flow')
  await expect(page.getByTestId('tt-hide-rob')).toBeChecked()
  await expect.poll(async () => Object.values(await tints(page)).some((v) => v >= 0)).toBe(true)
  expect(errors).toEqual([])
})

test('colour by: switching modes on the full TTI yard costs no frame time @load', async ({ page }) => {
  test.setTimeout(900_000)
  const errors = collectErrors(page)
  await open(page, 'TTI Algeciras baseline')
  await page.evaluate(() => window.__tt!.setQuality('high'))
  await page.waitForFunction(() => (window.__tt!.scene()?.containers ?? 0) > 10_000, undefined, { timeout: 120_000 })
  await page.waitForFunction(() => window.__tt!.scene()!.containerAssets === 'loaded', undefined, { timeout: 60_000 })
  await page.evaluate(() => window.__tt!.cameraTo('STS104', 400))
  const pose = async (): Promise<number> => {
    const frames = await page.evaluate(() => window.__tt!.scene()!.frames)
    await page.waitForFunction((f) => window.__tt!.scene()!.frames > f + 15, frames, { timeout: 420_000 })
    return page.evaluate(() => window.__tt!.perf().stats.poseMs)
  }
  const base = await pose()
  const cost: Record<string, number> = {}
  for (const mode of ['line', 'pod', 'weight', 'iso', 'special', 'flow', 'dwell', 'departure', 'transit', 'call']) {
    await setMode(page, mode)
    cost[mode] = await pose()
    // Ratios, not absolutes: a coloured frame poses within 1.5 x the livery frame (plus 3 ms of noise).
    expect(cost[mode], `${mode} ${JSON.stringify(cost)} base ${base}`).toBeLessThan(base * 1.5 + 3)
  }
  test.info().annotations.push({ type: 'pose-ms', description: JSON.stringify({ base, ...cost }) })
  expect(errors).toEqual([])
})
