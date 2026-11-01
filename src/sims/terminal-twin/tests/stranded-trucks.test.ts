/**
 * TT-175: trucks are never stranded at an ASC landside transfer point.
 *
 * A "stranded" truck stands at its stall with its box on the chassis while no ASC of the block works and no job of the
 * block can start (the invariant `landside.stranded-truck`). Before #175 the cause was a stacking job whose
 * yardAllocation said "full" (never asked again) and drop-only trucks sent to a stall in a block with no room.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, defaultHandlers, type Simulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'

const STRANDED = 'landside.stranded-truck'

type Transaction = 'dropEmpty' | 'pickImport' | 'dropExport' | 'dual'

/** A feeder unloads 4 import boxes into a yard of the given blocks, with scripted trucks (one every 20 s from 3000 s by default). */
function terminal(blocks: { id: string; x: number; bays: number; tiers: number }[], transactions: Transaction[], gapS = 20): ScenarioConfig {
  const builder = new ScenarioBuilder('stranded-trucks', 'Small block, drop-only trucks')
    .hatch({ enabled: false })
    .seed(8)
    .moveVariation(10)
    .driverVariability(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'Import Star', sizeClass: 'feeder', discharge: 4, maxSts: 1, sizeMix: { '20': 1 } })
    .shcs(2)
  for (const b of blocks) builder.block(b.id, { x: b.x, bays: b.bays, tiers: b.tiers, transferStalls: 2 })
  return builder
    .landside({
      hourlyProfile: Array.from({ length: 24 }, () => 0),
      importDwell: { kind: 'fixed', s: 300 },
      exportWindow: { minBeforeEtaS: 3600, maxBeforeEtaS: 36000 },
      gate: { inLanes: 2, outLanes: 2, inProcessingS: 30, outProcessingS: 20 },
      scripted: transactions.map((transaction, i) => ({ atS: 3000 + i * gapS, transaction })),
    })
    .endWhen({ simDurationS: 9000 })
    .build()
}

/** A small block (2 bays of 8 rows and 1 tier: 16 cells) with 14 drop-only trucks. */
const smallBlockDrops = () =>
  terminal([{ id: 'B01', x: 20, bays: 2, tiers: 1 }], Array.from({ length: 14 }, () => 'dropEmpty' as const))

const strandedViolations = (sim: Simulation) => sim.invariantReport().violations.filter((v) => v.invariant === STRANDED)

describe('drop-only trucks on a small block', () => {
  it('never stay stranded at a stall: the run ends with no stranded-truck violation', () => {
    const sim = createSimulation(smallBlockDrops())
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.firstError).toBeNull()
    expect(strandedViolations(sim)).toEqual([])
  })

  it('sends a drop to a stall only in a block that has room (the stall choice respects block room)', () => {
    // block B01 (8 cells) fills up; the second block takes the rest, so B01 never gets more drops than it has cells
    const cfg = terminal(
      [
        { id: 'B01', x: 20, bays: 2, tiers: 1 },
        { id: 'B02', x: 60, bays: 4, tiers: 2 },
      ],
      Array.from({ length: 14 }, () => 'dropEmpty' as const),
    )
    const sim = createSimulation(cfg)
    expect(sim.runUntil().reason).toBe('ended')
    expect(strandedViolations(sim)).toEqual([])
    const assigned = sim.eventLog().filter((e) => e.type === 'TruckStallAssigned')
    const inFullBlock = assigned.filter((e) => e.type === 'TruckStallAssigned' && e.payload.blockId === 'B01')
    expect(inFullBlock.length).toBeLessThanOrEqual(8)
    expect(assigned.some((e) => e.type === 'TruckStallAssigned' && e.payload.blockId === 'B02')).toBe(true)
  })
})

describe('a "full" stacking job is retried when room appears in its block', () => {
  it('a refused drop is stacked after a pick frees a cell, and its truck leaves', () => {
    // the TOS refuses the first truck drop ("full"); a pick truck later takes a box out of the block, which frees room
    let refused = false
    const sim = createSimulation(
      terminal([{ id: 'B01', x: 20, bays: 2, tiers: 1 }], ['dropEmpty', 'pickImport']),
      {
        yardAllocation: (msg, query) => {
          if (!refused && msg.payload.stallId !== undefined) {
            refused = true
            return { slotId: null }
          }
          return defaultHandlers.yardAllocation(msg, query)
        },
      },
    )
    expect(sim.runUntil().reason).toBe('ended')
    expect(refused).toBe(true)
    expect(sim.kpiReport().yard!.allocationFailures).toBeGreaterThan(0)
    expect(strandedViolations(sim)).toEqual([])
    const arrived = sim.eventLog().filter((e) => e.type === 'TruckArrived').length
    const departed = sim.eventLog().filter((e) => e.type === 'TruckDeparted').length
    expect(departed).toBe(arrived)
  })
})

describe('the invariant catches a truck that stays stranded', () => {
  it('a truck whose drop is refused with no room ever freeing up is reported', () => {
    // every truck drop is refused and no pick ever frees room: the first truck stands at its stall for good
    const sim = createSimulation(
      terminal([{ id: 'B01', x: 20, bays: 2, tiers: 1 }], ['dropEmpty', 'dropEmpty']),
      {
        yardAllocation: (msg, query) => (msg.payload.stallId !== undefined ? { slotId: null } : defaultHandlers.yardAllocation(msg, query)),
      },
    )
    sim.runUntil()
    const violations = strandedViolations(sim)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0].message).toMatch(/has waited .* s at stall B01-TS\d .*no job that can start/)
  })
})
