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

/** Crane axes (gantry/trolley/hoist) and vehicle axes (x/z drive along the lane graph, lift). */
export type Axis = 'gantry' | 'trolley' | 'hoist' | 'x' | 'z' | 'lift'

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
  /** Speed at t0 (m/s); absent = 0 (starts from rest). Set when a vehicle corners at speed. */
  v0?: number
  /** Speed at t1 (m/s); absent = 0 (ends at rest). */
  v1?: number
}

/** How a vehicle takes a turn: an assumed radius and the lateral acceleration it tolerates. */
export interface CornerModel {
  radiusM: number
  lateralAccel: number
}

/**
 * Speed cap (m/s) for a turn of `turnAngleRad` (0 = straight on, pi = reversal).
 * v = sqrt(lateralAccel * radius) for a right-angle turn, scaled down for
 * sharper turns; a reversal (backing up) or a zero radius means a full stop.
 */
export function cornerSpeedCap(turnAngleRad: number, corner: CornerModel): number {
  if (turnAngleRad >= Math.PI - 1e-9 || corner.radiusM <= 0 || corner.lateralAccel <= 0) return 0
  const base = Math.sqrt(corner.lateralAccel * corner.radiusM)
  return turnAngleRad <= Math.PI / 2 ? base : (base * (Math.PI / 2)) / turnAngleRad
}

/** Time (s) to travel |distance| from rest to rest with the given profile. */
export function travelTime(distance: number, p: AxisProfile): number {
  return profileTime(Math.abs(distance), p, 0, 0)
}

/** Peak speed of a move of `d` metres entering at `v0` and leaving at `v1` (both 0 = rest to rest). */
function peakSpeed(d: number, p: AxisProfile, v0 = 0, v1 = 0): number {
  const rampD = (p.vMax * p.vMax - v0 * v0) / (2 * p.accel) + (p.vMax * p.vMax - v1 * v1) / (2 * p.decel)
  if (rampD <= d) return p.vMax
  // Triangular: d = (v² - v0²)/2a + (v² - v1²)/2b
  const v = Math.sqrt((2 * d + (v0 * v0) / p.accel + (v1 * v1) / p.decel) / (1 / p.accel + 1 / p.decel))
  return Math.max(v, v0, v1)
}

function profileTime(d: number, p: AxisProfile, v0: number, v1: number): number {
  if (d === 0) return 0
  const vPeak = peakSpeed(d, p, v0, v1)
  const accelT = (vPeak - v0) / p.accel
  const decelT = (vPeak - v1) / p.decel
  const accelD = ((vPeak + v0) * accelT) / 2
  const decelD = ((vPeak + v1) * decelT) / 2
  const cruiseD = Math.max(0, d - accelD - decelD)
  return accelT + decelT + cruiseD / vPeak
}

/**
 * Plan a move of one axis starting at sim time `t0`. Rest to rest unless
 * `v0` (entry speed) and `v1` (exit speed) say otherwise: a vehicle that
 * corners at speed leaves one run at `v1` and starts the next at `v0`.
 * Both must be reachable within the distance (the caller caps them).
 */
export function planSegment(
  entityId: string,
  axis: Axis,
  from: number,
  to: number,
  t0: number,
  p: AxisProfile,
  v0 = 0,
  v1 = 0,
): MotionSegment {
  const d = Math.abs(to - from)
  const seg: MotionSegment = {
    entityId,
    axis,
    from,
    to,
    t0,
    t1: t0 + profileTime(d, p, v0, v1),
    vPeak: d === 0 ? 0 : peakSpeed(d, p, v0, v1),
    accel: p.accel,
    decel: p.decel,
  }
  if (v0 > 0) seg.v0 = v0
  if (v1 > 0) seg.v1 = v1
  return seg
}

/** Axis coordinate of a segment at sim time `t` (clamped to the segment). */
export function positionAt(seg: MotionSegment, t: number): number {
  // t1 first: an instant (zero-duration) segment is already at `to` from t0 on.
  if (t >= seg.t1) return seg.to
  if (t <= seg.t0 || seg.vPeak === 0) return seg.from
  const dir = seg.to >= seg.from ? 1 : -1
  const dt = t - seg.t0
  const v0 = seg.v0 ?? 0
  const v1 = seg.v1 ?? 0
  const accelT = (seg.vPeak - v0) / seg.accel
  const decelT = (seg.vPeak - v1) / seg.decel
  const total = seg.t1 - seg.t0
  let s: number
  if (dt <= accelT) {
    s = v0 * dt + 0.5 * seg.accel * dt * dt
  } else if (dt <= total - decelT) {
    s = v0 * accelT + 0.5 * seg.accel * accelT * accelT + seg.vPeak * (dt - accelT)
  } else {
    const rem = total - dt
    s = Math.abs(seg.to - seg.from) - v1 * rem - 0.5 * seg.decel * rem * rem
  }
  return seg.from + dir * s
}
