import { describe, expect, it } from 'vitest'
import {
  ExperimentError,
  runExperiment,
  type ExperimentFile,
  type ExperimentReport,
  type ReplicatePlan,
  type ReplicateResult,
} from '../cli/experiment'

/** A fake executor: KPI values per config per seed, no engine run. */
function fake(values: Record<string, Record<string, number[]>>) {
  return (plan: ReplicatePlan): ReplicateResult => {
    const kpis: Record<string, number | null> = {}
    for (const [kpi, byConfig] of Object.entries(values)) {
      const list = (byConfig as unknown as Record<string, number[]>)[plan.config]
      kpis[kpi] = list ? list[plan.seed - 1] : null
    }
    return { kpis, invariantViolations: 0, firstError: null, wallMs: 1 }
  }
}

function experiment(over: Partial<ExperimentFile> = {}): ExperimentFile {
  return {
    format: 'terminal-twin-experiment',
    version: 1,
    name: 'Fake study',
    base: { fixture: 'tracer-1sts-10-boxes' },
    horizonS: 3600,
    seeds: { count: 4, from: 1 },
    primary: { kpi: 'grossMovesPerHour' },
    configs: [{ name: 'A' }, { name: 'B', strategies: { stsGroundPosition: 'lowest-free-lane' } }],
    ...over,
  }
}

const comparison = (r: ExperimentReport, config: string, kpi: string) => r.comparisons.find((c) => c.config === config && c.kpi === kpi)!

describe('runExperiment (fake executor)', () => {
  it('computes the paired mean difference, SD and Student-t 95% CI by hand', () => {
    // Differences B - A per seed: 1, 2, 3, 4. Mean 2.5, SD sqrt(5/3) = 1.29099, t(0.975, 3) = 3.18245,
    // half width 3.18245 * 1.29099 / 2 = 2.05426.
    const report = runExperiment(experiment(), {
      executeReplicate: fake({ grossMovesPerHour: { A: [10, 10, 10, 10], B: [11, 12, 13, 14] } } as never),
    })
    const c = comparison(report, 'B', 'grossMovesPerHour')
    expect(c.n).toBe(4)
    expect(c.meanDiff).toBeCloseTo(2.5, 6)
    expect(c.sdDiff).toBeCloseTo(1.29099, 4)
    expect(c.ci![0]).toBeCloseTo(0.44574, 3)
    expect(c.ci![1]).toBeCloseTo(4.55426, 3)
    expect(c.relativeChangePct).toBeCloseTo(25, 6)
    expect(c.baseline.mean).toBe(10)
    expect(c.configStats.mean).toBe(12.5)
    expect(c.configStats.ci![0]).toBeCloseTo(12.5 - 2.05426, 3)
    expect(report.format).toBe('terminal-twin-experiment-report')
    expect(report.version).toBe(1)
    expect(report.primary).toMatchObject({ kpi: 'grossMovesPerHour', direction: 'higher', verdicts: { B: 'better' } })
  })

  it.each([
    // [kpi, B values, verdict]; A is 10 on every seed.
    ['grossMovesPerHour', [11, 12, 13, 14], 'better'],
    ['grossMovesPerHour', [9, 8, 7, 6], 'worse'],
    ['grossMovesPerHour', [12, 8, 11, 9], 'no difference detected'],
    ['truckTurnaroundS', [11, 12, 13, 14], 'worse'],
    ['truckTurnaroundS', [9, 8, 7, 6], 'better'],
    ['truckTurnaroundS', [12, 8, 11, 9], 'no difference detected'],
  ] as const)('primary %s with B = %j reads %s', (kpi, b, verdict) => {
    const report = runExperiment(experiment({ primary: { kpi } }), {
      executeReplicate: fake({ [kpi]: { A: [10, 10, 10, 10], B: [...b] } } as never),
    })
    expect(report.primary.verdicts.B).toBe(verdict)
    expect(comparison(report, 'B', kpi).verdict).toBe(verdict)
  })

  it('rejects an unknown KPI, strategy or decision point before running anything', () => {
    let calls = 0
    const executeReplicate = () => {
      calls++
      return { kpis: {}, invariantViolations: 0, firstError: null, wallMs: 0 }
    }
    expect(() => runExperiment(experiment({ primary: { kpi: 'happiness' } }), { executeReplicate })).toThrow(
      /Unknown KPI "happiness"/,
    )
    expect(() =>
      runExperiment(experiment({ configs: [{ name: 'A' }, { name: 'B', strategies: { stsGroundPosition: 'nope' } }] }), {
        executeReplicate,
      }),
    ).toThrow(ExperimentError)
    expect(() =>
      runExperiment(experiment({ configs: [{ name: 'A', strategies: { notAPoint: 'x' } }] }), { executeReplicate }),
    ).toThrow(/Unknown decision point "notAPoint"/)
    expect(calls).toBe(0)
  })
})

describe('runExperiment (real executor)', () => {
  const tiny = experiment({
    horizonS: 3600,
    seeds: [1, 2, 3],
    configs: [{ name: 'A' }, { name: 'B', strategies: { shcDispatch: 'oldest-job' } }],
  })
  const strip = (r: ExperimentReport) => ({
    ...r,
    provenance: { ...r.provenance, startedAt: '', endedAt: '' },
    replicates: r.replicates.map((x) => ({ ...x, wallMs: 0 })),
  })

  it('runs 2 configs x 3 seeds on the tracer fixture and gives the same report twice, timing aside', () => {
    const first = runExperiment(tiny)
    expect(first.replicates).toHaveLength(6)
    expect(first.replicates.map((r) => r.status)).toEqual(Array(6).fill('ok'))
    expect(first.replicates[0].kpis.grossMovesPerHour).toBeGreaterThan(0)
    expect(first.replicates[0].command).toBe(
      'pnpm run tt:run --fixture tracer-1sts-10-boxes --seed 1 --async-mode pause --no-fail-fast --end time:3600',
    )
    expect(first.primary.verdicts.B).toBeDefined()
    expect(strip(runExperiment(tiny))).toEqual(strip(first))
  })
})
