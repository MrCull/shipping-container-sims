import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { planExperiment, runExperiment, type ExperimentFile } from '../cli/experiment'

/** The checked-in example experiments (#318), read as a user would pass them to `tt:experiment`. */
function example(name: string): ExperimentFile {
  return JSON.parse(readFileSync(new URL(`../experiments/${name}`, import.meta.url), 'utf8')) as ExperimentFile
}

describe('example experiments (#318)', () => {
  it('the grid example runs on its short fixture: the fixture plus 4 grid configs, every replicate ok, a verdict each', () => {
    const report = runExperiment(example('yard-shc-grid.json'))
    const two = '[{"id":"SHC01"},{"id":"SHC02"}]'
    const four = '[{"id":"SHC01"},{"id":"SHC02"},{"id":"SHC03"},{"id":"SHC04"}]'
    expect(report.expanded.configs.map((c) => c.name)).toEqual([
      'fixture',
      `yardAllocation=nearest-wtp,shcs=${two}`,
      `yardAllocation=nearest-wtp,shcs=${four}`,
      `yardAllocation=grouped,shcs=${two}`,
      `yardAllocation=grouped,shcs=${four}`,
    ])
    expect(report.expanded.warmUpS).toBe(0)
    expect(report.replicates.length).toBe(5 * report.expanded.seeds.length)
    expect(report.replicates.every((r) => r.status === 'ok')).toBe(true)
    expect(report.replicates.every((r) => (r.kpis.movesDone ?? 0) > 0)).toBe(true)
    expect(Object.keys(report.primary.verdicts)).toHaveLength(4)
    expect(Object.values(report.primary.verdicts)).not.toContain('insufficient data')
  }, 60_000)

  it('the strategy study example validates against the TTI Algeciras baseline preset', () => {
    const plan = planExperiment(example('pad-selection-baseline.json'))
    expect(plan.configs.map((c) => c.name)).toEqual(['balanced', 'nearest-box'])
    expect(plan.baseline).toBe('balanced')
    expect(plan.replicates).toHaveLength(20)
    expect(plan.replicates[10].scenario.decisions!.points!.wtpPadSelection).toMatchObject({ strategy: 'nearest-box' })
  })
})
