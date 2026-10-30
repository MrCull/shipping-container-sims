/**
 * Keyboard camera (TT-R03): the pure pose stepper. Held keys become a `CameraMotion` (`cameraMotion` in
 * shortcuts.ts); each frame the scene reads the orbit camera as a `CameraPose`, steps it here and writes it back.
 * Angles follow three.js `Spherical`: the camera sits at target + r (sin φ sin θ, cos φ, sin φ cos θ), so
 * azimuth 0 puts it on +z looking toward -z.
 */

export interface CameraPose {
  target: { x: number; y: number; z: number }
  /** Camera to target, metres. */
  distance: number
  /** Heading around the target, radians (θ). */
  azimuth: number
  /** Angle from straight up, radians (φ): small is top-down, π/2 is horizon level. */
  polar: number
}

/** Each axis is -1, 0 or 1: pan forward/right along the ground heading, orbit right, tilt down, zoom in. */
export interface CameraMotion {
  forward: number
  right: number
  orbit: number
  tilt: number
  zoom: number
}

export interface CameraLimits {
  minDistance: number
  maxDistance: number
  minPolar: number
  maxPolar: number
}

/** Pan speed as a fraction of the camera distance per second, so panning feels the same at any zoom. */
export const PAN_PER_SECOND = 0.8
/** Orbit and tilt rates, radians per second. */
export const ORBIT_RATE = 1.2
export const TILT_RATE = 0.9
/** Zoom: the distance shrinks by this factor (natural-log rate) per second. */
export const ZOOM_RATE = 1.1

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The pose after `dt` seconds of `motion`; a new object, the input is untouched. */
export function stepCameraPose(pose: CameraPose, motion: CameraMotion, dt: number, limits: CameraLimits): CameraPose {
  const speed = pose.distance * PAN_PER_SECOND * dt
  // Ground heading (camera toward target) and the direction to its right.
  const fx = -Math.sin(pose.azimuth)
  const fz = -Math.cos(pose.azimuth)
  const rx = -fz
  const rz = fx
  return {
    target: {
      x: pose.target.x + (fx * motion.forward + rx * motion.right) * speed,
      y: pose.target.y,
      z: pose.target.z + (fz * motion.forward + rz * motion.right) * speed,
    },
    distance: clamp(pose.distance * Math.exp(-ZOOM_RATE * motion.zoom * dt), limits.minDistance, limits.maxDistance),
    azimuth: pose.azimuth + ORBIT_RATE * motion.orbit * dt,
    polar: clamp(pose.polar + TILT_RATE * motion.tilt * dt, limits.minPolar, limits.maxPolar),
  }
}
