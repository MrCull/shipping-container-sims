/**
 * Mouse-wheel zoom for the 3D view (spec #293): eases towards the ground point under the cursor without turning the
 * view. Why it replaces OrbitControls' `zoomToCursor`: docs/rendering-3d.md, Camera controls.
 *
 * Each wheel event adds to a pending zoom (log scale); every frame drains a share of it by elapsed time through
 * `applyPinchStep` at the latest cursor position, so the ground point under the cursor stays put, heading and tilt
 * never change and the orbit target stays the ground point at screen centre.
 */
import type * as THREE from 'three'
import { applyPinchStep, type CanvasPoint, type PinchLimits } from './pinchGesture'

/** `WheelEvent.deltaMode` values (named here: the module also runs under Node, where `WheelEvent` is undefined). */
export const DOM_DELTA_PIXEL = 0
export const DOM_DELTA_LINE = 1
export const DOM_DELTA_PAGE = 2

/** Zoom factor of one mouse-wheel notch (100 px of deltaY), the same as OrbitControls' default wheel zoom. */
export const WHEEL_NOTCH_ZOOM = 0.95
/** Pixels per wheel line: Firefox sends three lines a notch, so three lines make one 100 px notch. */
const WHEEL_LINE_PX = 100 / 3
/** Pixels per wheel page. */
const WHEEL_PAGE_PX = 800
/** Largest deltaY one wheel event may carry (three notches), so a page step or a driver burst cannot leap. */
const WHEEL_MAX_PX = 300
/** Share of the pending zoom applied per 1/60 s: a notch eases in over about a dozen frames at 60 fps. */
const WHEEL_DRAIN_PER_60TH = 0.25
/** Pending zoom (natural log of the zoom factor) small enough to apply in one go. */
const WHEEL_SNAP = 1e-3
/**
 * The cursor's ground point anchors the zoom only within this multiple of the orbit radius from the camera; farther
 * (a grazing ray near the horizon) each notch would swing the pivot hundreds of metres, so the zoom heads for the
 * target instead.
 */
export const WHEEL_ANCHOR_RANGE = 5

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
    const unit = deltaMode === DOM_DELTA_LINE ? WHEEL_LINE_PX : deltaMode === DOM_DELTA_PAGE ? WHEEL_PAGE_PX : 1
    const px = Math.max(-WHEEL_MAX_PX, Math.min(WHEEL_MAX_PX, deltaY * unit))
    this.pending += (-px / 100) * -Math.log(WHEEL_NOTCH_ZOOM)
    this.cursor = { x: cursor.x, y: cursor.y }
  }

  /** Drops any pending zoom. */
  clear(): void {
    this.pending = 0
  }

  /**
   * Applies the share of the pending zoom due after `dtSeconds` of wall time to `camera` and `target` in place, so a
   * notch takes the same wall time at any frame rate. Returns true when anything moved.
   */
  step(
    camera: THREE.PerspectiveCamera,
    target: THREE.Vector3,
    width: number,
    height: number,
    limits: PinchLimits,
    dtSeconds: number,
  ): boolean {
    if (this.pending === 0 || !(dtSeconds > 0)) return false
    const radius = camera.position.distanceTo(target)
    const zoomIn = this.pending > 0
    if ((zoomIn && radius <= limits.minDistance + 1e-9) || (!zoomIn && radius >= limits.maxDistance - 1e-9)) {
      this.pending = 0 // at a limit: stop cleanly, nothing left to slide
      return false
    }
    const fraction = 1 - (1 - WHEEL_DRAIN_PER_60TH) ** (dtSeconds * 60)
    const share = Math.abs(this.pending) <= WHEEL_SNAP ? this.pending : this.pending * fraction
    this.pending -= share
    if (Math.abs(this.pending) < 1e-12) this.pending = 0
    const ratio = Math.exp(share)
    const wanted = radius / ratio
    if (wanted <= limits.minDistance || wanted >= limits.maxDistance) this.pending = 0
    return applyPinchStep(camera, target, this.cursor, this.cursor, ratio, width, height, limits, radius * WHEEL_ANCHOR_RANGE)
  }
}
