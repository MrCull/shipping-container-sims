/**
 * Mouse wheel smoke (spec #293, modules/wheelZoom.ts; root cause of the old turning: docs/rendering-3d.md, Camera
 * controls): in a low-angle view a wheel zoom near either edge keeps heading, tilt and the ground point under the
 * cursor; a set pose drops a wheel zoom still easing in; middle-button drag still zooms without turning.
 * Dev-only `window.__tt` API. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import * as THREE from 'three'
import type {} from '../../dev/devApi' // window.__tt typing
import { groundPointUnder } from '../../modules/pinchGesture'
import { cameraAtPose, canvasPixelOf } from '../../modules/sceneCamera'
import { openTwin } from './openTwin'

const FIXTURE = 'landside-morning-peak'
/** About 10 degrees below the horizon at the centre: shallower than OrbitControls' tilt limit. */
const LOW_POSE = { target: { x: 0, y: 0, z: 0 }, distance: 300, azimuth: 0.6, polar: 1.4 }

type Pose = NonNullable<ReturnType<NonNullable<typeof window.__tt>['cameraPose']>>

const pose = async (page: Page): Promise<Pose> => (await page.evaluate(() => window.__tt!.cameraPose()))!

/** Waits until the camera pose holds still between two polls (the wheel zoom eases in over several frames). */
async function settled(page: Page): Promise<Pose> {
  await page.evaluate(() => {
    ;(window as unknown as { __wheelPrev?: unknown }).__wheelPrev = undefined
  })
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __wheelPrev?: { distance: number; azimuth: number } }
      const now = window.__tt!.cameraPose()!
      const prev = w.__wheelPrev
      w.__wheelPrev = now
      return !!prev && Math.abs(now.distance - prev.distance) < 1e-4 && Math.abs(now.azimuth - prev.azimuth) < 1e-6
    },
    undefined,
    { polling: 150, timeout: 6000 },
  )
  return pose(page)
}

async function open(page: Page, errors: string[]): Promise<{ x: number; y: number; width: number; height: number }> {
  page.on('pageerror', (err) => errors.push(err.message))
  await openTwin(page, { scenario: FIXTURE })
  await page.evaluate(() => window.__tt!.pause())
  return (await page.locator('canvas.tt-canvas').boundingBox())!
}

test('wheel zoom near either edge of a low-angle view keeps heading, tilt and the point under the cursor', async ({ page }) => {
  const errors: string[] = []
  const box = await open(page, errors)

  for (const [fx, deltaY] of [[0.06, -100], [0.94, -100], [0.06, 100], [0.94, 100]] as const) {
    expect(await page.evaluate((p) => window.__tt!.setCameraPose(p), LOW_POSE)).toBe(true)
    const p0 = await settled(page)
    const cursor = { x: box.width * fx, y: box.height * 0.7 }
    const grabbed = new THREE.Vector3()
    expect(groundPointUnder(cameraAtPose(p0, box.width, box.height), cursor, box.width, box.height, p0.target.y, grabbed)).not.toBeNull()
    await page.mouse.move(box.x + cursor.x, box.y + cursor.y)
    await page.mouse.wheel(0, deltaY)
    await page.waitForTimeout(60)
    await page.mouse.wheel(0, deltaY)
    const p1 = await settled(page)
    const label = `${deltaY < 0 ? 'in' : 'out'} at x=${Math.round(cursor.x)}`
    if (deltaY < 0) expect(p1.distance, label).toBeLessThan(p0.distance * 0.97)
    else expect(p1.distance, label).toBeGreaterThan(p0.distance * 1.03)
    expect(Math.abs(p1.azimuth - p0.azimuth), label).toBeLessThan(1e-3)
    expect(Math.abs(p1.polar - p0.polar), label).toBeLessThan(1e-3)
    const px = canvasPixelOf(cameraAtPose(p1, box.width, box.height), grabbed, box.width, box.height)
    expect(Math.hypot(px.x - cursor.x, px.y - cursor.y), label).toBeLessThan(4)
  }
  // the wheel zooms the view, never the page
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(errors).toEqual([])
})

test('a set pose drops a wheel zoom still easing in, and middle-button drag still zooms without turning', async ({ page }) => {
  const errors: string[] = []
  const box = await open(page, errors)

  // setCameraPose and cameraTo straight after wheel notches: the pose they set is final
  for (const write of ['setCameraPose', 'cameraTo'] as const) {
    expect(await page.evaluate((p) => window.__tt!.setCameraPose(p), LOW_POSE)).toBe(true)
    await settled(page)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7)
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100)
    const wanted = write === 'setCameraPose'
      ? await page.evaluate((p) => (window.__tt!.setCameraPose({ ...p, distance: 250 }) ? 250 : null), LOW_POSE)
      : await page.evaluate(() => (window.__tt!.cameraTo('gate', 250) ? 250 : null))
    expect(wanted, write).toBe(250)
    const after = await settled(page)
    expect(after.distance, write).toBeCloseTo(250, 3)
  }

  // middle-button drag: OrbitControls' dolly towards the target, heading and target unchanged
  expect(await page.evaluate((p) => window.__tt!.setCameraPose(p), LOW_POSE)).toBe(true)
  const p0 = await settled(page)
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5)
  await page.mouse.down({ button: 'middle' })
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5 + i * 12)
  await page.mouse.up({ button: 'middle' })
  const p1 = await settled(page)
  expect(Math.abs(Math.log(p1.distance / p0.distance))).toBeGreaterThan(0.02)
  expect(Math.abs(p1.azimuth - p0.azimuth)).toBeLessThan(1e-3)
  expect(Math.abs(p1.polar - p0.polar)).toBeLessThan(1e-3)
  expect(Math.hypot(p1.target.x - p0.target.x, p1.target.z - p0.target.z)).toBeLessThan(1e-3)
  expect(errors).toEqual([])
})
