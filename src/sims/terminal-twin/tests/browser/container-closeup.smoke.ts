/**
 * Close-up containers with markings (#119, #143): `__tt.perf().stats.closeup` (boxes) and `closeupFaces` (marking faces)
 * are above zero with the camera close to boxes and zero from far away (where the draw breakdown holds no close-up
 * meshes), and faces never exceed the quality level's budget (400 on High). A yard block edge close up shows markings
 * on its visible faces on Low (48 faces within 18 m, #158: Auto settles there on a laptop) and on High (screenshots to
 * review). Roofs print no text (#170; the painter's roof is checked by `tests/container-markings.test.ts`). The last spec (`@load`, never in CI) compares the frame time of the
 * view about 10 boxes wide with the Overview camera. Run with `pnpm run test:smoke`.
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
  await page.evaluate(() => window.__tt!.setQuality('high')) // pin the level: Auto steps down under a slow software frame rate, and Low reaches only 18 m
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
  expect(near.scene.closeup).toBe(near.perf)
  const faces = await page.evaluate(() => window.__tt!.perf().stats.closeupFaces)
  expect(faces).toBeGreaterThanOrEqual(near.perf) // at least one face per box drawn
  expect(faces).toBeLessThanOrEqual(400)
  await page.waitForTimeout(500)
  await page.screenshot({ path: '.screenshots/assets/twin-closeup.png' })

  await page.evaluate(() => window.__tt!.cameraTo('STS01', 600))
  await page.waitForFunction(() => window.__tt!.perf().stats.closeup === 0)
  expect(await page.evaluate(() => window.__tt!.perf().stats.closeupFaces)).toBe(0)
  expect(errors).toEqual([])
})

for (const [level, budget, distanceM] of [['low', 48, 12], ['high', 400, 22]] as const) {
  test(`a yard block edge close up draws faces on ${level}, none from far, never above the budget`, async ({ page }) => {
    test.slow() // software WebGL
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
    })
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
    await page.goto('/sim/terminal-twin')
    await page.waitForFunction(() => !!window.__tt)
    await page.evaluate(() => window.localStorage.clear())
    await page.evaluate((l) => window.__tt!.setQuality(l), level)
    await page.evaluate(() => window.__tt!.load('yard-no-mixed-length')) // a half-full block B01
    await page.evaluate(() => window.__tt!.runTo(60))
    await page.waitForFunction(() => window.__tt!.scene()?.containerAssets === 'loaded')

    await page.evaluate((d) => window.__tt!.cameraTo('B01', d), distanceM)
    await page.waitForFunction(() => window.__tt!.perf().stats.closeupFaces > 0)
    const near = await page.evaluate(() => window.__tt!.perf().stats)
    expect(near.closeupFaces).toBeGreaterThan(0)
    expect(near.closeupFaces).toBeLessThanOrEqual(budget)
    expect(near.closeup).toBeGreaterThan(0)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `.screenshots/assets/twin-closeup-block-edge-${level}.png` })

    await page.evaluate(() => window.__tt!.cameraTo('B01', 600))
    await page.waitForFunction(() => window.__tt!.perf().stats.closeupFaces === 0)
    expect(errors).toEqual([])
  })
}

test('the view about 10 boxes wide costs no more frame time than the Overview camera @load', async ({ page }) => {
  test.setTimeout(900_000)
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
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
