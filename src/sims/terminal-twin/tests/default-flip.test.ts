/**
 * Spec #106 (#114): the TOS defaults are `grouped` (yardAllocation), `iso-type-best-position` (emptyAllocation) and
 * `pod-weight` (vesselPlanning.ordering). Each old value stays selectable through config and the CLI (the rollback
 * path) and runs clean.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, DEFAULT_VESSEL_ORDERING, strategies, vesselOrderingOf, yardGroupingOn, type Simulation } from '../engine'
import { runCli } from '../cli/runCli'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

function run(config: ScenarioConfig): Simulation {
  const sim = createSimulation(config)
  sim.runUntil({ maxEvents: 400_000 })
  return sim
}

const withPoint = (config: ScenarioConfig, dp: 'yardAllocation' | 'emptyAllocation', strategy: string): ScenarioConfig => ({
  ...config,
  decisions: { ...config.decisions, points: { ...config.decisions?.points, [dp]: { strategy } } },
})

function expectClean(sim: Simulation, label: string) {
  expect(sim.firstError, label).toBeNull()
  expect(sim.invariantReport().violations, label).toEqual([])
}

describe('the flipped defaults', () => {
  it('names the new defaults', () => {
    expect(strategies.yardAllocation.default).toBe('grouped')
    expect(strategies.emptyAllocation.default).toBe('iso-type-best-position')
    expect(DEFAULT_VESSEL_ORDERING).toBe('pod-weight')
    expect(vesselOrderingOf({} as ScenarioConfig)).toBe('pod-weight')
  })

  it('an absent setting runs exactly like the explicit new value', () => {
    const base = fixtures['mixed-discharge-then-load']
    const absent = run(base)
    const explicit = run({
      ...withPoint(withPoint(base, 'yardAllocation', 'grouped'), 'emptyAllocation', 'iso-type-best-position'),
      vesselPlanning: { ordering: 'pod-weight' },
    })
    expect(explicit.eventLogHash()).toBe(absent.eventLogHash())
  })

  it('yardGroupingOn follows the default and the selection', () => {
    const base = fixtures['mixed-discharge-then-load']
    expect(yardGroupingOn(base)).toBe(true)
    expect(yardGroupingOn(withPoint(base, 'yardAllocation', 'nearest-wtp'))).toBe(false)
  })
})

describe('rolling a default back through config', () => {
  it('yardAllocation nearest-wtp runs clean and reports no grouping KPIs', () => {
    const base = fixtures['mixed-discharge-then-load']
    const def = run(base)
    const old = run(withPoint(base, 'yardAllocation', 'nearest-wtp'))
    expectClean(old, 'nearest-wtp')
    expect(old.kpiReport().yard?.grouping).toBeUndefined()
    expect(def.kpiReport().yard?.grouping).toBeDefined()
    expect(old.kpiReport().movesCompleted).toBe(def.kpiReport().movesCompleted)
  })

  it.each(['nearest-wtp', 'oldest-first'])('emptyAllocation %s runs clean and loads the same empties count', (name) => {
    const base = fixtures['empties-load-4-of-16']
    const old = run(withPoint(base, 'emptyAllocation', name))
    expectClean(old, name)
    expect(old.kpiReport().movesCompleted).toBe(run(base).kpiReport().movesCompleted)
  })

  it('vesselPlanning.ordering as-today runs clean and reports no ordering KPIs', () => {
    const base = fixtures['mixed-discharge-then-load']
    const old = run({ ...base, vesselPlanning: { ordering: 'as-today' } })
    expectClean(old, 'as-today')
    expect(old.kpiReport().ordering).toBeUndefined()
    expect(run(base).kpiReport().ordering).toBeDefined()
    expect(old.kpiReport().movesCompleted).toBe(run(base).kpiReport().movesCompleted)
  })
})

describe('rolling a default back through the CLI', () => {
  const ok = (args: string[]) => expect(runCli(['--fixture', 'tracer-1sts-10-boxes', ...args], () => {})).toBe(0)
  it('selects the old strategies and ordering', () => {
    ok(['--strategy', 'yardAllocation=nearest-wtp'])
    ok(['--strategy', 'emptyAllocation=nearest-wtp'])
    ok(['--strategy', 'emptyAllocation=oldest-first'])
    ok(['--ordering', 'as-today'])
  })
})
