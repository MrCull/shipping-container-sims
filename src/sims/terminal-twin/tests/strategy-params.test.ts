/**
 * Strategy parameters (#312): `config.decisions.points.<dp>.params` tunes the selected built-in strategy.
 * Every built-in strategy declares its tunable constants; defaults equal the old constants, so a run without
 * params is unchanged. Unknown names, a param for a strategy that is not selected, or an out-of-range value throw
 * at createSimulation.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, strategies } from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'
import type { DecisionPointConfig } from '../engine/decisions/types'

const base = fixtures['asc-1sts-10-boxes-1block']

function withYard(cfg: DecisionPointConfig): ScenarioConfig {
  return { ...base, decisions: { ...base.decisions, points: { ...base.decisions?.points, yardAllocation: cfg } } }
}

/** Mean height of the occupied yard stacks once the run has ended. */
function meanStackHeight(config: ScenarioConfig): number {
  const sim = createSimulation(config)
  sim.runUntil()
  expect(sim.status).toBe('ended')
  const heights = new Map<string, number>()
  for (const s of sim.query.yardSlots()) {
    if (!s.containerId) continue
    const key = `${s.blockId}|${s.bay}|${s.row}`
    heights.set(key, Math.max(heights.get(key) ?? 0, s.tier))
  }
  const hs = [...heights.values()]
  return hs.reduce((a, b) => a + b, 0) / hs.length
}

describe('strategy parameters', () => {
  it('every built-in parameter declares a default inside its range, a unit and a description', () => {
    let count = 0
    for (const point of Object.values(strategies)) {
      for (const def of Object.values(point.strategies) as { params?: Record<string, { default: number; min: number; max: number; unit: string; description: string }> }[]) {
        for (const [name, p] of Object.entries(def.params ?? {})) {
          count++
          expect(name).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/)
          expect(p.default).toBeGreaterThanOrEqual(p.min)
          expect(p.default).toBeLessThanOrEqual(p.max)
          expect(p.unit.length).toBeGreaterThan(0)
          expect(p.description.length).toBeGreaterThan(10)
        }
      }
    }
    expect(count).toBeGreaterThan(10)
    expect(strategies.yardAllocation.strategies['nearest-wtp'].params?.TIER_COST_M.default).toBe(6)
    expect(strategies.yardAllocation.strategies.grouped.params?.MIXED_STACK_COST_M.default).toBe(90)
  })

  it('params at their defaults give the same event log as no params', () => {
    const plain = createSimulation(withYard({ strategy: 'nearest-wtp' }))
    plain.runUntil()
    const tuned = createSimulation(withYard({ strategy: 'nearest-wtp', params: { TIER_COST_M: 6 } }))
    tuned.runUntil()
    expect(tuned.eventLogHash()).toBe(plain.eventLogHash())
  })

  it('a higher tier cost in nearest-wtp gives a lower mean stack height', () => {
    const low = meanStackHeight(withYard({ strategy: 'nearest-wtp', params: { TIER_COST_M: 0 } }))
    const high = meanStackHeight(withYard({ strategy: 'nearest-wtp', params: { TIER_COST_M: 1000 } }))
    expect(high).toBeLessThan(low)
  })

  it('an unknown param name throws at createSimulation with the available names', () => {
    expect(() => createSimulation(withYard({ strategy: 'nearest-wtp', params: { TIER_COST: 6 } }))).toThrow(
      /yardAllocation strategy "nearest-wtp" has no param "TIER_COST".*TIER_COST_M/,
    )
  })

  it('a param of a strategy that is not selected throws', () => {
    // MIXED_STACK_COST_M belongs to grouped, not nearest-wtp
    expect(() => createSimulation(withYard({ strategy: 'nearest-wtp', params: { MIXED_STACK_COST_M: 120 } }))).toThrow(
      /no param "MIXED_STACK_COST_M"/,
    )
    // the default strategy (grouped) is selected when none is named
    expect(() => createSimulation(withYard({ params: { MIXED_STACK_COST_M: 120 } }))).not.toThrow()
  })

  it('an out-of-range or non-numeric value throws', () => {
    expect(() => createSimulation(withYard({ strategy: 'nearest-wtp', params: { TIER_COST_M: -1 } }))).toThrow(
      /TIER_COST_M = -1 is out of range \[0, /,
    )
    expect(() => createSimulation(withYard({ strategy: 'nearest-wtp', params: { TIER_COST_M: Number.NaN } }))).toThrow(/TIER_COST_M/)
  })
})
