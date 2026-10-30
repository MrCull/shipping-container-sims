/**
 * Scenario clock helpers (sim time is seconds from the scenario's start date/time).
 * Locale-aware clock text lives in `i18n/format.ts` (`Formatter.clock`).
 */

/** Monday 08:00 (local time, daylight) of the week containing `now`. */
export function defaultStartDate(now = new Date()): Date {
  const d = new Date(now)
  const sinceMonday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - sinceMonday)
  d.setHours(8, 0, 0, 0)
  return d
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DDTHH:mm[:ss]` in local time: the value a date field holds (`LocaleDateTimeInput` shows it in the chosen locale). */
export function toLocalInputValue(d: Date, seconds = false): string {
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  return seconds ? `${base}:${pad(d.getSeconds())}` : base
}

/** Parse a local date-time value (local time); null if invalid. */
export function fromLocalInputValue(value: string): Date | null {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function simDate(startIso: string, simTimeS: number): Date {
  return new Date(new Date(startIso).getTime() + simTimeS * 1000)
}
