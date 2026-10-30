/**
 * Display formatting: locale (dates, times, numbers, first day of week) and
 * units (metric / imperial). Display only — the engine, scenario configs and
 * saves stay SI. Everything goes through the browser's built-in `Intl`.
 */
import type { DisplaySettings } from '../scenario/types'
import { t } from './messages'

export type { DisplaySettings, UnitSystem } from '../scenario/types'

export interface ClockParts {
  /** Short weekday, e.g. "Mon". */
  day: string
  date: string
  /** Time of day with seconds, in the locale's 12/24 h convention. */
  time: string
  /** Elapsed sim time, `T+hh:mm:ss` or `T+Nd hh:mm:ss`. */
  elapsed: string
}

/** 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface Formatter {
  readonly settings: DisplaySettings
  clock(startIso: string, simTimeS: number): ClockParts
  /** Date and time of day, e.g. for previews. */
  dateTime(date: Date): { date: string; time: string }
  /** Locale number formatting (grouping, decimal separator). */
  number(value: number, maxFractionDigits?: number): string
  /** Locale number with exactly `digits` fraction digits (min = max), for values that must not change width. */
  fixed(value: number, digits: number): string
  /** A length in metres, shown in m or ft. */
  length(metres: number): string
  /** A speed in m/s, shown in km/h or mi/h (never "mph": that is crane moves per hour). */
  speed(metresPerSecond: number): string
  /** A mass in metric tonnes, shown in t or US (short) tons. */
  mass(tonnes: number): string
  /** Unit-free measures: identical in both unit systems. */
  movesPerHour(value: number): string
  teu(value: number): string
  percent(value: number): string
  seconds(value: number): string
  /** A span of sim time: `45 s`, `12 min 05 s`, `3 h 20 min`. */
  duration(seconds: number): string
  /** First day of the locale's week (0 = Sunday). */
  firstDayOfWeek(): Weekday
  weekdayName(day: Weekday): string
}

const M_PER_FT = 0.3048
const M_PER_MILE = 1609.344
const KG_PER_US_TON = 907.18474

const pad = (n: number) => String(n).padStart(2, '0')

/** Regions whose week starts on Sunday or Saturday (CLDR), for browsers without `Intl.Locale#getWeekInfo`. */
const SUNDAY_REGIONS = new Set([
  'AG', 'AS', 'BD', 'BR', 'BS', 'BT', 'BW', 'BZ', 'CA', 'CO', 'DM', 'DO', 'ET', 'GT', 'GU', 'HK', 'HN', 'ID', 'IL', 'IN',
  'JM', 'JP', 'KE', 'KH', 'KR', 'LA', 'MH', 'MM', 'MO', 'MT', 'MX', 'MZ', 'NI', 'NP', 'PA', 'PE', 'PH', 'PK', 'PR', 'PT',
  'PY', 'SA', 'SG', 'SV', 'TH', 'TT', 'TW', 'UM', 'US', 'VE', 'VI', 'WS', 'YE', 'ZA', 'ZW',
])
const SATURDAY_REGIONS = new Set(['AE', 'AF', 'BH', 'DJ', 'DZ', 'EG', 'IQ', 'IR', 'JO', 'KW', 'LY', 'OM', 'QA', 'SD', 'SY'])

type LocaleWithWeekInfo = Intl.Locale & {
  getWeekInfo?: () => { firstDay: number }
  weekInfo?: { firstDay: number }
}

/** Region of a locale tag ("en" → "US" via likely subtags); undefined if unknown. */
export function localeRegion(locale: string): string | undefined {
  try {
    return new Intl.Locale(locale).maximize().region
  } catch {
    return undefined
  }
}

export function firstDayOfWeek(locale: string): Weekday {
  try {
    const loc = new Intl.Locale(locale) as LocaleWithWeekInfo
    const info = loc.getWeekInfo?.() ?? loc.weekInfo
    // Intl uses 1 = Monday … 7 = Sunday.
    if (info) return (info.firstDay % 7) as Weekday
  } catch {
    // fall through to the region table
  }
  const region = localeRegion(locale)
  if (region && SUNDAY_REGIONS.has(region)) return 0
  if (region && SATURDAY_REGIONS.has(region)) return 6
  return 1
}

/** A valid, canonical locale tag, or the fallback. */
export function canonicalLocale(locale: string | undefined, fallback = 'en-GB'): string {
  if (!locale) return fallback
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? fallback
  } catch {
    return fallback
  }
}

export function createFormatter(settings: DisplaySettings): Formatter {
  const locale = canonicalLocale(settings.locale)
  const imperial = settings.units === 'imperial'
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const timeFmt = new Intl.DateTimeFormat(locale, { timeStyle: 'medium' })
  const numberFmts = new Map<number, Intl.NumberFormat>()

  const number = (value: number, maxFractionDigits = 1): string => {
    let fmt = numberFmts.get(maxFractionDigits)
    if (!fmt) {
      fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: maxFractionDigits })
      numberFmts.set(maxFractionDigits, fmt)
    }
    return fmt.format(value)
  }

  const fixedFmts = new Map<number, Intl.NumberFormat>()
  const fixed = (value: number, digits: number): string => {
    let fmt = fixedFmts.get(digits)
    if (!fmt) {
      fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
      fixedFmts.set(digits, fmt)
    }
    return fmt.format(value)
  }

  return {
    settings: { locale, units: settings.units },
    clock(startIso, simTimeS) {
      const d = new Date(new Date(startIso).getTime() + simTimeS * 1000)
      const s = Math.max(0, Math.floor(simTimeS))
      const days = Math.floor(s / 86400)
      const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
      return {
        day: weekdayFmt.format(d),
        date: dateFmt.format(d),
        time: timeFmt.format(d),
        elapsed: days > 0 ? t('clock.elapsedDays', { days, hms }) : t('clock.elapsed', { hms }),
      }
    },
    dateTime: (date) => ({ date: dateFmt.format(date), time: timeFmt.format(date) }),
    number,
    fixed,
    length: (m) => (imperial ? t('unit.ft', { value: number(m / M_PER_FT, 0) }) : t('unit.m', { value: number(m, 1) })),
    speed: (mps) =>
      imperial
        ? t('unit.mih', { value: number((mps * 3600) / M_PER_MILE, 1) })
        : t('unit.kmh', { value: number(mps * 3.6, 1) }),
    mass: (tonnes) =>
      imperial ? t('unit.usTons', { value: number((tonnes * 1000) / KG_PER_US_TON, 1) }) : t('unit.t', { value: number(tonnes, 1) }),
    movesPerHour: (v) => t('unit.movesPerHour', { value: number(v, 1) }),
    teu: (v) => t('unit.teu', { value: number(v, 0) }),
    percent: (v) => t('unit.percent', { value: number(v, 1) }),
    seconds: (v) => t('unit.seconds', { value: number(v, 1) }),
    duration: (s) => {
      const total = Math.max(0, Math.round(s))
      if (total < 60) return t('unit.seconds', { value: number(total, 0) })
      if (total < 3600) return t('unit.durationMin', { min: number(Math.floor(total / 60), 0), sec: pad(total % 60) })
      return t('unit.durationHour', { hour: number(Math.floor(total / 3600), 0), min: pad(Math.floor((total % 3600) / 60)) })
    },
    firstDayOfWeek: () => firstDayOfWeek(locale),
    weekdayName(day) {
      // 4 Jan 1970 was a Sunday.
      return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(Date.UTC(1970, 0, 4 + day))
    },
  }
}
