import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyPinchStep, groundPointUnder, WheelZoom } from '../modules/pinchGesture'

const W = 390
const H = 700
const LIMITS = { minDistance: 8, maxDistance: 3500 }

function rig(): { camera: THREE.PerspectiveCamera; target: THREE.Vector3 } {
  const camera = new THREE.PerspectiveCamera(45, W / H, 1, 14000)
  const target = new THREE.Vector3(100, 0, -40)
  camera.position.set(160, 90, 60)
  camera.lookAt(target)
  camera.updateMatrixWorld()
  return { camera, target }
}

function groundAt(camera: THREE.PerspectiveCamera, x: number, y: number): THREE.Vector3 {
  const out = new THREE.Vector3()
  expect(groundPointUnder(camera, { x, y }, W, H, 0, out)).not.toBeNull()
  return out
}

describe('applyPinchStep', () => {
  it('keeps the ground point under an off-centre pinch in place while zooming in', () => {
    const { camera, target } = rig()
    const mid = { x: 300, y: 500 }
    const before = groundAt(camera, mid.x, mid.y)
    const radius = camera.position.distanceTo(target)
    applyPinchStep(camera, target, mid, mid, 2, W, H, LIMITS)
    expect(camera.position.distanceTo(target)).toBeCloseTo(radius / 2, 6)
    expect(groundAt(camera, mid.x, mid.y).distanceTo(before)).toBeLessThan(1e-6)
    expect(target.y).toBe(0)
  })

  it('does not turn the view while zooming', () => {
    const { camera, target } = rig()
    const dir = new THREE.Vector3().subVectors(target, camera.position).normalize()
    applyPinchStep(camera, target, { x: 50, y: 600 }, { x: 50, y: 600 }, 1.7, W, H, LIMITS)
    const after = new THREE.Vector3().subVectors(target, camera.position).normalize()
    expect(after.angleTo(dir)).toBeLessThan(1e-9)
  })

  it('pans so the touched ground point follows the fingers', () => {
    const { camera, target } = rig()
    const start = { x: 200, y: 450 }
    const end = { x: 120, y: 380 }
    const touched = groundAt(camera, start.x, start.y)
    applyPinchStep(camera, target, start, end, 1, W, H, LIMITS)
    // the pan is a plane translation, so the hit at the new midpoint lands within a hair of the touched point
    expect(groundAt(camera, end.x, end.y).distanceTo(touched)).toBeLessThan(1e-6)
  })

  it('clamps the orbit radius to the limits', () => {
    const { camera, target } = rig()
    applyPinchStep(camera, target, { x: 195, y: 350 }, { x: 195, y: 350 }, 1000, W, H, LIMITS)
    expect(camera.position.distanceTo(target)).toBeCloseTo(LIMITS.minDistance, 6)
  })

  it('zooms about the target when the fingers are above the horizon', () => {
    const { camera, target } = rig()
    camera.position.set(100, 5, 60)
    camera.lookAt(new THREE.Vector3(100, 5, -40)) // looking level: the top half of the screen is sky
    target.set(100, 0, -40)
    const t0 = target.clone()
    expect(applyPinchStep(camera, target, { x: 195, y: 10 }, { x: 195, y: 10 }, 2, W, H, LIMITS)).toBe(true)
    expect(target.distanceTo(t0)).toBeLessThan(1e-9)
  })

  it('ignores a degenerate spread', () => {
    const { camera, target } = rig()
    const p = camera.position.clone()
    expect(applyPinchStep(camera, target, { x: 1, y: 1 }, { x: 1, y: 1 }, 0, W, H, LIMITS)).toBe(false)
    expect(camera.position.equals(p)).toBe(true)
  })
})

// Mouse wheel zoom (spec #293): eases towards the ground point under the cursor, never turning the view.
const WW = 1200
const WH = 700

/** A low-angle view (about 10 degrees below the horizon at the centre), where OrbitControls' zoomToCursor turned the view. */
function lowRig(polar = 1.4, distance = 300): { camera: THREE.PerspectiveCamera; target: THREE.Vector3 } {
  const camera = new THREE.PerspectiveCamera(45, WW / WH, 1, 14000)
  const target = new THREE.Vector3(50, 0, -20)
  camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(distance, polar, 0.7)))
  camera.lookAt(target)
  camera.updateMatrixWorld()
  return { camera, target }
}

function angles(camera: THREE.PerspectiveCamera, target: THREE.Vector3): THREE.Spherical {
  return new THREE.Spherical().setFromVector3(camera.position.clone().sub(target))
}

