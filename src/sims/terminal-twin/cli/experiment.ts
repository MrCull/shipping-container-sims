/**
 * Experiment runner core (spec #309): runs every config of an experiment file on every seed through an injectable
 * replicate executor, then compares each config with the baseline seed by seed (paired) and assembles an
 * `ExperimentReport`. No file or process work here beyond calling the executor; the CLI is `experimentCli.ts`.
 *
 * File format `terminal-twin-experiment` version 1; report format `terminal-twin-experiment-report` version 2
 * (version 2 added `guards`; version 1 had no guard results).
 */
import { arch, cpus } from 'node:os'
import {
  createSimulation,
  DECISION_POINT_IDS,
  ENGINE_VERSION,
  getStrategy,
  headlineKpis,
  summarizeRun,
  type DecisionPointId,
  type DecisionsConfig,
  type HandlerSet,
  type HeadlineKpis,
  type KpiReport,
  type RunSummary,
} from '../engine'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import type { ScenarioConfig } from '../scenario/types'

export const EXPERIMENT_FORMAT = 'terminal-twin-experiment'
export const EXPERIMENT_REPORT_FORMAT = 'terminal-twin-experiment-report'
export const EXPERIMENT_REPORT_VERSION = 2
export const DEFAULT_HORIZON_S = 86400
export const DEFAULT_SEED_COUNT = 10
/** Full invariant sweep every Nth event during experiments (incremental checks in between). */
export const EXPERIMENT_SWEEP_EVERY = 10000

export interface ExperimentConfig {
  name: string
  /** Built-in strategy per decision point. */
  strategies?: Record<string, string>
}

export interface ExperimentFile {
  format: typeof EXPERIMENT_FORMAT
  version: 1
  name: string
  description?: string
  base: { preset: string } | { fixture: string }
  /** Measured sim time per replicate (s), the replicate's end condition. Default 24 h. */
  horizonS?: number
  /** An explicit list or a count and first seed. Default 10 seeds from 1. */
  seeds?: number[] | { count: number; from?: number }
  /** The config every other config is compared with. Default the first config. */
  baseline?: string
  primary: { kpi: string }
  /** KPIs that must not get worse than a tolerance, absolute (KPI units) or percent of the baseline mean. */
  guards?: ExperimentGuard[]
  configs: ExperimentConfig[]
}

export interface ExperimentGuard {
  kpi: string
  tolerance: { abs: number } | { pct: number }
}

export type KpiDirection = 'higher' | 'lower'

/** What a catalogue KPI is read from: one replicate's headline KPIs, full KPI report and invariant count. */
export interface ReplicateKpiSource {
  headline: HeadlineKpis
  report: KpiReport
  invariantViolations: number
}

export interface ExperimentKpi {
  unit: string
  /** Which way is better. */
  direction: KpiDirection
  description: string
  /** Null when the KPI does not apply to the run (subsystem absent, nothing to average). */
  read: (src: ReplicateKpiSource) => number | null
}

