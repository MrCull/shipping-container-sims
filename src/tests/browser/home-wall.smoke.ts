/**
 * Home page poster wall: every playable game has a tile that opens it, and the game opened last comes back as the
 * big first tile with a "Continue" badge. Run with `pnpm run test:smoke`.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

/** The sims whose `definition.ts` says `status: 'playable'`: a new sim folder changes this, no test edit needed. */
function playableSimIds(): string[] {
  const root = 'src/sims'
  return readdirSync(root).filter((id) => {
    const def = `${root}/${id}/definition.ts`
    return existsSync(def) && /\bstatus:\s*['"]playable['"]/.test(readFileSync(def, 'utf8'))
  })
}

test('a tile opens its game, and that game is featured with Continue on the way back', { tag: ['@core', '@home-wall'] }, async ({ page }) => {
  await page.goto('/')
  const tiles = page.locator('.wall > .tile')
  const playable = playableSimIds()
  expect(playable.length).toBeGreaterThan(1)
  await expect(tiles).toHaveCount(playable.length)
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
