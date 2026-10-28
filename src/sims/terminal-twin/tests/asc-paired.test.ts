/**
 * TT-08: two ASCs per block share one rail, never pass, wait for each other's
 * rail segments, and are assigned boxes by the ascDispatch decision point.
 * Seams: engine API (events, KPIs, invariants), decision-point handlers.
 */
import { describe, expect, it } from 'vitest'
import { ascIdOf, ascPoseAt, createSimulation, restoreSimulation, type Simulation } from '../engine'
import { twinScenario } from './twin-scenario'

describe('two ASCs per block', () => {
  it('a block with ascsPerBlock 2 has a waterside and a landside ASC and stacks every box', () => {
    const sim = createSimulation(twinScenario({ ascs: 2 }))
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.query.ascs().map((a) => a.id)).toEqual([ascIdOf('B01', 1), ascIdOf('B01', 2)])
    expect(sim.kpiReport().yard?.boxesStacked).toBe(16)
  })
})

/** Independent of the engine's invariant: after every event the two ASCs keep their order and 12 m between centres. */
function minGapAfterEveryEvent(sim: Simulation): { minGapM: number; events: number } {
  let minGapM = Infinity
  let events = 0
  sim.subscribe(() => {
    const [w, l] = sim.query.ascs()
    minGapM = Math.min(minGapM, ascPoseAt(l, sim.now).z - ascPoseAt(w, sim.now).z)
    events++
  })
  sim.runUntil()
  return { minGapM, events }
}

const SCENARIOS: [string, Parameters<typeof twinScenario>[0]][] = [
  ['default dispatch, nearest-wtp slots', {}],
  ['balanced dispatch, random slots', { dispatch: 'balanced', allocation: 'random', seed: 11 }],
  ['balanced dispatch, group-by-vessel, 30 boxes', { dispatch: 'balanced', allocation: 'group-by-vessel', boxes: 30, seed: 3 }],
]

describe('no passing', () => {
  for (const [name, opts] of SCENARIOS) {
    it(`the ASCs never cross order and keep 12 m apart after every event (${name})`, () => {
      const sim = createSimulation(twinScenario({ ascs: 2, ...opts }))
      const { minGapM, events } = minGapAfterEveryEvent(sim)
      expect(sim.firstError).toBeNull()
      expect(sim.invariantReport().violations).toEqual([])
      expect(events).toBeGreaterThan(100)
      expect(minGapM).toBeGreaterThanOrEqual(12 - 1e-6)
    })
  }

  it('asc.no-passing reports ASCs that are too close (tampered snapshot)', () => {
    const sim = createSimulation(twinScenario({ ascs: 2 }))
    sim.runUntil({ eventType: 'AscJobAssigned' })
    const snap = sim.snapshot()
    snap.state.ascs['B01-ASC2'].motion = []
    snap.state.ascs['B01-ASC2'].gantryZ = snap.state.ascs['B01-ASC1'].gantryZ + 3
    const tampered = restoreSimulation(snap)
    tampered.step()
    expect(tampered.status).toBe('failed')
    expect(tampered.firstError?.message).toMatch(/asc\.no-passing/)
  })
})
