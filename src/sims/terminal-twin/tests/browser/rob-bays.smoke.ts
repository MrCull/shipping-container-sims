/**
 * Spec #106 / #110: the 3D hull draws a vessel's ROB (remain-on-board) boxes. Fixture `rob-bays`: 3 of V001's 7 bays are
 * held back and filled. The box counts (with and without ROB bays) are checked in Node (`tests/headless-scene-vessel.test.ts`,
 * #331); this spec keeps the screenshot of the loaded hull with its ROB boxes: .screenshots/assets/rob-bays.png.
 * Run with `pnpm run test:smoke --project=dev --grep "ROB"`.
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'

test('ROB boxes are drawn in the hull of a vessel with ROB bays (screenshot)', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

  await openTwin(page, { scenario: 'rob-bays' })
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'StsMoveStarted' }))
  await page.waitForFunction(() => {
    const s = window.__tt!.sceneState()
    return !!s && Object.values(s.vesselHulls).every((h) => h.assets === 'loaded')
  })
  await page.evaluate(() => window.__tt!.cameraTo('V001', 200))
  await page.waitForTimeout(600)
  await page.evaluate(() => window.__tt!.renderOnce()) // render is off: draw the frame the screenshot keeps
  await page.screenshot({ path: '.screenshots/assets/rob-bays.png' })
  expect(errors).toEqual([])
})
