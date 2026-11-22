/**
 * `tt:experiment` CLI (logic; `experimentRun.ts` is the process entry point).
 *
 *   pnpm run tt:experiment <experiment.json> [--out DIR]
 *
 * Runs every config on every seed (one replicate after another, in process), then writes `report.json`
 * (format `terminal-twin-experiment-report`) and `report.md` to `--out` (default `.tt-experiments/<timestamp>/`).
 * Exit codes: 0 completed with every replicate valid, 1 completed with an invalid replicate, 2 usage or validation error.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  EXPERIMENT_KPIS,
  ExperimentError,
  runExperiment,
  type ExperimentFile,
  type ExperimentReport,
  type MeanCi,
  type RunExperimentOptions,
} from './experiment'

export const EXPERIMENT_USAGE = `Usage: pnpm run tt:experiment <experiment.json> [--out DIR]

  <experiment.json>  Experiment file (format terminal-twin-experiment, version 1)
  --out <dir>        Output directory for report.json and report.md (default .tt-experiments/<timestamp>/)

Exit codes: 0 completed with every replicate valid, 1 completed with an invalid replicate, 2 usage or validation error.
KPIs: ${Object.keys(EXPERIMENT_KPIS).join(', ')}`

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

/** Run the CLI; returns the process exit code. `print` receives output lines. */
export function runExperimentCli(
  argv: string[],
  print: (line: string) => void = console.log,
  options: Pick<RunExperimentOptions, 'executeReplicate'> = {},
): number {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { out: { type: 'string' }, help: { type: 'boolean', default: false } },
      allowPositionals: true,
      strict: true,
    })
    if (values.help) {
      print(EXPERIMENT_USAGE)
      return 0
    }
    if (positionals.length !== 1) throw new UsageError('Give exactly one experiment file')
    const path = positionals[0]
    let file: ExperimentFile
    try {
      file = JSON.parse(readFileSync(path, 'utf8')) as ExperimentFile
    } catch (err) {
      throw new UsageError(`Cannot read ${path}: ${(err as Error).message}`)
    }
    const out = values.out ?? join('.tt-experiments', new Date().toISOString().replace(/[:.]/g, '-'))
    print(`Experiment "${file?.name}", output to ${out}`)
    const report = runExperiment(file, {
      ...options,
      commit: gitCommit(),
      onProgress: (done, total) => print(`  replicate ${done}/${total} done`),
    })
    for (const w of report.warnings) print(`Warning: ${w}`)
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(join(out, 'report.md'), formatExperimentMarkdown(report))
    for (const [config, verdict] of Object.entries(report.primary.verdicts)) print(`${config}: ${verdict} on ${report.primary.kpi}`)
    for (const g of report.guards)
      for (const [config, res] of Object.entries(g.statuses)) print(`${config}: guard ${g.kpi} ${res.status}`)
    print(`Wrote ${join(out, 'report.json')} and ${join(out, 'report.md')}`)
    const invalid = report.replicates.filter((x) => x.status !== 'ok').length
    if (invalid > 0) {
      print(`${invalid} of ${report.replicates.length} replicates invalid (see report.md)`)
      return 1
    }
    return 0
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
