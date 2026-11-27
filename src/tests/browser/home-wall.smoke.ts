/**
 * Home page poster wall: every playable game has a tile that opens it, and the game opened last comes back as the
 * big first tile with a "Continue" badge. Run with `pnpm run test:smoke`.
 */
import { expect, test } from '@playwright/test'

test('a tile opens its game, and that game is featured with Continue on the way back', { tag: ['@core', '@home-wall'] }, async ({ page }) => {
  await page.goto('/')
  const tiles = page.locator('.wall > .tile')
  await expect(tiles).toHaveCount(5)
  await expect(tiles.first()).toHaveAttribute('data-testid', 'game-tile-stowage-master')
  await expect(page.getByText('CONTINUE', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('audio-level')).toBeVisible()

  await page.getByTestId('game-tile-container-stack').click()
  await expect(page).toHaveURL(/\/sim\/container-stack$/)

  await page.goto('/')
  await expect(tiles.first()).toHaveAttribute('data-testid', 'game-tile-container-stack')
  await expect(tiles.first().getByText('CONTINUE', { exact: true })).toBeVisible()
  await expect(tiles.first().getByText('▶ Continue')).toBeVisible()
})
