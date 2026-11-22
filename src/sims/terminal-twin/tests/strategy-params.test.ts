/**
 * Strategy parameters (#312): `config.decisions.points.<dp>.params` tunes the selected built-in strategy.
 * Every built-in strategy declares its tunable constants; defaults equal the old constants, so a run without
 * params is unchanged. Unknown names, a param for a strategy that is not selected, or an out-of-range value throw
 * at createSimulation.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, strategies } from '../engine'
import { runCli } from '../cli/runCli'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'
import type { DecisionPointConfig } from '../engine'

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

describe('tt:run --param', () => {
  const cli = (...args: string[]) => {
    const out: string[] = []
    const exitCode = runCli(args, (line) => out.push(line))
    return { exitCode, text: out.join('\n') }
  }
  const hashOf = (text: string) => /hash\W+([0-9a-f]{8,})/i.exec(text)?.[1]
  const fx = ['--fixture', 'asc-1sts-10-boxes-1block', '--strategy', 'yardAllocation=nearest-wtp']

  it('sets a param of the selected strategy and changes the run', () => {
    const plain = cli(...fx)
    const same = cli(...fx, '--param', 'yardAllocation.TIER_COST_M=6')
    const tuned = cli(...fx, '--param', 'yardAllocation.TIER_COST_M=1000')
    expect([plain.exitCode, same.exitCode, tuned.exitCode]).toEqual([0, 0, 0])
    expect(hashOf(plain.text)).toBeDefined()
    expect(hashOf(same.text)).toBe(hashOf(plain.text))
    expect(hashOf(tuned.text)).not.toBe(hashOf(plain.text))
  })

  it('a bad --param is a usage error (exit 2)', () => {
    expect(cli(...fx, '--param', 'yardAllocation.TIER_COST_M').exitCode).toBe(2)
    expect(cli(...fx, '--param', 'yardAllocation.NOPE=1').exitCode).toBe(2)
    expect(cli(...fx, '--param', 'yardAllocation.TIER_COST_M=-5').exitCode).toBe(2)
    expect(cli(...fx, '--param', 'noSuchPoint.X=1').exitCode).toBe(2)
    expect(cli('--fixture', 'asc-1sts-10-boxes-1block', '--param', 'yardAllocation.MIXED_STACK_COST_M=120').exitCode).toBe(0)
  })
})

describe('engine-side params', () => {
  it('predispatchMarginS overrides queueAreas.predispatchMarginS only when set', () => {
    const fx = fixtures['shc-prepositioning']
    const point = fx.decisions?.points?.shcDispatch
    expect(point?.strategy).toBe('predispatch')
    const run = (params?: Record<string, number>) => {
      const sim = createSimulation({ ...fx, decisions: { ...fx.decisions, points: { ...fx.decisions?.points, shcDispatch: { ...point, params } } } })
      sim.runUntil()
      return sim.eventLogHash()
    }
    expect(run({ predispatchMarginS: 15 })).toBe(run())
    expect(run({ predispatchMarginS: 0 })).not.toBe(run())
  })
})
