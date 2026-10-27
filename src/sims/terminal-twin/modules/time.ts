/**
 * Scenario clock helpers (sim time is seconds from the scenario's start date/time).
 * Locale-aware clock text lives in `i18n/format.ts` (`Formatter.clock`).
 */

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
