/**
 * Phone browser smoke: the view fits a 390 px screen (an over-wide top bar used to stretch the 3D canvas far past
 * the right edge), the HUD groups start collapsed and expand on tap, H restores them, and a two-finger pinch zooms
 * about the ground point between the fingers without turning or sliding the view (modules/pinchGesture.ts).
 * Dev-only `window.__tt` API. Run with `pnpm run test:smoke`.
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test'
import * as THREE from 'three'
import type {} from '../../dev/devApi' // window.__tt typing

const FIXTURE = 'landside-morning-peak'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

/** Two fingers `from` px apart around (cx, cy), spreading to `to` px while their midpoint moves by (dx, dy). */
async function pinch(page: Page, cdp: CDPSession, cx: number, cy: number, from: number, to: number, dx = 0, dy = 0, steps = 8): Promise<void> {
  const points = (f: number) => {
    const half = (from + (to - from) * f) / 2
    return [
      { x: cx + dx * f - half, y: cy + dy * f, id: 1 },
      { x: cx + dx * f + half, y: cy + dy * f, id: 2 },
    ]
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(i / steps) })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(100)
}

type Pose = NonNullable<ReturnType<NonNullable<typeof window.__tt>['cameraPose']>>

/** The ground point (y = target.y) under a canvas pixel for an orbit pose (the view's 45 degree camera). */
function groundUnder(pose: Pose, px: number, py: number, w: number, h: number): THREE.Vector3 {
  const camera = new THREE.PerspectiveCamera(45, w / h, 1, 14000)
  const target = new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z)
  camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(pose.distance, pose.polar, pose.azimuth)))
  camera.lookAt(target)
  camera.updateMatrixWorld()
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), camera)
  const out = new THREE.Vector3()
  expect(ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -target.y), out)).not.toBeNull()
  return out
}

/** The fixed point of a zoom from `a` to `b` (camera and target scaled about one ground point). */
function anchorOf(a: Pose, b: Pose): { x: number; z: number } {
  const s = b.distance / a.distance
  return { x: a.target.x + (b.target.x - a.target.x) / (1 - s), z: a.target.z + (b.target.z - a.target.z) / (1 - s) }
}

test('phone: the view fits the screen, HUD collapses, pinch zooms about the fingers', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), FIXTURE)
  await page.evaluate(() => window.__tt!.pause())
  await expect(page.getByTestId('tt-topbar')).toBeVisible()

  // Nothing wider than the screen.
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
  const canvas = await page.locator('canvas.tt-canvas').boundingBox()
  expect(canvas!.x + canvas!.width).toBeLessThanOrEqual(391)

  // Narrow screen, nothing stored: every HUD group starts collapsed; each expands on tap; H toggles all.
  await expect(page.getByTestId('tt-kpi-expand')).toBeVisible()
  await expect(page.getByTestId('tt-overlays-expand')).toBeVisible()
  await expect(page.getByTestId('tt-settings')).toBeHidden()
  await page.getByTestId('tt-kpi-expand').click()
  await expect(page.getByTestId('tt-kpi-strip')).toBeVisible()
  await page.getByTestId('tt-kpi-collapse').click()
  await expect(page.getByTestId('tt-kpi-expand')).toBeVisible()
  await page.getByTestId('tt-topbar-toggle').click()
  await expect(page.getByTestId('tt-settings')).toBeVisible()
  await page.keyboard.press('h') // not all collapsed: collapse all
  await expect(page.getByTestId('tt-settings')).toBeHidden()
  await page.keyboard.press('h') // all collapsed: restore all
  await expect(page.getByTestId('tt-settings')).toBeVisible()
  await expect(page.getByTestId('tt-kpi-strip')).toBeVisible()
  await expect(page.getByTestId('tt-overlays-collapse')).toBeVisible()
  await page.keyboard.press('h')

  // Pinch off-centre, twice: both zooms keep the same ground point fixed, and the view does not turn.
  expect(await page.evaluate(() => window.__tt!.setCameraPose({ target: { x: 0, y: 0, z: 0 }, distance: 300, azimuth: 0.6, polar: 0.9 }))).toBe(true)
  const box = (await page.locator('canvas.tt-canvas').boundingBox())!
  const cx = box.x + box.width * 0.78
  const cy = box.y + box.height * 0.7
  const cdp = await page.context().newCDPSession(page)
  const p0 = (await page.evaluate(() => window.__tt!.cameraPose()))!
  await pinch(page, cdp, cx, cy, 80, 160)
  const p1 = (await page.evaluate(() => window.__tt!.cameraPose()))!
  await pinch(page, cdp, cx, cy, 80, 140)
  const p2 = (await page.evaluate(() => window.__tt!.cameraPose()))!

  expect(p1.distance).toBeLessThan(p0.distance * 0.7)
  expect(p2.distance).toBeLessThan(p1.distance * 0.8)
  for (const p of [p1, p2]) {
    expect(Math.abs(p.azimuth - p0.azimuth)).toBeLessThan(1e-3)
    expect(Math.abs(p.polar - p0.polar)).toBeLessThan(1e-3)
  }
  const a1 = anchorOf(p0, p1)
  const a2 = anchorOf(p1, p2)
  // the anchor is the off-centre ground point under the fingers, not the orbit target
  expect(Math.hypot(a1.x - p0.target.x, a1.z - p0.target.z)).toBeGreaterThan(20)
  expect(Math.hypot(a2.x - a1.x, a2.z - a1.z)).toBeLessThan(1)

  // Pinch while the fingers travel: the ground point first touched ends up under the fingers again.
  expect(await page.evaluate(() => window.__tt!.setCameraPose({ target: { x: 0, y: 0, z: 0 }, distance: 200, azimuth: 0.6, polar: 1.1 }))).toBe(true)
  const q0 = (await page.evaluate(() => window.__tt!.cameraPose()))!
  const start = { x: box.width * 0.6, y: box.height * 0.65 }
  const move = { x: -120, y: -150 }
  const grabbed = groundUnder(q0, start.x, start.y, box.width, box.height)
  await pinch(page, cdp, box.x + start.x, box.y + start.y, 100, 150, move.x, move.y, 12)
  const q1 = (await page.evaluate(() => window.__tt!.cameraPose()))!
  const under = groundUnder(q1, start.x + move.x, start.y + move.y, box.width, box.height)
  expect(q1.distance).toBeLessThan(q0.distance * 0.8)
  expect(under.distanceTo(grabbed)).toBeLessThan(0.02 * q1.distance)
  expect(errors).toEqual([])
})
