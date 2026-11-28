/**
 * Yardshift progress storage (#386): round trip through the site-wide storage, independent bests, unlock on success,
 * version mismatch discards, `?unlock=all` only outside production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emptyProgress,
  isUnlocked,
  loadProgress,
  PROGRESS_VERSION,
  recordCompletion,
  saveProgress,
  unlockAllRequested,
} from './progress'

describe('Yardshift progress', () => {
  let items: Map<string, string>

  beforeEach(() => {
    items = new Map()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => items.get(k) ?? null,
        setItem: (k: string, v: string) => void items.set(k, v),
      },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('starts with only level 1 unlocked', () => {
    const p = loadProgress()
    expect(p.unlocked).toBe(1)
    expect(isUnlocked(p, 1, false)).toBe(true)
    expect(isUnlocked(p, 2, false)).toBe(false)
  })

  it('round-trips through the yardshift section of the site storage', () => {
    const p = recordCompletion(emptyProgress(), 1, 2, 640, 13)
    expect(saveProgress(p)).toBe(true)
    expect(JSON.parse(items.get('shipping-container-sims')!).sims.yardshift.version).toBe(PROGRESS_VERSION)
    expect(loadProgress()).toEqual(p)
  })

  it('keeps best stars and best score independently', () => {
    let p = recordCompletion(emptyProgress(), 3, 3, 400, 13)
    p = recordCompletion(p, 3, 1, 900, 13)
    expect(p.levels[3]).toEqual({ stars: 3, score: 900 })
  })

  it('unlocks the next level on success, never past the last, never lowering', () => {
    let p = recordCompletion(emptyProgress(), 1, 1, 0, 13)
    expect(p.unlocked).toBe(2)
    p = recordCompletion({ ...p, unlocked: 13 }, 13, 3, 0, 13)
    expect(p.unlocked).toBe(13)
    p = recordCompletion(p, 2, 3, 0, 13)
    expect(p.unlocked).toBe(13)
  })

  it('discards data with another schema version', () => {
    items.set(
      'shipping-container-sims',
      JSON.stringify({ version: 1, sims: { yardshift: { version: 0, unlocked: 9, levels: { 1: { stars: 3, score: 1 } } } } }),
    )
    expect(loadProgress()).toEqual(emptyProgress())
  })

  it('survives storage that refuses writes', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      },
    })
    expect(saveProgress(emptyProgress())).toBe(false)
  })

  it('honours ?unlock=all in dev and smoke builds only', () => {
    expect(unlockAllRequested('?unlock=all', true, 'development')).toBe(true)
    expect(unlockAllRequested('?unlock=all', false, 'smoke')).toBe(true)
    expect(unlockAllRequested('?unlock=all', false, 'production')).toBe(false)
    expect(unlockAllRequested('', true, 'development')).toBe(false)
  })
})
