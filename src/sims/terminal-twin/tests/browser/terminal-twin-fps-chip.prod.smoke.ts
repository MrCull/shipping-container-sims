/**
 * #118 production-build check: the FPS chip is there without the dev API and opens and closes the perf panel.
 */
import { expect, test } from '@playwright/test'
import { pickScenario } from './scenarioPicker'

/** A fresh load selects the TTI baseline (#156); these checks run on the small tracer fixture. */
const TRACER = 'tracer-1sts-10-boxes'

test('the FPS chip is visible in a production build and toggles the perf panel', async ({ page }) => {
  await page.goto('/sim/terminal-twin')
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeVisible()
  await pickScenario(page, TRACER)
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  const chip = page.getByTestId('tt-fps-chip')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText(/\d+\s*FPS/)
  await chip.click()
  await expect(page.getByTestId('tt-perf-overlay')).toBeVisible()
  await chip.click()
  await expect(page.getByTestId('tt-perf-overlay')).toHaveCount(0)
})
