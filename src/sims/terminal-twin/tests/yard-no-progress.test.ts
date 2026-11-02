/**
 * TT-183: no silent yard deadlock, and an exit-slot wait has the stall limit.
 *
 * A block that holds claimed work with every ASC idle, and no event left that can start it, used to end the run as a quiet
 * `idle` (the TTI peak day at 0.1 stopped with 1 of 5 vessels done). The invariant `yard.no-progress` reports it once the
 * block has gone `STALL_STRAND_LIMIT_S` without an ASC job start; the engine runs the clock to that point when the queue is
 * empty, so an idle end cannot hide it. The exit-slot wait (`landside.stranded-truck`) uses the same limit, counted from the
 * last leg or the last departure through the truck's own outbound lane.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'
import { STALL_STRAND_LIMIT_S, stuckYardBlocks } from '../engine/invariants'

const NO_PROGRESS = 'yard.no-progress'
const STRANDED = 'landside.stranded-truck'

const violationsOf = (sim: Simulation, id: string) => sim.invariantReport().violations.filter((v) => v.invariant === id)

describe('yard.no-progress', () => {
  it('reports a block whose claimed pick cannot move when every rehandle target is refused', () => {
    // the rehandle fixture buries export boxes; a rehandleTarget that refuses every blocker leaves the pick claimed with
    // its ASCs idle and nothing queued that can move it
    const sim = createSimulation(
      fixtures['rehandle-random-yard'],
      { rehandleTarget: () => ({ slotId: null }) },
      { invariants: { failFast: false } },
    )
    const result = sim.runUntil()
    expect(result.reason).toBe('idle')
    const found = violationsOf(sim, NO_PROGRESS)
    expect(found.length).toBeGreaterThan(0)
    expect(found[0].message).toMatch(/^B01 has \d+ claimed job\(s\) .*no ASC working for \d+ s \(limit 1800 s\)/)
  })

  it('never fires on the same fixture with the real handlers', () => {
    const sim = createSimulation(fixtures['rehandle-random-yard'], {}, { invariants: { failFast: false } })
    expect(sim.runUntil().reason).toBe('ended')
    expect(violationsOf(sim, NO_PROGRESS)).toEqual([])
  })
})

/** One outbound lane whose gate-out takes `outProcessingS`, and two trucks that each drop an empty box. */
function exitTerminal(outProcessingS: number, outLanes = 1, scriptedAtS = [3000, 3020], transferStalls = 2): ScenarioConfig {
  return new ScenarioBuilder('exit-slot', 'Exit slot')
    .hatch({ enabled: false })
    .seed(8)
    .moveVariation(10)
    .driverVariability(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'Import Star', sizeClass: 'feeder', discharge: 4, maxSts: 1, sizeMix: { '20': 1 } })
    .shcs(2)
    .block('B01', { x: 20, bays: 4, tiers: 3, transferStalls })
    .landside({
      hourlyProfile: Array.from({ length: 24 }, () => 0),
      importDwell: { kind: 'fixed', s: 300 },
      exportWindow: { minBeforeEtaS: 3600, maxBeforeEtaS: 36000 },
      gate: { inLanes: 2, outLanes, inProcessingS: 30, outProcessingS },
      scripted: scriptedAtS.map((atS) => ({ atS, transaction: 'dropEmpty' as const })),
    })
    .endWhen({ simDurationS: 12000 })
    .build()
}

describe('the exit-slot wait has the stall limit', () => {
  it('reports a truck whose transfers are done and whose outbound lane stays blocked past the limit', () => {
    // the second truck's exit reservation waits behind the first truck's 4000 s gate-out: no truck leaves for longer than the
    // limit while it stands at its stall, so no event falls inside its wait; the deadline check reports it at the limit
    const sim = createSimulation(exitTerminal(4000), {}, { invariants: { failFast: false } })
    sim.runUntil()
    const found = violationsOf(sim, STRANDED).filter((v) => /for an outbound slot/.test(v.message))
    expect(found.length).toBeGreaterThan(0)
    expect(found[0].message).toMatch(/has waited 1801 s at stall B01-TS\d for an outbound slot/)
  })

  it('reports one blocked exit slot while other trucks keep leaving (per slot, not per terminal)', () => {
    // two outbound lanes with a 2500 s gate-out: the trucks at 100 s and 1100 s take one lane each and leave at about 2700 s
    // and 3700 s. The truck at 1700 s waits at its stall from about 1800 s for the second lane (till 3700 s, over the limit)
    // although the first truck left in between, so a terminal-wide "no truck has left" check would hide it
    const sim = createSimulation(exitTerminal(2500, 2, [100, 1100, 1600, 1700], 4), {}, { invariants: { failFast: false } })
    sim.runUntil()
    const found = violationsOf(sim, STRANDED).filter((v) => /for an outbound slot/.test(v.message))
    expect(found.length).toBeGreaterThan(0)
  })

  it('does not report an exit queue that keeps moving', () => {
    const sim = createSimulation(exitTerminal(20), {}, { invariants: { failFast: false } })
    expect(sim.runUntil().reason).toBe('ended')
    expect(violationsOf(sim, STRANDED)).toEqual([])
  })
})

describe('yard.no-progress counts a queued pick truck from gate-in (TT-209)', () => {
  /** The deadlocked rehandle fixture, with its claimed pick trucks put back where `setTrucks` says. */
  function deadlocked(setTrucks: (trucks: { status: string; arrivedAt: number; gateInAt: number | null }[], now: number) => void) {
    const sim = createSimulation(
      fixtures['rehandle-random-yard'],
      { rehandleTarget: () => ({ slotId: null }) },
      { invariants: { failFast: false } },
    )
    sim.runUntil()
    const state = sim.snapshot().state
    const claimed = Object.values(state.ascJobs).filter((j) => j.ascId === null && j.allocation === 'claimed')
    expect(claimed.length).toBeGreaterThan(0)
    // the fixture's picks are pad retrievals: give each a pick truck of its own, as a truck job
    const trucks = claimed.map((j, i) => {
      const t = { id: `TTEST${i}`, transaction: 'pickUp', legs: [], status: 'queued', arrivedAt: 0, gateInAt: null } as never
      state.trucks[`TTEST${i}`] = t
      j.truckId = `TTEST${i}`
      return t
    })
    setTrucks(trucks as never, state.now)
    return stuckYardBlocks(state, sim.config, state.now, STALL_STRAND_LIMIT_S)
  }

  it('does not report a block whose pick truck is still in the gate queue, however long it has waited', () => {
    const found = deadlocked((trucks, now) => {
      for (const t of trucks) Object.assign(t, { status: 'queued', arrivedAt: now - 5000, gateInAt: null })
    })
    expect(found).toEqual([])
  })

  it('reports the block once the truck has passed the gate and the limit has run from there', () => {
    const found = deadlocked((trucks, now) => {
      for (const t of trucks) Object.assign(t, { status: 'waiting-for-stall', arrivedAt: now - 5000, gateInAt: now - 4000 })
    })
    expect(found.length).toBeGreaterThan(0)
  })

  it('does not report a truck that passed the gate less than the limit ago', () => {
    const found = deadlocked((trucks, now) => {
      for (const t of trucks) Object.assign(t, { status: 'waiting-for-stall', arrivedAt: now - 5000, gateInAt: now - 100 })
    })
    expect(found).toEqual([])
  })
})
