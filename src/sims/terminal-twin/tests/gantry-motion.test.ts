/**
 * #125: the scene model says when a crane is gantrying (travelling along its rails): true only while a gantry-axis
 * motion segment is in progress. The gantry alarm and the amber beacons follow it.
 */
import { describe, expect, it } from 'vitest'
import { planSegment } from '../engine'
import { SceneModel } from '../modules/sceneModel'
import { fixtures } from '../scenario/fixtures'
import { emptyDelta } from './delta'

const config = fixtures['asc-1sts-10-boxes-1block']
const PROFILE = { vMax: 1, accel: 0.5, decel: 0.5 }

describe('scene model gantrying', () => {
  it('is true for an STS only while its gantry segment is in progress', () => {
    const m = new SceneModel(config)
    const sts = config.sts[0].id
    const seg = planSegment(sts, 'gantry', m.stsPose(sts, 0).gantryX, m.stsPose(sts, 0).gantryX + 10, 100, PROFILE)
    m.apply(emptyDelta({ motion: [{ entityId: sts, segments: [seg] }] }))
    expect(m.isGantrying(sts, 50)).toBe(false)
    expect(m.isGantrying(sts, (seg.t0 + seg.t1) / 2)).toBe(true)
    expect(m.isGantrying(sts, seg.t1 + 1)).toBe(false)
  })

  it('is false for hoist and trolley motion, and for an unknown id', () => {
    const m = new SceneModel(config)
    const sts = config.sts[0].id
    const hoist = planSegment(sts, 'hoist', 10, 30, 10, PROFILE)
    m.apply(emptyDelta({ motion: [{ entityId: sts, segments: [hoist] }] }))
    expect(m.isGantrying(sts, (hoist.t0 + hoist.t1) / 2)).toBe(false)
    expect(m.isGantrying('nope', 5)).toBe(false)
  })

  it('works for an ASC (gantry along the block)', () => {
    const m = new SceneModel(config)
    const asc = m.ascIds[0]
    const seg = planSegment(asc, 'gantry', 0, 20, 5, PROFILE)
    m.apply(emptyDelta({ motion: [{ entityId: asc, segments: [seg] }] }))
    expect(m.isGantrying(asc, (seg.t0 + seg.t1) / 2)).toBe(true)
    expect(m.isGantrying(asc, seg.t1 + 0.5)).toBe(false)
  })
})
