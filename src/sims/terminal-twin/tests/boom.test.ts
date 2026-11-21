/**
 * #298: STS booms (subsystem mode `boom`). Booms raise before a vessel moors or unmoors under them, park up while the
 * crane is idle and lower just before the first move on a vessel. Mode off (every existing fixture) has no boom motion.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, planSegment, restoreSimulation, STS_LAND_RAIL_Z, stsParkPose, type EngineEvent, type EventOf } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'

const boomFixture = fixtures['boom-berthing']

function run(config: ScenarioConfig) {
  const sim = createSimulation(config)
  expect(sim.runUntil().reason).toBe('ended')
  expect(sim.invariantReport().violations).toEqual([])
  return { sim, log: sim.eventLog() }
}

type BoomEvent = EventOf<'StsBoomStarted'> | EventOf<'StsBoomCompleted'>

const vesselEvent = (log: readonly EngineEvent[], type: EngineEvent['type'], vesselId: string) =>
  log.find((e) => e.type === type && e.subjects.vessels?.includes(vesselId)) as EngineEvent
const boomStarts = (log: readonly EngineEvent[]) => log.filter((e): e is EventOf<'StsBoomStarted'> => e.type === 'StsBoomStarted')
const boomDones = (log: readonly EngineEvent[]) => log.filter((e): e is EventOf<'StsBoomCompleted'> => e.type === 'StsBoomCompleted')
const boomEvents = (log: readonly EngineEvent[], stsId: string): BoomEvent[] =>
  [...boomStarts(log), ...boomDones(log)].filter((e) => e.payload.stsId === stsId).sort((a, b) => a.seq - b.seq)

describe('STS booms (boom mode real)', () => {
  it('each crane lowers just before its first move on a vessel and raises once after its last move', () => {
    const { log } = run(boomFixture)
    for (const vesselId of ['V001', 'V002']) {
      const berthed = vesselEvent(log, 'VesselBerthed', vesselId)
      const done = vesselEvent(log, 'VesselWorkComplete', vesselId)
      for (const stsId of ['STS01', 'STS02']) {
        const window = log.filter((e) => e.seq > berthed.seq && e.seq <= done.seq && e.subjects.equipment?.includes(stsId))
        const firstMove = window.findIndex((e) => e.type === 'StsMoveStarted')
        expect(firstMove).toBeGreaterThan(0)
        const before = boomDones(window.slice(0, firstMove))
        expect(before.map((e) => e.payload.op)).toEqual(['lower'])
        expect(before[0].payload.boomDeg).toBe(0)
        const raises = boomStarts(window).filter((e) => e.payload.op === 'raise')
        expect(raises).toHaveLength(1)
        expect(raises[0].seq).toBeGreaterThan(window.filter((e) => e.type === 'StsGrounded').at(-1)!.seq)
      }
    }
  })

  it('segment durations come from config: the boom turns working to stowed in boomTransitionS', () => {
    const config = structuredClone(boomFixture)
    config.kinematics.sts.boomTransitionS = 90
    const { log } = run(config)
    const booms = boomStarts(log).flatMap((e) => e.payload.segments.filter((s) => s.axis === 'boom'))
    expect(booms.length).toBeGreaterThan(0)
    for (const s of booms) {
      expect(s.t1 - s.t0).toBeCloseTo(90, 6)
      expect(Math.abs(s.to - s.from)).toBe(80)
    }
    // a raise parks the spreader and the trolley before the boom moves, and never gantries
    for (const e of boomStarts(log).filter((x) => x.payload.op === 'raise')) {
      const boom = e.payload.segments.find((s) => s.axis === 'boom')!
      for (const s of e.payload.segments.filter((x) => x.axis !== 'boom')) expect(s.t1).toBeLessThanOrEqual(boom.t0)
      expect(e.payload.segments.some((s) => s.axis === 'gantry')).toBe(false)
    }
  })

  it('before a raise the trolley parks on the backreach and the spreader hoists to the class lift height', () => {
    const config = structuredClone(boomFixture)
    config.sts[0].craneClass = 'super-post-panamax'
    const { log } = run(config)
    for (const stsId of ['STS01', 'STS02']) {
      const park = stsParkPose(config, stsId)
      expect(park.trolleyZ).toBeCloseTo(STS_LAND_RAIL_Z + 18, 6)
      expect(park.hoistY).toBe(stsId === 'STS01' ? 43 : 52)
      const raises = boomStarts(log).filter((e) => e.payload.op === 'raise' && e.payload.stsId === stsId)
      expect(raises.length).toBeGreaterThan(0)
      for (const r of raises) {
        const boom = r.payload.segments.find((s) => s.axis === 'boom')!
        const trolley = r.payload.segments.filter((s) => s.axis === 'trolley').at(-1)
        const hoist = r.payload.segments.filter((s) => s.axis === 'hoist').at(-1)
        expect(trolley?.to).toBeCloseTo(park.trolleyZ, 6)
        // no hoist segment: the spreader is at the lift height already (SPP: its 43 m cap is the travel height)
        expect(hoist?.to ?? park.hoistY).toBe(park.hoistY)
        if (stsId === 'STS02') expect(hoist?.to).toBe(52)
        expect(trolley!.t1).toBeLessThanOrEqual(boom.t0)
      }
    }
  })

  it('VesselBerthed waits for every boom over the vessel to be up (mooring alone would be shorter)', () => {
    const config = structuredClone(boomFixture)
    config.kinematics.sts.boomTransitionS = 900 // longer than the 600 s mooring
    const snap = createSimulation(config).snapshot()
    snap.state.sts.STS01.boomDeg = 0 // STS01 starts boom down over the berth
    const resumed = restoreSimulation(snap)
    expect(resumed.runUntil().reason).toBe('ended')
    expect(resumed.invariantReport().violations).toEqual([])
    const log = resumed.eventLog()
    const raised = boomDones(log).find((e) => e.payload.stsId === 'STS01')!
    expect(raised.payload.op).toBe('raise')
    const berthed = vesselEvent(log, 'VesselBerthed', 'V001')
    expect(berthed.t).toBe(raised.t)
    expect(berthed.t).toBeGreaterThan(config.quay.mooringS)
  })

  it('unmooring waits for every boom over the vessel: VesselDeparted is unmooringS after the last raise', () => {
    const { log } = run(boomFixture)
    for (const vesselId of ['V001', 'V002']) {
      const done = vesselEvent(log, 'VesselWorkComplete', vesselId)
      const departed = vesselEvent(log, 'VesselDeparted', vesselId)
      const lastRaise = boomDones(log).filter((e) => e.payload.op === 'raise' && e.t <= departed.t).at(-1)!
      expect(lastRaise.t).toBeGreaterThan(done.t)
      expect(departed.t).toBeCloseTo(lastRaise.t + boomFixture.quay.unmooringS, 6)
    }
  })

  it('a crane not over the vessel never moves its boom; every idle crane ends boom up', () => {
    const { sim, log } = run(boomFixture)
    expect(boomEvents(log, 'STS03')).toEqual([])
    for (const id of ['STS01', 'STS02', 'STS03']) expect(sim.query.sts(id).boomDeg).toBe(80)
  })

  it('rail order holds with booms raised', () => {
    const { sim } = run(boomFixture) // sts.rail-order is checked after every event: no violations
    const cranes = ['STS01', 'STS02', 'STS03'].map((id) => sim.query.sts(id))
    for (let i = 1; i < cranes.length; i++)
      expect(cranes[i].gantryX - cranes[i - 1].gantryX).toBeGreaterThanOrEqual(boomFixture.quay.stsMinSpacingM)
  })

  it('mode off: no boom events, no boom state, mooring alone sets VesselBerthed', () => {
    const config = structuredClone(boomFixture)
    config.subsystems = { ...config.subsystems, boom: 'off' }
    const { sim, log } = run(config)
    expect(log.some((e) => e.type.startsWith('StsBoom'))).toBe(false)
    expect(sim.query.sts('STS01').boomDeg).toBeUndefined()
    expect(vesselEvent(log, 'VesselBerthed', 'V001').t).toBe(config.quay.mooringS)
  })
})

/** Two Panamax ships side by side; a 300 m clearance margin puts every crane over both, so V002 moors and unmoors under the cranes working V001. */
function sideBySide(): ScenarioConfig {
  return new ScenarioBuilder('boom-side-by-side', 'Two Panamax ships side by side, booms real')
    .hatch({ enabled: false })
    .seed(3)
    .quay(900, { mooringS: 600, unmooringS: 600 })
    .sts('STS01', { gantryX: 80, groundPositions: 24 })
    .sts('STS02', { gantryX: 250, groundPositions: 24 })
    .sts('STS03', { gantryX: 700, groundPositions: 24 })
    .subsystems({ boom: 'real' }).stsKinematics({ boomClearanceMarginM: 300 })
    .vesselCall('V001', { name: 'HMM Tarifa', sizeClass: 'panamax', arrivalS: 0, discharge: 40, maxSts: 2 })
    .vesselCall('V002', { name: 'Maersk Alboran', sizeClass: 'panamax', arrivalS: 1200, discharge: 4, maxSts: 1 })
    .endWhen({ vesselsCompleted: 2 })
    .build()
}

