/**
 * V11-13: the pre-filled yard start asks yardAllocation through the decision runtime in a pre-run phase, so
 * async handlers and latency injection apply. Pre-run events carry `preRun: true`; t = 0 KPIs are unchanged.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, getStrategy, restoreSimulation, strategies, yardCapacityCells, type DecisionHandler, type EngineEvent } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'

const HOUR = 3600

function scenario(extra?: (c: ScenarioConfig) => void): ScenarioConfig {
  const config = new ScenarioBuilder('prefill-decisions', 'pre-run decisions')
    .seed(7)
    .moveVariation(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'First', sizeClass: 'feeder', discharge: 6, load: 8, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
    .shcs(3)
    .ascsPerBlock(2)
    .block('B01', { x: 20, bays: 8, tiers: 3 })
    .block('B02', { x: 60, bays: 8, tiers: 3 })
    .emptyPool({ count: 6, sizeMix: { '20': 1, '40': 1 }, maxAgeS: 86400 })
    .landside({
      hourlyProfile: Array.from({ length: 24 }, () => 0),
      importDwell: { kind: 'fixed', s: HOUR },
      exportWindow: { minBeforeEtaS: 0, maxBeforeEtaS: 30 * 86400 },
      scripted: [],
    })
    .yardStart({ mode: 'prefilled', targetPct: 50 })
    .endWhen({ simDurationS: 2 * HOUR })
    .build()
  extra?.(config)
  return config
}

const preRun = (log: readonly EngineEvent[], type: 'DecisionRequested' | 'DecisionResolved') =>
  log.filter((e) => e.type === type && (e.payload as { preRun?: boolean }).preRun === true)

/**
 * The default strategy behind a Promise for the pre-run requests (they have no pad: `wtpPadId` is ''), and answered
 * at once for the in-run ones. (An async reply to an in-run request can land on a slot a rehandle has filled since:
 * that race is not what these tests are about.)
 */
const defaultStrategy = getStrategy('yardAllocation', strategies.yardAllocation.default)
const asyncDefault: DecisionHandler<'yardAllocation'> = (msg, q) => {
  if (msg.payload.wtpPadId !== '') return defaultStrategy(msg, q)
  return Promise.resolve().then(() => defaultStrategy(msg, q))
}

const cellsOf = (sim: ReturnType<typeof createSimulation>) => Object.values(sim.snapshot().state.yardSlots).reduce((n, s) => n + s.span, 0)

describe('pre-filled start through the decision runtime', () => {
  it('runs an asynchronous yardAllocation handler (it used to be rejected)', async () => {
    const config = scenario()
    let calls = 0
    const sim = createSimulation(config, {
      yardAllocation: (msg, q) => {
        if (msg.payload.wtpPadId === '') calls++
        return asyncDefault(msg, q)
      },
    })
    // creation does not block: the pre-run waits for the handler
    expect(sim.runUntil({ maxEvents: 5 }).reason).toBe('waiting-for-decision')
    expect((await sim.runUntilAsync({ eventType: 'ScenarioStarted' })).reason).toBe('condition')
    // an async handler that answers like the built-in one places the same boxes as the built-in strategy
    const plain = createSimulation(config)
    expect(sim.snapshot().state.yardSlots).toEqual(plain.snapshot().state.yardSlots)
    expect(cellsOf(sim)).toBeGreaterThanOrEqual(Math.round(yardCapacityCells(config) * 0.5) - 1)
    const result = await sim.runUntilAsync()
    expect(result.reason).toBe('ended')
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    expect(calls).toBeGreaterThan(30)
    expect(preRun(sim.eventLog(), 'DecisionRequested').length).toBe(calls)
  })

  it('marks every pre-run decision, pairs them up, and finishes them before the run starts', () => {
    const sim = createSimulation(scenario())
    const requested = preRun(sim.eventLog(), 'DecisionRequested')
    const resolved = preRun(sim.eventLog(), 'DecisionResolved')
    expect(requested.length).toBeGreaterThan(30)
    expect(resolved.length).toBe(requested.length)
    expect(requested.every((e) => (e.payload as { decisionPoint?: string }).decisionPoint === 'yardAllocation')).toBe(true)
    sim.runUntil({ time: HOUR })
    const log = sim.eventLog()
    const started = log.findIndex((e) => e.type === 'ScenarioStarted')
    expect(started).toBe(requested.length + resolved.length)
    expect(log.slice(0, started).every((e) => (e.payload as { preRun?: boolean }).preRun === true)).toBe(true)
    expect(log.slice(started).some((e) => (e.payload as { preRun?: boolean }).preRun)).toBe(false)
    expect(log[started - 1].t).toBe(0)
  })

  it('keeps t = 0 KPIs unchanged: pre-run decisions stay out of the KPI series and the yard starts at the target', () => {
    const config = scenario()
    const sim = createSimulation(config)
    expect(sim.kpiSeries().series['handler.calls'].entities).toEqual({})
    expect(Math.abs(cellsOf(sim) - Math.round(yardCapacityCells(config) * 0.5))).toBeLessThanOrEqual(1)
    const fill = sim.kpiSeries().series['yard.fill-pct'].entities
    for (const block of ['B01', 'B02']) {
      const cells = Object.values(sim.snapshot().state.yardSlots).filter((s) => s.blockId === block).reduce((n, s) => n + s.span, 0)
      // the KPI series stores percentages rounded to 3 decimals
      expect(fill[block].hourly[0]).toBeCloseTo(Math.round(((100 * cells) / (8 * 8 * 3)) * 1000) / 1000, 5)
    }
  })

  it('applies latency injection to the pre-run without moving the sim clock', () => {
    const config = scenario((c) => {
      c.decisions = { points: { yardAllocation: { latency: { delay: { kind: 'fixed', ms: 5 } } } } }
    })
    const sim = createSimulation(config)
    const resolved = preRun(sim.eventLog(), 'DecisionResolved')
    expect(resolved.length).toBeGreaterThan(30)
    expect(resolved.every((e) => e.t === 0)).toBe(true)
    expect(sim.kpiReport().handlers.yardAllocation.wallLatencyMs.mean).toBeGreaterThanOrEqual(5)
  })

  it('a snapshot taken mid pre-run restores and finishes with the same log hash', async () => {
    const config = scenario()
    const a = createSimulation(config, { yardAllocation: asyncDefault })
    expect(a.runUntil({ maxEvents: 40 }).reason).toBe('waiting-for-decision')
    const snap = a.snapshot()
    await a.runUntilAsync()
    const b = restoreSimulation(snap, { yardAllocation: asyncDefault })
    await b.runUntilAsync()
    expect(b.firstError).toBeNull()
    expect(b.eventLogHash()).toBe(a.eventLogHash())
  })
})
