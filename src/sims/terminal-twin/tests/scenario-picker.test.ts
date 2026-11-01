import { describe, expect, it } from 'vitest'
import { catalogues } from '../i18n/messages'
import { layoutSketch, pickerModel, presetCopy, scenarioDurationS, scenarioStats, statChips } from '../modules/scenarioPicker'
import { PEAK_DAY_PRESET_NAME, presets } from '../scenario/presets'
import { fixtures } from '../scenario/fixtures'
import { FIXTURE_GROUPS, fixtureCopy, fixtureDefinitions } from '../scenario/fixtures/definitions'
import { scenarioCatalogue } from '../store/twinStore'

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

  it('has a plain name, group, summary, description and watch hint for every fixture', () => {
    expect(Object.keys(fixtureCopy).sort()).toEqual(Object.keys(fixtures).sort())
    expect(Object.keys(fixtureDefinitions).sort()).toEqual(Object.keys(fixtures).sort())
    const groups = new Set<string>(FIXTURE_GROUPS.map((g) => g.id))
    const names = new Set<string>()
    for (const [id, copy] of Object.entries(fixtureCopy)) {
      expect(groups.has(copy.group), id).toBe(true)
      expect(copy.name.length, id).toBeGreaterThan(3)
      expect(copy.name, `${id} shows its technical id as a name`).not.toBe(id)
      expect(copy.summary.length, id).toBeGreaterThan(15)
      expect(copy.description.length, id).toBeGreaterThan(40)
      expect(copy.watch.length, id).toBeGreaterThan(15)
      expect(names.has(copy.name), `duplicate name ${copy.name}`).toBe(false)
      names.add(copy.name)
    }
  })

  it('groups the catalogue into Scenarios and Test benches, with counts from the data', () => {
    const catalogue = scenarioCatalogue()
    const model = pickerModel(catalogue)
    expect(model.scenarios.map((s) => s.id).sort()).toEqual(Object.keys(presets).sort())
    expect(model.scenarios[0]!.id).toBe('Small automated')
    expect(model.benchCount).toBe(Object.keys(fixtures).length)
    expect(model.benches.map((g) => g.title)).toEqual(['Container flows', 'Quay and ships', 'Shuttle carriers', 'Yard and cranes', 'Gate and trucks'])
    expect(model.benches.flatMap((g) => g.items).map((i) => i.id).sort()).toEqual(Object.keys(fixtures).sort())
    for (const item of [...model.scenarios, ...model.benches.flatMap((g) => g.items)]) {
      expect(item.name, item.id).not.toBe(item.id)
      expect(item.description.length, item.id).toBeGreaterThan(40)
      expect(item.watch.length, item.id).toBeGreaterThan(15)
    }
  })

  it('keeps the technical id as the item id, never as its name (names are display only)', () => {
    const model = pickerModel(scenarioCatalogue())
    const small = model.scenarios.find((s) => s.id === 'Small automated')!
    expect(small.name).toBe('Small terminal')
    expect(presets['Small automated']!().name).toBe('Small automated')
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
