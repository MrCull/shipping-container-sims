/**
 * TT-25: how the renderer's scene model poses an SHC for the 3D model — wheel
 * roll from travel distance, steering from path curvature, spreader height from
 * the lift segments. Driven with motion plans through `SceneModel.apply`, the
 * same Delta the worker sends (seam 3 data, no Three.js).
 */
import { describe, expect, it } from 'vitest'
import { planSegment, type Axis, type MotionSegment } from '../engine'
import { SceneModel } from '../modules/sceneModel'
import { fixtures } from '../scenario/fixtures'
import type { Delta } from '../worker/protocol'

const config = fixtures['shc-1sts-2shc-1wtp']
const SHC = config.shcs![0].id
const PROFILE = { vMax: 5, accel: 1, decel: 1 }

function model(): SceneModel {
  return new SceneModel(config)
}

function seg(axis: Axis, from: number, to: number, t0: number): MotionSegment {
  return planSegment(SHC, axis, from, to, t0, PROFILE)
}

function drive(m: SceneModel, segments: MotionSegment[]): void {
  const delta: Delta = { motion: [{ entityId: SHC, segments }], custody: [], entities: [], reservations: [], events: [], eventCounts: {}, breakpoint: null }
  m.apply(delta)
}

describe('SHC pose for the 3D model', () => {
  it('wheel roll follows the distance travelled (odometer), settling at the segment length', () => {
    const m = model()
    const start = m.shcPose(SHC, 0)
    const run = seg('x', start.x, start.x + 40, 10)
    drive(m, [run])
    expect(m.shcPose(SHC, 9).odometerM).toBe(0)
    const mid = m.shcPose(SHC, (run.t0 + run.t1) / 2)
    expect(mid.odometerM).toBeCloseTo(20, 1)
    expect(m.shcPose(SHC, run.t1 + 5).odometerM).toBeCloseTo(40, 6)
    expect(mid.travelling).toBe(true)
    expect(m.shcPose(SHC, run.t1 + 5).travelling).toBe(false)
  })

  it('steers and swings round a 90 degree corner, then straightens', () => {
    const m = model()
    const s0 = m.shcPose(SHC, 0)
    const east = seg('x', s0.x, s0.x + 30, 0)
    const north = seg('z', s0.z, s0.z + 20, east.t1 + 3)
    drive(m, [east, north])
    const straight = m.shcPose(SHC, east.t1 - 1)
    expect(straight.yaw).toBe(0)
    expect(straight.steerRad).toBe(0)
    const turning = m.shcPose(SHC, north.t0 + 0.5)
    expect(Math.abs(turning.steerRad)).toBeGreaterThan(0.1)
    expect(Math.abs(turning.steerRad)).toBeLessThanOrEqual((35 * Math.PI) / 180 + 1e-9)
    expect(turning.yaw).toBeLessThan(0) // towards +Z
    expect(turning.yaw).toBeGreaterThan(-Math.PI / 2)
    const after = m.shcPose(SHC, north.t0 + 5)
    expect(after.yaw).toBeCloseTo(-Math.PI / 2, 6)
    expect(after.steerRad).toBe(0)
    expect(after.heading).toBe('z')
    // the steering sign matches the turning direction and is the same through the whole turn
    expect(Math.sign(turning.steerRad)).toBe(Math.sign(m.shcPose(SHC, north.t0 + 1.2).steerRad))
  })

  it('backs up instead of spinning round when the next leg runs the other way', () => {
    const m = model()
    const s0 = m.shcPose(SHC, 0)
    const out = seg('x', s0.x, s0.x + 30, 0)
    const back = seg('x', s0.x + 30, s0.x + 10, out.t1 + 2)
    drive(m, [out, back])
    const during = m.shcPose(SHC, (back.t0 + back.t1) / 2)
    expect(during.yaw).toBe(0)
    expect(during.steerRad).toBe(0)
    expect(during.odometerM).toBeLessThan(30) // rolls backwards
    expect(m.shcPose(SHC, back.t1 + 1).odometerM).toBeCloseTo(10, 6)
  })

  it('spreader lift follows the lift segments and is reported with whether the SHC is driving', () => {
    const m = model()
    const s0 = m.shcPose(SHC, 0)
    const lift = seg('lift', 0, 1, 5)
    drive(m, [lift])
    expect(m.shcPose(SHC, 4).lift).toBe(0)
    expect(m.shcPose(SHC, lift.t1 + 1).lift).toBe(1)
    expect(m.shcPose(SHC, lift.t1 + 1).travelling).toBe(false)
    const run = seg('z', s0.z, s0.z + 10, lift.t1 + 2)
    drive(m, [run])
    expect(m.shcPose(SHC, run.t0 + 1).travelling).toBe(true)
  })

  it('a carried container takes the SHC position, lift and yaw', () => {
    const m = model()
    const s0 = m.shcPose(SHC, 0)
    const run = seg('z', s0.z, s0.z + 10, 0)
    drive(m, [run])
    const id = m.containerIds[0]
    m.apply({ motion: [], custody: [{ containerId: id, t: 0, owner: { kind: 'shc', id: SHC }, eventId: 1 }], entities: [], reservations: [], events: [], eventCounts: {}, breakpoint: null })
    const pose = m.containerPose(id, run.t1 + 1)!
    expect(pose.z).toBeCloseTo(s0.z + 10, 6)
    expect(pose.carriedBy).toBe(SHC)
    expect(pose.yaw).toBeCloseTo(-Math.PI / 2, 6)
  })
})
