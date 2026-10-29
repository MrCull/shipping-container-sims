/** V11-15: an STS waiting for a ground position asks again after a back-off (no SHC needed). */
import { describe, expect, it } from 'vitest'
import { createSimulation, type HandlerSet } from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const tracer = fixtures['tracer-1sts-10-boxes']

/** Replies null for the first `nulls` calls, then the first free position. */
function flaky(nulls: number): { handlers: Partial<HandlerSet>; calls: () => number } {
  let n = 0
  return {
    calls: () => n,
    handlers: {
      stsGroundPosition: (msg) => {
        if (n++ < nulls) return { groundPositionId: null }
        return { groundPositionId: msg.payload.groundPositions.find((gp) => gp.occupiedBy === null)!.id }
      },
    },
  }
}

const waitedS = (e: { type: string; payload: unknown }): number => (e.payload as { waitedS: number }).waitedS

describe('STS ground-position wake-up', () => {
  it('a handler that returns null once and then a position lets the crane continue', () => {
    const sim = createSimulation(tracer, flaky(1).handlers)
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.eventLog().filter((e) => e.type === 'StsGrounded')).toHaveLength(10)
  })

  it('each retry raises a new decision request, after the default 30 s back-off', () => {
    const { handlers, calls } = flaky(3)
    const sim = createSimulation(tracer, handlers)
    sim.runUntil()
    expect(calls()).toBe(13) // 10 boxes + 3 retried asks
    const log = sim.eventLog()
    expect(log.filter((e) => e.type === 'StsWaitingForGroundPosition')).toHaveLength(3)
    const ends = log.filter((e) => e.type === 'StsGroundPositionWaitEnded')
    expect(ends).toHaveLength(3)
    for (const e of ends) expect(waitedS(e)).toBeCloseTo(30, 6)
  })

  it('the back-off is configurable (layout.stsGroundRetryS) and 0 turns the timer off', () => {
    const cfg = (s: number): ScenarioConfig => ({ ...tracer, layout: { ...tracer.layout, stsGroundRetryS: s } })
    const fast = createSimulation(cfg(5), flaky(1).handlers)
    fast.runUntil()
    expect(waitedS(fast.eventLog().find((e) => e.type === 'StsGroundPositionWaitEnded')!)).toBeCloseTo(5, 6)

    const off = createSimulation(cfg(0), flaky(1).handlers)
    off.runUntil()
    expect(off.eventLog().filter((e) => e.type === 'StsGroundPositionWaitEnded')).toHaveLength(0)
  })

  it('a handler that never replies with a position keeps asking until the run is stopped', () => {
    const sim = createSimulation(tracer, { stsGroundPosition: () => ({ groundPositionId: null }) })
    sim.runUntil({ time: 400 })
    expect(sim.eventLog().filter((e) => e.type === 'DecisionRequested').length).toBeGreaterThan(5)
  })
})
