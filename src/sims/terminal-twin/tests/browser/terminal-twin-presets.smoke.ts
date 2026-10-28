/**
 * TT-15 browser smoke test: presets, the live plan preview, validation and the kinematics readouts through the real
 * setup dialog; the TTI preset runs in the browser. Run with `npm run test:smoke` (not part of `npm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

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
  for (const name of ['TTI Algeciras baseline', 'Small automated', 'Stress test']) await expect(dialog.getByText(name, { exact: true })).toBeVisible()
  await dialog.getByText('TTI Algeciras baseline', { exact: true }).click()
  await expect(dialog.getByTestId('tt-bays-assumption')).toBeVisible()
  await expect(dialog.getByTestId('tt-summary-sts')).toHaveText('8')
  await expect(dialog.locator('[data-testid^="tt-plan-block-"]')).toHaveCount(16)
  await expect(dialog.locator('[data-testid^="tt-plan-sts-"]')).toHaveCount(8)
  await expect(dialog.getByTestId('tt-yard-start-prefilled')).toBeChecked()
})

test('the plan preview follows the counts and an impossible configuration cannot start', async ({ page }) => {
  const dialog = await openDialog(page)
  await dialog.getByText('TTI Algeciras baseline', { exact: true }).click()
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
  await dialog.getByText('TTI Algeciras baseline', { exact: true }).click()
  const readout = dialog.getByTestId('tt-sts-readout')
  const before = await readout.textContent()
  await dialog.locator('input[name="sts-v-trolley"]').fill('1')
  await expect(readout).not.toHaveText(before ?? '')
})

test('the decision-point settings are exposed', async ({ page }) => {
  const dialog = await openDialog(page)
  await dialog.getByText('Small automated', { exact: true }).click()
  await dialog.getByTestId('tt-decisions-details').locator('summary').click()
  await expect(dialog.getByTestId('tt-async-pause')).toBeVisible()
  await expect(dialog.getByTestId('tt-dp-stsGroundPosition').locator('select').first()).toBeVisible()
})

test('the TTI preset runs in the browser', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  const dialog = await openDialog(page)
  await dialog.getByText('TTI Algeciras baseline', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5, undefined, { timeout: 60_000 })
  await page.evaluate(() => window.__tt!.runTo(1800))
  const state = await page.evaluate(() => window.__tt!.sceneState())
  expect(Object.keys(state?.ascs ?? {})).toHaveLength(32)
  expect(errors).toEqual([])
})
