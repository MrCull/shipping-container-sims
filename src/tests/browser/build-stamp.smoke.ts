/** #136: the dev server's main menu shows "dev" as the build stamp, and no sim page shows a stamp. */
import { expect, test } from '@playwright/test'

test('the main menu build stamp reads "dev" on the dev server', async ({ page }) => {
  await page.goto('/')
  const stamp = page.getByTestId('build-stamp')
  await expect(stamp).toBeVisible()
  await expect(stamp).toHaveText('dev')
  await expect(page.getByTestId('build-stamp-commit')).toHaveCount(0)
})

test('a sim page has no build stamp', async ({ page }) => {
  await page.goto('/sim/terminal-twin')
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeVisible()
  await expect(page.getByTestId('build-stamp')).toHaveCount(0)
})
