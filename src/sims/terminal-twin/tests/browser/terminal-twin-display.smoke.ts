/**
 * Locale, units and keyboard shortcuts (seam 3: UI + dev API `window.__tt`).
 * Run with `pnpm run test:smoke`.
 */
import { type Page } from '@playwright/test'
import { expect, test } from './twinTest'
import fixture from '../../scenario/fixtures/tracer-1sts-10-boxes.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing
import { openAdvanced, openSetupTab, pickScenario } from './scenarioPicker'
import { openTwin } from './openTwin'

const TRACER = 'tracer-1sts-10-boxes'
// Monday 26 Oct 2026, 13:45 UTC; the browser runs in UTC (timezoneId below).
const START = '2026-10-26T13:45:00.000Z'

test.use({ timezoneId: 'UTC' })
// Fresh page: locale and time zone are browser-context options, which the worker's shared page cannot take per test (#329).
test.use({ fresh: true })

/** Opens the sim and selects the tracer (a fresh load selects the TTI baseline since #156; the expected values are the tracer's). */
async function openSim(page: Page): Promise<void> {
  await openTwin(page)
  await pickScenario(page.getByRole('dialog', { name: /new scenario/i }), TRACER)
}

async function loadTracerAt(page: Page, simT: number): Promise<void> {
  await page.evaluate(([name, start]) => window.__tt!.load(name, { startDateTime: start }), [TRACER, START] as const)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.evaluate((t) => window.__tt!.runTo(t), simT)
}

const clockText = (page: Page) => page.getByTestId('tt-clock').innerText()

test.describe('US browser', () => {
  test.use({ locale: 'en-US' })

  test('defaults to en-US and imperial on first open', { tag: '@shell' }, async ({ page }) => {
    await openSim(page)
    const dialog = page.getByRole('dialog', { name: /new scenario/i })
    await expect(dialog).toBeVisible()
    // #161: locale and units are on the Advanced tab, the summary on the Scenario tab
    await openAdvanced(page)
    await expect(page.getByTestId('tt-locale')).toHaveValue('en-US')
    await expect(page.getByTestId('tt-units-imperial')).toBeChecked()
    await expect(page.getByTestId('tt-display-preview')).toContainText('week starts Sunday')
  })
})

test.describe('German browser', () => {
  test.use({ locale: 'de-DE' })

  test('defaults to de-DE and metric on first open', { tag: '@shell' }, async ({ page }) => {
    await openSim(page)
    await openAdvanced(page)
    await expect(page.getByTestId('tt-locale')).toHaveValue('de-DE')
    await expect(page.getByTestId('tt-units-metric')).toBeChecked()
    // Weekday names are locale-formatted too.
    await expect(page.getByTestId('tt-display-preview')).toContainText('week starts Montag')
  })
})

