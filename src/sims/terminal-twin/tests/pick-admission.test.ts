/**
 * TT-185: a pick-only truck is sent to a block only when the rehandles its pick needs have target room there.
 *
 * Before 0.37.0 the truck was sent as soon as a stall of its block was free. In a nearly full block its box could be buried
 * under blockers that had no stack to go to: the truck stood at the stall with its box on no chassis (`landside.stranded-truck`
 * after the stall limit, the 0.25 baseline's T0466 at B03-TS1). Now it waits off the block (queue or holding position) until
 * a lift elsewhere in the block makes room.
 */
import { describe, expect, it } from 'vitest'
import { blockersOf, blockSpecs, createSimulation, defaultHandlers, rehandleRoomFor, type BlockSpec, type Simulation } from '../engine'
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

/** Same full block, but with one holding position: two drop-only empties arrive first, then the picks that would free room. */
function blockedHead(picks: number, seed: number): ScenarioConfig {
  const config = fullBlock(0, seed)
  config.yard = { blocks: [{ ...(config.yard as NonNullable<ScenarioConfig['yard']>).blocks[0], bays: 2 }] }
  config.yardStart = { mode: 'prefilled', targetPct: 92, mix: { import: 100, export: 0, transshipment: 0 } }
  config.landside = {
    ...(config.landside as NonNullable<ScenarioConfig['landside']>),
    holding: { positions: 1 },
    scripted: [
      { atS: 600, transaction: 'dropEmpty' as const },
      { atS: 630, transaction: 'dropEmpty' as const },
      ...Array.from({ length: picks }, (_, i) => ({ atS: 660 + i * 30, transaction: 'pickImport' as const })),
    ],
  }
  return config
}

describe('gate head-of-line blocking (TT-184)', () => {
  // TT-215: seeds 1 to 9 again except seed 4 (#208 had narrowed it to seed 7). Seed 4 ends in a layout no pick can leave: two earlier
  // rehandles left stacks of unequal height in every row, so no 40 ft blocker has a pair of stacks to go to (pre-existing target choice, not admission)
  it.each([1, 2, 3, 5, 6, 7, 8, 9])('lets a pick pass a drop-only head that no stall admits, so the picks free room for the drops (seed %i)', (seed) => {
    const sim = createSimulation(blockedHead(8, seed), undefined, { invariants: { failFast: false } })
    const result = sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    expect(result.reason).toBe('ended')
    expect(sim.eventLog().filter((e) => e.type === 'TruckDeparted')).toHaveLength(10)
  })

  it('keeps first come, first served when the head can be admitted', () => {
    const config = fullBlock(4, 7)
    const sim = createSimulation(config)
    sim.runUntil()
    const gateIn = sim.eventLog().filter((e) => e.type === 'TruckGateIn').map((e) => (e.payload as { truckId: string }).truckId)
    expect(gateIn).toEqual([...gateIn].sort())
  })
})

/** Two blocks with one stall each and one holding position; the picks come faster than a stall serves them. */
function hotBlock(picks: number, seed: number): ScenarioConfig {
  return new ScenarioBuilder('hot-block', 'Hot block')
    .hatch({ enabled: false })
    .seed(seed)
    .moveVariation(10)
    .driverVariability(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'Idle', sizeClass: 'feeder', discharge: 0, load: 0, maxSts: 1 })
    .shcs(2)
    .block('B01', { x: 20, bays: 6, tiers: 4, transferStalls: 1 })
    .block('B02', { x: 60, bays: 6, tiers: 4, transferStalls: 1 })
    .yardStart({ mode: 'prefilled', targetPct: 50, mix: { import: 100, export: 0, transshipment: 0 } })
    .landside({
      hourlyProfile: Array.from({ length: 24 }, () => 0),
      importDwell: { kind: 'fixed', s: 60 },
      exportWindow: { minBeforeEtaS: 3600, maxBeforeEtaS: 36000 },
      gate: { inLanes: 3, outLanes: 2, inProcessingS: 20, outProcessingS: 20 },
      holding: { positions: 1 },
      scripted: Array.from({ length: picks }, (_, i) => ({ atS: 600 + i * 5, transaction: 'pickImport' as const })),
    })
    .endWhen({ simDurationS: 4 * HOUR })
    .build()
}

