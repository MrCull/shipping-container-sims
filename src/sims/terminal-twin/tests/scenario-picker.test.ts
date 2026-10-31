import { describe, expect, it } from 'vitest'
import { catalogues } from '../i18n/messages'
import { fixtureRow, layoutSketch, presetCopy, scenarioDurationS, scenarioStats, statChips } from '../modules/scenarioPicker'
import { PEAK_DAY_PRESET_NAME, presets } from '../scenario/presets'
import { fixtures } from '../scenario/fixtures'

describe('scenario picker display model', () => {
  it('derives the chips of every preset from its config', () => {
    const peak = scenarioStats(presets[PEAK_DAY_PRESET_NAME]())
    expect(peak).toMatchObject({ blocks: 16, vessels: 5, sts: 8, shcs: 23, yardFillPct: 75 })
    const baseline = scenarioStats(presets['TTI Algeciras baseline']())
    expect(peak.trucksPerHour).toBeGreaterThan(2 * baseline.trucksPerHour)
    const chips = statChips(peak)
    expect(chips.map((c) => c.id)).toEqual(['blocks', 'vessels', 'sts', 'shcs', 'trucks', 'fill'])
  })

  it('leaves out chips that do not apply', () => {
    const row = scenarioStats(fixtures['tracer-1sts-10-boxes'])
    expect(statChips(row).map((c) => c.id)).toEqual(['vessels', 'sts'])
  })

  it('builds a fixture row for each fixture', () => {
    for (const [name, config] of Object.entries(fixtures)) {
      const row = fixtureRow(name, config)
      expect(row.sts).toBe(config.sts.length)
      expect(row.landside).toBe(config.landside !== undefined)
    }
  })

  it('sketches quay, blocks, STS and gate from the config', () => {
    const sketch = layoutSketch(presets['Small automated']())
    expect(sketch?.blocks).toHaveLength(6)
    expect(sketch?.sts).toHaveLength(3)
    expect(sketch?.gate).not.toBeNull()
    expect(sketch?.viewBox.split(' ')).toHaveLength(4)
  })

  it('has catalogue copy for every preset, without the old name', () => {
    for (const name of Object.keys(presets)) {
      const copy = presetCopy(name)
      expect(copy, name).not.toBeNull()
      expect(catalogues.en[copy!.description].length).toBeGreaterThan(20)
    }
    expect(Object.keys(presets)).not.toContain('Stress test')
  })

  it('estimates the run length: the stated end time, else the last arrival plus mooring and work', () => {
    const peak = presets[PEAK_DAY_PRESET_NAME]()
    const lastArrival = Math.max(...peak.vessels.map((v) => v.arrivalS))
    expect(scenarioDurationS(peak)).toBeGreaterThan(lastArrival + 1800)
    expect(scenarioDurationS({ ...peak, endConditions: { simDurationS: 7200 } })).toBe(7200)
    for (const name of Object.keys(presets)) expect(scenarioDurationS(presets[name]!())).toBeGreaterThan(0)
  })
})
