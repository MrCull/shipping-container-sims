/**
 * Display formatting (locale + units). This is the contract the top bar, the
 * setup dialog and every later readout use: the engine stays SI, the
 * formatter turns SI values into the user's conventions.
 */
import { describe, expect, it } from 'vitest'
import { createFormatter } from '../i18n/format'

// Monday 26 Oct 2026, 06:00 local time (the clock shows local time).
const START = new Date(2026, 9, 26, 6, 0, 0).toISOString()
// 8 h 2 min 3 s later → 14:02:03 local
const T = 3600 + 120 + 3 + 7 * 3600

describe('clock formatting follows the locale', () => {
  it('en-GB: 24 h clock, day-month-year date', () => {
    const clock = createFormatter({ locale: 'en-GB', units: 'metric' }).clock(START, T)
    expect(clock.day).toBe('Mon')
    expect(clock.date).toBe('26 Oct 2026')
    expect(clock.time).toBe('14:02:03')
    expect(clock.elapsed).toBe('T+08:02:03')
  })

  it('en-US: 12 h clock with AM/PM, month-day-year date', () => {
    const clock = createFormatter({ locale: 'en-US', units: 'imperial' }).clock(START, T)
    expect(clock.day).toBe('Mon')
    expect(clock.date).toBe('Oct 26, 2026')
    expect(clock.time.replace(/\s/g, ' ')).toBe('2:02:03 PM')
  })

  it('de-DE: German weekday, dotted date, 24 h clock', () => {
    const clock = createFormatter({ locale: 'de-DE', units: 'metric' }).clock(START, T)
    expect(clock.day).toMatch(/^Mo\.?$/) // ICU versions differ on the dot
    expect(clock.date).toBe('26.10.2026')
    expect(clock.time).toBe('14:02:03')
  })

  it('elapsed time shows whole days once a day has passed', () => {
    const clock = createFormatter({ locale: 'en-GB', units: 'metric' }).clock(START, 2 * 86400 + 61)
    expect(clock.elapsed).toBe('T+2d 00:01:01')
  })
})

describe('number formatting follows the locale', () => {
  it('grouping and decimal separators', () => {
    expect(createFormatter({ locale: 'en-GB', units: 'metric' }).number(12345.678, 2)).toBe('12,345.68')
    expect(createFormatter({ locale: 'de-DE', units: 'metric' }).number(12345.678, 2)).toBe('12.345,68')
  })

  it('first day of week: Monday in en-GB and de-DE, Sunday in en-US', () => {
    expect(createFormatter({ locale: 'en-GB', units: 'metric' }).firstDayOfWeek()).toBe(1)
    expect(createFormatter({ locale: 'de-DE', units: 'metric' }).firstDayOfWeek()).toBe(1)
    expect(createFormatter({ locale: 'en-US', units: 'metric' }).firstDayOfWeek()).toBe(0)
    expect(createFormatter({ locale: 'en-US', units: 'metric' }).weekdayName(0)).toBe('Sunday')
  })
})

describe('units change the displayed value only', () => {
  const metric = createFormatter({ locale: 'en-GB', units: 'metric' })
  const imperial = createFormatter({ locale: 'en-GB', units: 'imperial' })

  it('lengths: metres or feet', () => {
    expect(metric.length(400)).toBe('400 m')
    expect(imperial.length(400)).toBe('1,312 ft')
  })

  it('speeds: km/h or mi/h (never "mph", which means crane moves per hour)', () => {
    expect(metric.speed(3)).toBe('10.8 km/h')
    expect(imperial.speed(3)).toBe('6.7 mi/h')
    expect(imperial.speed(3)).not.toMatch(/mph/)
  })

  it('masses: tonnes or US tons', () => {
    expect(metric.mass(30)).toBe('30 t')
    expect(imperial.mass(30)).toBe('33.1 US tons')
  })

  it('unit-free measures look the same in both systems', () => {
    expect(imperial.movesPerHour(32.94)).toBe(metric.movesPerHour(32.94))
    expect(metric.movesPerHour(32.94)).toBe('32.9 moves/h')
    expect(imperial.teu(28647)).toBe('28,647 TEU')
  })
})
