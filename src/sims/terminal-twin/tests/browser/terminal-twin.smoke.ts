/**
 * Terminal Twin browser smoke tests (seam 3: the dev-only `window.__tt` API).
 * Run with `npm run test:smoke` (not part of `npm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type { RunSummary } from '../../engine'
import golden from '../../scenario/fixtures/tracer-1sts-10-boxes.golden.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing

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
  await page.evaluate(() => window.__tt!.setSpeed(1))
  const ratio1 = await page.evaluate(async () => {
    const tt = window.__tt!
    const a = { sim: tt.clock().displayTime, wall: performance.now() }
    await new Promise((r) => setTimeout(r, 4000))
    const b = { sim: tt.clock().displayTime, wall: performance.now() }
    return (b.sim - a.sim) / ((b.wall - a.wall) / 1000)
  })
  expect(ratio1).toBeGreaterThan(0.95)
  expect(ratio1).toBeLessThan(1.05)

  await page.evaluate(() => window.__tt!.setSpeed(600))
  const frames = await page.evaluate(async () => {
    const tt = window.__tt!
    const samples: { sim: number; wall: number; frames: number }[] = []
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
      const tick = () => {
        samples.push({ sim: tt.clock().displayTime, wall: performance.now(), frames: tt.scene()?.frames ?? 0 })
        if (performance.now() - t0 < 1000) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    return samples
  })
  const first = frames[0]
  const last = frames[frames.length - 1]
  expect(last.frames - first.frames).toBeGreaterThanOrEqual(10)
  // Display time advanced on every frame (never stalled waiting for the engine) at ~×600.
  for (let i = 1; i < frames.length; i++) expect(frames[i].sim).toBeGreaterThan(frames[i - 1].sim)
  const rate = (last.sim - first.sim) / ((last.wall - first.wall) / 1000)
  expect(rate).toBeGreaterThan(600 * 0.9)
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
  await dialog.getByLabel('Seed').fill('7')
  await dialog.getByRole('button', { name: 'Start' }).click()
  await expect(dialog).toBeHidden()
  await page.evaluate(() => window.__tt!.runUntil())
  const other = await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))
  expect(other.seed).toBe(7)
  expect(other.status).toBe('ended')
  expect(other.eventLogHash).not.toBe(golden.eventLogHash)
})

test('mid-run screenshot', async ({ page }) => {
  await openTracer(page)
  await page.evaluate(() => window.__tt!.runTo(420))
  await page.evaluate(() => window.__tt!.pause())
  await page.waitForTimeout(500)
  await page.screenshot({ path: '.screenshots/terminal-twin-smoke-midrun.png' })
})
