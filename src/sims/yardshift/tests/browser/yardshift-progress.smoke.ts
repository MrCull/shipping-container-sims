/**
 * Yardshift smoke spec 3 (#386): at a desktop viewport, winning level 1 (its solver fixture played through the
 * smoke-build `window.__ys` hook) shows the result screen; the progress survives a reload (the start choice offers
 * level 2) and level 2 is unlocked in the level picker. Run with `pnpm run test:smoke`.
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__ys typing

test.use({ viewport: { width: 1280, height: 800 } })

test('a win shows the result, and progress and the next level survive a reload', { tag: '@yardshift' }, async ({ page }) => {
  await page.goto('/sim/yardshift')
  await page.waitForFunction(() => window.__ys !== undefined)
  await expect(page.getByTestId('ys-screen-intro')).toBeVisible()
  await page.getByTestId('ys-levels').click()
  await expect(page.getByTestId('ys-level-2')).toBeDisabled()

  const rejected = await page.evaluate(() => {
    window.__ys!.loadLevel(1)
    return window.__ys!.applyActions(window.__ys!.solution(1))
  })
  expect(rejected).toBeNull()
  await expect(page.getByTestId('ys-screen-result')).toBeVisible()
  await expect(page.getByTestId('ys-result-stars')).toHaveAttribute('data-stars', '3')
  await expect(page.getByTestId('ys-result-rehandles')).toHaveText('1 rehandle · minimum 1')

  await page.reload()
  await page.waitForFunction(() => window.__ys !== undefined)
  // The route now asks where to start (owner round 6): continuing opens the highest unlocked level's intro.
  // Owner round 7: "Start from level 1" is the first and primary button, then "Continue at level N", then Levels.
  const choice = page.getByTestId('ys-screen-start').locator('.buttons button')
  await expect(choice).toHaveText(['Start from level 1 ›', 'Continue at level 2', 'Levels'])
  await expect(page.getByTestId('ys-start-over')).toHaveClass(/primary/)
  await page.getByTestId('ys-continue').click()
  await expect(page.getByTestId('ys-screen-intro')).toContainText('2.')
  await page.getByTestId('ys-levels').click()
  await expect(page.getByTestId('ys-level-1')).toContainText('★★★')
  await expect(page.getByTestId('ys-level-2')).toBeEnabled()
  await expect(page.getByTestId('ys-level-3')).toBeDisabled()
})
