/**
 * Plain names only (#156): no technical id reaches visible text. The default save name, imported-config save names
 * and download file names use the plain fixture or preset name; a fresh load selects the TTI baseline on the
 * Scenarios tab. Seams: the pure save module, the picker model and the store.
 */
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { defaultSaveName, exportFileName, parseSaveFile, saveFileName, makeConfigSave } from '../persistence/saves'
import { DEFAULT_SCENARIO_NAME, pickerModel, pickerSectionOf, scenarioDisplayName } from '../modules/scenarioPicker'
import { fixtures } from '../scenario/fixtures'
import { presets, TTI_PRESET_NAME } from '../scenario/presets'
import { scenarioCatalogue, useTwinStore } from '../store/twinStore'

const TRACER = 'tracer-1sts-10-boxes'

describe('plain scenario names', () => {
  it('names presets and fixtures by their plain name, and keeps an unknown name as it is', () => {
    expect(scenarioDisplayName(TTI_PRESET_NAME)).toBe('Algeciras: a normal day')
    expect(scenarioDisplayName(TRACER)).not.toBe(TRACER)
    expect(scenarioDisplayName(TRACER).length).toBeGreaterThan(3)
    expect(scenarioDisplayName('My own terminal')).toBe('My own terminal')
  })

  it('never puts a technical id in the visible text of the start screen list or detail copy', () => {
    const catalogue = scenarioCatalogue()
    const model = pickerModel(catalogue)
    const items = [...model.scenarios, ...model.benches.flatMap((g) => g.items)]
    for (const item of items) {
      const text = [item.name, item.summary, item.description, item.watch].join(' | ')
      for (const c of catalogue) expect(text, `${item.id} shows ${c.name}`).not.toContain(c.name)
    }
  })

  it('builds the default save name from the plain name and the seed (plus elapsed time for a snapshot)', () => {
    const plain = scenarioDisplayName(TRACER)
    expect(defaultSaveName(TRACER, 7)).toBe(`${plain} / seed 7`)
    expect(defaultSaveName(TRACER, 7, '01:02:03')).toBe(`${plain} / seed 7 / 01:02:03`)
    expect(defaultSaveName(TRACER, 7)).not.toContain(TRACER)
  })

  it('slugifies the plain name for the download file name', () => {
    expect(exportFileName(TTI_PRESET_NAME, 2026, 'kpi-report.json')).toBe('algeciras-a-normal-day-seed2026-kpi-report.json')
    expect(exportFileName(TRACER, 1, 'events.csv')).not.toContain(TRACER)
    expect(saveFileName(makeConfigSave(defaultSaveName(TTI_PRESET_NAME, 11), fixtures[TRACER], 11))).toBe('algeciras-a-normal-day-seed-11.tt-config.json')
  })

  it('names an imported bare config by its plain name; the config keeps the technical id', () => {
    const parsed = parseSaveFile(JSON.stringify(fixtures[TRACER]))
    expect(parsed.name).toBe(scenarioDisplayName(TRACER))
    expect(parsed.config.name).toBe(TRACER)
  })
})

describe('default selection', () => {
  it('is the TTI baseline preset, which the picker lists under Scenarios', () => {
    expect(DEFAULT_SCENARIO_NAME).toBe(TTI_PRESET_NAME)
    expect(pickerSectionOf(pickerModel(scenarioCatalogue()), DEFAULT_SCENARIO_NAME)).toBe('scenarios')
    expect(pickerSectionOf(pickerModel(scenarioCatalogue()), TRACER)).toBe('benches')
  })

  it('a fresh store selects the baseline with its own seed', () => {
    setActivePinia(createPinia())
    const store = useTwinStore()
    expect(store.choice.name).toBe(TTI_PRESET_NAME)
    expect(store.choice.seed).toBe(presets[TTI_PRESET_NAME]!().seed)
  })
})
