import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXPERIMENT_KPIS, executeReplicateHeadless } from '../cli/experiment'
import { runExperimentCli } from '../cli/experimentCli'
import { handlerSets } from '../cli/handlerSets'

function cli(...args: string[]) {
  const out: string[] = []
  const exitCode = runExperimentCli(args, (line) => out.push(line))
  return { exitCode, text: out.join('\n') }
}

function writeExperiment(dir: string, over: Record<string, unknown> = {}): string {
  const file = join(dir, 'exp.json')
  writeFileSync(
    file,
    JSON.stringify({
      format: 'terminal-twin-experiment',
      version: 1,
      name: 'Tracer study',
      base: { fixture: 'tracer-1sts-10-boxes' },
      horizonS: 3600,
      warmUpS: 0,
      seeds: [1, 2],
      primary: { kpi: 'grossMovesPerHour' },
      configs: [{ name: 'A' }, { name: 'B', strategies: { shcDispatch: 'oldest-job' } }],
      ...over,
    }),
  )
  return file
}

describe('tt:experiment CLI (in process)', () => {
  it('exits 2 on usage errors', () => {
    expect(cli().exitCode).toBe(2)
    expect(cli('--bogus').exitCode).toBe(2)
    const missing = cli('/no/such/experiment.json')
    expect(missing.exitCode).toBe(2)
    expect(missing.text).toMatch(/Cannot read/)
  })

  it('exits 2 with a readable message for an unknown strategy or KPI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-exp-'))
    const badStrategy = cli(writeExperiment(dir, { configs: [{ name: 'A', strategies: { shcDispatch: 'teleport' } }] }))
    expect(badStrategy.exitCode).toBe(2)
    expect(badStrategy.text).toMatch(/Unknown shcDispatch strategy "teleport"/)
    const badKpi = cli(writeExperiment(dir, { primary: { kpi: 'vibes' } }))
    expect(badKpi.exitCode).toBe(2)
    expect(badKpi.text).toMatch(/Unknown KPI "vibes"/)
  })

  it('writes report.json and report.md with the documented shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-exp-'))
    const out = join(dir, 'out')
    const { exitCode, text } = cli(writeExperiment(dir), '--out', out)
    expect(exitCode).toBe(0)
    expect(text).toContain(out)
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    expect(report).toMatchObject({
      format: 'terminal-twin-experiment-report',
      version: 3,
      expanded: { baseline: 'A', seeds: [1, 2], warmUpS: 0, horizonS: 3600 },
      warnings: [],
      primary: { kpi: 'grossMovesPerHour', direction: 'higher' },
    })
    expect(report.replicates).toHaveLength(4)
    expect(report.comparisons.map((c: { config: string; kpi: string }) => `${c.config}:${c.kpi}`)).toEqual(
      Object.keys(EXPERIMENT_KPIS).map((k) => `B:${k}`),
    )
    expect(typeof report.provenance.commit === 'string' || report.provenance.commit === null).toBe(true)
    const md = readFileSync(join(out, 'report.md'), 'utf8')
    expect(md).toMatch(/^# Experiment: Tracer study/)
    expect(md).toContain('## Verdict')
    expect(md).toMatch(/\| B \| .* \|/)
    expect(md).toContain('## KPIs')
    expect(md).toContain('Warm-up: 0 s (excluded from KPIs). Horizon: 3600 s of measured sim time per replicate.')
    expect(md).not.toContain('\u2014')
  })

  it('report.md shows the warm-up, the horizon and a yardStart warm-up warning (#316)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-exp-'))
    const out = join(dir, 'out')
    const file = writeExperiment(dir, {
      base: { fixture: 'landside-morning-peak' },
      warmUpS: 900,
      horizonS: 1800,
      seeds: [1],
      configs: [{ name: 'A', patch: { yardStart: { mode: 'warmup', warmUpS: 3600 } } }],
    })
    const { text } = cli(file, '--out', out)
    expect(text).toContain('Warning: Config "A": the scenario has a yardStart warm-up')
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    expect(report.expanded).toMatchObject({ warmUpS: 900, horizonS: 1800 })
    const md = readFileSync(join(out, 'report.md'), 'utf8')
    expect(md).toContain('Warm-up: 900 s (excluded from KPIs). Horizon: 1800 s of measured sim time per replicate.')
    expect(md).toMatch(/## Warnings\n\n- Config "A": the scenario has a yardStart warm-up \(3600 s\)/)
  })

  it('exits 1 when a config breaks an invariant, and report.md shows guards, every KPI and the invalid replicates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-exp-'))
    const out = join(dir, 'out')
    const file = writeExperiment(dir, {
      guards: [{ kpi: 'truckTurnaroundS', tolerance: { pct: 5 } }],
      configs: [{ name: 'A' }, { name: 'Broken' }],
    })
    const lines: string[] = []
    // Config "Broken" runs the deliberately wrong `broken-first-lane` handler set: a real engine invariant violation.
    const exitCode = runExperimentCli(['--out', out, file], (l) => lines.push(l), {
      executeReplicate: (plan) => executeReplicateHeadless(plan, plan.config === 'Broken' ? handlerSets['broken-first-lane'] : {}),
    })
    expect(exitCode).toBe(1)
    expect(lines.join('\n')).toMatch(/2 of 4 replicates invalid/)
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    expect(report.replicates.map((r: { config: string; status: string }) => `${r.config}:${r.status}`)).toEqual([
      'A:ok',
      'A:ok',
      'Broken:invalid: invariant',
      'Broken:invalid: invariant',
    ])
    const md = readFileSync(join(out, 'report.md'), 'utf8')
    expect(md).toContain('## Guards')
    expect(md).toMatch(/\| truckTurnaroundS \(s\) \| 5 % \| Broken \| insufficient data \|/)
    for (const kpi of Object.keys(EXPERIMENT_KPIS)) expect(md).toMatch(new RegExp(`\\| ${kpi} \\(`))
    expect(md).toMatch(/- Broken, seed 1: invalid: invariant/)
    expect(md).toMatch(/- Dropped from Broken pairing: seed 2 \(invalid: invariant\)/)
    expect(md).not.toContain('\u2014')
  })
})
