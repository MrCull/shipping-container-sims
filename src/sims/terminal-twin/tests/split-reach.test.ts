import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'

/**
 * #369: the berth reach window (#365) lets a Feedermax berth at 0 m because STS01 reaches 0 m, but the crane split
 * chose the two free cranes nearest the work centre, STS02 and STS03. STS02 can never go below 27 m (STS01 must fit
 * beside it), so it waited for ever for the Feedermax's first bay: `sts.rail-reachable` on the peak day.
 */
function feedermaxAtQuayStart() {
  return new ScenarioBuilder('split-reach', 'Feedermax at 0 m, the free cranes nearest its work centre leave out STS01')
    .hatch({ enabled: false })
    .quay(700, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 0, groundPositions: 30 })
    .sts('STS02', { gantryX: 60, groundPositions: 30 })
    .sts('STS03', { gantryX: 100, groundPositions: 30 })
    .sts('STS04', { gantryX: 600, groundPositions: 30 })
    .vesselCall('V001', { sizeClass: 'feedermax', discharge: 24, maxSts: 2, sizeMix: { '20': 1 } })
    .build()
}

describe('crane split within rail reach (#369)', () => {
  it('gives every bay to a crane whose rail reach covers it, so a vessel at the quay start is fully worked', () => {
    const sim = createSimulation(feedermaxAtQuayStart())
    const stop = sim.runUntil({ time: 200_000 })
    const split = sim.eventLog().find((e) => e.type === 'DecisionResolved' && e.payload.decisionPoint === 'craneSplit')
    if (split?.type !== 'DecisionResolved' || split.payload.decisionPoint !== 'craneSplit') throw new Error('no crane split')
    // STS02 reaches 27 m at the lowest; bay 0's aft 20 ft slots sit at 23.93 m, so only STS01 may work bay 0
    expect(split.payload.reply.assignments.find((a) => a.bays.includes(0))?.stsId).toBe('STS01')
    expect(sim.invariantReport().violations).toEqual([])
    expect(stop.reason).toBe('ended')
    expect(sim.kpiReport().movesCompleted).toBe(24)
    expect(sim.kpiReport().vessels.V001.berthX).toBe(0)
  })
})
