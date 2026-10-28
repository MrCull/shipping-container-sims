import { describe, expect, it } from 'vitest'
import { hourBuckets, hourIndexOf, kpiClockOf, shiftBuckets } from '../engine/kpi/clock'
import { ScenarioBuilder } from '../scenario/builder'

const clock = (startTimeOfDayS: number, shiftStartHour = 6) => ({ startTimeOfDayS, shiftStartHour })

describe('KPI clock buckets (hour and 3 x 8 h shift, aligned to the scenario clock)', () => {
  it('takes the start time of day from startDateTime (UTC) unless the config says otherwise', () => {
    const base = new ScenarioBuilder('x', 'x').startAt('2026-01-05T06:30:00Z').build()
    expect(kpiClockOf(base)).toEqual({ startTimeOfDayS: 6.5 * 3600, shiftStartHour: 6 })
    expect(kpiClockOf({ ...base, kpi: { startTimeOfDayS: 3600, shiftStartHour: 7 } })).toEqual({ startTimeOfDayS: 3600, shiftStartHour: 7 })
  })

  it('cuts hours on the wall clock: a 06:30 start gives a half-hour first bucket', () => {
    const c = clock(6.5 * 3600)
    expect(hourIndexOf(c, 0)).toBe(0)
    expect(hourIndexOf(c, 1799.9)).toBe(0)
    expect(hourIndexOf(c, 1800)).toBe(1)
    const hours = hourBuckets(c, 2 * 3600)
    expect(hours.map((h) => [h.startS, h.endS, h.hourOfDay])).toEqual([
      [0, 1800, 6],
      [1800, 5400, 7],
      [5400, 7200, 8],
    ])
  })

  it('does not add an empty bucket when the run ends exactly on an hour boundary', () => {
    expect(hourBuckets(clock(0), 3600)).toHaveLength(1)
    expect(hourBuckets(clock(0), 3600.5)).toHaveLength(2)
    expect(hourBuckets(clock(0), 0)).toHaveLength(1)
  })

  it('crosses midnight: hour of day wraps and the clock day increments', () => {
    const hours = hourBuckets(clock(22 * 3600), 4 * 3600)
    expect(hours.map((h) => [h.hourOfDay, h.clockDay])).toEqual([
      [22, 0],
      [23, 0],
      [0, 1],
      [1, 1],
    ])
  })

  it('groups hours into 06-14, 14-22, 22-06 shifts and a night shift spans midnight', () => {
    // start 20:00, run 36 h
    const c = clock(20 * 3600)
    const hours = hourBuckets(c, 36 * 3600)
    const shifts = shiftBuckets(c, hours, 36 * 3600)
    expect(shifts.map((s) => [s.shiftOfDay, s.startS, s.endS, s.clockDay])).toEqual([
      [2, 0, 2 * 3600, 0], // 20:00-22:00 tail of the afternoon shift
      [3, 2 * 3600, 10 * 3600, 0], // night shift 22:00-06:00, starts on day 0
      [1, 10 * 3600, 18 * 3600, 1], // 06:00-14:00 day 1
      [2, 18 * 3600, 26 * 3600, 1],
      [3, 26 * 3600, 34 * 3600, 1], // night shift starting day 1 22:00
      [1, 34 * 3600, 36 * 3600, 2],
    ])
    expect(shifts[1].firstHour).toBe(2)
    expect(shifts[1].lastHour).toBe(9)
    // every hour belongs to exactly one shift
    const covered = shifts.flatMap((s) => Array.from({ length: s.lastHour - s.firstHour + 1 }, (_, i) => s.firstHour + i))
    expect(covered).toEqual(hours.map((h) => h.index))
  })

  it('honours a different first-shift hour', () => {
    const c = clock(0, 0)
    const shifts = shiftBuckets(c, hourBuckets(c, 24 * 3600), 24 * 3600)
    expect(shifts.map((s) => [s.shiftOfDay, s.startS])).toEqual([
      [1, 0],
      [2, 8 * 3600],
      [3, 16 * 3600],
    ])
  })
})
