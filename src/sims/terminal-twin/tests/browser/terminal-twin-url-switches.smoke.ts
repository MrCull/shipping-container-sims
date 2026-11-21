/**
 * #322 URL switches: `?render=off` keeps the whole frame update (the frame counter and the drawn box poses move) and
 * skips only the draw, `__tt.renderOnce()` draws one frame on demand and refreshes the draw-call and triangle counters,
 * and `?quality=low` boots at the Low level. Frame rates are rates over a minimum wall-clock window (frameSampling.ts).
 * Run with `pnpm run test:smoke --project=dev terminal-twin-url-switches`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing
import { sampleFrames } from './frameSampling'

function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function open(page: Page, search: string, scenario: string): Promise<void> {
  await page.goto(`/sim/terminal-twin${search}`)
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), scenario)
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
}

/** Scene frames per wall second over a window of at least `minWallMs`. */
async function frameRate(page: Page, minWallMs: number): Promise<number> {
  const s = await sampleFrames(page, { minWallMs })
  return (s[s.length - 1].frames - s[0].frames) / ((s[s.length - 1].wall - s[0].wall) / 1000)
}

test('render=off: the frame counter advances quickly and box poses still move, with nothing drawn', async ({ page }) => {
  const errors = watch(page)
  await open(page, '?render=off', 'tracer-1sts-10-boxes')
  const centres = () => page.evaluate(() => Object.fromEntries(Object.entries(window.__tt!.sceneState()!.liveries).map(([id, l]) => [id, l.centre])))
  await page.evaluate(() => {
    window.__tt!.setSpeed(30) // slow enough to catch the boxes on the move (a fast run ends with them gone)
    window.__tt!.play()
  })
  await page.waitForFunction(() => Object.keys(window.__tt!.sceneState()!.liveries).length > 0, undefined, { timeout: 60_000 }) // the vessel brings them in
  const before = await centres()
  await page.waitForFunction(
    (b) => Object.entries(window.__tt!.sceneState()!.liveries).some(([id, l]) => b[id] && (l.centre.x !== b[id].x || l.centre.y !== b[id].y || l.centre.z !== b[id].z)),
    before,
    { timeout: 60_000 },
  )
  const fps = await frameRate(page, 3000)
  console.log(`render=off tracer: ${fps.toFixed(1)} scene frames per second`)
  expect(fps).toBeGreaterThan(5) // software WebGL draws this fixture at a few fps; the update alone runs far faster
  expect(await page.evaluate(() => window.__tt!.clock().displayTime)).toBeGreaterThan(0)
  const render = await page.evaluate(() => window.__tt!.scene()!.render)
  expect(render).toEqual({ calls: 0, triangles: 0 }) // never drawn
  expect(errors).toEqual([])
})

test('renderOnce() with render=off draws one frame: perf() reports draw calls and triangles', async ({ page }) => {
  const errors = watch(page)
  await open(page, '?render=off', 'tracer-1sts-10-boxes')
  expect((await page.evaluate(() => window.__tt!.perf())).stats.calls).toBe(0)
  const info = await page.evaluate(() => window.__tt!.renderOnce())
  expect(info!.calls).toBeGreaterThan(0)
  expect(info!.triangles).toBeGreaterThan(1000)
  const stats = await page.evaluate(() => window.__tt!.perf().stats)
  expect(stats.calls).toBe(info!.calls)
  expect(stats.triangles).toBe(info!.triangles)
  expect(await page.evaluate(() => window.__tt!.scene()!.render)).toEqual(info)
  expect(errors).toEqual([])
})

test('quality=low boots at the Low level without changing the remembered setting', async ({ page }) => {
  const errors = watch(page)
  await open(page, '?quality=low', 'tracer-1sts-10-boxes')
  const perf = await page.evaluate(() => window.__tt!.perf())
  expect(perf.setting).toBe('low')
  expect(perf.effective).toBe('low')
  expect(await page.evaluate(() => window.localStorage.getItem('terminal-twin.quality'))).toBeNull()
  expect(errors).toEqual([])
})

test('TTI baseline with render=off and quality=low: the scene updates at a usable frame rate', async ({ page }) => {
  test.setTimeout(180_000)
  const errors = watch(page)
  await open(page, '?render=off&quality=low', 'TTI Algeciras baseline')
  await page.evaluate(() => window.__tt!.viewPreset('overview'))
  const fps = await frameRate(page, 4000)
  console.log(`render=off quality=low TTI baseline: ${fps.toFixed(1)} scene frames per second`)
  expect(fps).toBeGreaterThan(2.78) // the measured Low rate with drawing on (#320)
  expect((await page.evaluate(() => window.__tt!.renderOnce()))!.calls).toBeGreaterThan(0)
  expect(errors).toEqual([])
})
