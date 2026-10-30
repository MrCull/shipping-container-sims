/**
 * Locale/units defaults and how they are stored with a scenario config.
 * Units are display-only: the config handed to the engine (and saved) stays SI.
 */
import { describe, expect, it } from 'vitest'
import { browserDisplayDefaults, loadDisplaySettings, runConfigFor, saveDisplaySettings } from '../i18n/display'
import { createFormatter } from '../i18n/format'
import { fixtures } from '../scenario/fixtures'
import { createSimulation } from '../engine'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

describe('browser defaults', () => {
  it('a US browser gets its locale and imperial units', () => {
    expect(browserDisplayDefaults(['en-US', 'en'])).toEqual({ locale: 'en-US', units: 'imperial' })
  })

  it('a bare language uses its likely region ("en" → US)', () => {
    expect(browserDisplayDefaults(['en'])).toEqual({ locale: 'en', units: 'imperial' })
  })

  it('everywhere else is metric', () => {
    expect(browserDisplayDefaults(['en-GB'])).toEqual({ locale: 'en-GB', units: 'metric' })
    expect(browserDisplayDefaults(['de-DE', 'en-US'])).toEqual({ locale: 'de-DE', units: 'metric' })
  })

  it('no usable browser language falls back to en-GB, metric', () => {
    expect(browserDisplayDefaults([])).toEqual({ locale: 'en-GB', units: 'metric' })
    expect(browserDisplayDefaults(['not a locale!'])).toEqual({ locale: 'en-GB', units: 'metric' })
  })
})

describe('remembered settings', () => {
  it('first open uses the browser defaults; later opens use what was chosen', () => {
    const storage = memoryStorage()
    expect(loadDisplaySettings(storage, ['en-US'])).toEqual({ locale: 'en-US', units: 'imperial' })
    saveDisplaySettings(storage, { locale: 'de-DE', units: 'metric' })
    expect(loadDisplaySettings(storage, ['en-US'])).toEqual({ locale: 'de-DE', units: 'metric' })
  })

  it('corrupt or unavailable storage falls back to the browser defaults', () => {
    const storage = memoryStorage()
    storage.setItem('terminal-twin.display', '{"locale": 42')
    expect(loadDisplaySettings(storage, ['en-GB'])).toEqual({ locale: 'en-GB', units: 'metric' })
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadDisplaySettings(throwing, ['en-GB'])).toEqual({ locale: 'en-GB', units: 'metric' })
    expect(() => saveDisplaySettings(throwing, { locale: 'en-GB', units: 'metric' })).not.toThrow()
  })
})

describe('the run config stores locale and units, and stays SI', () => {
  const base = fixtures['tracer-1sts-10-boxes']

  it('the KPI clock starts at the local time of day of the start, so shifts match the clock the user sees', () => {
    const iso = '2026-10-26T05:00:00.000Z'
    const d = new Date(iso)
    const config = runConfigFor(base, iso, { locale: 'en-GB', units: 'metric' })
    expect(config.kpi?.startTimeOfDayS).toBe(d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds())
  })

  it('imperial changes what is displayed, not the config or the engine', () => {
    const imperial = runConfigFor(base, '2026-10-26T05:00:00.000Z', { locale: 'en-US', units: 'imperial' })
    const metric = runConfigFor(base, '2026-10-26T05:00:00.000Z', { locale: 'en-GB', units: 'metric' })

    expect(imperial.display).toEqual({ locale: 'en-US', units: 'imperial' })
    expect(metric.display).toEqual({ locale: 'en-GB', units: 'metric' })
    // Every physical value is still SI, identical to the fixture.
    const imperialRest: Partial<typeof imperial> = { ...imperial }
    const metricRest: Partial<typeof metric> = { ...metric }
    delete imperialRest.display
    delete metricRest.display
    // the KPI clock follows the local time of the start (checked in its own test), not units
    delete imperialRest.kpi
    delete metricRest.kpi
    expect(imperialRest).toEqual({ ...base, startDateTime: '2026-10-26T05:00:00.000Z' })
    expect(metricRest).toEqual(imperialRest)
    // The base fixture is not mutated.
    expect(base.display).toBeUndefined()

    // Only the formatted text differs.
    expect(createFormatter(imperial.display!).length(imperial.quay.lengthM)).toMatch(/ ft$/)
    expect(createFormatter(metric.display!).length(metric.quay.lengthM)).toBe(`${metric.quay.lengthM} m`)

    // The engine runs identically and its snapshot keeps the SI config with the display settings.
    const a = createSimulation(imperial)
    const b = createSimulation(metric)
    a.runUntil()
    b.runUntil()
    expect(a.eventLogHash()).toBe(b.eventLogHash())
    const snap = a.snapshot()
    expect(snap.config.quay.lengthM).toBe(base.quay.lengthM)
    expect(snap.config.display).toEqual({ locale: 'en-US', units: 'imperial' })
  })
})