test.describe('British browser', () => {
  test.use({ locale: 'en-GB' })

  test('units switch the displayed values; the saved config and engine stay SI; the choice persists', { tag: '@shell' }, async ({ page }) => {
    // the summary in each locale and unit system: tests/components/locale-format.test.ts (#338)
    await openSim(page)
    await openAdvanced(page)
    await page.getByTestId('tt-units-imperial').check()
    await page.getByTestId('tt-locale').selectOption('de-DE')
    await openSetupTab(page, 'scenario')
    await expect(page.getByTestId('tt-summary-quay')).toHaveText('1.312 ft')

    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()

    // The config that is stored with the run is SI, with the display settings alongside.
    const config = await page.evaluate(() => window.__tt!.config())
    expect(config!.display).toEqual({ locale: 'de-DE', units: 'imperial' })
    expect(config!.quay.lengthM).toBe(fixture.quay.lengthM)
    expect(config!.kinematics).toEqual(fixture.kinematics)
    const snapshot = await page.evaluate(() => window.__tt!.snapshot())
    expect(snapshot.config.quay.lengthM).toBe(fixture.quay.lengthM)
    expect(snapshot.config.display).toEqual({ locale: 'de-DE', units: 'imperial' })

    // Reopening the sim remembers the choice instead of the browser defaults.
    await page.reload()
    await page.waitForFunction(() => !!window.__tt)
    await openAdvanced(page)
    await expect(page.getByTestId('tt-locale')).toHaveValue('de-DE')
    await expect(page.getByTestId('tt-units-imperial')).toBeChecked()
  })

  test('switching locale changes the clock, date and numbers live', { tag: '@shell' }, async ({ page }) => {
    await openSim(page)
    await loadTracerAt(page, 17 * 60 + 3) // 14:02:03 UTC on Monday 26 Oct 2026 (the tracer ends at ~1169 s)

    await expect(page.getByTestId('tt-clock')).toContainText('26 Oct 2026')
    expect(await clockText(page)).toContain('14:02:03')

    await page.evaluate(() => window.__tt!.setDisplay({ locale: 'en-US' }))
    await expect(page.getByTestId('tt-clock')).toContainText('Oct 26, 2026')
    expect((await clockText(page)).replace(/\s/g, ' ')).toContain('2:02:03 PM')

    // Through the setup dialog: changes apply immediately, also to the clock behind it.
    await page.getByRole('button', { name: 'New Scenario' }).click()
    await openAdvanced(page)
    await page.getByTestId('tt-locale').selectOption('de-DE')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('tt-clock')).toContainText('26.10.2026')
    expect(await clockText(page)).toContain('14:02:03')
    expect(await clockText(page)).toMatch(/^Mo/)
    expect((await page.evaluate(() => window.__tt!.config()))!.display!.locale).toBe('de-DE')

    // Numbers: the completion banner uses locale grouping.
    await page.evaluate(() => window.__tt!.runUntil())
    await expect(page.getByRole('status').filter({ hasText: 'Scenario complete' })).toContainText('10 moves')
  })

  test('Run to… reads and parses in the chosen locale', { tag: '@shell' }, async ({ page }) => {
    await openSim(page)
    await loadTracerAt(page, 17 * 60 + 3) // 14:02:03 UTC; start is Mon 26 Oct 2026 13:45

    // the setup start field in each locale (shows, parses, flags an impossible date): tests/components/locale-format.test.ts (#338)
    await page.evaluate(() => window.__tt!.setDisplay({ locale: 'de-DE' }))

    // Run to…: pre-filled with the chosen locale (de-DE now, seconds shown), parsed the same way.
    await page.getByRole('button', { name: 'Run to…' }).click()
    const runTo = page.getByTestId('tt-run-to-input')
    await expect(runTo).toHaveValue('26.10.2026, 14:12:03')
    await runTo.fill('26.10.2026, 14:03:30')
    await runTo.blur()
    await runTo.press('Enter')
    await expect.poll(async () => (await page.evaluate(() => window.__tt!.clock())).displayTime).toBeCloseTo(18 * 60 + 30, 0)
  })

  // Every key, the help overlay's list and typing in a field: tests/components/shortcuts.test.ts (#338). Here one key
  // reaches the running twin, and the help button opens the overlay.
  test('keyboard shortcuts reach the running twin and the help button opens the shortcut list', { tag: '@shell' }, async ({ page }) => {
    await openSim(page)
    await loadTracerAt(page, 60)
    const clock = () => page.evaluate(() => window.__tt!.clock())
    await page.locator('body').click({ position: { x: 5, y: 300 } }) // focus the page, not a field
    expect((await clock()).paused).toBe(true)
    await page.keyboard.press('Space')
    expect((await clock()).paused).toBe(false)
    // Space with a top-bar button focused toggles once (it does not also click the button).
    await page.getByRole('button', { name: '×10' }).click()
    await page.keyboard.press('Space')
    expect((await clock()).paused).toBe(true)
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await page.getByTestId('tt-help-button').click()
    await expect(help).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(help).toBeHidden()
  })
})
