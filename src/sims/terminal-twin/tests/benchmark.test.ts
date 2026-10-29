import { describe, expect, it } from 'vitest'
import { compareToBaseline, formatReport, runBenchmark, type BenchReport } from '../cli/benchmark'
import { benchMain } from '../cli/benchCli'

const env = { node: 'test', cpu: 'test', load1: 0 }
const small = { preset: 'Small automated', simHours: 1, sweepEvery: 0 }

const fake = (over: Partial<BenchReport>): BenchReport => ({
  preset: 'x',
  simHours: 24,
  sweepEvery: 1,
  invariantMs: 0,
  invariantMsPerEvent: 0,
  invariantChecks: { incremental: 0, sweeps: 0 },
  events: 1000,
  wallMs: 1000,
  eventsPerSec: 1000,
  wallMsPerSimHour: 40,
  peakMemoryMb: 100,
  status: 'ready',
  invariantViolations: 0,
  firstError: null,
  env,
  ...over,
})

describe('benchmark comparison', () => {
  it('flags a metric more than 20% worse and not one within 20%', () => {
    expect(compareToBaseline(fake({ eventsPerSec: 850 }), fake({})).regression).toBe(false)
    const slow = compareToBaseline(fake({ eventsPerSec: 700, wallMsPerSimHour: 60 }), fake({}))
    expect(slow.regression).toBe(true)
    expect(slow.metrics.filter((m) => m.regression).map((m) => m.metric)).toEqual(['eventsPerSec', 'wallMsPerSimHour'])
    expect(compareToBaseline(fake({ peakMemoryMb: 130 }), fake({})).regression).toBe(true)
  })

  it('does not flag an improvement', () => {
    expect(compareToBaseline(fake({ eventsPerSec: 5000, wallMsPerSimHour: 8, peakMemoryMb: 50 }), fake({})).regression).toBe(false)
  })
})

describe('benchmark run', () => {
  it('reports events/sec, wall-ms per sim-hour and peak memory, and trips on a deliberately slowed engine', () => {
    const normal = runBenchmark(small, env)
    expect(normal.events).toBeGreaterThan(100)
    expect(normal.eventsPerSec).toBeGreaterThan(0)
    expect(normal.wallMsPerSimHour).toBeGreaterThan(0)
    expect(normal.peakMemoryMb).toBeGreaterThan(10)
    expect(normal.status).not.toBe('failed')
    const slowed = runBenchmark({ ...small, slowMsPerEvent: 1 }, env)
    expect(slowed.events).toBe(normal.events)
    const cmp = compareToBaseline(slowed, normal)
    expect(cmp.regression).toBe(true)
    expect(formatReport(slowed, cmp).join('\n')).toContain('RESULT: REGRESSION')
  })

  it('rejects an unknown preset and bad arguments', () => {
    expect(() => runBenchmark({ ...small, preset: 'nope' }, env)).toThrow(/Unknown preset/)
    expect(benchMain(['--hours', 'x'], () => {})).toBe(2)
  })
})

describe('committed baseline', () => {
  it('has the TTI and Stress test benchmarks recorded', async () => {
    const { readFileSync } = await import('node:fs')
    const { BASELINE_URL } = await import('../cli/benchCli')
    const b = JSON.parse(readFileSync(BASELINE_URL, 'utf8')) as { reports: Record<string, BenchReport> }
    for (const key of ['TTI Algeciras baseline|24h', 'Stress test|24h']) {
      expect(b.reports[key]?.eventsPerSec).toBeGreaterThan(0)
      expect(b.reports[key]?.status).not.toBe('failed')
      expect(b.reports[key]?.invariantViolations).toBe(0)
    }
  })
})
