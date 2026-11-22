/**
 * `tt:experiment` CLI (logic; `experimentRun.ts` is the process entry point).
 *
 *   pnpm run tt:experiment <experiment.json> [--jobs N] [--out DIR] [--yes] [--dry-run]
 *
 * Validates and plans the experiment, prints the configs and a wall-time estimate, takes the machine-wide heavy lock
 * (as `scripts/bg.sh run --heavy` does; skipped under `BG_HEAVY_HELD=1`), runs the replicates in up to `--jobs` worker
 * processes (`experimentWorker.ts`; `--jobs 1` runs them in this process), then writes `report.json` (format
 * `terminal-twin-experiment-report`), `report.md` and `replicates/<config>/<seed>.summary.json` to `--out`
 * (default `.tt-experiments/<timestamp>/`). Exit codes: 0 completed with every replicate valid, 1 completed with an
 * invalid replicate, 2 usage or validation error or a refused cost confirmation.
 */
import { execFileSync, fork, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { BenchBaseline } from './benchmark'
import {
  EXPERIMENT_KPIS,
  EXPERIMENT_SWEEP_EVERY,
  ExperimentError,
  assembleReport,
  executeReplicateHeadless,
  executeSafely,
  planExperiment,
  runPlanned,
  replicateOk,
  type ExperimentFile,
  type ExperimentPlan,
  type ExperimentReport,
  type MeanCi,
  type ReplicatePlan,
  type ReplicateResult,
} from './experiment'
import { acquireHeavyLock } from './heavyLock'

export const EXPERIMENT_USAGE = `Usage: pnpm run tt:experiment <experiment.json> [--jobs N] [--out DIR] [--yes] [--dry-run]

  <experiment.json>  Experiment file (format terminal-twin-experiment, version 1)
  --jobs <n>         Replicates run at once, in worker processes (default the CPU count; 1 runs them in process)
  --out <dir>        Output directory (default .tt-experiments/<timestamp>/): report.json, report.md and
                     replicates/<config>/<seed>.summary.json
  --yes              Run without asking when the estimate is above 10 minutes
  --dry-run          Validate, print the expanded configs, the replicate count and the estimate, then exit 0

Takes the machine-wide heavy lock of scripts/bg.sh run --heavy (skipped under BG_HEAVY_HELD=1).
Exit codes: 0 completed with every replicate valid, 1 completed with an invalid replicate,
2 usage or validation error, or a refused cost confirmation.
KPIs: ${Object.keys(EXPERIMENT_KPIS).join(', ')}`

/** Cost guard threshold: above this estimate the CLI asks (TTY) or refuses (non-TTY) without `--yes`. */
export const COST_GUARD_MS = 10 * 60 * 1000
/** Wall ms per sim-hour when the perf baseline has no entry for the base (about a peak day on the reference machine). */
export const DEFAULT_MS_PER_SIM_HOUR = 4000
const PERF_BASELINE_URL = new URL('../perf/baseline.json', import.meta.url)

export interface ExperimentEstimate {
  ms: number
  msPerSimHour: number
  /** Where msPerSimHour came from. */
  source: string
  replicates: number
  simHours: number
  jobs: number
}

/**
 * Estimate = replicates x (warm-up + horizon) sim-hours x ms per sim-hour / jobs. Ms per sim-hour comes from the
 * perf baseline (`pnpm run tt:bench`) entry for the base preset, with its sweep share scaled to the experiment's
 * sparse sweeps (sweeps taken as half the invariant time), else `DEFAULT_MS_PER_SIM_HOUR`.
 */
export function estimateExperiment(plan: ExperimentPlan, jobs: number, perf: BenchBaseline | null = readPerfBaseline()): ExperimentEstimate {
  const preset = 'preset' in plan.base ? plan.base.preset : undefined
  const entry = preset ? Object.values(perf?.reports ?? {}).find((r) => r.preset === preset && r.simHours > 0) : undefined
  let msPerSimHour = DEFAULT_MS_PER_SIM_HOUR
  let source = 'default, no perf baseline entry for the base'
  if (entry) {
    const sweepMs = (entry.invariantMs ?? 0) / 2
    const sweepEvery = entry.sweepEvery || EXPERIMENT_SWEEP_EVERY
    const saved = sweepEvery < EXPERIMENT_SWEEP_EVERY ? sweepMs * (1 - sweepEvery / EXPERIMENT_SWEEP_EVERY) : 0
    msPerSimHour = Math.round((entry.wallMs - saved) / entry.simHours)
    source = `perf baseline "${entry.preset}"`
  }
  const simHours = (plan.warmUpS + plan.horizonS) / 3600
  const replicates = plan.replicates.length
  const effectiveJobs = Math.max(1, Math.min(jobs, replicates))
  return { ms: (replicates * simHours * msPerSimHour) / effectiveJobs, msPerSimHour, source, replicates, simHours, jobs: effectiveJobs }
}

function readPerfBaseline(): BenchBaseline | null {
  try {
    return existsSync(PERF_BASELINE_URL) ? (JSON.parse(readFileSync(PERF_BASELINE_URL, 'utf8')) as BenchBaseline) : null
  } catch {
    return null
  }
}

const minutes = (ms: number) => `${Math.round((ms / 60000) * 10) / 10} min`
const formatEstimate = (e: ExperimentEstimate) =>
  `${minutes(e.ms)} (${e.replicates} replicates x ${Math.round(e.simHours * 100) / 100} sim-h x ${e.msPerSimHour} ms per sim-h / ${e.jobs} jobs; ${e.source})`

/** A file-system-safe folder name for a config (grid names keep their `=` and `,`). */
export const configDirName = (name: string) => name.replace(/[^A-Za-z0-9._=,+-]/g, '_')

const WORKER_URL = new URL('./experimentWorker.ts', import.meta.url)

/** Run the replicates in up to `jobs` forked worker processes; results come back in plan order. */
function runInWorkers(plans: ReplicatePlan[], jobs: number, onDone: (r: ReplicateResult) => void): Promise<ReplicateResult[]> {
  return new Promise((resolve) => {
    if (plans.length === 0) return resolve([])
    const results: ReplicateResult[] = new Array(plans.length)
    let next = 0
    let done = 0
    const finish = (index: number, result: ReplicateResult) => {
      results[index] = result
      done++
      onDone(result)
      if (done === plans.length) resolve(results)
    }
    const start = () => {
      // The tsx loader resolves from the working directory (the repo root under pnpm run).
      const child: ChildProcess = fork(fileURLToPath(WORKER_URL), [], {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      })
      let current = -1
      const feed = () => {
        if (next >= plans.length) {
          child.disconnect()
          return
        }
        current = next++
        child.send({ index: current, plan: plans[current] })
      }
      child.on('message', (msg: { index: number; result: ReplicateResult }) => {
        current = -1
        finish(msg.index, msg.result)
        feed()
      })
      child.on('exit', (code) => {
        if (current < 0) return
        const lost = current
        current = -1
        finish(lost, { kpis: {}, invariantViolations: 0, firstError: null, wallMs: 0, error: `worker process exited with code ${code}` })
        if (next < plans.length) start()
      })
      feed()
    }
    for (let i = 0; i < Math.min(jobs, plans.length); i++) start()
  })
}

export interface ExperimentCliOptions {
  /** Run replicates in process with this executor (tests); forces in-process sequential runs. */
  executeReplicate?: (plan: ReplicatePlan) => ReplicateResult
  /** Whether a person can answer the cost question (default: stdin and stdout are TTYs). */
  interactive?: boolean
  /** Ask the cost question (default: readline on the TTY); resolves true to run. */
  confirm?: (question: string) => Promise<boolean>
  /** Take the heavy lock (default true; it is skipped under BG_HEAVY_HELD=1 anyway). */
  heavyLock?: boolean
  /** The perf baseline for the estimate (default perf/baseline.json). */
  perfBaseline?: BenchBaseline | null
}

async function askOnTty(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim())
  } finally {
    rl.close()
  }
}

