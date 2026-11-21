// Mouse wheel zoom (spec #293): eases towards the ground point under the cursor, never turning the view.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { groundPointUnder } from '../modules/pinchGesture'
import { cameraAtPose, canvasPixelOf } from '../modules/sceneCamera'
import { DOM_DELTA_LINE, DOM_DELTA_PAGE, DOM_DELTA_PIXEL, WHEEL_ANCHOR_RANGE, WheelZoom } from '../modules/wheelZoom'

const WW = 1200
const WH = 700
const LIMITS = { minDistance: 8, maxDistance: 3500 }
const FRAME = 1 / 60

/** A low-angle view (about 10 degrees below the horizon at the centre), where OrbitControls' zoomToCursor turned the view. */
function lowRig(polar = 1.4, distance = 300): { camera: THREE.PerspectiveCamera; target: THREE.Vector3 } {
  const camera = cameraAtPose({ target: { x: 50, y: 0, z: -20 }, distance, azimuth: 0.7, polar }, WW, WH)
  return { camera, target: new THREE.Vector3(50, 0, -20) }
}

function angles(camera: THREE.PerspectiveCamera, target: THREE.Vector3): THREE.Spherical {
  return new THREE.Spherical().setFromVector3(camera.position.clone().sub(target))
}

const pixelOf = (camera: THREE.PerspectiveCamera, p: THREE.Vector3): { x: number; y: number } => canvasPixelOf(camera, p, WW, WH)

function wheelGround(camera: THREE.PerspectiveCamera, x: number, y: number): THREE.Vector3 {
  const out = new THREE.Vector3()
  expect(groundPointUnder(camera, { x, y }, WW, WH, 0, out)).not.toBeNull()
  return out
}

/** Runs frames of `dt` seconds until the zoom has settled; checks `each` after every frame. Returns the frame count. */
function settle(zoom: WheelZoom, camera: THREE.PerspectiveCamera, target: THREE.Vector3, each?: () => void, dt = FRAME): number {
  let frames = 0
  while (zoom.active && frames < 2000) {
    zoom.step(camera, target, WW, WH, LIMITS, dt)
    each?.()
    frames++
  }
  return frames
}

