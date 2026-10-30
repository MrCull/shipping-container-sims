import { describe, expect, it } from 'vitest'
import { createSimulation, restoreSimulation, type EngineEvent, type HandlerSet, type Simulation, type SimSnapshot } from '../engine'
import { fixtures } from '../scenario/fixtures'

const tracer = fixtures['tracer-1sts-10-boxes']

/** Broken TOS handler: always answers lane 1, even when a box is already there. */
const alwaysFirstLane: Partial<HandlerSet> = {
  stsGroundPosition: (msg) => ({ groundPositionId: msg.payload.groundPositions[0].id }),
}

describe('invariant checker', () => {
  it('runs after every event of a healthy run and finds nothing', () => {
    const sim = createSimulation(tracer)
    sim.runUntil()
    const report = sim.invariantReport()
    expect(report.enabled).toBe(true)
    expect(report.violations).toEqual([])
    // every processed event except the synthetic ScenarioEnded was checked
    expect(report.checks).toBe(sim.eventLog().length - 1)
  })

  it('fail-fast: a broken handler stops the run at the offending event', () => {
    const sim = createSimulation(tracer, alwaysFirstLane)
    const result = sim.runUntil()
    expect(result.reason).toBe('failed')
    expect(sim.status).toBe('failed')

    const log = sim.eventLog()
    const grounded = log.filter((e) => e.type === 'StsGrounded')
    // the second box is set down on the occupied first lane
    expect(grounded).toHaveLength(2)
    const offending = grounded[1]
    const last = log.at(-1)
    if (last?.type !== 'InvariantViolated') throw new Error(`expected InvariantViolated, got ${last?.type}`)
    expect(last.payload.invariant).toBe('custody.single-owner')
    expect(last.payload.offendingEventId).toBe(offending.id)
    expect(last.causedBy).toBe(offending.id)
    expect(last.payload.message).toContain(grounded[0].subjects.containers![0])

    expect(sim.firstError?.eventId).toBe(offending.id)
    expect(sim.firstError?.message).toMatch(/custody\.single-owner/)
    expect(sim.step()).toBeNull() // nothing runs after a fail-fast stop
  })

  it('without fail-fast, violations are recorded and the run continues', () => {
    const sim = createSimulation(tracer, alwaysFirstLane, { invariants: { failFast: false } })
    sim.runUntil()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations.length).toBeGreaterThan(0)
    expect(sim.firstError).toBeNull()
  })

  it('can be switched off', () => {
    const sim = createSimulation(tracer, alwaysFirstLane, { invariants: { enabled: false } })
    sim.runUntil()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport()).toEqual({ enabled: false, checks: 0, violations: [] })
  })
})

/** Tamper with a snapshot taken mid-run, resume, and return the next event and the violation it must raise. */
function tamperedStep(sim: Simulation, tamper: (snap: SimSnapshot) => void) {
  const snap = sim.snapshot()
  tamper(snap)
  const resumed = restoreSimulation(snap)
  const stepped = resumed.step() as EngineEvent
  const last = resumed.eventLog().at(-1) as EngineEvent
  return { resumed, stepped, last }
}

function expectCaughtAtExactEvent(r: ReturnType<typeof tamperedStep>, invariant: string) {
  expect(r.resumed.status).toBe('failed')
  if (r.last.type !== 'InvariantViolated') throw new Error(`expected InvariantViolated, got ${r.last.type}`)
  expect(r.last.payload.invariant).toBe(invariant)
  // the very event processed right after the tampering is the offending one
  expect(r.last.payload.offendingEventId).toBe(r.stepped.id)
  expect(r.resumed.firstError?.eventId).toBe(r.stepped.id)
}

describe('injected violations are caught at the exact event (tampered snapshots)', () => {
  const stacked = () => {
    const sim = createSimulation(fixtures['asc-1sts-10-boxes-1block'])
    sim.runUntil({ eventType: 'AscStacked' })
    sim.runUntil({ eventType: 'AscStacked' })
    return sim
  }
  const twoSlots = (snap: SimSnapshot) => Object.values(snap.state.yardSlots).filter((s) => s.containerId)

  it('yard.stack-height: a block whose tier limit is below its lowest stacked tier', () => {
    const r = tamperedStep(stacked(), (snap) => {
      // the tier limit drops below the lowest tier in use
      snap.state.yardBlocks[twoSlots(snap)[0].blockId].tiers = 0
    })
    expectCaughtAtExactEvent(r, 'yard.stack-height')
  })

  it('yard.no-floating: a box on tier 3 with nothing below', () => {
    const r = tamperedStep(stacked(), (snap) => {
      twoSlots(snap)[0].tier = 3
    })
    expectCaughtAtExactEvent(r, 'yard.no-floating')
  })

  it('yard.no-double-occupied: two boxes of one length in one cell', () => {
    const r = tamperedStep(stacked(), (snap) => {
      const [a, b] = twoSlots(snap)
      Object.assign(b, { blockId: a.blockId, bay: a.bay, row: a.row, tier: a.tier, span: a.span })
    })
    expectCaughtAtExactEvent(r, 'yard.no-double-occupied')
  })

  it('reservation.no-overlap: two holders in one zone at the same time', () => {
    const sim = createSimulation(fixtures['shc-1sts-2shc-1wtp'])
    sim.runUntil({ eventType: 'ShcJobAssigned' })
    const r = tamperedStep(sim, (snap) => {
      const t = snap.state.now
      snap.state.reservations.push(
        { id: 9001, zone: 'tamper-zone', holder: 'SHC-A', from: t, to: t + 50 },
        { id: 9002, zone: 'tamper-zone', holder: 'SHC-B', from: t + 10, to: t + 60 },
      )
    })
    expectCaughtAtExactEvent(r, 'reservation.no-overlap')
  })

  it('berth.no-overlap: two vessels moored on the same stretch of quay', () => {
    const sim = createSimulation(fixtures['two-vessels-compete-for-berth'])
    sim.runUntil({ eventType: 'VesselBerthed' })
    const r = tamperedStep(sim, (snap) => {
      const v = Object.values(snap.state.vessels)
      const berthed = v.find((x) => x.berthX !== null && x.status === 'berthed') ?? v[0]
      const other = v.find((x) => x !== berthed) as (typeof v)[number]
      Object.assign(other, { status: 'berthed', berthX: berthed.berthX })
    })
    expectCaughtAtExactEvent(r, 'berth.no-overlap')
  })
})
