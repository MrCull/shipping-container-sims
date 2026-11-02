/**
 * TT-183: no silent yard deadlock, and an exit-slot wait has the stall limit.
 *
 * A block that holds claimed work with every ASC idle, and no event left that can start it, used to end the run as a quiet
 * `idle` (the TTI peak day at 0.1 stopped with 1 of 5 vessels done). The invariant `yard.no-progress` reports it once the
 * block has gone `STALL_STRAND_LIMIT_S` without an ASC job start; the engine runs the clock to that point when the queue is
 * empty, so an idle end cannot hide it. The exit-slot wait (`landside.stranded-truck`) uses the same limit, counted from the
 * last leg while no truck leaves the terminal.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'

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
function exitTerminal(outProcessingS: number): ScenarioConfig {
  return new ScenarioBuilder('exit-slot', 'Exit slot')
    .hatch({ enabled: false })
    .seed(8)
    .moveVariation(10)
    .driverVariability(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'Import Star', sizeClass: 'feeder', discharge: 4, maxSts: 1, sizeMix: { '20': 1 } })
    .shcs(2)
    .block('B01', { x: 20, bays: 4, tiers: 3, transferStalls: 2 })
    .landside({
      hourlyProfile: Array.from({ length: 24 }, () => 0),
      importDwell: { kind: 'fixed', s: 300 },
      exportWindow: { minBeforeEtaS: 3600, maxBeforeEtaS: 36000 },
      gate: { inLanes: 2, outLanes: 1, inProcessingS: 30, outProcessingS },
      scripted: [
        { atS: 3000, transaction: 'dropEmpty' },
        { atS: 3020, transaction: 'dropEmpty' },
      ],
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

  it('does not report an exit queue that keeps moving', () => {
    const sim = createSimulation(exitTerminal(20), {}, { invariants: { failFast: false } })
    expect(sim.runUntil().reason).toBe('ended')
    expect(violationsOf(sim, STRANDED)).toEqual([])
  })
})