const meanOrNull = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/** The experiment KPI catalogue (spec #309), in report order. */
export const EXPERIMENT_KPIS: Record<string, ExperimentKpi> = {
  grossMovesPerHour: {
    unit: 'moves/h',
    direction: 'higher',
    description: 'Gross crane productivity, summed over the STS cranes',
    read: ({ headline }) => headline.grossMovesPerHour,
  },
  netMovesPerHour: {
    unit: 'moves/h',
    direction: 'higher',
    description: 'Net crane productivity (working time only), summed over the STS cranes',
    read: ({ headline }) => headline.netMovesPerHour,
  },
  movesDone: {
    unit: 'moves',
    direction: 'higher',
    description: 'Container moves completed',
    read: ({ headline }) => headline.movesDone,
  },
  vesselsDone: {
    unit: 'vessels',
    direction: 'higher',
    description: 'Vessels completed',
    read: ({ headline }) => headline.vesselsDone,
  },
  meanVesselTurnaroundS: {
    unit: 's',
    direction: 'lower',
    description: 'Mean berth-to-departure time over the vessels that departed',
    read: ({ report }) => meanOrNull(Object.values(report.vessels).map((v) => v.turnaroundS)),
  },
  meanAnchorageWaitS: {
    unit: 's',
    direction: 'lower',
    description: 'Mean anchorage wait over the vessels allocated a berth',
    read: ({ report }) => meanOrNull(Object.values(report.vessels).map((v) => v.anchorageWaitS)),
  },
  truckTurnaroundS: {
    unit: 's',
    direction: 'lower',
    description: 'Mean truck turnaround, arrival at the gate to gate-out',
    read: ({ headline }) => headline.truckTurnaroundS,
  },
  shcEmptyTravelRatio: {
    unit: 'ratio',
    direction: 'lower',
    description: 'Empty share of SHC travel, mean over the SHCs',
    read: ({ headline }) => headline.shcEmptyTravelRatio,
  },
  shcBusyPct: {
    unit: '%',
    direction: 'lower',
    description: 'Share of time the SHCs spend moving, mean over the SHCs (lower: the same work with less driving)',
    read: ({ headline }) => headline.shcBusyPct,
  },
  ascUtilisationPct: {
    unit: '%',
    direction: 'lower',
    description: 'ASC utilisation, mean over the ASCs (lower: the same work with less crane time)',
    read: ({ headline }) => headline.ascUtilisationPct,
  },
  rehandlesPerProductiveMove: {
    unit: 'ratio',
    direction: 'lower',
    description: 'Yard rehandles (blocker moves) per productive ASC move',
    read: ({ report }) => report.yard?.rehandles.perProductiveMove ?? null,
  },
  equipmentIdleS: {
    unit: 'equipment s',
    direction: 'lower',
    description: 'Equipment idle time caused by waiting on decisions, summed over the decision points',
    read: ({ report }) => Object.values(report.handlers).reduce((a, h) => a + h.equipmentIdleS, 0),
  },
  invariantViolations: {
    unit: 'violations',
    direction: 'lower',
    description: 'Invariant violations (any makes the replicate invalid)',
    read: ({ invariantViolations }) => invariantViolations,
  },
}

/** Read every catalogue KPI from one replicate. */
export function readExperimentKpis(src: ReplicateKpiSource): Record<string, number | null> {
  const kpis: Record<string, number | null> = {}
  for (const [name, k] of Object.entries(EXPERIMENT_KPIS)) kpis[name] = k.read(src)
  return kpis
}

export class ExperimentError extends Error {}

export interface ReplicatePlan {
  config: string
  seed: number
  /** Fully resolved scenario (strategies, async mode, horizon as end condition); the seed is passed separately. */
  scenario: ScenarioConfig
  /** The `tt:run` command line that reproduces this replicate. */
  command: string
}

export interface ReplicateResult {
  /** One value per catalogue KPI; null when the KPI does not apply (subsystem absent). */
  kpis: Record<string, number | null>
  invariantViolations: number
  /** The run's first engine error, if any. */
  firstError: string | null
  wallMs: number
  summary?: RunSummary
  /** Set when the executor itself failed (the replicate is `invalid: error`). */
  error?: string
}

export type ReplicateStatus = 'ok' | 'invalid: invariant' | 'invalid: failed' | 'invalid: error'
export type Verdict = 'better' | 'worse' | 'no difference detected' | 'insufficient data'
export type GuardStatus = 'held' | 'breached' | 'uncertain' | 'insufficient data'

export interface GuardResult {
  status: GuardStatus
  /** The tolerance in KPI units (a percent tolerance is taken of the baseline mean); null without a baseline mean. */
  toleranceAbs: number | null
  /** 95% CI of the degradation (config minus baseline, signed so positive is worse). */
  degradationCi: [number, number] | null
}

export interface MeanCi {
  n: number
  mean: number | null
  ci: [number, number] | null
}

export interface Comparison {
  config: string
  kpi: string
  direction: KpiDirection
  /** Valid pairs with a non-null KPI on both sides. */
  n: number
  meanDiff: number | null
  sdDiff: number | null
  ci: [number, number] | null
  /** meanDiff against the baseline mean, in %. */
  relativeChangePct: number | null
  /** The baseline's own mean and CI over its valid replicates. */
  baseline: MeanCi
  /** This config's own mean and CI over its valid replicates. */
  configStats: MeanCi
  verdict: Verdict
}

