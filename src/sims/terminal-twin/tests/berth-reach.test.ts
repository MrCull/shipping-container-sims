import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'

/**
 * #365: cranes never pass, so a crane can reach a gantry X only if every crane between it and the quay end fits
 * beside it. Three small cranes (out of reach of a ULCV, #303) at the low end of the rail keep the first ULCV-capable
 * crane at least 3 x 27 m along the quay; a ULCV berthed at 0 m has bays below that X, which no crane can ever work.
 */
function lowEndSmallCranes(hatch = false) {
  return new ScenarioBuilder('berth-reach', 'Three out-of-reach STS at the low end of the rail, ULCV arrives')
    .hatch({ enabled: hatch })
    .quay(700, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 20, groundPositions: 30, craneClass: 'super-post-panamax' })
    .sts('STS02', { gantryX: 60, groundPositions: 30, craneClass: 'super-post-panamax' })
    .sts('STS03', { gantryX: 100, groundPositions: 30, craneClass: 'super-post-panamax' })
    .sts('STS04', { gantryX: 300, groundPositions: 30 })
    .vesselCall('V001', { sizeClass: 'ulcv', discharge: 24, maxSts: 1, sizeMix: { '40': 1 } })
    .build()
}

describe('berth allocation within crane reach (#365)', () => {
  it('berths a vessel where its eligible cranes can reach every bay, so the run ends with every move done', () => {
    const sim = createSimulation(lowEndSmallCranes())
    const stop = sim.runUntil({ time: 200_000 })
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.kpiReport().movesCompleted).toBe(24)
    expect(stop.reason).toBe('ended')
  })

  it('the sts.rail-reachable invariant fails a crane sent to a bay it can never reach, instead of the run going idle', () => {
    // a TOS that ignores the reach window: the ULCV at 0 m, its first bays below the 81 m STS04 can ever reach
    const sim = createSimulation(lowEndSmallCranes(), { berthAllocation: () => ({ berthX: 0 }) })
    expect(sim.runUntil({ time: 200_000 }).reason).toBe('failed')
    const [first] = sim.invariantReport().violations
    expect(first.invariant).toBe('sts.rail-reachable')
    expect(first.message).toMatch(/STS04 waits for the rail to reach .* outside the 81\.00/)
  })

  it('puts a hatch panel in a laydown bay the crane can reach, not the nearest one below its rail reach', () => {
    // berthed at 33 m, bay 0's nearest laydown bay (75 m) lies below the 81 m STS04 can reach
    const sim = createSimulation(lowEndSmallCranes(true))
    const stop = sim.runUntil({ time: 200_000 })
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.kpiReport().movesCompleted).toBe(24)
    expect(stop.reason).toBe('ended')
  })
})
