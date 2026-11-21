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

/** Zoom factor of one mouse-wheel notch (100 px of deltaY), the same as OrbitControls' default wheel zoom. */
export const WHEEL_NOTCH_ZOOM = 0.95
/** Pixels per wheel line (deltaMode 1): Firefox sends three lines a notch, so three lines make one 100 px notch. */
const WHEEL_LINE_PX = 100 / 3
/** Pixels per wheel page (deltaMode 2). */
const WHEEL_PAGE_PX = 800
/** Largest deltaY one wheel event may carry (three notches), so a page step or a driver burst cannot leap. */
const WHEEL_MAX_PX = 300
/** Share of the pending zoom applied each frame: a notch eases in over about a dozen frames. */
const WHEEL_DRAIN = 0.25
/** Pending zoom (natural log of the zoom factor) small enough to apply in one go. */
const WHEEL_SNAP = 1e-3

/**
 * Mouse-wheel zoom for the 3D view (spec #293). OrbitControls' `zoomToCursor` moved the camera towards the cursor
 * but, with `screenSpacePanning` off, re-seated the orbit target only when the view was steeper than its tilt limit
 * (more than 20 degrees below the horizon); in shallower views the target stayed and `camera.lookAt(target)` turned
 * the view left or right. This instead keeps a pending zoom (log scale) that each wheel event adds to, and drains it
 * a fixed share per frame through `applyPinchStep` at the latest cursor position: the ground point under the cursor
 * stays put, the heading and tilt never change, and the orbit target stays the ground point at screen centre.
 */
export class WheelZoom {
  private pending = 0
  private cursor: CanvasPoint = { x: 0, y: 0 }

  /** True while some zoom is still to be applied. */
  get active(): boolean {
    return this.pending !== 0
  }

  /** Adds one wheel event (`deltaY` in `deltaMode` units, negative zooms in) at `cursor` in canvas pixels. */
  add(deltaY: number, deltaMode: number, cursor: CanvasPoint): void {
    if (!Number.isFinite(deltaY) || deltaY === 0) return
    const unit = deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1
    const px = Math.max(-WHEEL_MAX_PX, Math.min(WHEEL_MAX_PX, deltaY * unit))
    this.pending += (-px / 100) * -Math.log(WHEEL_NOTCH_ZOOM)
    this.cursor = { x: cursor.x, y: cursor.y }
  }

  /** Drops any pending zoom. */
  clear(): void {
    this.pending = 0
  }

  /** Applies one frame's share of the pending zoom to `camera` and `target` in place. Returns true when anything moved. */
  step(camera: THREE.PerspectiveCamera, target: THREE.Vector3, width: number, height: number, limits: PinchLimits): boolean {
    if (this.pending === 0) return false
    const radius = camera.position.distanceTo(target)
    const zoomIn = this.pending > 0
    if ((zoomIn && radius <= limits.minDistance + 1e-9) || (!zoomIn && radius >= limits.maxDistance - 1e-9)) {
      this.pending = 0 // at a limit: stop cleanly, nothing left to slide
      return false
    }
    const share = Math.abs(this.pending) <= WHEEL_SNAP ? this.pending : this.pending * WHEEL_DRAIN
    this.pending -= share
    if (Math.abs(this.pending) < 1e-12) this.pending = 0
    const ratio = Math.exp(share)
    const wanted = radius / ratio
    if (wanted <= limits.minDistance || wanted >= limits.maxDistance) this.pending = 0
    return applyPinchStep(camera, target, this.cursor, this.cursor, ratio, width, height, limits)
  }
}
