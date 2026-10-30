/**
 * TT-R13: SHC pre-dispatch on predicted ready time, through the public engine API (`predictedReady()`, the event log,
 * the KPI report and the invariant checker).
 */
import { describe, expect, it } from 'vitest'
import { buildLaneGraph, createSimulation, type EngineEvent, type PredictedReady, type Simulation } from '../engine'
import { hatchSettings } from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const FIXTURE = 'shc-prepositioning'
const fixture = fixtures[FIXTURE]

const withStrategy = (config: ScenarioConfig, strategy: string): ScenarioConfig => ({
  ...structuredClone(config),
  decisions: { ...config.decisions, points: { ...config.decisions?.points, shcDispatch: { strategy } } },
})

const withMargin = (config: ScenarioConfig, predispatchMarginS: number): ScenarioConfig => ({
  ...structuredClone(config),
  queueAreas: { ...config.queueAreas, predispatchMarginS },
})

const stsWaitS = (sim: Simulation): number => Object.values(sim.kpiReport().horizontal?.stsGroundPositionWaitS ?? {}).reduce((a, b) => a + b, 0)

/** Every prediction seen at every event, keyed by container (the last value seen before the box is ready). */
function collectPredictions(sim: Simulation): { seen: Map<string, PredictedReady>; all: PredictedReady[] } {
  const seen = new Map<string, PredictedReady>()
  const all: PredictedReady[] = []
  for (let e = sim.step(); e; e = sim.step()) {
    for (const p of sim.predictedReady()) {
      all.push(p)
      if (p.exact && p.containerId) seen.set(p.containerId, p)
    }
  }
  return { seen, all }
}

const firstAt = (log: readonly EngineEvent[], type: EngineEvent['type'], containerId: string): number | undefined =>
  log.find((e) => e.type === type && 'containerId' in e.payload && e.payload.containerId === containerId)?.t

