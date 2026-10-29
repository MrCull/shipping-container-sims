/**
 * TT-14: yard start modes (pre-filled, warm-up, empty), through the headless engine API (seam 1) and the
 * yardAllocation handler (seam 2: the pre-fill is placed through the selected strategy).
 */
import { describe, expect, it } from 'vitest'
import { candidateSlots, createSimulation, yardCapacityCells, type DecisionHandler, type EngineEvent, type Simulation } from '../engine'
import { SceneModel } from '../modules/sceneModel'
import { DEFAULT_ASC_KINEMATICS, ScenarioBuilder, withYard } from '../scenario/builder'
import type { ScenarioConfig, YardStartConfig } from '../scenario/types'

const HOUR = 3600

interface Opts {
  seed?: number
  start?: YardStartConfig
  strategy?: string
  durationS?: number
  /** Export boxes booked to V001 / V002. */
  load?: number
  discharge?: number
  scripted?: { atS: number; transaction: 'dropExport' | 'pickImport' | 'dropEmpty' | 'pickEmpty' | 'dual' }[]
  dwellS?: number
  profile?: number
  endWhen?: ScenarioConfig['endConditions']
}

function scenario(o: Opts = {}): ScenarioConfig {
  const b = new ScenarioBuilder('yard-start', 'yard start test')
    .seed(o.seed ?? 7)
    .moveVariation(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'First', sizeClass: 'feeder', discharge: o.discharge ?? 6, load: o.load ?? 8, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
    .vesselCall('V002', { name: 'Second', sizeClass: 'feeder', arrivalS: 6 * HOUR, discharge: 0, load: o.load ?? 8, maxSts: 1 })
    .shcs(3)
    .ascsPerBlock(2)
    .block('B01', { x: 20, bays: 12, tiers: 4 })
    .block('B02', { x: 60, bays: 12, tiers: 4 })
    .emptyPool({ count: 10, sizeMix: { '20': 1, '40': 1 }, maxAgeS: 86400 })
    .landside({
      hourlyProfile: Array.from({ length: 24 }, () => o.profile ?? 0),
      importDwell: { kind: 'fixed', s: o.dwellS ?? HOUR },
      exportWindow: { minBeforeEtaS: 0, maxBeforeEtaS: 30 * 86400 },
      scripted: o.scripted ?? [],
    })
    .endWhen(o.endWhen ?? { simDurationS: o.durationS ?? 4 * HOUR })
  if (o.start) b.yardStart(o.start)
  const config = b.build()
  if (o.strategy) config.decisions = { points: { yardAllocation: { strategy: o.strategy } } }
  return config
}

const cellsInYard = (sim: Simulation): number => sim.query.containers().filter((c) => c.custody.kind === 'yardSlot').reduce((n, c) => n + (c.size === '20' ? 1 : 2), 0)
const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) => sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