export interface ExperimentReport {
  format: typeof EXPERIMENT_REPORT_FORMAT
  version: typeof EXPERIMENT_REPORT_VERSION
  experiment: ExperimentFile
  expanded: { configs: ExperimentConfig[]; baseline: string; seeds: number[]; horizonS: number }
  provenance: {
    engineVersion: string
    commit: string | null
    node: string
    cpu: string
    /** Timing fields: the only fields that differ between two runs of the same experiment. */
    startedAt: string
    endedAt: string
  }
  replicates: {
    config: string
    seed: number
    status: ReplicateStatus
    /** Timing field. */
    wallMs: number
    kpis: Record<string, number | null>
    invariantViolations: number
    firstError: string | null
    command: string
  }[]
  comparisons: Comparison[]
  primary: { kpi: string; direction: KpiDirection; verdicts: Record<string, Verdict> }
  /** One entry per guard of the file, with a result per non-baseline config. */
  guards: (ExperimentGuard & { direction: KpiDirection; statuses: Record<string, GuardResult> })[]
  droppedSeeds: { config: string; seed: number; reason: string }[]
  notes: string[]
}

export interface RunExperimentOptions {
  executeReplicate?: (plan: ReplicatePlan) => ReplicateResult
  /** Called after each replicate. */
  onProgress?: (done: number, total: number) => void
  /** Provenance the caller knows (the core does no process work). */
  commit?: string | null
}

const T_975 = [
  12.7062, 4.3027, 3.1824, 2.7764, 2.5706, 2.4469, 2.3646, 2.306, 2.2622, 2.2281, 2.201, 2.1788, 2.1604, 2.1448, 2.1314,
  2.1199, 2.1098, 2.1009, 2.093, 2.086, 2.0796, 2.0739, 2.0687, 2.0639, 2.0595, 2.0555, 2.0518, 2.0484, 2.0452, 2.0423,
]

/** Two-sided 95% quantile of Student's t with `df` degrees of freedom. */
function t975(df: number): number {
  if (df <= T_975.length) return T_975[df - 1]
  const z = 1.959964
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df)
}

function meanCi(xs: number[]): MeanCi & { sd: number | null } {
  const n = xs.length
  if (n === 0) return { n, mean: null, ci: null, sd: null }
  const mean = xs.reduce((a, b) => a + b, 0) / n
  if (n < 2) return { n, mean, ci: null, sd: null }
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1))
  const half = (t975(n - 1) * sd) / Math.sqrt(n)
  return { n, mean, ci: [mean - half, mean + half], sd }
}

function verdictOf(ci: [number, number] | null, direction: KpiDirection): Verdict {
  if (!ci) return 'insufficient data'
  const [lo, hi] = ci
  if (lo > 0) return direction === 'higher' ? 'better' : 'worse'
  if (hi < 0) return direction === 'higher' ? 'worse' : 'better'
  return 'no difference detected'
}

function guardResult(c: Comparison, tolerance: ExperimentGuard['tolerance']): GuardResult {
  const toleranceAbs =
    'abs' in tolerance ? tolerance.abs : c.baseline.mean === null ? null : (Math.abs(c.baseline.mean) * tolerance.pct) / 100
  const degradationCi: [number, number] | null = !c.ci ? null : c.direction === 'lower' ? [c.ci[0], c.ci[1]] : [-c.ci[1], -c.ci[0]]
  if (!degradationCi || toleranceAbs === null) return { status: 'insufficient data', toleranceAbs, degradationCi }
  const status: GuardStatus = degradationCi[1] <= toleranceAbs ? 'held' : degradationCi[0] > toleranceAbs ? 'breached' : 'uncertain'
  return { status, toleranceAbs, degradationCi }
}

