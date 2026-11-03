/**
 * #218: when `wtpPadSelection` answers no pad (every pad `block-full` or taken), the SHC job waits until the pad or
 * block-room picture changes (a pad frees, `blockRoom` rises) instead of being dispatched and asked again at once
 * (the zero-time loop #214 saw at sim t=1527 on a small full block). Event-driven, deterministic.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type DecisionHandler, type EngineEvent } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'

const CAP = 60000
const HOUR = 3600

/** 2 bays x 2 tiers (32 cells), 16 discharge and 16 load boxes, scripted export drops then import pick-ups. */
function fullBlock(strategy: string, seed: number) {
  return new ScenarioBuilder('block-full', 'block full')
    .hatch({ enabled: false })
    .seed(seed)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'Big', sizeClass: 'feeder', discharge: 16, load: 16, maxSts: 1, sizeMix: { '20': 1 } })
    .shcs(2)
    .block('B01', { x: 20, bays: 2, tiers: 2 })
    .landside({
      hourlyProfile: Array.from({ length: 24 }, () => 0),
      scripted: [
        ...Array.from({ length: 16 }, (_, i) => ({ atS: 60 + i * 30, transaction: 'dropExport' as const })),
        ...Array.from({ length: 16 }, (_, i) => ({ atS: 900 + i * 30, transaction: 'pickImport' as const })),
      ],
    })
    .queueAreas({ stsCapacity: 3, blockCapacity: 3 })
    .decisions({ points: { shcDispatch: { strategy } } })
    .endWhen({ simDurationS: 8 * HOUR })
    .build()
}

describe.each(['nearest-job', 'chained-nearest', 'paired-dual-cycle'])('SHC dispatch on a full block, %s (#218)', (strategy) => {
  it.each([1, 2, 3])('seed %i: the event cap is not reached, the clock advances, 0 violations', (seed) => {
    const sim = createSimulation(fullBlock(strategy, seed))
    const r = sim.runUntil({ maxEvents: CAP })
    expect(r.reason).not.toBe('max-events')
    expect(sim.snapshot().state.now).toBeGreaterThan(HOUR)
    expect(sim.invariantReport().violations).toEqual([])
  })
})

describe('a job parked for pad room (#218)', () => {
  /** A TOS that never finds a pad: a job is asked once per pad picture, not once per dispatch event. */
  it('is asked once per pad picture, not once per dispatch event', () => {
    const asks: number[] = []
    const counting: DecisionHandler<'wtpPadSelection'> = (msg) => {
      asks.push(msg.payload.wtpPads.filter((p) => p.occupiedBy === null && p.claimedBy === null).length)
      return { wtpPadId: null }
    }
    const sim = createSimulation(fullBlock('nearest-job', 1), { wtpPadSelection: counting })
    const r = sim.runUntil({ maxEvents: CAP, time: 2 * HOUR })
    expect(r.reason).not.toBe('max-events')
    // 16 discharge jobs and a handful of pad pictures: far fewer asks than dispatch-driven re-asking would make
    expect(asks.length).toBeLessThan(100)
  })

  it('is deterministic for the same seed', () => {
    const run = () => {
      const sim = createSimulation(fullBlock('chained-nearest', 2))
      sim.runUntil({ maxEvents: CAP })
      return sim.eventLog().map((e: EngineEvent) => `${e.t}:${e.type}`).join('|')
    }
    expect(run()).toBe(run())
  })
})