describe('pre-filled start', () => {
  const config = scenario({ start: { mode: 'prefilled', targetPct: 60 } })

  it('reaches the target % of the yard within a cell and every box satisfies the stack invariants', () => {
    const sim = createSimulation(config)
    const capacity = yardCapacityCells(config)
    expect(capacity).toBe(2 * 12 * 8 * 4)
    const target = Math.round(capacity * 0.6)
    expect(Math.abs(cellsInYard(sim) - target)).toBeLessThanOrEqual(1)
    sim.runUntil({ maxEvents: 400 })
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.invariantReport().checks).toBeGreaterThan(0)
  })

  it('books every export box to a scenario vessel, leaves imports unbooked and awaiting pickup with part of their dwell elapsed', () => {
    const sim = createSimulation(config)
    const vessels = new Set(config.vessels.map((v) => v.id))
    const booked = new Set(sim.query.vesselSlots().flatMap((s) => (s.plannedContainerId ? [s.plannedContainerId] : [])))
    const inYard = sim.query.containers().filter((c) => c.custody.kind === 'yardSlot')
    const exports = inYard.filter((c) => c.vesselId !== 'POOL')
    expect(exports.length).toBe(16)
    for (const c of exports) {
      expect(vessels.has(c.vesselId), c.id).toBe(true)
      expect(booked.has(c.id), c.id).toBe(true)
    }
    const empties = inYard.filter((c) => c.vesselId === 'POOL' && !c.full)
    expect(empties.length).toBe(10)
    const imports = inYard.filter((c) => c.vesselId === 'POOL' && c.full)
    expect(imports.length).toBeGreaterThan(20)
    for (const c of imports) {
      expect(booked.has(c.id)).toBe(false)
      expect(c.yardSince as number).toBeLessThanOrEqual(0)
      // fixed dwell 1 h: ready at (dwell - age), so some of the dwell has elapsed and the rest is still to come
      expect(c.pickupReadyAt).toBe(HOUR + (c.yardSince as number))
      expect(c.pickupReadyAt as number).toBeGreaterThanOrEqual(0)
    }
  })

  it('a truck can collect a pre-filled import once its dwell has elapsed (and not before)', () => {
    const early = createSimulation(scenario({ start: { mode: 'prefilled' }, scripted: [{ atS: 0, transaction: 'pickImport' }], durationS: HOUR / 2 }))
    early.runUntil({ time: 1 })
    expect(early.kpiReport().landside?.transactions.pickImport).toBe(0) // nothing is ready at t = 0 or the draw fell back
    const late = createSimulation(scenario({ start: { mode: 'prefilled' }, scripted: [{ atS: 2 * HOUR, transaction: 'pickImport' }], durationS: 3.5 * HOUR }))
    late.runUntil()
    expect(late.kpiReport().landside?.transactions.pickImport).toBe(1)
    expect(late.kpiReport().landside?.fallbacks).toBe(0)
  })

  it('is reproducible: the same seed gives an identical yard, another seed a different one', () => {
    const yardOf = (c: ScenarioConfig, seed?: number) => {
      const sim = createSimulation(c, {}, seed === undefined ? {} : { seed })
      return JSON.stringify(sim.snapshot().state.yardSlots) + JSON.stringify(sim.query.containers().map((c) => [c.id, c.pickupReadyAt, c.yardSince]))
    }
    expect(yardOf(config)).toBe(yardOf(config))
    expect(yardOf(config)).not.toBe(yardOf(config, 99))
  })

  it('places every box through the selected strategy', () => {
    const yardWith = (strategy: string) => JSON.stringify(createSimulation(scenario({ start: { mode: 'prefilled' }, strategy })).snapshot().state.yardSlots)
    expect(yardWith('nearest-wtp')).not.toBe(yardWith('random'))
    const calls: string[] = []
    const custom: DecisionHandler<'yardAllocation'> = (msg) => {
      calls.push(msg.payload.containerId)
      // the last legal row, lowest bay (nothing like nearest-wtp's choice)
      const list = candidateSlots(msg.payload).sort((a, b) => b.row - a.row || a.bay - b.bay || a.tier - b.tier)
      return { slotId: list[0]?.slotId ?? null }
    }
    const sim = createSimulation(scenario({ start: { mode: 'prefilled' } }), { yardAllocation: custom })
    expect(calls.length).toBe(sim.query.containers().filter((c) => c.custody.kind === 'yardSlot').length)
    // the custom handler filled the last rows first
    expect(Object.values(sim.snapshot().state.yardSlots).filter((s) => s.row === 8).length).toBeGreaterThan(10)
  })

  it('works with a target below what the booked boxes need: they are still all placed', () => {
    const sim = createSimulation(scenario({ start: { mode: 'prefilled', targetPct: 1 } }))
    expect(sim.query.containers().filter((c) => c.custody.kind === 'yardSlot').length).toBe(26)
  })
})