describe('busy cranes over a neighbouring vessel (#297 review)', () => {
  const runSide = () => run(sideBySide())
  /** Raises inside [from, to] by a crane still working `workingOn` (its StsWorkComplete for that vessel comes later). */
  const busyRaises = (log: readonly EngineEvent[], from: number, to: number, workingOn: string) =>
    boomStarts(log).filter((e) => {
      if (e.payload.op !== 'raise' || e.t < from || e.t > to) return false
      const done = log.find(
        (x) => x.seq > e.seq && x.type === 'StsWorkComplete' && x.subjects.equipment?.includes(e.payload.stsId) && x.subjects.vessels?.includes(workingOn),
      )
      const before = log.some(
        (x) => x.seq < e.seq && x.type === 'StsWorkComplete' && x.subjects.equipment?.includes(e.payload.stsId) && x.subjects.vessels?.includes(workingOn),
      )
      return done !== undefined && !before
    })
  const raiseDone = (log: readonly EngineEvent[], r: EventOf<'StsBoomStarted'>) =>
    boomDones(log).find((e) => e.seq > r.seq && e.payload.stsId === r.payload.stsId)!

  it('a busy crane over a mooring vessel raises after its cycle; VesselBerthed waits for it; it lowers after and carries on', () => {
    const { log } = runSide()
    const allocated = vesselEvent(log, 'BerthAllocated', 'V002')
    const berthed = vesselEvent(log, 'VesselBerthed', 'V002')
    const raises = busyRaises(log, allocated.t, berthed.t, 'V001')
    expect(raises.length).toBeGreaterThan(0)
    for (const r of raises) {
      const stsId = r.payload.stsId
      const done = raiseDone(log, r)
      expect(done.payload.op).toBe('raise')
      expect(berthed.t).toBeGreaterThanOrEqual(done.t)
      // no boom or work move between the raise and VesselBerthed, then a lower and more moves on V001
      const after = log.filter((e) => e.seq > done.seq && e.subjects.equipment?.includes(stsId))
      const nextStart = after.find((e) => e.type === 'StsBoomStarted' || e.type === 'StsMoveStarted') as EventOf<'StsBoomStarted'>
      expect(nextStart.type).toBe('StsBoomStarted')
      expect(nextStart.payload.op).toBe('lower')
      expect(nextStart.seq).toBeGreaterThan(berthed.seq)
      expect(after.some((e) => e.type === 'StsMoveStarted' && e.subjects.vessels?.includes('V001'))).toBe(true)
    }
  })

  it('a busy crane over a departing vessel raises too; VesselDeparted is unmooringS after its raise', () => {
    const { log } = runSide()
    const done2 = vesselEvent(log, 'VesselWorkComplete', 'V002')
    const departed = vesselEvent(log, 'VesselDeparted', 'V002')
    const raises = busyRaises(log, done2.t, departed.t, 'V001')
    expect(raises.length).toBeGreaterThan(0)
    const lastUp = Math.max(...raises.map((r) => raiseDone(log, r).t))
    expect(departed.t).toBeGreaterThanOrEqual(lastUp + sideBySide().quay.unmooringS - 1e-6)
  })
})

