/**
 * V11-04 browser smoke: `cameraTo` aims at every entity kind and follow releases when a truck leaves.
 * Dev-only `window.__tt` API. Run with `pnpm run test:smoke`.
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

const FIXTURE = 'landside-morning-peak'

test('cameraTo works for every entity kind and follow ends when the truck leaves', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), FIXTURE)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'TruckArrived' }))
  const ids = await page.evaluate(() => {
    const s = window.__tt!.sceneState()!
    return { truck: Object.keys(s.trucks)[0], sts: Object.keys(s.sts)[0], shc: Object.keys(s.shcs)[0], asc: Object.keys(s.ascs)[0], vessel: Object.keys(s.vessels)[0] }
  })
  for (const id of [ids.truck, ids.sts, ids.shc, ids.asc, ids.vessel, 'gate', 'stalls:B01', 'B01', 'B01-WTP1', 'B01-TS1']) {
    expect(await page.evaluate((i) => window.__tt!.cameraTo(i), id), id).toBe(true)
  }
  expect(await page.evaluate(() => window.__tt!.cameraTo('NOPE'))).toBe(false)

  // Follow a truck; run far enough that it has left the terminal.
  await page.evaluate((id) => window.__tt!.select(id), ids.truck)
  await page.getByTestId('tt-follow').click()
  expect((await page.evaluate(() => window.__tt!.ui())).following).toBe(true)
  await page.evaluate(() => window.__tt!.runTo(3 * 3600))
  await expect.poll(async () => (await page.evaluate(() => window.__tt!.ui())).following).toBe(false)
  expect(errors).toEqual([])
})
