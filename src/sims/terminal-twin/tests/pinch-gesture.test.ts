import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyPinchStep, groundPointUnder } from '../modules/pinchGesture'

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
