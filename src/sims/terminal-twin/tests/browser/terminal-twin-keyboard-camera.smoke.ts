/**
 * TT-R03 browser smoke: held camera keys move the orbit camera (W pans forward, Shift+→ orbits, = zooms in), releasing
 * stops it, typing in a field never moves it, a camera key releases follow mode, and the dashboard is on B.
 * Dev-only `window.__tt` API. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

const pose = (page: Page) => page.evaluate(() => window.__tt!.cameraPose()!)

async function open(page: Page): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), 'landside-morning-peak')
  await page.evaluate(() => window.__tt!.runUntil({ maxEvents: 400 }))
  await expect(page.getByTestId('tt-kpi-strip')).toBeVisible()
  await page.evaluate(() => window.__tt!.viewPreset('overview'))
}

test('held keys pan, orbit and zoom; release stops; typing is ignored; follow is released', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await open(page)

  // W: target moves forward along the heading (away from the camera on the ground plane).
  const p0 = await pose(page)
  const heading = { x: -Math.sin(p0.azimuth), z: -Math.cos(p0.azimuth) }
  await page.keyboard.down('w')
  await page.waitForTimeout(600)
  await page.keyboard.up('w')
  const p1 = await pose(page)
  const moved = { x: p1.target.x - p0.target.x, z: p1.target.z - p0.target.z }
  expect(moved.x * heading.x + moved.z * heading.z).toBeGreaterThan(1)
  expect(p1.distance).toBeCloseTo(p0.distance, 3)

  // Release stops: the pose stays put once the key is up.
  await page.waitForTimeout(300)
  const p1b = await pose(page)
  expect(p1b.target.x).toBeCloseTo(p1.target.x, 3)
  expect(p1b.target.z).toBeCloseTo(p1.target.z, 3)

  // Shift+Right: orbit (azimuth changes, target stays).
  await page.keyboard.down('Shift')
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(600)
  await page.keyboard.up('ArrowRight')
  await page.keyboard.up('Shift')
  const p2 = await pose(page)
  expect(Math.abs(p2.azimuth - p1b.azimuth)).toBeGreaterThan(0.05)
  expect(p2.target.x).toBeCloseTo(p1b.target.x, 3)
  expect(p2.target.z).toBeCloseTo(p1b.target.z, 3)

  // =: zoom in (distance shrinks).
  await page.keyboard.down('=')
  await page.waitForTimeout(600)
  await page.keyboard.up('=')
  const p3 = await pose(page)
  expect(p3.distance).toBeLessThan(p2.distance)

  // Typing in a field never moves the camera.
  await page.getByRole('button', { name: 'Run to…' }).click()
  const field = page.getByLabel('Target sim time')
  await field.focus()
  for (const key of ['w', 'a', 's', 'd', 'ArrowLeft', 'ArrowUp', '=', '-', 'Shift+ArrowRight']) await field.press(key)
  await page.keyboard.down('w')
  await page.waitForTimeout(300)
  await page.keyboard.up('w')
  expect(await pose(page)).toEqual(p3)
  await page.keyboard.press('Escape')

  // A camera key releases follow mode.
  const truck = await page.evaluate(async () => {
    await window.__tt!.runUntil({ eventType: 'TruckArrived' })
    return Object.keys(window.__tt!.sceneState()!.trucks)[0]
  })
  await page.evaluate((id) => window.__tt!.select(id), truck)
  await page.getByTestId('tt-follow').click()
  expect((await page.evaluate(() => window.__tt!.ui())).following).toBe(true)
  await page.mouse.move(10, 10)
  await page.keyboard.press('a')
  expect((await page.evaluate(() => window.__tt!.ui())).following).toBe(false)

  // The dashboard is on B, not D.
  await page.keyboard.press('d')
  await expect(page.getByTestId('tt-dashboard')).toBeHidden()
  await page.keyboard.press('b')
  await expect(page.getByTestId('tt-dashboard')).toBeVisible()
  await page.keyboard.press('b')
  await expect(page.getByTestId('tt-dashboard')).toBeHidden()
  expect(errors).toEqual([])
})