class UsageError extends Error {}

function gitCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

const fmt = (x: number | null | undefined, digits = 3) => (x === null || x === undefined ? 'n/a' : String(Math.round(x * 10 ** digits) / 10 ** digits))
const fmtCi = (ci: [number, number] | null) => (ci ? `[${fmt(ci[0])}, ${fmt(ci[1])}]` : 'n/a')
const fmtStats = (s: MeanCi) => `${fmt(s.mean)} ${fmtCi(s.ci)}`
const signed = (x: number | null) => (x === null ? 'n/a' : `${x >= 0 ? '+' : ''}${fmt(x)}`)

/** The Markdown summary of a report (no em dash characters, repo rule). */
export function formatExperimentMarkdown(r: ExperimentReport): string {
  const primary = EXPERIMENT_KPIS[r.primary.kpi]
  const lines = [
    `# Experiment: ${r.experiment.name}`,
    '',
    ...(r.experiment.description ? [r.experiment.description, ''] : []),
    `Question: does each config beat the baseline **${r.expanded.baseline}** on **${r.primary.kpi}** (${primary.unit}, ${r.primary.direction} is better)?`,
    `Seeds: ${r.expanded.seeds.join(', ')}.`,
    `Warm-up: ${r.expanded.warmUpS} s (excluded from KPIs). Horizon: ${r.expanded.horizonS} s of measured sim time per replicate.`,
    '',
    '## Verdict',
    '',
    `| Config | Verdict | n | Mean difference | 95% CI | Change |`,
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const c of r.comparisons.filter((x) => x.kpi === r.primary.kpi))
    lines.push(
      `| ${c.config} | ${c.verdict} | ${c.n} | ${signed(c.meanDiff)} | ${fmtCi(c.ci)} | ${c.relativeChangePct === null ? 'n/a' : `${signed(c.relativeChangePct)} %`} |`,
    )
  if (r.guards.length) {
    lines.push(
      '',
      '## Guards',
      '',
      'Degradation: config minus baseline, signed so positive is worse. Held: the CI upper bound is at or below the tolerance; breached: the CI lower bound is above it; otherwise uncertain.',
      '',
      '| Guard | Tolerance | Config | Status | Degradation 95% CI | Tolerance in KPI units |',
      '| --- | --- | --- | --- | --- | --- |',
    )
    for (const g of r.guards) {
      const tolerance = 'pct' in g.tolerance ? `${g.tolerance.pct} %` : `${g.tolerance.abs}`
      for (const [config, res] of Object.entries(g.statuses))
        lines.push(
          `| ${g.kpi} (${EXPERIMENT_KPIS[g.kpi].unit}) | ${tolerance} | ${config} | ${res.status} | ${fmtCi(res.degradationCi)} | ${fmt(res.toleranceAbs)} |`,
        )
    }
  }
  lines.push(
    '',
    '## KPIs',
    '',
    'Each cell: mean [95% CI]. Difference: config minus baseline, paired by seed.',
    '',
    '| KPI | Config | Baseline | Config | Difference | Verdict |',
    '| --- | --- | --- | --- | --- | --- |',
  )
  for (const c of r.comparisons)
    lines.push(
      `| ${c.kpi} (${EXPERIMENT_KPIS[c.kpi].unit}) | ${c.config} | ${fmtStats(c.baseline)} | ${fmtStats(c.configStats)} | ${signed(c.meanDiff)} ${fmtCi(c.ci)} | ${c.verdict} |`,
    )
  const invalid = r.replicates.filter((x) => x.status !== 'ok')
  lines.push('', '## Invalid and dropped replicates', '')
  if (invalid.length === 0 && r.droppedSeeds.length === 0) lines.push('None.')
  for (const x of invalid) lines.push(`- ${x.config}, seed ${x.seed}: ${x.status}${x.firstError ? ` (${x.firstError})` : ''}`)
  for (const d of r.droppedSeeds) lines.push(`- Dropped from ${d.config} pairing: seed ${d.seed} (${d.reason})`)
  if (r.warnings.length) lines.push('', '## Warnings', '', ...r.warnings.map((w) => `- ${w}`))
  if (r.notes.length) lines.push('', '## Notes', '', ...r.notes.map((n) => `- ${n}`))
  const p = r.provenance
  lines.push(
    '',
    '## Provenance',
    '',
    `- Engine ${p.engineVersion}, commit ${p.commit ?? 'unknown'}, Node ${p.node}, ${p.cpu}`,
    `- Started ${p.startedAt}, ended ${p.endedAt}`,
    '',
    '## Reproduce one replicate',
    '',
    '```',
    ...r.replicates.map((x) => x.command),
    '```',
    '',
  )
  return lines.join('\n')
}

