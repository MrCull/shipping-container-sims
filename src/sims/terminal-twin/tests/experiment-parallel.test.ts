import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runExperiment, type ExperimentFile, type ExperimentReport } from '../cli/experiment'

const experiment: ExperimentFile = {
  format: 'terminal-twin-experiment',
  version: 1,
  name: 'Parallel tracer',
  base: { fixture: 'tracer-1sts-10-boxes' },
  horizonS: 3600,
  warmUpS: 0,
  seeds: [1, 2, 3],
  primary: { kpi: 'grossMovesPerHour' },
  configs: [{ name: 'A' }, { name: 'B', strategies: { shcDispatch: 'nearest-job' } }],
}

/** Everything in a report but the timing fields (provenance times and per-replicate wall ms). */
const numbers = (r: ExperimentReport) => ({
  replicates: r.replicates.map((x) => ({ ...x, wallMs: 0 })),
  comparisons: r.comparisons,
  primary: r.primary,
  guards: r.guards,
  droppedSeeds: r.droppedSeeds,
})

describe('tt:experiment --jobs 2 (real process)', () => {
  it('gives the same report numbers as the in-process sequential run, and writes every replicate summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-exp-par-'))
    const file = join(dir, 'exp.json')
    const out = join(dir, 'out')
    writeFileSync(file, JSON.stringify(experiment))
    // BG_HEAVY_HELD=1: a test must not wait behind a heavy job elsewhere on the machine (the lock has its own test).
    // The tt:experiment script's own command (tsx on the entry), run as a separate process.
    const entry = fileURLToPath(new URL('../cli/experimentRun.ts', import.meta.url))
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', entry, file, '--jobs', '2', '--yes', '--out', out], {
      encoding: 'utf8',
      env: { ...process.env, BG_HEAVY_HELD: '1' },
    })
    expect(stdout).toMatch(/6\/6 replicates done, 0 invalid/)
    const parallel = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as ExperimentReport
    const sequential = runExperiment(experiment)
    expect(numbers(parallel)).toEqual(numbers(sequential))
    for (const config of ['A', 'B']) for (const seed of [1, 2, 3]) expect(existsSync(join(out, 'replicates', config, `${seed}.summary.json`))).toBe(true)
  })
})
