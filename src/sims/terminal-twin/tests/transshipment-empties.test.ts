/**
 * TT-11: transshipment and empties, through the headless engine API (seam 1),
 * the decision-point handlers (seam 2) and the vessel generator.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type EngineEvent, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { generateVessels } from '../scenario/vesselGenerator'
import type { ScenarioConfig } from '../scenario/types'

function run(config: ScenarioConfig): Simulation {
  const sim = createSimulation(config)
  sim.runUntil({ maxEvents: 300_000 })
  return sim
}

const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) =>
  sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

describe('transshipment fixture: vessel A discharges, vessel B loads', () => {
  const sim = run(fixtures['transshipment-a-to-b'])
  const boxes = sim.query.containers().filter((c) => c.onwardVesselId === 'VB')

  it('completes without an error or invariant violation', () => {
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.query.vessel('VA').status).toBe('departed')
    expect(sim.query.vessel('VB').status).toBe('departed')
    expect(sim.kpiReport().movesCompleted).toBe(16)
  })

  it('links every discharged box to its onward vessel', () => {
    expect(boxes).toHaveLength(8)
  })

  it("runs each box's custody from vessel A's slot through the yard to vessel B's slot", () => {
    for (const box of boxes) {
      const owners = box.custodyHistory.map((h) => h.owner)
      expect(owners[0].kind).toBe('vesselSlot')
      expect(owners[0].id.startsWith('VA:'), box.id).toBe(true)
      expect(owners.some((o) => o.kind === 'yardSlot'), box.id).toBe(true)
      const last = owners[owners.length - 1]
      expect(last.kind).toBe('vesselSlot')
      expect(last.id.startsWith('VB:'), box.id).toBe(true)
      expect(box.custody).toEqual(last)
    }
    for (const s of sim.query.vesselSlots('VB').filter((s) => s.purpose === 'transshipment')) expect(s.containerId).toBe(s.plannedContainerId)
  })

  it('keeps each box in the yard for at least its dwell', () => {
    const ready = ofType(sim, 'TransshipmentReady')
    expect(ready).toHaveLength(8)
    for (const box of boxes) {
      const stackedAt = box.custodyHistory.find((h) => h.owner.kind === 'yardSlot')?.t as number
      const leftAt = box.custodyHistory.find((h) => h.owner.kind === 'asc' && h.t > stackedAt)?.t as number
      expect(leftAt - stackedAt, box.id).toBeGreaterThanOrEqual(600)
    }
  })
})

describe('empties fixture: a work package requires N empties of a size and line', () => {
  const sim = run(fixtures['empties-load-4-of-16'])

  it('raises "empties required" and allocates exactly N matching empties, then loads them', () => {
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    const required = ofType(sim, 'EmptiesRequired')
    expect(required).toHaveLength(1)
    expect(required[0].payload).toMatchObject({ size: '40', line: 'MSC', count: 4 })
    const allocated = ofType(sim, 'EmptiesAllocated')
    expect(allocated).toHaveLength(1)
    const ids = allocated[0].payload.containerIds
    expect(new Set(ids).size).toBe(4)
    for (const id of ids) {
      const box = sim.query.container(id)
      expect(box).toMatchObject({ size: '40', line: 'MSC', full: false })
      expect(box.custody.kind).toBe('vesselSlot')
    }
    expect(ofType(sim, 'StsLoaded').map((e) => e.payload.containerId).sort()).toEqual([...ids].sort())
    expect(sim.query.vessel('V001').status).toBe('departed')
  })

  it('records the allocation as a decision, caused by the requirement', () => {
    const asked = sim.eventLog().filter((e) => e.type === 'DecisionRequested' && e.payload.decisionPoint === 'emptyAllocation')
    expect(asked).toHaveLength(1)
    const required = ofType(sim, 'EmptiesRequired')[0]
    expect(sim.why(asked[0].id).some((e) => e.id === required.id)).toBe(true)
  })
})

describe('empty-allocation strategies', () => {
  const chosen = (strategy: string): string[] => {
    const config = structuredClone(fixtures['empties-load-4-of-16'])
    config.decisions = { points: { emptyAllocation: { strategy } } }
    const sim = run(config)
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    return [...ofType(sim, 'EmptiesAllocated')[0].payload.containerIds].sort()
  }

  it('nearest-wtp and oldest-first choose different empties on the same seed', () => {
    const near = chosen('nearest-wtp')
    const old = chosen('oldest-first')
    expect(near).toHaveLength(4)
    expect(old).toHaveLength(4)
    expect(near).not.toEqual(old)
  })

  it('oldest-first picks the empties that have stood longest', () => {
    const config = structuredClone(fixtures['empties-load-4-of-16'])
    config.decisions = { points: { emptyAllocation: { strategy: 'oldest-first' } } }
    const sim = createSimulation(config)
    sim.runUntil({ eventType: 'EmptiesAllocated' })
    const ids = ofType(sim, 'EmptiesAllocated')[0].payload.containerIds
    const since = (id: string) => sim.query.container(id).yardSince as number
    const others = sim.query.containers().filter((c) => !ids.includes(c.id) && c.size === '40' && c.line === 'MSC' && !c.full)
    expect(others.length).toBeGreaterThan(0)
    for (const id of ids) for (const o of others) expect(since(id)).toBeLessThanOrEqual(o.yardSince as number)
  })
})

describe('flow mix in the vessel generator', () => {
  const opts = { count: 300, startS: 0, intervalS: 3600, sizeMix: { feeder: 1, panamax: 1 }, jitterS: 0, seed: 9 }

  it('respects the configured import / export / transshipment mix within tolerance', () => {
    const mix = { import: 10, export: 5, transshipment: 85 }
    const vessels = generateVessels({ ...opts, flowMix: mix })
    let imports = 0
    let exports = 0
    let ts = 0
    for (const v of vessels) {
      const tsIn = v.dischargeTransshipment ?? 0
      imports += v.discharge - tsIn
      exports += v.load
      ts += tsIn + v.transshipment
    }
    const total = imports + exports + ts
    expect((100 * imports) / total).toBeCloseTo(10, 0)
    expect((100 * exports) / total).toBeCloseTo(5, 0)
    expect((100 * ts) / total).toBeCloseTo(85, 0)
  })

  it('a different mix gives a different split', () => {
    const vessels = generateVessels({ ...opts, flowMix: { import: 50, export: 50, transshipment: 0 } })
    expect(vessels.every((v) => (v.dischargeTransshipment ?? 0) === 0 && v.transshipment === 0)).toBe(true)
  })
})

describe('setup dialog overrides', () => {
  it('apply the dwell median and the empty pool, and flag a transshipment count above the discharge', async () => {
    const { applyOverrides, validateOverrides } = await import('../scenario/overrides')
    const config = applyOverrides(fixtures['empties-load-4-of-16'], { dwellMedianS: 7200, emptyPool: { count: 30 } })
    expect(config.transshipment?.dwell).toMatchObject({ kind: 'lognormal', medianS: 7200 })
    expect(config.emptyPool).toMatchObject({ count: 30, sizeMix: { '40': 1 } })
    expect(validateOverrides(config).errors).toEqual([])
    config.vessels[0].discharge = 2
    config.vessels[0].dischargeTransshipment = 5
    expect(validateOverrides(config).errors.map((e) => e.key)).toContain('setup.check.tsIn')
  })

  it('a bigger pool runs too', () => {
    const config = structuredClone(fixtures['empties-load-4-of-16'])
    config.emptyPool = { ...config.emptyPool, count: 40 }
    const sim = run(config)
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
  })
})
