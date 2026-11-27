/** The arrival announcement clears when the waiting truck becomes mandatory (playtest fix 7). */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useYardshiftStore } from './yardshiftStore'

describe('Yardshift store announcement', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('the arrival announcement clears on deadline zero', () => {
    const store = useYardshiftStore()
    store.loadLevel(4)
    store.dispatch({ type: 'rehandle', from: 0, to: 4 })
    store.dispatch({ type: 'collect', from: 0 })
    expect(store.announcement).not.toBe('')
    store.dispatch({ type: 'rehandle', from: 2, to: 4 })
    expect(store.state.deadline).toBe(0)
    expect(store.announcement).toBe('')
  })
})
