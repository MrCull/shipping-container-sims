/**
 * Close-up containers with markings (#119): `__tt.perf().stats.closeup` is above zero with the camera close to boxes
 * and zero from far away (where the draw breakdown holds no close-up meshes), with a screenshot to compare against
 * the reference photos. Run with `pnpm run test:smoke`.
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

test('boxes within about 35 m become close-ups, from far away none are', async ({ page }) => {
  test.slow() // software WebGL
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.localStorage.clear())
  await page.evaluate(() => window.__tt!.setQuality('high')) // Auto can step down to low under a slow software frame rate, where close-ups are off
  await page.evaluate(() => window.__tt!.load('liveries-mixed'))
  await page.evaluate(() => window.__tt!.runTo(200))
  await page.waitForFunction(() => window.__tt!.scene()?.containerAssets === 'loaded')

  await page.evaluate(() => window.__tt!.cameraTo('STS01', 600))
  await page.waitForFunction(() => window.__tt!.scene()!.containerLods.lod1 === window.__tt!.scene()!.containers)
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => window.__tt!.perf().stats.closeup)).toBe(0)
  expect(await page.evaluate(() => window.__tt!.scene()!.containerLods.closeup)).toBe(0)
  expect(Object.keys((await page.evaluate(() => window.__tt!.drawBreakdown())) ?? {}).filter((k) => k.includes('closeup'))).toEqual([])

  await page.evaluate(() => window.__tt!.cameraTo('STS01', 22))
  await page.waitForFunction(() => window.__tt!.perf().stats.closeup > 0)
  const near = await page.evaluate(() => ({ perf: window.__tt!.perf().stats.closeup, scene: window.__tt!.scene()!.containerLods }))
  expect(near.perf).toBeLessThanOrEqual(48)
  expect(near.scene.lod0).toBeGreaterThanOrEqual(near.scene.closeup)
  await page.waitForTimeout(500)
  await page.screenshot({ path: '.screenshots/assets/twin-closeup.png' })

  await page.evaluate(() => window.__tt!.cameraTo('STS01', 600))
  await page.waitForFunction(() => window.__tt!.perf().stats.closeup === 0)
  expect(errors).toEqual([])
})
