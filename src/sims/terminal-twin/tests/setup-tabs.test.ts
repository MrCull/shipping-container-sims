/** Setup dialog tabs (#161): which tab holds each validation problem, so the error shows there and the tab is marked. */
import { describe, expect, it } from 'vitest'
import { catalogues } from '../i18n/messages'
import { CHECK_KEY_TABS, SETUP_TABS, setupIssues, tabOfCheckKey, tabsWithIssues } from '../modules/setupTabs'

const none = { layout: null, checkErrors: [], sts: null, shc: null, yard: null, end: null }

describe('setup dialog tabs', () => {
  it('has the four tabs of the spec in order', () => {
    expect(SETUP_TABS).toEqual(['scenario', 'vessels', 'yard', 'advanced'])
  })

  it('sends vessel and flow checks to Vessels and layout, equipment and mode checks to Yard and equipment', () => {
    expect(tabOfCheckKey('setup.check.noVessels')).toBe('vessels')
    expect(tabOfCheckKey('setup.check.capacity')).toBe('vessels')
    expect(tabOfCheckKey('setup.check.dwell')).toBe('vessels')
    expect(tabOfCheckKey('setup.check.quayLength')).toBe('yard')
    expect(tabOfCheckKey('setup.check.frontage')).toBe('yard')
    expect(tabOfCheckKey('setup.check.modeNoSts')).toBe('yard')
    expect(tabOfCheckKey('setup.check.trucks')).toBe('yard')
  })

  it('falls back to the Scenario tab for a check it does not know', () => {
    expect(tabOfCheckKey('setup.check.somethingNew')).toBe('scenario')
  })

  it('places every scenario check of the catalogue on a tab explicitly', () => {
    const keys = Object.keys(catalogues.en).filter((k) => k.startsWith('setup.check.'))
    expect(keys.length).toBeGreaterThan(20)
    expect(keys.filter((k) => !(k in CHECK_KEY_TABS))).toEqual([])
  })

  it('lists no issues when everything is valid', () => {
    expect(setupIssues(none)).toEqual([])
  })

  it('lists issues in the order the dialog checks them, each on its tab', () => {
    const issues = setupIssues({
      layout: 'bad seed',
      checkErrors: [{ key: 'setup.check.noVessels', message: 'no vessels' }],
      sts: 'sts',
      shc: 'shc',
      yard: 'yard',
      end: 'end',
    })
    expect(issues).toEqual([
      { tab: 'advanced', message: 'bad seed' },
      { tab: 'vessels', message: 'no vessels' },
      { tab: 'yard', message: 'sts' },
      { tab: 'yard', message: 'shc' },
      { tab: 'yard', message: 'yard' },
      { tab: 'advanced', message: 'end' },
    ])
  })

  it('marks each tab with an issue once, plus a tab holding an invalid input', () => {
    const issues = setupIssues({ ...none, sts: 'a', yard: 'b' })
    expect(tabsWithIssues(issues)).toEqual(['yard'])
    expect(tabsWithIssues(issues, 'advanced')).toEqual(['yard', 'advanced'])
    expect(tabsWithIssues([], null)).toEqual([])
  })
})
