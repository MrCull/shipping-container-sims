/**
 * Yardshift smoke spec 2 (#384): a mandatory receipt, reached through the smoke-build `window.__ys` hook, dims the
 * yard and shows the red arrow over the receipt truck; a real tap on the receipt truck clears both. Run with
 * `pnpm run test:smoke`.
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__ys typing

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

test('a mandatory receipt shows the arrow and dimming until the receipt truck is selected', { tag: '@yardshift' }, async ({ page }) => {
  await page.goto('/sim/yardshift')
  await page.waitForFunction(() => window.__ys !== undefined)
  // Level 4: truck #8 waits from the start with 3 moves; three moves make it mandatory.
  const rejected = await page.evaluate(() => {
    window.__ys!.loadLevel(4)
    return window.__ys!.applyActions([
      { type: 'rehandle', from: 0, to: 4 },
      { type: 'collect', from: 0 },
      { type: 'rehandle', from: 2, to: 4 },
    ])
  })
  expect(rejected).toBeNull()
  await expect(page.getByTestId('ys-incoming')).toHaveAttribute('data-status', 'mandatory')
  await expect(page.getByTestId('ys-arrow')).toBeVisible()
  await expect(page.getByTestId('ys-dim')).toBeVisible()
  // The arrow sits over the receipt truck bay, not over a yard stack.
  const receipt = await page.evaluate(() => window.__ys!.hitRegions().find((r) => r.kind === 'receipt')!.rect)
  const arrow = (await page.getByTestId('ys-arrow').boundingBox())!
  const arrowX = arrow.x + arrow.width / 2
  expect(arrowX).toBeGreaterThan(receipt.x)
  expect(arrowX).toBeLessThan(receipt.x + receipt.w)

  await page.touchscreen.tap(receipt.x + receipt.w / 2, receipt.y + receipt.h / 2)
  await expect(page.getByTestId('ys-arrow')).toHaveCount(0)
  await expect(page.getByTestId('ys-dim')).toHaveCount(0)
})
