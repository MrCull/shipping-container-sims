/**
 * #298: STS booms (subsystem mode `boom`). Booms raise before a vessel moors or unmoors under them, park up while the
 * crane is idle and lower just before the first move on a vessel. Mode off (every existing fixture) has no boom motion.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, planSegment, restoreSimulation, type EngineEvent, type EventOf } from '../engine'
import { fixtures } from '../scenario/fixtures'
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
