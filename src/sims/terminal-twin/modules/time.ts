/** Scenario clock helpers (sim time is seconds from the scenario's start date/time). */

/** Monday 06:00 (local time) of the week containing `now`. */
export function defaultStartDate(now = new Date()): Date {
  const d = new Date(now)
  const sinceMonday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - sinceMonday)
  d.setHours(6, 0, 0, 0)
  return d
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DDTHH:mm` in local time, for `<input type="datetime-local">`. */
export function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Parse a datetime-local value (local time); null if invalid. */
export function fromLocalInputValue(value: string): Date | null {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function simDate(startIso: string, simTimeS: number): Date {
  return new Date(new Date(startIso).getTime() + simTimeS * 1000)
}

export interface ClockParts {
  day: string
  date: string
  time: string
  /** Elapsed sim time as `d hh:mm:ss` / `hh:mm:ss`. */
  elapsed: string
}

export function clockParts(startIso: string, simTimeS: number, locale?: string): ClockParts {
  const d = simDate(startIso, simTimeS)
  const s = Math.floor(simTimeS)
  const days = Math.floor(s / 86400)
  const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
  return {
    day: d.toLocaleDateString(locale, { weekday: 'short' }),
    date: d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    elapsed: days > 0 ? `${days}d ${hms}` : hms,
  }
}
