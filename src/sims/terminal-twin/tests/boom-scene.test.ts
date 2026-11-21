/**
 * #298: the scene model reports each STS's boom angle at time t from its boom motion segments (prior art:
 * gantry-motion.test.ts). The STS renderer drives the `boom` rig node from it.
 */
import { describe, expect, it } from 'vitest'
import { planSegment } from '../engine'
import { SceneModel } from '../modules/sceneModel'
import { fixtures } from '../scenario/fixtures'
import { emptyDelta } from './delta'

const PROFILE = { vMax: 80 / 75, accel: (4 * 80) / (150 * 150), decel: (4 * 80) / (150 * 150) }

describe('scene model boom angle', () => {
  it('follows a boom segment: start angle before, in between during, end angle after', () => {
    const config = fixtures['boom-berthing']
    const m = new SceneModel(config)
    const sts = config.sts[0].id
    const lower = planSegment(sts, 'boom', 80, 0, 100, PROFILE)
    m.apply(emptyDelta({ motion: [{ entityId: sts, segments: [lower] }] }))
    expect(lower.t1 - lower.t0).toBeCloseTo(150, 6)
    expect(m.boomAngleDeg(sts, 50)).toBe(80)
    const mid = m.boomAngleDeg(sts, 175)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(80)
    expect(m.boomAngleDeg(sts, 175)).toBeCloseTo(40, 6) // the triangular profile is symmetric
    expect(m.boomAngleDeg(sts, lower.t1 + 1)).toBe(0)
    // a later raise
    const raise = planSegment(sts, 'boom', 0, 80, 1000, PROFILE)
    m.apply(emptyDelta({ motion: [{ entityId: sts, segments: [raise] }] }))
    expect(m.boomAngleDeg(sts, 900)).toBe(0)
    expect(m.boomAngleDeg(sts, 2000)).toBe(80)
  })

  it('with no boom segment: stowed in boom mode real (idle crane up), working in mode off', () => {
    const real = fixtures['boom-berthing']
    expect(new SceneModel(real).boomAngleDeg('STS03', 500)).toBe(80)
    const off = fixtures['crane-split-4sts']
    expect(new SceneModel(off).boomAngleDeg('STS01', 500)).toBe(0)
  })

  it('a boom segment does not move the gantry, trolley or hoist pose', () => {
    const config = fixtures['boom-berthing']
    const m = new SceneModel(config)
    const sts = config.sts[0].id
    const before = m.stsPose(sts, 0)
    m.apply(emptyDelta({ motion: [{ entityId: sts, segments: [planSegment(sts, 'boom', 0, 80, 0, PROFILE)] }] }))
    expect(m.stsPose(sts, 75)).toEqual(before)
    expect(m.isGantrying(sts, 75)).toBe(false)
    expect(m.isWorking(sts, 75)).toBe(false)
  })
})