/** Pixel where a world point lands on the canvas. */
function pixelOf(camera: THREE.PerspectiveCamera, p: THREE.Vector3): { x: number; y: number } {
  camera.updateMatrixWorld()
  const v = p.clone().project(camera)
  return { x: ((v.x + 1) / 2) * WW, y: ((1 - v.y) / 2) * WH }
}

function wheelGround(camera: THREE.PerspectiveCamera, x: number, y: number): THREE.Vector3 {
  const out = new THREE.Vector3()
  expect(groundPointUnder(camera, { x, y }, WW, WH, 0, out)).not.toBeNull()
  return out
}

/** Runs frames until the zoom has settled; checks `each` after every frame. Returns the frame count. */
function settle(zoom: WheelZoom, camera: THREE.PerspectiveCamera, target: THREE.Vector3, each?: () => void): number {
  let frames = 0
  while (zoom.active && frames < 500) {
    zoom.step(camera, target, WW, WH, LIMITS)
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
        zoom.add(deltaY, 0, cursor)
        zoom.add(deltaY, 0, cursor)
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
    zoom.add(-100, 0, { x: 100, y: 5 })
    settle(zoom, camera, target)
    expect(target.distanceTo(t0)).toBeLessThan(1e-6)
    const a = angles(camera, target)
    expect(a.radius).toBeCloseTo(before.radius * 0.95, 4)
    expect(Math.abs(a.theta - before.theta)).toBeLessThan(1e-9)
    expect(Math.abs(a.phi - before.phi)).toBeLessThan(1e-9)
  })

  for (const [limit, deltaY, start] of [['minimum', -100, 12], ['maximum', 100, 3000]] as const) {
    it(`stops cleanly at the ${limit} distance with no sideways shift and nothing pending`, () => {
      const { camera, target } = lowRig(1.2, start)
      const zoom = new WheelZoom()
      const cursor = { x: 200, y: WH * 0.8 }
      for (let i = 0; i < 40; i++) zoom.add(deltaY, 0, cursor)
      settle(zoom, camera, target)
      expect(zoom.active).toBe(false)
      const limitDistance = limit === 'minimum' ? LIMITS.minDistance : LIMITS.maxDistance
      expect(camera.position.distanceTo(target)).toBeCloseTo(limitDistance, 6)
      const cam = camera.position.clone()
      const tgt = target.clone()
      zoom.add(deltaY, 0, cursor)
      settle(zoom, camera, target)
      expect(camera.position.distanceTo(cam)).toBeLessThan(1e-9)
      expect(target.distanceTo(tgt)).toBeLessThan(1e-9)
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
    expect(ratio(-100, 0)).toBeCloseTo(0.95, 4)
    expect(ratio(-3, 1)).toBeCloseTo(0.95, 4) // Firefox: three lines a notch
    expect(ratio(-1, 2)).toBeLessThan(0.95) // a page is at least a notch
    expect(Math.log(ratio(-4, 0))).toBeCloseTo(Math.log(0.95) * 0.04, 6)
  })

  it('adds quick notches and drains them fully', () => {
    const { camera, target } = lowRig()
    const r0 = camera.position.distanceTo(target)
    const zoom = new WheelZoom()
    const cursor = { x: 900, y: 500 }
    zoom.add(-100, 0, cursor)
    zoom.step(camera, target, WW, WH, LIMITS)
    zoom.add(-100, 0, cursor)
    zoom.add(-100, 0, cursor)
    settle(zoom, camera, target)
    expect(camera.position.distanceTo(target) / r0).toBeCloseTo(0.95 ** 3, 4)
  })

  it('keeps the orbit target on the screen-centre ray at ground height after every step', () => {
    const { camera, target } = lowRig()
    const zoom = new WheelZoom()
    zoom.add(-300, 0, { x: 100, y: 600 })
    settle(zoom, camera, target, () => {
      expect(target.y).toBe(0)
      const centre = wheelGround(camera, WW / 2, WH / 2)
      expect(centre.distanceTo(target)).toBeLessThan(1e-6 * camera.position.distanceTo(target) + 1e-6)
    })
    zoom.add(500, 0, { x: 1100, y: 450 })
    settle(zoom, camera, target, () => {
      const centre = wheelGround(camera, WW / 2, WH / 2)
      expect(centre.distanceTo(target)).toBeLessThan(1e-6 * camera.position.distanceTo(target) + 1e-6)
    })
  })
})
