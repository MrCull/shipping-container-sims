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

describe('Yardshift store rejection message', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('a rejection message clears when the selection changes (selecting the receipt truck)', () => {
    const store = useYardshiftStore()
    store.loadLevel(4)
    store.dispatch({ type: 'rehandle', from: 0, to: 4 })
    store.dispatch({ type: 'collect', from: 0 })
    store.dispatch({ type: 'rehandle', from: 2, to: 4 })
    store.key('2')
    expect(store.message).toBe('Receive truck #8 first.')
    store.key('r')
    expect(store.ui.selection).toBe('receipt')
    expect(store.message).toBe('')
  })
})
