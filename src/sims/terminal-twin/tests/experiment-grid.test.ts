import { describe, expect, it } from 'vitest'
import { runExperiment, type ExperimentFile, type ReplicatePlan, type ReplicateResult } from '../cli/experiment'

/** Records every plan; KPIs are constant, so no engine runs. */
function recorder() {
  const plans: ReplicatePlan[] = []
  const executeReplicate = (plan: ReplicatePlan): ReplicateResult => {
    plans.push(plan)
    return { kpis: { grossMovesPerHour: 10 }, invariantViolations: 0, firstError: null, wallMs: 1 }
  }
  return { plans, executeReplicate }
}

function experiment(over: Partial<ExperimentFile> = {}): ExperimentFile {
  return {
    format: 'terminal-twin-experiment',
    version: 1,
    name: 'Grid study',
    base: { fixture: 'shc-paired-dual-cycle' },
    horizonS: 3600,
    seeds: [1],
    primary: { kpi: 'grossMovesPerHour' },
    configs: [{ name: 'A' }],
    ...over,
  }
}

describe('experiment config overrides and grid (seam B)', () => {
  it('expands a 2 x 2 grid plus one explicit config into 5 named, resolved scenarios', () => {
    const { plans, executeReplicate } = recorder()
    const report = runExperiment(
      experiment({
        grid: {
          factors: {
            'strategies.yardAllocation': ['nearest-wtp', 'grouped'],
            'params.shcDispatch.PAIRING_RADIUS_M': [0, 500],
          },
        },
      }),
      { executeReplicate },
    )
    const names = [
      'A',
      'yardAllocation=nearest-wtp,shcDispatch.PAIRING_RADIUS_M=0',
      'yardAllocation=nearest-wtp,shcDispatch.PAIRING_RADIUS_M=500',
      'yardAllocation=grouped,shcDispatch.PAIRING_RADIUS_M=0',
      'yardAllocation=grouped,shcDispatch.PAIRING_RADIUS_M=500',
    ]
    expect(report.expanded.configs.map((c) => c.name)).toEqual(names)
    expect(plans.map((p) => p.config)).toEqual(names)
    const grouped500 = plans[4].scenario.decisions!.points!
    expect(grouped500.yardAllocation).toMatchObject({ strategy: 'grouped' })
    expect(grouped500.shcDispatch).toMatchObject({ strategy: 'paired-dual-cycle', params: { PAIRING_RADIUS_M: 500 } })
    expect(plans[0].scenario.decisions!.points!.shcDispatch!.params).toBeUndefined()
    expect(plans[4].command).toContain('--strategy yardAllocation=grouped')
    expect(plans[4].command).toContain('--param shcDispatch.PAIRING_RADIUS_M=500')
  })

  it('applies a JSON Merge Patch, a latency shorthand and a patch grid factor', () => {
    const { plans, executeReplicate } = recorder()
    runExperiment(
      experiment({
        configs: [
          { name: 'A' },
          { name: 'B', patch: { shcs: [{ id: 'SHC01' }], moveVariationPct: null }, latency: { shcDispatch: 'fixed:200,timeoutMs:5000' } },
        ],
        grid: { factors: { 'patch.quay.mooringS': [30, 90] } },
      }),
      { executeReplicate },
    )
    const b = plans.find((p) => p.config === 'B')!.scenario
    expect(b.shcs).toEqual([{ id: 'SHC01' }])
    expect('moveVariationPct' in b).toBe(false)
    expect(b.decisions!.points!.shcDispatch).toMatchObject({
      strategy: 'paired-dual-cycle',
      latency: { delay: { kind: 'fixed', ms: 200 } },
      timeoutMs: 5000,
    })
    expect(b.endConditions).toEqual({ simDurationS: 3600 })
    const g = plans.find((p) => p.config === 'quay.mooringS=90')!.scenario
    expect(g.quay.mooringS).toBe(90)
    expect(g.quay.lengthM).toBe(500)
  })

  it.each([
    ['an unknown decision point', { name: 'X', params: { nope: { a: 1 } } }, /Config "X": params\.nope: Unknown decision point "nope"/],
    ['an unknown strategy', { name: 'X', strategies: { shcDispatch: 'nope' } }, /Config "X": strategies\.shcDispatch: .*nope/],
    ['an unknown param', { name: 'X', params: { shcDispatch: { NOPE: 1 } } }, /Config "X": params\.shcDispatch\.NOPE: .*has no param "NOPE"/],
    ['an out-of-range param', { name: 'X', params: { shcDispatch: { PAIRING_RADIUS_M: -5 } } }, /Config "X": params\.shcDispatch\.PAIRING_RADIUS_M: .*out of range/],
    ['a bad latency spec', { name: 'X', latency: { shcDispatch: 'slow' } }, /Config "X": latency\.shcDispatch: Bad latency spec "slow"/],
    ['a patch that makes an invalid scenario', { name: 'X', patch: { quay: { lengthM: 5 } } }, /Config "X": patch: Invalid scenario/],
    ['a patch that sets end conditions', { name: 'X', patch: { endConditions: { vesselsCompleted: 1 } } }, /Config "X": patch\.endConditions: /],
  ] as const)('reports %s before any replicate runs', (_label, config, message) => {
    const { plans, executeReplicate } = recorder()
    expect(() => runExperiment(experiment({ configs: [{ name: 'A' }, config as never] }), { executeReplicate })).toThrow(message)
    expect(plans).toHaveLength(0)
  })

  it('reports a duplicate name between an explicit and a grid config, and an unknown grid factor', () => {
    const { plans, executeReplicate } = recorder()
    expect(() =>
      runExperiment(experiment({ configs: [{ name: 'shcDispatch=chained-nearest' }], grid: { factors: { 'strategies.shcDispatch': ['chained-nearest'] } } }), {
        executeReplicate,
      }),
    ).toThrow(/Config name "shcDispatch=chained-nearest" is used twice/)
    expect(() => runExperiment(experiment({ grid: { factors: { 'speed.x': [1] } } }), { executeReplicate })).toThrow(
      /Grid factor "speed\.x"/,
    )
    expect(plans).toHaveLength(0)
  })
})

describe('experiment overrides change KPIs (seam B, real executor)', () => {
  it('a patch to one SHC and a params change each move the KPIs', () => {
    const report = runExperiment(
      experiment({
        horizonS: 2400,
        configs: [
          { name: 'A' },
          { name: 'one-shc', patch: { shcs: [{ id: 'SHC01' }] } },
          { name: 'no-pairing', params: { shcDispatch: { PAIRING_RADIUS_M: 0 } } },
        ],
      }),
    )
    const kpi = (config: string, k: string) => report.replicates.find((r) => r.config === config)!.kpis[k]!
    expect(report.replicates.every((r) => r.status === 'ok')).toBe(true)
    // One SHC instead of three: fewer moves in the same 40 minutes.
    expect(kpi('one-shc', 'movesDone')).toBeLessThan(kpi('A', 'movesDone'))
    // No pairing: the SHC empty-travel share changes (the dispatch picks the nearest job, not the paired one).
    expect(kpi('no-pairing', 'shcEmptyTravelRatio')).not.toBe(kpi('A', 'shcEmptyTravelRatio'))
  })
})
