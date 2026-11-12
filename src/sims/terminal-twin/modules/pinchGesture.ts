/**
 * Map-style two-finger gesture for the 3D view (phones and tablets).
 *
 * OrbitControls' own two-finger pinch works from page coordinates (a scrolled or over-wide page shifts it), scales
 * its pan to the distance of an orbit target that can sit far away, and moves the camera and the target by
 * different rules, so the scene slides sideways (usually right) under the fingers while zooming. This replaces it:
 *
 * 1. Zoom is a scaling of the camera and target about the ground point under the finger midpoint, so that point
 *    keeps its place on screen and the view direction is unchanged.
 * 2. Pan then moves camera and target together so the ground point first touched stays under the midpoint.
 *
 * Pure functions on plain vectors; `useTwinScene` wires them to pointer events and disables OrbitControls'
 * two-finger state (`touches.TWO`).
 */
import * as THREE from 'three'

export interface PinchLimits {
  minDistance: number
  maxDistance: number
}

/** Pointer position in canvas pixels (client coordinates minus the canvas rect). */
export interface CanvasPoint {
  x: number
  y: number
}

const ray = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const hit = new THREE.Vector3()

/**
 * Ground point (the horizontal plane at `groundY`) under a canvas pixel, or null when the ray points at or above
 * the horizon or the hit lies absurdly far away (grazing angles).
 */
export function groundPointUnder(
  camera: THREE.PerspectiveCamera,
  p: CanvasPoint,
  width: number,
  height: number,
  groundY: number,
  out: THREE.Vector3,
  maxRange = 20000,
): THREE.Vector3 | null {
  if (width <= 0 || height <= 0) return null
  camera.updateMatrixWorld()
  ndc.set((p.x / width) * 2 - 1, -(p.y / height) * 2 + 1)
  ray.setFromCamera(ndc, camera)
  if (ray.ray.direction.y >= -1e-4) return null
  plane.constant = -groundY
  if (!ray.ray.intersectPlane(plane, hit)) return null
  if (hit.distanceTo(camera.position) > maxRange) return null
  return out.copy(hit)
}

/**
 * Applies one step of a two-finger gesture to `camera` and `target` in place.
 *
 * `spreadRatio` is the new finger distance over the previous one (above 1 means fingers moved apart: zoom in).
 * `prevMid` and `mid` are the finger midpoints before and after, in canvas pixels. The camera's distance to the
 * target is kept within `limits`. Returns true when anything moved.
 */
export function applyPinchStep(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  prevMid: CanvasPoint,
  mid: CanvasPoint,
  spreadRatio: number,
  width: number,
  height: number,
  limits: PinchLimits,
): boolean {
  if (!(spreadRatio > 0) || !Number.isFinite(spreadRatio)) return false
  const groundY = target.y
  const anchor = new THREE.Vector3()
  const haveAnchor = groundPointUnder(camera, prevMid, width, height, groundY, anchor) !== null
  const centre = haveAnchor ? anchor : target.clone()

  // 1. Zoom: scale camera and target about the anchor. The scale is clamped so the orbit radius stays in limits.
  const radius = camera.position.distanceTo(target)
  let scale = 1 / spreadRatio
  if (radius > 0) {
    const newRadius = Math.min(limits.maxDistance, Math.max(limits.minDistance, radius * scale))
    scale = newRadius / radius
  }
  let moved = false
  if (Math.abs(scale - 1) > 1e-6) {
    camera.position.sub(centre).multiplyScalar(scale).add(centre)
    target.sub(centre).multiplyScalar(scale).add(centre)
    target.y = groundY
    moved = true
  }

  // 2. Pan: bring the anchor back under the new midpoint.
  if (haveAnchor) {
    camera.updateMatrixWorld()
    const now = new THREE.Vector3()
    if (groundPointUnder(camera, mid, width, height, groundY, now) !== null) {
      const shift = anchor.sub(now)
      shift.y = 0
      if (shift.lengthSq() > 1e-10) {
        camera.position.add(shift)
        target.add(shift)
        moved = true
      }
    }
  }
  camera.updateMatrixWorld()
  return moved
}