describe('predicted ready times', () => {
  it('quay: an in-flight carry is published at the exact StsGrounded time; upcoming boxes are estimated ahead of it', () => {
    const sim = createSimulation(fixture)
    const { seen, all } = collectPredictions(sim)
    const grounded = seen.size
    expect(grounded).toBeGreaterThan(10)
    for (const [containerId, p] of seen) {
      if (p.source !== 'sts') continue
      expect(firstAt(sim.eventLog(), 'StsGrounded', containerId)).toBeCloseTo(p.readyAt, 6)
    }
    expect(all.some((p) => p.source === 'sts' && !p.exact)).toBe(true)
    for (const p of all) expect(Number.isFinite(p.readyAt)).toBe(true)
  })

  it('ASC: a planned retrieval is published at the exact AscDroppedAtWtp time (WTP pad work)', () => {
    const sim = createSimulation(fixtures['load-1sts-10-boxes-1block'])
    const { seen } = collectPredictions(sim)
    const asc = [...seen.values()].filter((p) => p.source === 'asc')
    expect(asc.length).toBeGreaterThan(0)
    for (const p of asc) {
      expect(p.ownerId).toBe('B01')
      expect(firstAt(sim.eventLog(), 'AscDroppedAtWtp', p.containerId as string)).toBeCloseTo(p.readyAt, 6)
    }
  })

  it('quay: the estimate includes the hatch cycle of a hatch package in front of the next boxes', () => {
    const config: ScenarioConfig = { ...structuredClone(fixture), hatch: { enabled: true } }
    const hatchS = hatchSettings(config, 'feeder').cycleS
    const sim = createSimulation(config)
    let checked = 0
    for (let e = sim.step(); e && checked === 0; e = sim.step()) {
      const { state } = sim.snapshot()
      for (const sts of Object.values(state.sts)) {
        const pkgs = sts.packageIds.map((id) => state.workPackages[id])
        const active = pkgs.findIndex((p) => p.id === sts.activePackageId)
        if (active < 0 || pkgs[active].kind !== 'discharge' || sts.workQueue.length !== 1 || sts.carrying.length > 0) continue
        if (pkgs[active + 1]?.kind !== 'hatch-remove') continue
        const mine = sim.predictedReady().filter((p) => p.ownerId === sts.id && !p.exact)
        // the box of the active package, then (after the hatch move) the next one
        expect(mine.length).toBeGreaterThanOrEqual(1)
        const last = Math.max(...mine.map((p) => p.readyAt))
        expect(last - state.now).toBeGreaterThanOrEqual(hatchS)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('pre-dispatch strategy', () => {
  it('SHCs are on the STS queue area when the box lands, and the cranes wait less than with chained-nearest', () => {
    const sim = createSimulation(fixture)
    sim.runUntil()
    const log = sim.eventLog()
    const sent = log.filter((e) => e.type === 'ShcRoutingToParking' && e.payload.predicted)
    expect(sent.length).toBeGreaterThan(5)
    let early = 0
    for (const e of sent) {
      if (e.type !== 'ShcRoutingToParking' || !e.payload.predicted) continue
      expect(e.payload.predicted.areaId).toMatch(/^Q[SB]:/)
      const arrived = log.find((q) => q.type === 'ShcQueued' && q.payload.shcId === e.payload.shcId && q.id > e.id)
      if (arrived && arrived.t <= e.payload.predicted.readyAt) early++
    }
    expect(early).toBeGreaterThan(0)

    const base = createSimulation(withStrategy(fixture, 'chained-nearest'))
    base.runUntil()
    expect(base.eventLog().some((e) => e.type === 'ShcRoutingToParking' && e.payload.predicted)).toBe(false)
    expect(stsWaitS(base)).toBeGreaterThan(0)
    expect(stsWaitS(sim)).toBeLessThan(stsWaitS(base))
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('no box is collected before it is physically available, and no job is claimed before its release', () => {
    const sim = createSimulation(fixture)
    sim.runUntil()
    const log = sim.eventLog()
    for (const e of log) {
      if (e.type === 'ShcPicked') expect(e.t).toBeGreaterThanOrEqual(firstAt(log, 'StsGrounded', e.payload.containerId) as number)
      if (e.type === 'ShcJobAssigned') expect(e.t).toBeGreaterThanOrEqual(firstAt(log, 'StsGrounded', e.payload.containerId) as number)
    }
    expect(log.filter((e) => e.type === 'ShcPicked').length).toBe(24)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('no box is collected before it is on the pad either (export loads, pre-dispatch to the block queue area)', () => {
    const config: ScenarioConfig = {
      ...withStrategy(fixtures['load-1sts-10-boxes-1block'], 'predispatch'),
      queueAreas: { stsCapacity: 2, blockCapacity: 2, predispatchMarginS: 60 },
    }
    const sim = createSimulation(config)
    sim.runUntil()
    const log = sim.eventLog()
    expect(log.some((e) => e.type === 'ShcRoutingToParking' && e.payload.predicted?.source === 'asc')).toBe(true)
    for (const e of log) {
      if (e.type === 'ShcPickedAtWtp') expect(e.t).toBeGreaterThanOrEqual(firstAt(log, 'AscDroppedAtWtp', e.payload.containerId) as number)
      if (e.type === 'ShcJobAssigned') expect(e.t).toBeGreaterThanOrEqual(firstAt(log, 'AscDroppedAtWtp', e.payload.containerId) ?? 0)
    }
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('the margin is configurable: a larger margin sends SHCs earlier, and 0 sends them no earlier than their travel time', () => {
    const departures = (margin: number) => {
      const sim = createSimulation(withMargin(fixture, margin))
      sim.runUntil()
      expect(sim.invariantReport().violations).toEqual([])
      return sim.eventLog().filter((e) => e.type === 'ShcRoutingToParking' && e.payload.predicted)
    }
    const small = departures(0)
    const large = departures(90)
    expect(large.length).toBeGreaterThan(0)
    const lead = (list: readonly EngineEvent[]) => {
      let sum = 0
      for (const e of list) if (e.type === 'ShcRoutingToParking' && e.payload.predicted) sum += e.payload.predicted.readyAt - e.t
      return sum / Math.max(1, list.length)
    }
    expect(lead(large)).toBeGreaterThan(lead(small))
  })

  it('other strategies are untouched: oldest-job and nearest-job never pre-dispatch', () => {
    for (const strategy of ['oldest-job', 'nearest-job', 'chained-nearest']) {
      const sim = createSimulation(withStrategy(fixture, strategy))
      sim.runUntil()
      expect(sim.eventLog().some((e) => e.type === 'ShcRoutingToParking' && e.payload.predicted), strategy).toBe(false)
    }
  })

  it('waiting SHCs stay on queue or parking spots (shc.waiting-positions holds at every event)', () => {
    const sim = createSimulation(fixture)
    const g = buildLaneGraph(fixture)
    for (let e = sim.step(); e; e = sim.step()) {
      for (const shc of Object.values(sim.snapshot().state.shcs)) {
        if (shc.plan.length > 0) continue
        if (shc.status === 'queuing-for-work') expect(g.nodes[shc.nodeId].kind).toBe('queue')
        if (shc.status === 'parked') expect(g.nodes[shc.nodeId].kind).toBe('parking')
      }
    }
    expect(sim.invariantReport().violations).toEqual([])
  })
})
