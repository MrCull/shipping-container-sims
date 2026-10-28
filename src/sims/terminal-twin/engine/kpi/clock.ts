/**
 * KPI time buckets: hours cut on the scenario's wall clock and shifts of
 * 8 h (3 per day) made of whole hours. Pure functions; the clock comes from
 * `config.kpi` or, by default, from `config.startDateTime` read in UTC so a
 * run is identical on every machine. The browser sets `kpi.startTimeOfDayS`
 * from the user's local start time so shifts match the clock they see.
 */
import type { ScenarioConfig } from '../../scenario/types'

export const HOUR_S = 3600
export const SHIFT_S = 8 * HOUR_S
export const DAY_S = 24 * HOUR_S
export const DEFAULT_SHIFT_START_HOUR = 6

export interface KpiClock {
  /** Seconds since clock midnight at sim t = 0. */
  startTimeOfDayS: number
  /** Clock hour (0-23) at which shift 1 starts. */
  shiftStartHour: number
}

export interface HourBucket {
  /** 0-based index (the array position). */
  index: number
  /** Sim seconds covered (the first bucket starts at 0, the last may be partial). */
  startS: number
  endS: number
  /** Clock hour 0-23 and clock day (0 = the day the run starts). */
  hourOfDay: number
  clockDay: number
}

export interface ShiftBucket {
  index: number
  /** 1, 2 or 3 (shift 1 starts at `shiftStartHour`). */
  shiftOfDay: 1 | 2 | 3
  /** Clock day the shift started on (a night shift spans midnight). */
  clockDay: number
  startS: number
  endS: number
  /** Hour buckets (inclusive indices) the shift contains. */
  firstHour: number
  lastHour: number
}

export function kpiClockOf(config: ScenarioConfig): KpiClock {
  const d = new Date(config.startDateTime)
  const utc = Number.isNaN(d.getTime()) ? 0 : d.getUTCHours() * HOUR_S + d.getUTCMinutes() * 60 + d.getUTCSeconds()
  return {
    startTimeOfDayS: config.kpi?.startTimeOfDayS ?? utc,
    shiftStartHour: config.kpi?.shiftStartHour ?? DEFAULT_SHIFT_START_HOUR,
  }
}

const firstAbsHour = (c: KpiClock) => Math.floor(c.startTimeOfDayS / HOUR_S)

/** Index of the hour bucket holding sim time `t`. */
export function hourIndexOf(c: KpiClock, t: number): number {
  return Math.floor((c.startTimeOfDayS + t) / HOUR_S) - firstAbsHour(c)
}

/** Hour buckets covering [0, elapsedS] (at least one; none empty at the end). */
export function hourBuckets(c: KpiClock, elapsedS: number): HourBucket[] {
  const first = firstAbsHour(c)
  const count = Math.max(1, Math.ceil((c.startTimeOfDayS + elapsedS) / HOUR_S) - first)
  return Array.from({ length: count }, (_, index) => {
    const abs = first + index
    return {
      index,
      startS: Math.max(0, abs * HOUR_S - c.startTimeOfDayS),
      endS: Math.min(elapsedS, (abs + 1) * HOUR_S - c.startTimeOfDayS),
      hourOfDay: ((abs % 24) + 24) % 24,
      clockDay: Math.floor(abs / 24),
    }
  })
}

/** Shifts made of the given hour buckets. */
export function shiftBuckets(c: KpiClock, hours: HourBucket[], elapsedS: number): ShiftBucket[] {
  const first = firstAbsHour(c)
  const out: ShiftBucket[] = []
  let currentKey: number | null = null
  for (const h of hours) {
    const abs = first + h.index
    const key = Math.floor((abs * HOUR_S - c.shiftStartHour * HOUR_S) / SHIFT_S)
    if (key !== currentKey) {
      currentKey = key
      out.push({
        index: out.length,
        shiftOfDay: ((((key % 3) + 3) % 3) + 1) as 1 | 2 | 3,
        clockDay: Math.floor((key * SHIFT_S + c.shiftStartHour * HOUR_S) / DAY_S),
        startS: h.startS,
        endS: h.endS,
        firstHour: h.index,
        lastHour: h.index,
      })
    }
    const s = out[out.length - 1]
    s.endS = Math.min(elapsedS, h.endS)
    s.lastHour = h.index
  }
  return out
}
