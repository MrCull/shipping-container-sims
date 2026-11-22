/**
 * Experiment runner core (spec #309): runs every config of an experiment file on every seed through an injectable
 * replicate executor, then compares each config with the baseline seed by seed (paired) and assembles an
 * `ExperimentReport`. No file or process work here beyond calling the executor; the CLI is `experimentCli.ts`.
 *
 * File format `terminal-twin-experiment` version 1; report format `terminal-twin-experiment-report` version 3
 * (version 2 added `guards`; version 3 added `expanded.warmUpS` and `warnings`).
 */
import { arch, cpus } from 'node:os'
import {
  createSimulation,
  DECISION_POINT_IDS,
  ENGINE_VERSION,
  getStrategy,
  headlineKpis,
  resolveStrategyParams,
  ScenarioValidationError,
  assertValidScenario,
  strategies as builtInStrategies,
  summarizeRun,
  type DecisionPointId,
  type DecisionsConfig,
  type HandlerSet,
  type HeadlineKpis,
  type KpiReport,
  type RunSummary,
} from '../engine'
import { fixtures } from '../scenario/fixtures'
import { parseLatencySpec } from './latencySpec'
import { mergePatch, shellQuote } from './scenarioPatch'
import { presets } from '../scenario/presets'
import { DEFAULT_WARM_UP_S, type ScenarioConfig } from '../scenario/types'

export { mergePatch } from './scenarioPatch'

export const EXPERIMENT_FORMAT = 'terminal-twin-experiment'
export const EXPERIMENT_REPORT_FORMAT = 'terminal-twin-experiment-report'
export const EXPERIMENT_REPORT_VERSION = 4
export const DEFAULT_EXPERIMENT_HORIZON_S = 86400
/** Measurement warm-up per replicate (s), excluded from KPIs and the horizon, whatever the yard start. */
export const DEFAULT_EXPERIMENT_WARM_UP_S = 7200
export const DEFAULT_SEED_COUNT = 10
/** Full invariant sweep every Nth event during experiments (incremental checks in between). */
export const EXPERIMENT_SWEEP_EVERY = 10000

export interface ExperimentConfig {
  name: string
  /** Built-in strategy per decision point. */
  strategies?: Record<string, string>
  /** Strategy params per decision point (`params.<dp>.<name>`), checked against the point's strategy. */
  params?: Record<string, Record<string, number>>
  /** Latency injector per decision point, in the `tt:run --latency` spec syntax (`fixed:200`, `exp:50,timeout:5`). */
  latency?: Record<string, string>
  /** JSON Merge Patch (RFC 7396) on the base `ScenarioConfig`; may not set `endConditions` or `measurementWarmUpS`. */
  patch?: Record<string, unknown>
}

/** Grid factors: a config path (`strategies.<dp>`, `params.<dp>.<name>`, `latency.<dp>`, `patch.<path>`) to its values. */
export interface ExperimentGrid {
  factors: Record<string, unknown[]>
}

