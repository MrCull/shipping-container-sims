/**
 * V11-06 browser smoke: "Follow next truck" on the landside fixture. While paused it waits for an arrival and resolves
 * once the engine runs on; the camera tracks the truck until it is gone, then follow releases (here at x60).
 * Dev-only `window.__tt` API. Run with `npm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import { overlappingRegions } from '../../modules/hudLayout'
import type {} from '../../dev/devApi' // window.__tt typing

async function open(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('landside-morning-peak'))
  await page.evaluate(() => window.__tt!.pause())
  return errors
}

const ui = (page: Page) => page.evaluate(() => window.__tt!.ui())

test('paused: waits for the next arrival, then follows that truck until it is gone', async ({ page }) => {
  const errors = await open(page)
  // nothing is known at t = 0: the request stays pending
  expect(await page.evaluate(() => window.__tt!.followNextTruck())).toBeNull()
  expect((await ui(page)).followNextPending).toBe(true)
  // the engine runs on to the first arrival: the request resolves to that truck
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'TruckArrived' }))
  await expect.poll(async () => (await ui(page)).following).toBe(true)
  const state = await ui(page)
  expect(state.followNextPending).toBe(false)
  const truck = state.selectedId!
  expect(truck).toMatch(/^T\d+$/)

  // play at x60: the camera target tracks the truck while it is in the terminal, then follow releases
  await page.evaluate(() => {
    window.__tt!.setSpeed(60)
    window.__tt!.play()
  })
  let tracked = 0
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(() => ({ cam: window.__tt!.cameraTarget(), trucks: window.__tt!.sceneState()!.trucks, ui: window.__tt!.ui() }))
        const pose = s.trucks[truck]
        if (s.ui.following && pose?.visible && s.cam && Math.hypot(s.cam.x - pose.x, s.cam.z - pose.z) < 40) tracked++
        return s.ui.following
      },
      { timeout: 90_000, intervals: [200] },
    )
    .toBe(false)
  expect(tracked).toBeGreaterThan(0)
  expect(errors).toEqual([])
})

test('the button and N work, and the HUD regions still do not overlap', async ({ page }) => {
  const errors = await open(page)
  await page.getByTestId('tt-follow-next-truck').click()
  expect((await ui(page)).followNextPending).toBe(true)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'TruckArrived' }))
  await expect.poll(async () => (await ui(page)).following).toBe(true)
  await page.keyboard.press('Escape')
  expect((await ui(page)).following).toBe(false)
  // N takes the next arrival at or after the display time. The first truck arrived exactly at that time, so it is already
  // known and follow starts at once (nothing pending). Running on would release follow again: the truck leaves the terminal.
  await page.keyboard.press('n')
  await expect.poll(async () => (await ui(page)).following).toBe(true)
  const second = await ui(page)
  expect(second.followNextPending).toBe(false)
  expect(second.selectedId).toMatch(/^T\d+$/)
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog')).toContainText('Follow the next truck to arrive')
  await page.keyboard.press('Escape')
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size)
    expect(overlappingRegions((await page.evaluate(() => window.__tt!.hudLayout()))!), `${size.width}x${size.height}`).toEqual([])
  }
  expect(errors).toEqual([])
})
