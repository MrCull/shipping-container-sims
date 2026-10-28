/**
 * TT-26: how the scene model poses a truck for the 3D model — articulation between tractor and chassis through a
 * turn, and where the model sits so its box rests on the right twist-locks. Driven with the same Delta the worker sends.
 */
import { describe, expect, it } from 'vitest'
import { planSegment, type Axis, type MotionSegment } from '../engine'
import { SceneModel } from '../modules/sceneModel'
import { fixtures } from '../scenario/fixtures'
import { emptyDelta } from './delta'

const config = fixtures['dual-truck-transaction']
const TRUCK = 'T1'
const PROFILE = { vMax: 8, accel: 2, decel: 2 }
const MAX_ARTIC = (40 * Math.PI) / 180

function seg(axis: Axis, from: number, to: number, t0: number): MotionSegment {
  return planSegment(TRUCK, axis, from, to, t0, PROFILE)
}

describe('truck pose for the 3D model', () => {
  it('articulates the tractor against the chassis through a turn, in the steering direction, and straightens afterwards', () => {
    const m = new SceneModel(config)
    const p0 = m.truckPose(TRUCK, 0)
    const east = seg('x', p0.x, p0.x + 40, 0)
    const north = seg('z', p0.z, p0.z + 30, east.t1 + 2)
    m.apply(emptyDelta({ motion: [{ entityId: TRUCK, segments: [east, north] }], entities: [{ kind: 'truck', id: TRUCK, t: 0, status: 'in-lane' }] }))
    const straight = m.truckPose(TRUCK, east.t1 - 1)
    expect(straight.articulationRad).toBe(0)
    const turning = m.truckPose(TRUCK, north.t0 + 0.5)
    expect(Math.abs(turning.articulationRad)).toBeGreaterThan(0.05)
    expect(Math.abs(turning.articulationRad)).toBeLessThanOrEqual(MAX_ARTIC + 1e-9)
    expect(Math.sign(turning.articulationRad)).toBe(Math.sign(turning.steerRad))
    expect(m.truckPose(TRUCK, north.t0 + 6).articulationRad).toBe(0)
  })

  it('shifts the model along its heading for a 20 ft box so the box sits on the front twist-locks, and not for a 40 ft box', () => {
    const m = new SceneModel(config)
    m.apply(emptyDelta({ entities: [{ kind: 'truck', id: TRUCK, t: 0, status: 'queued', loadSize: '20' }, { kind: 'truck', id: 'T2', t: 0, status: 'queued', loadSize: '40' }] }))
    expect(m.truckPose(TRUCK, 1).loadOffsetM).toBeCloseTo(-3.0675, 4) // the front 20 ft position is 3.0675 m ahead of the 40 ft centre
    expect(m.truckPose('T2', 1).loadOffsetM).toBe(0)
  })

  it('draws a truck with no known load as a 40 ft position (offset 0)', () => {
    const m = new SceneModel(config)
    m.apply(emptyDelta({ entities: [{ kind: 'truck', id: TRUCK, t: 0, status: 'queued' }] }))
    expect(m.truckPose(TRUCK, 1).loadOffsetM).toBe(0)
  })
})
