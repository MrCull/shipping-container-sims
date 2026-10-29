/**
 * Process entry for the engine benchmark (local only, not in CI):
 *   npm run tt:bench                       TTI preset, 24 sim-hours, compared with perf/baseline.json
 *   npm run tt:bench -- --preset "Stress test"
 *   npm run tt:bench -- --update-baseline  record this run as the baseline for the preset
 *   npm run tt:bench -- --slow-ms 1        self-test: slow every event, the regression flag must trip
 * Exit codes: 0 ok, 1 regression or engine failure, 2 usage.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { parseArgs } from 'node:util'
import { compareToBaseline, formatReport, runBenchmark, type BenchBaseline } from './benchmark'

export const BASELINE_URL = new URL('../perf/baseline.json', import.meta.url)

export function benchMain(argv: string[], print: (line: string) => void = console.log): number {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        preset: { type: 'string', default: 'TTI Algeciras baseline' },
        hours: { type: 'string', default: '24' },
        'sweep-every': { type: 'string' },
        'slow-ms': { type: 'string' },
        'update-baseline': { type: 'boolean', default: false },
        out: { type: 'string' },
      },
    }))
  } catch (err) {
    print(`Error: ${(err as Error).message}`)
    return 2
  }
  const hours = Number(values.hours)
  if (!Number.isFinite(hours) || hours <= 0) {
    print(`Error: bad --hours "${values.hours}"`)
    return 2
  }
  const preset = values.preset as string
  const report = runBenchmark(
    {
      preset,
      simHours: hours,
      sweepEvery: values['sweep-every'] === undefined ? undefined : Number(values['sweep-every']),
      slowMsPerEvent: values['slow-ms'] === undefined ? undefined : Number(values['slow-ms']),
    },
    { node: process.version, cpu: `${cpus()[0]?.model ?? 'cpu'} x${cpus().length}`, load1: loadavg()[0] },
  )
  const baseline: BenchBaseline = existsSync(BASELINE_URL)
    ? (JSON.parse(readFileSync(BASELINE_URL, 'utf8')) as BenchBaseline)
    : { note: '', reports: {} }
  const key = `${preset}|${hours}h`
  if (values['update-baseline']) {
    baseline.note = 'Engine benchmark baseline (npm run tt:bench). Timings only compare on a like machine: re-record with --update-baseline when the reference machine changes.'
    baseline.reports[key] = report
    writeFileSync(BASELINE_URL, `${JSON.stringify(baseline, null, 2)}\n`)
    for (const line of formatReport(report)) print(line)
    print(`Baseline "${key}" written.`)
    return report.status === 'failed' || report.invariantViolations > 0 ? 1 : 0
  }
  const base = baseline.reports[key]
  const comparison = base ? compareToBaseline(report, base) : undefined
  for (const line of formatReport(report, comparison)) print(line)
  if (!base) print(`No baseline for "${key}": run with --update-baseline to record one.`)
  if (values.out) writeFileSync(values.out, `${JSON.stringify({ report, comparison }, null, 2)}\n`)
  return comparison?.regression || report.status === 'failed' || report.invariantViolations > 0 ? 1 : 0
}
