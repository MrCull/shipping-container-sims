import { describe, expect, it } from 'vitest'
import { createSimulation, restoreSimulation, type EngineEvent } from '../engine'
import { fixtures } from '../scenario/fixtures'

const tracer = fixtures['tracer-1sts-10-boxes']

function runToEnd(seed?: number) {
  const sim = createSimulation(tracer, {}, { seed })
  sim.runUntil()
  return sim
}

describe('determinism', () => {
  it('same seed and config give an identical event-log hash, event log and KPIs', () => {
    const a = runToEnd()
    const b = runToEnd()
    expect(a.eventLogHash()).toBe(b.eventLogHash())
    expect(a.eventLog()).toEqual(b.eventLog())
    expect(a.kpiReport()).toEqual(b.kpiReport())
  })

  it('a different seed changes the run (move times vary with the seed)', () => {
    const a = runToEnd(1)
    const b = runToEnd(2)
    expect(a.eventLogHash()).not.toBe(b.eventLogHash())
    expect(a.kpiReport().simTimeS).not.toBe(b.kpiReport().simTimeS)
    expect(b.kpiReport().movesCompleted).toBe(10)
  })
})

describe('snapshot and restore', () => {
  it('snapshot mid-run, restore into a fresh simulation, run to the end = uninterrupted run', () => {
    const reference = runToEnd()

    const first = createSimulation(tracer)
    first.runUntil({ time: 500 })
    expect(first.now).toBe(500)
    expect(first.kpiReport().movesCompleted).toBeGreaterThan(0)
    expect(first.kpiReport().movesCompleted).toBeLessThan(10)
    const snapshot = JSON.parse(JSON.stringify(first.snapshot())) // must survive JSON

    const resumed = restoreSimulation(snapshot)
    expect(resumed.now).toBe(500)
    resumed.runUntil()

    expect(resumed.eventLogHash()).toBe(reference.eventLogHash())
    expect(resumed.eventLog()).toEqual(reference.eventLog())
    expect(resumed.kpiReport()).toEqual(reference.kpiReport())
    expect(resumed.query.containers()).toEqual(reference.query.containers())
  })

  it('restore rewinds a simulation that has run past the snapshot', () => {
    const sim = createSimulation(tracer)
    sim.runUntil({ moves: 3 })
    const snap = sim.snapshot()
    const hashAtSnap = sim.eventLogHash()
    sim.runUntil()
    sim.restore(snap)
    expect(sim.eventLogHash()).toBe(hashAtSnap)
    expect(sim.kpiReport().movesCompleted).toBe(3)
    sim.runUntil()
    expect(sim.eventLogHash()).toBe(runToEnd().eventLogHash())
  })
})

describe('causality', () => {
  it('every event except the root has a cause that was processed earlier', () => {
    const sim = runToEnd()
    const seqById = new Map(sim.eventLog().map((e) => [e.id, e.seq]))
    for (const e of sim.eventLog()) {
      if (e.type === 'ScenarioStarted') expect(e.causedBy).toBeNull()
      else expect(seqById.get(e.causedBy as number)).toBeLessThan(e.seq)
    }
  })

  it('why(eventId) walks the cause chain back to the root event', () => {
    const sim = runToEnd()
    const log = sim.eventLog()
    const lastGrounded = log.filter((e) => e.type === 'StsGrounded').at(-1) as EngineEvent
    const chain = sim.why(lastGrounded.id)
    expect(chain[0]).toBe(lastGrounded)
    expect(chain.at(-1)?.type).toBe('ScenarioStarted')
    for (let i = 0; i < chain.length - 1; i++) expect(chain[i].causedBy).toBe(chain[i + 1].id)
    // root → berth → (move started → picked → ground-position decision → grounded) × 10
    expect(chain.map((e) => e.type)).toEqual([
      ...Array.from({ length: 10 }, () => [
        'StsGrounded',
        'DecisionResolved',
        'DecisionRequested',
        'StsPicked',
        'StsMoveStarted',
      ]).flat(),
      'VesselBerthed',
      'ScenarioStarted',
    ])
  })

  it('why of an unknown event id throws', () => {
    expect(() => runToEnd().why(99999)).toThrow(/not in the log/)
  })
})

describe('stepping and subscribing', () => {
  it('step processes one event at a time in time order; subscribers see every event', () => {
    const sim = createSimulation(tracer)
    const seen: EngineEvent[] = []
    const grounded: EngineEvent[] = []
    sim.subscribe((e) => seen.push(e))
    const off = sim.subscribe((e) => grounded.push(e), { types: ['StsGrounded'] })
    const first = sim.step()
    expect(first?.type).toBe('ScenarioStarted')
    expect(sim.step()?.type).toBe('VesselBerthed')
    sim.runUntil({ moves: 2 })
    off()
    sim.runUntil()
    expect(grounded).toHaveLength(2)
    expect(seen).toEqual(sim.eventLog())
    for (let i = 1; i < seen.length; i++) expect(seen[i].t).toBeGreaterThanOrEqual(seen[i - 1].t)
    expect(sim.step()).toBeNull()
  })

  it('runUntil stops after an event type', () => {
    const sim = createSimulation(tracer)
    const result = sim.runUntil({ eventType: 'StsPicked' })
    expect(result.reason).toBe('condition')
    expect(sim.eventLog().at(-1)?.type).toBe('StsPicked')
    expect(sim.query.container(tracer.containers[0].id).custody.kind).toBe('sts')
  })
})