describe('sts.boom-working invariant', () => {
  it('catches a hoist move planned while the boom is up', () => {
    const sim = createSimulation(boomFixture)
    sim.runUntil({ time: 100 })
    const snap = sim.snapshot()
    const now = snap.state.now
    // STS03 is idle with its boom up: give it a hoist move
    const hoist = planSegment('STS03', 'hoist', 50, 20, now, { vMax: 1.5, accel: 0.6, decel: 0.6 })
    hoist.t1 = now + 3600 // still under way at the next event
    snap.state.sts.STS03.motion = [hoist]
    const resumed = restoreSimulation(snap)
    resumed.runUntil()
    const v = resumed.invariantReport().violations
    expect(v[0]?.invariant).toBe('sts.boom-working')
    expect(v[0]?.message).toMatch(/STS03 hoist/)
  })

  it('catches gantry travel during a boom transition', () => {
    const sim = createSimulation(boomFixture)
    sim.runUntil({ eventType: 'StsBoomStarted' })
    const snap = sim.snapshot()
    const sts = Object.values(snap.state.sts).find((s) => s.motion.some((m) => m.axis === 'boom'))!
    const boom = sts.motion.find((m) => m.axis === 'boom')!
    sts.motion.push(planSegment(sts.id, 'gantry', sts.gantryX, sts.gantryX, boom.t0, { vMax: 1, accel: 0.5, decel: 0.5 }))
    sts.motion[sts.motion.length - 1].to = sts.gantryX - 5
    sts.motion[sts.motion.length - 1].t1 = boom.t1
    const resumed = restoreSimulation(snap)
    resumed.runUntil()
    expect(resumed.invariantReport().violations[0]?.invariant).toBe('sts.boom-working')
  })
})
