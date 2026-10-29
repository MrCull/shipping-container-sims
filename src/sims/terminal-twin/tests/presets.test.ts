/** TT-15: the three presets load, validate cleanly and run headless to their end condition with every invariant passing. */
import { describe, expect, it } from 'vitest'
import { createSimulation, validateScenario } from '../engine'
import { presets, TTI_BAYS } from '../scenario/presets'

describe('presets', () => {
  it('offers TTI Algeciras baseline, Small automated and Stress test', () => {
    expect(Object.keys(presets)).toEqual(['TTI Algeciras baseline', 'Small automated', 'Stress test'])
  })

  it('TTI baseline has the published layout counts', () => {
    const c = presets['TTI Algeciras baseline']()
    expect(c.quay.lengthM).toBe(850)
    expect(c.sts.map((s) => s.id)).toEqual(['STS101', 'STS102', 'STS103', 'STS104', 'STS105', 'STS106', 'STS107', 'STS108'])
    expect(c.yard!.blocks).toHaveLength(16)
    expect(c.yard!.ascsPerBlock).toBe(2)
    expect(c.yard!.blocks.every((b) => b.tiers === 5 && b.bays === TTI_BAYS)).toBe(true)
    expect(TTI_BAYS).toBe(45)
    expect(Math.abs(16 * 8 * 5 * TTI_BAYS - 28647)).toBeLessThan(0.01 * 28647)
    expect(c.shcs).toHaveLength(23)
    expect(c.landside!.gate).toMatchObject({ inLanes: 3, outLanes: 3, oogLane: true })
    const boxes = c.vessels.reduce((n, v) => n + v.discharge + v.load + v.transshipment, 0)
    const ts = c.vessels.reduce((n, v) => n + (v.dischargeTransshipment ?? 0) + v.transshipment, 0)
    expect(ts / boxes).toBeGreaterThan(0.8)
    expect(ts / boxes).toBeLessThan(0.9)
  })

  it('Small automated is 400 m, 3 STS, 6 blocks; Stress test has 5 near-simultaneous vessels and a heavy truck peak', () => {
    const small = presets['Small automated']()
    expect([small.quay.lengthM, small.sts.length, small.yard!.blocks.length]).toEqual([400, 3, 6])
    const stress = presets['Stress test']()
    const tti = presets['TTI Algeciras baseline']()
    expect(stress.yard).toEqual(tti.yard)
    expect(stress.vessels).toHaveLength(5)
    expect(Math.max(...stress.vessels.map((v) => v.arrivalS))).toBeLessThanOrEqual(3600)
    expect(Math.max(...stress.landside!.hourlyProfile)).toBeGreaterThan(2 * Math.max(...tti.landside!.hourlyProfile))
  })

  it('V11-03: every preset starts at 08:00 local (daylight), in the sim clock and the wall-clock start', () => {
    for (const build of Object.values(presets)) {
      const c = build()
      expect(c.startDateTime).toMatch(/T08:00:00Z$/)
      expect(c.kpi?.startTimeOfDayS).toBe(8 * 3600)
    }
  })

  it('each preset picks a yard start mode', () => {
    for (const build of Object.values(presets)) expect(build().yardStart?.mode).toBeDefined()
  })

  it.each(Object.keys(presets))('%s validates cleanly', (name) => {
    expect(validateScenario(presets[name]())).toEqual({ errors: [], warnings: [] })
  })

  /**
   * Full-length TTI and Stress runs take minutes (tens of thousands of events on a 28,800-cell yard), so those two
   * run to a shortened end condition (10 productive moves); Small automated runs to its own (all vessels departed).
   * Invariants are checked incrementally, with a full sweep every 500th event and at the end.
   */
  it.each([
    ['Small automated', undefined],
    ['TTI Algeciras baseline', { moves: 10 }],
    ['Stress test', { moves: 10 }],
  ] as const)('%s runs headless to its end condition with all invariants passing', (name, end) => {
    const config = presets[name]()
    if (end) config.endConditions = { ...end }
    const sim = createSimulation(config, {}, { invariants: { sweepEvery: 500 } })
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.invariantReport().checks).toBeGreaterThan(0)
  }, 600_000)

  it('regression: a pre-filled Small automated at 50% fill completes (no idle ASCs beside open jobs, no rehandle shuttling)', () => {
    const config = presets['Small automated']()
    config.yardStart = { mode: 'prefilled', targetPct: 50 }
    const sim = createSimulation(config, {}, { invariants: { sweepEvery: 500 } })
    const r = sim.runUntil({ maxEvents: 60_000 })
    expect(r.reason).toBe('ended')
    expect(sim.kpiReport().vesselsCompleted).toBe(3)
    const yard = sim.kpiReport().yard!
    expect(yard.rehandles.perProductiveMove).toBeLessThan(3) // 7.5 while a blocker shuttled between two stacks
  }, 120_000)

  it('Small automated is pre-filled to 60%', () => {
    expect(presets['Small automated']().yardStart).toEqual({ mode: 'prefilled', targetPct: 60 })
  })
})
