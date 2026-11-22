/**
 * TT-08 browser smoke test: the ASC rail overlay's toggle button, through the dev-only `window.__tt` API.
 * The paired-ASC scene checks (two ASCs drawn, 12 m apart, rail segments) run in the headless scene
 * (`headless-scene-engine.test.ts`) and the setup dialog in `terminal-twin-setup-equipment.smoke.ts` (#333).
 * Run with `pnpm run test:smoke` (not part of `pnpm test`).
 */
import { expect, test } from './twinTest'
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'

test('the overlay toggle button turns the ASC rail overlay on and off', { tag: '@equipment' }, async ({ page }) => {
  await openTwin(page, { scenario: 'asc-2asc-block-conflict' })
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  const toggle = page.getByRole('button', { name: /stacking crane rails/i })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect((await page.evaluate(() => window.__tt!.overlays())).ascRail).toBe(true)
})
