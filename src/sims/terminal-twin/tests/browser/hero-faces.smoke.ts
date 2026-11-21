/**
 * Hero level (#258) in the browser: at the overview no hero face is drawn and no hero model has been requested; at a
 * 10 m camera on a yard block on High the hero GLBs load from this host and the visible faces are drawn, never above
 * the cap (screenshot in `.screenshots/`). The caps per quality level (Medium, Low), the Auto rungs and paused detail,
 * and arrival (nothing prepared during a fast fly-through, faces once the camera settles) are Node tests
 * (`tests/hero-faces.test.ts`, `tests/hero-prep.test.ts`, `tests/quality.test.ts`; #336).
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'

test('high: hero faces within the cap at 10 m, none at the overview', { tag: '@yard' }, async ({ page }) => {
  test.slow() // software WebGL
  const heroRequests: string[] = []
  page.on('request', (r) => {
    if (/hero-(20|40|40hc)-(side|door|front|roof)/.test(r.url())) heroRequests.push(r.url())
  })
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await openTwin(page)
  await page.evaluate(() => window.localStorage.clear())
  await page.evaluate(() => window.__tt!.setQuality('high'))
  await page.evaluate(() => window.__tt!.load('yard-no-mixed-length'))
  await page.evaluate(() => window.__tt!.runTo(60))
  await page.waitForFunction(() => window.__tt!.scene()?.containerAssets === 'loaded')

  await page.evaluate(() => window.__tt!.viewPreset('overview'))
  await page.waitForTimeout(800)
  expect(await page.evaluate(() => window.__tt!.perf().stats.heroFaces)).toBe(0)
  expect(heroRequests).toEqual([])

  await page.evaluate(() => window.__tt!.cameraTo('B01', 10))
  await page.waitForFunction(() => window.__tt!.perf().stats.heroFaces > 0, undefined, { timeout: 60_000 })
  await page.waitForTimeout(800)
  const near = await page.evaluate(() => window.__tt!.perf().stats)
  expect(near.heroFaces).toBeGreaterThan(0)
  expect(near.heroFaces).toBeLessThanOrEqual(96) // High's cap
  expect(heroRequests.length).toBeGreaterThan(0)
  await page.evaluate(() => window.__tt!.renderOnce()) // render is off: draw the frame the screenshot keeps
  await page.screenshot({ path: '.screenshots/hero-yard-high.png' })
  expect(errors).toEqual([])
})
