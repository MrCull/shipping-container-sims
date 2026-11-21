/**
 * #136: the dev server's main menu shows "dev" as the build stamp, and no sim page shows a stamp.
 * The `dev` project runs against the smoke build by default (playwright.config.ts), a real build that stamps its build
 * time like production (build-stamp.prod.smoke.ts checks the commit link there); SMOKE_SERVER=dev opts in to the dev server.
 */
import { expect, test } from '@playwright/test'
import { openTwin } from '../../sims/terminal-twin/tests/browser/openTwin'

test('the main menu build stamp reads "dev" on the dev server and the build time on the smoke build', { tag: '@core' }, async ({ page }) => {
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

test('a sim page has no build stamp', { tag: '@core' }, async ({ page }) => {
  await openTwin(page)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeVisible()
  await expect(page.getByTestId('build-stamp')).toHaveCount(0)
})
