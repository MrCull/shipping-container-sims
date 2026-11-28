/**
 * Yardshift smoke spec 1 (#381): at a phone viewport the home tile opens /sim/yardshift and the tutorial is won with
 * real touch taps. Tap points are the centres of the presentation hit regions, read through the smoke-build
 * `window.__ys` hook; the taps themselves go through the browser's touch input. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__ys typing

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

type Point = { x: number; y: number }

/** Tap points by target key (`stack-0`, `collection`): the hit region centres, read once (the layout is fixed). */
async function tapPoints(page: Page): Promise<Record<string, Point>> {
  return page.evaluate(() =>
    Object.fromEntries(
      window.__ys!.hitRegions().map((r) => [
        r.kind === 'stack' ? `stack-${r.index}` : r.kind,
        { x: r.rect.x + r.rect.w / 2, y: r.rect.y + r.rect.h / 2 },
      ]),
    ),
  )
}

/**
 * Waits for a HUD counter's text, polled every animation frame in the page (#391: a software-GL frame here is about
 * 140 ms, and the expect retry steps of 250 to 500 ms overshoot the end of a crane move).
 */
async function untilText(page: Page, testId: string, text: string): Promise<void> {
  await page.waitForFunction(
    ([id, want]) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() === want,
    [testId, text] as const,
    { polling: 'raf' },
  )
}

test('the home tile opens Yardshift and the tutorial is won by taps', { tag: '@yardshift' }, async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('game-tile-yardshift').tap()
  await expect(page).toHaveURL(/\/sim\/yardshift$/)
  await page.waitForFunction(() => window.__ys !== undefined)
  await page.getByTestId('ys-start').click()
  await expect(page.getByTestId('ys-loaded')).toHaveText('0/4')

  const points = await tapPoints(page)
  const tap = (key: string) => page.touchscreen.tap(points[key]!.x, points[key]!.y)
  // Each move plays a crane animation that drops taps until it ends, so wait for the move before the next tap.
  await tap('stack-0') // collect #1
  await untilText(page, 'ys-loaded', '1/4')
  await tap('stack-1') // select #4
  await tap('stack-3') // move #4 to the empty stack
  await untilText(page, 'ys-rehandles', '1/5')
  await tap('stack-1') // collect #2
  await untilText(page, 'ys-loaded', '2/4')
  await tap('collection') // collect #3 through the truck
  await untilText(page, 'ys-loaded', '3/4')
  await tap('stack-3') // collect #4

  await expect(page.getByTestId('ys-screen-result')).toBeVisible()
  await expect(page.getByTestId('ys-loaded')).toHaveText('4/4')
  expect(await page.evaluate(() => window.__ys!.state().status)).toBe('complete')
})
