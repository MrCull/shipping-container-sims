/**
 * Hero level (#258): at the overview no hero face is drawn and no hero model has been requested; at a 10 m camera on a
 * yard block the visible faces are drawn at hero level, never above the quality level's cap (3 faces per box: High 96,
 * Medium 36); Low draws none and requests none. Counts only, no frame assertions. Screenshots go to `.screenshots/`.
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

for (const [level, cap] of [
  ['high', 96],
  ['medium', 36],
  ['low', 0],
] as const) {
  test(`${level}: hero faces within the cap at 10 m, none at the overview`, async ({ page }) => {
    test.slow() // software WebGL
    const heroRequests: string[] = []
    page.on('request', (r) => {
      if (/hero-(20|40|40hc)-(side|door|front|roof)/.test(r.url())) heroRequests.push(r.url())
    })
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/sim/terminal-twin')
    await page.waitForFunction(() => !!window.__tt)
    await page.evaluate(() => window.localStorage.clear())
    await page.evaluate((l) => window.__tt!.setQuality(l), level)
    await page.evaluate(() => window.__tt!.load('yard-no-mixed-length'))
    await page.evaluate(() => window.__tt!.runTo(60))
    await page.waitForFunction(() => window.__tt!.scene()?.containerAssets === 'loaded')

    await page.evaluate(() => window.__tt!.viewPreset('overview'))
    await page.waitForTimeout(800)
    expect(await page.evaluate(() => window.__tt!.perf().stats.heroFaces)).toBe(0)
    expect(heroRequests).toEqual([])

    await page.evaluate(() => window.__tt!.cameraTo('B01', 10))
    if (cap === 0) {
      await page.waitForFunction(() => window.__tt!.perf().stats.closeupFaces > 0)
      await page.waitForTimeout(1500)
      expect(await page.evaluate(() => window.__tt!.perf().stats.heroFaces)).toBe(0)
      expect(heroRequests).toEqual([])
    } else {
      await page.waitForFunction(() => window.__tt!.perf().stats.heroFaces > 0, undefined, { timeout: 60_000 })
      await page.waitForTimeout(800)
      const near = await page.evaluate(() => window.__tt!.perf().stats)
      expect(near.heroFaces).toBeGreaterThan(0)
      expect(near.heroFaces).toBeLessThanOrEqual(cap)
      expect(heroRequests.length).toBeGreaterThan(0)
      await page.screenshot({ path: `.screenshots/hero-yard-${level}.png` })
    }
    expect(errors).toEqual([])
  })
}
