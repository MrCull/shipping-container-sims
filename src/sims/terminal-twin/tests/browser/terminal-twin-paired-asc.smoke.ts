/**
 * TT-08 browser smoke tests: two ASCs per block, the ASC rail overlay and the
 * setup dialog's "ASCs per block" field, through the dev-only `window.__tt` API.
 * Run with `pnpm run test:smoke` (not part of `pnpm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type { RunSummary } from '../../engine'
import golden from '../../scenario/fixtures/asc-2asc-block-conflict.golden.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing
import { pickScenario } from './scenarioPicker'

const FIXTURE = 'asc-2asc-block-conflict'

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
  await page.evaluate((name) => window.__tt!.load(name), FIXTURE)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

test('the conflict fixture runs in the browser: golden hash, two ASCs per block drawn, no violations', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page)
  expect((await page.evaluate(() => window.__tt!.runUntil())).reason).toBe('ended')
  const summary = await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))
  expect(summary.eventLogHash).toBe(golden.eventLogHash)
  expect(summary.invariants.violations).toBe(0)
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  expect((await page.evaluate(() => window.__tt!.scene()))!.ascs).toBe(2)
  const ascs = await page.evaluate(() => window.__tt!.sceneState()!.ascs)
  expect(Object.keys(ascs)).toEqual(['B01-ASC1', 'B01-ASC2'])
  expect(ascs['B01-ASC2'].z - ascs['B01-ASC1'].z).toBeGreaterThanOrEqual(12 - 1e-6)
  expect(errors).toEqual([])
})

test('the scene keeps the two ASCs 12 m apart at every step', async ({ page }) => {
  await open(page)
  for (let i = 0; i < 25; i++) {
    await page.evaluate(() => window.__tt!.step())
    const a = await page.evaluate(() => window.__tt!.sceneState()!.ascs)
    expect(a['B01-ASC2'].z - a['B01-ASC1'].z, `step ${i}`).toBeGreaterThanOrEqual(12 - 1e-6)
  }
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'AscYieldAssigned' }))
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.__tt!.step())
    const a = await page.evaluate(() => window.__tt!.sceneState()!.ascs)
    expect(a['B01-ASC2'].z - a['B01-ASC1'].z, `after yield ${i}`).toBeGreaterThanOrEqual(12 - 1e-6)
  }
})

test('the ASC rail overlay shows reserved segments and updates live', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'AscJobAssigned' }))
  await page.evaluate(() => window.__tt!.overlays({ ascRail: false }))
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 3)
  expect((await page.evaluate(() => window.__tt!.scene()))!.reservedRailSegments).toBe(0)

  await page.evaluate(() => window.__tt!.overlays({ ascRail: true }))
  await page.waitForFunction(() => (window.__tt!.scene()?.reservedRailSegments ?? 0) > 0)
  const early = (await page.evaluate(() => window.__tt!.scene()))!.reservedRailSegments
  const heldEarly = Object.keys(await page.evaluate(() => window.__tt!.sceneState()!.reservations)).filter((z) => /^B01:R\d+$/.test(z))
  expect(early).toBeGreaterThan(0)
  expect(early).toBe(heldEarly.length)

  // later in the run another set of segments is held: the overlay follows the display time
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'AscYieldAssigned' }))
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'AscReady' }))
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 3)
  const heldLater = Object.keys(await page.evaluate(() => window.__tt!.sceneState()!.reservations)).filter((z) => /^B01:R\d+$/.test(z))
  expect(heldLater.join()).not.toBe(heldEarly.join())
  await expect
    .poll(async () => (await page.evaluate(() => window.__tt!.scene()))!.reservedRailSegments)
    .toBe(heldLater.length)
})

test('the overlay toggle button turns the ASC rail overlay on and off', async ({ page }) => {
  await open(page)
  const toggle = page.getByRole('button', { name: /asc rail/i })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect((await page.evaluate(() => window.__tt!.overlays())).ascRail).toBe(true)
})

test('the setup dialog offers 1 or 2 ASCs per block, default 2', async ({ page }) => {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.newScenario())
  const dialog = page.getByRole('dialog', { name: /new scenario/i })
  await pickScenario(dialog, 'asc-1sts-10-boxes-1block')
  await expect(dialog.getByTestId('tt-yard-ascs-2')).toBeChecked()
  await dialog.getByTestId('tt-yard-ascs-1').check()
  await dialog.getByRole('button', { name: /start/i }).click()
  await expect(dialog).toBeHidden()
  const one = await page.evaluate(() => window.__tt!.query<{ id: string }[]>('ascList'))
  expect(one.map((a) => a.id)).toEqual(['B01-ASC1'])
  expect((await page.evaluate(() => window.__tt!.config()))!.yard!.ascsPerBlock).toBe(1)

  // the dialog remembers the last choice for the scenario
  await page.evaluate(() => window.__tt!.newScenario())
  await pickScenario(dialog, 'asc-1sts-10-boxes-1block')
  await expect(dialog.getByTestId('tt-yard-ascs-1')).toBeChecked()
  await dialog.getByTestId('tt-yard-ascs-2').check()
  await dialog.getByRole('button', { name: /start/i }).click()
  await expect(dialog).toBeHidden()
  const two = await page.evaluate(() => window.__tt!.query<{ id: string }[]>('ascList'))
  expect(two.map((a) => a.id)).toEqual(['B01-ASC1', 'B01-ASC2'])
})