describe('warm-up start', () => {
  const warm = (extra: Partial<Opts> = {}) =>
    scenario({ start: { mode: 'warmup', warmUpS: 3 * HOUR }, profile: 4, load: 4, discharge: 8, durationS: HOUR, ...extra })

  it('starts empty and runs the warm-up with truck and vessel activity', () => {
    const sim = createSimulation(warm())
    expect(cellsInYard(sim)).toBe(0)
    sim.runUntil({ time: 3 * HOUR - 1 })
    expect(sim.kpiReport().movesCompleted).toBeGreaterThan(0)
    expect(sim.kpiReport().landside?.trucksIn).toBeGreaterThan(0)
  })

  it('restarts KPIs and end-condition counters at zero when the measured period begins', () => {
    const sim = createSimulation(warm())
    sim.runUntil({ eventType: 'WarmUpEnded' })
    expect(sim.now).toBe(3 * HOUR)
    const r = sim.kpiReport()
    expect(r.movesCompleted).toBe(0)
    expect(r.vesselsCompleted).toBe(0)
    expect(r.sts.STS01.moves).toBe(0)
    expect(r.landside?.trucksIn).toBe(0)
    expect(r.landside?.transactions).toEqual({ dropExport: 0, pickImport: 0, dropEmpty: 0, pickEmpty: 0, dual: 0 })
    expect(r.yard?.rehandles.total).toBe(0)
    expect(r.simTimeS).toBe(0)
    expect(r.warmUp).toEqual({ durationS: 3 * HOUR, ended: true })
    expect(sim.kpiSeries().elapsedS).toBe(0)
    // the boxes stay where they are
    expect(cellsInYard(sim)).toBeGreaterThan(0)
  })

  it('counts the measured period only: the run ends a measured duration after the warm-up, and series start there', () => {
    const sim = createSimulation(warm())
    sim.runUntil()
    expect(sim.now).toBe(4 * HOUR)
    const end = ofType(sim, 'ScenarioEnded')[0]
    expect(end.payload.reason).toBe('simDurationS >= 3600')
    const series = sim.kpiSeries()
    expect(series.elapsedS).toBe(HOUR)
    const total = Object.values(series.series['sts.moves'].entities).reduce((n, e) => n + (e.total ?? 0), 0)
    expect(total).toBe(sim.kpiReport().movesCompleted)
  })

  it('an end condition on moves counts moves after the warm-up only', () => {
    const sim = createSimulation(warm({ endWhen: { moves: 3 } }))
    sim.runUntil()
    expect(ofType(sim, 'WarmUpEnded').length).toBe(1)
    const ended = ofType(sim, 'ScenarioEnded')[0]
    expect(ended.t).toBeGreaterThan(3 * HOUR)
    expect(sim.kpiReport().movesCompleted).toBe(3)
  })

  it('survives a snapshot taken after the warm-up (series restart is rebuilt from the log)', () => {
    const sim = createSimulation(warm())
    sim.runUntil({ time: 3.5 * HOUR })
    const before = JSON.stringify(sim.kpiSeries())
    sim.restore(sim.snapshot())
    expect(JSON.stringify(sim.kpiSeries())).toBe(before)
  })
})

