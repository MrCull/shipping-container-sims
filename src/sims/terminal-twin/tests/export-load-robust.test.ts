/**
 * TT-10: the load flow on several cranes and blocks, with snapshots and the instant subsystem modes.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, restoreSimulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

function build(seed: number, opts: { asc: 1 | 2; sts: number; discharge: number; load: number; shcs: number }): ScenarioConfig {
  const b = new ScenarioBuilder('robust', 'mixed call on several cranes')
    .seed(seed)
    .moveVariation(10)
    .driverVariability(10)
    .quay(500, { mooringS: 60, unmooringS: 60 })
    .vesselCall('V001', {
      name: 'Robust',
      sizeClass: 'feedermax',
      discharge: opts.discharge,
      load: opts.load,
      maxSts: opts.sts,
      sizeMix: { '20': 1, '40': 1 },
    })
    .shcs(opts.shcs)
    .block('B01', { x: 20, bays: 12, tiers: 4 })
    .block('B02', { x: 120, bays: 12, tiers: 4 })
    .ascsPerBlock(opts.asc)
    .endWhen({ vesselsCompleted: 1 })
  for (let i = 0; i < opts.sts; i++) b.sts(`STS0${i + 1}`, { gantryX: 60 + i * 80, groundPositions: 3 })
  return b.build()
}

describe('load flow robustness', () => {
  it('mixed calls on 2 cranes finish for several seeds, with one or two ASCs per block', () => {
    for (const seed of [1, 2, 3, 4])
      for (const asc of [1, 2] as const) {
        const sim = createSimulation(build(seed, { asc, sts: 2, discharge: 20, load: 24, shcs: 3 }))
        sim.runUntil({ maxEvents: 200_000 })
        expect(sim.firstError, `seed ${seed} asc ${asc}`).toBeNull()
        expect(sim.status, `seed ${seed} asc ${asc}`).toBe('ended')
        expect(sim.kpiReport().movesCompleted).toBe(44)
      }
  })

  it('a snapshot taken mid-load restores to the same event-log hash', () => {
    const config = build(2, { asc: 2, sts: 2, discharge: 10, load: 16, shcs: 3 })
    const a = createSimulation(config)
    a.runUntil({ eventType: 'StsLoadPicked' })
    const snap = a.snapshot()
    a.runUntil()
    const b = restoreSimulation(snap)
    b.runUntil()
    expect(b.status).toBe('ended')
    expect(b.eventLogHash()).toBe(a.eventLogHash())
  })

  it('works with instant SHCs and ASCs', () => {
    const sim = createSimulation(fixtures['mixed-discharge-then-load'], {}, { subsystems: { shc: 'instant', asc: 'instant' } })
    sim.runUntil({ maxEvents: 100_000 })
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
  })
})