function validateGuards(guards: unknown): void {
  if (guards === undefined) return
  if (!Array.isArray(guards)) throw new ExperimentError('"guards" must be a list')
  for (const g of guards as ExperimentGuard[]) {
    if (!EXPERIMENT_KPIS[g?.kpi])
      throw new ExperimentError(`Guard: Unknown KPI "${g?.kpi}" (available: ${Object.keys(EXPERIMENT_KPIS).join(', ')})`)
    const t = g.tolerance as Record<string, unknown> | undefined
    const keys = t && typeof t === 'object' ? Object.keys(t) : []
    const value = keys.length === 1 ? t![keys[0]] : undefined
    if (!(keys.length === 1 && (keys[0] === 'abs' || keys[0] === 'pct') && typeof value === 'number' && value >= 0))
      throw new ExperimentError(`Guard "${g.kpi}": "tolerance" must be { "abs": <n >= 0> } or { "pct": <n >= 0> }`)
  }
}

function resolveSeeds(seeds: ExperimentFile['seeds']): number[] {
  if (seeds === undefined) return Array.from({ length: DEFAULT_SEED_COUNT }, (_, i) => i + 1)
  if (Array.isArray(seeds)) {
    if (seeds.length === 0 || !seeds.every(Number.isInteger)) throw new ExperimentError('"seeds" must be a non-empty list of integers')
    return seeds
  }
  const from = seeds.from ?? 1
  if (!Number.isInteger(seeds.count) || seeds.count < 1 || !Number.isInteger(from))
    throw new ExperimentError('"seeds" must be { "count": <n >= 1>, "from": <integer> }')
  return Array.from({ length: seeds.count }, (_, i) => from + i)
}

function resolveBase(base: ExperimentFile['base']): { scenario: ScenarioConfig; flag: string } {
  if (base && 'preset' in base) {
    const build = presets[base.preset]
    if (!build) throw new ExperimentError(`Unknown preset "${base.preset}" (available: ${Object.keys(presets).join(', ')})`)
    return { scenario: build(), flag: `--preset ${JSON.stringify(base.preset)}` }
  }
  if (base && 'fixture' in base) {
    const scenario = fixtures[base.fixture]
    if (!scenario) throw new ExperimentError(`Unknown fixture "${base.fixture}" (available: ${Object.keys(fixtures).join(', ')})`)
    return { scenario, flag: `--fixture ${base.fixture}` }
  }
  throw new ExperimentError('"base" must be { "preset": <name> } or { "fixture": <name> }')
}

/** Validate an experiment file; throws `ExperimentError` with a readable message. */
export function validateExperiment(file: ExperimentFile): void {
  if (!file || typeof file !== 'object') throw new ExperimentError('The experiment file must be a JSON object')
  if (file.format !== EXPERIMENT_FORMAT) throw new ExperimentError(`"format" must be "${EXPERIMENT_FORMAT}"`)
  if (file.version !== 1) throw new ExperimentError('"version" must be 1')
  if (typeof file.name !== 'string' || !file.name) throw new ExperimentError('"name" is required')
  if (file.horizonS !== undefined && !(typeof file.horizonS === 'number' && file.horizonS > 0))
    throw new ExperimentError('"horizonS" must be a positive number')
  const kpi = file.primary?.kpi
  if (!EXPERIMENT_KPIS[kpi])
    throw new ExperimentError(`Unknown KPI "${kpi}" (available: ${Object.keys(EXPERIMENT_KPIS).join(', ')})`)
  validateGuards(file.guards)
  if (!Array.isArray(file.configs) || file.configs.length === 0) throw new ExperimentError('"configs" must list at least one config')
  const names = new Set<string>()
  for (const c of file.configs) {
    if (typeof c?.name !== 'string' || !c.name) throw new ExperimentError('Every config needs a "name"')
    if (names.has(c.name)) throw new ExperimentError(`Config name "${c.name}" is used twice`)
    names.add(c.name)
    const allowed = new Set(['name', 'strategies'])
    for (const key of Object.keys(c))
      if (!allowed.has(key)) throw new ExperimentError(`Config "${c.name}": "${key}" is not supported yet (only "strategies")`)
    for (const [dp, strategy] of Object.entries(c.strategies ?? {})) {
      if (!DECISION_POINT_IDS.includes(dp as DecisionPointId))
        throw new ExperimentError(`Config "${c.name}": Unknown decision point "${dp}" (decision points: ${DECISION_POINT_IDS.join(', ')})`)
      try {
        getStrategy(dp as DecisionPointId, strategy)
      } catch (err) {
        throw new ExperimentError(`Config "${c.name}": ${(err as Error).message}`)
      }
    }
  }
  if (file.baseline !== undefined && !names.has(file.baseline))
    throw new ExperimentError(`Baseline "${file.baseline}" is not one of the configs (${[...names].join(', ')})`)
  resolveSeeds(file.seeds)
  resolveBase(file.base)
}

