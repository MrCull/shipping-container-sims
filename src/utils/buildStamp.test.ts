import { describe, expect, it } from 'vitest'
import { COMMIT_URL_BASE, formatBuildStamp } from './buildStamp'

describe('formatBuildStamp', () => {
  it('formats a build time in local time with the commit link', () => {
    const buildTime = new Date(2026, 9, 31, 14, 20).toISOString()
    const stamp = formatBuildStamp({ buildTime, commit: 'd591898', isDev: false })
    expect(stamp.text).toBe('Built 31 Oct 2026 14:20')
    expect(stamp.commit).toBe('d591898')
    expect(stamp.commitUrl).toBe(`${COMMIT_URL_BASE}d591898`)
    expect(stamp.commitUrl).toMatch(/^https:\/\/github\.com\/MrCull\/shipping-container-sims\/commit\/d591898$/)
  })

  it('pads single-digit day, hour and minute', () => {
    const buildTime = new Date(2026, 0, 5, 3, 7).toISOString()
    expect(formatBuildStamp({ buildTime, commit: 'abc', isDev: false }).text).toBe('Built 5 Jan 2026 03:07')
  })

  it('shows "dev" without a time or commit on the dev server', () => {
    const stamp = formatBuildStamp({ buildTime: new Date().toISOString(), commit: 'd591898', isDev: true })
    expect(stamp).toEqual({ text: 'dev', commit: null, commitUrl: null })
  })

  it('falls back to time only when the commit is missing', () => {
    const buildTime = new Date(2026, 9, 31, 14, 20).toISOString()
    for (const commit of ['', '  ', undefined, 'unknown']) {
      const stamp = formatBuildStamp({ buildTime, commit, isDev: false })
      expect(stamp).toEqual({ text: 'Built 31 Oct 2026 14:20', commit: null, commitUrl: null })
    }
  })

  it('shows "dev" when the build time is unusable', () => {
    expect(formatBuildStamp({ buildTime: 'nonsense', commit: 'abc', isDev: false }).text).toBe('dev')
  })
})
