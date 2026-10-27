/**
 * Kinematic motion profiles (pure, SI units: metres, seconds).
 *
 * Every equipment movement is planned as one MotionSegment per axis with a
 * trapezoidal (accelerate / cruise / decelerate) or, for short moves, a
 * triangular velocity profile. The end time is known when the move starts,
 * so the engine can schedule the arrival event and a renderer can
 * interpolate the position at any instant with `positionAt`.
 */

export interface AxisProfile {
  /** Maximum (cruise) speed, m/s. */
  vMax: number
  /** Acceleration, m/s². */
  accel: number
  /** Deceleration, m/s² (positive number). */
  decel: number
}

export type Axis = 'gantry' | 'trolley' | 'hoist'

export interface MotionSegment {
  entityId: string
  axis: Axis
  /** Axis coordinate at t0 (m). */
  from: number
  /** Axis coordinate at t1 (m). */
  to: number
  /** Start sim time (s). */
  t0: number
  /** End sim time (s). */
  t1: number
  /** Peak speed actually reached (m/s; < vMax for triangular profiles). */
  vPeak: number
  accel: number
  decel: number
}

/** Time (s) to travel |distance| from rest to rest with the given profile. */
export function travelTime(distance: number, p: AxisProfile): number {
  const d = Math.abs(distance)
  if (d === 0) return 0
  const vPeak = peakSpeed(d, p)
  const accelT = vPeak / p.accel
  const decelT = vPeak / p.decel
  const accelD = (vPeak * accelT) / 2
  const decelD = (vPeak * decelT) / 2
  const cruiseD = Math.max(0, d - accelD - decelD)
  return accelT + decelT + cruiseD / vPeak
}

function peakSpeed(d: number, p: AxisProfile): number {
  const rampD = (p.vMax * p.vMax) / (2 * p.accel) + (p.vMax * p.vMax) / (2 * p.decel)
  if (rampD <= d) return p.vMax
  // Triangular: d = v²/2a + v²/2b  →  v = sqrt(2·d·a·b / (a + b))
  return Math.sqrt((2 * d * p.accel * p.decel) / (p.accel + p.decel))
}

/** Plan a rest-to-rest move of one axis starting at sim time `t0`. */
export function planSegment(
  entityId: string,
  axis: Axis,
  from: number,
  to: number,
  t0: number,
  p: AxisProfile,
): MotionSegment {
  const d = Math.abs(to - from)
  return {
    entityId,
    axis,
    from,
    to,
    t0,
    t1: t0 + travelTime(d, p),
    vPeak: d === 0 ? 0 : peakSpeed(d, p),
    accel: p.accel,
    decel: p.decel,
  }
}

/** Axis coordinate of a segment at sim time `t` (clamped to the segment). */
export function positionAt(seg: MotionSegment, t: number): number {
  if (t <= seg.t0 || seg.vPeak === 0) return seg.from
  if (t >= seg.t1) return seg.to
  const dir = seg.to >= seg.from ? 1 : -1
  const dt = t - seg.t0
  const accelT = seg.vPeak / seg.accel
  const decelT = seg.vPeak / seg.decel
  const total = seg.t1 - seg.t0
  let s: number
  if (dt <= accelT) {
    s = 0.5 * seg.accel * dt * dt
  } else if (dt <= total - decelT) {
    s = 0.5 * seg.vPeak * accelT + seg.vPeak * (dt - accelT)
  } else {
    const rem = total - dt
    s = Math.abs(seg.to - seg.from) - 0.5 * seg.decel * rem * rem
  }
  return seg.from + dir * s
}
