/**
 * TT-R17: ASC pre-retrieval. With the `pre-retrieval` ascDispatch strategy the ASC fetches an import box to the
 * truck's stall once the stall is reserved and the truck is close, so the stall service time drops. The default
 * strategies keep the old behaviour (no early job is ever offered).
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type EngineEvent, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const FIXTURE = 'asc-pre-retrieval'

const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) =>
  sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

const run = (strategy: string | null, tweak?: (c: ScenarioConfig) => void): Simulation => {
  const config: ScenarioConfig = structuredClone(fixtures[FIXTURE])
  tweak?.(config)
  if (strategy === null) delete config.decisions
  else config.decisions = { points: { ascDispatch: { strategy } } }
  const sim = createSimulation(config)
  sim.runUntil()
  return sim
}

const meanServiceS = (sim: Simulation) => {
  const s = ofType(sim, 'TruckInterchangeDone').map((e) => e.payload.serviceS)
  return s.reduce((a, b) => a + b, 0) / s.length
}

describe('ASC pre-retrieval (TT-R17)', () => {
  const pre = run('pre-retrieval')
  const plain = run(null)

  it('serves every import truck, with and without pre-retrieval', () => {
    expect(ofType(pre, 'TruckGateOut')).toHaveLength(6)
    expect(ofType(plain, 'TruckGateOut')).toHaveLength(6)
  })

  it('starts the retrieval before the truck is at its stall, and the box is on the chassis after it arrives', () => {
    const early = ofType(pre, 'AscJobAssigned').filter((e) => e.payload.early)
    expect(early).toHaveLength(6)
    for (const e of early) {
      const at = ofType(pre, 'TruckAtStall').find((t) => t.payload.truckId === e.payload.truckId)
      expect(at).toBeDefined()
      expect(e.t).toBeLessThan((at as EngineEvent).t)
      const dropped = ofType(pre, 'AscDroppedAtStall').find((d) => d.payload.truckId === e.payload.truckId)
      expect((dropped as EngineEvent).t).toBeGreaterThanOrEqual((at as EngineEvent).t)
    }
  })

  it('lowers the stall service time of import trucks', () => {
    expect(meanServiceS(pre)).toBeLessThan(meanServiceS(plain) - 10)
    const k = pre.kpiReport().landside
    expect(k?.trucksOut).toBe(6)
  })

  it('never offers an early job under the default strategies', () => {
    expect(ofType(plain, 'AscJobAssigned').some((e) => e.payload.early)).toBe(false)
    const req = ofType(plain, 'DecisionRequested').filter((e) => e.payload.decisionPoint === 'ascDispatch')
    expect(req.some((e) => (e.payload.request as { job: { early?: true } }).job.early)).toBe(false)
  })

  it('keeps custody and stall invariants (no violations)', () => {
    expect(pre.invariantReport().violations).toEqual([])
  })

  it('also works with a single ASC per block (the decision is asked for the early job only)', () => {
    const one = (c: ScenarioConfig) => void ((c.yard as { ascsPerBlock: 1 | 2 }).ascsPerBlock = 1)
    const a = run('pre-retrieval', one)
    const b = run(null, one)
    expect(ofType(a, 'TruckGateOut')).toHaveLength(6)
    expect(ofType(a, 'AscJobAssigned').some((e) => e.payload.early)).toBe(true)
    expect(meanServiceS(a)).toBeLessThan(meanServiceS(b))
    expect(a.invariantReport().violations).toEqual([])
  })

  it('does not fetch ahead for a dual transaction (its drop leg comes first)', () => {
    const dual = (c: ScenarioConfig) => {
      const landside = c.landside as NonNullable<ScenarioConfig['landside']>
      landside.scripted = (landside.scripted ?? []).map((s) => ({ ...s, transaction: 'dual' as const }))
    }
    const sim = run('pre-retrieval', dual)
    expect(ofType(sim, 'AscJobAssigned').some((e) => e.payload.early)).toBe(false)
    expect(sim.invariantReport().violations).toEqual([])
  })
})
