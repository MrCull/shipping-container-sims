/**
 * Spec #106 / #110: the 3D hull draws a vessel's ROB (remain-on-board) boxes. Fixture `rob-bays`: 3 of V001's 7 bays are
 * held back and filled; the hull reports how many boxes it draws (`sceneState().vesselHulls.V001.robBoxes`), their
 * bays stay free of work, and a screenshot goes to .screenshots/assets/rob-bays.png.
 * Run with `pnpm run test:smoke --project=dev --grep "ROB"`.
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

test('ROB boxes are drawn in the hull of a vessel with ROB bays, and not in one without', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('rob-bays'))
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'StsMoveStarted' }))
  await page.waitForFunction(() => {
    const s = window.__tt!.sceneState()
    return !!s && Object.values(s.vesselHulls).every((h) => h.assets === 'loaded')
  })
  const state = (await page.evaluate(() => window.__tt!.sceneState()))!
  // 3 bays x 8 rows x (4 hold + 3 deck tiers) cells at 70% fill: well over 30 boxes (the exact count is in tests/rob-bays.test.ts)
  expect(state.vesselHulls.V001.robBoxes).toBeGreaterThan(30)
  await page.evaluate(() => window.__tt!.cameraTo('V001', 200))
  await page.waitForTimeout(600)
  await page.screenshot({ path: '.screenshots/assets/rob-bays.png' })

  await page.evaluate(() => window.__tt!.load('hatch-cover-cycle'))
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'StsMoveStarted' }))
  const plain = (await page.evaluate(() => window.__tt!.sceneState()))!
  expect(plain.vesselHulls.V001.robBoxes).toBe(0)
  expect(errors).toEqual([])
})