export interface ExperimentFile {
  format: typeof EXPERIMENT_FORMAT
  version: 1
  name: string
  description?: string
  base: { preset: string } | { fixture: string }
  /** Measured sim time per replicate (s), the replicate's end condition, counted after the warm-up. Default 24 h. */
  horizonS?: number
  /**
   * Measurement warm-up per replicate (s, 0 = none), excluded from KPIs and the horizon with any yard start mode. It
   * replaces a `yardStart.mode: 'warmup'` scenario's own warm-up (validation warns). Default 2 h.
   */
  warmUpS?: number
  /** An explicit list or a count and first seed. Default 10 seeds from 1. */
  seeds?: number[] | { count: number; from?: number }
  /** The config every other config is compared with. Default the first config. */
  baseline?: string
  primary: { kpi: string }
  /** KPIs that must not get worse than a tolerance, absolute (KPI units) or percent of the baseline mean. */
  guards?: ExperimentGuard[]
  /** Explicit configs (optional when `grid` gives at least one). */
  configs?: ExperimentConfig[]
  /** Expands into extra configs, the cross product of the factor values, after the explicit configs. */
  grid?: ExperimentGrid
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
  expanded: { configs: ExperimentConfig[]; baseline: string; seeds: number[]; warmUpS: number; horizonS: number }
  /** Validation warnings (for example a yardStart warm-up the experiment's warm-up replaces). */
  warnings: string[]
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
    /** The replicate's event-log hash (null when the executor failed); its `command` reproduces it. */
    eventLogHash: string | null
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

const GRID_KINDS = ['strategies', 'params', 'latency', 'patch'] as const
type GridKind = (typeof GRID_KINDS)[number]
/** Path segments a grid factor key has (0: at least two, `patch.<path>`). */
const GRID_DEPTH: Record<GridKind, number> = { strategies: 2, params: 3, latency: 2, patch: 0 }

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A grid config's name part for one factor: the path without its kind (`latency.<dp>` keeps it, to differ from strategies). */
const factorLabel = (path: string) => (path.startsWith('latency.') ? path : path.slice(path.indexOf('.') + 1))
const factorValue = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

/** Set one grid factor value into a config, creating the nested objects on the way. */
function setFactor(config: ExperimentConfig, path: string, value: unknown): void {
  const keys = path.split('.')
  let node = config as unknown as Record<string, unknown>
  for (const key of keys.slice(0, -1)) {
    const next = node[key]
    node = node[key] = isPlainObject(next) ? { ...next } : {}
  }
  node[keys[keys.length - 1]] = value
}

/** The explicit configs, then the grid's cross product in factor order, each named `<factor>=<value>,...`. */
export function expandConfigs(file: ExperimentFile): ExperimentConfig[] {
  const configs = [...(file.configs ?? [])]
  if (file.grid === undefined) return configs
  const factors = file.grid?.factors
  if (!isPlainObject(factors) || Object.keys(factors).length === 0)
    throw new ExperimentError('"grid.factors" must map at least one config path to a list of values')
  const entries = Object.entries(factors)
  for (const [path, values] of entries) {
    const parts = path.split('.')
    const kind = parts[0] as GridKind
    const depth = GRID_DEPTH[kind]
    if (!GRID_KINDS.includes(kind) || (depth ? parts.length !== depth : parts.length < 2) || parts.some((p) => !p))
      throw new ExperimentError(`Grid factor "${path}": expected strategies.<dp>, params.<dp>.<name>, latency.<dp> or patch.<path>`)
    if (!Array.isArray(values) || values.length === 0) throw new ExperimentError(`Grid factor "${path}": values must be a non-empty list`)
  }
  let combos: [string, unknown][][] = [[]]
  for (const [path, values] of entries)
    combos = combos.flatMap((c) => (values as unknown[]).map((v) => [...c, [path, v] as [string, unknown]]))
  for (const combo of combos) {
    const config: ExperimentConfig = { name: combo.map(([p, v]) => `${factorLabel(p)}=${factorValue(v)}`).join(',') }
    for (const [path, value] of combo) setFactor(config, path, value)
    configs.push(config)
  }
  return configs
}

/** Run settings every replicate gets: the measurement warm-up and the measured horizon (s). */
interface RunLength {
  warmUpS: number
  horizonS: number
}

const runLengthOf = (file: ExperimentFile): RunLength => ({
  warmUpS: file.warmUpS ?? DEFAULT_EXPERIMENT_WARM_UP_S,
  horizonS: file.horizonS ?? DEFAULT_EXPERIMENT_HORIZON_S,
})

/**
 * Validate an experiment file (every config, explicit and grid, fully resolved); throws `ExperimentError`, and
 * returns the warnings (a config whose scenario has a yardStart warm-up, which the experiment's warm-up replaces).
 */
export function validateExperiment(file: ExperimentFile): { warnings: string[] } {
  if (!file || typeof file !== 'object') throw new ExperimentError('The experiment file must be a JSON object')
  if (file.format !== EXPERIMENT_FORMAT) throw new ExperimentError(`"format" must be "${EXPERIMENT_FORMAT}"`)
  if (file.version !== 1) throw new ExperimentError('"version" must be 1')
  if (typeof file.name !== 'string' || !file.name) throw new ExperimentError('"name" is required')
  if (file.horizonS !== undefined && !(typeof file.horizonS === 'number' && file.horizonS > 0))
    throw new ExperimentError('"horizonS" must be a positive number')
  if (file.warmUpS !== undefined && !(typeof file.warmUpS === 'number' && Number.isFinite(file.warmUpS) && file.warmUpS >= 0))
    throw new ExperimentError('"warmUpS" must be a number, 0 or more (seconds)')
  const kpi = file.primary?.kpi
  if (!EXPERIMENT_KPIS[kpi])
    throw new ExperimentError(`Unknown KPI "${kpi}" (available: ${Object.keys(EXPERIMENT_KPIS).join(', ')})`)
  validateGuards(file.guards)
  if (file.configs !== undefined && !Array.isArray(file.configs)) throw new ExperimentError('"configs" must be a list')
  resolveSeeds(file.seeds)
  const base = resolveBase(file.base)
  const names = new Set<string>()
  const warnings: string[] = []
  const length = runLengthOf(file)
  const expanded = expandConfigs(file)
  if (expanded.length === 0) throw new ExperimentError('The experiment needs at least one config, in "configs" or from "grid"')
  for (const c of expanded) {
    if (typeof c?.name !== 'string' || !c.name) throw new ExperimentError('Every config needs a "name"')
    if (names.has(c.name)) throw new ExperimentError(`Config name "${c.name}" is used twice`)
    names.add(c.name)
    const allowed = new Set(['name', 'strategies', 'params', 'latency', 'patch'])
    for (const key of Object.keys(c))
      if (!allowed.has(key))
        throw new ExperimentError(`Config "${c.name}": "${key}" is not supported (only strategies, params, latency, patch)`)
    const scenario = buildScenario(base.scenario, c, length)
    const start = scenario.yardStart
    if (start?.mode === 'warmup')
      warnings.push(
        `Config "${c.name}": the scenario has a yardStart warm-up (${start.warmUpS ?? DEFAULT_WARM_UP_S} s); the experiment's warmUpS (${length.warmUpS} s) replaces it`,
      )
  }
  if (file.baseline !== undefined && !names.has(file.baseline))
    throw new ExperimentError(`Baseline "${file.baseline}" is not one of the configs (${[...names].join(', ')})`)
  return { warnings }
}

type DecisionPoints = NonNullable<DecisionsConfig['points']>

/**
 * One config's fully resolved scenario: the patch on the base, then the strategies, params and latency shorthand into
 * `decisions.points`, then the experiment's run settings. Throws `ExperimentError` naming the config and field.
 */
function buildScenario(base: ScenarioConfig, config: ExperimentConfig, { warmUpS, horizonS }: RunLength): ScenarioConfig {
  const fail = (field: string, message: string) => new ExperimentError(`Config "${config.name}": ${field}: ${message}`)
  const point = (field: string, dp: string) => {
    if (!DECISION_POINT_IDS.includes(dp as DecisionPointId))
      throw fail(field, `Unknown decision point "${dp}" (decision points: ${DECISION_POINT_IDS.join(', ')})`)
    return dp as DecisionPointId
  }
  let patched = base
  if (config.patch !== undefined) {
    if (!isPlainObject(config.patch)) throw fail('patch', 'must be a JSON object (a JSON Merge Patch on the base scenario)')
    if ('endConditions' in config.patch)
      throw fail('patch.endConditions', "an experiment may not set end conditions (the horizon is every replicate's run length)")
    if ('measurementWarmUpS' in config.patch)
      throw fail('patch.measurementWarmUpS', 'an experiment sets the measurement warm-up with its "warmUpS" for every replicate')
    patched = mergePatch(base, config.patch) as ScenarioConfig
  }
  const points = { ...patched.decisions?.points } as DecisionPoints
  for (const [dp, strategy] of Object.entries(config.strategies ?? {})) {
    const id = point(`strategies.${dp}`, dp)
    try {
      getStrategy(id, strategy)
    } catch (err) {
      throw fail(`strategies.${dp}`, (err as Error).message)
    }
    points[id] = { ...points[id], strategy }
  }
  for (const [dp, params] of Object.entries(config.params ?? {})) {
    const id = point(`params.${dp}`, dp)
    if (!isPlainObject(params)) throw fail(`params.${dp}`, 'must map param names to numbers')
    const strategy = points[id]?.strategy ?? builtInStrategies[id].default
    const merged: Record<string, number> = { ...points[id]?.params }
    for (const [name, value] of Object.entries(params)) {
      try {
        resolveStrategyParams(id, strategy, { [name]: value as number })
      } catch (err) {
        throw fail(`params.${dp}.${name}`, (err as Error).message)
      }
      merged[name] = value as number
    }
    points[id] = { ...points[id], params: merged }
  }
  for (const [dp, spec] of Object.entries(config.latency ?? {})) {
    const id = point(`latency.${dp}`, dp)
    let parsed: ReturnType<typeof parseLatencySpec>
    try {
      parsed = parseLatencySpec(spec)
    } catch (err) {
      throw fail(`latency.${dp}`, (err as Error).message)
    }
    points[id] = { ...points[id], latency: parsed.latency, ...(parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }) }
  }
  const scenario: ScenarioConfig = {
    ...patched,
    measurementWarmUpS: warmUpS,
    endConditions: { simDurationS: horizonS },
    decisions: { ...patched.decisions, asyncMode: 'pause', points },
  }
  if (config.patch !== undefined) {
    try {
      assertValidScenario(scenario)
    } catch (err) {
      const message = err instanceof ScenarioValidationError ? err.message : `Invalid scenario: ${(err as Error).message}`
      throw fail('patch', message)
    }
  }
  return scenario
}

