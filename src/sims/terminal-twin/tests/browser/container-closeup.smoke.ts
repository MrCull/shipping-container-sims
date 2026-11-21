/**
 * Close-up containers with markings (#119, #143): near a quay crane the browser draws close-up boxes with markings and
 * `__tt.perf().stats` reports them (wiring, one screenshot to review). Close-up and face counts by camera pose, the
 * per-level budgets and the yard block edge on Low and High are Node tests on the headless scene
 * (`tests/headless-scene-yard.test.ts`, #336). Roofs print no text (#170; `tests/container-markings.test.ts`). The last
 * spec (`@load`, never in CI) compares the frame time of the view about 10 boxes wide with the Overview camera. Run with
 * `pnpm run test:smoke`.
 */
import { expect, test } from './twinTest'
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'

test('close-up boxes with markings are drawn near the quay crane and reported by perf stats', { tag: '@yard' }, async ({ page }) => {
  test.slow() // software WebGL
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  await openTwin(page)
  await page.evaluate(() => window.localStorage.clear())
  await page.evaluate(() => window.__tt!.setQuality('high')) // pin the level: Auto steps down under a slow software frame rate, and Low reaches only 18 m
  await page.evaluate(() => window.__tt!.load('liveries-mixed'))
  await page.evaluate(() => window.__tt!.runTo(200))
  await page.waitForFunction(() => window.__tt!.scene()?.containerAssets === 'loaded')

  await page.evaluate(() => window.__tt!.cameraTo('STS01', 22))
  await page.waitForFunction(() => window.__tt!.perf().stats.closeup > 0)
  // the browser's perf stats report the same close-ups the scene counts (counts by pose: headless-scene-yard.test.ts)
  const near = await page.evaluate(() => ({ perf: window.__tt!.perf().stats.closeup, scene: window.__tt!.scene()!.containerLods }))
  expect(near.scene.closeup).toBe(near.perf)
  await page.waitForTimeout(500)
  await page.evaluate(() => window.__tt!.renderOnce()) // render is off: draw the frame the screenshot keeps
  await page.screenshot({ path: '.screenshots/assets/twin-closeup.png' })
  expect(errors).toEqual([])
})

test('the view about 10 boxes wide costs no more frame time than the Overview camera @load', { tag: '@yard' }, async ({ page }) => {
  test.setTimeout(900_000)
  await openTwin(page)
  await page.evaluate(() => window.__tt!.setQuality('high'))
  await page.evaluate(() => window.__tt!.load('TTI Algeciras baseline'))
  await page.waitForFunction(() => (window.__tt!.scene()?.containers ?? 0) > 10_000, undefined, { timeout: 120_000 })
  await page.waitForFunction(() => window.__tt!.scene()!.containerAssets === 'loaded', undefined, { timeout: 60_000 })
  const frameMs = async (): Promise<number> => {
    const f0 = await page.evaluate(() => ({ frames: window.__tt!.scene()!.frames, t: performance.now() }))
    await page.waitForFunction((f) => window.__tt!.scene()!.frames > f + 40, f0.frames, { timeout: 420_000 })
    const f1 = await page.evaluate(() => ({ frames: window.__tt!.scene()!.frames, t: performance.now() }))
    return (f1.t - f0.t) / (f1.frames - f0.frames)
  }
  await page.evaluate(() => window.__tt!.viewPreset('overview'))
  const overview = await frameMs()
  await page.evaluate(() => window.__tt!.cameraTo('B01', 40)) // about 10 boxes fill the screen
  await page.waitForFunction(() => window.__tt!.perf().stats.closeupFaces > 0, undefined, { timeout: 60_000 })
  const closeup = await frameMs()
  test.info().annotations.push({ type: 'frame-ms', description: JSON.stringify({ overview, closeup }) })
  // A ratio plus noise: the close-up view is no worse than the Overview camera.
  expect(closeup, JSON.stringify({ overview, closeup })).toBeLessThan(overview * 1.1 + 3)
})
