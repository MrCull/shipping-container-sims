/**
 * Yardshift smoke spec 1 (#381): at a phone viewport the home tile opens /sim/yardshift and the tutorial is won with
 * real touch taps. Tap points are the centres of the presentation hit regions, read through the smoke-build
 * `window.__ys` hook; the taps themselves go through the browser's touch input. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__ys typing
import type { HitTarget } from '../../types/presentation'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function tap(page: Page, target: HitTarget): Promise<void> {
  const point = await page.evaluate((t) => {
    const region = window.__ys!.hitRegions().find(
      (r) => r.kind === t.kind && (r.kind !== 'stack' || t.kind !== 'stack' || r.index === t.index),
    )!
    return { x: region.rect.x + region.rect.w / 2, y: region.rect.y + region.rect.h / 2 }
  }, target)
  await page.touchscreen.tap(point.x, point.y)
}

test('the home tile opens Yardshift and the tutorial is won by taps', { tag: '@yardshift' }, async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('game-tile-yardshift').tap()
  await expect(page).toHaveURL(/\/sim\/yardshift$/)
  await page.waitForFunction(() => window.__ys !== undefined)
  await expect(page.getByTestId('ys-loaded')).toHaveText('0/4')

  const stack = (index: number): HitTarget => ({ kind: 'stack', index })
  await tap(page, stack(0)) // collect #1
  await expect(page.getByTestId('ys-loaded')).toHaveText('1/4')
  await tap(page, stack(1)) // select #4
  await tap(page, stack(3)) // move #4 to the empty stack
  await expect(page.getByTestId('ys-rehandles')).toHaveText('1/5')
  // Each move plays a crane animation that drops taps until it ends, so wait for the move before the next tap.
  await tap(page, stack(1)) // collect #2
  await expect(page.getByTestId('ys-loaded')).toHaveText('2/4')
  await tap(page, { kind: 'collection' }) // collect #3 through the truck
  await expect(page.getByTestId('ys-loaded')).toHaveText('3/4')
  await tap(page, stack(3)) // collect #4

  await expect(page.getByTestId('ys-complete')).toBeVisible()
  await expect(page.getByTestId('ys-loaded')).toHaveText('4/4')
  expect(await page.evaluate(() => window.__ys!.state().status)).toBe('complete')
})