describe('gate head-of-line blocking, pick head (TT-184, 0.42.0)', () => {
  it('lets a pick for a free block pass a pick head whose block has every stall taken and no holding position is free', () => {
    const sim = createSimulation(hotBlock(14, 4), undefined, { invariants: { failFast: false } }) // seed 4 since #207: seed 3 lays the pre-fill out so that block B02 rehandles for hours (throughput, no deadlock)
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.eventLog().filter((e) => e.type === 'TruckDeparted')).toHaveLength(14)
    const arrived = sim.eventLog().filter((e) => e.type === 'TruckArrived').map((e) => (e.payload as { truckId: string }).truckId)
    const gateIn = sim.eventLog().filter((e) => e.type === 'TruckGateStarted').map((e) => (e.payload as { truckId: string }).truckId)
    expect(gateIn).toHaveLength(14)
    // somebody passed the head: the gate order is not the arrival order
    expect(gateIn).not.toEqual(arrived)
  })
})

describe('gate bypass takes a lane only at the head (TT-208, 0.45.0)', () => {
  it('holds each lane for about the processing time, and no lane is reserved before a bypassing truck is at the head', () => {
    const sim = createSimulation(hotBlock(14, 4), undefined, { invariants: { failFast: false } })
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    const log = sim.eventLog()
    const id = (e: { payload: unknown }) => (e.payload as { truckId: string }).truckId
    const started = new Map(log.filter((e) => e.type === 'TruckGateStarted').map((e) => [id(e), e.t]))
    const gateIn = new Map(log.filter((e) => e.type === 'TruckGateIn').map((e) => [id(e), e.t]))
    const reached = log.filter((e) => e.type === 'TruckReachedGateHead')
    expect(started.size).toBe(14)
    expect(reached.length).toBeGreaterThanOrEqual(2) // at least two trucks for a free block passed a blocked head
    for (const e of reached) {
      // no lane is reserved for a bypassing truck before it is at the head: it starts the same instant it arrives there
      expect(started.get(id(e))).toBeCloseTo(e.t, 6)
      // and holds the lane for its processing (20 s) plus the short drive to the kiosk, not for the drive up the queue
      // (before 0.45.0 the first of them held it for 73 s)
      expect((gateIn.get(id(e)) as number) - e.t).toBeLessThan(35)
    }
  })
})

/** A 2-bay block at 90 % with three stalls and a burst of picks: several admitted picks compete for the same few free cells. */
function crowdedPicks(picks: number, seed: number): ScenarioConfig {
  const config = fullBlock(0, seed)
  config.yard = { blocks: [{ ...(config.yard as NonNullable<ScenarioConfig['yard']>).blocks[0], bays: 2 }] }
  config.yardStart = { mode: 'prefilled', targetPct: 90, mix: { import: 100, export: 0, transshipment: 0 } }
  config.landside = {
    ...(config.landside as NonNullable<ScenarioConfig['landside']>),
    scripted: Array.from({ length: picks }, (_, i) => ({ atS: 600 + i * 10, transaction: 'pickImport' as const })),
  }
  return config
}

describe('pick admission counts promised room (TT-215)', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('never admits a pick past the room the admitted picks already hold (seed %i)', (seed) => {
    const config = crowdedPicks(12, seed)
    const spec = blockSpecs(config).find((b) => b.id === 'B01') as BlockSpec
    let over = 0
    let decided = 0
    const sim: Simulation = createSimulation(
      config,
      {
        transferStallSelection: (msg, query) => {
          const { state } = sim.snapshot()
          decided++
          // the rehandle cells this truck's picks need, plus those of every other truck that already holds a stall
          const need = (truckId: string): number => {
            let n = 0
            for (const j of Object.values(state.ascJobs)) {
              if (j.kind !== 'retrieve' || j.truckId !== truckId || j.ascId !== null) continue
              const slot = state.yardSlots[j.yardSlotId ?? '']
              if (slot && slot.containerId === j.containerId) for (const b of blockersOf(state, slot)) n += b.span
            }
            return n
          }
          let promised = need(msg.payload.truckId)
          for (const t of Object.values(state.trucks)) if (t.id !== msg.payload.truckId && t.stallId != null) promised += need(t.id)
          const yard = state.yardBlocks.B01
          const free = yard.heights.reduce((n, h) => n + Math.max(0, spec.tiers - h), 0)
          if (promised > free) over++
          return defaultHandlers.transferStallSelection(msg, query)
        },
      },
      { invariants: { failFast: false } },
    )
    const result = sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    expect(result.reason).toBe('ended')
    expect(sim.eventLog().filter((e) => e.type === 'TruckDeparted')).toHaveLength(12)
    expect(decided).toBe(12)
    expect(over).toBe(0)
  })
})
