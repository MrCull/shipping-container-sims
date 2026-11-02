/**
 * TT-185: a pick-only truck is sent to a block only when the rehandles its pick needs have target room there.
 *
 * Before 0.37.0 the truck was sent as soon as a stall of its block was free. In a nearly full block its box could be buried
 * under blockers that had no stack to go to: the truck stood at the stall with its box on no chassis (`landside.stranded-truck`
 * after the stall limit, the 0.25 baseline's T0466 at B03-TS1). Now it waits off the block (queue or holding position) until
 * a lift elsewhere in the block makes room.
 */
import { describe, expect, it } from 'vitest'
import { blockSpecs, createSimulation, defaultHandlers, rehandleRoomFor, type BlockSpec, type Simulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'

const HOUR = 3600

/** A 1-bay, 4-tier block (32 cells) pre-filled with imports to the brim, then `trucks` scripted import pickups 60 s apart. */
function fullBlock(trucks: number, seed: number): ScenarioConfig {
  return new ScenarioBuilder('pick-admission', 'Pick admission')
    .hatch({ enabled: false })
    .seed(seed)
    .moveVariation(10)
    .driverVariability(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'Idle', sizeClass: 'feeder', discharge: 0, load: 0, maxSts: 1 })
    .shcs(2)
    .block('B01', { x: 20, bays: 1, tiers: 4, transferStalls: 3 })
    .yardStart({ mode: 'prefilled', targetPct: 100, mix: { import: 100, export: 0, transshipment: 0 } })
    .landside({
      hourlyProfile: Array.from({ length: 24 }, () => 0),
      importDwell: { kind: 'fixed', s: 60 },
      exportWindow: { minBeforeEtaS: 3600, maxBeforeEtaS: 36000 },
      gate: { inLanes: 6, outLanes: 2, inProcessingS: 30, outProcessingS: 20 },
      scripted: Array.from({ length: trucks }, (_, i) => ({ atS: 600 + i * 60, transaction: 'pickImport' as const })),
    })
    .endWhen({ simDurationS: 4 * HOUR })
    .build()
}

describe('pick admission', () => {
  it('keeps a pick whose rehandle has no room off the block until room appears, then serves it', () => {
    const config = fullBlock(10, 5)
    const spec = blockSpecs(config).find((b) => b.id === 'B01') as BlockSpec
    let decided = 0
    let noRoom = 0
    const sim: Simulation = createSimulation(
      config,
      {
        transferStallSelection: (msg, query) => {
          // the stall decision is asked only for a truck whose rehandles have room in its block
          const { state } = sim.snapshot()
          decided++
          for (const job of Object.values(state.ascJobs)) if (job.truckId === msg.payload.truckId && !rehandleRoomFor(state, spec, job)) noRoom++
          return defaultHandlers.transferStallSelection(msg, query)
        },
      },
      { invariants: { failFast: false } },
    )
    const result = sim.runUntil()
    expect(result.reason).toBe('ended')
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.eventLog().filter((e) => e.type === 'TruckDeparted')).toHaveLength(10)
    expect(decided).toBe(10)
    expect(noRoom).toBe(0)
    // the block was full when the trucks came: some truck waited with a stall free, so the room check held it back
    const waited = sim.eventLog().filter((e) => e.type === 'TruckWaitingForStall').length
    expect(waited).toBeGreaterThan(0)
  })
})
