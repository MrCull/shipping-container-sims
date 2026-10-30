/**
 * Engine benchmark (TT-19): run a preset for N sim-hours headless and report events/sec,
 * wall-ms per sim-hour and peak memory; compare against a committed baseline.
 * Local only (CI timing is too noisy): `pnpm run tt:bench`. Entry point: `bench.ts`.
 */
import { createSimulation, DEFAULT_SWEEP_EVERY } from '../engine'
import { presets } from '../scenario/presets'

export const REGRESSION_THRESHOLD = 0.2

export interface BenchOptions {
  preset: string
  simHours: number
  /** Full invariant sweep every N events (between sweeps events are checked incrementally); 0 = invariants off. Default = the engine's. */
  sweepEvery?: number
  /** Self-test: busy-wait this many ms per processed event, to prove the regression flag trips. */
  slowMsPerEvent?: number
  /** Injectable clock and memory probe (tests). */
  now?: () => number
  memoryMb?: () => number
}

export interface BenchReport {
  preset: string
  simHours: number
  /** Full sweep interval (0 = invariants off). */
  sweepEvery: number
  events: number
  wallMs: number
  eventsPerSec: number
  wallMsPerSimHour: number
  peakMemoryMb: number
  status: string
  invariantViolations: number
  /** Wall time spent in invariant checks, ms, and per processed event (reported separately from the engine's own time). */
  invariantMs: number
  invariantMsPerEvent: number
  /** Events checked incrementally and full sweeps run. */
  invariantChecks: { incremental: number; sweeps: number }
  firstError: string | null
  /** Environment the numbers were taken on (timings only compare on a like machine). */
  env: { node: string; cpu: string; load1: number }
}

export interface BenchBaseline {
  note: string
  reports: Record<string, BenchReport>
}

export interface MetricComparison {
  metric: 'eventsPerSec' | 'wallMsPerSimHour' | 'peakMemoryMb'
  baseline: number
  current: number
  /** Positive = worse (slower / bigger), as a fraction of the baseline. */
  worseBy: number
  regression: boolean
}

export interface Comparison {
  metrics: MetricComparison[]
  regression: boolean
}

const defaultMemoryMb = (): number => process.memoryUsage().rss / (1024 * 1024)

export function runBenchmark(options: BenchOptions, env: BenchReport['env']): BenchReport {
  const build = presets[options.preset]
  if (!build) throw new Error(`Unknown preset "${options.preset}" (available: ${Object.keys(presets).join(', ')})`)
  const now = options.now ?? (() => performance.now())
  const memoryMb = options.memoryMb ?? defaultMemoryMb
  const config = build()
  const every = options.sweepEvery ?? DEFAULT_SWEEP_EVERY
  const sim = createSimulation(config, {}, { invariants: every <= 0 ? { enabled: false } : { sweepEvery: every } })
  const slow = options.slowMsPerEvent ?? 0
  if (slow > 0)
    sim.subscribe(() => {
      const until = performance.now() + slow
      while (performance.now() < until) {
        /* busy wait */
      }
    })
  let peak = memoryMb()
  let events = 0
  const start = now()
  for (let h = 1; h <= options.simHours; h++) {
    const r = sim.runUntil({ time: h * 3600 })
    events += r.eventsProcessed
    peak = Math.max(peak, memoryMb())
    if (r.reason === 'ended' || r.reason === 'failed' || r.reason === 'idle') break
  }
  const wallMs = Math.max(1e-6, now() - start)
  const report = sim.invariantReport()
  const stats = sim.invariantStats()
  return {
    preset: options.preset,
    simHours: options.simHours,
    sweepEvery: every,
    events,
    wallMs,
    eventsPerSec: events / (wallMs / 1000),
    wallMsPerSimHour: wallMs / options.simHours,
    peakMemoryMb: peak,
    status: sim.status,
    invariantViolations: report.violations.length,
    invariantMs: stats.wallMs,
    invariantMsPerEvent: events > 0 ? stats.wallMs / events : 0,
    invariantChecks: { incremental: stats.incremental, sweeps: stats.sweeps },
    firstError: sim.firstError ? String(sim.firstError.message ?? sim.firstError) : null,
    env,
  }
}

/** Compare to a baseline report: a metric more than `threshold` (default 20%) worse is a regression. */
export function compareToBaseline(current: BenchReport, baseline: BenchReport, threshold = REGRESSION_THRESHOLD): Comparison {
  const raw: Omit<MetricComparison, 'regression'>[] = [
    { metric: 'eventsPerSec', baseline: baseline.eventsPerSec, current: current.eventsPerSec, worseBy: 1 - current.eventsPerSec / baseline.eventsPerSec },
    { metric: 'wallMsPerSimHour', baseline: baseline.wallMsPerSimHour, current: current.wallMsPerSimHour, worseBy: current.wallMsPerSimHour / baseline.wallMsPerSimHour - 1 },
    { metric: 'peakMemoryMb', baseline: baseline.peakMemoryMb, current: current.peakMemoryMb, worseBy: current.peakMemoryMb / baseline.peakMemoryMb - 1 },
  ]
  const metrics: MetricComparison[] = raw.map((m) => ({ ...m, regression: m.worseBy > threshold }))
  return { metrics, regression: metrics.some((m) => m.regression) }
}

export function formatReport(report: BenchReport, comparison?: Comparison): string[] {
  const lines = [
    `Benchmark: ${report.preset}, ${report.simHours} sim-hours, invariants: incremental, full sweep every ${report.sweepEvery} events`,
    `  events           ${report.events} in ${(report.wallMs / 1000).toFixed(2)} s wall`,
    `  events/sec       ${report.eventsPerSec.toFixed(0)}`,
    `  wall-ms/sim-hour ${report.wallMsPerSimHour.toFixed(0)}`,
    `  invariants       ${report.invariantMs.toFixed(0)} ms (${(report.invariantMsPerEvent * 1000).toFixed(0)} us/event; ${report.invariantChecks.incremental} incremental, ${report.invariantChecks.sweeps} sweeps), included above`,
    `  peak memory      ${report.peakMemoryMb.toFixed(0)} MB (rss)`,
    `  status           ${report.status}, ${report.invariantViolations} invariant violations${report.firstError ? `, first error: ${report.firstError}` : ''}`,
    `  machine          node ${report.env.node}, ${report.env.cpu}, load ${report.env.load1.toFixed(2)}`,
  ]
  if (comparison) {
    lines.push(`Against baseline (regression above ${REGRESSION_THRESHOLD * 100}% worse):`)
    for (const m of comparison.metrics)
      lines.push(
        `  ${m.metric.padEnd(17)} ${m.baseline.toFixed(0).padStart(8)} -> ${m.current.toFixed(0).padStart(8)}  ${m.worseBy >= 0 ? '+' : ''}${(m.worseBy * 100).toFixed(1)}% worse${m.regression ? '  REGRESSION' : ''}`,
      )
    lines.push(comparison.regression ? 'RESULT: REGRESSION' : 'RESULT: ok')
  }
  return lines
}
