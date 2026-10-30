/**
 * TT-13 browser smoke test: trucks queue at the gate, stand in transfer stalls, and leave.
 * Run with `pnpm run test:smoke` (not part of `pnpm test`).
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

test('trucks render, queue at the gate, stand in stalls and exit', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('truck-gate-queue'))
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)

  await page.evaluate(() => window.__tt!.runTo(3300))
  await page.waitForFunction(() => (window.__tt!.scene()?.landside.trucks ?? 0) > 5)
  const queued = await page.evaluate(() => window.__tt!.scene()!.landside)
  expect(queued.queued).toBeGreaterThan(3) // a visible queue at the gate

  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'TruckAtStall' }))
  const stalled = await page.evaluate(() => Object.values(window.__tt!.sceneState()!.trucks).find((t) => t.status === 'at-stall'))
  expect(stalled?.visible).toBe(true)

  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'TruckDeparted' }))
  const state = await page.evaluate(() => window.__tt!.sceneState()!)
  expect(Object.values(state.trucks).some((t) => !t.visible || t.status === 'gone')).toBe(true)
  expect(errors).toEqual([])
})

test('holding positions are drawn and admitted trucks wait in them off the roads (TT-R16)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('truck-holding-overflow'))
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)

  // the two configured positions are drawn
  expect((await page.evaluate(() => window.__tt!.scene()!.landside)).holdingPositions).toBe(2)

  // run until both positions are taken and a further truck waits outside the gate
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'TruckHeldOutside' }))
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'TruckAtHolding' }))
  await page.waitForFunction(() => (window.__tt!.scene()?.landside.holding ?? 0) >= 1)
  const trucks = await page.evaluate(() => Object.values(window.__tt!.sceneState()!.trucks))
  const waiting = trucks.filter((t) => t.status === 'holding')
  expect(waiting.length).toBeGreaterThan(0)
  expect(waiting.every((t) => t.visible)).toBe(true)
  expect(trucks.some((t) => t.status === 'queued')).toBe(true) // the overflow waits at the gate

  // look at the holding area (a screenshot to inspect by eye)
  await page.evaluate(() => window.__tt!.cameraTo('holding', 90))
  await page.waitForTimeout(1500)
  await page.screenshot({ path: process.env.TT_HOLDING_SHOT ?? 'test-results/holding.png' })

  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'TruckDeparted' }))
  expect(errors).toEqual([])
})
