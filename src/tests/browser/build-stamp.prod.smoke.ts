/** #136 production-build check: the main menu shows the build time and a commit link (the commit part needs git at build time). */
import { expect, test } from '@playwright/test'

test('the main menu build stamp shows the build time and a commit link in a production build', async ({ page }) => {
  await page.goto('/')
  const stamp = page.getByTestId('build-stamp')
  await expect(stamp).toBeVisible()
  await expect(stamp).toContainText(/^Built \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}/)
  const link = page.getByTestId('build-stamp-commit')
  await expect(link).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/MrCull\/shipping-container-sims\/commit\/[0-9a-f]{7,40}$/,
  )
})
