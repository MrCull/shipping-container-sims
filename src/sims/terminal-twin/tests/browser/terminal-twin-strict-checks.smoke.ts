/**
 * The "strict checks" switch in the setup dialog (#252): off by default, remembered across page loads.
 * Run with `pnpm run test:smoke`.
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing
import { openAdvanced } from './scenarioPicker'

test('strict checks is off by default and remembered', async ({ page }) => {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await openAdvanced(page)
  const box = page.getByTestId('tt-strict-checks')
  await expect(box).not.toBeChecked()
  await box.check()
  await page.reload()
  await page.waitForFunction(() => !!window.__tt)
  await openAdvanced(page)
  await expect(page.getByTestId('tt-strict-checks')).toBeChecked()
})