function buildScenario(base: ScenarioConfig, config: ExperimentConfig, horizonS: number): ScenarioConfig {
  const points = { ...base.decisions?.points } as NonNullable<DecisionsConfig['points']>
  for (const [dp, strategy] of Object.entries(config.strategies ?? {}))
    points[dp as DecisionPointId] = { ...points[dp as DecisionPointId], strategy }
  return {
    ...base,
    endConditions: { simDurationS: horizonS },
    decisions: { ...base.decisions, asyncMode: 'pause', points },
  }
}

function commandFor(baseFlag: string, config: ExperimentConfig, seed: number, horizonS: number): string {
  const parts = ['pnpm run tt:run', baseFlag, `--seed ${seed}`, '--async-mode pause', '--no-fail-fast', `--end time:${horizonS}`]
  for (const [dp, s] of Object.entries(config.strategies ?? {})) parts.push(`--strategy ${dp}=${s}`)
  return parts.join(' ')
}

/**
 * The default executor: runs the engine headless as `tt:run` does, with sparse invariant sweeps. `handlers` replaces
 * decision-point handlers (tests use a deliberately broken set to prove invalid replicates).
 */
export function executeReplicateHeadless(plan: ReplicatePlan, handlers: Partial<HandlerSet> = {}): ReplicateResult {
  const started = performance.now()
  try {
    const sim = createSimulation(plan.scenario, handlers, {
      seed: plan.seed,
      asyncMode: 'pause',
      invariants: { failFast: false, sweepEvery: EXPERIMENT_SWEEP_EVERY },
    })
    sim.runUntil({})
    const summary = summarizeRun(sim)
    const report = sim.kpiReport()
    const headline = headlineKpis(sim.kpiSeries(), report)
    const invariantViolations = summary.invariants.violations
    return {
      kpis: readExperimentKpis({ headline, report, invariantViolations }),
      invariantViolations,
      firstError: summary.firstError ? summary.firstError.message : null,
      wallMs: Math.round(performance.now() - started),
      summary,
    }
  } catch (err) {
    return {
      kpis: {},
      invariantViolations: 0,
      firstError: null,
      wallMs: Math.round(performance.now() - started),
      error: (err as Error).message,
    }
  }
}

function classify(r: ReplicateResult): ReplicateStatus {
  if (r.error) return 'invalid: error'
  if (r.firstError) return 'invalid: failed'
  if (r.invariantViolations > 0) return 'invalid: invariant'
  return 'ok'
}