describe('empty start', () => {
  const trucks = (n: number) => Array.from({ length: n }, (_, i) => ({ atS: 60 + i * 120, transaction: 'dropExport' as const }))
  const empty = (extra: Partial<Opts> = {}) =>
    scenario({ start: { mode: 'empty' }, discharge: 4, load: 5, scripted: trucks(10), endWhen: { vesselsCompleted: 2 }, ...extra })

  it('starts with an empty yard, a booked box outside and no empty pool', () => {
    const sim = createSimulation(empty())
    expect(cellsInYard(sim)).toBe(0)
    expect(sim.query.containers().filter((c) => c.vesselId === 'POOL')).toEqual([])
    expect(sim.query.containers().filter((c) => c.custody.kind === 'external').length).toBe(10)
  })

  it('a vessel with load moves completes once trucks have delivered its exports', () => {
    const sim = createSimulation(empty())
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.query.vessel('V001').status).toBe('departed')
    expect(sim.query.vessel('V002').status).toBe('departed')
    const report = sim.kpiReport()
    expect(report.landside?.boxesDropped).toBe(10)
    expect(report.landside?.fallbacks).toBe(0)
    expect(report.workPackages?.boxesLoaded).toBe(10)
    // the booked boxes sailed: no box was created for the delivery
    expect(sim.query.containers().filter((c) => c.vesselId === 'V001' && c.full).length).toBe(4 + 5)
  })

  it("delivers a vessel's exports inside its export window (a late vessel's trucks wait for it) and never between the window's close and its arrival", () => {
    const config = empty({ scripted: Array.from({ length: 50 }, (_, i) => ({ atS: 60 + i * 600, transaction: 'dropExport' as const })), endWhen: { simDurationS: 9 * HOUR } })
    ;(config.landside as NonNullable<typeof config.landside>).exportWindow = { minBeforeEtaS: HOUR, maxBeforeEtaS: 3 * HOUR }
    const sim = createSimulation(config)
    sim.runUntil()
    const drops = ofType(sim, 'TruckArrived').flatMap((e) => e.payload.legs.filter((l) => l.purpose === 'export').map((l) => ({ t: e.t, vesselId: l.vesselId })))
    const v2 = drops.filter((d) => d.vesselId === 'V002')
    expect(v2.length).toBeGreaterThan(0)
    for (const d of v2) {
      const until = 6 * HOUR - d.t
      expect(until <= 3 * HOUR && (until >= HOUR || until <= 0), `t=${d.t}`).toBe(true)
    }
    expect(v2.some((d) => d.t < 3 * HOUR)).toBe(false) // window not open yet
  })

  it('the vessel waits (no completion) while no truck delivers', () => {
    const sim = createSimulation(empty({ scripted: [], endWhen: { simDurationS: 6 * HOUR } }))
    sim.runUntil()
    expect(sim.query.vessel('V001').status).not.toBe('departed')
    expect(sim.kpiReport().vesselsCompleted).toBe(0)
  })

  it('needs the landside', () => {
    const config = scenario({ start: { mode: 'empty' } })
    delete config.landside
    expect(() => createSimulation(config)).toThrow(/landside/)
  })
})

describe('browser scene model', () => {
  it('starts with the same boxes in the same slots as the engine (pre-filled), and none for an empty start', () => {
    const config = scenario({ start: { mode: 'prefilled', targetPct: 40 } })
    const sim = createSimulation(config)
    const model = new SceneModel(config, config.seed)
    const engine = Object.fromEntries(sim.query.containers().map((c) => [c.id, `${c.custody.kind}:${c.custody.id}`]))
    expect(new Set(model.containerIds)).toEqual(new Set(Object.keys(engine)))
    for (const id of model.containerIds) {
      const o = model.custodyAt(id, 0)!
      expect(`${o.kind}:${o.id}`, id).toBe(engine[id])
    }
    const empty = scenario({ start: { mode: 'empty' } })
    const em = new SceneModel(empty, empty.seed)
    expect(em.containerIds.some((id) => em.custodyAt(id, 0)?.kind === 'yardSlot')).toBe(false)
    expect(em.containerIds.length).toBe(createSimulation(empty).query.containers().length)
  })

  it('the setup dialog helper applies the yard start to the config', () => {
    const config = withYard(scenario(), { blocks: [{ bays: 6, tiers: 3, wtpPads: 5, transferStalls: 5 }], asc: DEFAULT_ASC_KINEMATICS, start: { mode: 'warmup', warmUpS: 7200 } })
    expect(config.yardStart).toEqual({ mode: 'warmup', warmUpS: 7200 })
  })
})
