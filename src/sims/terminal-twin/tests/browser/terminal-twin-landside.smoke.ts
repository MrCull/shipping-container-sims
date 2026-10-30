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
