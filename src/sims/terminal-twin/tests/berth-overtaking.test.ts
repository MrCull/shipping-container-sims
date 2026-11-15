/**
 * Opt-in berth overtaking (`quay.berthOvertaking`, #272): a waiting vessel that fits a quay
 * stretch the head of the anchorage queue cannot use berths first. Off by default.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type EngineEvent } from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const overtaking = fixtures['berth-overtaking']

const withOvertaking = (on: boolean | undefined): ScenarioConfig => {
  const cfg: ScenarioConfig = structuredClone(overtaking)
  if (on === undefined) delete cfg.quay.berthOvertaking
  else cfg.quay.berthOvertaking = on
  return cfg
}

const berthOrder = (log: readonly EngineEvent[]): string[] =>
  log.filter((e) => e.type === 'BerthAllocated').map((e) => e.subjects.vessels![0])

const askedOrder = (log: readonly EngineEvent[]): string[] =>
  log.flatMap((e) => (e.type === 'DecisionResolved' && e.payload.decisionPoint === 'berthAllocation' ? [e.payload.request.vesselId] : []))

function run(cfg: ScenarioConfig) {
  const sim = createSimulation(cfg)
  expect(sim.runUntil().reason).toBe('ended')
  expect(sim.firstError).toBeNull()
  expect(sim.invariantReport().violations).toEqual([])
  return sim
}

describe('berth overtaking', () => {
  it('on: the Feedermax berths before the ULCV that arrived first and is waiting for room', () => {
    const sim = run(overtaking)
    const log = sim.eventLog()
    expect(berthOrder(log)).toEqual(['V001', 'V003', 'V002'])

    const kpis = sim.kpiReport()
    expect(kpis.vessels.V003.anchorageWaitS).toBe(0)
    expect(kpis.vessels.V002.anchorageWaitS).toBeGreaterThan(1000)
    // V003 took the stretch behind V001; V002 took V001's stretch once it left
    expect(sim.query.vessel('V003').berthX).toBe(415)
    expect(sim.query.vessel('V002').berthX).toBe(0)

    // the queue order is kept: V002 is asked first every time the quay changes, and told to wait once
    expect(askedOrder(log)).toEqual(['V001', 'V002', 'V003', 'V002', 'V002'])
    expect(log.filter((e) => e.type === 'VesselAtAnchorage').map((e) => e.subjects.vessels![0])).toEqual(['V002'])
  })

  it.each([false, undefined])('off (%s): vessels berth in arrival order and only the head of the queue is asked about', (on) => {
    const sim = run(withOvertaking(on))
    const log = sim.eventLog()
    expect(berthOrder(log)).toEqual(['V001', 'V002', 'V003'])
    expect(sim.kpiReport().vessels.V003.anchorageWaitS).toBeGreaterThan(1000)
    expect(askedOrder(log).filter((id) => id === 'V003')).toHaveLength(1)
  })

  it('a snapshot taken while a refused vessel is remembered resumes to the same event log', () => {
    const whole = run(overtaking)
    const sim = createSimulation(overtaking)
    // stop right after V003 took its berth: V002 has been asked again and refused on that quay state
    while (!(sim.query.vessel('V003').berthX !== null && sim.snapshot().state.berth.asked.length > 0)) {
      expect(sim.runUntil({ maxEvents: 1 }).reason).not.toBe('ended')
    }
    const snap = JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<typeof sim.snapshot>
    expect(snap.state.berth.asked).toEqual(['V002'])
    expect(snap.state.berth.queue).toEqual(['V002'])

    const resumed = createSimulation(snap.config, {}, { seed: snap.seed })
    resumed.restore(snap)
    expect(resumed.runUntil().reason).toBe('ended')
    expect(resumed.eventLogHash()).toBe(whole.eventLogHash())
    expect(berthOrder(resumed.eventLog())).toEqual(['V001', 'V003', 'V002'])
  })

  it('a slow berthAllocation reply still asks one vessel at a time and never double-books the quay', () => {
    const cfg = withOvertaking(true)
    cfg.decisions = {
      asyncMode: 'keep-running',
      simSecondsPerWallSecond: 1,
      points: { berthAllocation: { strategy: 'first-fit', latency: { delay: { kind: 'uniform', minMs: 20000, maxMs: 90000 } }, timeoutMs: 120000 } },
    }
    const sim = run(cfg)
    const log = sim.eventLog()
    expect(berthOrder(log)).toEqual(['V001', 'V003', 'V002'])
    // requests never overlap: each berthAllocation request follows the previous one's reply
    const points = log.filter((e) => (e.type === 'DecisionRequested' || e.type === 'DecisionResolved') && e.payload.decisionPoint === 'berthAllocation')
    expect(points).toHaveLength(10)
    expect(sim.kpiReport().vessels.V003.anchorageWaitS).toBeGreaterThan(0) // the reply took sim time
    points.forEach((e, i) => expect(e.type).toBe(i % 2 === 0 ? 'DecisionRequested' : 'DecisionResolved'))
  })
})
