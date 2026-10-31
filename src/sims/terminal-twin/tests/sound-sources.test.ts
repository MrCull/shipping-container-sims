/**
 * #129: what the scene model says about sound. States (trolley/hoist working, a vehicle driving or reversing) are asked
 * at a time; moments (twistlock lock and unlock, landing, a truck braking to a stop) are read from the window since the
 * last frame, so a short sound is not skipped at high playback speed. Driven with the same Delta the worker sends.
 */
import { describe, expect, it } from 'vitest'
import { planSegment, type Axis, type MotionSegment } from '../engine'
import { SceneModel } from '../modules/sceneModel'
import { fixtures } from '../scenario/fixtures'
import { emptyDelta } from './delta'

const PROFILE = { vMax: 1, accel: 0.5, decel: 0.5 }
const config = fixtures['asc-1sts-10-boxes-1block']

describe('scene model sound states', () => {
  it('is working while an STS or ASC trolley or hoist segment is in progress, not for the gantry', () => {
    const m = new SceneModel(config)
    const sts = config.sts[0].id
    const asc = m.ascIds[0]
    const hoist = planSegment(sts, 'hoist', 10, 30, 10, PROFILE)
    const trolley = planSegment(asc, 'trolley', 0, 10, 50, PROFILE)
    const gantry = planSegment(sts, 'gantry', 0, 10, 200, PROFILE)
    m.apply(emptyDelta({ motion: [{ entityId: sts, segments: [hoist, gantry] }, { entityId: asc, segments: [trolley] }] }))
    expect(m.isWorking(sts, (hoist.t0 + hoist.t1) / 2)).toBe(true)
    expect(m.isWorking(sts, hoist.t1 + 1)).toBe(false)
    expect(m.isWorking(asc, (trolley.t0 + trolley.t1) / 2)).toBe(true)
    expect(m.isWorking(sts, (gantry.t0 + gantry.t1) / 2)).toBe(false)
    expect(m.isWorking('nope', 5)).toBe(false)
  })
})

describe('scene model vehicle sound states', () => {
  const trucks = fixtures['dual-truck-transaction']
  const TRUCK = 'T1'
  const vp = { vMax: 8, accel: 2, decel: 2 }
  const leg = (axis: Axis, from: number, to: number, t0: number): MotionSegment => planSegment(TRUCK, axis, from, to, t0, vp)

  it('reports a truck driving forward, then reversing, then stopped', () => {
    const m = new SceneModel(trucks)
    const p0 = m.truckPose(TRUCK, 0)
    const fwd = leg('x', p0.x, p0.x + 40, 0)
    const back = leg('x', p0.x + 40, p0.x + 10, fwd.t1 + 5) // a leg against the heading with no turn: reversing
    m.apply(emptyDelta({ motion: [{ entityId: TRUCK, segments: [fwd, back] }], entities: [{ kind: 'truck', id: TRUCK, t: 0, status: 'in-lane' }] }))
    const mid = (s: MotionSegment) => (s.t0 + s.t1) / 2
    expect(m.isDriving(TRUCK, mid(fwd))).toBe(true)
    expect(m.isReversing(TRUCK, mid(fwd))).toBe(false)
    expect(m.isDriving(TRUCK, mid(back))).toBe(true)
    expect(m.isReversing(TRUCK, mid(back))).toBe(true)
    expect(m.isDriving(TRUCK, back.t1 + 1)).toBe(false)
    expect(m.isReversing(TRUCK, back.t1 + 1)).toBe(false)
    expect(m.isDriving('nope', 1)).toBe(false)
  })

  it('emits a braking shot at a truck position when a leg ends inside the window, once', () => {
    const m = new SceneModel(trucks)
    const p0 = m.truckPose(TRUCK, 0)
    const fwd = leg('x', p0.x, p0.x + 40, 0)
    m.apply(emptyDelta({ motion: [{ entityId: TRUCK, segments: [fwd] }], entities: [{ kind: 'truck', id: TRUCK, t: 0, status: 'in-lane' }] }))
    expect(m.shotsBetween(0, fwd.t1 - 0.1)).toEqual([])
    const shots = m.shotsBetween(fwd.t1 - 1, fwd.t1 + 1)
    expect(shots).toHaveLength(1)
    expect(shots[0]).toMatchObject({ machine: 'truck', id: TRUCK, motion: 'braking' })
    expect(shots[0].x).toBeCloseTo(p0.x + 40, 3)
    expect(m.shotsBetween(fwd.t1 + 1, fwd.t1 + 5)).toEqual([])
  })
})

describe('scene model sound shots from custody handoffs', () => {
  const setup = () => {
    const m = new SceneModel(config)
    const box = m.containerIds[0]
    const sts = config.sts[0].id
    const asc = m.ascIds[0]
    return { m, box, sts, asc }
  }

  it('clunks when a crane picks a box up and when it lets go, and thuds when the box lands', () => {
    const { m, box, sts } = setup()
    const slot = m.custodyAt(box, 0)!
    m.apply(emptyDelta({ custody: [{ containerId: box, t: 10, owner: { kind: 'sts', id: sts } }, { containerId: box, t: 40, owner: { kind: 'groundPosition', id: 'G1' }, x: 100 }] }))
    const pick = m.shotsBetween(9, 11)
    expect(pick.map((s) => [s.machine, s.id, s.motion])).toEqual([['sts', sts, 'locking']])
    expect(slot).not.toBeNull()
    const drop = m.shotsBetween(39, 41)
    expect(drop.map((s) => s.motion).sort()).toEqual(['landing', 'unlocking'])
    expect(drop.every((s) => s.machine === 'sts' && s.id === sts)).toBe(true)
    expect(m.shotsBetween(11, 39)).toEqual([])
  })

  it('does not thud for a handover between two carriers, and works for an ASC', () => {
    const { m, box, sts, asc } = setup()
    m.apply(emptyDelta({ custody: [{ containerId: box, t: 5, owner: { kind: 'asc', id: asc } }, { containerId: box, t: 20, owner: { kind: 'sts', id: sts } }] }))
    expect(m.shotsBetween(4, 6).map((s) => [s.machine, s.motion])).toEqual([['asc', 'locking']])
    expect(m.shotsBetween(19, 21).map((s) => [s.machine, s.id, s.motion]).sort()).toEqual([['asc', asc, 'unlocking'], ['sts', sts, 'locking']].sort())
  })

  it('forgets old shots when pruned and reads each shot once per window (t0 exclusive, t1 inclusive)', () => {
    const { m, box, sts } = setup()
    m.apply(emptyDelta({ custody: [{ containerId: box, t: 10, owner: { kind: 'sts', id: sts } }] }))
    expect(m.shotsBetween(10, 11)).toEqual([])
    expect(m.shotsBetween(9, 10)).toHaveLength(1)
    m.prune(100)
    expect(m.shotsBetween(0, 100)).toEqual([])
  })
})
