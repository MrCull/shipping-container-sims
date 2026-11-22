/**
 * #311: a measurement warm-up (`ScenarioConfig.measurementWarmUpS`) for any yard start mode, through the headless
 * engine API, the scenario validator and the CLI. `yardStart.mode: 'warmup'` is an empty start plus a measurement
 * warm-up of `warmUpS`; its event logs are pinned to the hashes they had before the refactor.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type EngineEvent, type Simulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig, YardStartConfig } from '../scenario/types'
import { validateScenario } from '../scenario/validate'

const HOUR = 3600

function scenario(start: YardStartConfig, endWhen: ScenarioConfig['endConditions'] = { simDurationS: HOUR }): ScenarioConfig {
  return new ScenarioBuilder('yard-start', 'yard start test')
    .hatch({ enabled: false })
    .seed(7)
    .moveVariation(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'First', sizeClass: 'feeder', discharge: 8, load: 4, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
    .vesselCall('V002', { name: 'Second', sizeClass: 'feeder', arrivalS: 6 * HOUR, discharge: 0, load: 4, maxSts: 1 })
    .shcs(3)
    .ascsPerBlock(2)
    .block('B01', { x: 20, bays: 12, tiers: 4 })
    .block('B02', { x: 60, bays: 12, tiers: 4 })
    .emptyPool({ count: 10, sizeMix: { '20': 1, '40': 1 }, maxAgeS: 86400 })
    .landside({
      hourlyProfile: Array.from({ length: 24 }, () => 4),
      importDwell: { kind: 'fixed', s: HOUR },
      exportWindow: { minBeforeEtaS: 0, maxBeforeEtaS: 30 * 86400 },
      scripted: [],
    })
    .endWhen(endWhen)
    .yardStart(start)
    .build()
}

const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) => sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

describe('measurement warm-up on a pre-filled start', () => {
  const config = (): ScenarioConfig => ({ ...scenario({ mode: 'prefilled', targetPct: 30 }), measurementWarmUpS: 2 * HOUR })

  it('restarts KPIs at the warm-up end and kpiReport().warmUp reports it', () => {
    const sim = createSimulation(config())
    sim.runUntil({ time: 2 * HOUR - 1 })
    expect(sim.kpiReport().movesCompleted).toBeGreaterThan(0)
    expect(sim.kpiReport().warmUp).toEqual({ durationS: 2 * HOUR, ended: false })
    sim.runUntil({ eventType: 'WarmUpEnded' })
    expect(sim.now).toBe(2 * HOUR)
    const r = sim.kpiReport()
    expect(r.movesCompleted).toBe(0)
    expect(r.simTimeS).toBe(0)
    expect(r.warmUp).toEqual({ durationS: 2 * HOUR, ended: true })
    expect(sim.kpiSeries().elapsedS).toBe(0)
  })

  it('end conditions count the measured period only', () => {
    const sim = createSimulation(config())
    sim.runUntil()
    expect(sim.now).toBe(3 * HOUR)
    expect(ofType(sim, 'ScenarioEnded')[0].payload.reason).toBe('simDurationS >= 3600')
    expect(sim.kpiSeries().elapsedS).toBe(HOUR)
    const moves = createSimulation({ ...scenario({ mode: 'prefilled', targetPct: 30 }, { moves: 3 }), measurementWarmUpS: 2 * HOUR })
    moves.runUntil()
    expect(ofType(moves, 'ScenarioEnded')[0].t).toBeGreaterThan(2 * HOUR)
    expect(moves.kpiReport().movesCompleted).toBe(3)
  })
})

describe('yard warm-up start is an empty start plus a measurement warm-up', () => {
  // event-log hashes of these runs before #311, re-pinned for the RNG stream split (#310, ENGINE_VERSION 0.59.0)
  const PINNED: [ScenarioConfig['endConditions'], string][] = [
    [{ simDurationS: HOUR }, '0160725c356ab0'],
    [{ moves: 3 }, '0151e9751053ad'],
  ]
  for (const [endWhen, hash] of PINNED) {
    it(`keeps its event log byte-identical (${JSON.stringify(endWhen)})`, () => {
      const warm = createSimulation(scenario({ mode: 'warmup', warmUpS: 3 * HOUR }, endWhen))
      warm.runUntil()
      expect(warm.eventLogHash()).toBe(hash)
      const empty = createSimulation({ ...scenario({ mode: 'empty' }, endWhen), measurementWarmUpS: 3 * HOUR })
      empty.runUntil()
      expect(empty.eventLogHash()).toBe(hash)
    })
  }
})

describe('both a yard warm-up and a measurement warm-up', () => {
  const both = (): ScenarioConfig => ({ ...scenario({ mode: 'warmup', warmUpS: 3 * HOUR }), measurementWarmUpS: HOUR })

  it('warns in validation', () => {
    const check = validateScenario(both())
    expect(check.errors).toEqual([])
    expect(check.warnings.map((w) => w.key)).toContain('setup.check.warmUpOverridden')
    expect(validateScenario(scenario({ mode: 'warmup', warmUpS: 3 * HOUR })).warnings.map((w) => w.key)).not.toContain('setup.check.warmUpOverridden')
  })

  it('uses the measurement warm-up', () => {
    const sim = createSimulation(both())
    sim.runUntil({ eventType: 'WarmUpEnded' })
    expect(sim.now).toBe(HOUR)
    expect(sim.kpiReport().warmUp).toEqual({ durationS: HOUR, ended: true })
  })
})

describe('scenario validation of the measurement warm-up', () => {
  it('rejects a negative or non-finite value', () => {
    for (const bad of [-1, Number.NaN]) {
      const check = validateScenario({ ...scenario({ mode: 'prefilled' }), measurementWarmUpS: bad })
      expect(check.errors.map((e) => e.key)).toContain('setup.check.measurementWarmUp')
    }
  })
})

describe('time-based KPIs after a measurement warm-up (review of #309)', () => {
  // ground truth is read from the raw event log on the absolute clock, cut to the measured window [W, W + H)
  const W = 2 * HOUR
  let sim: Simulation | undefined
  const run = (): Simulation => {
    if (!sim) {
      sim = createSimulation({ ...scenario({ mode: 'prefilled', targetPct: 30 }), measurementWarmUpS: W })
      sim.runUntil()
    }
    return sim
  }
  const cut = (t0: number, t1: number) => Math.max(0, Math.min(t1, W + HOUR) - Math.max(t0, W))
  const total = (id: string, entity: string) => run().kpiSeries().series[id].entities[entity].total

  it('ASC utilisation is the busy time inside the measured window, in [0, 100] %', () => {
    const s = run()
    const busy: Record<string, number> = {}
    const open: Record<string, number> = {}
    for (const e of s.eventLog()) {
      if (e.type === 'AscJobAssigned') open[e.payload.ascId] = e.payload.departAt
      if (e.type === 'AscReady' && open[e.payload.ascId] !== undefined) {
        busy[e.payload.ascId] = (busy[e.payload.ascId] ?? 0) + cut(open[e.payload.ascId], e.t)
        delete open[e.payload.ascId]
      }
    }
    for (const [id, since] of Object.entries(open)) busy[id] = (busy[id] ?? 0) + cut(since, s.now)
    const ids = Object.keys(s.kpiSeries().series['asc.utilisation-pct'].entities)
    expect(ids.length).toBeGreaterThan(0)
    expect(Object.values(busy).some((b) => b > 0)).toBe(true)
    for (const id of ids) {
      const pct = total('asc.utilisation-pct', id) ?? 0
      expect(pct).toBeGreaterThanOrEqual(0)
      expect(pct).toBeLessThanOrEqual(100)
      expect(pct).toBeCloseTo((100 * (busy[id] ?? 0)) / HOUR, 1)
    }
  })

  it('each SHC state time sums to the measured window', () => {
    const shcs = run().kpiReport().horizontal?.shcs ?? {}
    expect(Object.keys(shcs).length).toBe(3)
    for (const k of Object.values(shcs)) {
      const states = Object.values(k.stateS ?? {})
      for (const v of states) expect(v).toBeGreaterThanOrEqual(0)
      expect(states.reduce((a, b) => a + b, 0)).toBeCloseTo(HOUR, 0)
    }
  })

  it('landside stall wait counts trucks served in the window with their real wait', () => {
    const s = run()
    const atStall: Record<string, number> = {}
    const served = new Set<string>()
    let sum = 0
    let n = 0
    for (const e of s.eventLog()) {
      if (e.type === 'TruckAtStall') atStall[e.payload.truckId] = e.t
      if (e.type === 'TruckDeparted') served.delete(e.payload.truckId)
      if (e.type !== 'AscJobAssigned' || !e.payload.truckId || served.has(e.payload.truckId)) continue
      served.add(e.payload.truckId)
      if (e.t < W) continue
      sum += e.payload.early ? 0 : e.payload.departAt - (atStall[e.payload.truckId] ?? e.t)
      n++
    }
    expect(n).toBeGreaterThan(0)
    expect(total('landside.stall-wait-s', 'terminal')).toBeCloseTo(sum / n, 2)
  })

  it('road occupancy is never negative and its mean is over the measured window', () => {
    const r = run().kpiReport().landside
    expect(r).toBeDefined()
    expect(r!.road.meanTrucks).toBeGreaterThanOrEqual(0)
    expect(r!.road.meanTrucks).toBeLessThanOrEqual(r!.road.maxTrucks)
    expect(total('landside.road-trucks', 'terminal') ?? 0).toBeGreaterThanOrEqual(0)
    expect(r!.road.meanTrucks).toBeCloseTo(total('landside.road-trucks', 'terminal') ?? 0, 1)
  })
})
