/**
 * Locale-aware date and time entry (V11-17). Text for `<input>`s that reads
 * and writes in the chosen locale's field order, separators and 12/24 h
 * convention, derived from `Intl.DateTimeFormat#formatToParts`. The value a
 * form holds stays the local ISO string (`YYYY-MM-DDTHH:mm[:ss]`, see
 * `modules/time.ts`); only what the person sees and types is localised.
 */
import { canonicalLocale } from './format'

type Field = 'day' | 'month' | 'year' | 'hour' | 'minute' | 'second' | 'dayPeriod'
type Token = { field: Field } | { literal: string }

interface Pattern {
  tokens: Token[]
  hour12: boolean
  /** Locale text for AM and PM. */
  am: string
  pm: string
}

const FIELDS: ReadonlySet<string> = new Set(['day', 'month', 'year', 'hour', 'minute', 'second', 'dayPeriod'])
const cache = new Map<string, Pattern>()

function periodText(locale: string, hour: number): string {
  const parts = new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: true }).formatToParts(new Date(2026, 0, 1, hour))
  return parts.find((x) => x.type === 'dayPeriod')?.value ?? ''
}

function patternFor(localeTag: string, seconds: boolean): Pattern {
  const locale = canonicalLocale(localeTag)
  const key = `${locale}|${seconds}`
  const hit = cache.get(key)
  if (hit) return hit
  const fmt = new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    ...(seconds ? { second: '2-digit' as const } : {}),
  })
  const tokens: Token[] = []
  for (const p of fmt.formatToParts(new Date(2026, 10, 22, 15, 4, 5))) {
    if (FIELDS.has(p.type)) tokens.push({ field: p.type as Field })
    else if (p.type === 'literal') tokens.push({ literal: p.value })
  }
  const result: Pattern = {
    tokens,
    hour12: tokens.some((x) => 'field' in x && x.field === 'dayPeriod'),
    am: periodText(locale, 9),
    pm: periodText(locale, 15),
  }
  cache.set(key, result)
  return result
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** The date as typed in the locale, e.g. `29/10/2026 08:05` (en-GB) or `10/29/2026 8:05 AM` (en-US). */
export function formatDateInput(date: Date, locale: string, seconds = false): string {
  const pat = patternFor(locale, seconds)
  const h12 = date.getHours() % 12 || 12
  return pat.tokens
    .map((tok) => {
      if ('literal' in tok) return tok.literal
      switch (tok.field) {
        case 'day': return pad2(date.getDate())
        case 'month': return pad2(date.getMonth() + 1)
        case 'year': return String(date.getFullYear())
        case 'hour': return pat.hour12 ? String(h12) : pad2(date.getHours())
        case 'minute': return pad2(date.getMinutes())
        case 'second': return pad2(date.getSeconds())
        case 'dayPeriod': return date.getHours() < 12 ? pat.am : pat.pm
      }
    })
    .join('')
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Space-like characters (NBSP, narrow NBSP) compare equal to a plain space. */
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ').trim().replace(/\s+/g, ' ')

/** Parse text typed in the locale; null when it does not match the locale's pattern or is not a real date. */
export function parseDateInput(text: string, locale: string, seconds = false): Date | null {
  const pat = patternFor(locale, seconds)
  const src = pat.tokens
    .map((tok) => {
      if ('literal' in tok) {
        const lit = norm(tok.literal)
        return lit === '' ? '\\s*' : lit === ',' ? '\\s*,?\\s*' : `\\s*${escapeRe(lit)}\\s*`
      }
      if (tok.field === 'year') return '(\\d{4})'
      if (tok.field === 'dayPeriod') return `(${escapeRe(norm(pat.am))}|${escapeRe(norm(pat.pm))})`
      return '(\\d{1,2})'
    })
    .join('')
  const m = new RegExp(`^${src}$`, 'i').exec(norm(text))
  if (!m) return null
  const v: Partial<Record<Field, string>> = {}
  let i = 1
  for (const tok of pat.tokens) if ('field' in tok) v[tok.field] = m[i++]
  const year = Number(v.year)
  const month = Number(v.month)
  const day = Number(v.day)
  let hour = Number(v.hour)
  const minute = Number(v.minute)
  const second = Number(v.second ?? 0)
  if (pat.hour12) {
    if (hour < 1 || hour > 12) return null
    const pm = norm(v.dayPeriod ?? '').toLowerCase() === norm(pat.pm).toLowerCase()
    hour = (hour % 12) + (pm ? 12 : 0)
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null
  const d = new Date(year, month - 1, day, hour, minute, second)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return d
}

/** A placeholder such as `dd/mm/yyyy hh:mm` showing the expected order. */
export function dateInputPattern(locale: string, seconds = false): string {
  const pat = patternFor(locale, seconds)
  return pat.tokens
    .map((tok) => {
      if ('literal' in tok) return tok.literal
      switch (tok.field) {
        case 'day': return 'dd'
        case 'month': return 'mm'
        case 'year': return 'yyyy'
        case 'hour': return 'hh'
        case 'minute': return 'mm'
        case 'second': return 'ss'
        case 'dayPeriod': return 'AM/PM'
      }
    })
    .join('')
}
