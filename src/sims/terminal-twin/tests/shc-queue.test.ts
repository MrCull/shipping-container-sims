/**
 * TT-R12: SHC queue areas and chained dispatch, through the public engine API, the lane graph and the
 * invariant checker.
 */
import { describe, expect, it } from 'vitest'
import { buildLaneGraph, createSimulation, restoreSimulation, type EngineEvent, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { PEAK_DAY_PRESET_NAME, presets } from '../scenario/presets'
import type { ScenarioConfig } from '../scenario/types'

const FIXTURE = 'shc-queue-chained'
const fixture = fixtures[FIXTURE]

const withStrategy = (config: ScenarioConfig, strategy: string): ScenarioConfig => ({
  ...structuredClone(config),
  decisions: { ...config.decisions, points: { ...config.decisions?.points, shcDispatch: { strategy } } },
})

const parkingReturns = (sim: Simulation) => Object.values(sim.kpiReport().horizontal?.shcs ?? {}).reduce((a, k) => a + k.parkingReturns, 0)

/** Step until a loaded SHC rests at a queue spot (waiting for a pad). */
function runToLoadedQueue(sim: Simulation): void {
  let guard = 0
  while (!Object.values(sim.snapshot().state.shcs).some((s) => s.status === 'queuing-for-pad' && s.plan.length === 0) && guard++ < 4000) sim.step()
}

describe('queue areas in the lane graph', () => {
  it('one area per STS and per block with the configured capacity, separate from parking, pads and ground lanes', () => {
    const g = buildLaneGraph(fixture)
    expect(g.queueAreas.map((a) => [a.id, a.kind, a.nodes.length])).toEqual([
      ['QS:STS01', 'sts', 2],
      ['QS:STS02', 'sts', 2],
      ['QB:B01', 'block', 2],
    ])
    const spots = g.queueAreas.flatMap((a) => a.nodes)
    expect(new Set(spots).size).toBe(spots.length)
    for (const id of spots) {
      expect(g.nodes[id].kind).toBe('queue')
      expect(g.nodes[id].zone).toBeNull()
      expect(Object.values(g.parkingNode)).not.toContain(id)
      expect(Object.values(g.padNode)).not.toContain(id)
      expect(g.queueAreaOf[id]).toMatch(/^Q[SB]:/)
      for (const p of g.pads) expect(Math.abs(g.nodes[id].x - p.x)).toBeGreaterThanOrEqual(5)
    }
  })

  it('a scenario without queueAreas has none (older fixtures keep their graph)', () => {
    expect(buildLaneGraph(fixtures['shc-1sts-2shc-1wtp']).queueAreas).toEqual([])
  })

  it('the TTI presets set queue areas, and the graph has one per STS and block', () => {
    for (const name of ['TTI Algeciras baseline', 'Small automated', PEAK_DAY_PRESET_NAME]) {
      const config = presets[name]()
      expect(config.queueAreas, name).toEqual({ stsCapacity: 3, blockCapacity: 3 })
      const g = buildLaneGraph(config)
      expect(g.queueAreas).toHaveLength(config.sts.length + (config.yard?.blocks.length ?? 0))
    }
  })
})

describe('waiting only on queue spots or parking spots', () => {
  it('every settled waiting SHC stands on its queue spot or its parking spot, at every event', () => {
    const sim = createSimulation(fixture)
    const g = buildLaneGraph(fixture)
    let sawLoadedQueue = false
    let sawIdleQueue = false
    for (let e = sim.step(); e; e = sim.step()) {
      const state = sim.snapshot().state
      const spots = new Set(Object.keys(state.queueClaims))
      for (const shc of Object.values(state.shcs)) {
        if (shc.plan.length > 0) continue
        if (shc.status === 'parked') expect(g.nodes[shc.nodeId].kind).toBe('parking')
        if (shc.status === 'queuing-for-pad') {
          sawLoadedQueue = true
          expect(g.nodes[shc.nodeId].kind).toBe('queue')
          expect(shc.carrying).not.toBeNull()
          expect(state.queueClaims[shc.nodeId]).toBe(shc.id)
        }
        if (shc.status === 'queuing-for-work') {
          sawIdleQueue = true
          expect(g.nodes[shc.nodeId].kind).toBe('queue')
          expect(shc.carrying).toBeNull()
        }
      }
      // exclusive: a spot has one holder and no SHC holds two
      expect(new Set(Object.values(state.queueClaims)).size).toBe(spots.size)
      for (const pad of Object.values(state.wtpPads)) if (pad.claimedBy) expect(pad.containerId).toBeNull()
    }
    expect(sawLoadedQueue).toBe(true)
    expect(sawIdleQueue).toBe(true)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('a loaded SHC waits at the block queue until a pad is free, then delivers (no delivery into a full buffer)', () => {
    const sim = createSimulation(fixture)
    sim.runUntil()
    const log = sim.eventLog()
    const queued = log.filter((e) => e.type === 'ShcQueued' && e.payload.loaded)
    expect(queued.length).toBeGreaterThan(0)
    for (const q of queued) {
      if (q.type !== 'ShcQueued') continue
      expect(q.payload.areaId).toBe('QB:B01')
      const departed = log.find((e) => e.type === 'ShcQueueDeparted' && e.payload.jobId === q.payload.jobId)
      if (departed?.type !== 'ShcQueueDeparted') continue // still waiting when the run ended
      expect(departed.t).toBeGreaterThanOrEqual(q.t)
    }
    expect(sim.invariantReport().violations).toEqual([])
    expect(Object.values(sim.kpiReport().horizontal?.shcs ?? {}).reduce((a, k) => a + k.queueArrivals, 0)).toBeGreaterThan(0)
  })

  it('negative test: a queued SHC standing on a pad clear position is reported by shc.waiting-positions at the exact event', () => {
    const sim = createSimulation(fixture)
    runToLoadedQueue(sim)
    const snap = sim.snapshot()
    const queued = Object.values(snap.state.shcs).find((s) => s.status === 'queuing-for-pad' && s.plan.length === 0)
    expect(queued).toBeDefined()
    const g = buildLaneGraph(fixture)
    snap.state.shcs[queued!.id].nodeId = g.padClearNode[g.pads[0].id]
    const resumed = restoreSimulation(snap)
    const stepped = resumed.step() as EngineEvent
    const last = resumed.eventLog().at(-1) as EngineEvent
    expect(resumed.status).toBe('failed')
    if (last.type !== 'InvariantViolated') throw new Error(`expected InvariantViolated, got ${last.type}`)
    expect(last.payload.invariant).toBe('shc.waiting-positions')
    expect(last.payload.offendingEventId).toBe(stepped.id)
    expect(last.payload.message).toMatch(/queue spot/)
  })

  it('negative test: two SHCs on one queue spot are reported', () => {
    const sim = createSimulation(fixture)
    let guard = 0
    while (Object.keys(sim.snapshot().state.queueClaims).length < 2 && guard++ < 4000) sim.step()
    const snap = sim.snapshot()
    const [a, b] = Object.entries(snap.state.queueClaims)
    expect(a && b).toBeTruthy()
    snap.state.shcs[b[1]].nodeId = a[0] // b now stands on a's spot
    const resumed = restoreSimulation(snap)
    resumed.step()
    const last = resumed.eventLog().at(-1) as EngineEvent
    if (last.type !== 'InvariantViolated') throw new Error(`expected InvariantViolated, got ${last.type}`)
    expect(last.payload.invariant).toBe('shc.waiting-positions')
  })
})

describe('chained-nearest dispatch', () => {
  it('reduces parking returns versus oldest-job on the fixture, with no violations in either run', () => {
    const chained = createSimulation(withStrategy(fixture, 'chained-nearest'))
    const oldest = createSimulation(withStrategy(fixture, 'oldest-job'))
    for (const sim of [chained, oldest]) {
      expect(sim.runUntil().reason).toBe('ended')
      expect(sim.firstError).toBeNull()
      expect(sim.invariantReport().violations).toEqual([])
    }
    expect(parkingReturns(oldest)).toBeGreaterThan(0)
    expect(parkingReturns(chained)).toBeLessThan(parkingReturns(oldest))
    expect(chained.kpiReport().horizontal?.boxesToWtp).toBe(oldest.kpiReport().horizontal?.boxesToWtp)
  })

  it('oldest-job and nearest-job stay selectable and keep idle SHCs parking', () => {
    for (const strategy of ['oldest-job', 'nearest-job']) {
      const sim = createSimulation(withStrategy(fixture, strategy))
      sim.runUntil()
      expect(sim.invariantReport().violations).toEqual([])
      expect(Object.values(sim.snapshot().state.shcs).every((s) => s.status !== 'queuing-for-work')).toBe(true)
    }
  })

  it('is deterministic: two runs have the same event-log hash', () => {
    const a = createSimulation(fixture)
    const b = createSimulation(fixture)
    a.runUntil()
    b.runUntil()
    expect(a.eventLogHash()).toBe(b.eventLogHash())
  })
})
