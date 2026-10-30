/**
 * V11-02 browser smoke test: the HUD is a set of named regions that never overlap (1280x720 and 1920x1080, every
 * preset, Events and Inspector panels open or closed) and every KPI card is fully visible. Driven by the dev-only
 * `window.__tt.hudLayout()` query. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import { overlappingRegions } from '../../modules/hudLayout'
import type {} from '../../dev/devApi' // window.__tt typing

const PRESETS = ['TTI Algeciras baseline', 'Small automated', 'TTI Algeciras — peak day']
// The tight 1280x720 layout is checked on every preset; 1920x1080 only on the small one (software WebGL makes the
// big presets at that size take minutes, and the extra room cannot cause an overlap the small viewport does not).
const CASES = [
  ...PRESETS.map((preset) => ({ preset, viewport: { width: 1280, height: 720 } })),
  { preset: 'Small automated', viewport: { width: 1920, height: 1080 } },
]

async function open(page: Page, preset: string): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), preset)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.evaluate(() => window.__tt!.runUntil({ maxEvents: 300 }))
  await expect(page.getByTestId('tt-kpi-strip')).toBeVisible()
}

async function setPanels(page: Page, feed: boolean, inspector: boolean): Promise<void> {
  const ui = await page.evaluate(() => window.__tt!.ui())
  if (ui.feedOpen !== feed) await page.getByTestId('tt-feed-toggle').click()
  if (ui.inspectorOpen !== inspector) await page.getByTestId('tt-inspector-toggle').click()
  await expect.poll(async () => (await page.evaluate(() => window.__tt!.ui())).feedOpen, { timeout: 20_000 }).toBe(feed)
  await expect.poll(async () => (await page.evaluate(() => window.__tt!.ui())).inspectorOpen, { timeout: 20_000 }).toBe(inspector)
}

for (const { preset, viewport } of CASES) {
  test(`no two HUD regions overlap: ${preset} at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.slow() // software WebGL at 1920x1080 on the big presets renders a frame in seconds on a loaded runner
    await page.setViewportSize(viewport)
    await open(page, preset)
    for (const [feed, inspector] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      await setPanels(page, feed, inspector)
      const layout = await page.evaluate(() => window.__tt!.hudLayout())
      expect(layout.regions.topBar, 'top bar').not.toBeNull()
      expect(layout.regions.settings, 'settings').not.toBeNull()
      expect(layout.regions.kpiStrip, 'KPI strip').not.toBeNull()
      expect(layout.regions.overlayBar, 'overlay bar').not.toBeNull()
      expect(overlappingRegions(layout), `panels feed=${feed} inspector=${inspector}`).toEqual([])
    }
  })
}

test('every KPI card shows its label and value in full at 1280x720, with both panels open', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await open(page, 'TTI Algeciras baseline')
  await setPanels(page, true, true)
  const cards = await page.getByTestId('tt-kpi-strip').locator('li').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      const parts = Array.from(el.querySelectorAll('span')).map((s) => ({ clipped: s.scrollWidth > s.clientWidth + 1 }))
      return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, parts, text: el.textContent ?? '' }
    }),
  )
  const layout = await page.evaluate(() => window.__tt!.hudLayout())
  const strip = layout.regions.kpiStrip!
  expect(cards.length).toBeGreaterThan(4)
  for (const c of cards) {
    expect(c.x, c.text).toBeGreaterThanOrEqual(strip.x - 1)
    expect(c.right, c.text).toBeLessThanOrEqual(strip.x + strip.width + 1)
    expect(c.bottom, c.text).toBeLessThanOrEqual(strip.y + strip.height + 1)
    expect(c.parts.every((p) => !p.clipped), c.text).toBe(true)
  }
})

test('KPI values keep a fixed minimum width and tabular figures so the strip does not shift', async ({ page }) => {
  await open(page, 'TTI Algeciras baseline')
  const values = await page.getByTestId('tt-kpi-strip').locator('.value').evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el)
      return { min: parseFloat(cs.minWidth), width: el.getBoundingClientRect().width, tabular: cs.fontVariantNumeric.includes('tabular-nums') }
    }),
  )
  expect(values.length).toBeGreaterThan(3)
  for (const v of values) {
    expect(v.min).toBeGreaterThan(30)
    expect(v.width).toBeGreaterThanOrEqual(v.min - 1)
    expect(v.tabular).toBe(true)
  }
})

test('the Quality control sits in the settings region beside Daylight and Sound', async ({ page }) => {
  await open(page, 'Small automated')
  const settings = page.locator('[data-hud-region="settings"]')
  await expect(settings.getByTestId('tt-daylight-toggle')).toBeVisible()
  await expect(settings.getByTestId('tt-sound-toggle')).toBeVisible()
  await expect(settings.getByTestId('tt-quality-auto')).toBeVisible()
  await expect(settings.getByTestId('tt-perf-toggle')).toBeVisible()
})

test('the sim header reads Menu once', async ({ page }) => {
  await open(page, 'Small automated')
  const back = page.locator('.sim-header .back-btn')
  await expect(back).toHaveText(/^\s*<?\s*MENU\s*$/i)
})
