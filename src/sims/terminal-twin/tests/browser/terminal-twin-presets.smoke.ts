/**
 * TT-15 browser smoke test: presets, the live plan preview, validation and the kinematics readouts through the real
 * setup dialog; the TTI preset runs in the browser. Run with `pnpm run test:smoke` (not part of `pnpm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing
import { openAdvanced, pickScenario } from './scenarioPicker'

async function openDialog(page: Page) {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  const dialog = page.getByRole('dialog', { name: /new scenario/i })
  // A fresh page opens the dialog itself; only reopen it when a scenario is already loaded.
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: /new scenario/i }).click()
  await expect(dialog).toBeVisible()
  return dialog
}

test('the dialog offers the three presets and marks the TTI bay count as an assumption', async ({ page }) => {
  const dialog = await openDialog(page)
  for (const name of ['TTI Algeciras baseline', 'Small automated', 'TTI Algeciras, peak day']) {
    await expect(dialog.locator(`[data-testid="tt-preset-card"][data-scenario="${name}"]`)).toBeVisible()
  }
  await pickScenario(dialog, 'TTI Algeciras baseline')
  await expect(dialog.getByTestId('tt-bays-assumption')).toBeVisible()
  await expect(dialog.getByTestId('tt-summary-sts')).toHaveText('8')
  await expect(dialog.locator('[data-testid^="tt-plan-block-"]')).toHaveCount(16)
  await expect(dialog.locator('[data-testid^="tt-plan-sts-"]')).toHaveCount(8)
  await expect(dialog.getByTestId('tt-yard-start-prefilled')).toBeChecked()
})

test('a fresh load opens on Scenarios with the TTI baseline selected, by its plain name only', async ({ page }) => {
  const dialog = await openDialog(page)
  await expect(dialog.getByTestId('tt-tab-scenarios')).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.locator('[data-testid="tt-preset-card"][data-scenario="TTI Algeciras baseline"]')).toHaveAttribute('aria-checked', 'true')
  const detail = dialog.getByTestId('tt-scenario-detail')
  await expect(detail).toHaveAttribute('data-scenario', 'TTI Algeciras baseline')
  await expect(detail.getByTestId('tt-detail-name')).toHaveText('Algeciras: a normal day')
  // #156: no technical id as visible text anywhere in the dialog
  await expect(dialog).not.toContainText('TTI Algeciras baseline')
  await expect(detail.getByTestId('tt-detail-id')).toHaveCount(0)
})

test('two tabs with counts from the data; the detail pane shows chips and sketch, never the technical name', async ({ page }) => {
  const dialog = await openDialog(page)
  await dialog.getByTestId('tt-tab-scenarios').click()
  const cards = dialog.getByTestId('tt-preset-card')
  await expect(cards).toHaveCount(3)
  await expect(dialog.getByTestId('tt-count-scenarios')).toHaveText('3')
  // The technical name is not on the list rows, only in the detail pane.
  await expect(cards.first()).not.toContainText('Small automated')
  await pickScenario(dialog, 'TTI Algeciras, peak day')
  const detail = dialog.getByTestId('tt-scenario-detail')
  await expect(detail.getByTestId('tt-detail-name')).toHaveText('Algeciras: peak day')
  await expect(detail.getByTestId('tt-chip-sts')).toHaveText('8 STS')
  await expect(detail.getByTestId('tt-chip-fill')).toHaveText('yard 75% full')
  await expect(detail.locator('svg.sketch')).toBeVisible()
  await expect(detail).toHaveAttribute('data-scenario', 'TTI Algeciras, peak day')
  await expect(detail).not.toContainText('TTI Algeciras, peak day')
  await expect(detail.getByTestId('tt-detail-watch')).not.toBeEmpty()
  await dialog.getByTestId('tt-tab-benches').click()
  const rows = dialog.getByTestId('tt-fixture-row')
  const count = await rows.count()
  expect(count).toBeGreaterThanOrEqual(16)
  await expect(dialog.getByTestId('tt-count-benches')).toHaveText(String(count))
  await expect(dialog.locator('[data-group]')).toHaveCount(5)
  await rows.first().click()
  const benchId = await rows.first().getAttribute('data-scenario')
  await expect(detail).toHaveAttribute('data-scenario', benchId!)
  await expect(dialog).not.toContainText(benchId!)
})

test('a card is focusable and Enter selects it; the detail panel Start runs it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  const dialog = await openDialog(page)
  await dialog.getByTestId('tt-tab-scenarios').click()
  const card = dialog.locator('[data-testid="tt-preset-card"][data-scenario="Small automated"]')
  await card.focus()
  await expect(card).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(card).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByTestId('tt-detail-name')).toHaveText('Small terminal')
  await expect(dialog.getByTestId('tt-scenario-detail').getByRole('button', { name: 'Start', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5, undefined, { timeout: 60_000 })
  expect((await page.evaluate(() => window.__tt!.config()))!.name).toBe('Small automated')
  expect(errors).toEqual([])
})

test('seed and start date live under Advanced and still apply', async ({ page }) => {
  const dialog = await openDialog(page)
  await expect(dialog.locator('input[name="seed"]')).toBeHidden()
  await openAdvanced(dialog)
  await dialog.locator('input[name="seed"]').fill('4242')
  await pickScenario(dialog, 'Small automated')
  await dialog.locator('input[name="seed"]').fill('4242')
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
  // The run's choice is remembered: the reopened dialog shows the seed the run started with.
  await page.getByRole('button', { name: /new scenario/i }).click()
  await openAdvanced(dialog)
  await expect(dialog.locator('input[name="seed"]')).toHaveValue('4242')
})

test('the plan preview follows the counts and an impossible configuration cannot start', async ({ page }) => {
  const dialog = await openDialog(page)
  await pickScenario(dialog, 'TTI Algeciras baseline')
  await dialog.locator('input[name="stsCount"]').fill('10')
  await expect(dialog.locator('[data-testid^="tt-plan-sts-"]')).toHaveCount(10)
  await dialog.locator('input[name="yard-blocks"]').fill('12')
  await dialog.locator('input[name="yard-blocks"]').dispatchEvent('change')
  await expect(dialog.locator('[data-testid^="tt-plan-block-"]')).toHaveCount(12)
  // 16 blocks need 512 m of frontage: a 400 m quay is an error and Start is disabled
  await dialog.locator('input[name="yard-blocks"]').fill('16')
  await dialog.locator('input[name="yard-blocks"]').dispatchEvent('change')
  await dialog.locator('input[name="quayLength"]').fill('400')
  await expect(dialog.getByText('16 blocks need 512 m of frontage; the quay is 400 m')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
  await dialog.locator('input[name="quayLength"]').fill('850')
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
})

test('the STS cycle readout follows the kinematics', async ({ page }) => {
  const dialog = await openDialog(page)
  await pickScenario(dialog, 'TTI Algeciras baseline')
  const readout = dialog.getByTestId('tt-sts-readout')
  const before = await readout.textContent()
  await dialog.locator('input[name="sts-v-trolley"]').fill('1')
  await expect(readout).not.toHaveText(before ?? '')
})

test('the decision-point settings are exposed', async ({ page }) => {
  const dialog = await openDialog(page)
  await pickScenario(dialog, 'Small automated')
  await dialog.getByTestId('tt-decisions-details').locator('summary').click()
  await expect(dialog.getByTestId('tt-async-pause')).toBeVisible()
  await expect(dialog.getByTestId('tt-dp-stsGroundPosition').locator('select').first()).toBeVisible()
})

test('the TTI preset runs in the browser', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  const dialog = await openDialog(page)
  await pickScenario(dialog, 'TTI Algeciras baseline')
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5, undefined, { timeout: 60_000 })
  await page.evaluate(() => window.__tt!.runTo(1800))
  const state = await page.evaluate(() => window.__tt!.sceneState())
  expect(Object.keys(state?.ascs ?? {})).toHaveLength(32)
  expect(errors).toEqual([])
})