/** Run the CLI; resolves to the process exit code. `print` receives output lines. */
export async function runExperimentCli(
  argv: string[],
  print: (line: string) => void = console.log,
  options: ExperimentCliOptions = {},
): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        out: { type: 'string' },
        jobs: { type: 'string' },
        yes: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: true,
      strict: true,
    })
    if (values.help) {
      print(EXPERIMENT_USAGE)
      return 0
    }
    if (positionals.length !== 1) throw new UsageError('Give exactly one experiment file')
    const jobs = values.jobs === undefined ? availableParallelism() : Number(values.jobs)
    if (!Number.isInteger(jobs) || jobs < 1) throw new UsageError(`Bad --jobs "${values.jobs}" (a positive integer)`)
    const path = positionals[0]
    let file: ExperimentFile
    try {
      file = JSON.parse(readFileSync(path, 'utf8')) as ExperimentFile
    } catch (err) {
      throw new UsageError(`Cannot read ${path}: ${(err as Error).message}`)
    }
    const plan = planExperiment(file)
    for (const w of plan.warnings) print(`Warning: ${w}`)
    const inProcess = Boolean(options.executeReplicate) || jobs === 1
    const estimate = estimateExperiment(plan, inProcess ? 1 : jobs, options.perfBaseline)
    print(`Experiment "${file.name}"`)
    print(`Configs (${plan.configs.length}): ${plan.configs.map((c) => (c.name === plan.baseline ? `${c.name} (baseline)` : c.name)).join(', ')}`)
    print(`Replicates: ${plan.replicates.length} (${plan.configs.length} configs x ${plan.seeds.length} seeds)`)
    print(`Estimate: ${formatEstimate(estimate)}`)
    if (values['dry-run']) {
      for (const c of plan.configs) print(`  ${JSON.stringify(c)}`)
      return 0
    }
    if (estimate.ms > COST_GUARD_MS && !values.yes) {
      const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)
      if (!interactive) {
        print(`Estimated ${minutes(estimate.ms)} is above 10 minutes: pass --yes to run it anyway (or --dry-run to look first).`)
        return 2
      }
      const ok = await (options.confirm ?? askOnTty)(`Estimated ${minutes(estimate.ms)}. Run it? [y/N] `)
      if (!ok) {
        print('Not run.')
        return 2
      }
    }
    const out = values.out ?? join('.tt-experiments', new Date().toISOString().replace(/[:.]/g, '-'))
    print(`Output: ${out}`)
    const lock =
      options.heavyLock === false
        ? null
        : await acquireHeavyLock({ holder: `tt:experiment ${out}`, onWait: (m) => print(`tt:experiment: ${m}`) })
    try {
      const startedAt = new Date().toISOString()
      const started = Date.now()
      const total = plan.replicates.length
      let done = 0
      let invalid = 0
      const onDone = (r: ReplicateResult) => {
        done++
        if (!replicateOk(r)) invalid++
        const leftMs = done < total ? ((Date.now() - started) / done) * (total - done) : 0
        print(`  ${done}/${total} replicates done, ${invalid} invalid, about ${minutes(leftMs)} left`)
      }
      const execute = options.executeReplicate ?? executeReplicateHeadless
      const results = await runPlanned(plan, (batch) =>
        inProcess
          ? batch.map((p) => {
              const r = executeSafely(execute, p)
              onDone(r)
              return r
            })
          : runInWorkers(batch, jobs, onDone),
      )
      const report = assembleReport(plan, results, { commit: gitCommit(), startedAt, endedAt: new Date().toISOString() })
      mkdirSync(out, { recursive: true })
      writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
      writeFileSync(join(out, 'report.md'), formatExperimentMarkdown(report))
      plan.replicates.forEach((p, i) => {
        const summary = results[i].summary
        if (!summary) return
        const dir = join(out, 'replicates', configDirName(p.config))
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `${p.seed}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`)
      })
      for (const [config, verdict] of Object.entries(report.primary.verdicts)) print(`${config}: ${verdict} on ${report.primary.kpi}`)
      for (const g of report.guards)
        for (const [config, res] of Object.entries(g.statuses)) print(`${config}: guard ${g.kpi} ${res.status}`)
      print(`Wrote ${join(out, 'report.json')}, ${join(out, 'report.md')} and ${join(out, 'replicates')}/`)
      const bad = report.replicates.filter((x) => x.status !== 'ok').length
      if (bad > 0) {
        print(`${bad} of ${report.replicates.length} replicates invalid (see report.md)`)
        return 1
      }
      return 0
    } finally {
      lock?.release()
    }
  } catch (err) {
    if (err instanceof ExperimentError) {
      print(`Error: ${err.message}`)
      return 2
    }
    if (err instanceof UsageError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      print(`Error: ${(err as Error).message}`)
      print(EXPERIMENT_USAGE)
      return 2
    }
    throw err
  }
}
