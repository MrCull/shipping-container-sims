/**
 * TT-05 browser smoke tests: SHC animation in the frame loop and the lane-graph and reservation overlay buttons, through
 * the dev-only `window.__tt` API. The SHC scene checks run in the headless scene (`headless-scene-engine.test.ts`) and
 * the setup dialog in `terminal-twin-setup-equipment.smoke.ts` (#333). Run with `pnpm run test:smoke` (not `pnpm test`).
 */
import { type Page } from '@playwright/test'
import { expect, test } from './twinTest'
import type {} from '../../dev/devApi' // window.__tt typing
import { sampleFrames, simPerWallSecond, advancedFraction, neverBackwards } from './frameSampling'
import { openTwin } from './openTwin'

const FIXTURE = 'shc-1sts-2shc-1wtp'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function openShc(page: Page): Promise<void> {
  await openTwin(page, { scenario: FIXTURE })
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

test('SHCs animate smoothly at ×1 and keep animating every frame at ×600', { tag: '@equipment' }, async ({ page }) => {
  await openShc(page)
  // Start as SHC01 sets off empty towards the first box.
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'ShcRoutingEmpty' }))
  await page.evaluate(() => window.__tt!.setSpeed(1))
  const slow = await sampleFrames(page, { minWallMs: 2000, withShcs: true })
  const vMax = 8.3 // m/s, default empty SHC speed
  let moved = 0
  for (let i = 1; i < slow.length; i++) {
    const dt = slow[i].sim - slow[i - 1].sim
    for (const [id, p] of Object.entries(slow[i].shcs)) {
      const q = slow[i - 1].shcs[id]
      const step = Math.abs(p.x - q.x) + Math.abs(p.z - q.z)
      // no teleporting: never faster than the SHC's top speed (+ rounding)
      expect(step, `${id} at sim ${slow[i].sim}`).toBeLessThanOrEqual(vMax * dt + 0.05)
      moved += step
    }
  }
  expect(moved).toBeGreaterThan(1)

  await page.evaluate(() => window.__tt!.setSpeed(600))
  const fast = await sampleFrames(page, { minWallMs: 2000, withShcs: true })
  const first = fast[0]
  const last = fast[fast.length - 1]
  // Load-proof (V11-07): no absolute frame count; the clock must advance on every rendered frame at ~x600.
  expect(fast.length).toBeGreaterThanOrEqual(3)
  expect(last.frames).toBeGreaterThan(first.frames)
  expect(neverBackwards(fast)).toBe(true)
  expect(advancedFraction(fast)).toBeGreaterThanOrEqual(0.7)
  const rate = simPerWallSecond(fast)
  expect(rate).toBeGreaterThan(600 * 0.7)
  expect(rate).toBeLessThan(600 * 1.1)
  // SHC poses changed across the ×600 frames
  const changed = fast.some((s, i) => i > 0 && JSON.stringify(s.shcs) !== JSON.stringify(fast[i - 1].shcs))
  expect(changed).toBe(true)
})

test('lane-graph and reservation overlays toggle on and off', { tag: '@equipment' }, async ({ page }) => {
  const errors = collectErrors(page)
  await openShc(page)
  // Step through SHC01's first trip in 5 s runs until it holds reservations (they come and go as it moves), then pause.
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'ShcRoutingEmpty' }))
  await page.evaluate(async () => {
    const tt = window.__tt!
    for (let i = 0; i < 40 && Object.keys(tt.sceneState()!.reservations).length === 0; i++) { await tt.runTo(tt.clock().displayTime + 5); await new Promise((r) => setTimeout(r, 250)) }
  })
  await page.evaluate(() => window.__tt!.pause())
  const lanes = page.getByRole('button', { name: 'Lane graph' })
  const reservations = page.getByRole('button', { name: 'Reservations' })
  await expect(lanes).toHaveAttribute('aria-pressed', 'false')

  await lanes.click()
  await reservations.click()
  await expect(lanes).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() => page.evaluate(() => window.__tt!.scene()?.overlays))
    .toMatchObject({ laneGraph: true, reservations: true, occupancy: false, labels: false })
  const active = await page.evaluate(() => window.__tt!.sceneState()!.reservations)
  expect(Object.keys(active).length).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => window.__tt!.scene()?.reservedZones ?? 0)).toBe(Object.keys(active).length)
  await page.evaluate(() => window.__tt!.cameraTo('SHC01'))
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__tt!.renderOnce()) // render is off: draw the frame the screenshot keeps
  await page.screenshot({ path: '.screenshots/terminal-twin-smoke-shc-overlays.png' })

  await lanes.click()
  await reservations.click()
  await expect
    .poll(() => page.evaluate(() => window.__tt!.scene()?.overlays))
    .toMatchObject({ laneGraph: false, reservations: false, occupancy: false, labels: false })
  await expect.poll(() => page.evaluate(() => window.__tt!.scene()?.reservedZones)).toBe(0)
  expect(errors).toEqual([])
})

