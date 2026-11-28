/** Entering Yardshift (owner round 6): the start choice when the player has progress past level 1. */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { emptyProgress } from '../modules/progress'
import { useYardshiftStore } from './yardshiftStore'

describe('Yardshift store entry flow', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('only level 1 unlocked: the level 1 intro', () => {
    const store = useYardshiftStore()
    store.progress = emptyProgress()
    store.enter()
    expect(store.overlay).toBe('intro')
    expect(store.state.level.number).toBe(1)
    expect(store.startChoice).toBeNull()
  })

  it('progress at level 3: the choice over level 3, paused; continue opens the level 3 intro', () => {
    const store = useYardshiftStore()
    store.progress = { ...emptyProgress(), unlocked: 3 }
    store.enter()
    expect(store.overlay).toBe('start')
    expect(store.startChoice?.continueLabel).toBe('Continue at level 3')
    expect(store.state.level.number).toBe(3)
    expect(store.state.pauses).toContain('intro')
    store.continueAt()
    expect(store.overlay).toBe('intro')
    expect(store.state.level.number).toBe(3)
  })

  it('start from level 1 opens the level 1 intro; the picker returns to the choice', () => {
    const store = useYardshiftStore()
    store.progress = { ...emptyProgress(), unlocked: 3 }
    store.enter()
    store.openLevels()
    store.closeLevels()
    expect(store.overlay).toBe('start')
    store.startFromOne()
    expect(store.overlay).toBe('intro')
    expect(store.state.level.number).toBe(1)
    expect(store.startChoice).toBeNull()
  })

  it('?unlock=all: no choice, level 1', () => {
    const store = useYardshiftStore()
    store.progress = { ...emptyProgress(), unlocked: 3 }
    store.setUnlockAll(true)
    store.enter()
    expect(store.overlay).toBe('intro')
    expect(store.state.level.number).toBe(1)
  })
})
