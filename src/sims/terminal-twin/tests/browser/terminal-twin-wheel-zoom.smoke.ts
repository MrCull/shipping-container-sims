/**
 * Mouse wheel smoke (spec #293): in a low-angle view, a wheel zoom near the left or right edge of the 3D view keeps
 * the heading and tilt and keeps the ground point under the cursor in place. OrbitControls' zoomToCursor turned such
 * views left or right (modules/pinchGesture.ts, WheelZoom). Dev-only `window.__tt` API. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import * as THREE from 'three'
import type {} from '../../dev/devApi' // window.__tt typing

const FIXTURE = 'landside-morning-peak'

type Pose = NonNullable<ReturnType<NonNullable<typeof window.__tt>['cameraPose']>>

/** The view's 45 degree camera for an orbit pose on a canvas of `w` by `h` px. */
function cameraFor(pose: Pose, w: number, h: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, w / h, 1, 14000)
  const target = new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z)
  camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(pose.distance, pose.polar, pose.azimuth)))
  camera.lookAt(target)
  camera.updateMatrixWorld()
  return camera
}

/** The ground point (y = target.y) under a canvas pixel. */
function groundUnder(pose: Pose, px: number, py: number, w: number, h: number): THREE.Vector3 {
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), cameraFor(pose, w, h))
  const out = new THREE.Vector3()
  expect(ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -pose.target.y), out)).not.toBeNull()
  return out
}

/** Canvas pixel where a world point lands. */
function pixelOf(pose: Pose, p: THREE.Vector3, w: number, h: number): { x: number; y: number } {
  const v = p.clone().project(cameraFor(pose, w, h))
  return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h }
}

const pose = async (page: Page): Promise<Pose> => (await page.evaluate(() => window.__tt!.cameraPose()))!

/** Waits until the camera has stopped moving (the wheel zoom eases in over several frames). */
async function settled(page: Page): Promise<Pose> {
  let last = await pose(page)
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150)
    const now = await pose(page)
    if (Math.abs(now.distance - last.distance) < 1e-4 && Math.abs(now.azimuth - last.azimuth) < 1e-6) return now
    last = now
  }
  return last
}

test('wheel zoom near either edge of a low-angle view keeps heading, tilt and the point under the cursor', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), FIXTURE)
  await page.evaluate(() => window.__tt!.pause())
  const box = (await page.locator('canvas.tt-canvas').boundingBox())!

  for (const [fx, deltaY] of [[0.06, -100], [0.94, -100], [0.06, 100], [0.94, 100]] as const) {
    // about 10 degrees below the horizon at the centre: shallower than OrbitControls' tilt limit
    expect(await page.evaluate(() => window.__tt!.setCameraPose({ target: { x: 0, y: 0, z: 0 }, distance: 300, azimuth: 0.6, polar: 1.4 }))).toBe(true)
    const p0 = await settled(page)
    const cursor = { x: box.width * fx, y: box.height * 0.7 }
    const grabbed = groundUnder(p0, cursor.x, cursor.y, box.width, box.height)
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
    const px = pixelOf(p1, grabbed, box.width, box.height)
    expect(Math.hypot(px.x - cursor.x, px.y - cursor.y), label).toBeLessThan(4)
  }
  // the wheel zooms the view, never the page
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(errors).toEqual([])
})