describe('WheelZoom', () => {
  for (const [side, x] of [['left', 40], ['right', WW - 40]] as const) {
    for (const [dir, deltaY] of [['in', -100], ['out', 100]] as const) {
      it(`zooms ${dir} at the ${side} edge of a low-angle view without turning, keeping the point under the cursor`, () => {
        const { camera, target } = lowRig()
        const before = angles(camera, target)
        const cursor = { x, y: WH * 0.62 }
        const grabbed = wheelGround(camera, cursor.x, cursor.y)
        const zoom = new WheelZoom()
        zoom.add(deltaY, DOM_DELTA_PIXEL, cursor)
        zoom.add(deltaY, DOM_DELTA_PIXEL, cursor)
        const r0 = camera.position.distanceTo(target)
        const frames = settle(zoom, camera, target, () => {
          const a = angles(camera, target)
          expect(Math.abs(a.theta - before.theta)).toBeLessThan(1e-9)
          expect(Math.abs(a.phi - before.phi)).toBeLessThan(1e-9)
          const px = pixelOf(camera, grabbed)
          expect(Math.hypot(px.x - cursor.x, px.y - cursor.y)).toBeLessThan(0.5)
        })
        expect(frames).toBeGreaterThan(2) // eased over several frames, not one jump
        expect(zoom.active).toBe(false)
        const r1 = camera.position.distanceTo(target)
        expect(r1 / r0).toBeCloseTo(deltaY < 0 ? 0.95 ** 2 : 0.95 ** -2, 4)
      })
    }
  }

  it('zooms straight towards the target when the cursor is on the sky', () => {
    const { camera, target } = lowRig(1.5)
    const before = angles(camera, target)
    const t0 = target.clone()
    const zoom = new WheelZoom()
    zoom.add(-100, DOM_DELTA_PIXEL, { x: 100, y: 5 })
    settle(zoom, camera, target)
    expect(target.distanceTo(t0)).toBeLessThan(1e-6)
    const a = angles(camera, target)
    expect(a.radius).toBeCloseTo(before.radius * 0.95, 4)
    expect(Math.abs(a.theta - before.theta)).toBeLessThan(1e-9)
    expect(Math.abs(a.phi - before.phi)).toBeLessThan(1e-9)
  })

  it('zooms straight towards the target when the ground under the cursor is far beyond the orbit radius (grazing ray)', () => {
    const { camera, target } = lowRig(1.5)
    const before = angles(camera, target)
    const t0 = target.clone()
    // the highest canvas row whose ground point is still under 20 km away but past the anchor range
    let cursorY = -1
    for (let y = 0; y < WH / 2; y++) {
      const g = new THREE.Vector3()
      if (groundPointUnder(camera, { x: 600, y }, WW, WH, 0, g) && g.distanceTo(camera.position) > before.radius * WHEEL_ANCHOR_RANGE * 1.5) {
        cursorY = y
        break
      }
    }
    expect(cursorY).toBeGreaterThan(0)
    const zoom = new WheelZoom()
    zoom.add(-100, DOM_DELTA_PIXEL, { x: 600, y: cursorY })
    settle(zoom, camera, target)
    expect(target.distanceTo(t0)).toBeLessThan(1e-6) // the pivot did not swing towards the horizon
    const a = angles(camera, target)
    expect(a.radius).toBeCloseTo(before.radius * 0.95, 4)
    expect(Math.abs(a.theta - before.theta)).toBeLessThan(1e-9)
  })

  for (const [limit, deltaY, start] of [['minimum', -100, 12], ['maximum', 100, 3000]] as const) {
    it(`stops cleanly at the ${limit} distance with no sideways shift and nothing pending`, () => {
      const { camera, target } = lowRig(1.2, start)
      const zoom = new WheelZoom()
      const cursor = { x: 200, y: WH * 0.8 }
      for (let i = 0; i < 40; i++) zoom.add(deltaY, DOM_DELTA_PIXEL, cursor)
      settle(zoom, camera, target)
      expect(zoom.active).toBe(false)
      const limitDistance = limit === 'minimum' ? LIMITS.minDistance : LIMITS.maxDistance
      expect(camera.position.distanceTo(target)).toBeCloseTo(limitDistance, 6)
      const cam = camera.position.clone()
      const tgt = target.clone()
      zoom.add(deltaY, DOM_DELTA_PIXEL, cursor)
      settle(zoom, camera, target)
      expect(camera.position.distanceTo(cam)).toBeLessThan(1e-9)
      expect(target.distanceTo(tgt)).toBeLessThan(1e-9)
    })
  }

  for (const [limit, deltaY, start, end] of [['8 m', -100, 8.2, 8], ['3,500 m', 100, 3450, 3500]] as const) {
    it(`a step that crosses the ${limit} limit stops at it, without turning or sliding the point under the cursor, and clears the rest`, () => {
      const { camera, target } = lowRig(1.2, start)
      const before = angles(camera, target)
      const cursor = { x: 300, y: WH * 0.75 }
      const grabbed = wheelGround(camera, cursor.x, cursor.y)
      const zoom = new WheelZoom()
      zoom.add(deltaY, DOM_DELTA_PIXEL, cursor) // one notch (5 %) is more than the room left: some step must cross
      let crossed = false
      settle(zoom, camera, target, () => {
        const a = angles(camera, target)
        expect(Math.abs(a.theta - before.theta)).toBeLessThan(1e-9)
        expect(Math.abs(a.phi - before.phi)).toBeLessThan(1e-9)
        const px = pixelOf(camera, grabbed)
        expect(Math.hypot(px.x - cursor.x, px.y - cursor.y)).toBeLessThan(0.5)
        if (Math.abs(a.radius - end) < 1e-6) {
          crossed = true
          expect(zoom.active).toBe(false) // the step that reached the limit dropped what was left
        }
      })
      expect(crossed).toBe(true)
      expect(camera.position.distanceTo(target)).toBeCloseTo(end, 6)
    })
  }

  it('zooms about 5% per mouse notch in pixel, line and page modes, and proportionally for a trackpad', () => {
    const ratio = (deltaY: number, mode: number): number => {
      const { camera, target } = lowRig()
      const r0 = camera.position.distanceTo(target)
      const zoom = new WheelZoom()
      zoom.add(deltaY, mode, { x: WW / 2, y: WH / 2 })
      settle(zoom, camera, target)
      return camera.position.distanceTo(target) / r0
    }
    expect(ratio(-100, DOM_DELTA_PIXEL)).toBeCloseTo(0.95, 4)
    expect(ratio(-3, DOM_DELTA_LINE)).toBeCloseTo(0.95, 4) // Firefox: three lines a notch
    expect(ratio(-1, DOM_DELTA_PAGE)).toBeLessThan(0.95) // a page is at least a notch
    expect(Math.log(ratio(-4, DOM_DELTA_PIXEL))).toBeCloseTo(Math.log(0.95) * 0.04, 6)
  })

  it('eases in by wall time: 30 fps reaches the same zoom as 60 fps after the same time', () => {
    const after = (dt: number, seconds: number): number => {
      const { camera, target } = lowRig()
      const r0 = camera.position.distanceTo(target)
      const zoom = new WheelZoom()
      zoom.add(-300, DOM_DELTA_PIXEL, { x: WW / 2, y: WH / 2 })
      for (let t = 0; t < seconds - 1e-9; t += dt) zoom.step(camera, target, WW, WH, LIMITS, dt)
      return camera.position.distanceTo(target) / r0
    }
    for (const seconds of [0.1, 0.2]) {
      const at60 = after(1 / 60, seconds)
      expect(at60).toBeLessThan(1) // still easing in, part of the way there
      expect(at60).toBeGreaterThan(0.95 ** 3)
      expect(after(1 / 30, seconds)).toBeCloseTo(at60, 6)
    }
  })

  it('adds quick notches and drains them fully', () => {
    const { camera, target } = lowRig()
    const r0 = camera.position.distanceTo(target)
    const zoom = new WheelZoom()
    const cursor = { x: 900, y: 500 }
    zoom.add(-100, DOM_DELTA_PIXEL, cursor)
    zoom.step(camera, target, WW, WH, LIMITS, FRAME)
    zoom.add(-100, DOM_DELTA_PIXEL, cursor)
    zoom.add(-100, DOM_DELTA_PIXEL, cursor)
    settle(zoom, camera, target)
    expect(camera.position.distanceTo(target) / r0).toBeCloseTo(0.95 ** 3, 4)
  })

  it('keeps the orbit target on the screen-centre ray at ground height after every step', () => {
    const { camera, target } = lowRig()
    const zoom = new WheelZoom()
    zoom.add(-300, DOM_DELTA_PIXEL, { x: 100, y: 600 })
    settle(zoom, camera, target, () => {
      expect(target.y).toBe(0)
      const centre = wheelGround(camera, WW / 2, WH / 2)
      expect(centre.distanceTo(target)).toBeLessThan(1e-6 * camera.position.distanceTo(target) + 1e-6)
    })
    zoom.add(500, DOM_DELTA_PIXEL, { x: 1100, y: 450 })
    settle(zoom, camera, target, () => {
      const centre = wheelGround(camera, WW / 2, WH / 2)
      expect(centre.distanceTo(target)).toBeLessThan(1e-6 * camera.position.distanceTo(target) + 1e-6)
    })
  })
})
