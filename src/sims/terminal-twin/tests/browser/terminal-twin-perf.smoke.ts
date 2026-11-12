/**
 * TT-19 browser smoke tests: the FPS / draw-call / triangle overlay, the quality settings, Auto quality
 * stepping down under load and recovering, and the TTI preset at overview zoom (draw budget + frame CPU time).
 * Headless Chromium renders with SwiftShader, so frame RATES here say nothing about a real GPU: the
 * assertions are about draw calls, triangles, culling and the Auto controller. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function open(page: Page, scenario: string): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.localStorage.clear())
  await page.evaluate((name) => window.__tt!.load(name), scenario)
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
}

test('overlay shows live fps, draw calls and triangles and can be toggled; quality defaults to Auto', async ({ page }) => {
  const errors = watch(page)
  await open(page, 'tracer-1sts-10-boxes')
  expect((await page.evaluate(() => window.__tt!.perf())).setting).toBe('auto')
  await expect(page.getByTestId('tt-perf-overlay')).toHaveCount(0)
  await page.keyboard.press('p')
  await expect(page.getByTestId('tt-perf-overlay')).toBeVisible()
  await page.waitForFunction(() => window.__tt!.perf().stats.fps > 0 && window.__tt!.perf().stats.calls > 0)
  const stats = await page.evaluate(() => window.__tt!.perf().stats)
  expect(stats.triangles).toBeGreaterThan(1000)
  expect(Number(((await page.getByTestId('tt-perf-calls').textContent()) ?? '').replace(/\D/g, ''))).toBeGreaterThan(0)
  expect(Number(((await page.getByTestId('tt-perf-triangles').textContent()) ?? '').replace(/\D/g, ''))).toBeGreaterThan(1000)
  await page.getByTestId('tt-perf-toggle').click()
  await expect(page.getByTestId('tt-perf-overlay')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('fixed quality levels change what is drawn: Low draws less than High', async ({ page }) => {
  const errors = watch(page)
  await open(page, 'tracer-1sts-10-boxes')
  const measure = async (level: 'low' | 'high') => {
    await page.getByTestId(`tt-quality-${level}`).click()
    const frames = await page.evaluate(() => window.__tt!.scene()!.frames)
    await page.waitForFunction((f) => window.__tt!.scene()!.frames > f + 4, frames)
    return page.evaluate(() => window.__tt!.scene()!.render)
  }
  const high = await measure('high')
  const low = await measure('low')
  expect(low.calls).toBeLessThan(high.calls) // no shadow pass
  expect(low.triangles).toBeLessThan(high.triangles)
  expect((await page.evaluate(() => window.__tt!.perf())).effective).toBe('low')
  expect(errors).toEqual([])
})

test('the overlay names the rung in force; a manual level fixes it', async ({ page }) => {
  const errors = watch(page)
  await open(page, 'tracer-1sts-10-boxes')
  await page.keyboard.press('p')
  await page.evaluate(() => window.__tt!.setAutoRung(2))
  await expect(page.getByTestId('tt-perf-rung')).toHaveText('Hero cap quarter')
  await page.evaluate(() => window.__tt!.setAutoRung(4))
  await expect(page.getByTestId('tt-perf-rung')).toHaveText('Hero when still')
  expect((await page.evaluate(() => window.__tt!.perf())).rungName).toBe('hero-off')
  await page.evaluate(() => window.__tt!.setQuality('high'))
  await expect(page.getByTestId('tt-perf-rung')).toHaveText('Full detail')
  await page.evaluate(() => window.__tt!.setQuality('low'))
  await expect(page.getByTestId('tt-perf-rung')).toHaveText('Low profile')
  expect(errors).toEqual([])
})

test('Auto sheds down the ladder under sustained load, names the rung in the overlay, and climbs back when the load ends @load', async ({ page }) => {
  test.setTimeout(300_000)
  const errors = watch(page)
  await open(page, 'tracer-1sts-10-boxes')
  await page.keyboard.press('p')
  await page.evaluate(() => window.__tt!.setQuality('auto'))
  // let the first (software-rendered) frames settle, then judge from a clean slate at High
  // Software rendering tops out near 19 fps, so the thresholds are retuned: under 12 fps steps down, 15 fps or more steps up.
  await page.evaluate(() => window.__tt!.setAutoThresholds({ down: 12, up: 15 }))
  await page.evaluate(() => window.__tt!.setPausedDetail(false)) // Auto does not judge frames under the paused-detail boost
  await page.evaluate(() => window.__tt!.setFrameLoad(150)) // about 6 fps
  await page.waitForFunction(() => window.__tt!.perf().rung > 0, undefined, { timeout: 40_000 })
  await expect(page.getByTestId('tt-perf-rung')).not.toHaveText('Full detail')
  expect((await page.evaluate(() => window.__tt!.perf())).autoChanges).toBeGreaterThanOrEqual(1)
  // the ladder goes on to the bottom, one rung at a time
  await page.waitForFunction(() => window.__tt!.perf().rungName === 'low', undefined, { timeout: 150_000 })
  await expect(page.getByTestId('tt-perf-level')).toHaveText('Low')
  await expect(page.getByTestId('tt-perf-rung')).toHaveText('Low profile')
  // the load ends: with headroom Auto climbs again, and the overlay shows it
  const changes = (await page.evaluate(() => window.__tt!.perf())).autoChanges
  await page.evaluate(() => window.__tt!.setFrameLoad(0))
  await page.waitForFunction(() => window.__tt!.perf().rung < 7, undefined, { timeout: 90_000 })
  await expect(page.getByTestId('tt-perf-rung')).not.toHaveText('Low profile')
  expect((await page.evaluate(() => window.__tt!.perf())).autoChanges).toBeGreaterThan(changes)
  expect(errors).toEqual([])
})

test('TTI preset at overview zoom: instanced containers are culled and the draw budget holds', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = watch(page)
  await open(page, 'TTI Algeciras baseline')
  await page.evaluate(() => window.__tt!.setQuality('high'))
  await page.waitForFunction(() => (window.__tt!.scene()?.containers ?? 0) > 8_000, undefined, { timeout: 120_000 })
  await page.waitForFunction(() => window.__tt!.scene()!.containerAssets === 'loaded', undefined, { timeout: 60_000 })
  // overview zoom: the whole terminal in view
  await page.evaluate(() => window.__tt!.cameraTo('STS104', 1100))
  const frames = await page.evaluate(() => window.__tt!.scene()!.frames)
  await page.waitForFunction((f) => window.__tt!.scene()!.frames > f + 8, frames, { timeout: 120_000 })
  const scene = await page.evaluate(() => window.__tt!.scene()!)
  const perf = await page.evaluate(() => window.__tt!.perf())
  test.info().annotations.push({
    type: 'tti-overview',
    description: JSON.stringify({ containers: scene.containers, culled: scene.containerLods.culled, lod0: scene.containerLods.lod0, render: scene.render, cpuMs: perf.stats.cpuMs }),
  })
  console.log('TTI overview', JSON.stringify({ render: scene.render, perf, containerLods: scene.containerLods }))
  // 9,171 at scale 0.5 (the pre-fill is 68.5 % of cells, #188; measured before the scale 1 step of #222); the floor tracks the yard size, the budgets below are the point
  expect(scene.containers).toBeGreaterThan(8_000)
  // main pass + shadow pass; the unbatched ground alone used to cost ~1,300 draw calls here
  expect(scene.render.calls).toBeLessThan(450)
  // Main + shadow pass. 1.56M before the far tier (#249): yard fences, ASC rails and masts (about 680k) drew at full detail at
  // any distance; their 12-triangle stand-ins bring the overview to about 382k (the frame-rate guide's 400k budget). The
  // geometry is deterministic, so this is a real budget, not a frame-rate check.
  expect(scene.render.triangles).toBeLessThan(420_000)
  // zoomed in on one crane, nearly all of the 10,000+ stacked boxes are outside the frustum and are not drawn
  await page.evaluate(() => window.__tt!.cameraTo('STS104', 60))
  const f2 = await page.evaluate(() => window.__tt!.scene()!.frames)
  await page.waitForFunction((f) => window.__tt!.scene()!.frames > f + 4, f2, { timeout: 120_000 })
  const near = await page.evaluate(() => window.__tt!.scene()!.containerLods)
  expect(near.culled).toBeGreaterThan(scene.containers * 0.8)
  expect(errors).toEqual([])
})
