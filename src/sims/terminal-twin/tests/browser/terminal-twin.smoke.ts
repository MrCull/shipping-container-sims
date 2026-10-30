/**
 * Terminal Twin browser smoke tests (seam 3: the dev-only `window.__tt` API).
 * Run with `pnpm run test:smoke` (not part of `pnpm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type { RunSummary } from '../../engine'
import golden from '../../scenario/fixtures/tracer-1sts-10-boxes.golden.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing
import { sampleFrames, simPerWallSecond, advancedFraction, neverBackwards } from './frameSampling'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function openTracer(page: Page): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('tracer-1sts-10-boxes'))
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

test('the home page lists Terminal Twin and its route loads without console errors', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  const card = page.getByText('Terminal Twin', { exact: true }).first()
  await expect(card).toBeVisible()
  await card.click()
  await expect(page).toHaveURL(/\/sim\/terminal-twin$/)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeVisible()
  expect(errors).toEqual([])
})

test('the tracer fixture runs to completion in the browser: golden hash, rendered counts match the engine', async ({ page }) => {
  const errors = collectErrors(page)
  await openTracer(page)

  const result = await page.evaluate(() => window.__tt!.runUntil())
  expect(result.reason).toBe('ended')

  const summary = await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))
  expect(summary.status).toBe('ended')
  expect(summary.eventLogHash).toBe(golden.eventLogHash)
  expect(summary.kpis).toEqual(golden.kpis)

  // Let a few frames render at the final time, then compare the scene with the engine.
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  const containers = await page.evaluate(() => window.__tt!.query<unknown[]>('containers'))
  const stsList = await page.evaluate(() => window.__tt!.query<unknown[]>('stsList'))
  const scene = await page.evaluate(() => window.__tt!.scene())
  expect(scene).not.toBeNull()
  expect(scene!.containers).toBe(containers.length)
  expect(scene!.sts).toBe(stsList.length)
  expect(scene!.containers).toBe(10)

  const clock = await page.evaluate(() => window.__tt!.clock())
  expect(clock.displayTime).toBeCloseTo(golden.kpis.simTimeS, 3)
  await expect(page.getByTestId('tt-status')).toHaveText('Complete')

  await page.evaluate(() => window.__tt!.cameraTo('STS01'))
  await page.waitForTimeout(500)
  await page.screenshot({ path: '.screenshots/terminal-twin-smoke-end.png' })
  expect(errors).toEqual([])
})

test('×1 runs one sim second per wall second; ×600 keeps animating every frame', async ({ page }) => {
  await openTracer(page)
  // Load-proof (V11-07): ratios over a minimum wall-clock window sampled on animation frames, never absolute frame counts.
  await page.evaluate(() => window.__tt!.setSpeed(1))
  const slow = await sampleFrames(page, { minWallMs: 4000 })
  const ratio1 = simPerWallSecond(slow)
  expect(ratio1).toBeGreaterThan(0.95)
  expect(ratio1).toBeLessThan(1.05)

  await page.evaluate(() => window.__tt!.setSpeed(600))
  const fast = await sampleFrames(page, { minWallMs: 2000 })
  expect(fast.length).toBeGreaterThanOrEqual(3)
  expect(fast[fast.length - 1].frames).toBeGreaterThan(fast[0].frames)
  // Display time advanced on every frame (never stalled waiting for the engine) at ~×600, whatever the frame rate.
  expect(neverBackwards(fast)).toBe(true)
  expect(advancedFraction(fast)).toBeGreaterThanOrEqual(0.7)
  const rate = simPerWallSecond(fast)
  expect(rate).toBeGreaterThan(600 * 0.7)
  expect(rate).toBeLessThan(600 * 1.1)
})

test('Run to… jumps to the target and the scene matches the engine there', async ({ page }) => {
  const errors = collectErrors(page)
  await openTracer(page)
  await page.evaluate(() => window.__tt!.setSpeed(5))
  await page.evaluate(() => window.__tt!.runTo(600))

  const clock = await page.evaluate(() => window.__tt!.clock())
  expect(clock.displayTime).toBeGreaterThanOrEqual(600)
  expect(clock.displayTime).toBeLessThan(620)
  expect(clock.paused).toBe(false) // playback resumes at the previous speed
  expect(clock.speed).toBe(5)

  // Paused, the engine does not run ahead, so the scene and the engine describe the same instant.
  await page.evaluate(() => window.__tt!.pause())
  await page.evaluate(() => window.__tt!.runTo(700))
  const paused = await page.evaluate(() => window.__tt!.clock())
  expect(paused.displayTime).toBe(700)
  expect(paused.engine!.now).toBe(700)
  const state = await page.evaluate(() => window.__tt!.sceneState())
  const engineBoxes = await page.evaluate(() =>
    window.__tt!.query<{ id: string; custody: { kind: string; id: string } }[]>('containers'),
  )
  const engineSts = await page.evaluate(() => window.__tt!.query<{ id: string; status: string }[]>('stsList'))
  expect(state!.displayTime).toBe(700)
  for (const box of engineBoxes) expect(state!.containers[box.id], box.id).toEqual(box.custody)
  for (const sts of engineSts) expect(state!.sts[sts.id].status).toBe(sts.status)
  const grounded = engineBoxes.filter((b) => b.custody.kind === 'groundPosition').length
  expect(grounded).toBeGreaterThan(0)
  expect(grounded).toBeLessThan(10)
  expect(errors).toEqual([])
})

test('the Run to… popup sits above the 3D view: its buttons take real clicks and Run runs', async ({ page }) => {
  const errors = collectErrors(page)
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size)
    await openTracer(page)
    await page.getByRole('button', { name: /run to/i }).first().click()
    const run = page.locator('.run-to-pop button[type="submit"]')
    await expect(run).toBeVisible()
    // nothing but the button (or its label) is at its centre: the canvas must not cover the popup
    const topmost = await run.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return hit === el || el.contains(hit)
    })
    expect(topmost, `${size.width}x${size.height}`).toBe(true)
    await run.click({ timeout: 5000 }) // a real click, no force: fails if the canvas intercepts it
    await expect(page.locator('.run-to-pop')).toBeHidden()
    await page.waitForFunction(() => window.__tt!.clock().displayTime >= 600)
  }
  expect(errors).toEqual([])
})

test('Reset returns to t = 0 with the same seed; New Scenario reopens the setup dialog', async ({ page }) => {
  await openTracer(page)
  await page.evaluate(() => window.__tt!.runTo(500))
  await page.getByRole('button', { name: 'Reset' }).click()
  // Back at t = 0 and paused (the engine only pre-fills its few-second look-ahead).
  await expect.poll(() => page.evaluate(() => window.__tt!.clock().engine?.movesCompleted)).toBe(0)
  const clock = await page.evaluate(() => window.__tt!.clock())
  expect(clock.displayTime).toBe(0)
  expect(clock.paused).toBe(true)
  expect(clock.engine!.now).toBeLessThan(60)
  await page.evaluate(() => window.__tt!.runUntil())
  const summary = await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))
  expect(summary.seed).toBe(golden.seed)
  expect(summary.eventLogHash).toBe(golden.eventLogHash)

  await page.getByRole('button', { name: 'New Scenario' }).click()
  const dialog = page.getByRole('dialog', { name: /new scenario/i })
  await expect(dialog).toBeVisible()
  // Start a different seed through the dialog itself.
  await dialog.getByRole('spinbutton', { name: /^Seed/ }).fill('7')
  await dialog.getByRole('button', { name: 'Start' }).click()
  await expect(dialog).toBeHidden()
  await page.evaluate(() => window.__tt!.runUntil())
  const other = await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))
  expect(other.seed).toBe(7)
  expect(other.status).toBe('ended')
  expect(other.eventLogHash).not.toBe(golden.eventLogHash)
})

test('vessels render at their berth (or anchorage) and STS cranes gantry along the rail to their bays', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)

  // Two vessels compete for one berth: at t = 1200 V001 is alongside, V002 waits at anchorage.
  await page.evaluate(() => window.__tt!.load('two-vessels-compete-for-berth'))
  await page.evaluate(() => window.__tt!.runTo(1200))
  await page.evaluate(() => window.__tt!.pause())
  const vessels = await page.evaluate(() =>
    window.__tt!.query<{ id: string; status: string; berthX: number | null }[]>('vessels'),
  )
  expect(vessels.map((v) => [v.id, v.status, v.berthX])).toEqual([
    ['V001', 'berthed', 0],
    ['V002', 'at-anchorage', null],
  ])
  const state = await page.evaluate(() => window.__tt!.sceneState())
  for (const v of vessels) expect(state!.vessels[v.id].status).toBe(v.status)
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 3)
  expect((await page.evaluate(() => window.__tt!.scene()))!.vessels).toBe(2) // alongside + at anchorage

  // Four cranes share the rail: the scene's gantry positions equal the engine's, in rail order.
  await page.evaluate(() => window.__tt!.load('crane-split-4sts'))
  await page.evaluate(() => window.__tt!.runTo(1500))
  await page.evaluate(() => window.__tt!.pause())
  const sts = await page.evaluate(() =>
    window.__tt!.query<{ id: string; status: string; gantryX: number; railLo: number; railHi: number }[]>('stsList'),
  )
  const scene = await page.evaluate(() => window.__tt!.sceneState())
  const xs = sts.map((s) => scene!.sts[s.id].gantryX)
  for (const [i, s] of sts.entries()) {
    expect(xs[i]).toBeGreaterThanOrEqual(s.railLo - 1e-6)
    expect(xs[i]).toBeLessThanOrEqual(s.railHi + 1e-6)
    if (i > 0) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(27 - 1e-6)
  }
  // they left their parking positions (40, 140, 240, 340 m) for their bays
  expect(xs.some((x, i) => Math.abs(x - [40, 140, 240, 340][i]) > 1)).toBe(true)
  await page.screenshot({ path: '.screenshots/terminal-twin-smoke-crane-split.png' })
  expect(errors).toEqual([])
})

test('mid-run screenshot', async ({ page }) => {
  await openTracer(page)
  await page.evaluate(() => window.__tt!.runTo(420))
  await page.evaluate(() => window.__tt!.pause())
  await page.waitForTimeout(500)
  await page.screenshot({ path: '.screenshots/terminal-twin-smoke-midrun.png' })
})
