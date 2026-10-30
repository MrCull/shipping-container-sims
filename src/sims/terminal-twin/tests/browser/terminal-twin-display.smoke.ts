/**
 * Locale, units and keyboard shortcuts (seam 3: UI + dev API `window.__tt`).
 * Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import fixture from '../../scenario/fixtures/tracer-1sts-10-boxes.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing
import { openAdvanced } from './scenarioPicker'

const TRACER = 'tracer-1sts-10-boxes'
// Monday 26 Oct 2026, 13:45 UTC; the browser runs in UTC (timezoneId below).
const START = '2026-10-26T13:45:00.000Z'

test.use({ timezoneId: 'UTC' })

async function openSim(page: Page): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
}

async function loadTracerAt(page: Page, simT: number): Promise<void> {
  await page.evaluate(([name, start]) => window.__tt!.load(name, { startDateTime: start }), [TRACER, START] as const)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.evaluate((t) => window.__tt!.runTo(t), simT)
}

const clockText = (page: Page) => page.getByTestId('tt-clock').innerText()

test.describe('US browser', () => {
  test.use({ locale: 'en-US' })

  test('defaults to en-US and imperial on first open; the summary shows ft and mi/h', async ({ page }) => {
    await openSim(page)
    const dialog = page.getByRole('dialog', { name: /new scenario/i })
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('tt-locale')).toHaveValue('en-US')
    await expect(page.getByTestId('tt-units-imperial')).toBeChecked()
    await expect(page.getByTestId('tt-summary-quay')).toHaveText('1,312 ft')
    await expect(page.getByTestId('tt-summary-trolley')).toHaveText('8.9 mi/h')
    await expect(page.getByTestId('tt-display-preview')).toContainText('week starts Sunday')
  })
})

test.describe('German browser', () => {
  test.use({ locale: 'de-DE' })

  test('defaults to de-DE and metric on first open', async ({ page }) => {
    await openSim(page)
    await expect(page.getByTestId('tt-locale')).toHaveValue('de-DE')
    await expect(page.getByTestId('tt-units-metric')).toBeChecked()
    await expect(page.getByTestId('tt-summary-quay')).toHaveText('400 m')
    await expect(page.getByTestId('tt-summary-trolley')).toHaveText('14,4 km/h')
    // Weekday names are locale-formatted too.
    await expect(page.getByTestId('tt-display-preview')).toContainText('week starts Montag')
  })
})

test.describe('British browser', () => {
  test.use({ locale: 'en-GB' })

  test('units switch the displayed values; the saved config and engine stay SI; the choice persists', async ({ page }) => {
    await openSim(page)
    await expect(page.getByTestId('tt-summary-quay')).toHaveText('400 m')
    await page.getByTestId('tt-units-imperial').check()
    await expect(page.getByTestId('tt-summary-quay')).toHaveText('1,312 ft')
    await expect(page.getByTestId('tt-summary-gantry')).toHaveText('1.7 mi/h')
    await page.getByTestId('tt-locale').selectOption('de-DE')
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
    await expect(page.getByTestId('tt-locale')).toHaveValue('de-DE')
    await expect(page.getByTestId('tt-units-imperial')).toBeChecked()
  })

  test('switching locale changes the clock, date and numbers live', async ({ page }) => {
    await openSim(page)
    await loadTracerAt(page, 17 * 60 + 3) // 14:02:03 UTC on Monday 26 Oct 2026 (the tracer ends at ~1169 s)

    await expect(page.getByTestId('tt-clock')).toContainText('26 Oct 2026')
    expect(await clockText(page)).toContain('14:02:03')

    await page.evaluate(() => window.__tt!.setDisplay({ locale: 'en-US' }))
    await expect(page.getByTestId('tt-clock')).toContainText('Oct 26, 2026')
    expect((await clockText(page)).replace(/\s/g, ' ')).toContain('2:02:03 PM')

    // Through the setup dialog: changes apply immediately, also to the clock behind it.
    await page.getByRole('button', { name: 'New Scenario' }).click()
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

  test('setup start and Run to… read and parse in the chosen locale', async ({ page }) => {
    await openSim(page)
    await loadTracerAt(page, 17 * 60 + 3) // 14:02:03 UTC; start is Mon 26 Oct 2026 13:45

    await page.getByRole('button', { name: 'New Scenario' }).click()
    await openAdvanced(page)
    const start = page.getByTestId('tt-setup-start')
    await expect(start).toHaveValue('26/10/2026, 13:45')

    await page.getByTestId('tt-locale').selectOption('en-US')
    await expect(start).toHaveValue(/^10\/26\/2026, 1:45.PM$/)
    // 03/04 is 3 April in en-GB but 4 March in en-US: the typed text follows the chosen locale.
    await start.fill('03/04/2026, 9:30 AM')
    await start.blur()
    await expect(start).toHaveValue(/^03\/04\/2026, 9:30.AM$/)
    await expect(start).not.toHaveAttribute('aria-invalid', 'true')
    await page.getByTestId('tt-locale').selectOption('de-DE')
    await expect(start).toHaveValue('04.03.2026, 09:30')
    await start.fill('31.02.2026, 09:30')
    await start.blur()
    await expect(start).toHaveAttribute('aria-invalid', 'true')
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Run to…: pre-filled with the chosen locale (de-DE now, seconds shown), parsed the same way.
    await page.getByRole('button', { name: 'Run to…' }).click()
    const runTo = page.getByTestId('tt-run-to-input')
    await expect(runTo).toHaveValue('26.10.2026, 14:12:03')
    await runTo.fill('26.10.2026, 14:03:30')
    await runTo.blur()
    await runTo.press('Enter')
    await expect.poll(async () => (await page.evaluate(() => window.__tt!.clock())).displayTime).toBeCloseTo(18 * 60 + 30, 0)
  })

  test('keyboard shortcuts drive the sim, the help overlay lists them, typing in a field does not', async ({ page }) => {
    await openSim(page)
    await loadTracerAt(page, 60)
    const clock = () => page.evaluate(() => window.__tt!.clock())
    const ui = () => page.evaluate(() => window.__tt!.ui())
    await page.locator('body').click({ position: { x: 5, y: 300 } }) // focus the page, not a field

    // Space: pause / resume
    expect((await clock()).paused).toBe(true)
    await page.keyboard.press('Space')
    expect((await clock()).paused).toBe(false)
    await page.keyboard.press('Space')
    expect((await clock()).paused).toBe(true)
    // Space with a top-bar button focused toggles once (it does not also click the button).
    await page.getByRole('button', { name: '×10' }).click()
    expect((await clock()).paused).toBe(false)
    await page.keyboard.press('Space')
    expect((await clock()).paused).toBe(true)

    // 1–9: speed steps (plays); 0: pause
    await page.keyboard.press('3')
    expect(await clock()).toMatchObject({ speed: 5, paused: false })
    await page.keyboard.press('9')
    expect((await clock()).speed).toBe(600)
    await page.keyboard.press('1')
    expect((await clock()).speed).toBe(1)
    await page.keyboard.press('0')
    expect((await clock()).paused).toBe(true)

    // '.': single-step to the next event
    const before = (await clock()).engine!.eventsTotal
    await page.keyboard.press('.')
    await expect.poll(async () => (await clock()).engine!.eventsTotal).toBe(before + 1)
    expect((await clock()).paused).toBe(true)

    // B: dashboard tab
    await page.keyboard.press('b')
    await expect(page.getByTestId('tt-dashboard')).toBeVisible()
    await page.keyboard.press('b')
    await expect(page.getByTestId('tt-dashboard')).toBeHidden()

    // O: overlays
    expect((await ui()).overlaysVisible).toBe(true)
    await page.keyboard.press('o')
    expect((await ui()).overlaysVisible).toBe(false)
    await expect(page.getByTestId('tt-toast')).toHaveText('Overlays off')
    await page.keyboard.press('o')
    expect((await ui()).overlaysVisible).toBe(true)

    // F: follow the selection; Esc: deselect (and stop following)
    await page.keyboard.press('f')
    await expect(page.getByTestId('tt-toast')).toHaveText('Select something to follow first')
    expect((await ui()).following).toBe(false)
    await page.evaluate(() => window.__tt!.select('STS01'))
    await page.keyboard.press('f')
    expect(await ui()).toMatchObject({ selectedId: 'STS01', following: true })
    await page.keyboard.press('Escape')
    expect(await ui()).toMatchObject({ selectedId: null, following: false })

    // ?: help overlay lists every shortcut; Esc closes it
    await page.keyboard.press('?')
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(help).toBeVisible()
    for (const key of ['Space', '1–9', '0', '.', 'F', 'Esc', 'B', 'O', '?', 'WASD', 'Shift + AD', 'Shift + WS', '= / -']) {
      await expect(help.locator('kbd', { hasText: new RegExp(`^${key.replace(/[.?+]/g, '\\$&')}$`) })).toHaveCount(1)
    }
    await page.keyboard.press('Escape')
    await expect(help).toBeHidden()
    await page.getByTestId('tt-help-button').click()
    await expect(help).toBeVisible()
    await page.keyboard.press('Escape')

    // Typing in a field triggers nothing.
    const stateBefore = { clock: await clock(), ui: await ui() }
    await page.getByRole('button', { name: 'Run to…' }).click()
    const field = page.getByLabel('Target sim time')
    await field.focus()
    for (const key of ['Space', '3', '0', '.', 'f', 'b', 'w', 'a', 'o', '?', 'Escape']) await field.press(key)
    const after = await clock()
    expect(after.paused).toBe(stateBefore.clock.paused)
    expect(after.speed).toBe(stateBefore.clock.speed)
    expect(after.engine!.eventsTotal).toBe(stateBefore.clock.engine!.eventsTotal)
    expect(await ui()).toEqual(stateBefore.ui)
    await expect(page.getByTestId('tt-dashboard')).toBeHidden()
  })
})