/** Run an experiment in process and return its report. Throws `ExperimentError` for an invalid file. */
export function runExperiment(file: ExperimentFile, options: RunExperimentOptions = {}): ExperimentReport {
  validateExperiment(file)
  const startedAt = new Date().toISOString()
  const execute = options.executeReplicate ?? executeReplicateHeadless
  const horizonS = file.horizonS ?? DEFAULT_HORIZON_S
  const seeds = resolveSeeds(file.seeds)
  const baseline = file.baseline ?? file.configs[0].name
  const base = resolveBase(file.base)

  const replicates: ExperimentReport['replicates'] = []
  const total = file.configs.length * seeds.length
  for (const config of file.configs) {
    const scenario = buildScenario(base.scenario, config, horizonS)
    for (const seed of seeds) {
      const command = commandFor(base.flag, config, seed, horizonS)
      let result: ReplicateResult
      try {
        result = execute({ config: config.name, seed, scenario, command })
      } catch (err) {
        result = { kpis: {}, invariantViolations: 0, firstError: null, wallMs: 0, error: (err as Error).message }
      }
      replicates.push({
        config: config.name,
        seed,
        status: classify(result),
        wallMs: result.wallMs,
        kpis: result.kpis,
        invariantViolations: result.invariantViolations,
        firstError: result.error ?? result.firstError,
        command,
      })
      options.onProgress?.(replicates.length, total)
    }
  }

  const byKey = new Map(replicates.map((r) => [`${r.config}\u0000${r.seed}`, r]))
  const valid = (config: string, seed: number) => {
    const r = byKey.get(`${config}\u0000${seed}`)
    return r && r.status === 'ok' ? r : undefined
  }
  const droppedSeeds: ExperimentReport['droppedSeeds'] = []
  const comparisons: ExperimentReport['comparisons'] = []
  const primaryKpi = EXPERIMENT_KPIS[file.primary.kpi]
  const verdicts: Record<string, Verdict> = {}
  for (const config of file.configs) {
    if (config.name === baseline) continue
    for (const seed of seeds) {
      const a = byKey.get(`${baseline}\u0000${seed}`)!
      const b = byKey.get(`${config.name}\u0000${seed}`)!
      if (a.status !== 'ok' || b.status !== 'ok')
        droppedSeeds.push({ config: config.name, seed, reason: a.status !== 'ok' ? `baseline ${a.status}` : b.status })
    }
    for (const [kpi, k] of Object.entries(EXPERIMENT_KPIS)) {
      const diffs: number[] = []
      const baseValues: number[] = []
      const configValues: number[] = []
      for (const seed of seeds) {
        const a = valid(baseline, seed)?.kpis[kpi]
        const b = valid(config.name, seed)?.kpis[kpi]
        if (a !== undefined && a !== null) baseValues.push(a)
        if (b !== undefined && b !== null) configValues.push(b)
        if (a !== undefined && a !== null && b !== undefined && b !== null) diffs.push(b - a)
      }
      const d = meanCi(diffs)
      const baseStats = meanCi(baseValues)
      const verdict = verdictOf(d.ci, k.direction)
      comparisons.push({
        config: config.name,
        kpi,
        direction: k.direction,
        n: d.n,
        meanDiff: d.mean,
        sdDiff: d.sd,
        ci: d.ci,
        relativeChangePct: d.mean !== null && baseStats.mean ? (d.mean / baseStats.mean) * 100 : null,
        baseline: { n: baseStats.n, mean: baseStats.mean, ci: baseStats.ci },
        configStats: (({ n, mean, ci }) => ({ n, mean, ci }))(meanCi(configValues)),
        verdict,
      })
      if (kpi === file.primary.kpi) verdicts[config.name] = verdict
    }
  }

  const guards: ExperimentReport['guards'] = (file.guards ?? []).map((g) => {
    const statuses: Record<string, GuardResult> = {}
    for (const c of comparisons) if (c.kpi === g.kpi) statuses[c.config] = guardResult(c, g.tolerance)
    return { kpi: g.kpi, tolerance: g.tolerance, direction: EXPERIMENT_KPIS[g.kpi].direction, statuses }
  })

  const notes: string[] = []
  if (file.configs.length > 2)
    notes.push('No correction for multiple comparisons: with many configs, expect some false "better" or "worse" verdicts.')
  return {
    format: EXPERIMENT_REPORT_FORMAT,
    version: EXPERIMENT_REPORT_VERSION,
    experiment: file,
    expanded: { configs: file.configs, baseline, seeds, horizonS },
    provenance: {
      engineVersion: ENGINE_VERSION,
      commit: options.commit ?? null,
      node: process.version,
      cpu: `${cpus()[0]?.model ?? 'unknown'} (${cpus().length} cores, ${arch()})`,
      startedAt,
      endedAt: new Date().toISOString(),
    },
    replicates,
    comparisons,
    primary: { kpi: file.primary.kpi, direction: primaryKpi.direction, verdicts },
    guards,
    droppedSeeds,
    notes,
  }
}
