/**
 * #298: the scene model reports each STS's boom angle at time t from its boom motion segments (prior art:
 * gantry-motion.test.ts). The STS renderer drives the `boom` rig node from it.
 */
import { describe, expect, it } from 'vitest'
import { planSegment } from '../engine'
import { SceneModel } from '../modules/sceneModel'
import { fixtures } from '../scenario/fixtures'
import { emptyDelta } from './delta'
import { entityBounds, pickEntity } from '../modules/picking'

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

describe('STS bounds and picking follow the boom (#301)', () => {
  const config = fixtures['boom-berthing']
  const sts = config.sts[0].id
  /** A model whose first crane lowers from 80 to 0 degrees over [100, 250] s. */
  const lowered = () => {
    const m = new SceneModel(config)
    m.apply(emptyDelta({ motion: [{ entityId: sts, segments: [planSegment(sts, 'boom', 80, 0, 100, PROFILE)] }] }))
    return m
  }

  it('boom down: the box ends just above the 82 m apex and stays on the portal (the vessel under the boom stays pickable)', () => {
    const b = entityBounds(lowered(), sts, 1000)!
    expect(b.y + b.sy / 2).toBeCloseTo(83.3, 1)
    expect(b.z - b.sz / 2).toBeGreaterThan(-5) // not out over the water
  })

  it('boom at 80 degrees: the box reaches the raised boom tip (about 125 m) and covers it seaward', () => {
    const b = entityBounds(lowered(), sts, 50)!
    const top = b.y + b.sy / 2
    expect(top).toBeGreaterThan(124)
    expect(top).toBeLessThan(132)
    expect(b.z - b.sz / 2).toBeLessThan(-12) // the tip leans about 12.5 m seaward of the hinge
  })

  it('a ray through the raised boom picks its crane; the same ray misses once the boom is down', () => {
    const m = lowered()
    const x = m.stsPose(sts, 50).gantryX
    // a ray across the quay at 110 m, through the raised boom only (the apex is at 82 m)
    const ray = { origin: { x, y: 110, z: -500 }, dir: { x: 0, y: 0, z: 1 } }
    expect(pickEntity(m, 50, ray)).toBe(sts)
    expect(pickEntity(m, 1000, ray)).toBeNull()
  })
})
