import { describe, expect, it } from 'vitest'
import { dateInputPattern, formatDateInput, parseDateInput } from '../i18n/dateInput'

const d = new Date(2026, 9, 29, 8, 5, 0)

describe('locale-aware date entry', () => {
  it('formats in the chosen locale order', () => {
    expect(formatDateInput(d, 'en-GB')).toBe('29/10/2026, 08:05')
    expect(formatDateInput(d, 'en-US')).toMatch(/^10\/29\/2026, 8:05.AM$/)
    expect(formatDateInput(d, 'de-DE')).toBe('29.10.2026, 08:05')
    expect(formatDateInput(d, 'en-GB', true)).toBe('29/10/2026, 08:05:00')
  })

  it('round-trips format -> parse for several locales', () => {
    for (const loc of ['en-GB', 'en-US', 'de-DE', 'fr-FR', 'ja-JP', 'sv-SE']) {
      for (const secs of [false, true]) {
        const back = parseDateInput(formatDateInput(d, loc, secs), loc, secs)
        expect(back?.getTime(), loc).toBe(d.getTime())
      }
    }
  })

  it('reads the same digits differently per locale', () => {
    expect(parseDateInput('03/04/2026, 10:00', 'en-GB')).toEqual(new Date(2026, 3, 3, 10, 0))
    expect(parseDateInput('03/04/2026, 10:00 AM', 'en-US')).toEqual(new Date(2026, 2, 4, 10, 0))
  })

  it('handles 12 h noon and midnight', () => {
    expect(parseDateInput('10/29/2026, 12:00 AM', 'en-US')).toEqual(new Date(2026, 9, 29, 0, 0))
    expect(parseDateInput('10/29/2026, 12:30 PM', 'en-US')).toEqual(new Date(2026, 9, 29, 12, 30))
  })

  it('rejects invalid and out-of-range input', () => {
    expect(parseDateInput('', 'en-GB')).toBeNull()
    expect(parseDateInput('31/02/2026 08:00', 'en-GB')).toBeNull()
    expect(parseDateInput('29/10/2026 25:00', 'en-GB')).toBeNull()
    expect(parseDateInput('2026-10-29 08:00', 'en-GB')).toBeNull()
    expect(parseDateInput('29/10/2026', 'en-GB')).toBeNull()
  })

  it('exposes a placeholder pattern', () => {
    expect(dateInputPattern('en-GB')).toBe('dd/mm/yyyy, hh:mm')
    expect(dateInputPattern('en-US')).toMatch(/^mm\/dd\/yyyy, hh:mm/)
  })
})
