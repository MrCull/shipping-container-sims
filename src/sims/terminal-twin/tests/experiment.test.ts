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
    expect(report.version).toBe(2)
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

describe('runExperiment: KPI catalogue, guards and invalid replicates (fake executor)', () => {
  const CATALOGUE = [
    'grossMovesPerHour',
    'netMovesPerHour',
    'movesDone',
    'vesselsDone',
    'meanVesselTurnaroundS',
    'meanAnchorageWaitS',
    'truckTurnaroundS',
    'shcEmptyTravelRatio',
    'shcBusyPct',
    'ascUtilisationPct',
    'rehandlesPerProductiveMove',
    'equipmentIdleS',
    'invariantViolations',
  ]

  it('reports every catalogue KPI for every config, and a null KPI is not comparable', () => {
    const report = runExperiment(experiment({ configs: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }), {
      executeReplicate: fake({
        grossMovesPerHour: { A: [10, 10, 10, 10], B: [11, 12, 13, 14], C: [10, 11, 10, 11] },
        // Absent subsystem on C: no values at all.
        ascUtilisationPct: { A: [50, 51, 52, 53], B: [50, 50, 50, 50] },
      } as never),
    })
    for (const config of ['B', 'C'])
      expect(report.comparisons.filter((c) => c.config === config).map((c) => c.kpi)).toEqual(CATALOGUE)
    const asc = comparison(report, 'C', 'ascUtilisationPct')
    expect(asc.n).toBe(0)
    expect(asc.verdict).toBe('insufficient data')
    expect(asc.configStats.mean).toBeNull()
    expect(comparison(report, 'B', 'ascUtilisationPct').n).toBe(4)
  })

  // Baseline A is 100 on every seed, so a 5 % tolerance is 5 absolute units. Degradation per seed (positive = worse):
  // held 1, 2, 1, 2 (CI about [0.58, 2.42]); breached 10, 11, 10, 11 (about [10.58, 11.42]); uncertain 1, 10, 1, 10
  // (about [-2.77, 13.77]).
  const DEGRADATION = { held: [1, 2, 1, 2], breached: [10, 11, 10, 11], uncertain: [1, 10, 1, 10] }
  it.each(
    (['held', 'breached', 'uncertain'] as const).flatMap((status) =>
      [{ abs: 5 }, { pct: 5 }].flatMap((tolerance) =>
        (
          [
            ['grossMovesPerHour', -1],
            ['truckTurnaroundS', 1],
          ] as const
        ).map(([kpi, sign]) => [status, kpi, sign, tolerance] as const),
      ),
    ),
  )('guard %s on %s (worse sign %d) with tolerance %j', (status, kpi, sign, tolerance) => {
    const report = runExperiment(experiment({ guards: [{ kpi, tolerance }] }), {
      executeReplicate: fake({
        [kpi]: { A: [100, 100, 100, 100], B: DEGRADATION[status].map((x) => 100 + sign * x) },
      } as never),
    })
    expect(report.guards).toHaveLength(1)
    expect(report.guards[0]).toMatchObject({ kpi, tolerance })
    expect(report.guards[0].statuses.B.status).toBe(status)
    expect(report.guards[0].statuses.B.toleranceAbs).toBeCloseTo(5, 9)
  })

  it('a guard with fewer than 2 pairs is insufficient data', () => {
    const report = runExperiment(experiment({ seeds: [1], guards: [{ kpi: 'truckTurnaroundS', tolerance: { abs: 1 } }] }), {
      executeReplicate: fake({ truckTurnaroundS: { A: [100], B: [100] } } as never),
    })
    expect(report.guards[0].statuses.B.status).toBe('insufficient data')
  })

  it('rejects an unknown guard KPI or a bad tolerance', () => {
    expect(() => runExperiment(experiment({ guards: [{ kpi: 'mood', tolerance: { abs: 1 } }] }))).toThrow(/Unknown KPI "mood"/)
    expect(() => runExperiment(experiment({ guards: [{ kpi: 'truckTurnaroundS', tolerance: { abs: -1 } }] }))).toThrow(
      /tolerance/,
    )
    expect(() =>
      runExperiment(experiment({ guards: [{ kpi: 'truckTurnaroundS', tolerance: { abs: 1, pct: 2 } as never }] })),
    ).toThrow(/tolerance/)
  })

  it('marks invariant, failed and error replicates invalid, drops their seeds from pairing and carries on', () => {
    const base = fake({ grossMovesPerHour: { A: [10, 10, 10, 10], B: [11, 12, 13, 14] } } as never)
    const report = runExperiment(experiment(), {
      executeReplicate: (plan) => {
        if (plan.config === 'B' && plan.seed === 1) return { ...base(plan), invariantViolations: 2 }
        if (plan.config === 'A' && plan.seed === 2) return { ...base(plan), firstError: 'event #7: stuck' }
        if (plan.config === 'B' && plan.seed === 3) throw new Error('worker died')
        return base(plan)
      },
    })
    expect(report.replicates).toHaveLength(8)
    const replicate = (config: string, seed: number) => report.replicates.find((r) => r.config === config && r.seed === seed)!
    expect(replicate('B', 1).status).toBe('invalid: invariant')
    expect(replicate('A', 2).status).toBe('invalid: failed')
    expect(replicate('B', 3)).toMatchObject({ status: 'invalid: error', firstError: 'worker died' })
    expect(report.droppedSeeds).toEqual([
      { config: 'B', seed: 1, reason: 'invalid: invariant' },
      { config: 'B', seed: 2, reason: 'baseline invalid: failed' },
      { config: 'B', seed: 3, reason: 'invalid: error' },
    ])
    const c = comparison(report, 'B', 'grossMovesPerHour')
    expect(c.n).toBe(1)
    expect(c.verdict).toBe('insufficient data')
    expect(report.primary.verdicts.B).toBe('insufficient data')
  })

  it('adds the multiple-comparison notice only with more than two configs', () => {
    const executeReplicate = fake({ grossMovesPerHour: { A: [1, 2, 3, 4], B: [1, 2, 3, 4], C: [1, 2, 3, 4] } } as never)
    const notice = /multiple comparisons/
    expect(runExperiment(experiment(), { executeReplicate }).notes.some((n) => notice.test(n))).toBe(false)
    const three = runExperiment(experiment({ configs: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }), { executeReplicate })
    expect(three.notes.some((n) => notice.test(n))).toBe(true)
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