function commandFor(baseFlag: string, config: ExperimentConfig, seed: number, { warmUpS, horizonS }: RunLength): string {
  const parts = ['pnpm run tt:run', baseFlag, `--seed ${seed}`, '--async-mode pause', '--no-fail-fast', `--warm-up ${warmUpS}`, `--end time:${horizonS}`]
  for (const [dp, s] of Object.entries(config.strategies ?? {})) parts.push(`--strategy ${dp}=${s}`)
  for (const [dp, params] of Object.entries(config.params ?? {}))
    for (const [name, value] of Object.entries(params)) parts.push(`--param ${dp}.${name}=${value}`)
  for (const [dp, spec] of Object.entries(config.latency ?? {})) parts.push(`--latency ${dp}=${spec}`)
  if (config.patch !== undefined) parts.push(`--patch ${shellQuote(JSON.stringify(config.patch))}`)
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

/** A validated experiment, expanded and planned: one `ReplicatePlan` per config and seed, configs outer. */
export interface ExperimentPlan {
  file: ExperimentFile
  warnings: string[]
  configs: ExperimentConfig[]
  seeds: number[]
  baseline: string
  warmUpS: number
  horizonS: number
  /** The base as given (`{ preset }` or `{ fixture }`), for the cost estimate. */
  base: ExperimentFile['base']
  replicates: ReplicatePlan[]
}

/** Validate, expand and plan an experiment without running anything. Throws `ExperimentError` for an invalid file. */
export function planExperiment(file: ExperimentFile): ExperimentPlan {
  const { warnings } = validateExperiment(file)
  const length = runLengthOf(file)
  const seeds = resolveSeeds(file.seeds)
  const base = resolveBase(file.base)
  const configs = expandConfigs(file)
  const replicates: ReplicatePlan[] = []
  for (const config of configs) {
    const scenario = buildScenario(base.scenario, config, length)
    for (const seed of seeds)
      replicates.push({ config: config.name, seed, scenario, command: commandFor(base.flag, config, seed, length) })
  }
  return { file, warnings, configs, seeds, baseline: file.baseline ?? configs[0].name, ...length, base: file.base, replicates }
}

/** Run one replicate; an executor that throws gives an `invalid: error` result instead of ending the experiment. */
export function executeSafely(execute: (plan: ReplicatePlan) => ReplicateResult, plan: ReplicatePlan): ReplicateResult {
  try {
    return execute(plan)
  } catch (err) {
    return { kpis: {}, invariantViolations: 0, firstError: null, wallMs: 0, error: (err as Error).message }
  }
}

/** Index in `plan.replicates` of the baseline's first seed: the replicate that runs first (the primary KPI probe). */
export const baselineProbeIndex = (plan: ExperimentPlan) =>
  plan.replicates.findIndex((r) => r.config === plan.baseline && r.seed === plan.seeds[0])

/**
 * Throws `ExperimentError` when the baseline probe ran cleanly but the primary KPI is null on it (the KPI does not
 * apply to the base scenario, so no config could ever be compared on it). An invalid probe says nothing either way.
 */
export function checkBaselineProbe(plan: ExperimentPlan, result: ReplicateResult): void {
  const kpi = plan.file.primary.kpi
  if (classify(result) === 'ok' && (result.kpis[kpi] ?? null) === null)
    throw new ExperimentError(
      `Primary KPI "${kpi}" is null on the baseline "${plan.baseline}" (seed ${plan.seeds[0]}): it does not apply to this scenario; pick another primary KPI`,
    )
}

/**
 * Run every replicate of a plan with `runBatch` (results in the order given): the baseline probe alone first, checked
 * with `checkBaselineProbe`, then the rest. Returns the results in plan order.
 */
export async function runPlanned(
  plan: ExperimentPlan,
  runBatch: (plans: ReplicatePlan[]) => Promise<ReplicateResult[]> | ReplicateResult[],
): Promise<ReplicateResult[]> {
  const probe = baselineProbeIndex(plan)
  const [first] = await runBatch([plan.replicates[probe]])
  checkBaselineProbe(plan, first)
  const rest = await runBatch(plan.replicates.filter((_, i) => i !== probe))
  return plan.replicates.map((_, i) => (i === probe ? first : rest[i < probe ? i : i - 1]))
}

/** True when a replicate result is valid (`ok`). */
export const replicateOk = (r: ReplicateResult) => classify(r) === 'ok'

/** Run an experiment in process, one replicate after another, and return its report. Throws `ExperimentError` for an invalid file. */
export function runExperiment(file: ExperimentFile, options: RunExperimentOptions = {}): ExperimentReport {
  const plan = planExperiment(file)
  const startedAt = new Date().toISOString()
  const execute = options.executeReplicate ?? executeReplicateHeadless
  const probe = baselineProbeIndex(plan)
  const results: ReplicateResult[] = new Array(plan.replicates.length)
  let done = 0
  const run = (i: number) => {
    results[i] = executeSafely(execute, plan.replicates[i])
    options.onProgress?.(++done, plan.replicates.length)
  }
  run(probe)
  checkBaselineProbe(plan, results[probe])
  for (let i = 0; i < plan.replicates.length; i++) if (i !== probe) run(i)
  return assembleReport(plan, results, { commit: options.commit ?? null, startedAt, endedAt: new Date().toISOString() })
}

/**
 * The report of a planned experiment from its results (`results[i]` belongs to `plan.replicates[i]`, whatever order
 * they ran in, so parallel runs give the same report as sequential ones apart from the timing fields).
 */
export function assembleReport(
  plan: ExperimentPlan,
  results: ReplicateResult[],
  provenance: { commit: string | null; startedAt: string; endedAt: string },
): ExperimentReport {
  const { file, warnings, configs, seeds, baseline } = plan
  const replicates: ExperimentReport['replicates'] = plan.replicates.map((p, i) => {
    const result = results[i]
    return {
      config: p.config,
      seed: p.seed,
      status: classify(result),
      wallMs: result.wallMs,
      kpis: result.kpis,
      invariantViolations: result.invariantViolations,
      firstError: result.error ?? result.firstError,
      eventLogHash: result.summary?.eventLogHash ?? null,
      command: p.command,
    }
  })

  const byKey = new Map(replicates.map((r) => [`${r.config}\u0000${r.seed}`, r]))
  const valid = (config: string, seed: number) => {
    const r = byKey.get(`${config}\u0000${seed}`)
    return r && r.status === 'ok' ? r : undefined
  }
  const droppedSeeds: ExperimentReport['droppedSeeds'] = []
  const comparisons: ExperimentReport['comparisons'] = []
  const primaryKpi = EXPERIMENT_KPIS[file.primary.kpi]
  const verdicts: Record<string, Verdict> = {}
  for (const config of configs) {
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
  if (configs.length > 2)
    notes.push('No correction for multiple comparisons: with many configs, expect some false "better" or "worse" verdicts.')
  return {
    format: EXPERIMENT_REPORT_FORMAT,
    version: EXPERIMENT_REPORT_VERSION,
    experiment: file,
    expanded: { configs, baseline, seeds, warmUpS: plan.warmUpS, horizonS: plan.horizonS },
    warnings,
    provenance: {
      engineVersion: ENGINE_VERSION,
      commit: provenance.commit,
      node: process.version,
      cpu: `${cpus()[0]?.model ?? 'unknown'} (${cpus().length} cores, ${arch()})`,
      startedAt: provenance.startedAt,
      endedAt: provenance.endedAt,
    },
    replicates,
    comparisons,
    primary: { kpi: file.primary.kpi, direction: primaryKpi.direction, verdicts },
    guards,
    droppedSeeds,
    notes,
  }
}
