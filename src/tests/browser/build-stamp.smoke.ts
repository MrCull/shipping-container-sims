/**
 * #136: the dev server's main menu shows "dev" as the build stamp, and no sim page shows a stamp.
 * The `dev` project can also run against the smoke build (SMOKE_SERVER=build, playwright.config.ts), a real build that
 * stamps its build time like production (build-stamp.prod.smoke.ts checks the commit link there).
 */
import { expect, test } from '@playwright/test'

test('the main menu build stamp reads "dev" on the dev server and the build time on the smoke build', async ({ page }) => {
  await page.goto('/')
  const stamp = page.getByTestId('build-stamp')
  await expect(stamp).toBeVisible()
  if (process.env.SMOKE_SERVER === 'build') {
    await expect(stamp).not.toHaveText('dev')
    await expect(stamp).toContainText(/\d/)
  } else {
    await expect(stamp).toHaveText('dev')
    await expect(page.getByTestId('build-stamp-commit')).toHaveCount(0)
  }
})

test('a sim page has no build stamp', async ({ page }) => {
  await page.goto('/sim/terminal-twin')
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeVisible()
  await expect(page.getByTestId('build-stamp')).toHaveCount(0)
})
