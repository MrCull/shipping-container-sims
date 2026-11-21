import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { orderWithFeaturedFirst, readLastPlayed, rememberLastPlayed } from './lastPlayed'

const games = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('orderWithFeaturedFirst', () => {
  it('keeps the given order when nothing was played', () => {
    expect(orderWithFeaturedFirst(games, null).map(g => g.id)).toEqual(['a', 'b', 'c'])
  })

  it('moves the last played game to the front and keeps the rest in order', () => {
    expect(orderWithFeaturedFirst(games, 'c').map(g => g.id)).toEqual(['c', 'a', 'b'])
  })

  it('ignores an id that is no longer a playable game', () => {
    expect(orderWithFeaturedFirst(games, 'gone').map(g => g.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('last played storage', () => {
  afterEach(() => vi.unstubAllGlobals())

  beforeEach(() => {
    const items = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => items.set(key, value),
      },
    })
  })

  it('reads back the last sim remembered', () => {
    expect(readLastPlayed()).toBeNull()
    rememberLastPlayed('b')
    rememberLastPlayed('c')
    expect(readLastPlayed()).toBe('c')
  })
})
