import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStowageMasterProgressSummary } from './progressStorage'

describe('Stowage Master home page progress summary', () => {
  let items: Map<string, string>

  beforeEach(() => {
    items = new Map()
    vi.stubGlobal('window', {
      localStorage: { getItem: (key: string) => items.get(key) ?? null },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('shows nothing for a player who has not finished a level, so the home tile has no "Your best"', () => {
    expect(getStowageMasterProgressSummary()).toBeNull()
  })

  it('names the next unlocked level once one is completed', () => {
    items.set('stowage-master-progress', JSON.stringify({ completedLevelIds: [0, 1] }))
    expect(getStowageMasterProgressSummary()).toBe('Level 3')
  })

  it('counts a level with a recorded best as reached', () => {
    items.set('stowage-master-level-bests', JSON.stringify({ 0: { score: 10 } }))
    expect(getStowageMasterProgressSummary()).toBe('Level 2')
  })
})
