import { describe, expect, it } from 'vitest'
import { createSimulation, type HandlerSet } from '../engine'
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
