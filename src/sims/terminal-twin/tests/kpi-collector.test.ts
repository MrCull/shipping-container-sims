/**
 * KPI collector (seam: `Simulation.kpiSeries()` and the collector fed with events).
 * Cross-checks use independent counters the engine already keeps (kpiReport) and
 * hand-computed literals from synthetic events.
 */
import { describe, expect, it } from 'vitest'
import { createKpiCollector, createSimulation, restoreSimulation, type EngineEvent, type KpiSeriesReport, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { ScenarioBuilder } from '../scenario/builder'

const run = (name: string): Simulation => {
  const sim = createSimulation(fixtures[name])
  sim.runUntil()
  return sim
}
const total = (r: KpiSeriesReport, kpi: string, entity: string) => r.series[kpi].entities[entity].total
const sumHourly = (r: KpiSeriesReport, kpi: string, entity: string) =>
  r.series[kpi].entities[entity].hourly.reduce<number>((a, b) => a + (b ?? 0), 0)

describe('KPI collector on real runs', () => {
  it('quay: moves per STS match the engine counters, hour and shift series add up to the total', () => {
    const sim = run('crane-split-4sts')
    const series = sim.kpiSeries()
    const report = sim.kpiReport()
    for (const [id, k] of Object.entries(report.sts)) {
      expect(total(series, 'sts.moves', id)).toBe(k.moves)
      expect(sumHourly(series, 'sts.moves', id)).toBe(k.moves)
      expect(series.series['sts.moves'].entities[id].shifts.reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(k.moves)
      expect(total(series, 'sts.wait-rail-s', id)).toBeCloseTo(k.railWaitS, 2)
    }
    expect(series.hours.length).toBe(series.series['sts.moves'].entities['STS01'].hourly.length)
    expect(series.elapsedS).toBeCloseTo(report.simTimeS, 2)
  })

  it('quay: net moves/h is at least gross moves/h and both are positive for a working crane', () => {
    const series = run('tracer-1sts-10-boxes').kpiSeries()
    const gross = total(series, 'sts.gross-moves-per-hour', 'STS01')!
    const net = total(series, 'sts.net-moves-per-hour', 'STS01')!
    expect(gross).toBeGreaterThan(0)
    expect(net).toBeGreaterThanOrEqual(gross)
    expect(total(series, 'berth.moves-per-hour', 'terminal')).toBeGreaterThan(0)
    expect(total(series, 'vessel.remaining-moves', 'V001')).toBe(0)
  })

  it('horizontal: SHC distances equal the engine counters; time shares add up to 100%', () => {
    const sim = run('shc-1sts-2shc-1wtp')
    const series = sim.kpiSeries()
    const hz = sim.kpiReport().horizontal!
    for (const [id, k] of Object.entries(hz.shcs)) {
      expect(total(series, 'shc.empty-distance-m', id)).toBeCloseTo(k.emptyDistanceM, 0)
      expect(total(series, 'shc.loaded-distance-m', id)).toBeCloseTo(k.loadedDistanceM, 0)
      expect(total(series, 'shc.jobs', id)).toBe(k.jobs)
      const pct = total(series, 'shc.loaded-pct', id)! + total(series, 'shc.empty-pct', id)! + total(series, 'shc.idle-pct', id)!
      expect(pct).toBeCloseTo(100, 1)
      if (k.jobs > 0) expect(total(series, 'shc.cycle-time-s', id)).toBeGreaterThan(0)
    }
    expect(Object.keys(series.series['wtp.dwell-s'].entities)).toEqual(['B01'])
  })

  it('yard: stacked cells, fill %, ASC utilisation and cycle time', () => {
    const sim = run('asc-1sts-10-boxes-1block')
    const series = sim.kpiSeries()
    const yard = sim.kpiReport().yard!
    const b = yard.blocks['B01']
    expect(total(series, 'yard.fill-pct', 'B01')).toBeCloseTo((100 * b.cells) / b.capacityCells, 2)
    expect(total(series, 'asc.jobs', 'B01-ASC1')).toBe(yard.ascs['B01-ASC1'].jobs)
    const util = total(series, 'asc.utilisation-pct', 'B01-ASC1')!
    expect(util).toBeGreaterThan(0)
    expect(util).toBeLessThanOrEqual(100)
    expect(total(series, 'asc.cycle-time-s', 'B01-ASC1')).toBeGreaterThan(0)
  })

  it('yard: both ASCs of a paired block get their own utilisation and job counts', () => {
    const sim = run('asc-2asc-block-conflict')
    const series = sim.kpiSeries()
    const ascs = sim.kpiReport().yard!.ascs
    expect(Object.keys(series.series['asc.jobs'].entities)).toEqual(Object.keys(ascs))
    for (const [id, k] of Object.entries(ascs)) expect(total(series, 'asc.jobs', id), id).toBe(k.jobs)
  })

  it('handlers: calls per decision point match the TT-03 KPIs', () => {
    const sim = run('asc-1sts-10-boxes-1block')
    const series = sim.kpiSeries()
    for (const [dp, h] of Object.entries(sim.kpiReport().handlers)) {
      expect(total(series, 'handler.calls', dp), dp).toBe(h.calls)
      expect(total(series, 'handler.fallbacks', dp), dp).toBe(h.fallbacks)
    }
  })

  it('handlers: idle-caused equipment time is a time series that matches the TT-03 KPIs', () => {
    const config = { ...fixtures['tracer-1sts-10-boxes'], decisions: { points: { stsGroundPosition: { timeoutMs: 60_000, latency: { delay: { kind: 'fixed' as const, ms: 20_000 } } } } } }
    const sim = createSimulation(config)
    sim.runUntil()
    const h = sim.kpiReport().handlers.stsGroundPosition
    const series = sim.kpiSeries()
    expect(h.equipmentIdleS).toBeGreaterThan(0)
    expect(total(series, 'handler.equipment-idle-s', 'stsGroundPosition')).toBeCloseTo(h.equipmentIdleS, 2)
    expect(sumHourly(series, 'handler.equipment-idle-s', 'stsGroundPosition')).toBeCloseTo(h.equipmentIdleS, 2)
    expect(h.wallLatencyMs.mean).toBe(20_000)
  })

  it('handlers: wall latency is carried by DecisionResolved and is a time series (works after a restore, i.e. from the log)', () => {
    const config = { ...fixtures['tracer-1sts-10-boxes'], decisions: { points: { stsGroundPosition: { timeoutMs: 60_000, latency: { delay: { kind: 'fixed' as const, ms: 20_000 } } } } } }
    const sim = createSimulation(config)
    sim.runUntil()
    const resolved = sim.eventLog().filter((e) => e.type === 'DecisionResolved' && e.payload.decisionPoint === 'stsGroundPosition')
    expect(resolved.length).toBeGreaterThan(0)
    for (const e of resolved) expect(e.type === 'DecisionResolved' && e.payload.wallLatencyMs).toBe(20_000)
    const series = sim.kpiSeries()
    expect(series.series['handler.wall-latency-s'].unit).toBe('s')
    const hourly = series.series['handler.wall-latency-s'].entities.stsGroundPosition.hourly.filter((v) => v !== null)
    expect(hourly.length).toBeGreaterThan(0)
    for (const v of hourly) expect(v).toBeCloseTo(20, 3)
    expect(total(series, 'handler.wall-latency-s', 'stsGroundPosition')).toBeCloseTo(sim.kpiReport().handlers.stsGroundPosition.wallLatencyMs.mean / 1000, 3)
    const rebuilt = restoreSimulation(sim.snapshot())
    expect(rebuilt.kpiSeries().series['handler.wall-latency-s']).toEqual(series.series['handler.wall-latency-s'])
  })

  it('handlers: a run without injected latency carries no wall latency in its events and the series is 0', () => {
    const sim = run('tracer-1sts-10-boxes')
    for (const e of sim.eventLog()) if (e.type === 'DecisionResolved') expect(e.payload.wallLatencyMs).toBeUndefined()
    expect(total(sim.kpiSeries(), 'handler.wall-latency-s', 'stsGroundPosition')).toBe(0)
  })

  it('vessels: turnaround and anchorage wait are time series (counted in the hour the vessel departs / gets its berth)', () => {
    const sim = run('two-vessels-compete-for-berth')
    const series = sim.kpiSeries()
    for (const [id, v] of Object.entries(sim.kpiReport().vessels)) {
      expect(total(series, 'vessel.turnaround-s', id), id).toBeCloseTo(v.turnaroundS as number, 2)
      expect(total(series, 'vessel.anchorage-wait-s', id), id).toBeCloseTo(v.anchorageWaitS as number, 2)
    }
    expect(sumHourly(series, 'vessel.turnaround-s', 'V001')).toBeCloseTo(total(series, 'vessel.turnaround-s', 'V001') as number, 2)
  })

  it('is deterministic and identical after a snapshot restore (the collector is rebuilt from the log)', () => {
    const a = createSimulation(fixtures['asc-1sts-10-boxes-1block'])
    a.runUntil({ time: 600 })
    const b = restoreSimulation(a.snapshot())
    expect(b.kpiSeries()).toEqual(a.kpiSeries())
    a.runUntil()
    b.runUntil()
    expect(b.kpiSeries()).toEqual(a.kpiSeries())
    expect(run('asc-1sts-10-boxes-1block').kpiSeries()).toEqual(a.kpiSeries())
  })

  it('an unfinished open state is closed at "now" without changing the stored sums', () => {
    const sim = createSimulation(fixtures['tracer-1sts-10-boxes'])
    sim.runUntil({ time: 100 })
    const early = sim.kpiSeries()
    expect(sim.kpiSeries()).toEqual(early)
    sim.runUntil({ time: 200 })
    expect(total(sim.kpiSeries(), 'sts.wait-work-s', 'STS01')).toBeGreaterThanOrEqual(total(early, 'sts.wait-work-s', 'STS01')!)
  })
})

describe('KPI collector on synthetic events (hand-computed)', () => {
  // start 21:30 UTC: hour buckets are 21:30-22:00, 22:00-23:00, ... so midnight falls in bucket 3
  const config = new ScenarioBuilder('synthetic', 'synthetic').startAt('2026-01-05T21:30:00Z')
    .sts('STS01', { gantryX: 100, groundPositions: 3 })
    .vesselCall('V1', { sizeClass: 'feeder', discharge: 3 })
    .build()
  const collector = () => createKpiCollector(config, { vesselBoxes: { V1: 3 }, containerSize: () => '20' })
  let id = 0
  const ev = (type: string, t: number, payload: object): EngineEvent =>
    ({ id: id++, seq: id, t, type, causedBy: null, subjects: {}, payload }) as unknown as EngineEvent

  it('splits a wait over the hour boundary and counts moves in the hour they happen', () => {
    const c = collector()
    const sts = config.sts[0].id
    // idle for work until 3000 s (22:20), then a move at 3500 (22:28) and 5400 (23:00)
    c.ingest(ev('StsMoveStarted', 3000, { stsId: sts, vesselId: 'V1', containerIds: ['c1'], segments: [] }))
    c.ingest(ev('StsGrounded', 3500, { stsId: sts, containerId: 'c1', groundPositionId: 'g', x: 0, segments: [] }))
    c.ingest(ev('StsGrounded', 5400, { stsId: sts, containerId: 'c2', groundPositionId: 'g', x: 0, segments: [] }))
    const r = c.report(7200)
    expect(r.hours.map((h) => [h.hourOfDay, h.startS, h.endS])).toEqual([
      [21, 0, 1800],
      [22, 1800, 5400],
      [23, 5400, 7200],
    ])
    const moves = r.series['sts.moves'].entities[sts]
    expect(moves.hourly).toEqual([0, 1, 1])
    // work wait: 0..3000 -> 1800 s in hour 0, 1200 s in hour 1
    expect(r.series['sts.wait-work-s'].entities[sts].hourly).toEqual([1800, 1200, 0])
    // gross moves/h in hour 1: 1 move over (3600 - 1200) s on vessel = 1 / (2400/3600) = 1.5
    expect(r.series['sts.gross-moves-per-hour'].entities[sts].hourly).toEqual([null, 1.5, 2])
    // total: 2 moves over (7200 - 3000) s on vessel
    expect(moves.total).toBe(2)
    expect(r.series['sts.gross-moves-per-hour'].entities[sts].total).toBe(1.714)
  })

  it('counts a night shift that spans midnight as one shift', () => {
    const c = collector()
    const sts = config.sts[0].id
    c.ingest(ev('StsMoveStarted', 0, { stsId: sts, vesselId: 'V1', containerIds: ['c1'], segments: [] }))
    for (const t of [1000, 3000, 4 * 3600]) c.ingest(ev('StsGrounded', t, { stsId: sts, containerId: 'c', groundPositionId: 'g', x: 0, segments: [] }))
    const r = c.report(5 * 3600)
    // clock 21:30 start: 21:30-22:00 is the tail of shift 2, the night shift (22:00-06:00) follows
    expect(r.shifts.map((s) => [s.shiftOfDay, s.clockDay])).toEqual([
      [2, 0],
      [3, 0],
    ])
    expect(r.series['sts.moves'].entities[sts].shifts).toEqual([1, 2])
  })

  it('tracks remaining moves as a gauge carried through quiet hours', () => {
    const c = collector()
    const pick = (t: number) =>
      c.ingest(ev('StsPicked', t, { stsId: 'S', containerId: 'c', from: { kind: 'vesselSlot', id: 'V1:01-01-01' }, segments: [] }))
    pick(2000)
    pick(7000)
    const r = c.report(9000)
    // 21:30 start: hour 0 = 0-1800 s, hour 1 = 1800-5400, hour 2 = 5400-9000
    expect(r.series['vessel.remaining-moves'].entities['V1'].hourly).toEqual([0, 2, 1])
    expect(r.series['vessel.remaining-moves'].entities['V1'].total).toBe(1)
  })
})
